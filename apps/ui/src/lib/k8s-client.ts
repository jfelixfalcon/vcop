import type { VirtualCluster, SizePreset, PresetDetails } from './types';

// In-memory store for development/standalone demonstration mode
const mockClusters: Map<string, VirtualCluster> = new Map();

// Initialize initial fleet data for rich demonstration out of the box
function initMockData() {
  if (mockClusters.size > 0) return;

  const initial: VirtualCluster[] = [
    {
      name: 'payments-prod',
      namespace: 'default',
      spec: {
        clusterName: 'payments-prod',
        vclusterVersion: '0.37.0',
        kubernetesVersion: 'v1.31.0',
        sizePreset: 'large',
        highAvailability: true,
        components: {
          coreDNS: { enabled: true },
          metricsServer: { enabled: true },
        },
        sync: { pods: true, services: true, ingresses: true },
        lifecycle: { autoSleep: false, ttlHours: 0 },
      },
      status: {
        phase: 'Ready',
        conditions: [
          { type: 'EtcdReady', status: 'True', reason: 'EtcdQuorumReady', message: '3-node HA quorum verified', lastTransitionTime: new Date(Date.now() - 3600000 * 24).toISOString() },
          { type: 'ControlPlaneReady', status: 'True', reason: 'ControlPlaneReady', message: 'vCluster syncer and API server ready', lastTransitionTime: new Date(Date.now() - 3600000 * 24).toISOString() },
          { type: 'AddonsReady', status: 'True', reason: 'AddonsConfigured', message: 'CoreDNS & Metrics-Server active', lastTransitionTime: new Date(Date.now() - 3600000 * 24).toISOString() },
          { type: 'KubeconfigGenerated', status: 'True', reason: 'KubeconfigReady', message: 'Host secret generated', lastTransitionTime: new Date(Date.now() - 3600000 * 24).toISOString() },
        ],
        virtualK8sVersion: 'v1.31.0',
        vclusterVersion: '0.37.0',
        endpoint: 'https://payments-prod-service.default.svc.cluster.local:443',
        metrics: {
          activeNodeCount: 3,
          podCount: 14,
          memoryUsage: '6.2Gi / 16Gi',
          cpuUsage: '3100m / 8000m',
          cpuPercent: 38,
          memPercent: 39,
        },
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      },
      metadata: {
        owner: 'Fintech Core Team',
        environment: 'production',
        tags: ['pci-dss', 'ha-quorum', 'payments'],
      },
      sparklineData: {
        cpu: [28, 32, 45, 41, 38, 52, 48, 38],
        memory: [35, 36, 38, 38, 40, 41, 39, 39],
      },
    },
    {
      name: 'analytics-staging',
      namespace: 'default',
      spec: {
        clusterName: 'analytics-staging',
        vclusterVersion: '0.37.0',
        kubernetesVersion: 'v1.30.0',
        sizePreset: 'medium',
        highAvailability: true,
        components: {
          coreDNS: { enabled: true },
          metricsServer: { enabled: true },
        },
        sync: { pods: true, services: true, ingresses: true },
        lifecycle: { autoSleep: true, ttlHours: 168 },
      },
      status: {
        phase: 'Ready',
        conditions: [
          { type: 'EtcdReady', status: 'True', reason: 'EtcdQuorumReady', message: '3-node HA quorum verified', lastTransitionTime: new Date(Date.now() - 3600000 * 12).toISOString() },
          { type: 'ControlPlaneReady', status: 'True', reason: 'ControlPlaneReady', message: 'vCluster syncer ready', lastTransitionTime: new Date(Date.now() - 3600000 * 12).toISOString() },
          { type: 'AddonsReady', status: 'True', reason: 'AddonsConfigured', message: 'CoreDNS & Metrics-Server active', lastTransitionTime: new Date(Date.now() - 3600000 * 12).toISOString() },
          { type: 'KubeconfigGenerated', status: 'True', reason: 'KubeconfigReady', message: 'Secret generated', lastTransitionTime: new Date(Date.now() - 3600000 * 12).toISOString() },
        ],
        virtualK8sVersion: 'v1.30.0',
        vclusterVersion: '0.37.0',
        endpoint: 'https://analytics-staging-service.default.svc.cluster.local:443',
        metrics: {
          activeNodeCount: 2,
          podCount: 6,
          memoryUsage: '3.1Gi / 8Gi',
          cpuUsage: '1450m / 4000m',
          cpuPercent: 36,
          memPercent: 38,
        },
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      metadata: {
        owner: 'Data Platform',
        environment: 'staging',
        tags: ['spark', 'staging', 'upgrade-candidate'],
      },
      sparklineData: {
        cpu: [15, 22, 35, 60, 48, 30, 25, 36],
        memory: [30, 32, 35, 38, 38, 38, 37, 38],
      },
    },
    {
      name: 'dev-pr-4029',
      namespace: 'default',
      spec: {
        clusterName: 'dev-pr-4029',
        vclusterVersion: '0.37.0',
        kubernetesVersion: 'v1.31.0',
        sizePreset: 'small',
        highAvailability: false,
        components: {
          coreDNS: { enabled: true },
          metricsServer: { enabled: true },
        },
        sync: { pods: true, services: true, ingresses: true },
        lifecycle: { autoSleep: true, ttlHours: 48 },
      },
      status: {
        phase: 'Ready',
        conditions: [
          { type: 'EtcdReady', status: 'True', reason: 'EtcdReady', message: 'Single node etcd ready', lastTransitionTime: new Date(Date.now() - 3600000 * 3).toISOString() },
          { type: 'ControlPlaneReady', status: 'True', reason: 'ControlPlaneReady', message: 'vCluster syncer ready', lastTransitionTime: new Date(Date.now() - 3600000 * 3).toISOString() },
          { type: 'AddonsReady', status: 'True', reason: 'AddonsConfigured', message: 'CoreDNS active', lastTransitionTime: new Date(Date.now() - 3600000 * 3).toISOString() },
          { type: 'KubeconfigGenerated', status: 'True', reason: 'KubeconfigReady', message: 'Secret generated', lastTransitionTime: new Date(Date.now() - 3600000 * 3).toISOString() },
        ],
        virtualK8sVersion: 'v1.31.0',
        vclusterVersion: '0.37.0',
        endpoint: 'https://dev-pr-4029-service.default.svc.cluster.local:443',
        metrics: {
          activeNodeCount: 1,
          podCount: 2,
          memoryUsage: '650Mi / 4Gi',
          cpuUsage: '120m / 2000m',
          cpuPercent: 6,
          memPercent: 16,
        },
        createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      },
      metadata: {
        owner: 'Sarah Lin (Frontend)',
        environment: 'development',
        tags: ['ephemeral', 'pr-preview', 'auto-sleep'],
      },
      sparklineData: {
        cpu: [5, 12, 8, 14, 10, 6, 8, 6],
        memory: [12, 14, 15, 15, 16, 16, 16, 16],
      },
    },
    {
      name: 'qa-auth-cluster',
      namespace: 'default',
      spec: {
        clusterName: 'qa-auth-cluster',
        vclusterVersion: '0.37.0',
        kubernetesVersion: 'v1.31.0',
        sizePreset: 'medium',
        highAvailability: true,
        components: {
          coreDNS: { enabled: true },
          metricsServer: { enabled: true },
        },
        sync: { pods: true, services: true, ingresses: true },
        lifecycle: { autoSleep: false, ttlHours: 72 },
      },
      status: {
        phase: 'Provisioning',
        conditions: [
          { type: 'EtcdReady', status: 'True', reason: 'EtcdQuorumReady', message: '3-node HA quorum verified', lastTransitionTime: new Date(Date.now() - 60000).toISOString() },
          { type: 'ControlPlaneReady', status: 'False', reason: 'SyncerStarting', message: 'Syncer container rolling out', lastTransitionTime: new Date(Date.now() - 30000).toISOString() },
          { type: 'AddonsReady', status: 'False', reason: 'WaitingForControlPlane', message: 'Awaiting syncer', lastTransitionTime: new Date().toISOString() },
          { type: 'KubeconfigGenerated', status: 'False', reason: 'Pending', message: 'Waiting for endpoint', lastTransitionTime: new Date().toISOString() },
        ],
        virtualK8sVersion: 'v1.31.0',
        vclusterVersion: '0.37.0',
        endpoint: 'https://qa-auth-cluster-service.default.svc.cluster.local:443',
        metrics: {
          activeNodeCount: 0,
          podCount: 0,
          memoryUsage: '0Mi',
          cpuUsage: '0m',
          cpuPercent: 0,
          memPercent: 0,
        },
        createdAt: new Date(Date.now() - 90000).toISOString(),
      },
      metadata: {
        owner: 'Security QA',
        environment: 'staging',
        tags: ['oauth2', 'keycloak', 'syncing'],
      },
      sparklineData: {
        cpu: [0, 0, 10, 15, 5, 2, 0, 0],
        memory: [0, 0, 5, 8, 10, 10, 10, 10],
      },
    },
  ];

  for (const c of initial) {
    mockClusters.set(c.name, c);
  }
}

initMockData();

export const PRESETS: PresetDetails[] = [
  {
    id: 'small',
    name: 'Sandbox Tier',
    cpu: '2 vCPU',
    memory: '4 GB RAM',
    storage: '5 GB NVMe',
    ha: false,
    badge: 'Ephemeral & Fast',
    description: 'Perfect for fast PR testing, microservice unit validation, and local developer exploration with auto-sleep.',
  },
  {
    id: 'medium',
    name: 'Standard Tier',
    cpu: '4 vCPU',
    memory: '8 GB RAM',
    storage: '10 GB NVMe',
    ha: true,
    badge: 'Recommended',
    description: 'Balanced 3-node HA quorum setup tailored for QA integration, CI/CD runners, and shared staging fleets.',
  },
  {
    id: 'large',
    name: 'Production HA Tier',
    cpu: '8 vCPU',
    memory: '16 GB RAM',
    storage: '25 GB NVMe',
    ha: true,
    badge: 'High Performance',
    description: 'Full production isolation with dedicated 3-node etcd backing store, maximum throughput, and SLA guarantees.',
  },
  {
    id: 'custom',
    name: 'Custom Tier',
    cpu: 'Customizable',
    memory: 'Customizable',
    storage: 'Customizable',
    ha: true,
    badge: 'Advanced',
    description: 'Define custom compute, memory, and volume limits for specialized workloads like machine learning inference.',
  },
];

export async function listVirtualClusters(): Promise<VirtualCluster[]> {
  return Array.from(mockClusters.values());
}

export async function getVirtualCluster(name: string): Promise<VirtualCluster | null> {
  return mockClusters.get(name) || null;
}

export async function createVirtualCluster(data: {
  clusterName: string;
  preset: SizePreset;
  owner?: string;
  environment?: 'development' | 'staging' | 'production';
  enableMonitoringAndDNS?: boolean;
  autoSleep?: boolean;
  ttlHours?: number;
  kubernetesVersion?: string;
  vclusterVersion?: string;
  customYaml?: string;
}): Promise<VirtualCluster> {
  const name = data.clusterName.trim().toLowerCase();
  const k8sVer = data.kubernetesVersion || 'v1.31.0';
  const vclusterVer = data.vclusterVersion || '0.37.0';
  const isHA = data.preset === 'large' || data.preset === 'medium';

  const newCluster: VirtualCluster = {
    name,
    namespace: 'default',
    spec: {
      clusterName: name,
      vclusterVersion: vclusterVer,
      kubernetesVersion: k8sVer,
      sizePreset: data.preset,
      highAvailability: isHA,
      components: {
        coreDNS: { enabled: data.enableMonitoringAndDNS ?? true },
        metricsServer: { enabled: data.enableMonitoringAndDNS ?? true },
      },
      sync: { pods: true, services: true, ingresses: true },
      lifecycle: {
        autoSleep: data.autoSleep ?? false,
        ttlHours: data.ttlHours ?? 0,
      },
      rawConfig: data.customYaml ? { raw: data.customYaml } : undefined,
    },
    status: {
      phase: 'Provisioning',
      conditions: [
        { type: 'EtcdReady', status: 'True', reason: 'EtcdQuorumReady', message: isHA ? '3-node HA quorum established' : 'Single-node etcd ready', lastTransitionTime: new Date().toISOString() },
        { type: 'ControlPlaneReady', status: 'False', reason: 'SyncerRollingOut', message: 'Provisioning syncer container and internal CoreDNS', lastTransitionTime: new Date().toISOString() },
        { type: 'AddonsReady', status: 'False', reason: 'Initializing', message: 'Configuring internal metrics-server', lastTransitionTime: new Date().toISOString() },
        { type: 'KubeconfigGenerated', status: 'False', reason: 'Pending', message: 'Awaiting API server endpoint', lastTransitionTime: new Date().toISOString() },
      ],
      virtualK8sVersion: k8sVer,
      vclusterVersion: vclusterVer,
      endpoint: `https://${name}-service.default.svc.cluster.local:443`,
      metrics: {
        activeNodeCount: 1,
        podCount: 1,
        memoryUsage: '350Mi',
        cpuUsage: '50m',
        cpuPercent: 8,
        memPercent: 12,
      },
      createdAt: new Date().toISOString(),
    },
    metadata: {
      owner: data.owner || 'Internal Platform User',
      environment: data.environment || 'development',
      tags: [data.preset, isHA ? 'ha-etcd' : 'single-node'],
    },
    sparklineData: {
      cpu: [0, 5, 8, 12, 10, 8, 6, 8],
      memory: [0, 4, 8, 10, 11, 12, 12, 12],
    },
  };

  mockClusters.set(name, newCluster);

  // Simulate operator reconciliation completing in background
  setTimeout(() => {
    const existing = mockClusters.get(name);
    if (existing && existing.status.phase === 'Provisioning') {
      existing.status.phase = 'Ready';
      existing.status.conditions = [
        { type: 'EtcdReady', status: 'True', reason: 'EtcdQuorumReady', message: 'HA etcd cluster is healthy with quorum', lastTransitionTime: new Date().toISOString() },
        { type: 'ControlPlaneReady', status: 'True', reason: 'ControlPlaneReady', message: 'vCluster control plane and syncer are ready', lastTransitionTime: new Date().toISOString() },
        { type: 'AddonsReady', status: 'True', reason: 'AddonsConfigured', message: 'CoreDNS and Metrics-Server active', lastTransitionTime: new Date().toISOString() },
        { type: 'KubeconfigGenerated', status: 'True', reason: 'KubeconfigReady', message: 'Kubeconfig secret generated', lastTransitionTime: new Date().toISOString() },
      ];
      mockClusters.set(name, existing);
    }
  }, 4000);

  return newCluster;
}

export async function upgradeVirtualCluster(name: string, upgrades: {
  kubernetesVersion?: string;
  vclusterVersion?: string;
}): Promise<VirtualCluster | null> {
  const cluster = mockClusters.get(name);
  if (!cluster) return null;

  cluster.status.phase = 'Upgrading';
  if (upgrades.kubernetesVersion) {
    cluster.spec.kubernetesVersion = upgrades.kubernetesVersion;
  }
  if (upgrades.vclusterVersion) {
    cluster.spec.vclusterVersion = upgrades.vclusterVersion;
  }

  // Simulate upgrade completion after 3.5 seconds
  setTimeout(() => {
    const c = mockClusters.get(name);
    if (c) {
      if (upgrades.kubernetesVersion) c.status.virtualK8sVersion = upgrades.kubernetesVersion;
      if (upgrades.vclusterVersion) c.status.vclusterVersion = upgrades.vclusterVersion;
      c.status.phase = 'Ready';
      mockClusters.set(name, c);
    }
  }, 3500);

  mockClusters.set(name, cluster);
  return cluster;
}

export async function deleteVirtualCluster(name: string): Promise<boolean> {
  return mockClusters.delete(name);
}

export function generateMockKubeconfig(cluster: VirtualCluster): string {
  return `apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: ${cluster.status.endpoint}
  name: ${cluster.name}
contexts:
- context:
    cluster: ${cluster.name}
    user: admin
  name: ${cluster.name}
current-context: ${cluster.name}
kind: Config
preferences: {}
users:
- name: admin
  user:
    token: vcop-tenant-token-${cluster.name}-admin-session
`;
}
