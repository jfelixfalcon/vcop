import crypto from 'node:crypto';
import type {
  AppDefinition,
  AppGroup,
  AppRevisionSnapshot,
  GroupRevisionSnapshot,
  CatalogVCSStore,
  GlobalVCSCommit,
  VCSChangeType,
  DiffLine,
  GroupAppItem,
} from './types';
import { k8sRequest } from './k8s-client';

const VCS_CONFIGMAP_NAME = 'vcop-catalog-history';
const VCS_NAMESPACE = 'vcop-system';
const MAX_REVISIONS_PER_ITEM = 100;
const MAX_GLOBAL_COMMITS = 500;

let vcsCache: CatalogVCSStore | null = null;
let lastFetchTime = 0;

function generateCommitId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * Line-by-line unified diff calculation between two text blocks (e.g. YAML manifests or Helm values).
 */
export function computeTextDiff(oldText = '', newText = ''): DiffLine[] {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  if (oldLines.length === 0 && newLines.length === 0) {
    return [];
  }

  const result: DiffLine[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];

    if (oldIdx < oldLines.length && newIdx < newLines.length) {
      if (oldLine === newLine) {
        result.push({
          type: 'unchanged',
          line: oldLine,
          oldLineNumber: oldIdx + 1,
          newLineNumber: newIdx + 1,
        });
        oldIdx++;
        newIdx++;
      } else {
        // Lookahead to detect added vs removed vs changed
        const nextMatchInNew = newLines.indexOf(oldLine, newIdx);
        const nextMatchInOld = oldLines.indexOf(newLine, oldIdx);

        if (nextMatchInNew !== -1 && (nextMatchInOld === -1 || nextMatchInNew - newIdx < nextMatchInOld - oldIdx)) {
          // Lines were added in new
          result.push({
            type: 'added',
            line: newLine,
            newLineNumber: newIdx + 1,
          });
          newIdx++;
        } else {
          // Line was removed from old
          result.push({
            type: 'removed',
            line: oldLine,
            oldLineNumber: oldIdx + 1,
          });
          oldIdx++;
        }
      }
    } else if (newIdx < newLines.length) {
      // Remaining new lines are added
      result.push({
        type: 'added',
        line: newLine,
        newLineNumber: newIdx + 1,
      });
      newIdx++;
    } else {
      // Remaining old lines are removed
      result.push({
        type: 'removed',
        line: oldLine,
        oldLineNumber: oldIdx + 1,
      });
      oldIdx++;
    }
  }

  return result;
}

/**
 * Retrieves the full Version Control store from the Kubernetes ConfigMap,
 * initializing it if not present.
 */
export async function getCatalogVCSStore(): Promise<CatalogVCSStore> {
  const now = Date.now();
  if (vcsCache && now - lastFetchTime < 4000) {
    return vcsCache;
  }

  const defaultStore: CatalogVCSStore = {
    appRevisions: {},
    groupRevisions: {},
    globalCommits: [],
    updatedAt: new Date().toISOString(),
  };

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${VCS_NAMESPACE}/configmaps/${VCS_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['vcs.json']) {
      const parsed = JSON.parse(res.data.data['vcs.json']) as CatalogVCSStore;
      vcsCache = parsed;
      lastFetchTime = now;
      return parsed;
    }
  } catch (err) {
    // ConfigMap not created yet, initialize
  }

  vcsCache = defaultStore;
  lastFetchTime = now;
  return defaultStore;
}

/**
 * Saves the Version Control store to Kubernetes ConfigMap and in-memory cache.
 */
export async function saveCatalogVCSStore(store: CatalogVCSStore): Promise<void> {
  store.updatedAt = new Date().toISOString();

  // Prune global commits to keep within ConfigMap 1MB limits
  if (store.globalCommits.length > MAX_GLOBAL_COMMITS) {
    store.globalCommits = store.globalCommits.slice(0, MAX_GLOBAL_COMMITS);
  }

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: VCS_CONFIGMAP_NAME,
      namespace: VCS_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-catalog-vcs',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'vcs.json': JSON.stringify(store, null, 2),
    },
  };

  try {
    const checkRes = await k8sRequest<any>(
      `/api/v1/namespaces/${VCS_NAMESPACE}/configmaps/${VCS_CONFIGMAP_NAME}`
    );

    if (checkRes.statusCode === 200) {
      await k8sRequest(
        `/api/v1/namespaces/${VCS_NAMESPACE}/configmaps/${VCS_CONFIGMAP_NAME}`,
        'PUT',
        cmData
      );
    } else {
      await k8sRequest(
        `/api/v1/namespaces/${VCS_NAMESPACE}/configmaps`,
        'POST',
        cmData
      );
    }
  } catch (e) {
    console.warn('Could not persist VCS history to ConfigMap, caching in-memory:', e);
  }

  vcsCache = store;
  lastFetchTime = Date.now();
}

