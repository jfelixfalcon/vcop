import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstalledApp, VirtualCluster, UserSession, AppDefinition } from './types';
import { getAppStoreCatalog } from './appstore';
import { getAppRevisionById, getAppRevisions } from './catalog-vcs';
import { k8sRequest, getVirtualCluster, getKubeconfig, compactInstalledAppsForAnnotation, sanitizeAnnotations } from './k8s-client';

const execFileAsync = promisify(execFile);

const INSTALLED_APPS_ANNOTATION = 'vops.gitops.io/installed-apps';

const defaultEnv = {
  ...process.env,
  HELM_CACHE_HOME: '/tmp/helm/cache',
  HELM_CONFIG_HOME: '/tmp/helm/config',
  HELM_DATA_HOME: '/tmp/helm/data',
};

/**
 * Prepares an internal in-cluster kubeconfig by setting insecure-skip-tls-verify: true
 * to prevent TLS altname mismatch when connecting to internal cluster DNS services.
 * Also explicitly sets context.namespace to avoid inheriting host pod namespace (e.g. vcop-system).
 */
function prepareInternalKubeconfig(raw: string, defaultNamespace = 'default', clusterName?: string, clusterNamespace?: string): string {
  let processed = raw.replace(/\s*certificate-authority-data:\s*[A-Za-z0-9+/=]+/g, '\n    insecure-skip-tls-verify: true');
  if (!processed.includes('insecure-skip-tls-verify: true')) {
    processed = processed.replace(/(cluster:\s*\n)/g, '$1    insecure-skip-tls-verify: true\n');
  }
  if (clusterName && clusterNamespace) {
    processed = processed.replace(/server:\s*https?:\/\/[^\s]+/g, `server: https://${clusterName}.${clusterNamespace}.svc:443`);
  }
  // Explicitly inject namespace into context block so kubectl does not default to host pod namespace
  processed = processed.replace(/(context:\s*\n)/g, `$1    namespace: ${defaultNamespace}\n`);
  return processed;
}

/**
 * Parses stdout from kubectl apply to record created/configured resources.
 */
function parseKubectlOutput(output: string): Array<{ kind: string; name: string }> {
  const resources: Array<{ kind: string; name: string }> = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([a-z0-9_.-]+(?:\.[a-z0-9_.-]+)?)\/([a-z0-9_.-]+)\s+(created|configured|unchanged)/i);
    if (match) {
      resources.push({
        kind: match[1],
        name: match[2],
      });
    }
  }
  return resources;
}

/**
 * Executes direct application deployment to the guest virtual cluster via kubectl and helm.
 */
