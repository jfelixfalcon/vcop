import type { VersionItem, VersionRegistry, VersionTag } from './types';
import { k8sRequest } from './k8s-client';
import YAML from 'yaml';

const REGISTRY_CONFIGMAP_NAME = 'vcop-version-registry';
const REGISTRY_NAMESPACE = 'vcop-system';

export const DEFAULT_VERSION_REGISTRY: VersionRegistry = {
  updatedAt: new Date().toISOString(),
  kubernetesVersions: [],
  vclusterVersions: [],
  etcdVersions: [],
  coreDNSVersions: [],
  metricsServerVersions: [],
  istioVersions: [],
  imagePatterns: {},
};

let memoryRegistryCache: VersionRegistry | null = null;
let lastFetchTime = 0;

export type VersionCategory = 'k8s' | 'vcluster' | 'etcd' | 'coredns' | 'metricsServer' | 'istio';

function getListForCategory(registry: VersionRegistry, type: VersionCategory): VersionItem[] {
  switch (type) {
    case 'k8s': return registry.kubernetesVersions;
    case 'vcluster': return registry.vclusterVersions;
    case 'etcd': return registry.etcdVersions || [];
    case 'coredns': return registry.coreDNSVersions || [];
    case 'metricsServer': return registry.metricsServerVersions || [];
    case 'istio': return registry.istioVersions || [];
    default: return registry.kubernetesVersions;
  }
}