/**
 * Records an immutable version revision commit for an Application.
 * Automatically computes diff against the previous revision and generates change log.
 */
export async function recordAppCommit(
  app: AppDefinition,
  author = 'Platform Operator',
  customMessage?: string,
  changeType: VCSChangeType = 'update'
): Promise<AppRevisionSnapshot> {
  const store = await getCatalogVCSStore();
  const existingRevs = store.appRevisions[app.id] || [];
  const latestRev = existingRevs[0]; // newest is at index 0

  const revisionNumber = (latestRev ? latestRev.revisionNumber : 0) + 1;
  const commitId = generateCommitId();
  const timestamp = new Date().toISOString();

  // Compute diffs against previous revision if any
  let manifestsDiff: DiffLine[] = [];
  let valuesDiff: DiffLine[] = [];
  let helmVersionChanged: { from?: string; to?: string } | undefined;
  const fieldChanges: string[] = [];

  if (latestRev) {
    if (latestRev.version !== app.version) {
      fieldChanges.push(`Version: ${latestRev.version} → ${app.version}`);
    }
    if (latestRev.category !== app.category) {
      fieldChanges.push(`Category: ${latestRev.category} → ${app.category}`);
    }
    if (latestRev.helm?.version !== app.helm?.version) {
      helmVersionChanged = {
        from: latestRev.helm?.version,
        to: app.helm?.version,
      };
      fieldChanges.push(`Helm Version: ${latestRev.helm?.version || 'none'} → ${app.helm?.version || 'none'}`);
    }
    if (latestRev.helm?.repo !== app.helm?.repo) {
      fieldChanges.push(`Helm Repo: ${latestRev.helm?.repo || 'none'} → ${app.helm?.repo || 'none'}`);
    }
    if (latestRev.group !== app.group) {
      fieldChanges.push(`Group: ${latestRev.group || 'none'} → ${app.group || 'none'}`);
    }

    manifestsDiff = computeTextDiff(latestRev.manifests || '', app.manifests || '');
    valuesDiff = computeTextDiff(latestRev.helm?.values || '', app.helm?.values || '');
  } else {
    fieldChanges.push('Initial release created');
    manifestsDiff = computeTextDiff('', app.manifests || '');
    valuesDiff = computeTextDiff('', app.helm?.values || '');
  }

  const manifestsAdded = manifestsDiff.filter((d) => d.type === 'added').length;
  const manifestsRemoved = manifestsDiff.filter((d) => d.type === 'removed').length;
  const valuesAdded = valuesDiff.filter((d) => d.type === 'added').length;
  const valuesRemoved = valuesDiff.filter((d) => d.type === 'removed').length;

  let commitMessage = customMessage?.trim();
  if (!commitMessage) {
    if (changeType === 'create' || !latestRev) {
      commitMessage = `Initial commit of ${app.name} v${app.version}`;
    } else if (changeType === 'rollback') {
      commitMessage = `Rollback configuration to v${app.version}`;
    } else if (changeType === 'import') {
      commitMessage = `Imported manifest definitions for ${app.name} v${app.version}`;
    } else {
      const parts: string[] = [];
      if (latestRev.version !== app.version) parts.push(`bumped to v${app.version}`);
      if (manifestsAdded > 0 || manifestsRemoved > 0) parts.push(`updated raw manifests (+${manifestsAdded}/-${manifestsRemoved})`);
      if (valuesAdded > 0 || valuesRemoved > 0) parts.push(`updated Helm values (+${valuesAdded}/-${valuesRemoved})`);
      if (helmVersionChanged) parts.push(`chart v${helmVersionChanged.to}`);
      commitMessage = parts.length > 0 ? `Updated ${app.name}: ${parts.join(', ')}` : `Updated ${app.name} configuration`;
    }
  }

  const snapshot: AppRevisionSnapshot = {
    id: commitId,
    revisionNumber,
    appId: app.id,
    version: app.version,
    name: app.name,
    category: app.category,
    description: app.description,
    timestamp,
    author,
    commitMessage,
    changeType,
    tags: changeType === 'create' || !latestRev ? ['initial', `v${app.version}`] : [`v${app.version}`],
    isWorkingVersion: changeType === 'create' || !latestRev, // default first revision as known working
    helm: app.helm ? JSON.parse(JSON.stringify(app.helm)) : undefined,
    manifests: app.manifests,
    group: app.group,
    diffSummary: {
      helmVersionChanged,
      manifestsModified: manifestsAdded > 0 || manifestsRemoved > 0,
      manifestsLinesAdded: manifestsAdded,
      manifestsLinesRemoved: manifestsRemoved,
      valuesModified: valuesAdded > 0 || valuesRemoved > 0,
      valuesLinesAdded: valuesAdded,
      valuesLinesRemoved: valuesRemoved,
      fieldChanges,
    },
  };

  // Prepend to revisions array
  existingRevs.unshift(snapshot);
  if (existingRevs.length > MAX_REVISIONS_PER_ITEM) {
    existingRevs.length = MAX_REVISIONS_PER_ITEM;
  }
  store.appRevisions[app.id] = existingRevs;

  // Append to global commits
  store.globalCommits.unshift({
    id: commitId,
    timestamp,
    author,
    entityType: 'app',
    entityId: app.id,
    entityName: app.name,
    version: app.version,
    commitMessage,
    changeType,
  });

  await saveCatalogVCSStore(store);
  return snapshot;
}

