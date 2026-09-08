import type { AppDefinition, AppGroup, AppStoreCatalog } from './types';
import { k8sRequest } from './k8s-client';

const CATALOG_CONFIGMAP_NAME = 'vcop-appstore-catalog';
const CATALOG_NAMESPACE = 'vcop-system';

export const DEFAULT_CATALOG: AppStoreCatalog = {
  updatedAt: new Date().toISOString(),
  groups: [],
  apps: [],
};

let memoryCatalogCache: AppStoreCatalog | null = null;
let lastFetchTime = 0;

/**
 * Retrieves the full App Store catalog from the Kubernetes ConfigMap,
 * initializing it if not present.
 */
export async function getAppStoreCatalog(): Promise<AppStoreCatalog> {
  const now = Date.now();
  if (memoryCatalogCache && now - lastFetchTime < 5000) {
    return memoryCatalogCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${CATALOG_NAMESPACE}/configmaps/${CATALOG_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['catalog.json']) {
      const parsed = JSON.parse(res.data.data['catalog.json']) as AppStoreCatalog;
      memoryCatalogCache = parsed;
      lastFetchTime = now;
      return parsed;
    }
  } catch (err) {
    // ConfigMap not created yet, initialize it
  }

  // If not found, persist default catalog to Kubernetes ConfigMap
  try {
    await saveEntireCatalogToK8s(DEFAULT_CATALOG);
    memoryCatalogCache = DEFAULT_CATALOG;
    lastFetchTime = now;
    return DEFAULT_CATALOG;
  } catch (e) {
    console.warn('Could not persist App Store ConfigMap, using in-memory default:', e);
    memoryCatalogCache = DEFAULT_CATALOG;
    return DEFAULT_CATALOG;
  }
}

import YAML from 'yaml';

/**
 * Saves the entire catalog structure to Kubernetes ConfigMap.
 */
