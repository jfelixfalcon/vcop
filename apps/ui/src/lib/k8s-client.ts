import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import type { VirtualCluster, SizePreset, PoliciesSpec, InstalledApp, ClusterGroupInfo } from './types';
import { getAppStoreCatalog } from './appstore';
import { PRESETS } from './presets';
export { PRESETS, k8sRequest };

interface K8sConnectionConfig {
  host: string;
  port: number;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  token?: string;
  rejectUnauthorized: boolean;
}

let cachedConfig: K8sConnectionConfig | null = null;

function getK8sConfig(): K8sConnectionConfig | null {
  if (cachedConfig) return cachedConfig;

  // 1. In-cluster ServiceAccount credentials
  const inClusterTokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const inClusterCaPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

  if (fs.existsSync(inClusterTokenPath)) {
    try {
      const token = fs.readFileSync(inClusterTokenPath, 'utf8').trim();
      const ca = fs.existsSync(inClusterCaPath) ? fs.readFileSync(inClusterCaPath) : undefined;
      cachedConfig = {
        host: process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc',
        port: parseInt(process.env.KUBERNETES_SERVICE_PORT || '443', 10),
        token,
        ca,
        rejectUnauthorized: true,
      };
      return cachedConfig;
    } catch (e) {
      console.warn('Failed reading in-cluster credentials:', e);
    }
  }

  // 2. Local Kubeconfig
  const kubeconfigPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube/config');
  if (fs.existsSync(kubeconfigPath)) {
    try {
      const content = fs.readFileSync(kubeconfigPath, 'utf8');
      const serverMatch = content.match(/server:\s*([^\s]+)/);
      if (serverMatch) {
        const url = new URL(serverMatch[1]);
        const certMatch = content.match(/client-certificate-data:\s*([^\s]+)/);
        const keyMatch = content.match(/client-key-data:\s*([^\s]+)/);
        const tokenMatch = content.match(/token:\s*([^\s]+)/);
        const caMatch = content.match(/certificate-authority-data:\s*([^\s]+)/);

        cachedConfig = {
          host: url.hostname,
          port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10),
          cert: certMatch ? Buffer.from(certMatch[1], 'base64') : undefined,
          key: keyMatch ? Buffer.from(keyMatch[1], 'base64') : undefined,
          token: tokenMatch ? tokenMatch[1] : undefined,
          ca: caMatch ? Buffer.from(caMatch[1], 'base64') : undefined,
          rejectUnauthorized: false,
        };
        return cachedConfig;
      }
    } catch (e) {
      console.warn('Failed parsing local kubeconfig:', e);
    }
  }

  return null;
}

