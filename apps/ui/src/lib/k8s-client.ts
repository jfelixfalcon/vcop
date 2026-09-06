import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VirtualCluster, SizePreset, PoliciesSpec, InstalledApp, ClusterGroupInfo, OidcConfig } from './types';
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

  const customEndpoint = item.metadata?.annotations?.['vops.gitops.io/custom-endpoint'] || spec.customEndpoint || '';

  let oidc: OidcConfig = {
    enabled: false,
    issuerUrl: '',
    clientId: '',
    usernameClaim: 'email',
    usernamePrefix: '',
    groupsClaim: 'groups',
    groupsPrefix: '',
    extraScopes: ['email', 'profile', 'groups'],
  };

  try {
    const rawOidc = item.metadata?.annotations?.['vops.gitops.io/oidc-config'];
    if (rawOidc) {
      oidc = { ...oidc, ...JSON.parse(rawOidc) };
    } else if (item.metadata?.annotations?.['vops.gitops.io/oidc-issuer-url']) {
      oidc = {
        enabled: true,
        issuerUrl: item.metadata.annotations['vops.gitops.io/oidc-issuer-url'] || '',
        clientId: item.metadata.annotations['vops.gitops.io/oidc-client-id'] || '',
        usernameClaim: item.metadata.annotations['vops.gitops.io/oidc-username-claim'] || 'email',
        usernamePrefix: item.metadata.annotations['vops.gitops.io/oidc-username-prefix'] || '',
        groupsClaim: item.metadata.annotations['vops.gitops.io/oidc-groups-claim'] || 'groups',
        groupsPrefix: item.metadata.annotations['vops.gitops.io/oidc-groups-prefix'] || '',
        caFile: item.metadata.annotations['vops.gitops.io/oidc-ca-file'] || '',
        extraScopes: ['email', 'profile', 'groups'],
      };
    } else if (spec.oidc) {
      oidc = { ...oidc, ...spec.oidc };
    } else {
      const extraArgs = spec.rawConfig?.controlPlane?.distro?.k8s?.apiServer?.extraArgs;
      if (Array.isArray(extraArgs)) {
        const issuerArg = extraArgs.find((a: string) => typeof a === 'string' && a.startsWith('--oidc-issuer-url='));
        const clientArg = extraArgs.find((a: string) => typeof a === 'string' && a.startsWith('--oidc-client-id='));
        if (issuerArg && clientArg) {
          const userClaimArg = extraArgs.find((a: string) => typeof a === 'string' && a.startsWith('--oidc-username-claim='));
          const groupsClaimArg = extraArgs.find((a: string) => typeof a === 'string' && a.startsWith('--oidc-groups-claim='));
          const userPrefixArg = extraArgs.find((a: string) => typeof a === 'string' && a.startsWith('--oidc-username-prefix='));
          const groupsPrefixArg = extraArgs.find((a: string) => typeof a === 'string' && a.startsWith('--oidc-groups-prefix='));
          oidc = {
            enabled: true,
            issuerUrl: issuerArg.split('=')[1] || '',
            clientId: clientArg.split('=')[1] || '',
            usernameClaim: userClaimArg ? userClaimArg.split('=')[1] : 'email',
            usernamePrefix: userPrefixArg ? userPrefixArg.split('=')[1] : '',
            groupsClaim: groupsClaimArg ? groupsClaimArg.split('=')[1] : 'groups',
            groupsPrefix: groupsPrefixArg ? groupsPrefixArg.split('=')[1] : '',
            extraScopes: ['email', 'profile', 'groups'],
          };
        }
      }
    }
  } catch {
    // fallback
  }

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
      customEndpoint,
      oidc,
    },
    status: {
      phase,
      conditions,
      virtualK8sVersion: status.virtualK8sVersion || spec.kubernetesVersion || '',
      vclusterVersion: status.vclusterVersion || spec.vclusterVersion || '',
      endpoint: customEndpoint || status.endpoint || '',
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
      customEndpoint,
      oidc,
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
  customEndpoint?: string;
  oidc?: OidcConfig;
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

  if (data.customEndpoint) {
    annotations['vops.gitops.io/custom-endpoint'] = data.customEndpoint.trim();
  }
  if (data.oidc) {
    annotations['vops.gitops.io/oidc-config'] = JSON.stringify(data.oidc);
    if (data.oidc.issuerUrl) annotations['vops.gitops.io/oidc-issuer-url'] = data.oidc.issuerUrl;
    if (data.oidc.clientId) annotations['vops.gitops.io/oidc-client-id'] = data.oidc.clientId;
    if (data.oidc.usernameClaim) annotations['vops.gitops.io/oidc-username-claim'] = data.oidc.usernameClaim;
    if (data.oidc.groupsClaim) annotations['vops.gitops.io/oidc-groups-claim'] = data.oidc.groupsClaim;
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

  if (data.customEndpoint || (data.oidc && data.oidc.enabled)) {
    body.spec.rawConfig = body.spec.rawConfig || {};
    body.spec.rawConfig.controlPlane = body.spec.rawConfig.controlPlane || {};
    if (data.customEndpoint) {
      let host = data.customEndpoint.trim();
      try {
        const u = new URL(host);
        host = u.hostname;
      } catch {
        host = host.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
      }
      if (host) {
        body.spec.rawConfig.controlPlane.proxy = body.spec.rawConfig.controlPlane.proxy || {};
        body.spec.rawConfig.controlPlane.proxy.extraSANs = [host];
      }
    }
    if (data.oidc && data.oidc.enabled && data.oidc.issuerUrl && data.oidc.clientId) {
      body.spec.rawConfig.controlPlane.distro = body.spec.rawConfig.controlPlane.distro || {};
      body.spec.rawConfig.controlPlane.distro.k8s = body.spec.rawConfig.controlPlane.distro.k8s || {};
      body.spec.rawConfig.controlPlane.distro.k8s.apiServer = body.spec.rawConfig.controlPlane.distro.k8s.apiServer || {};
      body.spec.rawConfig.controlPlane.distro.k8s.apiServer.extraArgs = [
        '--api-audiences=https://kubernetes.default.svc.cluster.local,https://kubernetes.default.svc.,https://kubernetes.default.svc,https://kubernetes.default',
        `--oidc-issuer-url=${data.oidc.issuerUrl}`,
        `--oidc-client-id=${data.oidc.clientId}`,
        `--oidc-username-claim=${data.oidc.usernameClaim || 'email'}`,
        `--oidc-groups-claim=${data.oidc.groupsClaim || 'groups'}`,
      ];
      if (data.oidc.usernamePrefix) {
        body.spec.rawConfig.controlPlane.distro.k8s.apiServer.extraArgs.push(`--oidc-username-prefix=${data.oidc.usernamePrefix}`);
      }
      if (data.oidc.groupsPrefix) {
        body.spec.rawConfig.controlPlane.distro.k8s.apiServer.extraArgs.push(`--oidc-groups-prefix=${data.oidc.groupsPrefix}`);
      }
      if (data.oidc.caFile) {
        body.spec.rawConfig.controlPlane.distro.k8s.apiServer.extraArgs.push(`--oidc-ca-file=${data.oidc.caFile}`);
      }
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

export interface KubeconfigDetails {
  config: string;
  server: string;
  caData?: string;
}

export async function getKubeconfigDetails(name: string, namespace?: string): Promise<KubeconfigDetails | null> {
  try {
    let targetNs = namespace;
    if (!targetNs) {
      const all = await listVirtualClusters();
      const match = all.find((c) => c.name === name);
      targetNs = match ? match.namespace : 'default';
    }
    const res = await k8sRequest<any>(`/api/v1/namespaces/${targetNs}/secrets/${name}-kubeconfig`);
    if (res.statusCode === 200 && res.data?.data?.config) {
      const raw = Buffer.from(res.data.data.config, 'base64').toString('utf-8');
      const caMatch = raw.match(/certificate-authority-data:\s*([A-Za-z0-9+/=]+)/);
      const serverMatch = raw.match(/server:\s*(\S+)/);
      return {
        config: raw,
        server: serverMatch ? serverMatch[1] : '',
        caData: caMatch ? caMatch[1] : undefined,
      };
    }
  } catch {
    // Secret not available yet
  }
  return null;
}

export async function getKubeconfig(name: string, namespace?: string, endpointOverride?: string): Promise<string | null> {
  const details = await getKubeconfigDetails(name, namespace);
  if (!details) return null;
  let config = details.config;
  if (endpointOverride) {
    config = config.replace(/server:\s*https?:\/\/[^\s]+/g, `server: ${endpointOverride}`);
  }
  return config;
}

export function generateOidcKubeconfig(
  cluster: VirtualCluster,
  oidcConfig?: OidcConfig,
  endpointOverride?: string,
  caData?: string
): string {
  const oidc = oidcConfig || cluster.metadata?.oidc || {
    enabled: true,
    issuerUrl: 'https://accounts.google.com',
    clientId: `${cluster.name}-client`,
    usernameClaim: 'email',
    groupsClaim: 'groups',
  };

  const endpoint = endpointOverride || cluster.metadata?.customEndpoint || cluster.status.endpoint || 'https://kubernetes.default.svc';
  const clusterName = cluster.name;
  const contextName = `oidc@${clusterName}`;
  const userName = `oidc@${clusterName}`;

  const issuerUrl = oidc.issuerUrl || 'https://accounts.google.com';
  const clientId = oidc.clientId || `${clusterName}-client`;
  const extraScopes = oidc.extraScopes && oidc.extraScopes.length > 0
    ? oidc.extraScopes
    : ['email', 'profile', 'groups'];

  let clusterBlock = `  name: ${clusterName}
    cluster:
      server: ${endpoint}\n`;
  if (caData) {
    clusterBlock += `      certificate-authority-data: ${caData}\n`;
  } else {
    clusterBlock += `      insecure-skip-tls-verify: true\n`;
  }

  const scopeLines = extraScopes.map((s) => `      - --oidc-extra-scope=${s}`).join('\n');

  return `apiVersion: v1
clusters:
- ${clusterBlock.trim()}
contexts:
- context:
    cluster: ${clusterName}
    user: ${userName}
  name: ${contextName}
current-context: ${contextName}
kind: Config
preferences: {}
users:
- name: ${userName}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: kubectl
      args:
      - oidc-login
      - get-token
      - --oidc-issuer-url=${issuerUrl}
      - --oidc-client-id=${clientId}
${scopeLines}
      - --oidc-use-pkce
`;
}

export function generateMockKubeconfig(cluster: VirtualCluster, endpointOverride?: string): string {
  const server = endpointOverride || cluster.metadata?.customEndpoint || cluster.status.endpoint || 'https://kubernetes.default.svc';
  return `apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: ${server}
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

export async function updateVirtualClusterEndpointAndOidc(
  name: string,
  data: {
    customEndpoint?: string;
    oidc?: OidcConfig;
  },
  namespace?: string
): Promise<VirtualCluster> {
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
  const rawConfig = existing.spec?.rawConfig ? JSON.parse(JSON.stringify(existing.spec.rawConfig)) : {};

  rawConfig.controlPlane = rawConfig.controlPlane || {};
  rawConfig.controlPlane.distro = rawConfig.controlPlane.distro || {};
  rawConfig.controlPlane.distro.k8s = rawConfig.controlPlane.distro.k8s || {};
  rawConfig.controlPlane.distro.k8s.apiServer = rawConfig.controlPlane.distro.k8s.apiServer || {};
  rawConfig.controlPlane.proxy = rawConfig.controlPlane.proxy || {};

  // 1. Handle Endpoint
  if (data.customEndpoint !== undefined) {
    const trimmed = data.customEndpoint.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-endpoint'] = trimmed;
      let host = trimmed;
      try {
        const u = new URL(trimmed);
        host = u.hostname;
      } catch {
        host = trimmed.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
      }
      if (host) {
        const existingSans: string[] = Array.isArray(rawConfig.controlPlane.proxy.extraSANs)
          ? rawConfig.controlPlane.proxy.extraSANs
          : [];
        if (!existingSans.includes(host)) {
          rawConfig.controlPlane.proxy.extraSANs = [...existingSans, host];
        }
      }
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-endpoint'];
    }
  }

  // 2. Handle OIDC
  if (data.oidc !== undefined) {
    const oidc = data.oidc;
    updatedAnnotations['vops.gitops.io/oidc-config'] = JSON.stringify(oidc);
    if (oidc.enabled && oidc.issuerUrl && oidc.clientId) {
      updatedAnnotations['vops.gitops.io/oidc-issuer-url'] = oidc.issuerUrl;
      updatedAnnotations['vops.gitops.io/oidc-client-id'] = oidc.clientId;
      updatedAnnotations['vops.gitops.io/oidc-username-claim'] = oidc.usernameClaim || 'email';
      updatedAnnotations['vops.gitops.io/oidc-groups-claim'] = oidc.groupsClaim || 'groups';
      if (oidc.usernamePrefix !== undefined && oidc.usernamePrefix !== '') {
        updatedAnnotations['vops.gitops.io/oidc-username-prefix'] = oidc.usernamePrefix;
      } else {
        delete updatedAnnotations['vops.gitops.io/oidc-username-prefix'];
      }
      if (oidc.groupsPrefix !== undefined && oidc.groupsPrefix !== '') {
        updatedAnnotations['vops.gitops.io/oidc-groups-prefix'] = oidc.groupsPrefix;
      } else {
        delete updatedAnnotations['vops.gitops.io/oidc-groups-prefix'];
      }
      if (oidc.caFile) {
        updatedAnnotations['vops.gitops.io/oidc-ca-file'] = oidc.caFile;
      } else {
        delete updatedAnnotations['vops.gitops.io/oidc-ca-file'];
      }

      const currentArgs: string[] = Array.isArray(rawConfig.controlPlane.distro.k8s.apiServer.extraArgs)
        ? rawConfig.controlPlane.distro.k8s.apiServer.extraArgs
        : [
            '--api-audiences=https://kubernetes.default.svc.cluster.local,https://kubernetes.default.svc.,https://kubernetes.default.svc,https://kubernetes.default',
          ];

      const oidcFlags = [
        `--oidc-issuer-url=${oidc.issuerUrl}`,
        `--oidc-client-id=${oidc.clientId}`,
        `--oidc-username-claim=${oidc.usernameClaim || 'email'}`,
        `--oidc-groups-claim=${oidc.groupsClaim || 'groups'}`,
      ];
      if (oidc.usernamePrefix !== undefined && oidc.usernamePrefix !== '') {
        oidcFlags.push(`--oidc-username-prefix=${oidc.usernamePrefix}`);
      }
      if (oidc.groupsPrefix !== undefined && oidc.groupsPrefix !== '') {
        oidcFlags.push(`--oidc-groups-prefix=${oidc.groupsPrefix}`);
      }
      if (oidc.caFile) {
        oidcFlags.push(`--oidc-ca-file=${oidc.caFile}`);
      }

      let mergedArgs = [...currentArgs];
      for (const flag of oidcFlags) {
        const prefix = flag.slice(0, flag.indexOf('=') + 1);
        const idx = mergedArgs.findIndex((a) => a.startsWith(prefix));
        if (idx >= 0) {
          mergedArgs[idx] = flag;
        } else {
          mergedArgs.push(flag);
        }
      }
      rawConfig.controlPlane.distro.k8s.apiServer.extraArgs = mergedArgs;
    } else {
      delete updatedAnnotations['vops.gitops.io/oidc-issuer-url'];
      delete updatedAnnotations['vops.gitops.io/oidc-client-id'];
      delete updatedAnnotations['vops.gitops.io/oidc-username-claim'];
      delete updatedAnnotations['vops.gitops.io/oidc-groups-claim'];
      delete updatedAnnotations['vops.gitops.io/oidc-username-prefix'];
      delete updatedAnnotations['vops.gitops.io/oidc-groups-prefix'];
      delete updatedAnnotations['vops.gitops.io/oidc-ca-file'];

      if (Array.isArray(rawConfig.controlPlane?.distro?.k8s?.apiServer?.extraArgs)) {
        rawConfig.controlPlane.distro.k8s.apiServer.extraArgs = rawConfig.controlPlane.distro.k8s.apiServer.extraArgs.filter(
          (a: string) => !a.startsWith('--oidc-')
        );
      }
    }
  }

  // Trigger operator reconciliation
  updatedAnnotations['vops.gitops.io/reconcile-trigger'] = Date.now().toString();

  const patch = {
    metadata: {
      annotations: updatedAnnotations,
    },
    spec: {
      rawConfig,
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

  throw new Error((res.data as any)?.message || `Failed to update virtual cluster endpoint and OIDC: HTTP ${res.statusCode}`);
}
