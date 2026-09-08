import type { ClusterBaseline } from './types';
import { k8sRequest } from './k8s-client';

const BASELINES_CONFIGMAP_NAME = 'vcop-cluster-baselines';
const BASELINES_NAMESPACE = process.env.VCOP_NAMESPACE || 'vcop-system';

export const DEFAULT_BASELINES: ClusterBaseline[] = [
  {
    id: 'dev-sandbox',
    name: 'Developer Sandbox',
    description: 'Lightweight 2 vCPU / 4GB RAM environment with automated wildcard Ingress and idle auto-sleep. Ideal for non-technical users and rapid prototyping.',
    badge: 'Quick Launch',
    isDefault: true,
    baseDomain: 'test.example.com',
    preset: 'normal',
    environment: 'development',
    kubernetesVersion: 'v1.31.0',
    vclusterVersion: '0.36.0',
    enableMonitoringAndDNS: true,
    autoSleep: true,
    ttlHours: 0,
    istio: {
      enabled: true,
      meshEnabled: false,
      certificateIssuer: 'letsencrypt-staging',
      certificateIssuerKind: 'ClusterIssuer',
      serviceType: 'ClusterIP',
    },
    disasterRecovery: {
      enabled: true,
      schedule: 'daily',
      retentionCount: 3,
    },
    policies: {
      resourceQuota: {
        requestsCPU: '2',
        limitsCPU: '4',
        requestsMemory: '4Gi',
        limitsMemory: '8Gi',
        requestsStorage: '10Gi',
        pods: '20',
        services: '10',
        persistentVolumeClaims: '5',
      },
    },
    createdAt: '2026-09-08T12:00:00.000Z',
    updatedAt: '2026-09-08T12:00:00.000Z',
    updatedBy: 'System Default',
  },
  {
    id: 'production-ha',
    name: 'Production High-Availability',
    description: 'Mission-critical tier with 6 vCPU / 12GB RAM, 3-node etcd quorum, automated daily snapshots, and zero single points of failure.',
    badge: 'Mission Critical',
    isDefault: false,
    baseDomain: 'test.example.com',
    preset: 'ha',
    environment: 'production',
    kubernetesVersion: 'v1.31.0',
    vclusterVersion: '0.36.0',
    enableMonitoringAndDNS: true,
    autoSleep: false,
    ttlHours: 0,
    istio: {
      enabled: true,
      meshEnabled: true,
      certificateIssuer: 'letsencrypt-prod',
      certificateIssuerKind: 'ClusterIssuer',
      serviceType: 'LoadBalancer',
    },
    disasterRecovery: {
      enabled: true,
      schedule: 'daily',
      retentionCount: 14,
    },
    policies: {
      resourceQuota: {
        requestsCPU: '6',
        limitsCPU: '12',
        requestsMemory: '12Gi',
        limitsMemory: '24Gi',
        requestsStorage: '50Gi',
        pods: '50',
        services: '25',
        persistentVolumeClaims: '15',
      },
    },
    createdAt: '2026-09-08T12:00:00.000Z',
    updatedAt: '2026-09-08T12:00:00.000Z',
    updatedBy: 'System Default',
  },
  {
    id: 'qa-staging',
    name: 'QA & Integration Staging',
    description: 'Pre-configured 4 vCPU / 8GB RAM staging tier with automated ingress wildcard routing for team testing and continuous integration.',
    badge: 'Staging',
    isDefault: false,
    baseDomain: 'test.example.com',
    preset: 'normal',
    environment: 'staging',
    kubernetesVersion: 'v1.31.0',
    vclusterVersion: '0.36.0',
    enableMonitoringAndDNS: true,
    autoSleep: false,
    ttlHours: 0,
    istio: {
      enabled: true,
      meshEnabled: false,
      certificateIssuer: 'letsencrypt-staging',
      certificateIssuerKind: 'ClusterIssuer',
      serviceType: 'ClusterIP',
    },
    disasterRecovery: {
      enabled: true,
      schedule: 'daily',
      retentionCount: 7,
    },
    policies: {
      resourceQuota: {
        requestsCPU: '4',
        limitsCPU: '8',
        requestsMemory: '8Gi',
        limitsMemory: '16Gi',
        requestsStorage: '25Gi',
        pods: '30',
        services: '15',
        persistentVolumeClaims: '10',
      },
    },
    createdAt: '2026-09-08T12:00:00.000Z',
    updatedAt: '2026-09-08T12:00:00.000Z',
    updatedBy: 'System Default',
  },
];

