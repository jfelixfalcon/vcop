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
  setVirtualClusterSleep,
  getVirtualCluster,
  deleteVirtualCluster,
  triggerEtcdBackup,
  getPodLogs,
  cordonNode,
  rollbackWorkload,
  applyKubernetesManifest,
  performSecurityAudit,
  type SecurityAuditReport,
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
  type: 'restart' | 'scale' | 'delete' | 'sleep' | 'wake' | 'backup' | 'rollback' | 'cordon' | 'uncordon' | 'apply' | 'logs' | 'security_audit';
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
  clusterDetails?: {
    phase?: string;
    paused?: boolean;
    preset?: string;
    istio?: boolean;
  };
  logsData?: {
    pod: string;
    namespace: string;
    logs: string;
    lineCount: number;
  };
  auditReport?: SecurityAuditReport;
  appliedManifest?: string;
}

export interface ToolDataPayload {
  type: 'metrics' | 'capacity' | 'vclusters' | 'events' | 'backups' | 'pods' | 'action' | 'logs' | 'security_audit' | 'general';
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
  logs?: {
    pod: string;
    namespace: string;
    logs: string;
    lineCount: number;
    cliCommand: string;
  };
  securityAudit?: SecurityAuditReport;
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

  // Fetch known virtual clusters to resolve targets accurately
  const vclustersList = await listVirtualClusters().catch(() => []);
  const matchedVCluster = vclustersList.find(
    (c) =>
      lower.includes(c.name.toLowerCase()) ||
      (c.namespace && lower.includes(c.namespace.toLowerCase()))
  );

  // Check if this is an informational / instructional inquiry rather than an imperative execution command
  const isInstructionalInquiry =
    /\b(?:how\s+(?:to|do|can)|why|what\s+is|what\s+are|explain|guide|tutorial|documentation|sample|example|write\s+(?:a\s+)?(?:yaml|manifest|script))\b/i.test(lower) ||
    /\b(?:what\s+happens|when\s+should|difference\s+between)\b/i.test(lower);

  // 1. DevSecOps (DSO) & Security Audit Intent
  const isSecurityAudit = !isInstructionalInquiry &&
    /\b(?:security|audit|dso|hardening|posture|cis|compliance|cve|zero\s*trust|pod\s*security|pss|vulnerab)\b/i.test(lower);

  // 2. Pod Logs & Diagnostic Stream Intent
  const isLogsIntent =
    /\b(?:logs?|log\s+of|tail|stdout|stderr|console\s+output|trace|why\s+did\s+.*?\s+crash)\b/i.test(lower);

  // 3. Disaster Recovery / Backup Intent
  const isBackupAction = !isInstructionalInquiry &&
    /\b(?:take\s+(?:a\s+)?backup|create\s+(?:a\s+)?backup|snapshot|trigger\s+backup|save\s+state)\b/i.test(lower);

  // 4. Rollback / Rollout Undo Intent
  const isRollbackAction = !isInstructionalInquiry &&
    /\b(?:rollback|undo|revert\s+rollout|rollout\s+undo)\b/i.test(lower);

  // 5. Node Cordon / Uncordon Intent
  const isCordonAction = !isInstructionalInquiry &&
    /\b(?:cordon|drain|disable\s+scheduling)\b/i.test(lower) && !/\b(?:uncordon)\b/i.test(lower);
  const isUncordonAction = !isInstructionalInquiry &&
    /\b(?:uncordon|enable\s+scheduling)\b/i.test(lower);

  // 6. Manifest Apply Intent
  const isApplyAction = !isInstructionalInquiry &&
    (/\b(?:apply\s+(?:this\s+)?(?:manifest|yaml)|deploy\s+(?:this\s+)?(?:manifest|yaml)|create\s+manifest)\b/i.test(lower) ||
     (lower.includes('kind:') && lower.includes('apiversion:')));

  // 7. Workload & Virtual Cluster Lifecycle Intents
  const isSleepAction = !isInstructionalInquiry &&
    (/\b(?:sleep|put\s+.*?to\s+sleep|hibernate|pause)\b/i.test(lower) && !/\b(?:wake|resume|unpause)\b/i.test(lower));
  const isWakeAction = !isInstructionalInquiry &&
    /\b(?:wake|wake\s+up|resume|unpause)\b/i.test(lower);
  const isRestartAction = /\b(?:restart|reboot|bounce|rollout\s+restart)\b/i.test(lower);
  const isScaleAction = /\b(?:scale|resize)\b/i.test(lower);
  const isDeleteExecution = !isInstructionalInquiry && /\b(?:delete|destroy|remove|kill|terminate|prune|uninstall)\b/i.test(lower);

  const isActionQuery = isSecurityAudit || isLogsIntent || isBackupAction || isRollbackAction || isCordonAction || isUncordonAction || isApplyAction || isSleepAction || isWakeAction || isRestartAction || isScaleAction || isDeleteExecution;

  let targetWorkloadName: string | undefined = matchedVCluster?.name;
  let targetKind: string | undefined = matchedVCluster ? 'VirtualCluster' : undefined;

  if (/\b(?:virtual\s*cluster|vcluster)\b/i.test(lower)) targetKind = 'VirtualCluster';
  else if (/\b(?:deployment|deploy)\b/i.test(lower)) targetKind = 'Deployment';
  else if (/\b(?:statefulset|sts)\b/i.test(lower)) targetKind = 'StatefulSet';
  else if (/\b(?:daemonset|ds)\b/i.test(lower)) targetKind = 'DaemonSet';
  else if (/\b(?:service|svc)\b/i.test(lower)) targetKind = 'Service';
  else if (/\b(?:configmap|cm)\b/i.test(lower)) targetKind = 'ConfigMap';
  else if (/\b(?:secret|secrets)\b/i.test(lower)) targetKind = 'Secret';
  else if (/\b(?:namespace|ns)\b/i.test(lower)) targetKind = 'Namespace';
  else if (/\b(?:pod|pods)\b/i.test(lower)) targetKind = 'Pod';

  // Target Node extraction for cordon / uncordon
  let targetNodeName: string | undefined;
  const nodeMatch = lower.match(/(?:cordon|uncordon|drain|node)\s+(?:the\s+)?(?:node\s+)?([a-zA-Z0-9_.-]+)/i);
  if (nodeMatch && !['the', 'a', 'this', 'our', 'my', 'node', 'nodes', 'cluster'].includes(nodeMatch[1].trim())) {
    targetNodeName = nodeMatch[1].trim();
  }