export async function executeAppDeployment(
  rawKubeconfig: string,
  app: InstalledApp,
  clusterName?: string,
  clusterNamespace?: string
): Promise<{
  success: boolean;
  error?: string;
  resourcesCreated: Array<{ kind: string; name: string; namespace?: string }>;
}> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcop-app-'));
  const kcPath = path.join(tempDir, 'kubeconfig.yaml');
  const resourcesCreated: Array<{ kind: string; name: string; namespace?: string }> = [];
  const guestNamespace = app.helm?.namespace || 'default';

  try {
    const internalKc = prepareInternalKubeconfig(rawKubeconfig, guestNamespace, clusterName, clusterNamespace);
    fs.writeFileSync(kcPath, internalKc, { mode: 0o600 });

    // Pre-create target guest namespace if needed
    if (guestNamespace && guestNamespace !== 'default' && guestNamespace !== 'kube-system') {
      try {
        await execFileAsync('kubectl', ['--kubeconfig', kcPath, 'create', 'namespace', guestNamespace], { env: defaultEnv, timeout: 15000 });
      } catch {}
    }

    // 1. Deploy manifests if defined
    let manifests = app.manifests;
    if ((!manifests || !manifests.trim()) && app.appId) {
      try {
        const catalog = await getAppStoreCatalog();
        manifests = catalog.apps.find((a) => a.id === app.appId)?.manifests;
      } catch (err: any) {
        console.warn(`Failed to lookup manifests from catalog for app ${app.appId}:`, err?.message);
      }
    }

    if (manifests && manifests.trim()) {
      const manifestsPath = path.join(tempDir, 'manifests.yaml');
      fs.writeFileSync(manifestsPath, manifests.trim(), 'utf8');

      // Pre-create any non-default namespaces referenced in manifests
      const nsMatches = Array.from(manifests.matchAll(/^\s*namespace:\s*([a-z0-9-]+)/gim)).map((m) => m[1]);
      const uniqueNamespaces = Array.from(new Set(nsMatches)).filter((n) => n && n !== 'default' && n !== 'kube-system');
      for (const ns of uniqueNamespaces) {
        try {
          await execFileAsync('kubectl', ['--kubeconfig', kcPath, 'create', 'namespace', ns], { env: defaultEnv, timeout: 15000 });
        } catch {}
      }

      try {
        const res = await execFileAsync(
          'kubectl',
          ['--kubeconfig', kcPath, '--namespace', guestNamespace, 'apply', '--server-side', '--force-conflicts', '-f', manifestsPath],
          {
            env: defaultEnv,
            timeout: 60000,
          }
        );
        const parsed = parseKubectlOutput(res.stdout || '');
        resourcesCreated.push(...parsed);
      } catch (err: any) {
        const errMsg = err.stderr || err.stdout || err.message || 'kubectl apply failed';
        return {
          success: false,
          error: `Manifest deployment failed: ${errMsg.trim()}`,
          resourcesCreated,
        };
      }
    }

    // 2. Deploy Helm chart if defined
    if (app.helm && app.helm.name && app.helm.repo) {
      const releaseName = app.helm.releaseName || app.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const targetNs = app.helm.namespace || 'default';
      const helmArgs = [
        'upgrade',
        '--install',
        releaseName,
        app.helm.name,
        '--repo',
        app.helm.repo,
        '--namespace',
        targetNs,
        '--create-namespace',
        '--kubeconfig',
        kcPath,
        '--timeout',
        '5m',
      ];

      if (app.helm.version) {
        helmArgs.push('--version', app.helm.version);
      }

      const customValues = app.customValues !== undefined ? app.customValues : app.helm.values;
      if (customValues && customValues.trim()) {
        const valuesPath = path.join(tempDir, 'values.yaml');
        fs.writeFileSync(valuesPath, customValues.trim(), 'utf8');
        helmArgs.push('--values', valuesPath);
      }

      try {
        await execFileAsync('helm', helmArgs, {
          env: defaultEnv,
          timeout: 300000,
        });
        resourcesCreated.push({
          kind: 'HelmRelease',
          name: releaseName,
          namespace: targetNs,
        });
      } catch (err: any) {
        const errMsg = err.stderr || err.stdout || err.message || 'helm install failed';
        return {
          success: false,
          error: `Helm deployment failed: ${errMsg.trim()}`,
          resourcesCreated,
        };
      }
    }

    return { success: true, resourcesCreated };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Executes uninstallation of manifests and Helm releases from the guest virtual cluster.
 */
export async function executeAppUninstall(
  rawKubeconfig: string,
  app: InstalledApp,
  clusterName?: string,
  clusterNamespace?: string
): Promise<{ success: boolean; error?: string }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcop-uninst-'));
  const kcPath = path.join(tempDir, 'kubeconfig.yaml');
  const guestNamespace = app.helm?.namespace || 'default';

  try {
    const internalKc = prepareInternalKubeconfig(rawKubeconfig, guestNamespace, clusterName, clusterNamespace);
    fs.writeFileSync(kcPath, internalKc, { mode: 0o600 });

    // 1. Delete manifests if present
    let manifests = app.manifests;
    if ((!manifests || !manifests.trim()) && app.appId) {
      try {
        const catalog = await getAppStoreCatalog();
        manifests = catalog.apps.find((a) => a.id === app.appId)?.manifests;
      } catch (err: any) {
        console.warn(`Failed to lookup manifests from catalog for uninstall ${app.appId}:`, err?.message);
      }
    }

    if (manifests && manifests.trim()) {
      const manifestsPath = path.join(tempDir, 'manifests.yaml');
      fs.writeFileSync(manifestsPath, manifests.trim(), 'utf8');
      try {
        await execFileAsync('kubectl', ['--kubeconfig', kcPath, '--namespace', guestNamespace, 'delete', '-f', manifestsPath, '--ignore-not-found=true'], {
          env: defaultEnv,
          timeout: 60000,
        });
      } catch (err: any) {
        console.warn(`Warning during manifest uninstall for ${app.name}:`, err.message);
      }
    }

    // 2. Uninstall Helm release if present
    if (app.helm && app.helm.releaseName) {
      const targetNs = app.helm.namespace || 'default';
      try {
        await execFileAsync('helm', ['uninstall', app.helm.releaseName, '--namespace', targetNs, '--kubeconfig', kcPath, '--ignore-not-found'], {
          env: defaultEnv,
          timeout: 60000,
        });
      } catch (err: any) {
        console.warn(`Warning during helm uninstall for ${app.name}:`, err.message);
      }
    }

    return { success: true };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Gets all installed applications on a specific virtual cluster.
 */
export async function getInstalledApps(clusterName: string, namespace?: string): Promise<InstalledApp[]> {
  const cluster = await getVirtualCluster(clusterName, namespace);
  if (!cluster) return [];
  return cluster.metadata?.installedApps || [];
}

/**
 * Installs one or more applications/application  to a virtual cluster.
 * Connects directly to the guest cluster and executes deployment of Helm charts and manifests.
 */
export async function installAppsToCluster(
  clusterName: string,
  appRequests: Array<{
    appId: string;
    version?: string;
    revisionId?: string;
    customValues?: string;
    targetNamespace?: string;
  }>,
  user?: UserSession | null,
  namespace?: string,
  targetGuestNamespace?: string
): Promise<InstalledApp[]> {
  let targetNs = namespace;
  const currentCluster = await getVirtualCluster(clusterName, targetNs);
  if (!currentCluster) {
    throw new Error(`Cluster ${clusterName} not found`);
  }
  targetNs = currentCluster.namespace;

  if (currentCluster.status.phase === 'Sleeping' || currentCluster.spec.paused || currentCluster.spec.lifecycle?.sleep) {
    throw new Error(`Cluster "${clusterName}" is currently sleeping. Please wake up the cluster first to deploy applications.`);
  }

  const rawKubeconfig = await getKubeconfig(clusterName, targetNs);
  if (!rawKubeconfig) {
    throw new Error(`Kubeconfig for virtual cluster "${clusterName}" is not ready yet. Please ensure cluster control plane is ready.`);
  }

  const catalog = await getAppStoreCatalog();
  const existingApps = currentCluster.metadata?.installedApps || [];
  const updatedAppsMap = new Map<string, InstalledApp>();

  for (const app of existingApps) {
    updatedAppsMap.set(app.appId, app);
  }

  const installerName = user?.email || user?.username || 'Platform Administrator';
  const now = new Date().toISOString();

  for (const req of appRequests) {
    const catalogApp = catalog.apps.find((a) => a.id === req.appId);
    if (!catalogApp) {
      console.warn(`App with id ${req.appId} not found in catalog, skipping`);
      continue;
    }

    // Check if a specific version or revision snapshot was requested
    let appVersion = catalogApp.version;
    let helmSpec = catalogApp.helm ? JSON.parse(JSON.stringify(catalogApp.helm)) : undefined;
    let manifestsSpec = catalogApp.manifests;

    if (req.revisionId) {
      const rev = await getAppRevisionById(req.appId, req.revisionId);
      if (rev) {
        appVersion = rev.version;
        helmSpec = rev.helm ? JSON.parse(JSON.stringify(rev.helm)) : undefined;
        manifestsSpec = rev.manifests;
      }
    } else if (req.version && req.version !== catalogApp.version) {
      const revs = await getAppRevisions(req.appId);
      const rev = revs.find((r) => r.version === req.version);
      if (rev) {
        appVersion = rev.version;
        helmSpec = rev.helm ? JSON.parse(JSON.stringify(rev.helm)) : undefined;
        manifestsSpec = rev.manifests;
      }
    }

    const customValues = req.customValues !== undefined ? req.customValues : helmSpec?.values;
    const appGuestNs = req.targetNamespace || targetGuestNamespace || helmSpec?.namespace || 'default';

    const installed: InstalledApp = {
      appId: catalogApp.id,
      name: catalogApp.name,
      version: appVersion,
      category: catalogApp.category,
      installedAt: now,
      installedBy: installerName,
      status: 'Installing',
      customValues,
      helm: helmSpec ? { ...helmSpec, values: customValues, namespace: appGuestNs } : undefined,
      manifests: manifestsSpec,
    };

    // Execute actual deployment to the guest cluster
    const deployResult = await executeAppDeployment(rawKubeconfig, installed, clusterName, targetNs, appGuestNs);
    if (deployResult.success) {
      installed.status = 'Installed';
      installed.error = undefined;
      installed.resourcesCreated = deployResult.resourcesCreated;
    } else {
      installed.status = 'Failed';
      installed.error = deployResult.error;
      installed.resourcesCreated = deployResult.resourcesCreated;
    }

    updatedAppsMap.set(catalogApp.id, installed);
  }

  const updatedAppsList = Array.from(updatedAppsMap.values());

  // Persist installed apps status to Kubernetes CR annotation
  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`
  );
  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Could not fetch custom resource for ${clusterName}`);
  }

  const cr = getRes.data;
  const annotations = cr.metadata?.annotations || {};
  annotations[INSTALLED_APPS_ANNOTATION] = JSON.stringify(compactInstalledAppsForAnnotation(updatedAppsList));

  const patch = {
    metadata: {
      annotations: sanitizeAnnotations(annotations),
    },
  };

  const patchRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (patchRes.statusCode < 200 || patchRes.statusCode >= 300) {
    throw new Error(
      (patchRes.data as any)?.message ||
        `Failed to persist installed apps: HTTP ${patchRes.statusCode}`
    );
  }

  return updatedAppsList;
}