function setListForCategory(registry: VersionRegistry, type: VersionCategory, list: VersionItem[]): void {
  switch (type) {
    case 'k8s': registry.kubernetesVersions = list; break;
    case 'vcluster': registry.vclusterVersions = list; break;
    case 'etcd': registry.etcdVersions = list; break;
    case 'coredns': registry.coreDNSVersions = list; break;
    case 'metricsServer': registry.metricsServerVersions = list; break;
    case 'istio': registry.istioVersions = list; break;
  }
}

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
      if (!Array.isArray(parsed.kubernetesVersions)) parsed.kubernetesVersions = [];
      if (!Array.isArray(parsed.vclusterVersions)) parsed.vclusterVersions = [];
      if (!Array.isArray(parsed.etcdVersions)) parsed.etcdVersions = [];
      if (!Array.isArray(parsed.coreDNSVersions)) parsed.coreDNSVersions = [];
      if (!Array.isArray(parsed.metricsServerVersions)) parsed.metricsServerVersions = [];
      if (!Array.isArray(parsed.istioVersions)) parsed.istioVersions = [];
      if (!parsed.imagePatterns || typeof parsed.imagePatterns !== 'object') parsed.imagePatterns = {};
      memoryRegistryCache = parsed;
      lastFetchTime = now;
      return parsed;
    }
  } catch (err) {
    // ConfigMap not created yet
  }

  // If not found, persist empty default registry to Kubernetes ConfigMap
  try {
    await saveEntireRegistry(DEFAULT_VERSION_REGISTRY);
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
export async function saveEntireRegistry(registry: VersionRegistry): Promise<void> {
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
 * Checks if any of the major core components (Kubernetes, vCluster Engine, etcd)
 * are missing versions in the registry.
 */
export function getMissingCoreComponents(registry?: VersionRegistry | null): string[] {
  const missing: string[] = [];
  if (!registry?.kubernetesVersions || registry.kubernetesVersions.length === 0) {
    missing.push('Kubernetes');
  }
  if (!registry?.vclusterVersions || registry.vclusterVersions.length === 0) {
    missing.push('vCluster Engine');
  }
  if (!registry?.etcdVersions || registry.etcdVersions.length === 0) {
    missing.push('etcd');
  }
  return missing;
}

/**
 * Clears the Version Registry completely so that all categories are empty.
 */
/**
 * Clears the Version Registry completely so that all categories are empty.
 */
export async function clearVersionRegistry(): Promise<VersionRegistry> {
  const empty: VersionRegistry = {
    updatedAt: new Date().toISOString(),
    kubernetesVersions: [],
    vclusterVersions: [],
    etcdVersions: [],
    coreDNSVersions: [],
    metricsServerVersions: [],
    istioVersions: [],
    imagePatterns: {},
  };
  await saveEntireRegistry(empty);
  return empty;
}

/**
 * Parses and imports a Version Registry manifest (YAML or JSON) and saves it.
 */
export async function importVersionRegistry(input: string | any): Promise<VersionRegistry> {
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

  // Handle multi-doc YAML array or single object
  if (Array.isArray(data) && data.length > 0) {
    const cmDoc = data.find((d: any) => d?.metadata?.name === REGISTRY_CONFIGMAP_NAME);
    if (cmDoc) data = cmDoc;
  }

  // If standard Kubernetes ConfigMap format
  if (data?.kind === 'ConfigMap' && data.data?.['versions.json']) {
    try {
      data = JSON.parse(data.data['versions.json']);
    } catch {
      data = YAML.parse(data.data['versions.json']);
    }
  } else if (data?.versionRegistry) {
    data = data.versionRegistry;
  } else if (data?.versions) {
    data = data.versions;
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid version registry manifest format.');
  }

  const normalizeList = (items: any): VersionItem[] => {
    if (!Array.isArray(items)) return [];
    return items
      .map((item: any) => {
        const version = String(item.version || item.name || '').trim();
        return {
          version,
          label: String(item.label || version).trim(),
          tag: (item.tag as VersionTag) || (item.isDefault ? 'default' : 'stable'),
          isDefault: Boolean(item.isDefault),
          notes: item.notes ? String(item.notes).trim() : undefined,
          image: item.image ? String(item.image).trim() : undefined,
        };
      })
      .filter((v) => Boolean(v.version));
  };

  const normalizeImagePatterns = (raw: any): Record<string, string> => {
    if (!raw || typeof raw !== 'object') return {};
    const patterns: Record<string, string> = {};
    if (raw.k8s || raw.kubernetes || raw['kube-apiserver']) {
      patterns.k8s = String(raw.k8s || raw.kubernetes || raw['kube-apiserver']).trim();
    }
    if (raw.vcluster || raw.engine || raw.syncer) {
      patterns.vcluster = String(raw.vcluster || raw.engine || raw.syncer).trim();
    }
    if (raw.etcd || raw.backingStore) {
      patterns.etcd = String(raw.etcd || raw.backingStore).trim();
    }
    if (raw.coreDNS || raw.coredns || raw.dns) {
      patterns.coredns = String(raw.coreDNS || raw.coredns || raw.dns).trim();
    }
    if (raw.metricsServer || raw.metrics) {
      patterns.metricsServer = String(raw.metricsServer || raw.metrics).trim();
    }
    if (raw.istio || raw.mesh) {
      patterns.istio = String(raw.istio || raw.mesh).trim();
    }
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && !patterns[k]) {
        patterns[k] = v.trim();
      }
    }
    return patterns;
  };

  const current = await getVersionRegistry();
  const rawPatterns = data.imagePatterns || data.containerImagePatterns || data.patterns;

  const newRegistry: VersionRegistry = {
    updatedAt: new Date().toISOString(),
    kubernetesVersions: data.kubernetesVersions !== undefined ? normalizeList(data.kubernetesVersions) : current.kubernetesVersions,
    vclusterVersions: data.vclusterVersions !== undefined ? normalizeList(data.vclusterVersions) : current.vclusterVersions,
    etcdVersions: data.etcdVersions !== undefined ? normalizeList(data.etcdVersions) : current.etcdVersions,
    coreDNSVersions: data.coreDNSVersions !== undefined ? normalizeList(data.coreDNSVersions) : current.coreDNSVersions,
    metricsServerVersions: data.metricsServerVersions !== undefined ? normalizeList(data.metricsServerVersions) : current.metricsServerVersions,
    istioVersions: data.istioVersions !== undefined ? normalizeList(data.istioVersions) : current.istioVersions,
    imagePatterns: rawPatterns !== undefined ? normalizeImagePatterns(rawPatterns) : (current.imagePatterns || {}),
  };

  // Ensure default version is set for each non-empty category
  const categories: VersionCategory[] = ['k8s', 'vcluster', 'etcd', 'coredns', 'metricsServer', 'istio'];
  for (const cat of categories) {
    const list = getListForCategory(newRegistry, cat);
    if (list.length > 0 && !list.some((v) => v.isDefault)) {
      list[0].isDefault = true;
      list[0].tag = 'default';
    }
  }

  await saveEntireRegistry(newRegistry);
  return newRegistry;
}

