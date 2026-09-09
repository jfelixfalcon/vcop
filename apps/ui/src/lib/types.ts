export type SizePreset = 'normal' | 'ha' | 'small' | 'medium' | 'large' | 'custom' | string;

export type ClusterPhase =
  | 'Pending'
  | 'Provisioning'
  | 'Ready'
  | 'Upgrading'
  | 'Degraded'
  | 'Terminating'
  | 'Sleeping';

export interface ClusterCondition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface ClusterMetrics {
  activeNodeCount: number;
  podCount: number;
  memoryUsage: string;
  cpuUsage: string;
  cpuPercent?: number;
  memPercent?: number;
}

export interface ResourceQuotaPolicy {
  enabled: boolean;
  requestsCPU?: string;
  requestsMemory?: string;
  requestsStorage?: string;
  limitsCPU?: string;
  limitsMemory?: string;
  pods?: string;
  services?: string;
  servicesNodePorts?: string;
  servicesLoadBalancers?: string;
  configMaps?: string;
  secrets?: string;
  persistentVolumeClaims?: string;
}

export interface LimitRangePolicy {
  enabled: boolean;
  defaultCPU?: string;
  defaultMemory?: string;
  defaultRequestCPU?: string;
  defaultRequestMemory?: string;
  maxCPU?: string;
  maxMemory?: string;
  minCPU?: string;
  minMemory?: string;
}

export interface PoliciesSpec {
  resourceQuota?: ResourceQuotaPolicy;
  limitRange?: LimitRangePolicy;
  autoSleep?: boolean;
  ttlHours?: number;
}

export interface QuotaStatus {
  hard?: Record<string, string>;
  used?: Record<string, string>;
}

export interface OidcConfig {
  enabled: boolean;
  issuerUrl: string;
  userInfoUrl?: string;
  clientId: string;
  usernameClaim?: string;
  usernamePrefix?: string;
  groupsClaim?: string;
  groupsPrefix?: string;
  extraScopes?: string[];
  caFile?: string;
  caCertificate?: string;
  caSecretName?: string;
  caConfigMapName?: string;
  source?: 'global' | 'group' | 'custom';
  inheritedFrom?: string;
}

export interface OidcProfile {
  id: string; // 'global' or cluster group name
  name: string;
  scope: 'global' | 'group';
  targetGroup?: string;
  enabled: boolean;
  issuerUrl: string;
  userInfoUrl?: string;
  clientId: string;
  clientSecret?: string;
  usernameClaim?: string;
  usernamePrefix?: string;
  groupsClaim?: string;
  groupsPrefix?: string;
  extraScopes?: string[];
  caFile?: string;
  caCertificate?: string;
  caSecretName?: string;
  caConfigMapName?: string;
  updatedAt?: string;
}

export interface OidcRegistry {
  updatedAt: string;
  global: OidcProfile;
  groups: Record<string, OidcProfile>;
}

export interface DisasterRecoverySpec {
  enabled?: boolean;
  schedule?: 'daily' | 'weekly' | 'monthly' | 'custom' | 'disabled' | string;
  cronExpression?: string;
  retentionCount?: number;
  storageSize?: string;
  initialBackupRestore?: string;
  restoreSnapshotName?: string;
}

export interface BackupItem {
  name: string;
  filename: string;
  timestamp: string;
  size: string;
  sizeBytes: number;
  status: 'Completed' | 'InProgress' | 'Failed' | string;
  clusterOrigin: string;
  etcdVersion?: string;
}

export interface DisasterRecoveryStatus {
  enabled: boolean;
  schedule?: string;
  cronExpression?: string;
  lastBackupTime?: string;
  nextBackupTime?: string;
  backupsCount: number;
  totalSizeBytes: number;
  totalSizeStr?: string;
  backupsPvcName?: string;
  recentBackups: BackupItem[];
}