/**
 * Uninstalls an application from a virtual cluster.
 */
export async function uninstallAppFromCluster(
  clusterName: string,
  appId: string,
  namespace?: string
): Promise<InstalledApp[]> {
  let targetNs = namespace;
  const currentCluster = await getVirtualCluster(clusterName, targetNs);
  if (!currentCluster) {
    throw new Error(`Cluster ${clusterName} not found`);
  }
  targetNs = currentCluster.namespace;

  if (currentCluster.status.phase === 'Sleeping' || currentCluster.spec.paused || currentCluster.spec.lifecycle?.sleep) {
    throw new Error(`Cluster "${clusterName}" is currently sleeping. Please wake up the cluster first to modify applications.`);
  }

  const existingApps = currentCluster.metadata?.installedApps || [];
  const targetApp = existingApps.find((a) => a.appId === appId);

  if (targetApp) {
    const rawKubeconfig = await getKubeconfig(clusterName, targetNs);
    if (rawKubeconfig) {
      await executeAppUninstall(rawKubeconfig, targetApp, clusterName, targetNs);
    }
  }

  const updatedAppsList = existingApps.filter((a) => a.appId !== appId);

  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`
  );
  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Could not fetch custom resource for ${clusterName}`);
  }

  const cr = getRes.data;
  const annotations = cr.metadata?.annotations || {};
  annotations[INSTALLED_APPS_ANNOTATION] = JSON.stringify(compactInstalledAppsForAnnotation(updatedAppsList));

  const patch = {
    metadata: {
      annotations: sanitizeAnnotations(annotations),
    },
  };

  const patchRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (patchRes.statusCode < 200 || patchRes.statusCode >= 300) {
    throw new Error(
      (patchRes.data as any)?.message ||
        `Failed to uninstall app: HTTP ${patchRes.statusCode}`
    );
  }

  return updatedAppsList;
}

