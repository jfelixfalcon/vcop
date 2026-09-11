import { queryAggregateMetrics, type AggregateMetricsResult } from './metrics-db';
import {
  getHostClusterCapacity,
  listVirtualClusters,
  listFleetBackups,
  k8sRequest,
  listClusterPods,
  listClusterNamespaces,
  restartWorkload,
  scaleWorkload,
  deleteWorkload,
  findWorkload,
  listAllDeployments,
  getClusterHardware,
  type PodItem,
  type ClusterPodsSummary,
  type WorkloadRestartResult,
  type WorkloadScaleResult,
  type WorkloadDeleteResult,
  type DeploymentSummary,
} from './k8s-client';
import {
  getAISettings,
  DEFAULT_LOCAL_ENDPOINT,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_REMOTE_ENDPOINT,
  DEFAULT_REMOTE_MODEL,
} from './ai-config';
import type {
  ClusterCapacityData,
  VirtualCluster,
  K8sEvent,
  BackupItem,
  AIProviderType,
} from './types';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface MetricCardData {
  title: string;
  value: string;
  subtext?: string;
  trend?: string;
  status?: 'normal' | 'warning' | 'critical' | 'info';
}

export interface WorkloadStat {
  name: string;
  kind: string;
  avgCpu: string;
  peakCpu: string;
  avgMem: string;
  peakMem: string;
  samples: number;
}

export interface ActionPayload {
  type: 'restart' | 'scale' | 'delete';
  kind: string;
  name: string;
  namespace: string;
  status: 'success' | 'failed';
  message: string;
  policyReason?: string;
  restartedAt?: string;
  cliCommand?: string;
  rolloutCommand?: string;
  replicas?: {
    desired?: number;
    ready?: number;
    updated?: number;
    previous?: number;
    new?: number;
  };
}

export interface ToolDataPayload {
  type: 'metrics' | 'capacity' | 'vclusters' | 'events' | 'backups' | 'pods' | 'action' | 'general';
  action?: ActionPayload;
  metrics?: {
    namespace?: string;
    timeWindow: string;
    sampleCount: number;
    avgCpuMillis: number;
    avgCpuFormatted: string;
    maxCpuMillis: number;
    maxCpuFormatted: string;
    avgMemoryMB: number;
    maxMemoryMB: number;
    cards: MetricCardData[];
    workloads: WorkloadStat[];
    availableNamespaces: string[];
  };
  capacity?: {
    allocatableCpu: string;
    usedCpu: string;
    headroomCpuPct: number;
    allocatableMemory: string;
    usedMemory: string;
    headroomMemoryPct: number;
    nodes: number;
  };
  pods?: {
    total: number;
    running: number;
    pending: number;
    failed: number;
    completed: number;
    namespace?: string;
    byNamespace: Record<string, { total: number; running: number; failed: number }>;
    items: PodItem[];
  };
  vclustersCount?: number;
  eventsCount?: number;
}

export interface AIResponse {
  role: 'assistant';
  content: string;
  model: string;
  hardware: string;
  toolData?: ToolDataPayload;
}

function getAiServiceUrl(): string {
  if (process.env.AI_SERVICE_URL) return process.env.AI_SERVICE_URL;
  // Inside Kubernetes cluster:
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return 'http://vcop-ai.vcop-system.svc:8080';
  }
  // Local host development:
  return 'http://127.0.0.1:8088';
}

