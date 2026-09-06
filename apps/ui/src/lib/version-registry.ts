import type { VersionItem, VersionRegistry } from './types';
import { k8sRequest } from './k8s-client';

const REGISTRY_CONFIGMAP_NAME = 'vcop-version-registry';
const REGISTRY_NAMESPACE = 'vcop-system';

export const DEFAULT_VERSION_REGISTRY: VersionRegistry = {
  updatedAt: new Date().toISOString(),
  kubernetesVersions: [
    {
      version: 'v1.31.0',
      label: 'v1.31.0 (Latest Default)',
      tag: 'default',
      isDefault: true,
      notes: 'Recommended stable release for production virtual clusters',
    },
    {
      version: 'v1.30.0',
      label: 'v1.30.0 (LTS)',
      tag: 'lts',
      isDefault: false,
      notes: 'Long Term Support control plane version',
    },
    {
      version: 'v1.32.0',
      label: 'v1.32.0 (Preview)',
      tag: 'preview',
      isDefault: false,
      notes: 'Cutting edge release for feature evaluation',
    },
  ],
  vclusterVersions: [
    {
      version: '0.36.0',
      label: '0.36.0 (Unified Schema)',
      tag: 'default',
      isDefault: true,
      notes: 'vCluster OSS engine with unified schema and modular architecture',
    },
    {
      version: '0.35.2',
      label: '0.35.2 (Classic Stable)',
      tag: 'stable',
      isDefault: false,
      notes: 'Proven stable engine release for compatibility fallback',
    },
    {
      version: '0.37.0-beta.1',
      label: '0.37.0-beta.1 (Preview)',
      tag: 'preview',
      isDefault: false,
      notes: 'Next-generation vCluster preview with advanced isolation hooks',
    },
  ],
};

let memoryRegistryCache: VersionRegistry | null = null;
let lastFetchTime = 0;

/**
 * Retrieves the full Version Registry from the Kubernetes ConfigMap,
 * initializing it if not present.
 */
export async function getVersionRegistry(): Promise<VersionRegistry> {
  const now = Date.now();
  if (memoryRegistryCache && now - lastFetchTime < 5000) {
    return memoryRegistryCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${REGISTRY_NAMESPACE}/configmaps/${REGISTRY_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['versions.json']) {
      const parsed = JSON.parse(res.data.data['versions.json']) as VersionRegistry;
      memoryRegistryCache = parsed;
      lastFetchTime = now;
      return parsed;
    }
  } catch (err) {
    // ConfigMap not created yet
  }

  // If not found, persist default registry to Kubernetes ConfigMap
  try {
    await saveEntireRegistryToK8s(DEFAULT_VERSION_REGISTRY);
    memoryRegistryCache = DEFAULT_VERSION_REGISTRY;
    lastFetchTime = now;
    return DEFAULT_VERSION_REGISTRY;
  } catch (e) {
    console.warn('Could not persist Version Registry ConfigMap, using memory default:', e);
    memoryRegistryCache = DEFAULT_VERSION_REGISTRY;
    return DEFAULT_VERSION_REGISTRY;
  }
}

/**
 * Saves the entire registry structure to Kubernetes ConfigMap.
 */
async function saveEntireRegistryToK8s(registry: VersionRegistry): Promise<void> {
  const payload: VersionRegistry = {
    ...registry,
    updatedAt: new Date().toISOString(),
  };

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: REGISTRY_CONFIGMAP_NAME,
      namespace: REGISTRY_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-version-registry',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'versions.json': JSON.stringify(payload, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${REGISTRY_NAMESPACE}/configmaps/${REGISTRY_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${REGISTRY_NAMESPACE}/configmaps/${REGISTRY_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${REGISTRY_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }

  memoryRegistryCache = payload;
  lastFetchTime = Date.now();
}

/**
 * Adds or updates a version in the registry.
 */