export interface VirtualCluster {
  name: string;
  namespace: string;
  spec: {
    clusterName: string;
    vclusterVersion: string;
    kubernetesVersion: string;
    etcdVersion?: string;
    storageClass?: string;
    etcdStorageClass?: string;
    sizePreset: SizePreset;
    highAvailability: boolean;
    components: {
      coreDNS: { enabled: boolean; version?: string };
      metricsServer: { enabled: boolean; version?: string };
      istio?: {
        enabled: boolean;
        version?: string;
        replicas?: number;
        meshEnabled?: boolean;
        ingressGateway?: {
          enabled: boolean;
          serviceType?: string;
          replicas?: number;
        };
        certificateIssuer?: string;
        certificateIssuerKind?: string;
        hosts?: string[];
        certSecretName?: string;
      };
    };
    sync: {
      pods: boolean;
      services: boolean;
      ingresses: boolean;
    };
    paused?: boolean;
    lifecycle: {
      autoSleep: boolean;
      ttlHours: number;
      sleep?: boolean;
    };
    policies?: PoliciesSpec;
    customResources?: {
      cpu?: string;
      memory?: string;
      storage?: string;
    };
    disasterRecovery?: DisasterRecoverySpec;
    rawConfig?: any;
    helmValues?: any;
    customEndpoint?: string;
    oidc?: OidcConfig;
  };
  status: {
    phase: ClusterPhase;
    conditions: ClusterCondition[];
    virtualK8sVersion: string;
    vclusterVersion: string;
    endpoint: string;
    metrics: ClusterMetrics;
    quota?: QuotaStatus;
    observedGeneration?: number;
    createdAt?: string;
    componentVersions?: {
      etcd?: string;
      coreDNS?: string;
      metricsServer?: string;
      istio?: string;
    };
    disasterRecovery?: DisasterRecoveryStatus;
  };
  metadata?: {
    owner?: string;
    allowedGroups?: string[];
    allowedEmails?: string[];
    clusterGroup?: string;
    clusterGroups?: string[];
    environment?: 'development' | 'staging' | 'production';
    tags?: string[];
    installedApps?: InstalledApp[];
    customEndpoint?: string;
    oidc?: OidcConfig;
    oidcInheritance?: 'global' | 'group' | 'custom';
    oidcInheritedFrom?: string;
    customCaCert?: string;
    customCaSecret?: string;
    customCaConfigMap?: string;
  };
  sparklineData?: {
    cpu: number[];
    memory: number[];
  };
  compiledConfig?: string;
}

export interface ClusterGroupInfo {
  name: string;
  clusterCount: number;
  clusters: string[];
}

export interface RoleAssignment {
  groups: string[];
  users: string[];
}

export interface PlatformAccessPolicy {
  updatedAt: string;
  admin: RoleAssignment;
  developers: RoleAssignment;
  viewers: RoleAssignment;
  defaultRole: 'viewer' | 'developers';
}

export type { UserRole, UserSession } from './auth';