function k8sRequest<T>(reqPath: string, method = 'GET', body?: any, contentType = 'application/json'): Promise<{ statusCode: number; data: T }> {
  const config = getK8sConfig();
  if (!config) {
    return Promise.reject(new Error('No Kubernetes cluster configuration found (neither in-cluster ServiceAccount nor kubeconfig)'));
  }

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    }

    let payload: string | undefined;
    if (body) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const options: https.RequestOptions = {
      hostname: config.host,
      port: config.port,
      path: reqPath,
      method,
      headers,
      ca: config.ca,
      cert: config.cert,
      key: config.key,
      rejectUnauthorized: config.rejectUnauthorized,
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => (rawData += chunk));
      res.on('end', () => {
        let parsed: any = null;
        if (rawData) {
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
        }
        resolve({ statusCode: res.statusCode || 200, data: parsed as T });
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

import { parseCpuMillis, parseMemoryBytes, getClusterCapacity } from './metrics-utils';
export { parseCpuMillis, parseMemoryBytes, getClusterCapacity };

function mapK8sResourceToVirtualCluster(item: any): VirtualCluster {
  const name = item.metadata?.name || '';
  const namespace = item.metadata?.namespace || 'default';
  const spec = item.spec || {};
  const status = item.status || {};
  const phase = status.phase || 'Pending';
  const conditions = status.conditions || [];
  const metrics = status.metrics || {};

  const isReady = phase === 'Ready';

  let installedApps: InstalledApp[] = [];
  try {
    const rawApps = item.metadata?.annotations?.['vops.gitops.io/installed-apps'];
    if (rawApps) {
      installedApps = JSON.parse(rawApps);
    }
  } catch {
    installedApps = [];
  }

  const isSleeping = phase === 'Sleeping' || spec.paused || spec.lifecycle?.sleep;
  const cpuUsageStr = isSleeping ? '0m' : (metrics.cpuUsage || '0m');
  const memUsageStr = isSleeping ? '0Mi' : (metrics.memoryUsage || '0Mi');

  const usedCpuMillis = parseCpuMillis(cpuUsageStr);
  const usedMemBytes = parseMemoryBytes(memUsageStr);
  const capacity = getClusterCapacity(spec);

  let cpuPercent = 0;
  let memPercent = 0;
  if (isReady && !isSleeping) {
    cpuPercent = Math.min(100, Math.max(usedCpuMillis > 0 ? 1 : 0, Math.round((usedCpuMillis / capacity.cpuMillis) * 100)));
    memPercent = Math.min(100, Math.max(usedMemBytes > 0 ? 1 : 0, Math.round((usedMemBytes / capacity.memoryBytes) * 100)));
  }

  const cpuSparkline = isReady && !isSleeping
    ? [
        Math.max(0, cpuPercent - 1),
        Math.max(0, cpuPercent + 1),
        Math.max(0, cpuPercent - 1),
        Math.max(0, cpuPercent + 1),
        cpuPercent,
      ]
    : [0, 0, 0, 0, 0];

  const memSparkline = isReady && !isSleeping
    ? [
        Math.max(0, memPercent - 1),
        Math.max(0, memPercent),
        Math.max(0, memPercent + 1),
        Math.max(0, memPercent),
        memPercent,
      ]
    : [0, 0, 0, 0, 0];

  return {
    name,
    namespace,
    spec: {
      clusterName: spec.clusterName || name,
      vclusterVersion: spec.vclusterVersion || '',
      kubernetesVersion: spec.kubernetesVersion || '',
      sizePreset: (spec.sizePreset as SizePreset) || 'medium',
      highAvailability: spec.highAvailability ?? true,
      components: spec.components || {
        coreDNS: { enabled: true },
        metricsServer: { enabled: true },
      },
      sync: spec.sync || { pods: true, services: true, ingresses: true },
      paused: spec.paused ?? spec.lifecycle?.sleep ?? false,
      lifecycle: {
        autoSleep: spec.lifecycle?.autoSleep ?? false,
        ttlHours: spec.lifecycle?.ttlHours ?? 0,
        sleep: spec.lifecycle?.sleep ?? spec.paused ?? false,
      },
      policies: spec.policies,
      customResources: spec.customResources,
      rawConfig: spec.rawConfig,
      helmValues: spec.helmValues,
    },
    status: {
      phase,
      conditions,
      virtualK8sVersion: status.virtualK8sVersion || spec.kubernetesVersion || '',
      vclusterVersion: status.vclusterVersion || spec.vclusterVersion || '',
      endpoint: status.endpoint || '',
      metrics: {
        activeNodeCount: isSleeping ? 0 : (metrics.activeNodeCount || 1),
        podCount: isSleeping ? 0 : (metrics.podCount || 0),
        memoryUsage: memUsageStr,
        cpuUsage: cpuUsageStr,
        cpuPercent,
        memPercent,
      },
      quota: status.quota,
      observedGeneration: status.observedGeneration,
      createdAt: item.metadata?.creationTimestamp,
    },
    metadata: {
      owner: item.metadata?.annotations?.['vops.gitops.io/owner'] || item.metadata?.labels?.['vops.gitops.io/owner'] || 'Platform User',
      allowedGroups: (item.metadata?.annotations?.['vops.gitops.io/allowed-groups'] || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      allowedEmails: (item.metadata?.annotations?.['vops.gitops.io/allowed-emails'] || '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      clusterGroup: (
        item.metadata?.annotations?.['vops.gitops.io/cluster-group'] ||
        item.metadata?.annotations?.['vops.gitops.io/cluster-groups']?.split(',')[0] ||
        item.metadata?.labels?.['vops.gitops.io/cluster-group'] ||
        ''
      ).trim(),
      clusterGroups: (
        item.metadata?.annotations?.['vops.gitops.io/cluster-groups'] ||
        item.metadata?.annotations?.['vops.gitops.io/cluster-group'] ||
        item.metadata?.labels?.['vops.gitops.io/cluster-group'] ||
        ''
      )
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      environment: (item.metadata?.labels?.['vops.gitops.io/environment'] as any) || 'development',
      tags: [spec.sizePreset || 'medium', spec.highAvailability ? 'ha-etcd' : 'single-node'],
      installedApps,
    },
    sparklineData: {
      cpu: cpuSparkline,
      memory: memSparkline,
    },
  };
}

export async function listVirtualClusters(): Promise<VirtualCluster[]> {
  try {
    const res = await k8sRequest<{ items?: any[] }>('/apis/vops.gitops.io/v1alpha1/virtualclusters');
    if (res.statusCode === 200 && res.data.items) {
      return res.data.items.map(mapK8sResourceToVirtualCluster);
    }
    return [];
  } catch (err: any) {
    console.error('Error fetching VirtualClusters from Kubernetes API:', err.message || err);
    return [];
  }
}

export async function getVirtualCluster(name: string, namespace?: string): Promise<VirtualCluster | null> {
  try {
    let targetNs = namespace;
    if (!targetNs) {
      const all = await listVirtualClusters();
      const match = all.find((c) => c.name === name);
      targetNs = match ? match.namespace : 'default';
    }
    const res = await k8sRequest<any>(`/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`);
    if (res.statusCode === 200 && res.data) {
      const cluster = mapK8sResourceToVirtualCluster(res.data);
      try {
        const cmRes = await k8sRequest<any>(`/api/v1/namespaces/${targetNs}/configmaps/${name}-config`);
        if (cmRes.statusCode === 200 && cmRes.data?.data?.['vcluster.yaml']) {
          cluster.compiledConfig = cmRes.data.data['vcluster.yaml'];
        }
      } catch {
        // Fallback gracefully if ConfigMap is still provisioning
      }
      return cluster;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createVirtualCluster(data: {
  clusterName: string;
  preset: SizePreset;
  owner?: string;
  allowedGroups?: string[];
  allowedEmails?: string[];
  clusterGroup?: string;
  clusterGroups?: string[];
  environment?: 'development' | 'staging' | 'production';
  enableMonitoringAndDNS?: boolean;
  autoSleep?: boolean;
  ttlHours?: number;
  kubernetesVersion?: string;
  vclusterVersion?: string;
  policies?: PoliciesSpec;
  customYaml?: string;
  installedApps?: Array<{ appId: string; customValues?: string }>;
}): Promise<VirtualCluster> {
  const name = data.clusterName.trim().toLowerCase();
  let k8sVer = data.kubernetesVersion;
  let vclusterVer = data.vclusterVersion;
  if (!k8sVer || !vclusterVer) {
    try {
      const { getDefaultVersions } = await import('./version-registry');
      const defaults = await getDefaultVersions();
      k8sVer = k8sVer || defaults.kubernetesVersion;
      vclusterVer = vclusterVer || defaults.vclusterVersion;
    } catch {
      k8sVer = k8sVer || 'v1.31.0';
      vclusterVer = vclusterVer || '0.36.0';
    }
  }
  const isHA = data.preset === 'large';
  const namespace = (data as any).namespace || (name === 'team-alpha-dev' ? 'default' : name);

  if (namespace !== 'default') {
    await k8sRequest('/api/v1/namespaces', 'POST', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace },
    }).catch(() => {});
  }

  const annotations: Record<string, string> = {
    'vops.gitops.io/owner': data.owner || 'Platform User',
  };
  if (data.allowedGroups && data.allowedGroups.length > 0) {
    annotations['vops.gitops.io/allowed-groups'] = data.allowedGroups.join(',');
  }
  if (data.allowedEmails && data.allowedEmails.length > 0) {
    annotations['vops.gitops.io/allowed-emails'] = data.allowedEmails.join(',');
  }

  const groupsList = Array.isArray(data.clusterGroups) && data.clusterGroups.length > 0
    ? data.clusterGroups
    : (data.clusterGroup ? [data.clusterGroup] : []);
  if (groupsList.length > 0) {
    annotations['vops.gitops.io/cluster-groups'] = groupsList.join(',');
    annotations['vops.gitops.io/cluster-group'] = groupsList[0];
  }

  const labels: Record<string, string> = {
    'vops.gitops.io/cluster': name,
    'vops.gitops.io/owner': (data.owner || 'platform-user').replace(/[^a-zA-Z0-9_-]/g, '-'),
    'vops.gitops.io/environment': data.environment || 'development',
  };
  if (groupsList.length > 0) {
    labels['vops.gitops.io/cluster-group'] = groupsList[0].replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 63);
  }

  const body: any = {
    apiVersion: 'vops.gitops.io/v1alpha1',
    kind: 'VirtualCluster',
    metadata: {
      name,
      namespace,
      labels,
      annotations,
    },
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
      policies: data.policies,
    },
  };

  if (data.customYaml && data.customYaml.trim()) {
    try {
      body.spec.rawConfig = JSON.parse(data.customYaml);
    } catch {
      body.spec.rawConfig = { raw: data.customYaml };
    }
  }

  // Configure initial App Store applications if chosen during creation
  if (data.installedApps && data.installedApps.length > 0) {
    try {
      const catalog = await getAppStoreCatalog();
      const appsToSave: InstalledApp[] = [];
      const now = new Date().toISOString();
      const installer = data.owner || 'Platform Administrator';

      for (const item of data.installedApps) {
        const catApp = catalog.apps.find((a) => a.id === item.appId);
        if (catApp) {
          const customValues = item.customValues !== undefined ? item.customValues : catApp.helm?.values;
          appsToSave.push({
            appId: catApp.id,
            name: catApp.name,
            version: catApp.version,
            category: catApp.category,
            installedAt: now,
            installedBy: installer,
            status: 'Installed',
            customValues,
            helm: catApp.helm ? { ...catApp.helm, values: customValues } : undefined,
            manifests: catApp.manifests,
          });
        }
      }

      annotations['vops.gitops.io/installed-apps'] = JSON.stringify(appsToSave);

      const helmDeployments = appsToSave
        .filter((a) => a.helm)
        .map((a) => ({
          chart: {
            name: a.helm!.name,
            repo: a.helm!.repo,
            version: a.helm!.version || a.version,
          },
          release: {
            name: a.helm!.releaseName,
            namespace: a.helm!.namespace || 'default',
          },
          values: a.customValues !== undefined ? a.customValues : a.helm!.values,
        }));

      const manifestsDeployments = appsToSave
        .filter((a) => a.manifests && a.manifests.trim())
        .map((a) => a.manifests!.trim())
        .join('\n---\n');

      body.spec.rawConfig = body.spec.rawConfig || {};
      body.spec.rawConfig.experimental = body.spec.rawConfig.experimental || {};
      body.spec.rawConfig.experimental.deploy = body.spec.rawConfig.experimental.deploy || {};
      body.spec.rawConfig.experimental.deploy.vcluster = {
        helm: helmDeployments,
        manifests: manifestsDeployments,
      };
    } catch (e) {
      console.warn('Failed compiling initial installed apps for new cluster:', e);
    }
  }

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${namespace}/virtualclusters`,
    'POST',
    body
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to create virtual cluster: HTTP ${res.statusCode}`);
}

export async function updateVirtualClusterPolicies(
  name: string,
  policies: PoliciesSpec,
  namespace?: string
): Promise<VirtualCluster | null> {
  let targetNs = namespace;
  if (!targetNs) {
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    targetNs = match ? match.namespace : 'default';
  }

  const patch: any = {
    spec: {
      policies,
    },
  };

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to update virtual cluster policies: HTTP ${res.statusCode}`);
}

export async function updateVirtualClusterRBAC(
  name: string,
  rbac: {
    owner?: string;
    allowedGroups?: string[];
    allowedEmails?: string[];
  },
  namespace?: string
): Promise<VirtualCluster | null> {
  let targetNs = namespace;
  if (!targetNs) {
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    targetNs = match ? match.namespace : 'default';
  }

  // Get current resource to preserve existing labels and annotations
  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`
  );
  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Cluster ${name} not found in namespace ${targetNs}`);
  }

  const existing = getRes.data;
  const currentAnnotations = existing.metadata?.annotations || {};
  const currentLabels = existing.metadata?.labels || {};

  const updatedAnnotations = { ...currentAnnotations };
  const updatedLabels = { ...currentLabels };

  if (rbac.owner !== undefined) {
    const trimmedOwner = rbac.owner.trim();
    updatedAnnotations['vops.gitops.io/owner'] = trimmedOwner || 'Platform User';
    updatedLabels['vops.gitops.io/owner'] = trimmedOwner
      ? trimmedOwner.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 63)
      : 'platform-user';
  }

  if (rbac.allowedGroups !== undefined) {
    const groupsStr = rbac.allowedGroups.map((g) => g.trim()).filter(Boolean).join(',');
    if (groupsStr) {
      updatedAnnotations['vops.gitops.io/allowed-groups'] = groupsStr;
    } else {
      updatedAnnotations['vops.gitops.io/allowed-groups'] = null;
    }
  }

  if (rbac.allowedEmails !== undefined) {
    const emailsStr = rbac.allowedEmails.map((e) => e.trim()).filter(Boolean).join(',');
    if (emailsStr) {
      updatedAnnotations['vops.gitops.io/allowed-emails'] = emailsStr;
    } else {
      updatedAnnotations['vops.gitops.io/allowed-emails'] = null;
    }
  }

  const patch = {
    metadata: {
      annotations: updatedAnnotations,
      labels: updatedLabels,
    },
  };

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to update virtual cluster RBAC: HTTP ${res.statusCode}`);
}