/**
 * Saves or updates a category container image pattern.
 */
export async function saveImagePattern(
  type: VersionCategory,
  pattern: string
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  if (!registry.imagePatterns) registry.imagePatterns = {};
  if (pattern.trim()) {
    registry.imagePatterns[type] = pattern.trim();
  } else {
    delete registry.imagePatterns[type];
  }
  await saveEntireRegistry(registry);
  return registry;
}

/**
 * Adds or updates a version in the registry.
 */
export async function saveVersion(
  type: VersionCategory,
  item: VersionItem
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  const list = [...getListForCategory(registry, type)];
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
    image: item.image?.trim() || undefined,
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

  setListForCategory(registry, type, list);
  await saveEntireRegistry(registry);
  return registry;
}

/**
 * Deletes a version from the registry.
 */
export async function deleteVersion(
  type: VersionCategory,
  version: string
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  const list = [...getListForCategory(registry, type)];

  const targetIdx = list.findIndex(v => v.version === version);
  if (targetIdx === -1) {
    throw new Error(`Version "${version}" not found in registry.`);
  }

  const wasDefault = list[targetIdx].isDefault;
  list.splice(targetIdx, 1);

  // If we deleted the default, designate the first remaining as default
  if (wasDefault && list.length > 0) {
    list[0].isDefault = true;
    list[0].tag = 'default';
  }

  setListForCategory(registry, type, list);
  await saveEntireRegistry(registry);
  return registry;
}

/**
 * Marks a specific version as the active default.
 */
export async function setDefaultVersion(
  type: VersionCategory,
  version: string
): Promise<VersionRegistry> {
  const registry = await getVersionRegistry();
  const list = [...getListForCategory(registry, type)];

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

  setListForCategory(registry, type, list);
  await saveEntireRegistry(registry);
  return registry;
}

/**
 * Helper to fetch currently active defaults.
 * Returns empty strings if no version exists in registry.
 */
export async function getDefaultVersions(): Promise<{
  kubernetesVersion: string;
  vclusterVersion: string;
  etcdVersion: string;
  coreDNSVersion: string;
  metricsServerVersion: string;
  istioVersion: string;
}> {
  try {
    const registry = await getVersionRegistry();
    const defaultK8s = registry.kubernetesVersions.find(v => v.isDefault)?.version || registry.kubernetesVersions[0]?.version || '';
    const defaultEngine = registry.vclusterVersions.find(v => v.isDefault)?.version || registry.vclusterVersions[0]?.version || '';
    const defaultEtcd = registry.etcdVersions?.find(v => v.isDefault)?.version || registry.etcdVersions?.[0]?.version || '';
    const defaultCoreDNS = registry.coreDNSVersions?.find(v => v.isDefault)?.version || registry.coreDNSVersions?.[0]?.version || '';
    const defaultMetrics = registry.metricsServerVersions?.find(v => v.isDefault)?.version || registry.metricsServerVersions?.[0]?.version || '';
    const defaultIstio = registry.istioVersions?.find(v => v.isDefault)?.version || registry.istioVersions?.[0]?.version || '';
    return {
      kubernetesVersion: defaultK8s,
      vclusterVersion: defaultEngine,
      etcdVersion: defaultEtcd,
      coreDNSVersion: defaultCoreDNS,
      metricsServerVersion: defaultMetrics,
      istioVersion: defaultIstio,
    };
  } catch {
    return {
      kubernetesVersion: '',
      vclusterVersion: '',
      etcdVersion: '',
      coreDNSVersion: '',
      metricsServerVersion: '',
      istioVersion: '',
    };
  }
}
