import type { InstalledApp, VirtualCluster, UserSession, AppDefinition } from './types';
import { getAppStoreCatalog } from './appstore';
import { k8sRequest, getVirtualCluster } from './k8s-client';

const INSTALLED_APPS_ANNOTATION = 'vops.gitops.io/installed-apps';

/**
 * Gets all installed applications on a specific virtual cluster.
 */
export async function getInstalledApps(clusterName: string, namespace?: string): Promise<InstalledApp[]> {
  const cluster = await getVirtualCluster(clusterName, namespace);
  if (!cluster) return [];
  return cluster.metadata?.installedApps || [];
}

/**
 * Installs one or more applications/application packs to a virtual cluster.
 * Updates the Kubernetes VirtualCluster CR annotations and rawConfig experimental deployment specs.
 */
export async function installAppsToCluster(
  clusterName: string,
  appRequests: Array<{ appId: string; customValues?: string }>,
  user?: UserSession | null,
  namespace?: string
): Promise<InstalledApp[]> {
  let targetNs = namespace;
  const currentCluster = await getVirtualCluster(clusterName, targetNs);
  if (!currentCluster) {
    throw new Error(`Cluster ${clusterName} not found`);
  }
  targetNs = currentCluster.namespace;

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

    const customValues = req.customValues !== undefined ? req.customValues : catalogApp.helm?.values;

    const installed: InstalledApp = {
      appId: catalogApp.id,
      name: catalogApp.name,
      version: catalogApp.version,
      category: catalogApp.category,
      installedAt: now,
      installedBy: installerName,
      status: 'Installed',
      customValues,
      helm: catalogApp.helm ? { ...catalogApp.helm, values: customValues } : undefined,
      manifests: catalogApp.manifests,
    };

    updatedAppsMap.set(catalogApp.id, installed);
  }

  const updatedAppsList = Array.from(updatedAppsMap.values());

  // Fetch the full raw K8s custom resource to preserve spec & annotations
  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`
  );
  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Could not fetch custom resource for ${clusterName}`);
  }

  const cr = getRes.data;
  const annotations = cr.metadata?.annotations || {};
  annotations[INSTALLED_APPS_ANNOTATION] = JSON.stringify(updatedAppsList);

  // Compile experimental.deploy.vcluster for rawConfig
  const helmDeployments = updatedAppsList
    .filter((a) => a.helm)
    .map((a) => ({
      chart: {
        name: a.helm!.name,
        repo: a.helm!.repo,
        version: a.helm!.version || a.version,
      },
      release: {
        name: a.helm!.releaseName,
        namespace: a.helm!.namespace || 'default',
      },
      values: a.customValues !== undefined ? a.customValues : a.helm!.values,
    }));

  const manifestsDeployments = updatedAppsList
    .filter((a) => a.manifests && a.manifests.trim())
    .map((a) => a.manifests!.trim())
    .join('\n---\n');

  const rawConfig = cr.spec?.rawConfig || {};
  rawConfig.experimental = rawConfig.experimental || {};
  rawConfig.experimental.deploy = rawConfig.experimental.deploy || {};
  rawConfig.experimental.deploy.vcluster = {
    helm: helmDeployments,
    manifests: manifestsDeployments,
  };

  const patch = {
    metadata: {
      annotations,
    },
    spec: {
      rawConfig,
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

  const existingApps = currentCluster.metadata?.installedApps || [];
  const updatedAppsList = existingApps.filter((a) => a.appId !== appId);

  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`
  );
  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Could not fetch custom resource for ${clusterName}`);
  }

  const cr = getRes.data;
  const annotations = cr.metadata?.annotations || {};
  annotations[INSTALLED_APPS_ANNOTATION] = JSON.stringify(updatedAppsList);

  const helmDeployments = updatedAppsList
    .filter((a) => a.helm)
    .map((a) => ({
      chart: {
        name: a.helm!.name,
        repo: a.helm!.repo,
        version: a.helm!.version || a.version,
      },
      release: {
        name: a.helm!.releaseName,
        namespace: a.helm!.namespace || 'default',
      },
      values: a.customValues !== undefined ? a.customValues : a.helm!.values,
    }));

  const manifestsDeployments = updatedAppsList
    .filter((a) => a.manifests && a.manifests.trim())
    .map((a) => a.manifests!.trim())
    .join('\n---\n');

  const rawConfig = cr.spec?.rawConfig || {};
  rawConfig.experimental = rawConfig.experimental || {};
  rawConfig.experimental.deploy = rawConfig.experimental.deploy || {};
  rawConfig.experimental.deploy.vcluster = {
    helm: helmDeployments,
    manifests: manifestsDeployments,
  };

  const patch = {
    metadata: {
      annotations,
    },
    spec: {
      rawConfig,
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