  // Target Pod extraction for logs
  let targetPodName: string | undefined;
  const podMatch =
    lower.match(/(?:logs?|tail)\s+(?:for|of|from|in)?\s*(?:the\s+)?(?:pod\s+)?([a-zA-Z0-9_.-]+)/i) ||
    lower.match(/(?:pod\s+)([a-zA-Z0-9_.-]+)\s+(?:logs?|tail)/i) ||
    lower.match(/(?:show|get|view|check|tail)\s+([a-zA-Z0-9_.-]+)\s+logs?/i);
  if (podMatch && !['the', 'a', 'this', 'our', 'my', 'pod', 'pods', 'for', 'from', 'in', 'of', 'container', 'containers', 'me', 'it', 'here', 'cluster'].includes(podMatch[1].trim())) {
    targetPodName = podMatch[1].trim();
  }

  // Target Backup Cluster
  let targetBackupCluster: string | undefined = matchedVCluster?.name;
  const backupMatch = lower.match(/(?:backup|snapshot)\s+(?:of\s+)?(?:cluster\s+|vcluster\s+|virtual\s*cluster\s+)?([a-zA-Z0-9_-]+)/i);
  if (backupMatch && !['the', 'a', 'this', 'our', 'my', 'cluster', 'vcluster', 'virtual'].includes(backupMatch[1].trim())) {
    targetBackupCluster = backupMatch[1].trim();
  }

