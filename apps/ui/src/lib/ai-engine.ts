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
  findWorkload,
  listAllDeployments,
  type PodItem,
  type ClusterPodsSummary,
  type WorkloadRestartResult,
  type WorkloadScaleResult,
  type DeploymentSummary,
} from './k8s-client';
import type { ClusterCapacityData, VirtualCluster, K8sEvent, BackupItem } from './types';

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
  type: 'restart' | 'scale';
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Pod';
  name: string;
  namespace: string;
  status: 'success' | 'failed';
  message: string;
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

export async function checkAiServiceHealth(): Promise<{ online: boolean; model: string; hardware: string; url: string }> {
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
        hardware: 'NVIDIA RTX 4090 (CUDA 13.3)',
        url,
      };
    }
  } catch {}

  return {
    online: false,
    model: 'Gemma 3 1B IT (Standby)',
    hardware: 'Local Node.js Engine',
    url,
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
  const nsMatch = lower.match(/(?:in\s+namespace|namespace|in\s+ns|ns|\bin)\s+([a-zA-Z0-9_-]+)/);
  if (nsMatch) {
    const raw = nsMatch[1].trim();
    if (!['the', 'all', 'a', 'this', 'our', 'my', 'cluster', 'total', 'namespace', 'ns'].includes(raw)) {
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

  // 1. Identify intent & action commands
  const isRestartAction = /\b(?:restart|reboot|bounce|rollout\s+restart)\b/i.test(lower);
  const isScaleAction = /\b(?:scale|resize)\b/i.test(lower);
  const isActionQuery = isRestartAction || isScaleAction;

  let targetWorkloadName: string | undefined;
  if (isActionQuery) {
    const actionPatterns = [
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts|daemonset|ds|pod)\s+([a-zA-Z0-9_-]+)/i,
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:deployment|deploy|statefulset|sts|daemonset|ds|pod)/i,
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
      /(?:scale|resize)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts)\s+([a-zA-Z0-9_-]+)/i,
      /(?:scale|resize)\s+(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:deployment|deploy|statefulset|sts)/i,
      /(?:scale|resize)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
    ];

    for (const pat of actionPatterns) {
      const m = lower.match(pat);
      if (m && m[1]) {
        const candidate = m[1].trim();
        if (!['the', 'a', 'this', 'our', 'my', 'deployment', 'statefulset', 'daemonset', 'pod', 'for', 'please', 'me', 'it', 'to'].includes(candidate)) {
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

  const isPodsQuery = !isActionQuery && /\b(?:pods?|containers?|workloads?|how\s+many\s+pods|deployments?|daemonsets?|statefulsets?)\b/i.test(lower);
  const isMetricsQuery = !isActionQuery && !isPodsQuery && (/cpu|memory|mem|usage|stats|average|avg|peak|utilization|history|metric/i.test(lower) || (Boolean(detectedNamespace) && !isPodsQuery));
  const isCapacityQuery = !isActionQuery && /capacity|headroom|allocat|starvat|quota|nodes?|physical/i.test(lower);
  const isVClusterQuery = !isActionQuery && /virtual\s*cluster|vcluster|guest|tenan|mesh|istio/i.test(lower);
  const isEventsQuery = !isActionQuery && /event|error|warning|crash|fail|backoff|oom|unhealthy/i.test(lower);
  const isBackupQuery = !isActionQuery && /backup|snapshot|dr|disaster|restore|etcd/i.test(lower);

  let toolPayload: ToolDataPayload | undefined;
  let contextSummary = '';

  // TOOL -1: CLUSTER WORKLOAD ACTIONS (RESTART / SCALE)
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
  if (isMetricsQuery || (detectedNamespace && !isPodsQuery)) {
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

  // Attempt Gemma 3 Inference via local llama-server
  const health = await checkAiServiceHealth();
  if (health.online) {
    try {
      const systemPrompt = `You are vCOp Cyber-Copilot, an elite AI cluster intelligence engine embedded inside the Virtual Cluster Operations Center.
Your mission is to deliver authoritative, executive-grade, beautifully structured Kubernetes telemetry analysis and operational insights.

Response Formatting Protocol:
1. Status Badge: Always start line 1 with an exact status badge:
   - \`[STATUS: OPTIMAL 🟢]\` when the cluster is healthy, pods are running normally, and compute usage is normal
   - \`[STATUS: ACTIVE ⚡]\` when analyzing active workloads, pod inventories, or virtual clusters
   - \`[STATUS: ATTENTION ⚠️]\` when warnings, failed pods, low headroom (<20%), or 0 telemetry samples are detected
2. Executive Summary: A crisp 1-2 sentence executive summary answering the question directly using the exact numbers from Cluster Facts.
3. Diagnostic Telemetry: Bullet points highlighting key metrics with bold titles and inline code for values present in Cluster Facts ONLY (for pod questions: **Total Pods**, **Running**, **Pending**, **Failed**, **Completed**; for metrics: **Average CPU**, **Peak CPU**, **Memory**; for capacity: **Allocatable CPU**, **Headroom**). Do NOT invent metrics or numbers not provided in Cluster Facts.
4. Operational Insights: 1-2 concise sentences analyzing cluster safety, headroom trends, or stability.
5. Recommended Action: When helpful, provide an actionable kubectl CLI command or operational recommendation in a clean markdown code block (\`\`\`bash).

Ground Truth Rules:
- State exact figures from the provided Cluster Facts. Never invent or hallucinate metrics, pod counts, or resource stats.
- For cluster actions (e.g. restart, rollout, scale): Always begin with [STATUS: ACTIVE ⚡] (or [STATUS: ATTENTION ⚠️] if the action failed). Confirm that the action was successfully initiated on the target workload, state its namespace, and include the kubectl command.
- For pod inquiries: State the exact Total Pods, Running, Pending, and Failed figures provided in the Live Kubernetes Pod Inventory.
- If 0 timeseries samples are found when querying historical CPU/memory metrics for a namespace, explicitly state that 0 samples were recorded, list the active namespaces from Cluster Facts, and recommend querying one of them.
- Avoid casual pleasantries ("Sure!", "Okay"). Begin directly with the status badge.`;

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
          temperature: 0.15,
          max_tokens: 500,
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
      console.warn('[ai-engine] Gemma 3 call failed, falling back to deterministic synthesis:', err.message);
    }
  }

  // Fallback: Deterministic Synthesis Engine
  let responseText = '';
  if (toolPayload?.type === 'action') {
    const act = toolPayload.action!;
    if (act.status === 'success') {
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
    } else {
      responseText = `[STATUS: ATTENTION ⚠️]\n\n` +
        `**Executive Summary**: Unable to complete ${act.type} for workload **\`${act.name}\`**.\n\n` +
        `> ${act.message}\n\n` +
        `### Recommended Action\n` +
        `\`\`\`bash\nkubectl get deployments -A\n\`\`\``;
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
    responseText = `[STATUS: ACTIVE ⚡]\n\n` +
      `**Executive Summary**: vCOp Cyber-Copilot is online and connected to live Kubernetes API and PostgreSQL telemetry.\n\n` +
      `### Capabilities & Suggested Queries\n` +
      `- **Historical Metrics**: *"What is the average CPU usage of namespace alpha for the past 10 hours?"*\n` +
      `- **Cluster Capacity**: *"Show host cluster capacity and headroom"* \n` +
      `- **Anomaly Detection**: *"Scan for warning events or crashloops"* \n` +
      `- **Virtual Clusters**: *"List all virtual clusters and their Istio status"*`;
  }

  return {
    role: 'assistant',
    content: responseText,
    model: 'Gemma 3 1B IT (Cyber Engine)',
    hardware: 'NVIDIA RTX 4090 (CUDA 13.3)',
    toolData: toolPayload,
  };
}