/**
 * Re-syncs / reconciles all installed applications on a virtual cluster.
 */
export async function syncClusterApps(
  clusterName: string,
  namespace?: string
): Promise<InstalledApp[]> {
  let targetNs = namespace;
  const currentCluster = await getVirtualCluster(clusterName, targetNs);
  if (!currentCluster) {
    throw new Error(`Cluster ${clusterName} not found`);
  }
  targetNs = currentCluster.namespace;

  if (currentCluster.status.phase === 'Sleeping' || currentCluster.spec.paused || currentCluster.spec.lifecycle?.sleep) {
    throw new Error(`Cluster "${clusterName}" is currently sleeping. Please wake up the cluster first to sync applications.`);
  }

  const rawKubeconfig = await getKubeconfig(clusterName, targetNs);
  if (!rawKubeconfig) {
    throw new Error(`Kubeconfig for virtual cluster "${clusterName}" is not ready yet.`);
  }

  const existingApps = currentCluster.metadata?.installedApps || [];
  if (existingApps.length === 0) {
    return [];
  }

  const updatedApps: InstalledApp[] = [];

  for (const app of existingApps) {
    const deployResult = await executeAppDeployment(rawKubeconfig, app, clusterName, targetNs);
    if (deployResult.success) {
      app.status = 'Installed';
      app.error = undefined;
      app.resourcesCreated = deployResult.resourcesCreated;
    } else {
      app.status = 'Failed';
      app.error = deployResult.error;
    }
    updatedApps.push(app);
  }

  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`
  );
  if (getRes.statusCode === 200 && getRes.data) {
    const cr = getRes.data;
    const annotations = cr.metadata?.annotations || {};
    annotations[INSTALLED_APPS_ANNOTATION] = JSON.stringify(compactInstalledAppsForAnnotation(updatedApps));
    await k8sRequest(
      `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`,
      'PATCH',
      { metadata: { annotations: sanitizeAnnotations(annotations) } },
      'application/merge-patch+json'
    );
  }

  return updatedApps;
}

/**
 * Rolls back an installed cluster application to a specific catalog revision or version.
 */
export async function rollbackClusterApp(
  clusterName: string,
  appId: string,
  revisionId?: string,
  targetVersion?: string,
  user?: UserSession | null,
  namespace?: string,
  customValues?: string
): Promise<InstalledApp[]> {
  return await installAppsToCluster(
    clusterName,
    [{
      appId,
      revisionId,
      version: targetVersion,
      customValues,
    }],
    user,
    namespace
  );
}
