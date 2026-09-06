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
    environment?: 'development' | 'staging' | 'production';
    tags?: string[];
  };
  sparklineData?: {
    cpu: number[];
    memory: number[];
  };
  compiledConfig?: string;
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
