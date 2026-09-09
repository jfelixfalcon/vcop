import type { PresetDetails, SizePreset } from './types';
import { k8sRequest } from './k8s-client';
import { DEFAULT_SIZING_TIERS } from './presets';

const SIZING_TIERS_CONFIGMAP_NAME = 'vcop-sizing-tiers';
const SIZING_TIERS_NAMESPACE = process.env.VCOP_NAMESPACE || 'vcop-system';

export { DEFAULT_SIZING_TIERS };

let memoryTiersCache: PresetDetails[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 4000;

/**
 * Retrieves all sizing tiers from the Kubernetes ConfigMap, falling back
 * to defaults and persisting if uninitialized.
 */
export async function getSizingTiers(): Promise<PresetDetails[]> {
  const now = Date.now();
  if (memoryTiersCache && now - lastFetchTime < CACHE_TTL_MS) {
    return memoryTiersCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${SIZING_TIERS_NAMESPACE}/configmaps/${SIZING_TIERS_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['sizing-tiers.json']) {
      const parsed = JSON.parse(res.data.data['sizing-tiers.json']) as PresetDetails[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryTiersCache = parsed;
        lastFetchTime = now;
        return parsed;
      }
    }
  } catch {
    // ConfigMap not created yet or unreachable
  }

  // Persist default sizing tiers to Kubernetes ConfigMap
  try {
    await saveEntireSizingTiersToK8s(DEFAULT_SIZING_TIERS);
    memoryTiersCache = DEFAULT_SIZING_TIERS;
    lastFetchTime = now;
    return DEFAULT_SIZING_TIERS;
  } catch (e) {
    console.warn('Could not persist Sizing Tiers ConfigMap, using memory default:', e);
    memoryTiersCache = DEFAULT_SIZING_TIERS;
    return DEFAULT_SIZING_TIERS;
  }
}

/**
 * Retrieves a single sizing tier by ID.
 */
export async function getSizingTierById(id: string): Promise<PresetDetails | null> {
  const tiers = await getSizingTiers();
  return tiers.find((t) => t.id === id) || null;
}

/**
 * Saves or updates a sizing tier in the Kubernetes ConfigMap.
 */
export async function saveSizingTier(
  tier: Partial<PresetDetails> & { id: string; name: string },
  user?: string
): Promise<PresetDetails[]> {
  const current = await getSizingTiers();
  const now = new Date().toISOString();

  const id = tier.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const isDefault = Boolean(tier.isDefault);

  const existingIndex = current.findIndex((t) => t.id === id);

  let updatedList: PresetDetails[];

  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    const updated: PresetDetails = {
      ...existing,
      ...tier,
      id,
      name: tier.name.trim(),
      cpu: tier.cpu || existing.cpu || '2 vCPU',
      memory: tier.memory || existing.memory || '4 GB RAM',
      storage: tier.storage || existing.storage || '10 GB NVMe',
      ha: tier.ha ?? existing.ha ?? false,
      badge: tier.badge !== undefined ? tier.badge.trim() : existing.badge,
      description: tier.description !== undefined ? tier.description.trim() : existing.description,
      isDefault,
      requestsCPU: tier.requestsCPU || existing.requestsCPU,
      limitsCPU: tier.limitsCPU || existing.limitsCPU,
      requestsMemory: tier.requestsMemory || existing.requestsMemory,
      limitsMemory: tier.limitsMemory || existing.limitsMemory,
      requestsStorage: tier.requestsStorage || existing.requestsStorage,
      pods: tier.pods || existing.pods,
      services: tier.services || existing.services,
      persistentVolumeClaims: tier.persistentVolumeClaims || existing.persistentVolumeClaims,
      updatedAt: now,
      updatedBy: user || 'admin',
    };

    updatedList = [...current];
    updatedList[existingIndex] = updated;
  } else {
    const newTier: PresetDetails = {
      id,
      name: tier.name.trim(),
      cpu: tier.cpu || '2 vCPU',
      memory: tier.memory || '4 GB RAM',
      storage: tier.storage || '10 GB NVMe',
      ha: tier.ha ?? false,
      badge: tier.badge?.trim() || 'Custom',
      description: tier.description?.trim() || 'Custom hardware allocation preset.',
      isDefault,
      requestsCPU: tier.requestsCPU || '1',
      limitsCPU: tier.limitsCPU || '2',
      requestsMemory: tier.requestsMemory || '2Gi',
      limitsMemory: tier.limitsMemory || '4Gi',
      requestsStorage: tier.requestsStorage || '10Gi',
      pods: tier.pods || '20',
      services: tier.services || '10',
      persistentVolumeClaims: tier.persistentVolumeClaims || '5',
      createdAt: now,
      updatedAt: now,
      updatedBy: user || 'admin',
    };

    updatedList = [...current, newTier];
  }

  // If this tier is marked default, unset default on others
  if (isDefault) {
    updatedList = updatedList.map((t) => ({
      ...t,
      isDefault: t.id === id,
    }));
  } else if (!updatedList.some((t) => t.isDefault)) {
    updatedList[0].isDefault = true;
  }

  await saveEntireSizingTiersToK8s(updatedList);
  memoryTiersCache = updatedList;
  lastFetchTime = Date.now();
  return updatedList;
}

/**
 * Sets a specific sizing tier as default.
 */
export async function setDefaultSizingTier(id: string): Promise<PresetDetails[]> {
  const current = await getSizingTiers();
  const updatedList = current.map((t) => ({
    ...t,
    isDefault: t.id === id,
    updatedAt: t.id === id ? new Date().toISOString() : t.updatedAt,
  }));

  await saveEntireSizingTiersToK8s(updatedList);
  memoryTiersCache = updatedList;
  lastFetchTime = Date.now();
  return updatedList;
}

/**
 * Deletes a sizing tier by ID.
 */
export async function deleteSizingTier(id: string): Promise<PresetDetails[]> {
  const current = await getSizingTiers();
  if (current.length <= 1) {
    throw new Error('Cannot delete the last remaining sizing tier.');
  }

  const target = current.find((t) => t.id === id);
  if (!target) {
    throw new Error(`Sizing tier '${id}' not found.`);
  }

  let updatedList = current.filter((t) => t.id !== id);

  if (target.isDefault && updatedList.length > 0) {
    updatedList[0].isDefault = true;
  }

  await saveEntireSizingTiersToK8s(updatedList);
  memoryTiersCache = updatedList;
  lastFetchTime = Date.now();
  return updatedList;
}

/**
 * Persists the entire list of sizing tiers to the Kubernetes ConfigMap.
 */
export async function saveEntireSizingTiersToK8s(tiers: PresetDetails[]): Promise<void> {
  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: SIZING_TIERS_CONFIGMAP_NAME,
      namespace: SIZING_TIERS_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-sizing-tiers',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'sizing-tiers.json': JSON.stringify(tiers, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${SIZING_TIERS_NAMESPACE}/configmaps/${SIZING_TIERS_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${SIZING_TIERS_NAMESPACE}/configmaps/${SIZING_TIERS_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${SIZING_TIERS_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }
}