let memoryBaselinesCache: ClusterBaseline[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 4000;

export { computeClusterFqdn } from './baseline-utils';


/**
 * Retrieves all cluster baselines from the Kubernetes ConfigMap, falling back
 * to defaults and persisting if uninitialized.
 */
export async function getClusterBaselines(): Promise<ClusterBaseline[]> {
  const now = Date.now();
  if (memoryBaselinesCache && now - lastFetchTime < CACHE_TTL_MS) {
    return memoryBaselinesCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${BASELINES_NAMESPACE}/configmaps/${BASELINES_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['baselines.json']) {
      const parsed = JSON.parse(res.data.data['baselines.json']) as ClusterBaseline[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryBaselinesCache = parsed;
        lastFetchTime = now;
        return parsed;
      }
    }
  } catch (err) {
    // ConfigMap not created yet or unreachable
  }

  // Persist default baselines to Kubernetes ConfigMap
  try {
    await saveEntireBaselinesToK8s(DEFAULT_BASELINES);
    memoryBaselinesCache = DEFAULT_BASELINES;
    lastFetchTime = now;
    return DEFAULT_BASELINES;
  } catch (e) {
    console.warn('Could not persist Cluster Baselines ConfigMap, using memory default:', e);
    memoryBaselinesCache = DEFAULT_BASELINES;
    return DEFAULT_BASELINES;
  }
}

/**
 * Retrieves a single baseline by its unique ID.
 */
export async function getClusterBaselineById(id: string): Promise<ClusterBaseline | null> {
  const baselines = await getClusterBaselines();
  return baselines.find((b) => b.id === id) || null;
}

/**
 * Retrieves the active default baseline for 1-click deployments.
 */
export async function getDefaultClusterBaseline(): Promise<ClusterBaseline> {
  const baselines = await getClusterBaselines();
  return baselines.find((b) => b.isDefault) || baselines[0] || DEFAULT_BASELINES[0];
}

/**
 * Saves or updates a cluster baseline in the Kubernetes ConfigMap.
 */
export async function saveClusterBaseline(
  baseline: Partial<ClusterBaseline> & { id: string; name: string },
  user?: string
): Promise<ClusterBaseline[]> {
  const current = await getClusterBaselines();
  const now = new Date().toISOString();

  const id = baseline.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const isDefault = Boolean(baseline.isDefault);

  const existingIndex = current.findIndex((b) => b.id === id);

  let updatedList: ClusterBaseline[];

  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    const updated: ClusterBaseline = {
      ...existing,
      ...baseline,
      id,
      isDefault,
      baseDomain: (baseline.baseDomain || existing.baseDomain || 'test.example.com').trim(),
      updatedAt: now,
      updatedBy: user || 'admin',
    };

    updatedList = [...current];
    updatedList[existingIndex] = updated;
  } else {
    const newBaseline: ClusterBaseline = {
      id,
      name: baseline.name.trim(),
      description: baseline.description || 'Predefined cluster baseline configuration.',
      badge: baseline.badge || 'Standard',
      isDefault,
      baseDomain: (baseline.baseDomain || 'test.example.com').trim(),
      preset: baseline.preset || 'normal',
      environment: baseline.environment || 'development',
      kubernetesVersion: baseline.kubernetesVersion || 'v1.31.0',
      vclusterVersion: baseline.vclusterVersion || '0.36.0',
      enableMonitoringAndDNS: baseline.enableMonitoringAndDNS ?? true,
      autoSleep: baseline.autoSleep ?? false,
      ttlHours: baseline.ttlHours ?? 0,
      istio: baseline.istio || {
        enabled: true,
        meshEnabled: false,
        certificateIssuer: 'letsencrypt-staging',
        certificateIssuerKind: 'ClusterIssuer',
        serviceType: 'ClusterIP',
      },
      disasterRecovery: baseline.disasterRecovery || {
        enabled: true,
        schedule: 'daily',
        retentionCount: 7,
      },
      policies: baseline.policies,
      clusterGroup: baseline.clusterGroup,
      installedAppIds: baseline.installedAppIds,
      createdAt: now,
      updatedAt: now,
      updatedBy: user || 'admin',
    };

    updatedList = [...current, newBaseline];
  }

  // If this baseline is marked default, unset default on others
  if (isDefault) {
    updatedList = updatedList.map((b) => ({
      ...b,
      isDefault: b.id === id,
    }));
  } else if (!updatedList.some((b) => b.isDefault)) {
    // Ensure at least one baseline is marked default
    updatedList[0].isDefault = true;
  }

  await saveEntireBaselinesToK8s(updatedList);
  memoryBaselinesCache = updatedList;
  lastFetchTime = Date.now();
  return updatedList;
}

/**
 * Sets a specific baseline as the active default.
 */
export async function setDefaultClusterBaseline(id: string): Promise<ClusterBaseline[]> {
  const current = await getClusterBaselines();
  const updatedList = current.map((b) => ({
    ...b,
    isDefault: b.id === id,
    updatedAt: b.id === id ? new Date().toISOString() : b.updatedAt,
  }));

  await saveEntireBaselinesToK8s(updatedList);
  memoryBaselinesCache = updatedList;
  lastFetchTime = Date.now();
  return updatedList;
}

/**
 * Deletes a baseline by its ID.
 */
export async function deleteClusterBaseline(id: string): Promise<ClusterBaseline[]> {
  const current = await getClusterBaselines();
  if (current.length <= 1) {
    throw new Error('Cannot delete the last remaining cluster baseline.');
  }

  const target = current.find((b) => b.id === id);
  if (!target) {
    throw new Error(`Cluster baseline '${id}' not found.`);
  }

  let updatedList = current.filter((b) => b.id !== id);

  // If the deleted baseline was default, assign the first one as default
  if (target.isDefault && updatedList.length > 0) {
    updatedList[0].isDefault = true;
  }

  await saveEntireBaselinesToK8s(updatedList);
  memoryBaselinesCache = updatedList;
  lastFetchTime = Date.now();
  return updatedList;
}

/**
 * Persists the entire list of cluster baselines to the Kubernetes ConfigMap.
 */
async function saveEntireBaselinesToK8s(baselines: ClusterBaseline[]): Promise<void> {
  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: BASELINES_CONFIGMAP_NAME,
      namespace: BASELINES_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-cluster-baselines',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'baselines.json': JSON.stringify(baselines, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${BASELINES_NAMESPACE}/configmaps/${BASELINES_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${BASELINES_NAMESPACE}/configmaps/${BASELINES_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${BASELINES_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }
}
