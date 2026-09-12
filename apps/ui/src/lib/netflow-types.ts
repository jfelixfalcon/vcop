export type NetflowVerdict = 'FORWARDED' | 'DROPPED' | 'ERROR';

export type NetflowProtocol = 'HTTP' | 'gRPC' | 'TCP' | 'UDP' | 'DNS';

export type EndpointHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type ServiceTier = 'ingress' | 'service' | 'backend' | 'system' | 'external';

export interface BackingPodEndpoint {
  name: string;
  ip: string;
  nodeName?: string;
  ready: boolean;
  phase: string;
  restarts: number;
  age?: string;
}

export interface ServicePortInfo {
  port: number;
  targetPort: number | string;
  protocol: string;
  name?: string;
}

export interface NetflowEndpoint {
  id: string; // e.g. "default/nginx-service"
  name: string;
  namespace: string;
  serviceName: string;
  clusterIP: string;
  externalIP?: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'Headless' | 'External' | 'Pod';
  ports: ServicePortInfo[];
  backingPods: BackingPodEndpoint[];
  readyCount: number;
  totalCount: number;
  healthStatus: EndpointHealthStatus;
  uptimePercent: number;
  avgLatencyMs: number;
  activeFlows: number;
  dropRatePercent: number;
  tier: ServiceTier;
  labels: Record<string, string>;
  lastProbedAt?: string;
  lastProbeStatus?: {
    reachable: boolean;
    latencyMs: number;
    statusCode?: number;
    message?: string;
  };
}

export interface NetflowEdge {
  id: string; // e.g. "gateway-system/gateway-proxy->default/nginx-service"
  sourceId: string;
  targetId: string;
  protocol: NetflowProtocol;
  port: number;
  activeFlows: number;
  bytesPerSec: number;
  packetsPerSec: number;
  verdicts: {
    forwarded: number;
    dropped: number;
    error: number;
  };
  avgLatencyMs: number;
  lastSeen: string;
}

export interface NetflowEvent {
  id: string;
  timestamp: string;
  source: {
    name: string;
    namespace: string;
    ip: string;
    kind: 'Pod' | 'Service' | 'External' | 'Ingress';
    port?: number;
  };
  destination: {
    name: string;
    namespace: string;
    ip: string;
    port: number;
    kind: 'Pod' | 'Service' | 'External' | 'DNS';
  };
  protocol: NetflowProtocol;
  verdict: NetflowVerdict;
  dropReason?: string;
  l7Info?: {
    type: 'http' | 'dns' | 'grpc';
    method?: string;
    path?: string;
    status?: number;
    domain?: string;
    queryType?: string;
    rcode?: string;
  };
  latencyMs: number;
  bytes: number;
  packets: number;
}

export interface NetflowSummary {
  totalEndpoints: number;
  healthyEndpoints: number;
  degradedEndpoints: number;
  unhealthyEndpoints: number;
  overallHealthPercent: number;
  totalActiveFlows: number;
  flowRatePerSec: number;
  forwardedCount: number;
  droppedCount: number;
  errorCount: number;
  forwardedPercent: number;
  droppedPercent: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  dnsSuccessRate: number;
  throughputBps: number;
  namespaces: string[];
  applications: string[];
}

export interface NetflowClusterData {
  success: boolean;
  cluster: string;
  scope?: 'cluster' | 'vcluster' | 'namespace';
  timestamp: string;
  summary: NetflowSummary;
  endpoints: NetflowEndpoint[];
  edges: NetflowEdge[];
  recentFlows: NetflowEvent[];
}

export interface NetflowProbeResult {
  targetEndpoint: string;
  targetIp: string;
  targetPort: number;
  protocol: string;
  reachable: boolean;
  statusCode?: number;
  latencyMs: number;
  checkedAt: string;
  details: string;
}
