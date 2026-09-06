export type SizePreset = 'small' | 'medium' | 'large' | 'custom';

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
  clientId: string;
  usernameClaim?: string;
  usernamePrefix?: string;
  groupsClaim?: string;
  groupsPrefix?: string;
  extraScopes?: string[];
  caFile?: string;
}

export interface VirtualCluster {
  name: string;
  namespace: string;
  spec: {
    clusterName: string;
    vclusterVersion: string;
    kubernetesVersion: string;
    sizePreset: SizePreset;
    highAvailability: boolean;
    components: {
      coreDNS: { enabled: boolean };
      metricsServer: { enabled: boolean };
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

export interface VersionItem {
  version: string;
  label?: string;
  tag?: VersionTag;
  isDefault?: boolean;
  releaseDate?: string;
  notes?: string;
}

export interface VersionRegistry {
  kubernetesVersions: VersionItem[];
  vclusterVersions: VersionItem[];
  updatedAt: string;
}