export async function saveVersion(
  type: 'k8s' | 'vcluster',
  item: VersionItem
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  const list = type === 'k8s' ? [...registry.kubernetesVersions] : [...registry.vclusterVersions];
  const targetVer = item.version.trim();

  if (!targetVer) {
    throw new Error('Version identifier cannot be empty');
  }

  // If item is set as default, unset existing default
  if (item.isDefault) {
    for (const v of list) {
      v.isDefault = false;
      if (v.tag === 'default') v.tag = 'stable';
    }
  }

  const existingIdx = list.findIndex(v => v.version === targetVer);
  const normalizedItem: VersionItem = {
    ...item,
    version: targetVer,
    label: item.label?.trim() || targetVer,
    tag: item.isDefault ? 'default' : (item.tag || 'stable'),
  };

  if (existingIdx >= 0) {
    list[existingIdx] = normalizedItem;
  } else {
    list.push(normalizedItem);
  }

  // Ensure at least one default exists
  if (!list.some(v => v.isDefault) && list.length > 0) {
    list[0].isDefault = true;
    list[0].tag = 'default';
  }

  if (type === 'k8s') {
    registry.kubernetesVersions = list;
  } else {
    registry.vclusterVersions = list;
  }

  await saveEntireRegistryToK8s(registry);
  return registry;
}

/**
 * Deletes a version from the registry.
 */
export async function deleteVersion(
  type: 'k8s' | 'vcluster',
  version: string
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  const list = type === 'k8s' ? [...registry.kubernetesVersions] : [...registry.vclusterVersions];

  if (list.length <= 1) {
    throw new Error(`Cannot delete version "${version}". At least one ${type === 'k8s' ? 'Kubernetes' : 'vCluster'} version must remain in the registry.`);
  }

  const targetIdx = list.findIndex(v => v.version === version);
  if (targetIdx === -1) {
    throw new Error(`Version "${version}" not found in ${type === 'k8s' ? 'Kubernetes' : 'vCluster'} registry.`);
  }

  const wasDefault = list[targetIdx].isDefault;
  list.splice(targetIdx, 1);

  // If we deleted the default, designate the first remaining as default
  if (wasDefault && list.length > 0) {
    list[0].isDefault = true;
    list[0].tag = 'default';
  }

  if (type === 'k8s') {
    registry.kubernetesVersions = list;
  } else {
    registry.vclusterVersions = list;
  }

  await saveEntireRegistryToK8s(registry);
  return registry;
}

/**
 * Marks a specific version as the active default.
 */
export async function setDefaultVersion(
  type: 'k8s' | 'vcluster',
  version: string
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  const list = type === 'k8s' ? [...registry.kubernetesVersions] : [...registry.vclusterVersions];

  const target = list.find(v => v.version === version);
  if (!target) {
    throw new Error(`Version "${version}" not found`);
  }

  for (const v of list) {
    if (v.version === version) {
      v.isDefault = true;
      v.tag = 'default';
    } else {
      v.isDefault = false;
      if (v.tag === 'default') v.tag = 'stable';
    }
  }

  if (type === 'k8s') {
    registry.kubernetesVersions = list;
  } else {
    registry.vclusterVersions = list;
  }

  await saveEntireRegistryToK8s(registry);
  return registry;
}

/**
 * Helper to fetch currently active defaults.
 */
export async function getDefaultVersions(): Promise<{
  kubernetesVersion: string;
  vclusterVersion: string;
}> {
  try {
    const registry = await getVersionRegistry();
    const defaultK8s = registry.kubernetesVersions.find(v => v.isDefault)?.version || registry.kubernetesVersions[0]?.version || 'v1.31.0';
    const defaultEngine = registry.vclusterVersions.find(v => v.isDefault)?.version || registry.vclusterVersions[0]?.version || '0.36.0';
    return { kubernetesVersion: defaultK8s, vclusterVersion: defaultEngine };
  } catch {
    return { kubernetesVersion: 'v1.31.0', vclusterVersion: '0.36.0' };
  }
}