export async function saveEntireCatalog(catalog: AppStoreCatalog): Promise<void> {
  const catalogPayload = {
    ...catalog,
    updatedAt: new Date().toISOString(),
  };

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: CATALOG_CONFIGMAP_NAME,
      namespace: CATALOG_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-appstore',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'catalog.json': JSON.stringify(catalogPayload, null, 2),
    },
  };

  // Try PATCH or create
  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${CATALOG_NAMESPACE}/configmaps/${CATALOG_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${CATALOG_NAMESPACE}/configmaps/${CATALOG_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${CATALOG_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }

  memoryCatalogCache = catalogPayload;
  lastFetchTime = Date.now();
}

/**
 * Clears all applications and groups from the App Store catalog.
 */
export async function clearAppStoreCatalog(): Promise<AppStoreCatalog> {
  const empty: AppStoreCatalog = {
    updatedAt: new Date().toISOString(),
    apps: [],
    groups: [],
  };
  await saveEntireCatalog(empty);
  return empty;
}

/**
 * Parses and imports an App Store catalog manifest (YAML or JSON).
 */
export async function importAppStoreCatalog(input: string | any): Promise<AppStoreCatalog> {
  let data: any = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Import manifest cannot be empty.');
    }
    try {
      data = JSON.parse(trimmed);
    } catch {
      try {
        data = YAML.parse(trimmed);
      } catch (yamlErr: any) {
        throw new Error(`Failed to parse manifest as JSON or YAML: ${yamlErr.message}`);
      }
    }
  }

  // Handle multi-doc YAML array
  if (Array.isArray(data) && data.length > 0) {
    const cmDoc = data.find((d: any) => d?.metadata?.name === CATALOG_CONFIGMAP_NAME);
    if (cmDoc) data = cmDoc;
  }

  // If Kubernetes ConfigMap format
  if (data?.kind === 'ConfigMap' && data.data?.['catalog.json']) {
    try {
      data = JSON.parse(data.data['catalog.json']);
    } catch {
      data = YAML.parse(data.data['catalog.json']);
    }
  } else if (data?.appCatalog) {
    data = data.appCatalog;
  } else if (data?.appStore) {
    data = data.appStore;
  } else if (data?.catalog) {
    data = data.catalog;
  }

  if (Array.isArray(data)) {
    // Array of apps directly passed
    data = { apps: data, groups: [] };
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid App Store catalog manifest format.');
  }

  const rawApps = Array.isArray(data.apps) ? data.apps : (Array.isArray(data.applications) ? data.applications : []);
  const rawGroups = Array.isArray(data.groups) ? data.groups : (Array.isArray(data.appGroups) ? data.appGroups : []);

  const normalizedApps: AppDefinition[] = rawApps.map((a: any) => {
    const id = String(a.id || a.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return {
      id,
      name: String(a.name || id),
      description: String(a.description || ''),
      category: a.category || 'Developer Tools',
      version: String(a.version || '1.0.0'),
      group: a.group ? String(a.group) : undefined,
      tags: Array.isArray(a.tags) ? a.tags : [],
      helm: a.helm ? {
        repo: String(a.helm.repo || ''),
        name: String(a.helm.name || ''),
        releaseName: String(a.helm.releaseName || a.helm.name || id),
        version: a.helm.version ? String(a.helm.version) : undefined,
        namespace: String(a.helm.namespace || 'default'),
        values: a.helm.values ? String(a.helm.values) : undefined,
      } : undefined,
      manifests: a.manifests ? String(a.manifests) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }).filter((a: AppDefinition) => Boolean(a.id && a.name));

  const normalizedGroups: AppGroup[] = rawGroups.map((g: any) => {
    const id = String(g.id || g.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return {
      id,
      name: String(g.name || id),
      description: String(g.description || ''),
      icon: g.icon || 'Layers',
      appIds: Array.isArray(g.appIds) ? g.appIds.map(String) : [],
    };
  }).filter((g: AppGroup) => Boolean(g.id && g.name));

  const newCatalog: AppStoreCatalog = {
    updatedAt: new Date().toISOString(),
    apps: normalizedApps,
    groups: normalizedGroups,
  };

  await saveEntireCatalog(newCatalog);
  return newCatalog;
}

/**
 * Adds or updates an application definition in the App Store catalog.
 */
export async function saveAppDefinition(app: AppDefinition): Promise<AppStoreCatalog> {
  const catalog = await getAppStoreCatalog();
  const existingIdx = catalog.apps.findIndex((a) => a.id === app.id);

  const updatedApp: AppDefinition = {
    ...app,
    updatedAt: new Date().toISOString(),
    createdAt: existingIdx >= 0 ? catalog.apps[existingIdx].createdAt : new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    catalog.apps[existingIdx] = updatedApp;
  } else {
    catalog.apps.push(updatedApp);
  }

  await saveEntireCatalogToK8s(catalog);
  return catalog;
}

/**
 * Deletes an application definition from the App Store catalog.
 */
export async function deleteAppDefinition(appId: string): Promise<AppStoreCatalog> {
  const catalog = await getAppStoreCatalog();
  catalog.apps = catalog.apps.filter((a) => a.id !== appId);

  // Remove app from any groups it belongs to
  for (const group of catalog.groups) {
    group.appIds = group.appIds.filter((id) => id !== appId);
  }

  await saveEntireCatalogToK8s(catalog);
  return catalog;
}

/**
 * Adds or updates an application group in the App Store catalog.
 */
export async function saveAppGroup(group: AppGroup): Promise<AppStoreCatalog> {
  const catalog = await getAppStoreCatalog();
  const existingIdx = catalog.groups.findIndex((g) => g.id === group.id);

  if (existingIdx >= 0) {
    catalog.groups[existingIdx] = group;
  } else {
    catalog.groups.push(group);
  }

  await saveEntireCatalogToK8s(catalog);
  return catalog;
}

/**
 * Deletes an application group from the App Store catalog.
 */
export async function deleteAppGroup(groupId: string): Promise<AppStoreCatalog> {
  const catalog = await getAppStoreCatalog();
  catalog.groups = catalog.groups.filter((g) => g.id !== groupId);

  await saveEntireCatalogToK8s(catalog);
  return catalog;
}