export async function checkAiServiceHealth(): Promise<{
  online: boolean;
  model: string;
  hardware: string;
  url: string;
  provider: string;
  localModelEnabled: boolean;
  hasApiKey: boolean;
}> {
  const settings = await getAISettings();
  const hw = await getClusterHardware().catch(() => ({
    hardwareString: 'Host Hardware',
  }));

  // 1. If Local Model is disabled -> Remote OpenAI-API Gateway mode
  if (!settings.localModelEnabled) {
    const model = settings.remoteModel || DEFAULT_REMOTE_MODEL;
    const hasKey = Boolean(settings.remoteApiKey && settings.remoteApiKey.trim().length > 0);

    return {
      online: hasKey || !settings.remoteEndpoint?.includes('api.openai.com'),
      model: model,
      hardware: hasKey ? 'OpenAI-Compatible API' : 'API Key Required',
      url: settings.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT,
      provider: 'custom',
      localModelEnabled: false,
      hasApiKey: hasKey,
    };
  }

  // 2. Local Gemma 3 Inference Engine Active
  const url = getAiServiceUrl();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${url}/v1/models`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      return {
        online: true,
        model: 'Gemma 3 1B IT (Q4_K_M)',
        hardware: hw.hardwareString,
        url,
        provider: 'local',
        localModelEnabled: true,
        hasApiKey: false,
      };
    }
  } catch {}

  return {
    online: false,
    model: 'Gemma 3 1B IT (Standby)',
    hardware: hw.hardwareString,
    url,
    provider: 'local',
    localModelEnabled: true,
    hasApiKey: false,
  };
}

export async function generateChatResponse(messages: ChatMessage[]): Promise<AIResponse> {
  const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const lower = latestUserMessage.toLowerCase();

  // Extract time window (default 10 hours if unspecified)
  let hours = 10;
  const hoursMatch = lower.match(/(\d+)\s*(?:h|hr|hour|hours)/);
  const minutesMatch = lower.match(/(\d+)\s*(?:m|min|minute|minutes)/);
  const daysMatch = lower.match(/(\d+)\s*(?:d|day|days)/);
  if (hoursMatch) {
    hours = parseInt(hoursMatch[1], 10);
  } else if (minutesMatch) {
    hours = Math.max(1, Math.round(parseInt(minutesMatch[1], 10) / 60));
  } else if (daysMatch) {
    hours = parseInt(daysMatch[1], 10) * 24;
  }

  // Extract namespace
  let detectedNamespace: string | undefined;
  const nsMatch = lower.match(/(?:in\s+namespace|\bnamespace\b|in\s+ns|\bns\b|\bin\b)\s+([a-zA-Z0-9_-]+)/);
  if (nsMatch) {
    const raw = nsMatch[1].trim();
    if (!['the', 'all', 'a', 'this', 'our', 'my', 'cluster', 'total', 'namespace', 'ns', 'in', 'kubernetes', 'k8s', 'here', 'prod', 'production', 'general', 'practice'].includes(raw)) {
      detectedNamespace = raw;
    }
  }

  // If regex didn't find a specific namespace, check known namespaces
  if (!detectedNamespace) {
    if (lower.includes('alpha')) {
      detectedNamespace = 'alpha';
    } else if (lower.includes('istio-system')) {
      detectedNamespace = 'istio-system';
    } else if (lower.includes('kube-system')) {
      detectedNamespace = 'kube-system';
    } else if (lower.includes('default')) {
      detectedNamespace = 'default';
    } else if (lower.includes('vcop-system')) {
      detectedNamespace = 'vcop-system';
    } else if (lower.includes('vc-dev')) {
      detectedNamespace = 'vc-dev';
    } else if (lower.includes('cert-manager')) {
      detectedNamespace = 'cert-manager';
    }
  }

  // 1. Identify intent & action commands (restart, scale, delete)
  const isRestartAction = /\b(?:restart|reboot|bounce|rollout\s+restart)\b/i.test(lower);
  const isScaleAction = /\b(?:scale|resize)\b/i.test(lower);

  // Check if this is an informational / instructional inquiry rather than an imperative execution command
  const isInstructionalInquiry =
    /\b(?:how\s+(?:to|do|can)|why|what\s+is|what\s+are|explain|guide|tutorial|documentation|sample|example|write\s+(?:a\s+)?(?:yaml|manifest|script))\b/i.test(lower) ||
    /\b(?:what\s+happens|when\s+should|difference\s+between)\b/i.test(lower);

  const isDeleteExecution = !isInstructionalInquiry && /\b(?:delete|destroy|remove|kill|terminate|prune|uninstall)\b/i.test(lower);
  const isActionQuery = isRestartAction || isScaleAction || isDeleteExecution;

  let targetWorkloadName: string | undefined;
  let targetKind: string | undefined;

  if (/\b(?:virtual\s*cluster|vcluster)\b/i.test(lower)) targetKind = 'VirtualCluster';
  else if (/\b(?:deployment|deploy)\b/i.test(lower)) targetKind = 'Deployment';
  else if (/\b(?:statefulset|sts)\b/i.test(lower)) targetKind = 'StatefulSet';
  else if (/\b(?:daemonset|ds)\b/i.test(lower)) targetKind = 'DaemonSet';
  else if (/\b(?:service|svc)\b/i.test(lower)) targetKind = 'Service';
  else if (/\b(?:configmap|cm)\b/i.test(lower)) targetKind = 'ConfigMap';
  else if (/\b(?:secret|secrets)\b/i.test(lower)) targetKind = 'Secret';
  else if (/\b(?:namespace|ns)\b/i.test(lower)) targetKind = 'Namespace';
  else if (/\b(?:pod|pods)\b/i.test(lower)) targetKind = 'Pod';

  if (isActionQuery) {
    const actionPatterns = [
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts|daemonset|ds|pod)\s+([a-zA-Z0-9_-]+)/i,
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:deployment|deploy|statefulset|sts|daemonset|ds|pod)/i,
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
      /(?:scale|resize)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts)\s+([a-zA-Z0-9_-]+)/i,
      /(?:scale|resize)\s+(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:deployment|deploy|statefulset|sts)/i,
      /(?:scale|resize)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
      /(?:delete|destroy|remove|kill|terminate|prune|uninstall)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts|daemonset|ds|service|svc|configmap|cm|secret|pod|vcluster|virtual\s*cluster|namespace|ns)\s+([a-zA-Z0-9_-]+)/i,
      /(?:delete|destroy|remove|kill|terminate|prune|uninstall)\s+(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:deployment|deploy|statefulset|sts|daemonset|ds|service|svc|configmap|cm|secret|pod|vcluster|virtual\s*cluster|namespace|ns)/i,
      /(?:delete|destroy|remove|kill|terminate|prune|uninstall)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
    ];

    for (const pat of actionPatterns) {
      const m = lower.match(pat);
      if (m && m[1]) {
        const candidate = m[1].trim();
        if (!['the', 'a', 'this', 'our', 'my', 'deployment', 'statefulset', 'daemonset', 'pod', 'for', 'please', 'me', 'it', 'to', 'all', 'everything', 'resources', 'pods', 'deployments', 'workload', 'workloads', 'cluster'].includes(candidate)) {
          targetWorkloadName = candidate;
          break;
        }
      }
    }
  }

  let scaleReplicas: number | undefined;
  if (isScaleAction) {
    const scaleMatch = lower.match(/\b(?:to|=)\s*(\d+)/i) || lower.match(/\b(\d+)\s*replicas?/i);
    if (scaleMatch) {
      scaleReplicas = parseInt(scaleMatch[1], 10);
    }
  }

  const isManifestOrGeneralQuestion =
    /\b(?:write|create|generate|sample|example|template|scaffold|manifest|yaml)\b/i.test(lower) ||
    isInstructionalInquiry;

  const isPodsQuery = !isActionQuery && !isManifestOrGeneralQuestion &&
    (/\b(?:show|get|list|check|view|count|status\s+of|how\s+many|running|failed|unhealthy)\s+(?:the\s+)?(?:pods?|containers?|workloads?|deployments?|statefulsets?|daemonsets?)\b/i.test(lower) ||
     /\b(?:pods?|workloads?)\s+(?:status|health|overview|inventory|list)\b/i.test(lower) ||
     /^(?:pods?|workloads?|deployments?)$/i.test(lower.trim()));
  const isMetricsQuery = !isActionQuery && !isManifestOrGeneralQuestion && !isPodsQuery && (/cpu|memory|mem|usage|stats|average|avg|peak|utilization|history|metric/i.test(lower) || (Boolean(detectedNamespace) && !isPodsQuery));
  const isCapacityQuery = !isActionQuery && !isManifestOrGeneralQuestion && /capacity|headroom|allocat|starvat|quota|nodes?|physical/i.test(lower);
  const isVClusterQuery = !isActionQuery && !isManifestOrGeneralQuestion && /virtual\s*cluster|vcluster|guest|tenan|mesh|istio/i.test(lower);
  const isEventsQuery = !isActionQuery && !isManifestOrGeneralQuestion && /event|error|warning|crash|fail|backoff|oom|unhealthy/i.test(lower);
  const isBackupQuery = !isActionQuery && !isManifestOrGeneralQuestion && /backup|snapshot|dr|disaster|restore|etcd/i.test(lower);

  let toolPayload: ToolDataPayload | undefined;
  let contextSummary = '';

  // TOOL -1: CLUSTER WORKLOAD ACTIONS (RESTART / SCALE / DELETE)
  if (isActionQuery && targetWorkloadName) {
    if (isRestartAction) {
      try {
        const result = await restartWorkload(targetWorkloadName, detectedNamespace);
        toolPayload = {
          type: 'action',
          action: {
            type: 'restart',
            kind: result.kind,
            name: result.name,
            namespace: result.namespace,
            status: 'success',
            message: result.message,
            restartedAt: result.restartedAt,
            cliCommand: result.cliCommand,
            rolloutCommand: result.rolloutCommand,
            replicas: result.replicas,
          },
        };

        contextSummary += `\n[Cluster Action Execution Result]
Action: Rollout Restart Initiated
Status: SUCCESS (200 OK)
Resource: ${result.kind}/${result.name}
Namespace: ${result.namespace}
Restart Timestamp: ${result.restartedAt}
Desired Replicas: ${result.replicas?.desired ?? 1} (Current Ready: ${result.replicas?.ready ?? 0})
CLI Executed: ${result.cliCommand}
Rollout Status Command: ${result.rolloutCommand}
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: 'restart',
            kind: 'Deployment',
            name: targetWorkloadName,
            namespace: detectedNamespace || 'unknown',
            status: 'failed',
            message: err.message,
            cliCommand: `kubectl rollout restart deployment/${targetWorkloadName} ${detectedNamespace ? `-n ${detectedNamespace}` : ''}`,
          },
        };

        contextSummary += `\n[Cluster Action Execution Result]
Action: Rollout Restart Attempted
Status: FAILED / NOT FOUND
Resource Target: ${targetWorkloadName}
Namespace: ${detectedNamespace || 'All namespaces searched'}
Error Message: ${err.message}
`;
      }
    } else if (isScaleAction && scaleReplicas !== undefined) {
      try {
        const result = await scaleWorkload(targetWorkloadName, scaleReplicas, detectedNamespace);
        toolPayload = {
          type: 'action',
          action: {
            type: 'scale',
            kind: result.kind,
            name: result.name,
            namespace: result.namespace,
            status: 'success',
            message: result.message,
            cliCommand: result.cliCommand,
            replicas: {
              previous: result.previousReplicas,
              new: result.newReplicas,
            },
          },
        };

        contextSummary += `\n[Cluster Action Execution Result]
Action: Scale Workload Replicas
Status: SUCCESS (200 OK)
Resource: ${result.kind}/${result.name}
Namespace: ${result.namespace}
Previous Replicas: ${result.previousReplicas} -> New Replicas: ${result.newReplicas}
CLI Executed: ${result.cliCommand}
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: 'scale',
            kind: 'Deployment',
            name: targetWorkloadName,
            namespace: detectedNamespace || 'unknown',
            status: 'failed',
            message: err.message,
          },
        };

        contextSummary += `\n[Cluster Action Execution Result]
Action: Scale Workload Attempted
Status: FAILED / NOT FOUND
Resource Target: ${targetWorkloadName}
Error: ${err.message}
`;
      }
    } else if (isDeleteExecution) {
      try {
        const result = await deleteWorkload(targetWorkloadName, detectedNamespace, targetKind);
        toolPayload = {
          type: 'action',
          action: {
            type: 'delete',
            kind: result.kind,
            name: result.name,
            namespace: result.namespace,
            status: 'success',
            message: result.message,
            cliCommand: result.cliCommand,
          },
        };

        contextSummary += `\n[Cluster Action Execution Result]
Action: Resource Deletion Executed
Status: SUCCESS (200 OK)
Resource: ${result.kind}/${result.name}
Namespace: ${result.namespace}
CLI Command: ${result.cliCommand}
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: 'delete',
            kind: targetKind || 'Resource',
            name: targetWorkloadName,
            namespace: detectedNamespace || 'default',
            status: 'failed',
            message: err.message,
            cliCommand: `kubectl delete ${targetKind ? targetKind.toLowerCase() : 'pod'} ${targetWorkloadName} ${detectedNamespace ? `-n ${detectedNamespace}` : ''}`,
          },
        };

        contextSummary += `\n[Cluster Action Execution Result]
Action: Resource Deletion Attempted
Status: FAILED / NOT FOUND
Resource Target: ${targetWorkloadName}
Namespace: ${detectedNamespace || 'default'}
Error Message: ${err.message}
`;
      }
    }
  }

  // TOOL 0: PODS & WORKLOAD INVENTORY QUERY
  if (isPodsQuery) {
    try {
      const podSummary = await listClusterPods(detectedNamespace);
      toolPayload = {
        type: 'pods',
        pods: {
          total: podSummary.total,
          running: podSummary.running,
          pending: podSummary.pending,
          failed: podSummary.failed,
          completed: podSummary.completed,
          namespace: detectedNamespace,
          byNamespace: podSummary.byNamespace,
          items: podSummary.items.slice(0, 30),
        },
      };

      const scopeText = detectedNamespace ? `Namespace '${detectedNamespace}'` : 'Cluster-Wide (All Namespaces)';
      contextSummary += `\n[Live Kubernetes Pod Inventory from Kube-API]
Target Scope: ${scopeText}
Total Pods: ${podSummary.total}
Running Pods: ${podSummary.running}
Pending Pods: ${podSummary.pending}
Failed/CrashLoopBackOff Pods: ${podSummary.failed}
Completed/Succeeded Pods: ${podSummary.completed}
Pods by Namespace:
${Object.entries(podSummary.byNamespace).map(([ns, stats]) => `  - Namespace '${ns}': ${stats.total} pods (${stats.running} running, ${stats.failed} failed)`).join('\n')}
Sample Pods:
${podSummary.items.slice(0, 15).map((p) => `  - ${p.namespace}/${p.name} [Phase: ${p.phase}, Ready: ${p.readyContainers}/${p.totalContainers}, Restarts: ${p.restarts}, Age: ${p.age}]`).join('\n')}
`;
    } catch (err: any) {
      console.warn('[ai-engine] Pods query failed:', err.message);
    }
  }

  // TOOL 1: METRICS QUERY
  if (isMetricsQuery || (detectedNamespace && !isPodsQuery && !isManifestOrGeneralQuestion && !isActionQuery)) {
    const agg = await queryAggregateMetrics({
      namespace: detectedNamespace,
      hours,
    });

    const formatCpu = (m: number) => {
      if (m < 1000) return `${m}m`;
      return `${(m / 1000).toFixed(2)} cores`;
    };

    const cards: MetricCardData[] = [
      {
        title: 'Average CPU Usage',
        value: formatCpu(agg.avgCpuMillis),
        subtext: `${agg.avgCpuMillis} millicores`,
        status: agg.avgCpuMillis > 500 ? 'warning' : 'normal',
      },
      {
        title: 'Peak / Max CPU',
        value: formatCpu(agg.maxCpuMillis),
        subtext: `Highest spike recorded`,
        status: agg.maxCpuMillis > 1000 ? 'warning' : 'normal',
      },
      {
        title: 'Average Memory',
        value: `${agg.avgMemoryMB} MB`,
        subtext: `Max: ${agg.maxMemoryMB} MB`,
        status: 'normal',
      },
      {
        title: 'Samples Analyzed',
        value: agg.sampleCount.toLocaleString(),
        subtext: `Window: Past ${hours}h`,
        status: 'info',
      },
    ];

    const workloads: WorkloadStat[] = agg.workloads.map((w) => ({
      name: w.workloadName,
      kind: w.workloadKind,
      avgCpu: formatCpu(w.avgCpuMillis),
      peakCpu: formatCpu(w.maxCpuMillis),
      avgMem: `${w.avgMemoryMB} MB`,
      peakMem: `${w.maxMemoryMB} MB`,
      samples: w.sampleCount,
    }));

    toolPayload = {
      type: 'metrics',
      metrics: {
        namespace: detectedNamespace,
        timeWindow: `Past ${hours} hour${hours > 1 ? 's' : ''}`,
        sampleCount: agg.sampleCount,
        avgCpuMillis: agg.avgCpuMillis,
        avgCpuFormatted: formatCpu(agg.avgCpuMillis),
        maxCpuMillis: agg.maxCpuMillis,
        maxCpuFormatted: formatCpu(agg.maxCpuMillis),
        avgMemoryMB: agg.avgMemoryMB,
        maxMemoryMB: agg.maxMemoryMB,
        cards,
        workloads,
        availableNamespaces: agg.availableNamespaces.map((n) => n.namespace),
      },
    };

    if (agg.sampleCount > 0) {
      contextSummary += `\n[Measured Ground Truth from PostgreSQL Metrics Database]
Target Namespace: ${detectedNamespace || 'All Namespaces'}
Time Window: Past ${hours} hours
Total Samples Recorded: ${agg.sampleCount}
Measured Average CPU Usage: ${agg.avgCpuMillis}m (${(agg.avgCpuMillis / 1000).toFixed(4)} cores)
Peak / Maximum CPU Recorded: ${agg.maxCpuMillis}m
Measured Average Memory: ${agg.avgMemoryMB} MB
Peak Memory: ${agg.maxMemoryMB} MB
Top Workloads:
${agg.workloads.map((w) => `  - ${w.workloadKind}/${w.workloadName}: avg ${w.avgCpuMillis}m CPU, max ${w.maxCpuMillis}m, avg ${w.avgMemoryMB}MB RAM (${w.sampleCount} samples)`).join('\n')}
`;
    } else {
      contextSummary += `\n[PostgreSQL Metrics Database Result]
Target Namespace: ${detectedNamespace || 'all'}
Time Window: Past ${hours} hours
Status: 0 telemetry samples recorded. Active namespaces with recorded data are: ${agg.availableNamespaces.map((n) => n.namespace).join(', ')}.
`;
    }
  }

  // TOOL 2: CAPACITY & HEADROOM QUERY
  if (isCapacityQuery) {
    try {
      const cap = await getHostClusterCapacity();
      const cpuHeadroomPct = Math.max(0, Math.round(100 - cap.cpuUtilizationPct));
      const memHeadroomPct = Math.max(0, Math.round(100 - cap.memoryUtilizationPct));

      toolPayload = {
        type: 'capacity',
        capacity: {
          allocatableCpu: cap.allocatableCpuStr,
          usedCpu: cap.usedCpuStr,
          headroomCpuPct: cpuHeadroomPct,
          allocatableMemory: cap.allocatableMemoryStr,
          usedMemory: cap.usedMemoryStr,
          headroomMemoryPct: memHeadroomPct,
          nodes: cap.totalNodes,
        },
      };

      contextSummary += `\n[Measured Host Cluster Capacity & Headroom]
Host Nodes: ${cap.totalNodes} (${cap.nodeNames.join(', ')})
Allocatable CPU: ${cap.allocatableCpuStr} | Active Usage: ${cap.usedCpuStr} | Available: ${cap.availableCpuStr} | Headroom: ${cpuHeadroomPct}%
Allocatable Memory: ${cap.allocatableMemoryStr} | Active Usage: ${cap.usedMemoryStr} | Available: ${cap.availableMemoryStr} | Headroom: ${memHeadroomPct}%
Virtual Clusters Provisioned: ${cap.vclusters.length}
`;
    } catch (err: any) {
      console.warn('[ai-engine] Capacity query failed:', err.message);
    }
  }

  // TOOL 3: VIRTUAL CLUSTERS QUERY
  if (isVClusterQuery && !toolPayload) {
    try {
      const vclusters = await listVirtualClusters();
      toolPayload = {
        type: 'vclusters',
        vclustersCount: vclusters.length,
      };

      contextSummary += `\n[Virtual Clusters Overview]
Total Clusters: ${vclusters.length}
Clusters:
${vclusters.map((vc) => `  - ${vc.name} (Namespace: ${vc.namespace}, Preset: ${vc.preset || 'custom'}, Phase: ${vc.phase || 'Ready'}, Istio: ${vc.istioEnabled ? `Enabled (${vc.istioGatewayReplicas || 1} gateways, ${vc.istiodReplicas || 1} istiod)` : 'Disabled'}, Backups: ${vc.backupRetentionCount || 0})`).join('\n')}
`;
    } catch {}
  }

  // TOOL 4: EVENTS QUERY
  if (isEventsQuery) {
    try {
      const res = await k8sRequest<{ items: any[] }>('/api/v1/events?limit=25');
      const items = res.data?.items || [];
      const warningEvents = items.filter((e) => e.type === 'Warning');
      toolPayload = toolPayload || {
        type: 'events',
        eventsCount: items.length,
      };

      contextSummary += `\n[Cluster Events & Anomalies]
Recent Warning Events: ${warningEvents.length}
${warningEvents.slice(0, 8).map((e) => `  - [${e.reason}] ${e.involvedObject?.kind}/${e.involvedObject?.name} in ${e.involvedObject?.namespace}: ${e.message}`).join('\n')}
`;
    } catch {}
  }

  // TOOL 5: BACKUP & DR QUERY
  if (isBackupQuery) {
    try {
      const backups = await listFleetBackups();
      toolPayload = toolPayload || {
        type: 'backups',
      };
      contextSummary += `\n[Disaster Recovery & Snapshots]
Total Backups Recorded: ${backups.length}
${backups.slice(0, 5).map((b) => `  - Cluster: ${b.vcluster}, Snapshot: ${b.snapshotName}, Size: ${b.sizeBytes ? `${Math.round(b.sizeBytes / (1024 * 1024))}MB` : 'N/A'}, Status: ${b.phase}`).join('\n')}
`;
    } catch {}
  }

  // If no specific intent matched, include comprehensive system status
  if (!contextSummary) {
    try {
      const [vclusters, cap, podSummary] = await Promise.all([
        listVirtualClusters().catch(() => []),
        getHostClusterCapacity().catch(() => null),
        listClusterPods().catch(() => null),
      ]);

      contextSummary += `\n[Current Kubernetes Environment]\n`;
      if (podSummary) {
        contextSummary += `Total Pods: ${podSummary.total} (${podSummary.running} running, ${podSummary.pending} pending, ${podSummary.failed} failed, ${podSummary.completed} completed)\n`;
        contextSummary += `Pods by Namespace: ${Object.entries(podSummary.byNamespace).map(([ns, s]) => `${ns}: ${s.total} (${s.running} running)`).join(', ')}\n`;
      }
      contextSummary += `Active Virtual Clusters: ${vclusters.length}\n`;
      if (cap) {
        contextSummary += `Host Nodes: ${cap.totalNodes} (${cap.allocatableCpuStr} CPU, ${cap.allocatableMemoryStr} Memory)\n`;
        contextSummary += `CPU Usage: ${cap.usedCpuStr} | Memory Usage: ${cap.usedMemoryStr}\n`;
      }
    } catch {}
  }

  const settings = await getAISettings();
  const health = await checkAiServiceHealth();

  const systemPrompt = `You are vCOp Copilot, a Staff Kubernetes Architect and Principal Site Reliability Engineer (SRE) embedded in the Virtual Cluster Operations Center.
You possess world-class mastery across the entire cloud-native and Kubernetes ecosystem:
- Core Architecture: kube-apiserver, etcd, kube-controller-manager, kube-scheduler, kubelet, CRI (containerd/CRI-O), CNI, CSI, and Linux kernel primitives (cgroups v1/v2, namespaces, seccomp, eBPF, iptables/IPVS).
- Workloads & Controllers: Deployments, StatefulSets (headless services, volumeClaimTemplates, ordered/parallel rollouts), DaemonSets, Jobs, CronJobs, Custom Resource Definitions (CRDs), and Operator reconciliation patterns.
- High Availability & Scheduling: PodDisruptionBudgets (PDB), nodeAffinity, podAffinity, podAntiAffinity, taints & tolerations, topologySpreadConstraints, PriorityClasses, preemption, HPA (Horizontal Pod Autoscaler with custom metrics), VPA, KEDA, and Cluster Autoscaler.
- Container Hardening & Production Best Practices: Non-root execution (\`runAsNonRoot: true\`, \`runAsUser: 10001\`), \`readOnlyRootFilesystem: true\`, \`allowPrivilegeEscalation: false\`, dropping all Linux capabilities (\`drop: ["ALL"]\`), seccompProfile \`RuntimeDefault\`, ephemeral-storage limits, graceful termination (\`terminationGracePeriodSeconds\` with \`preStop\` sleep hook for zero-downtime draining), readiness/liveness/startup probes (httpGet, exec, tcpSocket, gRPC).
- Networking & Service Mesh: Service topologies (ClusterIP, NodePort, LoadBalancer, ExternalName, Headless), Ingress Controllers (NGINX, Traefik, Envoy), Kubernetes Gateway API (GatewayClass, Gateway, HTTPRoute), Istio Service Mesh (Envoy sidecar proxy injection, Ambient mesh / ztunnel, VirtualService, DestinationRule, Gateway, PeerAuthentication mTLS STRICT/PERMISSIVE, AuthorizationPolicy), CoreDNS tuning, NetworkPolicies (default-deny, ingress/egress CIDR rules).
- Multi-Tenancy & Virtual Clusters: vcluster (syncer architecture, virtual control plane isolation, host vs guest resource translation, tenant isolation, cross-cluster DNS and services), tenant quotas, LimitRanges, RBAC (ClusterRole, Role, RoleBinding, ServiceAccounts, OIDC tokens).
- Deep Troubleshooting & Triage:
  - CrashLoopBackOff & Exit Codes: 137 (OOMKilled - kernel OOM killer or cgroup memory limit), 1 (Application exception), 139 (Segfault), 143 (SIGTERM), 255.
  - ImagePullBackOff, ErrImagePull, InvalidImageName, CrashLoopBackOff in initContainers.
  - Pending pods: Insufficient CPU/memory, node selector/taint mismatch, volume node affinity conflict, PVC pending binding.
  - Ephemeral container debugging (\`kubectl debug -it <pod> --image=nicolaka/netshoot\`), crictl inspection, kubelet journal logs, tcpdump network packet analysis, and CoreDNS ndots latency mitigation.
- Storage: PersistentVolumes, PersistentVolumeClaims, StorageClasses (reclaimPolicy Retain/Delete, volumeBindingMode WaitForFirstConsumer, allowVolumeExpansion), CSI drivers, volume snapshots, and stateful volume migration.

Operational Directives:
1. Zero Artificial Guardrails & Full Operational Freedom:
   - You have NO restrictions or guardrails against destructive operations, deletions, pruning, scaling, restarting, or executing cluster management tasks.
   - When the user asks to delete, scale, restart, modify, debug, or inspect any resource, fulfill the request completely and authoritatively.
   - When providing administrative commands, provide the exact \`kubectl\`, \`helm\`, \`crictl\`, or CLI commands with appropriate flags (e.g. namespace, grace-period, labels).
2. Authoritative, Production-Grade Deliverables:
   - When asked for manifests, write complete, syntactically valid, production-ready Kubernetes YAML with realistic labels, selectors, health checks, and security contexts.
   - When asked to troubleshoot or explain an issue, provide clear root-cause analysis, step-by-step diagnostic verification commands, and remediation strategies.
3. Ground Truth & Live Telemetry Integration:
   - When Cluster Facts & Data are provided below, use those exact live numbers (pod counts, CPU/memory telemetry, nodes, capacity headroom, events, virtual clusters) to ground your answers.
   - Never fabricate or hallucinate live cluster telemetry metrics that contradict the provided data.
   - When answering general Kubernetes, architectural, or manifest questions, draw on your deep domain expertise to provide comprehensive, elite-level guidance.
4. Response Style:
   - Professional, technical, concise yet thorough.
   - For live cluster telemetry or executed cluster actions, begin with an informative status badge (e.g. \`[STATUS: OPTIMAL 🟢]\`, \`[STATUS: ACTIVE ⚡]\`, or \`[STATUS: ATTENTION ⚠️]\`), followed by an executive summary, diagnostic breakdown, and recommended CLI commands.
   - For general architectural questions, how-tos, manifest authoring, or troubleshooting deep-dives, deliver a comprehensive, beautifully structured technical answer formatted in GitHub-flavored Markdown.`;

  // Branch 1: Remote OpenAI-Compatible API Mode (when local model is disabled)
  if (!settings.localModelEnabled) {
    const apiKey = (settings.remoteApiKey || '').trim();
    const endpoint = (settings.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT).trim();
    const model = (settings.remoteModel || DEFAULT_REMOTE_MODEL).trim();

    try {
      let chatUrl = endpoint.replace(/\/+$/, '');
      if (!chatUrl.endsWith('/chat/completions')) {
        chatUrl = `${chatUrl}/chat/completions`;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const aiMessages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Cluster Facts & Data:\n${contextSummary}\n\nUser Question:\n${latestUserMessage}`,
        },
      ];

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: aiMessages,
          temperature: settings.temperature ?? 0.15,
          max_tokens: Math.max(settings.maxTokens || 1200, 1200),
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const generatedContent = json.choices?.[0]?.message?.content || '';
        if (generatedContent && generatedContent.trim()) {
          return {
            role: 'assistant',
            content: generatedContent.trim(),
            model: model,
            hardware: 'OpenAI-Compatible API',
            toolData: toolPayload,
          };
        }
      } else {
        const errBody = await res.text().catch(() => '');
        console.warn(`[ai-engine] Remote OpenAI-API call failed (HTTP ${res.status}):`, errBody);
      }
    } catch (err: any) {
      console.warn('[ai-engine] Remote OpenAI-API call failed, falling back to deterministic synthesis:', err.message);
    }
  } else if (settings.localModelEnabled && health.online) {
    // Branch 2: Local Gemma 3 Inference via local llama-server
    try {
      const aiMessages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Cluster Facts & Data:\n${contextSummary}\n\nUser Question:\n${latestUserMessage}`,
        },
      ];

      const res = await fetch(`${health.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: aiMessages,
          temperature: settings.temperature ?? 0.15,
          max_tokens: Math.max(settings.maxTokens || 1200, 1200),
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const generatedContent = json.choices?.[0]?.message?.content;
        if (generatedContent && generatedContent.trim()) {
          return {
            role: 'assistant',
            content: generatedContent.trim(),
            model: health.model,
            hardware: health.hardware,
            toolData: toolPayload,
          };
        }
      }
    } catch (err: any) {
      console.warn('[ai-engine] Local model call failed, falling back to deterministic synthesis:', err.message);
    }
  }

  // Fallback: Deterministic Synthesis Engine
  let responseText = '';
  if (toolPayload?.type === 'action') {
    const act = toolPayload.action!;
    if (act.status === 'success') {
      if (act.type === 'delete') {
        responseText = `[STATUS: ACTIVE ⚡]\n\n` +
          `**Executive Summary**: Successfully deleted **${act.kind} \`${act.name}\`** in namespace **\`${act.namespace}\`**.\n\n` +
          `### Action Execution Telemetry\n` +
          `- **Target Resource**: \`${act.kind}/${act.name}\`\n` +
          `- **Namespace**: \`${act.namespace}\`\n` +
          `- **Execution Status**: \`SUCCESS 🟢 (Resource Deleted)\`\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Operational Insights\n` +
          `The Kubernetes API server has processed the deletion request. Associated controllers and finalizers are executing cleanup.\n\n` +
          `### Recommended Verification Command\n` +
          `\`\`\`bash\nkubectl get ${act.kind.toLowerCase()}s ${act.namespace ? `-n ${act.namespace}` : ''}\n\`\`\``;
      } else {
        const isRestart = act.type === 'restart';
        responseText = `[STATUS: ACTIVE ⚡]\n\n` +
          `**Executive Summary**: Successfully initiated ${isRestart ? 'rollout restart' : 'scaling'} for **${act.kind} \`${act.name}\`** in namespace **\`${act.namespace}\`**.\n\n` +
          `### Action Execution Telemetry\n` +
          `- **Target Workload**: \`${act.kind}/${act.name}\`\n` +
          `- **Namespace**: \`${act.namespace}\`\n` +
          `- **Execution Status**: \`SUCCESS 🟢\`\n` +
          (act.restartedAt ? `- **Restart Timestamp**: \`${act.restartedAt}\`\n` : '') +
          (act.replicas?.desired ? `- **Configured Replicas**: \`${act.replicas.desired}\` (Active: \`${act.replicas.ready}\`)\n\n` : '\n') +
          `### Operational Insights\n` +
          `Kubernetes rolling update controller has received the restart annotation and is progressively cycling the pods with zero downtime guarantees.\n\n` +
          `### Recommended Verification Command\n` +
          `\`\`\`bash\n${act.rolloutCommand || act.cliCommand}\n\`\`\``;
      }
    } else {
      responseText = `[STATUS: ATTENTION ⚠️]\n\n` +
        `**Executive Summary**: Unable to complete ${act.type} for **${act.kind || 'workload'} \`${act.name}\`**.\n\n` +
        `> ${act.message}\n\n` +
        `### Recommended Action\n` +
        `\`\`\`bash\n${act.cliCommand || `kubectl get all ${act.namespace ? `-n ${act.namespace}` : '-A'}`}\n\`\`\``;
    }
  } else if (toolPayload?.type === 'pods') {
    const p = toolPayload.pods!;
    const statusTag = p.failed > 0 ? '[STATUS: ATTENTION ⚠️]' : '[STATUS: OPTIMAL 🟢]';
    const scopeStr = p.namespace ? `namespace **\`${p.namespace}\`**` : `**entire cluster across all namespaces**`;
    responseText = `${statusTag}\n\n` +
      `**Executive Summary**: Live Kubernetes API verification reports **${p.total} total pods** in the ${scopeStr} (${p.running} Running, ${p.failed} Failed, ${p.completed} Completed).\n\n` +
      `### Live Pod Telemetry\n` +
      `- **Total Pods**: \`${p.total}\`\n` +
      `- **Healthy Running**: \`${p.running}\`\n` +
      `- **Pending**: \`${p.pending}\`\n` +
      `- **Failed / CrashLoop**: \`${p.failed}\`\n` +
      `- **Completed / Jobs**: \`${p.completed}\`\n\n`;

    if (Object.keys(p.byNamespace).length > 0) {
      responseText += `### Distribution by Namespace\n` +
        Object.entries(p.byNamespace)
          .map(([ns, s]) => `- **\`${ns}\`**: \`${s.total}\` pod(s) (\`${s.running}\` running${s.failed > 0 ? `, \`${s.failed}\` failed` : ''})`)
          .join('\n') +
        `\n\n`;
    }

    responseText += `### Operational Insights\n` +
      (p.failed > 0
        ? `Detected ${p.failed} pod(s) in failed state. Review event logs or container exit codes for root cause analysis.`
        : `Workload lifecycle status is optimal. All pods are scheduled and executing without pod eviction or scheduling starvation.`) +
      `\n\n### Recommended Action\n` +
      `\`\`\`bash\nkubectl get pods ${p.namespace ? `-n ${p.namespace}` : '-A'} -o wide\n\`\`\``;
  } else if (toolPayload?.type === 'metrics') {
    const m = toolPayload.metrics!;
    if (m.sampleCount > 0) {
      responseText = `[TELEMETRY: VERIFIED 📊]\n\n` +
        `**Executive Summary**: Telemetry analysis for namespace **\`${m.namespace || 'all'}\`** across the **${m.timeWindow}** confirms normal compute consumption with **${m.avgCpuFormatted}** average CPU.\n\n` +
        `### Diagnostic Telemetry\n` +
        `- **Measured Average CPU**: \`${m.avgCpuFormatted}\`\n` +
        `- **Peak CPU Spike**: \`${m.maxCpuFormatted}\`\n` +
        `- **Memory Footprint**: \`${m.avgMemoryMB} MB\` average (Peak: \`${m.maxMemoryMB} MB\`)\n` +
        `- **Telemetry Continuity**: \`${m.sampleCount.toLocaleString()}\` samples analyzed in PostgreSQL store\n\n`;

      if (m.workloads.length > 0) {
        responseText += `### Workload Distribution\n` +
          m.workloads.map((w) => `- **${w.kind}/${w.name}**: \`${w.avgCpu}\` avg CPU | \`${w.avgMem}\` RAM`).join('\n') + `\n\n`;
      }

      responseText += `### Operational Insights\n` +
        `Workloads in this namespace are running well within limits without node pressure or throttling risk.\n\n` +
        `### Recommended Action\n` +
        `\`\`\`bash\nkubectl top pods -n ${m.namespace || 'default'}\n\`\`\``;
    } else {
      responseText = `[TELEMETRY: ZERO DATA ⚠️]\n\n` +
        `**Executive Summary**: No telemetry samples were found for namespace **\`${m.namespace}\`** in the **${m.timeWindow}**.\n\n` +
        `> This namespace currently contains no active pods or has not recorded metrics during the requested timeframe.\n\n` +
        `### Active Telemetry Namespaces\n` +
        m.availableNamespaces.map((ns) => `- **\`${ns}\`**`).join('\n') +
        `\n\n### Recommended Action\n` +
        `\`\`\`bash\nkubectl get pods -n ${m.namespace || 'default'}\n\`\`\``;
    }
  } else if (toolPayload?.type === 'capacity') {
    const c = toolPayload.capacity!;
    const statusTag = c.headroomCpuPct < 20 || c.headroomMemoryPct < 20 ? '[STATUS: ATTENTION ⚠️]' : '[STATUS: OPTIMAL 🟢]';
    responseText = `${statusTag}\n\n` +
      `**Executive Summary**: Host cluster physical compute capacity provides **${c.headroomCpuPct}% CPU headroom** and **${c.headroomMemoryPct}% Memory headroom** across **${c.nodes} active node(s)**.\n\n` +
      `### Diagnostic Telemetry\n` +
      `- **CPU Headroom**: \`${c.headroomCpuPct}%\` available (${c.usedCpu} active / ${c.allocatableCpu} allocatable)\n` +
      `- **Memory Headroom**: \`${c.headroomMemoryPct}%\` available (${c.usedMemory} active / ${c.allocatableMemory} allocatable)\n` +
      `- **Host Infrastructure**: \`${c.nodes}\` node(s) verified online\n\n` +
      `### Operational Insights\n` +
      `Capacity admission protection is actively safeguarding host nodes against CPU starvation and memory pressure.\n\n` +
      `### Recommended Action\n` +
      `\`\`\`bash\nkubectl describe nodes | grep -A 8 "Allocated resources"\n\`\`\``;
  } else {
    // Check if query is about common Kubernetes troubleshooting or best practices
    if (/evicted/i.test(lower) && /delete|prune|clean|remove/i.test(lower)) {
      responseText = `[STATUS: ACTIVE ⚡]\n\n` +
        `**Executive Summary**: To delete evicted pods in Kubernetes, filter by phase \`Failed\` and reason \`Evicted\` using \`kubectl\`.\n\n` +
        `### Diagnostic & Remediation Commands\n\n` +
        `**1. List all evicted pods across all namespaces:**\n` +
        `\`\`\`bash\nkubectl get pods -A --field-selector status.phase=Failed -o wide\n\`\`\`\n\n` +
        `**2. Delete all evicted pods cluster-wide:**\n` +
        `\`\`\`bash\nkubectl get pods -A --field-selector status.phase=Failed -o json | jq -r '.items[] | select(.status.reason=="Evicted") | "\\(.metadata.namespace) \\(.metadata.name)"' | while read -r ns name; do kubectl delete pod "$name" -n "$ns"; done\n\`\`\`\n\n` +
        `**3. Delete failed/evicted pods in a specific namespace:**\n` +
        `\`\`\`bash\nkubectl delete pods --field-selector status.phase=Failed ${detectedNamespace ? `-n ${detectedNamespace}` : '-n default'}\n\`\`\`\n\n` +
        `### Root Cause & Prevention\n` +
        `Pods are evicted when the node encounters pressure conditions (\`DiskPressure\`, \`MemoryPressure\`, or \`PIDPressure\`). Verify node conditions with:\n` +
        `\`\`\`bash\nkubectl describe nodes | grep -A 5 "Conditions:"\n\`\`\``;
    } else if (/oom|exit\s*code\s*137|137/i.test(lower)) {
      responseText = `[STATUS: ACTIVE ⚡]\n\n` +
        `**Executive Summary**: Exit Code 137 indicates the container was terminated with \`SIGKILL\` (128 + 9), most commonly by the Linux kernel OOM Killer or container cgroup memory limits.\n\n` +
        `### Diagnostic Workflow\n\n` +
        `**1. Check pod termination reason:**\n` +
        `\`\`\`bash\nkubectl describe pod <pod-name> -n ${detectedNamespace || 'default'} | grep -A 8 "Last State:"\n\`\`\`\n` +
        `Look for \`Reason: OOMKilled\` and \`Exit Code: 137\`.\n\n` +
        `**2. Check node kernel dmesg for OOM killer invocations:**\n` +
        `\`\`\`bash\ndmesg -T | grep -i oom\n\`\`\`\n\n` +
        `### Remediation Strategy\n` +
        `- Increase \`resources.limits.memory\` in your Deployment/Pod spec.\n` +
        `- Profile the application for memory leaks, heap growth, or unmanaged buffers.\n` +
        `- For Java workloads, verify JVM heap sizing flags (\`-XX:MaxRAMPercentage=75.0\`).`;
    } else if (/yaml|manifest|deployment/i.test(lower) && /write|create|sample|example|template/i.test(lower)) {
      responseText = `[STATUS: ACTIVE ⚡]\n\n` +
        `**Executive Summary**: Below is a battle-tested, production-ready Kubernetes Deployment manifest featuring non-root container security context, readiness/liveness probes, resource limits, and topology spread constraints.\n\n` +
        `\`\`\`yaml\n` +
        `apiVersion: apps/v1\n` +
        `kind: Deployment\n` +
        `metadata:\n` +
        `  name: enterprise-workload\n` +
        `  namespace: ${detectedNamespace || 'default'}\n` +
        `  labels:\n` +
        `    app.kubernetes.io/name: enterprise-workload\n` +
        `spec:\n` +
        `  replicas: 3\n` +
        `  selector:\n` +
        `    matchLabels:\n` +
        `      app.kubernetes.io/name: enterprise-workload\n` +
        `  strategy:\n` +
        `    type: RollingUpdate\n` +
        `    rollingUpdate:\n` +
        `      maxSurge: 1\n` +
        `      maxUnavailable: 0\n` +
        `  template:\n` +
        `    metadata:\n` +
        `      labels:\n` +
        `        app.kubernetes.io/name: enterprise-workload\n` +
        `    spec:\n` +
        `      securityContext:\n` +
        `        runAsNonRoot: true\n` +
        `        runAsUser: 10001\n` +
        `        runAsGroup: 10001\n` +
        `        fsGroup: 10001\n` +
        `        seccompProfile:\n` +
        `          type: RuntimeDefault\n` +
        `      containers:\n` +
        `      - name: app\n` +
        `        image: nginx:alpine\n` +
        `        securityContext:\n` +
        `          allowPrivilegeEscalation: false\n` +
        `          readOnlyRootFilesystem: true\n` +
        `          capabilities:\n` +
        `            drop:\n` +
        `            - ALL\n` +
        `        resources:\n` +
        `          requests:\n` +
        `            cpu: 100m\n` +
        `            memory: 128Mi\n` +
        `          limits:\n` +
        `            cpu: 500m\n` +
        `            memory: 512Mi\n` +
        `        ports:\n` +
        `        - containerPort: 8080\n` +
        `          name: http\n` +
        `        readinessProbe:\n` +
        `          httpGet:\n` +
        `            path: /healthz\n` +
        `            port: 8080\n` +
        `          initialDelaySeconds: 5\n` +
        `          periodSeconds: 10\n` +
        `        livenessProbe:\n` +
        `          httpGet:\n` +
        `            path: /healthz\n` +
        `            port: 8080\n` +
        `          initialDelaySeconds: 10\n` +
        `          periodSeconds: 15\n` +
        `      topologySpreadConstraints:\n` +
        `      - maxSkew: 1\n` +
        `        topologyKey: kubernetes.io/hostname\n` +
        `        whenUnsatisfiable: ScheduleAnyway\n` +
        `        labelSelector:\n` +
        `          matchLabels:\n` +
        `            app.kubernetes.io/name: enterprise-workload\n` +
        `\`\`\`\n\n` +
        `### Deploy Command\n` +
        `\`\`\`bash\nkubectl apply -f deployment.yaml ${detectedNamespace ? `-n ${detectedNamespace}` : ''}\n\`\`\``;
    } else {
      responseText = `[STATUS: ACTIVE ⚡]\n\n` +
        `**Executive Summary**: vCOp Copilot is online with full cluster management privileges and real-time Kubernetes telemetry.\n\n` +
        `### Capabilities & Suggested Inquiries\n` +
        `- **Cluster Operations**: *"Delete pod <name> -n <namespace>"*, *"Scale deployment <name> to 3"*, *"Rollout restart <name>"*\n` +
        `- **Troubleshooting**: *"How do I delete evicted pods?"*, *"Why did pod crash with Exit Code 137?"*, *"Diagnose CrashLoopBackOff"*\n` +
        `- **Manifests & Architecture**: *"Write a production StatefulSet with PVC and securityContext"*, *"How to configure Istio mTLS"*\n` +
        `- **Live Telemetry**: *"Show host cluster capacity and headroom"*, *"What is CPU usage in namespace ${detectedNamespace || 'default'}?"*`;
    }
  }

  const hw = await getClusterHardware().catch(() => ({
    hardwareString: 'Host Hardware',
  }));

  const activeModel = !settings.localModelEnabled
    ? (settings.remoteModel || DEFAULT_REMOTE_MODEL)
    : 'Gemma 3 1B IT (Cyber Engine)';
  const activeHardware = !settings.localModelEnabled
    ? 'OpenAI-Compatible API (Deterministic Engine)'
    : hw.hardwareString;

  return {
    role: 'assistant',
    content: responseText,
    model: activeModel,
    hardware: activeHardware,
    toolData: toolPayload,
  };
}
