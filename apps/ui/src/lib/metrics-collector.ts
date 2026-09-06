import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getKubeconfig, getVirtualCluster } from './k8s-client';
import { parseCpuMillis, parseMemoryBytes, formatCpuMillis, formatMemoryBytes } from './metrics-utils';
import { recordPodMetricsBatch, type PodMetricSampleInput, getSparklineSeries } from './metrics-db';
import type {
  LivePodMetric,
  LiveWorkloadMetric,
  WorkloadKind,
  ContainerMetric,
  ClusterMetricsResponse,
} from './types';

const execFileAsync = promisify(execFile);

function prepareInternalKubeconfig(
  raw: string,
  defaultNamespace = 'default',
  clusterName?: string,
  clusterNamespace?: string
): string {
  let processed = raw.replace(
    /\s*certificate-authority-data:\s*[A-Za-z0-9+/=]+/g,
    '\n    insecure-skip-tls-verify: true'
  );
  if (!processed.includes('insecure-skip-tls-verify: true')) {
    processed = processed.replace(/(cluster:\s*\n)/g, '$1    insecure-skip-tls-verify: true\n');
  }
  if (clusterName && clusterNamespace) {
    processed = processed.replace(
      /server:\s*https?:\/\/[^\s]+/g,
      `server: https://${clusterName}.${clusterNamespace}.svc:443`
    );
  }
  processed = processed.replace(/(context:\s*\n)/g, `$1    namespace: ${defaultNamespace}\n`);
  return processed;
}