/**
 * Normalizes an AppGroup so it always has both appIds and explicit apps array with pinned versions.
 */
export function normalizeGroupApps(group: AppGroup, catalogApps?: AppDefinition[]): GroupAppItem[] {
  if (group.apps && group.apps.length > 0) {
    return group.apps;
  }
  return (group.appIds || []).map((id) => {
    const catalogApp = catalogApps?.find((a) => a.id === id);
    return {
      appId: id,
      version: catalogApp?.version || 'latest',
    };
  });
}

/**
 * Records an immutable version revision commit for an Application Group.
 * Tracks changes to the group itself as well as all member app versions within the group.
 */
export async function recordGroupCommit(
  group: AppGroup,
  author = 'Platform Operator',
  customMessage?: string,
  changeType: VCSChangeType = 'update',
  catalogApps?: AppDefinition[]
): Promise<GroupRevisionSnapshot> {
  const store = await getCatalogVCSStore();
  const existingRevs = store.groupRevisions[group.id] || [];
  const latestRev = existingRevs[0];

  const revisionNumber = (latestRev ? latestRev.revisionNumber : 0) + 1;
  const commitId = generateCommitId();
  const timestamp = new Date().toISOString();
  const groupVersion = group.version || `1.${revisionNumber - 1}.0`;

  const normalizedApps = normalizeGroupApps(group, catalogApps);

  // Compute diff against previous group revision
  const previousApps = latestRev ? latestRev.apps : [];
  const prevAppIds = new Set(previousApps.map((a) => a.appId));
  const newAppIds = new Set(normalizedApps.map((a) => a.appId));

  const appsAdded = normalizedApps.filter((a) => !prevAppIds.has(a.appId)).map((a) => `${a.appId} (${a.version || 'latest'})`);
  const appsRemoved = previousApps.filter((a) => !newAppIds.has(a.appId)).map((a) => `${a.appId} (${a.version || 'latest'})`);

  const appsVersionChanged: Array<{ appId: string; from: string; to: string }> = [];
  for (const newApp of normalizedApps) {
    const oldApp = previousApps.find((a) => a.appId === newApp.appId);
    if (oldApp && oldApp.version && newApp.version && oldApp.version !== newApp.version) {
      appsVersionChanged.push({
        appId: newApp.appId,
        from: oldApp.version,
        to: newApp.version,
      });
    }
  }

  let commitMessage = customMessage?.trim();
  if (!commitMessage) {
    if (changeType === 'create' || !latestRev) {
      commitMessage = `Created group ${group.name} v${groupVersion} bundling ${normalizedApps.length} apps`;
    } else if (changeType === 'rollback') {
      commitMessage = `Rollback group ${group.name} to v${groupVersion}`;
    } else {
      const summaryParts: string[] = [];
      if (appsAdded.length > 0) summaryParts.push(`added ${appsAdded.join(', ')}`);
      if (appsRemoved.length > 0) summaryParts.push(`removed ${appsRemoved.join(', ')}`);
      if (appsVersionChanged.length > 0) {
        summaryParts.push(`bumped ${appsVersionChanged.map((c) => `${c.appId} ${c.from}→${c.to}`).join(', ')}`);
      }
      commitMessage = summaryParts.length > 0
        ? `Updated ${group.name}: ${summaryParts.join('; ')}`
        : `Updated group ${group.name} v${groupVersion}`;
    }
  }

  const snapshot: GroupRevisionSnapshot = {
    id: commitId,
    revisionNumber,
    groupId: group.id,
    version: groupVersion,
    name: group.name,
    description: group.description,
    icon: group.icon,
    timestamp,
    author,
    commitMessage,
    changeType,
    tags: [`v${groupVersion}`],
    isWorkingVersion: changeType === 'create' || !latestRev,
    apps: normalizedApps,
    diffSummary: {
      appsAdded,
      appsRemoved,
      appsVersionChanged,
    },
  };

  existingRevs.unshift(snapshot);
  if (existingRevs.length > MAX_REVISIONS_PER_ITEM) {
    existingRevs.length = MAX_REVISIONS_PER_ITEM;
  }
  store.groupRevisions[group.id] = existingRevs;

  store.globalCommits.unshift({
    id: commitId,
    timestamp,
    author,
    entityType: 'group',
    entityId: group.id,
    entityName: group.name,
    version: groupVersion,
    commitMessage,
    changeType,
  });

  await saveCatalogVCSStore(store);
  return snapshot;
}