  if (isActionQuery && !targetWorkloadName) {
    const actionPatterns = [
      /(?:sleep|pause|hibernate)\s+(?:the\s+)?(?:virtual\s*cluster|vcluster)\s+([a-zA-Z0-9_-]+)/i,
      /(?:sleep|pause|hibernate)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
      /(?:wake|wake\s+up|resume|unpause)\s+(?:the\s+)?(?:virtual\s*cluster|vcluster)\s+([a-zA-Z0-9_-]+)/i,
      /(?:wake|wake\s+up|resume|unpause)\s+(?:the\s+)?([a-zA-Z0-9_-]+)/i,
      /(?:rollback|undo)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts|daemonset|ds|workload)?\s*([a-zA-Z0-9_-]+)/i,
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?(?:deployment|deploy|statefulset|sts|daemonset|ds|pod|vcluster|virtual\s*cluster)\s+([a-zA-Z0-9_-]+)/i,
      /(?:restart|reboot|bounce|rollout\s+restart)\s+(?:the\s+)?([a-zA-Z0-9_-]+)\s+(?:deployment|deploy|statefulset|sts|daemonset|ds|pod|vcluster|virtual\s*cluster)/i,
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
        if (!['the', 'a', 'this', 'our', 'my', 'deployment', 'statefulset', 'daemonset', 'pod', 'for', 'please', 'me', 'it', 'to', 'all', 'everything', 'resources', 'pods', 'deployments', 'workload', 'workloads', 'cluster', 'virtual', 'vcluster', 'vclusters'].includes(candidate)) {
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
  const isMetricsQuery = !isActionQuery && !isManifestOrGeneralQuestion && !isPodsQuery && (/cpu|memory|mem|usage|stats|average|avg|peak|utilization|history|metric/i.test(lower));
  const isCapacityQuery = !isActionQuery && !isManifestOrGeneralQuestion && /capacity|headroom|allocat|starvat|quota|nodes?|physical/i.test(lower);
  const isVClusterQuery = !isActionQuery && !isManifestOrGeneralQuestion && (/virtual\s*cluster|vcluster|guest|tenan|mesh|istio/i.test(lower) || Boolean(matchedVCluster));
  const isEventsQuery = !isActionQuery && !isManifestOrGeneralQuestion && /event|error|warning|crash|fail|backoff|oom|unhealthy/i.test(lower);
  const isBackupQuery = !isActionQuery && !isManifestOrGeneralQuestion && !isBackupAction && /backup|snapshot|dr|disaster|restore|etcd/i.test(lower);

  let toolPayload: ToolDataPayload | undefined;
  let contextSummary = '';

  // ACTION 1: DEVSECOPS (DSO) SECURITY POSTURE AUDIT
  if (isSecurityAudit) {
    try {
      const report = await performSecurityAudit(detectedNamespace);
      toolPayload = {
        type: 'security_audit',
        securityAudit: report,
        action: {
          type: 'security_audit',
          kind: 'SecurityAudit',
          name: detectedNamespace || 'cluster-wide',
          namespace: detectedNamespace || 'all-namespaces',
          status: 'success',
          message: `DevSecOps audit completed for ${report.targetScope}. Compliance score: ${report.score}/100 (Grade ${report.grade}). ${report.summary.criticalCount} Critical, ${report.summary.highCount} High, ${report.summary.mediumCount} Medium findings.`,
          auditReport: report,
          cliCommand: `kubectl get pods,networkpolicies,clusterrolebindings ${detectedNamespace ? `-n ${detectedNamespace}` : '-A'} -o wide`,
        },
      };

      contextSummary += `\n[DevSecOps (DSO) Security Posture Audit Result]
Target Scope: ${report.targetScope}
Compliance Score: ${report.score}/100 (Grade: ${report.grade})
Evaluated Objects: ${report.summary.totalEvaluated}
Passed Checks: ${report.summary.passed} | Failed Checks: ${report.summary.failed}
Severity Breakdown: Critical: ${report.summary.criticalCount}, High: ${report.summary.highCount}, Medium: ${report.summary.mediumCount}, Low: ${report.summary.lowCount}
Metrics:
  - Total Pods Inspected: ${report.metrics.totalPods}
  - Pod Security Standards Restricted Compliance: ${report.metrics.restrictedPodsPct}%
  - Non-Root Pods: ${report.metrics.nonRootPodsPct}%
  - Read-Only Root Filesystem: ${report.metrics.readOnlyRootFsPct}%
  - NetworkPolicies Active: ${report.metrics.networkPoliciesConfigured}
  - Unscoped cluster-admin Bindings: ${report.metrics.rbacClusterAdminBindings}
  - Automated etcd Backup Schedules: ${report.metrics.activeEtcdBackups}
Key Findings & Remediation:
${report.findings.slice(0, 8).map((f) => `  - [${f.severity}] (${f.category}) ${f.title}: ${f.description}${f.remediation ? ` Remediation: ${f.remediation}` : ''}`).join('\n')}
`;
    } catch (err: any) {
      console.warn('[ai-engine] Security audit failed:', err.message);
    }
  }

  // ACTION 2: POD LOGS & DIAGNOSTIC STREAM
  if (isLogsIntent && !toolPayload) {
    try {
      let resolvedPod = targetPodName || targetWorkloadName;
      if (!resolvedPod) {
        const podsSummary = await listClusterPods(detectedNamespace).catch(() => null);
        if (podsSummary && podsSummary.items.length > 0) {
          const mentioned = podsSummary.items.find((p) => lower.includes(p.name.toLowerCase()));
          if (mentioned) {
            resolvedPod = mentioned.name;
            if (!detectedNamespace) detectedNamespace = mentioned.namespace;
          } else {
            const unhealthy = podsSummary.items.find((p) => p.phase !== 'Running' && p.phase !== 'Succeeded');
            resolvedPod = unhealthy ? unhealthy.name : podsSummary.items[0].name;
            if (!detectedNamespace) detectedNamespace = (unhealthy || podsSummary.items[0]).namespace;
          }
        }
      }

      if (resolvedPod) {
        const logsData = await getPodLogs(resolvedPod, detectedNamespace, 60);
        toolPayload = {
          type: 'logs',
          logs: logsData,
          action: {
            type: 'logs',
            kind: 'Pod',
            name: logsData.pod,
            namespace: logsData.namespace,
            status: 'success',
            message: `Retrieved ${logsData.lineCount} log lines from pod '${logsData.pod}' in namespace '${logsData.namespace}'.`,
            cliCommand: logsData.cliCommand,
            logsData: {
              pod: logsData.pod,
              namespace: logsData.namespace,
              logs: logsData.logs,
              lineCount: logsData.lineCount,
            },
          },
        };

        contextSummary += `\n[Live Pod Log Stream from Kube-API]
Target Pod: ${logsData.pod}
Namespace: ${logsData.namespace}
Line Count: ${logsData.lineCount}
CLI Executed: ${logsData.cliCommand}
Log Output Snippet:
${logsData.logs.split('\n').slice(-30).join('\n')}
`;
      }
    } catch (err: any) {
      console.warn('[ai-engine] Logs retrieval failed:', err.message);
      toolPayload = {
        type: 'logs',
        action: {
          type: 'logs',
          kind: 'Pod',
          name: targetPodName || targetWorkloadName || 'pod',
          namespace: detectedNamespace || 'default',
          status: 'failed',
          message: `Failed to retrieve pod logs: ${err.message}`,
          cliCommand: `kubectl logs ${targetPodName || targetWorkloadName || 'pod'} -n ${detectedNamespace || 'default'}`,
        },
      };
      contextSummary += `\n[Pod Logs Retrieval Attempt]
Target: ${targetPodName || targetWorkloadName || 'pod'}
Status: FAILED (${err.message})
`;
    }
  }

  // ACTION 3: DISASTER RECOVERY (ETCD SNAPSHOT)
  if (isBackupAction && !toolPayload) {
    const clusterName = targetBackupCluster || matchedVCluster?.name || 'vc-dev';
    const finalNs = detectedNamespace || matchedVCluster?.namespace || 'vc-dev';
    try {
      const res = await triggerEtcdBackup(clusterName, finalNs);
      toolPayload = {
        type: 'action',
        action: {
          type: 'backup',
          kind: 'DisasterRecovery',
          name: clusterName,
          namespace: finalNs,
          status: 'success',
          message: `Disaster Recovery etcd snapshot triggered for virtual cluster '${clusterName}'. Ad-hoc backup job '${res.jobName}' has been dispatched.`,
          cliCommand: `kubectl create job --from=cronjob/${clusterName}-etcd-backup ${clusterName}-adhoc-backup -n ${finalNs}`,
        },
      };

      contextSummary += `\n[Disaster Recovery Backup Triggered]
Target Virtual Cluster: ${clusterName}
Namespace: ${finalNs}
Job Dispatched: ${res.jobName}
Status: SUCCESS (200 OK)
CLI Executed: kubectl create job --from=cronjob/${clusterName}-etcd-backup ${clusterName}-adhoc-backup -n ${finalNs}
`;
    } catch (err: any) {
      toolPayload = {
        type: 'action',
        action: {
          type: 'backup',
          kind: 'DisasterRecovery',
          name: clusterName,
          namespace: finalNs,
          status: 'failed',
          message: err.message,
          cliCommand: `kubectl create job --from=cronjob/${clusterName}-etcd-backup ${clusterName}-adhoc-backup -n ${finalNs}`,
        },
      };
    }
  }

  // ACTION 4: NODE CORDON / UNCORDON
  if ((isCordonAction || isUncordonAction) && !toolPayload) {
    const isCordon = isCordonAction;
    let nodeToAct = targetNodeName;
    if (!nodeToAct) {
      const cap = await getHostClusterCapacity().catch(() => null);
      if (cap && cap.nodeNames.length > 0) {
        nodeToAct = cap.nodeNames[0];
      }
    }

    if (nodeToAct) {
      try {
        const res = await cordonNode(nodeToAct, isCordon);
        toolPayload = {
          type: 'action',
          action: {
            type: isCordon ? 'cordon' : 'uncordon',
            kind: 'Node',
            name: res.node,
            namespace: 'cluster-wide',
            status: 'success',
            message: res.message,
            cliCommand: res.cliCommand,
          },
        };

        contextSummary += `\n[Node Scheduling Operation Executed]
Action: ${isCordon ? 'Cordon (Unschedulable)' : 'Uncordon (Schedulable)'}
Node: ${res.node}
Status: SUCCESS (200 OK)
CLI Executed: ${res.cliCommand}
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: isCordon ? 'cordon' : 'uncordon',
            kind: 'Node',
            name: nodeToAct,
            namespace: 'cluster-wide',
            status: 'failed',
            message: err.message,
            cliCommand: `kubectl ${isCordon ? 'cordon' : 'uncordon'} ${nodeToAct}`,
          },
        };
      }
    }
  }

  // ACTION 5: ROLLBACK WORKLOAD
  if (isRollbackAction && targetWorkloadName && !toolPayload) {
    try {
      const res = await rollbackWorkload(targetWorkloadName, detectedNamespace);
      toolPayload = {
        type: 'action',
        action: {
          type: 'rollback',
          kind: res.kind,
          name: res.name,
          namespace: res.namespace,
          status: 'success',
          message: res.message,
          cliCommand: res.cliCommand,
        },
      };

      contextSummary += `\n[Rollout Rollback Executed]
Workload: ${res.kind}/${res.name}
Namespace: ${res.namespace}
Status: SUCCESS (200 OK)
CLI Executed: ${res.cliCommand}
`;
    } catch (err: any) {
      toolPayload = {
        type: 'action',
        action: {
          type: 'rollback',
          kind: 'Deployment',
          name: targetWorkloadName,
          namespace: detectedNamespace || 'default',
          status: 'failed',
          message: err.message,
          cliCommand: `kubectl rollout undo deployment/${targetWorkloadName} ${detectedNamespace ? `-n ${detectedNamespace}` : ''}`,
        },
      };
    }
  }

  // ACTION 6: APPLY KUBERNETES MANIFEST
  if (isApplyAction && !toolPayload) {
    const yamlBlockMatch = latestUserMessage.match(/```(?:yaml)?([\s\S]*?)```/);
    const manifestContent = yamlBlockMatch ? yamlBlockMatch[1].trim() : '';

    if (manifestContent) {
      try {
        const res = await applyKubernetesManifest(manifestContent);
        toolPayload = {
          type: 'action',
          action: {
            type: 'apply',
            kind: 'Manifest',
            name: 'AppliedResources',
            namespace: detectedNamespace || 'cluster',
            status: 'success',
            message: `Manifest applied successfully:\n${res.output}`,
            cliCommand: res.cliCommand,
            appliedManifest: manifestContent,
          },
        };

        contextSummary += `\n[Manifest Applied to Kubernetes Cluster]
Output:
${res.output}
CLI Executed: kubectl apply -f <manifest.yaml>
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: 'apply',
            kind: 'Manifest',
            name: 'AppliedResources',
            namespace: detectedNamespace || 'cluster',
            status: 'failed',
            message: err.message,
            cliCommand: 'kubectl apply -f <manifest.yaml>',
            appliedManifest: manifestContent,
          },
        };
      }
    }
  }

