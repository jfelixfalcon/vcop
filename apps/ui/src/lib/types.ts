export type SizePreset = 'small' | 'medium' | 'large' | 'custom';

export type ClusterPhase =
  | 'Pending'
  | 'Provisioning'
  | 'Ready'
  | 'Upgrading'
  | 'Degraded'
  | 'Terminating';

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
    lifecycle: {
      autoSleep: boolean;
      ttlHours: number;
    };
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
    observedGeneration?: number;
    createdAt?: string;
  };
  metadata?: {
    owner?: string;
    environment?: 'development' | 'staging' | 'production';
    tags?: string[];
  };
  sparklineData?: {
    cpu: number[];
    memory: number[];
  };
  compiledConfig?: string;
}

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