export interface PresetDetails {
  id: SizePreset;
  name: string;
  cpu: string;
  memory: string;
  storage: string;
  ha: boolean;
  description: string;
  badge: string;
  isDefault?: boolean;
  requestsCPU?: string;
  limitsCPU?: string;
  requestsMemory?: string;
  limitsMemory?: string;
  requestsStorage?: string;
  pods?: string;
  services?: string;
  persistentVolumeClaims?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export type AppCategory =
  | 'Network & Ingress'
  | 'Observability'
  | 'Storage & Database'
  | 'Security & Auth'
  | 'Developer Tools';

export interface HelmChartSpec {
  name: string;
  repo: string;
  version?: string;
  releaseName: string;
  namespace?: string;
  values?: string;
}

export interface AppDefinition {
  id: string;
  name: string;
  description: string;
  category: AppCategory;
  version: string;
  icon?: string;
  helm?: HelmChartSpec;
  manifests?: string;
  group?: string;
  tags?: string[];
  isBuiltin?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppGroup {
  id: string;
  name: string;
  description: string;
  icon?: string;
  appIds: string[];
}

export interface AppStoreCatalog {
  apps: AppDefinition[];
  groups: AppGroup[];
  updatedAt: string;
}

export interface InstalledApp {
  appId: string;
  name: string;
  version?: string;
  category?: AppCategory | string;
  installedAt: string;
  installedBy?: string;
  status: 'Installing' | 'Installed' | 'Failed';
  error?: string;
  customValues?: string;
  helm?: HelmChartSpec;
  manifests?: string;
  resourcesCreated?: Array<{ kind: string; name: string; namespace?: string }>;
}

export type VersionTag = 'default' | 'stable' | 'lts' | 'preview' | 'deprecated';

export type VersionCategory = 'k8s' | 'vcluster' | 'etcd' | 'coredns' | 'metricsServer' | 'istio';

export interface ImagePatterns {
  k8s?: string;
  vcluster?: string;
  etcd?: string;
  coredns?: string;
  metricsServer?: string;
  istio?: string;
  [key: string]: string | undefined;
}

export interface VersionItem {
  version: string;
  label?: string;
  tag?: VersionTag;
  isDefault?: boolean;
  releaseDate?: string;
  notes?: string;
  image?: string;
}

export interface VersionRegistry {
  kubernetesVersions: VersionItem[];
  vclusterVersions: VersionItem[];
  etcdVersions?: VersionItem[];
  coreDNSVersions?: VersionItem[];
  metricsServerVersions?: VersionItem[];
  istioVersions?: VersionItem[];
  imagePatterns?: ImagePatterns;
  updatedAt: string;
}

export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'CronJob' | 'Pod' | 'Other';

export interface ContainerMetric {
  name: string;
  cpuUsage: string;
  cpuMillis: number;
  memoryUsage: string;
  memoryBytes: number;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
  ready: boolean;
  restartCount: number;
  image: string;
  state?: string;
}

export interface LivePodMetric {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  restarts: number;
  age: string;
  startTime?: string;
  nodeName?: string;
  podIP?: string;
  workloadKind: WorkloadKind;
  workloadName: string;
  cpuUsage: string;
  cpuMillis: number;
  cpuPercent?: number;
  memoryUsage: string;
  memoryBytes: number;
  memoryPercent?: number;
  cpuSparkline?: number[];
  memSparkline?: number[];
  containers: ContainerMetric[];
  labels?: Record<string, string>;
}

export interface LiveWorkloadMetric {
  kind: WorkloadKind;
  name: string;
  namespace: string;
  podsCount: number;
  readyPodsCount: number;
  totalCpuMillis: number;
  totalCpuUsage: string;
  totalMemoryBytes: number;
  totalMemoryUsage: string;
  cpuPercent?: number;
  memoryPercent?: number;
  totalRestarts: number;
  status: 'Healthy' | 'Degraded' | 'Critical';
  pods: LivePodMetric[];
}

export interface MetricTimeBucket {
  timestamp: string; // ISO string
  totalCpuMillis: number;
  avgCpuMillis: number;
  maxCpuMillis: number;
  totalMemoryBytes: number;
  avgMemoryBytes: number;
  maxMemoryBytes: number;
  activePods: number;
  workloadBreakdown?: Record<string, { cpuMillis: number; memoryBytes: number }>;
}

export interface ClusterMetricsResponse {
  success: boolean;
  cluster: string;
  timestamp: string;
  summary: {
    totalCpuMillis: number;
    totalCpuUsage: string;
    totalMemoryBytes: number;
    totalMemoryUsage: string;
    cpuPercent?: number;
    memPercent?: number;
    totalPods: number;
    runningPods: number;
    pendingPods: number;
    failedPods: number;
    totalRestarts: number;
    totalWorkloads: number;
    namespaces: string[];
  };
  workloads: LiveWorkloadMetric[];
  pods: LivePodMetric[];
  historicalBuckets?: MetricTimeBucket[];
}

export interface K8sEvent {
  type: 'Normal' | 'Warning';
  reason: string;
  message: string;
  count: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  source?: { component?: string };
}

export interface VClusterCapacityItem {
  name: string;
  namespace: string;
  phase: string;
  preset: string;
  requestedCpuMillis: number;
  requestedCpuStr: string;
  requestedMemoryBytes: number;
  requestedMemoryStr: string;
  requestedStorageBytes: number;
  requestedStorageStr: string;
  limitsCpuMillis: number;
  limitsCpuStr: string;
  limitsMemoryBytes: number;
  limitsMemoryStr: string;
  usedCpuMillis: number;
  usedCpuStr: string;
  usedMemoryBytes: number;
  usedMemoryStr: string;
  usedStorageBytes: number;
  usedStorageStr: string;
  cpuSharePercent: number;
  memorySharePercent: number;
  storageSharePercent: number;
}

export interface ClusterCapacityData {
  totalNodes: number;
  nodeNames: string[];
  allocatableCpuMillis: number;
  allocatableCpuStr: string;
  allocatableMemoryBytes: number;
  allocatableMemoryStr: string;
  allocatableStorageBytes: number;
  allocatableStorageStr: string;
  totalCpuMillis: number;
  totalCpuStr: string;
  totalMemoryBytes: number;
  totalMemoryStr: string;
  totalStorageBytes: number;
  totalStorageStr: string;
  requestedCpuMillis: number;
  requestedCpuStr: string;
  requestedMemoryBytes: number;
  requestedMemoryStr: string;
  requestedStorageBytes: number;
  requestedStorageStr: string;
  limitsCpuMillis: number;
  limitsCpuStr: string;
  limitsMemoryBytes: number;
  limitsMemoryStr: string;
  usedCpuMillis: number;
  usedCpuStr: string;
  usedMemoryBytes: number;
  usedMemoryStr: string;
  usedStorageBytes: number;
  usedStorageStr: string;
  availableCpuMillis: number;
  availableCpuStr: string;
  availableMemoryBytes: number;
  availableMemoryStr: string;
  availableStorageBytes: number;
  availableStorageStr: string;
  cpuUtilizationPct: number;
  memoryUtilizationPct: number;
  storageUtilizationPct: number;
  isCpuOverallocated: boolean;
  isMemoryOverallocated: boolean;
  isStorageOverallocated: boolean;
  totalGpus?: number;
  allocatableGpus?: number;
  gpuModel?: string;
  gpuVendor?: string;
  hardwareString?: string;
  vclusters: VClusterCapacityItem[];
}

export interface DetectedHardwareInfo {
  isGpu: boolean;
  vendor: string;
  model: string;
  hardwareString: string;
  totalGpus: number;
  allocatableGpus: number;
}

export type AIProviderType = 'local' | 'custom';

export interface AISettingsConfig {
  localModelEnabled: boolean;
  provider?: string;
  remoteEndpoint?: string;
  remoteModel?: string;
  remoteApiKey?: string;
  temperature?: number;
  maxTokens?: number;
  customHeaders?: Record<string, string>;
  updatedAt?: string;
}

export interface AISettingsPublic {
  localModelEnabled: boolean;
  provider?: string;
  remoteEndpoint: string;
  remoteModel: string;
  hasApiKey: boolean;
  maskedApiKey?: string;
  temperature: number;
  maxTokens: number;
  updatedAt?: string;
}

export interface AIConnectionTestResult {
  ok: boolean;
  latencyMs?: number;
  message: string;
  model?: string;
  error?: string;
}

export interface ClusterBaseline {
  id: string;
  name: string;
  description: string;
  badge?: string;
  isDefault: boolean;
  baseDomain: string; // e.g. "test.example.com"
  preset: SizePreset;
  environment: 'development' | 'staging' | 'production';
  kubernetesVersion?: string;
  vclusterVersion?: string;
  enableMonitoringAndDNS: boolean;
  autoSleep: boolean;
  ttlHours?: number;
  istio: {
    enabled: boolean;
    meshEnabled?: boolean;
    certificateIssuer?: string;
    certificateIssuerKind?: 'ClusterIssuer' | 'Issuer';
    serviceType?: string;
  };
  disasterRecovery: {
    enabled: boolean;
    schedule: string;
    retentionCount: number;
  };
  policies?: {
    resourceQuota?: {
      requestsCPU?: string;
      limitsCPU?: string;
      requestsMemory?: string;
      limitsMemory?: string;
      requestsStorage?: string;
      pods?: string;
      services?: string;
      persistentVolumeClaims?: string;
    };
  };
  clusterGroup?: string;
  installedAppIds?: string[];
  storageClass?: string;
  etcdStorageClass?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface StorageClassInfo {
  name: string;
  provisioner: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  isDefault: boolean;
  allowVolumeExpansion?: boolean;
}