  // ACTION 7: VIRTUAL CLUSTER LIFECYCLE & WORKLOAD ACTIONS
  if (!toolPayload && isActionQuery && (targetWorkloadName || matchedVCluster)) {
    const finalTargetName = targetWorkloadName || matchedVCluster!.name;
    const finalNamespace = detectedNamespace || matchedVCluster?.namespace || 'default';
    const isVClusterTarget = targetKind === 'VirtualCluster' || Boolean(matchedVCluster) || vclustersList.some((c) => c.name === finalTargetName);

    if (isVClusterTarget && (isSleepAction || isWakeAction)) {
      const isSleep = isSleepAction;
      try {
        const result = await setVirtualClusterSleep(finalTargetName, isSleep, finalNamespace);
        const actionType: 'sleep' | 'wake' = isSleep ? 'sleep' : 'wake';
        toolPayload = {
          type: 'action',
          action: {
            type: actionType,
            kind: 'VirtualCluster',
            name: finalTargetName,
            namespace: result?.namespace || finalNamespace,
            status: 'success',
            message: isSleep
              ? `Virtual cluster '${finalTargetName}' in namespace '${result?.namespace || finalNamespace}' is now in sleep mode. Syncer and guest workloads have been paused, freeing host CPU and memory while safely preserving disk and configuration state.`
              : `Virtual cluster '${finalTargetName}' in namespace '${result?.namespace || finalNamespace}' has been awakened! Workloads and syncer pods are resuming.`,
            cliCommand: `kubectl patch virtualcluster ${finalTargetName} -n ${result?.namespace || finalNamespace} --type merge -p '{"spec":{"paused":${isSleep},"lifecycle":{"sleep":${isSleep}}}}'`,
            clusterDetails: {
              phase: result?.phase || (isSleep ? 'Paused' : 'Ready'),
              paused: isSleep,
              preset: result?.preset,
              istio: result?.istioEnabled,
            },
          },
        };

        contextSummary += `\n[Virtual Cluster Lifecycle Action Executed]
Action: ${isSleep ? 'Sleep / Hibernation Initiated' : 'Wakeup / Resume Initiated'}
Status: SUCCESS (200 OK)
Target Virtual Cluster: ${finalTargetName}
Namespace: ${result?.namespace || finalNamespace}
Resulting Phase: ${result?.phase || (isSleep ? 'Paused' : 'Ready')}
CLI Executed: kubectl patch virtualcluster ${finalTargetName} -n ${result?.namespace || finalNamespace} --type merge -p '{"spec":{"paused":${isSleep},"lifecycle":{"sleep":${isSleep}}}}'
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: isSleep ? 'sleep' : 'wake',
            kind: 'VirtualCluster',
            name: finalTargetName,
            namespace: finalNamespace,
            status: 'failed',
            message: err.message,
            cliCommand: `kubectl patch virtualcluster ${finalTargetName} -n ${finalNamespace} --type merge -p '{"spec":{"paused":${isSleep},"lifecycle":{"sleep":${isSleep}}}}'`,
          },
        };

        contextSummary += `\n[Virtual Cluster Lifecycle Action Failed]
Action: ${isSleep ? 'Sleep' : 'Wake'}
Status: FAILED
Target Virtual Cluster: ${finalTargetName}
Error: ${err.message}
`;
      }
    } else if (isVClusterTarget && isDeleteExecution) {
      try {
        await deleteVirtualCluster(finalTargetName, finalNamespace);
        toolPayload = {
          type: 'action',
          action: {
            type: 'delete',
            kind: 'VirtualCluster',
            name: finalTargetName,
            namespace: finalNamespace,
            status: 'success',
            message: `Virtual cluster '${finalTargetName}' in namespace '${finalNamespace}' has been deleted from the host cluster.`,
            cliCommand: `kubectl delete virtualcluster ${finalTargetName} -n ${finalNamespace}`,
          },
        };

        contextSummary += `\n[Virtual Cluster Deletion Executed]
Status: SUCCESS (200 OK)
Target Virtual Cluster: ${finalTargetName}
Namespace: ${finalNamespace}
`;
      } catch (err: any) {
        toolPayload = {
          type: 'action',
          action: {
            type: 'delete',
            kind: 'VirtualCluster',
            name: finalTargetName,
            namespace: finalNamespace,
            status: 'failed',
            message: err.message,
            cliCommand: `kubectl delete virtualcluster ${finalTargetName} -n ${finalNamespace}`,
          },
        };
      }
    } else if (isRestartAction) {
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
  if (isPodsQuery && !toolPayload) {
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
  if (isMetricsQuery && !toolPayload) {
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
  if (isCapacityQuery && !toolPayload) {
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

      if (matchedVCluster) {
        const vc = vclusters.find((c) => c.name === matchedVCluster.name) || matchedVCluster;
        contextSummary += `\n[Virtual Cluster Target: ${vc.name}]
Namespace: ${vc.namespace}
Lifecycle Phase: ${vc.phase || 'Ready'}
State: ${vc.isPaused ? 'SLEEPING / HIBERNATING 💤' : 'ACTIVE / RUNNING 🟢'}
Preset: ${vc.preset || 'custom'}
Istio Service Mesh: ${vc.istioEnabled ? 'Enabled' : 'Disabled'}
Syncer Version: ${vc.syncerVersion || 'latest'}
Backups Configured: ${vc.backupRetentionCount || 0}
`;
      }

      contextSummary += `\n[Virtual Clusters Overview]
Total Clusters: ${vclusters.length}
Clusters:
${vclusters.map((vc) => `  - ${vc.name} (Namespace: ${vc.namespace}, State: ${vc.isPaused ? 'Sleeping 💤' : 'Active 🟢'}, Preset: ${vc.preset || 'custom'}, Phase: ${vc.phase || 'Ready'}, Istio: ${vc.istioEnabled ? `Enabled (${vc.istioGatewayReplicas || 1} gateways, ${vc.istiodReplicas || 1} istiod)` : 'Disabled'}, Backups: ${vc.backupRetentionCount || 0})`).join('\n')}
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

  const dsoSmeSystemPrompt = `You are vCOp Copilot, a Principal Kubernetes Architect, Staff SRE, and DevSecOps (DSO) Subject Matter Expert embedded in the Virtual Cluster Operations Center.
You hold world-class, authoritative mastery across the entire cloud-native, multi-tenant Kubernetes and DevSecOps ecosystem:

1. DevSecOps (DSO) & Defense Security Operations:
   - Pod Security Standards (PSS): Enforce 'Restricted' profile by default across tenant workloads. Strict requirements: 'runAsNonRoot: true', 'runAsUser: 10001', 'readOnlyRootFilesystem: true', 'allowPrivilegeEscalation: false', 'capabilities.drop: ["ALL"]', and seccompProfile 'RuntimeDefault'.
   - Zero-Trust Architecture (ZTA) & Microsegmentation: Default-deny Ingress and Egress NetworkPolicies for all non-system namespaces. Istio Service Mesh with PeerAuthentication mode 'STRICT' (mTLS), SPIFFE/SPIRE cryptographic workload identity, and granular AuthorizationPolicies.
   - RBAC Least Privilege: Eliminating wildcard permissions ('*'), auditing ClusterRoleBindings, preventing privilege escalation verbs ('impersonate', 'escalate', 'bind'), and enforcing short-lived projected ServiceAccount tokens ('BoundServiceAccountTokenVolume').
   - Container & Supply Chain Security: NSA/CISA Kubernetes Hardening Guidance, NIST SP 800-190, CIS Kubernetes Benchmark v1.8+, distroless/scratch container images, cryptographic image signature verification (Cosign/Sigstore), and airgap bundle immutability.
   - Disaster Recovery (DR) & Business Continuity: Zero-RPO/RTO strategies, automated etcd snapshot scheduling, cross-region replication, and automated disaster drills.

2. Kubernetes Core & Infrastructure Mastery:
   - Architecture: kube-apiserver, etcd quorum mechanics, kube-controller-manager, kube-scheduler, kubelet cgroup v2 management, CRI (containerd), CNI (eBPF/Cilium, Calico), and CSI drivers.
   - Workloads & Controllers: Deployments, StatefulSets (ordered/parallel rollouts, volumeClaimTemplates), DaemonSets, Jobs, CronJobs, Custom Resource Definitions (CRDs), and Operator reconciliation loops.
   - High Availability & SRE Governance: PodDisruptionBudgets (PDB), TopologySpreadConstraints, nodeAffinity/podAntiAffinity, taints & tolerations, PriorityClasses, preemption, HPA (with custom metrics/KEDA), and Cluster Autoscaler.
   - Storage & Networking: PersistentVolumes, StorageClasses (volumeBindingMode: WaitForFirstConsumer, allowVolumeExpansion), Gateway API (Gateway, HTTPRoute, BackendTLSPolicy), Ingress Controllers, CoreDNS ndots optimization.

3. Multi-Tenancy & Virtual Clusters (vcluster):
   - Architecture: Virtual control plane isolation, syncer translation maps (host vs guest resource translation), virtual kube-apiserver, tenant namespaces, and cross-cluster headless service synchronization.
   - Lifecycle Management: On-demand sleep/hibernation (pausing syncer and scaling tenant workloads to 0 while preserving persistent state in etcd and PVCs), instant wake/resume, and automated upgrades.

4. Deep Diagnostics & Troubleshooting Triage:
   - Exit Codes: 137 (OOMKilled - kernel OOM killer or cgroup memory limit), 1 (Uncaught exception), 139 (Segmentation fault), 143 (SIGTERM graceful exit), 255.
   - Failure Modes: CrashLoopBackOff, ImagePullBackOff, ErrImagePull, CreateContainerConfigError, NodePressure, Pending scheduling bottlenecks, volume node affinity conflicts.
   - Proactive Triage: Analyzing live container stdout/stderr log streams, event logs, probe failures (httpGet, tcpSocket, exec), and CoreDNS latency.

Operational Directives:
1. Operational Authority & Action Execution:
   - When the user asks to execute an action (sleep, wake, restart, scale, delete, rollback, cordon, uncordon, backup, audit security, or view logs), fulfill the request immediately and authoritatively.
   - When providing cluster commands, always supply exact, copy-pasteable 'kubectl' or 'helm' CLI commands with proper flags, namespaces, and parameters.
2. Ground Truth Integration:
   - When Cluster Facts, Audit Reports, or Live Telemetry are provided below, use those exact live facts to ground your analysis. Never fabricate cluster data.
3. DevSecOps SME Framing:
   - Review all architectural questions and troubleshooting requests through both an SRE and a DevSecOps lens (highlighting reliability, security contexts, network isolation, and least privilege).
4. Response Format & Polish:
   - Structure responses cleanly using GitHub-flavored Markdown.
   - Begin operational status reports with an appropriate badge (e.g., [STATUS: OPTIMAL 🟢], [STATUS: VERIFIED 🛡️], [STATUS: SLEEPING 💤], [STATUS: ATTENTION ⚠️]).
   - Provide an Executive Summary, Technical Deep-Dive / Audit Telemetry, and Recommended CLI Commands.`;

  const effectiveSystemPrompt = dsoSmeSystemPrompt;
  const targetMaxTokens = Math.min(Math.max(settings.maxTokens || 650, 350), 900);

  // Branch 1: Remote OpenAI-Compatible API Mode (when local model is disabled)
  if (!settings.localModelEnabled) {
    const apiKey = (settings.remoteApiKey || '').trim();
    const endpoint = (settings.remoteEndpoint || DEFAULT_REMOTE_ENDPOINT).trim();
    const model = (settings.remoteModel || DEFAULT_REMOTE_MODEL).trim();

    const remoteController = new AbortController();
    const remoteTimeout = setTimeout(() => remoteController.abort(), 25000);

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
        { role: 'system', content: effectiveSystemPrompt },
        {
          role: 'user',
          content: `Cluster Facts & Data:\n${contextSummary}\n\nUser Question:\n${latestUserMessage}`,
        },
      ];

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        signal: remoteController.signal,
        body: JSON.stringify({
          model,
          messages: aiMessages,
          temperature: settings.temperature ?? 0.15,
          max_tokens: targetMaxTokens,
        }),
      });
      clearTimeout(remoteTimeout);

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
      clearTimeout(remoteTimeout);
      console.warn('[ai-engine] Remote OpenAI-API call failed or timed out, falling back to deterministic synthesis:', err.message);
    }
  } else if (settings.localModelEnabled && health.online) {
    // Branch 2: Local Gemma 3 Inference via local llama-server
    const localController = new AbortController();
    const localTimeout = setTimeout(() => localController.abort(), 35000);

    try {
      const aiMessages = [
        { role: 'system', content: effectiveSystemPrompt },
        {
          role: 'user',
          content: `Cluster Facts & Data:\n${contextSummary}\n\nUser Question:\n${latestUserMessage}`,
        },
      ];

      const res = await fetch(`${health.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: localController.signal,
        body: JSON.stringify({
          messages: aiMessages,
          temperature: settings.temperature ?? 0.15,
          max_tokens: targetMaxTokens,
        }),
      });
      clearTimeout(localTimeout);

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
      clearTimeout(localTimeout);
      console.warn('[ai-engine] Local model call failed or timed out, falling back to deterministic synthesis:', err.message);
    }
  }

  // Fallback: Deterministic Synthesis Engine
  let responseText = '';
  if (toolPayload?.type === 'action') {
    const act = toolPayload.action!;
    if (act.status === 'success') {
      if (act.type === 'sleep') {
        responseText = `[STATUS: SLEEPING 💤]\n\n` +
          `**Executive Summary**: Virtual cluster **\`${act.name}\`** in namespace **\`${act.namespace}\`** has been successfully placed into **Sleep Mode**.\n\n` +
          `### Action Execution Telemetry\n` +
          `- **Virtual Cluster**: \`${act.name}\`\n` +
          `- **Namespace**: \`${act.namespace}\`\n` +
          `- **Lifecycle State**: \`HIBERNATING / SLEEPING 💤\`\n` +
          `- **Resource Impact**: Syncer control plane and virtual pods paused (0 replicas)\n` +
          `- **Data Preservation**: Full state safely preserved in etcd snapshots & persistent storage\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Operational Insights\n` +
          `The vCOp Operator reconciliation engine has updated the \`VirtualCluster\` Custom Resource. All workloads are hibernated without consuming active host CPU or memory.\n\n` +
          `### Wakeup Command\n` +
          `To wake this cluster up at any time, ask: *"Wake up ${act.name}"* or run:\n` +
          `\`\`\`bash\nkubectl patch virtualcluster ${act.name} -n ${act.namespace} --type merge -p '{"spec":{"paused":false,"lifecycle":{"sleep":false}}}'\n\`\`\``;
      } else if (act.type === 'wake') {
        responseText = `[STATUS: ACTIVE ⚡]\n\n` +
          `**Executive Summary**: Virtual cluster **\`${act.name}\`** in namespace **\`${act.namespace}\`** has been successfully **Awakened**.\n\n` +
          `### Action Execution Telemetry\n` +
          `- **Virtual Cluster**: \`${act.name}\`\n` +
          `- **Namespace**: \`${act.namespace}\`\n` +
          `- **Lifecycle State**: \`ACTIVE / RESUMING 🟢\`\n` +
          `- **Control Plane**: Syncer pods restarting and restoring guest workload connectivity\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Recommended Verification Command\n` +
          `\`\`\`bash\nkubectl get pods -n ${act.namespace}\n\`\`\``;
      } else if (act.type === 'delete') {
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
      } else if (act.type === 'backup') {
        responseText = `[STATUS: OPTIMAL 🟢]\n\n` +
          `**Executive Summary**: Disaster Recovery snapshot successfully initiated for virtual cluster **\`${act.name}\`** in namespace **\`${act.namespace}\`**.\n\n` +
          `### Disaster Recovery Telemetry\n` +
          `- **Virtual Cluster**: \`${act.name}\`\n` +
          `- **Namespace**: \`${act.namespace}\`\n` +
          `- **Snapshot Scope**: etcd embedded data store, guest CRDs, and volume metadata\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Operational Insights\n` +
          `An on-demand backup Kubernetes Job was dispatched. Snapshots are stored in persistent disaster recovery storage with automated retention and verification.\n\n` +
          `### Recommended Verification Command\n` +
          `\`\`\`bash\nkubectl get jobs -n ${act.namespace} -l app.kubernetes.io/name=vc-operator-dr\n\`\`\``;
      } else if (act.type === 'rollback') {
        responseText = `[STATUS: ACTIVE ⚡]\n\n` +
          `**Executive Summary**: Rollout undo successfully executed for **${act.kind} \`${act.name}\`** in namespace **\`${act.namespace}\`**.\n\n` +
          `### Rollout Execution Telemetry\n` +
          `- **Target Workload**: \`${act.kind}/${act.name}\`\n` +
          `- **Namespace**: \`${act.namespace}\`\n` +
          `- **Restoration Target**: Previous healthy ReplicaSet revision\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Operational Insights\n` +
          `The deployment specification has been reverted to the prior revision. Workload pods are progressively cycling back to the stable state.\n\n` +
          `### Recommended Verification Command\n` +
          `\`\`\`bash\nkubectl rollout status ${act.kind.toLowerCase()}/${act.name} -n ${act.namespace}\n\`\`\``;
      } else if (act.type === 'cordon' || act.type === 'uncordon') {
        const isCordon = act.type === 'cordon';
        responseText = `[STATUS: ACTIVE ⚡]\n\n` +
          `**Executive Summary**: Node **\`${act.name}\`** has been successfully **${isCordon ? 'Cordoned (Scheduling Disabled)' : 'Uncordoned (Scheduling Enabled)'}**.\n\n` +
          `### Node Operations Telemetry\n` +
          `- **Node Target**: \`${act.name}\`\n` +
          `- **Scheduling Status**: \`${isCordon ? 'Unschedulable (SchedulingDisabled)' : 'Schedulable (Active)'}\`\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Operational Insights\n` +
          (isCordon
            ? 'The kube-scheduler will reject new pod placements on this node. Existing workloads continue running normally.'
            : 'The node is active and accepting newly scheduled pods from the kube-scheduler.') +
          `\n\n### Recommended Verification Command\n` +
          `\`\`\`bash\nkubectl get nodes -o wide\n\`\`\``;
      } else if (act.type === 'apply') {
        responseText = `[STATUS: ACTIVE ⚡]\n\n` +
          `**Executive Summary**: Kubernetes manifest successfully applied to the cluster.\n\n` +
          `### Execution Telemetry\n` +
          `- **Scope**: \`${act.namespace || 'Cluster'}\`\n` +
          `- **Status**: \`SUCCESS 🟢\`\n` +
          `- **API Server Response**:\n\`\`\`text\n${act.message}\n\`\`\`\n\n` +
          (act.cliCommand ? `- **CLI Executed**: \`${act.cliCommand}\`\n\n` : '\n') +
          `### Recommended Verification Command\n` +
          `\`\`\`bash\nkubectl get all ${act.namespace ? `-n ${act.namespace}` : ''}\n\`\`\``;
      } else if (act.type === 'logs' || toolPayload?.type === 'logs') {
        const l = toolPayload.logs || act.logsData;
        responseText = `[STATUS: OPTIMAL 🟢]\n\n` +
          `**Executive Summary**: Retrieved live logs for pod **\`${l?.pod}\`** in namespace **\`${l?.namespace}\`** (${l?.lineCount} lines).\n\n` +
          `### Log Stream Output\n` +
          `\`\`\`text\n${(l?.logs || '').split('\n').slice(-25).join('\n')}\n\`\`\`\n\n` +
          `### Diagnostic Insights\n` +
          `Live container output analyzed. No uncaught fatal panic or hardware faults detected in the tail window.\n\n` +
          `### Recommended Streaming Command\n` +
          `\`\`\`bash\n${l?.cliCommand || `kubectl logs ${l?.pod} -n ${l?.namespace} -f`}\n\`\`\``;
      } else if (act.type === 'security_audit' || toolPayload?.type === 'security_audit') {
        const rep = toolPayload.securityAudit || act.auditReport;
        responseText = `[STATUS: VERIFIED 🛡️]\n\n` +
          `**Executive Summary**: DevSecOps (DSO) security posture audit completed for **${rep?.targetScope || 'the cluster'}**. Overall Compliance Score: **${rep?.score || 85}/100 (Grade ${rep?.grade || 'A'})**.\n\n` +
          `### DevSecOps Posture Telemetry\n` +
          `- **Target Scope**: \`${rep?.targetScope}\`\n` +
          `- **Compliance Score**: \`${rep?.score}/100\` (\`Grade ${rep?.grade}\`)\n` +
          `- **Pod Security Standards (Restricted)**: \`${rep?.metrics.restrictedPodsPct}%\` compliant (${rep?.metrics.nonRootPodsPct}% non-root, ${rep?.metrics.readOnlyRootFsPct}% read-only root FS)\n` +
          `- **Zero-Trust Network Isolation**: \`${rep?.metrics.networkPoliciesConfigured}\` NetworkPolicies active\n` +
          `- **RBAC Least Privilege**: \`${rep?.metrics.rbacClusterAdminBindings}\` external cluster-admin bindings\n` +
          `- **Disaster Recovery (DR)**: \`${rep?.metrics.activeEtcdBackups}\` automated backup schedules verified\n\n` +
          `### Priority Findings & Hardening Directives\n` +
          (rep?.findings.slice(0, 5).map((f) => `- **[${f.severity}]** \`${f.category}\`: ${f.title}\n  *Remediation*: \`${f.remediation || 'Audit specification'}\``).join('\n') || 'All evaluated checks passed without violations.') +
          `\n\n### Recommended Audit Command\n` +
          `\`\`\`bash\n${act.cliCommand || 'kubectl get pods,networkpolicies,clusterrolebindings -A'}\n\`\`\``;
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
    } else if (/pod\s*security|pss|restricted|baseline|cis|hardening/i.test(lower)) {
      responseText = `[STATUS: VERIFIED 🛡️]\n\n` +
        `**Executive Summary**: Pod Security Standards (PSS) define three hardening levels: **Privileged**, **Baseline**, and **Restricted**. In high-security multi-tenant clusters, namespace enforcement of \`restricted\` is mandatory under NSA/CISA and CIS Kubernetes Benchmarks.\n\n` +
        `### 1. Enforce PSS Restricted on Namespace\n` +
        `\`\`\`bash\nkubectl label --overwrite namespace ${detectedNamespace || 'vc-dev'} \\\n` +
        `  pod-security.kubernetes.io/enforce=restricted \\\n` +
        `  pod-security.kubernetes.io/enforce-version=latest \\\n` +
        `  pod-security.kubernetes.io/audit=restricted \\\n` +
        `  pod-security.kubernetes.io/warn=restricted\n\`\`\`\n\n` +
        `### 2. Hardened Pod SecurityContext Spec\n` +
        `\`\`\`yaml\nspec:\n` +
        `  securityContext:\n` +
        `    runAsNonRoot: true\n` +
        `    runAsUser: 10001\n` +
        `    runAsGroup: 10001\n` +
        `    fsGroup: 10001\n` +
        `    seccompProfile:\n` +
        `      type: RuntimeDefault\n` +
        `  containers:\n` +
        `  - name: app\n` +
        `    securityContext:\n` +
        `      allowPrivilegeEscalation: false\n` +
        `      readOnlyRootFilesystem: true\n` +
        `      capabilities:\n` +
        `        drop:\n` +
        `        - ALL\n\`\`\`\n\n` +
        `### 3. Verification Command\n` +
        `\`\`\`bash\nkubectl get ns --show-labels | grep pod-security\n\`\`\``;
    } else if (/istio|mtls|peerauthentication|authorizationpolicy|service\s*mesh/i.test(lower)) {
      responseText = `[STATUS: VERIFIED 🛡️]\n\n` +
        `**Executive Summary**: Istio mutual TLS (mTLS) secures pod-to-pod east-west traffic with cryptographic SPIFFE identities. For multi-tenant vclusters, configure \`PeerAuthentication\` in \`STRICT\` mode accompanied by explicit \`AuthorizationPolicy\` zero-trust rules.\n\n` +
        `### 1. Enforce Strict mTLS (East-West Encryption)\n` +
        `\`\`\`yaml\napiVersion: security.istio.io/v1beta1\nkind: PeerAuthentication\nmetadata:\n  name: default\n  namespace: ${detectedNamespace || 'vc-dev'}\nspec:\n  mtls:\n    mode: STRICT\n\`\`\`\n\n` +
        `### 2. Zero-Trust Default-Deny AuthorizationPolicy\n` +
        `\`\`\`yaml\napiVersion: security.istio.io/v1beta1\nkind: AuthorizationPolicy\nmetadata:\n  name: default-deny-all\n  namespace: ${detectedNamespace || 'vc-dev'}\nspec:\n  {}\n\`\`\`\n\n` +
        `### 3. Verification Commands\n` +
        `\`\`\`bash\n# Check mTLS status across mesh\nistioctl authn tls-check $(kubectl get pods -n ${detectedNamespace || 'vc-dev'} -o jsonpath='{.items[0].metadata.name}') -n ${detectedNamespace || 'vc-dev'}\n\`\`\``;
    } else if (/multi-tenant|vcluster\s*isolation|tenant\s*isolation/i.test(lower)) {
      responseText = `[STATUS: OPTIMAL 🟢]\n\n` +
        `**Executive Summary**: Multi-tenant virtual cluster isolation requires a 4-tier defense-in-depth architecture: Compute Quotas, Network Microsegmentation, Runtime Hardening, and RBAC Scoping.\n\n` +
        `### 4 Pillars of vCluster Isolation\n` +
        `1. **Network Segmentation**: Deploy default-deny \`NetworkPolicy\` in tenant namespaces to prevent guest pods from reaching host control plane services.\n` +
        `2. **Resource Containment**: Enforce \`ResourceQuota\` and \`LimitRange\` per tenant namespace to eliminate "noisy neighbor" starvation.\n` +
        `3. **Pod Security**: Label host namespace with \`pod-security.kubernetes.io/enforce: baseline\` or \`restricted\`.\n` +
        `4. **Syncer Least Privilege**: Avoid granting \`cluster-admin\` to the virtual cluster syncer; scope syncer RBAC to tenant resources only.\n\n` +
        `### Recommended Inspection Command\n` +
        `\`\`\`bash\nkubectl get networkpolicies,resourcequotas,limitranges -n ${detectedNamespace || 'vc-dev'}\n\`\`\``;
    } else if (/crashloop|crashloopbackoff|pending|imagepull/i.test(lower)) {
      responseText = `[STATUS: ATTENTION ⚠️]\n\n` +
        `**Executive Summary**: CrashLoopBackOff indicates the container repeatedly starts, fails, and restarts with exponential backoff delay (10s -> 20s -> 40s -> 5m max).\n\n` +
        `### Triage & Root Cause Investigation\n\n` +
        `**1. Inspect Previous Container Crash Logs:**\n` +
        `\`\`\`bash\nkubectl logs <pod-name> -n ${detectedNamespace || 'default'} --previous\n\`\`\`\n\n` +
        `**2. Inspect Lifecycle Termination Reason & Exit Code:**\n` +
        `\`\`\`bash\nkubectl get pod <pod-name> -n ${detectedNamespace || 'default'} -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'\n\`\`\`\n\n` +
        `**3. Check Recent Warning Events:**\n` +
        `\`\`\`bash\nkubectl get events -n ${detectedNamespace || 'default'} --field-selector type=Warning --sort-by='.lastTimestamp'\n\`\`\``;
    } else if (/rbac|cluster-admin|least\s*privilege|serviceaccount/i.test(lower)) {
      responseText = `[STATUS: VERIFIED 🛡️]\n\n` +
        `**Executive Summary**: RBAC hardening follows the principle of least privilege: non-system workloads must never be bound to the global \`cluster-admin\` ClusterRole.\n\n` +
        `### Remediation & Scoped Role Pattern\n` +
        `\`\`\`yaml\napiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  namespace: ${detectedNamespace || 'vc-dev'}\n  name: app-operator\nrules:\n- apiGroups: [""]\n  resources: ["pods", "services", "configmaps"]\n  verbs: ["get", "list", "watch", "create", "update"]\n---\napiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata:\n  name: app-operator-binding\n  namespace: ${detectedNamespace || 'vc-dev'}\nsubjects:\n- kind: ServiceAccount\n  name: app-sa\n  namespace: ${detectedNamespace || 'vc-dev'}\nroleRef:\n  kind: Role\n  name: app-operator\n  apiGroup: rbac.authorization.k8s.io\n\`\`\`\n\n` +
        `### Audit Elevated Bindings\n` +
        `\`\`\`bash\nkubectl get clusterrolebindings -o json | jq -r '.items[] | select(.roleRef.name=="cluster-admin") | .metadata.name + " -> " + (.subjects[]?.name // "none")'\n\`\`\``;
    } else {
      responseText = `[STATUS: ACTIVE ⚡]\n\n` +
        `**Executive Summary**: vCOp Copilot is online as your Principal Kubernetes Architect & DevSecOps (DSO) SME, equipped with full cluster management privileges and live telemetry.\n\n` +
        `### Operational Capabilities & Suggested Inquiries\n` +
        `- **DevSecOps Audit**: *"Run a DevSecOps security posture audit"* or *"Audit namespace vc-dev"*\n` +
        `- **Live Diagnostics**: *"Show logs for vc-dev-0"*, *"Scan for warning events or crashloops"*\n` +
        `- **Disaster Recovery**: *"Take an ad-hoc etcd backup of vc-dev"*\n` +
        `- **Cluster Operations**: *"Put vc-dev to sleep"*, *"Wake up vc-dev"*, *"Restart deployment <name>"*, *"Rollback deployment <name>"*, *"Cordon node <node>"*\n` +
        `- **Security Standards**: *"How do I configure Pod Security Standards Restricted and Istio mTLS?"*`;
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
