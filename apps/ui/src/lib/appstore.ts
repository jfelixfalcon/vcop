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

/**
 * Saves the entire catalog structure to Kubernetes ConfigMap.
 */
async function saveEntireCatalogToK8s(catalog: AppStoreCatalog): Promise<void> {
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