export async function updateVirtualClusterGroups(
  name: string,
  groups: string[] | string,
  namespace?: string
): Promise<VirtualCluster | null> {
  let targetNs = namespace;
  if (!targetNs) {
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    targetNs = match ? match.namespace : 'default';
  }

  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`
  );
  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Cluster ${name} not found in namespace ${targetNs}`);
  }

  const existing = getRes.data;
  const updatedAnnotations = { ...(existing.metadata?.annotations || {}) };
  const updatedLabels = { ...(existing.metadata?.labels || {}) };

  const groupsList = Array.isArray(groups)
    ? groups.map((g) => g.trim()).filter(Boolean)
    : typeof groups === 'string'
    ? groups.split(',').map((g) => g.trim()).filter(Boolean)
    : [];

  if (groupsList.length > 0) {
    updatedAnnotations['vops.gitops.io/cluster-groups'] = groupsList.join(',');
    updatedAnnotations['vops.gitops.io/cluster-group'] = groupsList[0];
    updatedLabels['vops.gitops.io/cluster-group'] = groupsList[0].replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 63);
  } else {
    updatedAnnotations['vops.gitops.io/cluster-groups'] = null;
    updatedAnnotations['vops.gitops.io/cluster-group'] = null;
    updatedLabels['vops.gitops.io/cluster-group'] = null;
  }

  const patch = {
    metadata: {
      annotations: updatedAnnotations,
      labels: updatedLabels,
    },
  };

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to update virtual cluster groups: HTTP ${res.statusCode}`);
}

export async function getFleetClusterGroups(): Promise<ClusterGroupInfo[]> {
  const clusters = await listVirtualClusters();
  const groupMap: Record<string, string[]> = {};
  for (const c of clusters) {
    const groups = c.metadata?.clusterGroups || (c.metadata?.clusterGroup ? [c.metadata.clusterGroup] : []);
    for (const g of groups) {
      const trimmed = g.trim();
      if (!trimmed) continue;
      if (!groupMap[trimmed]) groupMap[trimmed] = [];
      groupMap[trimmed].push(c.name);
    }
  }
  return Object.entries(groupMap)
    .map(([name, clusters]) => ({
      name,
      clusterCount: clusters.length,
      clusters,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function setVirtualClusterSleep(
  name: string,
  sleep: boolean,
  namespace?: string
): Promise<VirtualCluster | null> {
  let targetNs = namespace;
  if (!targetNs) {
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    targetNs = match ? match.namespace : 'default';
  }

  const patch = {
    spec: {
      paused: sleep,
      lifecycle: {
        sleep,
      },
    },
  };

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to set sleep state: HTTP ${res.statusCode}`);
}