function formatAge(creationTimestamp?: string): string {
  if (!creationTimestamp) return '0s';
  const created = new Date(creationTimestamp).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - created) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays}d`;
}

/**
 * Resolves high-level owner workload from pod metadata.
 * Traces ReplicaSets to parent Deployment, StatefulSets, DaemonSets, Jobs, etc.
 */
function resolveWorkload(pod: any): { kind: WorkloadKind; name: string } {
  const owners = pod.metadata?.ownerReferences || [];
  if (owners.length === 0) {
    return { kind: 'Pod', name: pod.metadata?.name || 'unknown' };
  }

  const primary = owners[0];
  const kind = primary.kind;
  const name = primary.name;

  if (kind === 'ReplicaSet') {
    // Standard Kubernetes deployment replica sets append -<template-hash> (usually 8-10 chars)
    // Example: nginx-test-8557b8b6df -> nginx-test
    const podTemplateHash = pod.metadata?.labels?.['pod-template-hash'];
    if (podTemplateHash && name.endsWith(`-${podTemplateHash}`)) {
      return {
        kind: 'Deployment',
        name: name.slice(0, -(podTemplateHash.length + 1)),
      };
    }
    // General regex strip of hash suffix like -67465c469b or -8557b8b6df
    const stripped = name.replace(/-[a-f0-9]{8,10}$/, '');
    return {
      kind: 'Deployment',
      name: stripped || name,
    };
  }

  if (kind === 'StatefulSet') {
    return { kind: 'StatefulSet', name };
  }

  if (kind === 'DaemonSet') {
    return { kind: 'DaemonSet', name };
  }

  if (kind === 'Job') {
    return { kind: 'Job', name };
  }

  if (kind === 'CronJob') {
    return { kind: 'CronJob', name };
  }

  return { kind: 'Other', name };
}

/**
 * Collects live pod and metric snapshots for a specific virtual cluster,
 * persists samples to PostgreSQL, and aggregates them into workloads.
 */
export async function collectClusterLiveMetrics(
  clusterName: string,
  clusterNamespace = 'default'
): Promise<ClusterMetricsResponse> {
  const targetNs = clusterNamespace || 'default';
  const rawKc = await getKubeconfig(clusterName, targetNs);
  if (!rawKc) {
    throw new Error(`Kubeconfig for virtual cluster "${clusterName}" not found or cluster not ready`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcop-metrics-'));
  const kcPath = path.join(tempDir, 'kubeconfig.yaml');

  try {
    const internalKc = prepareInternalKubeconfig(rawKc, 'default', clusterName, targetNs);
    fs.writeFileSync(kcPath, internalKc, { mode: 0o600 });

    // 1. Run kubectl get pods -A -o json
    let podsJson: any = { items: [] };
    try {
      const podsRes = await execFileAsync(
        'kubectl',
        ['--kubeconfig', kcPath, 'get', 'pods', '-A', '-o', 'json'],
        { timeout: 12000 }
      );
      podsJson = JSON.parse(podsRes.stdout);
    } catch (e: any) {
      console.warn(`[metrics-collector] Failed fetching pods list for ${clusterName}:`, e.message);
    }

    // 2. Run kubectl get --raw /apis/metrics.k8s.io/v1beta1/pods
    let metricsMap: Record<string, Record<string, { cpu: string; memory: string }>> = {};
    try {
      const metricsRes = await execFileAsync(
        'kubectl',
        ['--kubeconfig', kcPath, 'get', '--raw', '/apis/metrics.k8s.io/v1beta1/pods'],
        { timeout: 12000 }
      );
      const metricsJson = JSON.parse(metricsRes.stdout);
      if (metricsJson && metricsJson.items) {
        for (const item of metricsJson.items) {
          const podKey = `${item.metadata.namespace}/${item.metadata.name}`;
          metricsMap[podKey] = {};
          for (const c of item.containers || []) {
            metricsMap[podKey][c.name] = {
              cpu: c.usage?.cpu || '0m',
              memory: c.usage?.memory || '0Mi',
            };
          }
        }
      }
    } catch (e: any) {
      // metrics-server might still be scraping or warming up
    }

    const podItems = podsJson.items || [];
    const samplesToRecord: PodMetricSampleInput[] = [];
    const livePods: LivePodMetric[] = [];

    for (const pod of podItems) {
      const pName = pod.metadata.name;
      const pNs = pod.metadata.namespace;
      const podKey = `${pNs}/${pName}`;
      const workload = resolveWorkload(pod);

      const containerMetrics: ContainerMetric[] = [];
      let totalCpuMillis = 0;
      let totalMemBytes = 0;
      let totalCpuLimitMillis = 0;
      let totalMemLimitBytes = 0;
      let totalCpuReqMillis = 0;
      let totalMemReqBytes = 0;
      let totalRestarts = 0;

      const containerStatuses = pod.status?.containerStatuses || [];
      const specContainers = pod.spec?.containers || [];

      for (const specC of specContainers) {
        const cName = specC.name;
        const cStatus = containerStatuses.find((cs: any) => cs.name === cName);
        const cMetrics = metricsMap[podKey]?.[cName];

        const cpuMillis = cMetrics ? parseCpuMillis(cMetrics.cpu) : 0;
        const memBytes = cMetrics ? parseMemoryBytes(cMetrics.memory) : 0;

        totalCpuMillis += cpuMillis;
        totalMemBytes += memBytes;

        const reqCpu = parseCpuMillis(specC.resources?.requests?.cpu);
        const limCpu = parseCpuMillis(specC.resources?.limits?.cpu);
        const reqMem = parseMemoryBytes(specC.resources?.requests?.memory);
        const limMem = parseMemoryBytes(specC.resources?.limits?.memory);

        totalCpuReqMillis += reqCpu;
        totalCpuLimitMillis += limCpu;
        totalMemReqBytes += reqMem;
        totalMemLimitBytes += limMem;

        const restarts = cStatus?.restartCount || 0;
        totalRestarts += restarts;

        containerMetrics.push({
          name: cName,
          cpuUsage: formatCpuMillis(cpuMillis),
          cpuMillis,
          memoryUsage: formatMemoryBytes(memBytes),
          memoryBytes: memBytes,
          cpuRequest: specC.resources?.requests?.cpu,
          cpuLimit: specC.resources?.limits?.cpu,
          memoryRequest: specC.resources?.requests?.memory,
          memoryLimit: specC.resources?.limits?.memory,
          ready: !!cStatus?.ready,
          restartCount: restarts,
          image: specC.image || '',
          state: cStatus?.state ? Object.keys(cStatus.state)[0] : 'unknown',
        });
      }

      // Check overall pod readiness
      const allContainersReady =
        containerMetrics.length > 0 && containerMetrics.every((c) => c.ready);

      let phase = pod.status?.phase || 'Unknown';
      // Detect CrashLoopBackOff or Error from container statuses
      for (const cs of containerStatuses) {
        if (cs.state?.waiting?.reason) {
          phase = cs.state.waiting.reason; // e.g. CrashLoopBackOff, ImagePullBackOff
          break;
        }
      }

      const cpuPercent =
        totalCpuLimitMillis > 0
          ? Math.min(100, Math.round((totalCpuMillis / totalCpuLimitMillis) * 100))
          : undefined;

      const memPercent =
        totalMemLimitBytes > 0
          ? Math.min(100, Math.round((totalMemBytes / totalMemLimitBytes) * 100))
          : undefined;

      const livePod: LivePodMetric = {
        name: pName,
        namespace: pNs,
        phase,
        ready: allContainersReady,
        restarts: totalRestarts,
        age: formatAge(pod.metadata.creationTimestamp),
        startTime: pod.status?.startTime,
        nodeName: pod.spec?.nodeName,
        podIP: pod.status?.podIP,
        workloadKind: workload.kind,
        workloadName: workload.name,
        cpuUsage: formatCpuMillis(totalCpuMillis),
        cpuMillis: totalCpuMillis,
        cpuPercent,
        memoryUsage: formatMemoryBytes(totalMemBytes),
        memoryBytes: totalMemBytes,
        memoryPercent: memPercent,
        containers: containerMetrics,
        labels: pod.metadata?.labels || {},
      };

      livePods.push(livePod);

      samplesToRecord.push({
        vcluster: clusterName,
        vclusterNamespace: targetNs,
        namespace: pNs,
        workloadKind: workload.kind,
        workloadName: workload.name,
        podName: pName,
        cpuMillis: totalCpuMillis,
        memoryBytes: totalMemBytes,
        cpuLimitMillis: totalCpuLimitMillis > 0 ? totalCpuLimitMillis : undefined,
        memoryLimitBytes: totalMemLimitBytes > 0 ? totalMemLimitBytes : undefined,
        cpuRequestMillis: totalCpuReqMillis > 0 ? totalCpuReqMillis : undefined,
        memoryRequestBytes: totalMemReqBytes > 0 ? totalMemReqBytes : undefined,
        phase,
        ready: allContainersReady,
        restarts: totalRestarts,
      });
    }

    // Record samples to Postgres / in-memory buffer asynchronously
    recordPodMetricsBatch(samplesToRecord).catch((e) =>
      console.warn('[metrics-collector] Async record batch error:', e.message)
    );

    // Group pods by Workload (kind + name + namespace)
    const workloadMap: Record<string, LiveWorkloadMetric> = {};

    for (const pod of livePods) {
      const key = `${pod.namespace}/${pod.workloadKind}/${pod.workloadName}`;
      if (!workloadMap[key]) {
        workloadMap[key] = {
          kind: pod.workloadKind,
          name: pod.workloadName,
          namespace: pod.namespace,
          podsCount: 0,
          readyPodsCount: 0,
          totalCpuMillis: 0,
          totalCpuUsage: '0m',
          totalMemoryBytes: 0,
          totalMemoryUsage: '0Mi',
          totalRestarts: 0,
          status: 'Healthy',
          pods: [],
        };
      }

      const wl = workloadMap[key];
      wl.podsCount += 1;
      if (pod.ready) wl.readyPodsCount += 1;
      wl.totalCpuMillis += pod.cpuMillis;
      wl.totalMemoryBytes += pod.memoryBytes;
      wl.totalRestarts += pod.restarts;
      wl.pods.push(pod);

      if (pod.phase === 'CrashLoopBackOff' || pod.phase === 'Failed') {
        wl.status = 'Critical';
      } else if (!pod.ready && wl.status !== 'Critical') {
        wl.status = 'Degraded';
      }
    }

    const liveWorkloads: LiveWorkloadMetric[] = Object.values(workloadMap).map((wl) => ({
      ...wl,
      totalCpuUsage: formatCpuMillis(wl.totalCpuMillis),
      totalMemoryUsage: formatMemoryBytes(wl.totalMemoryBytes),
    }));

    // Compute overall cluster summary
    const clusterCpuMillis = livePods.reduce((acc, p) => acc + p.cpuMillis, 0);
    const clusterMemBytes = livePods.reduce((acc, p) => acc + p.memoryBytes, 0);
    const totalRestarts = livePods.reduce((acc, p) => acc + p.restarts, 0);
    const runningPods = livePods.filter((p) => p.phase === 'Running').length;
    const pendingPods = livePods.filter((p) => p.phase === 'Pending').length;
    const failedPods = livePods.filter(
      (p) => p.phase === 'Failed' || p.phase === 'CrashLoopBackOff'
    ).length;

    const namespaces = Array.from(new Set(livePods.map((p) => p.namespace))).sort();

    return {
      success: true,
      cluster: clusterName,
      timestamp: new Date().toISOString(),
      summary: {
        totalCpuMillis: clusterCpuMillis,
        totalCpuUsage: formatCpuMillis(clusterCpuMillis),
        totalMemoryBytes: clusterMemBytes,
        totalMemoryUsage: formatMemoryBytes(clusterMemBytes),
        totalPods: livePods.length,
        runningPods,
        pendingPods,
        failedPods,
        totalRestarts,
        totalWorkloads: liveWorkloads.length,
        namespaces,
      },
      workloads: liveWorkloads,
      pods: livePods,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

let daemonStarted = false;

/**
 * Starts a background periodic metric collection daemon that scrapes
 * all ready virtual clusters every 30 seconds and logs continuous time-series
 * data to PostgreSQL.
 */
export function startMetricsDaemon() {
  if (daemonStarted) return;
  daemonStarted = true;

  const runCollection = async () => {
    try {
      const { listVirtualClusters } = await import('./k8s-client');
      const clusters = await listVirtualClusters();
      const readyClusters = clusters.filter(
        (c) => c.status?.phase === 'Ready' && !c.spec?.paused && !c.spec?.lifecycle?.sleep
      );

      for (const c of readyClusters) {
        try {
          await collectClusterLiveMetrics(c.name, c.namespace);
        } catch {
          // silently ignore individual cluster collection hiccups
        }
      }
    } catch (err: any) {
      console.warn('[metrics-daemon] Collection loop warning:', err.message);
    }
  };

  // Run initial collection after 5s, then every 30s
  setTimeout(runCollection, 5000);
  setInterval(runCollection, 30000);
}