/**
 * Retrieves all revisions for a specific Application.
 */
export async function getAppRevisions(appId: string): Promise<AppRevisionSnapshot[]> {
  const store = await getCatalogVCSStore();
  return store.appRevisions[appId] || [];
}

/**
 * Retrieves all revisions for a specific Application Group.
 */
export async function getGroupRevisions(groupId: string): Promise<GroupRevisionSnapshot[]> {
  const store = await getCatalogVCSStore();
  return store.groupRevisions[groupId] || [];
}

/**
 * Retrieves a single Application Revision by ID.
 */
export async function getAppRevisionById(appId: string, revisionId: string): Promise<AppRevisionSnapshot | null> {
  const revs = await getAppRevisions(appId);
  return revs.find((r) => r.id === revisionId || String(r.revisionNumber) === revisionId) || null;
}

/**
 * Retrieves a single Group Revision by ID.
 */
export async function getGroupRevisionById(groupId: string, revisionId: string): Promise<GroupRevisionSnapshot | null> {
  const revs = await getGroupRevisions(groupId);
  return revs.find((r) => r.id === revisionId || String(r.revisionNumber) === revisionId) || null;
}

/**
 * Marks/toggles an Application Revision as a known working version ("golden release").
 */
export async function toggleAppWorkingVersion(appId: string, revisionId: string, isWorking: boolean): Promise<boolean> {
  const store = await getCatalogVCSStore();
  const revs = store.appRevisions[appId] || [];
  const target = revs.find((r) => r.id === revisionId);
  if (!target) return false;

  target.isWorkingVersion = isWorking;
  await saveCatalogVCSStore(store);
  return true;
}

/**
 * Marks/toggles a Group Revision as a known working version.
 */
export async function toggleGroupWorkingVersion(groupId: string, revisionId: string, isWorking: boolean): Promise<boolean> {
  const store = await getCatalogVCSStore();
  const revs = store.groupRevisions[groupId] || [];
  const target = revs.find((r) => r.id === revisionId);
  if (!target) return false;

  target.isWorkingVersion = isWorking;
  await saveCatalogVCSStore(store);
  return true;
}