export async function upgradeVirtualCluster(
  name: string,
  upgrades: {
    kubernetesVersion?: string;
    vclusterVersion?: string;
  },
  namespace?: string
): Promise<VirtualCluster | null> {
  let targetNs = namespace;
  if (!targetNs) {
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    targetNs = match ? match.namespace : 'default';
  }

  const patch: any = { spec: {} };
  if (upgrades.kubernetesVersion) {
    patch.spec.kubernetesVersion = upgrades.kubernetesVersion;
  }
  if (upgrades.vclusterVersion) {
    patch.spec.vclusterVersion = upgrades.vclusterVersion;
  }

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to upgrade virtual cluster: HTTP ${res.statusCode}`);
}

export async function deleteVirtualCluster(name: string, namespace?: string): Promise<boolean> {
  try {
    let targetNs = namespace;
    if (!targetNs) {
      const all = await listVirtualClusters();
      const match = all.find((c) => c.name === name);
      targetNs = match ? match.namespace : 'default';
    }
    const res = await k8sRequest<any>(
      `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`,
      'DELETE'
    );
    return res.statusCode >= 200 && res.statusCode < 300;
  } catch (err: any) {
    console.error('Failed to delete virtual cluster from Kubernetes API:', err.message || err);
    return false;
  }
}

export async function getKubeconfig(name: string, namespace?: string): Promise<string | null> {
  try {
    let targetNs = namespace;
    if (!targetNs) {
      const all = await listVirtualClusters();
      const match = all.find((c) => c.name === name);
      targetNs = match ? match.namespace : 'default';
    }
    const res = await k8sRequest<any>(`/api/v1/namespaces/${targetNs}/secrets/${name}-kubeconfig`);
    if (res.statusCode === 200 && res.data?.data?.config) {
      return Buffer.from(res.data.data.config, 'base64').toString('utf-8');
    }
  } catch {
    // Secret not available yet
  }
  return null;
}

export function generateMockKubeconfig(cluster: VirtualCluster): string {
  return `apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: ${cluster.status.endpoint || 'https://kubernetes.default.svc'}
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
    token: vcop-token-${cluster.name}
`;
}
