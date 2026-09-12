import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VirtualCluster, SizePreset, PoliciesSpec, InstalledApp, ClusterGroupInfo, OidcConfig, K8sEvent, ClusterCapacityData, VClusterCapacityItem, DisasterRecoverySpec, DisasterRecoveryStatus, BackupItem, DetectedHardwareInfo, StorageClassInfo } from './types';
import { getAppStoreCatalog } from './appstore';
import { PRESETS } from './presets';
import { syncGuestClusterRBAC } from './cluster-rbac';
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
let cachedHttpsAgent: https.Agent | null = null;

function getHttpsAgent(config: K8sConnectionConfig): https.Agent {
  if (!cachedHttpsAgent) {
    cachedHttpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 64,
      maxFreeSockets: 16,
      timeout: 30000,
      ca: config.ca,
      cert: config.cert,
      key: config.key,
      rejectUnauthorized: config.rejectUnauthorized,
    });
  }
  return cachedHttpsAgent;
}

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
      agent: getHttpsAgent(config),
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

import { parseCpuMillis, parseMemoryBytes, parseBytes, formatBytes, formatCpuMillis, getClusterCapacity } from './metrics-utils';
export { parseCpuMillis, parseMemoryBytes, parseBytes, formatBytes, formatCpuMillis, getClusterCapacity };

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
    const oidcSource = (item.metadata?.annotations?.['vops.gitops.io/oidc-source'] as any) || (oidc.source || (oidc.enabled ? 'custom' : 'global'));
    const oidcInheritedFrom = item.metadata?.annotations?.['vops.gitops.io/oidc-inherited-from'] || oidc.inheritedFrom;
    oidc.source = oidcSource;
    if (oidcInheritedFrom) {
      oidc.inheritedFrom = oidcInheritedFrom;
    }
    const customCaCert = item.metadata?.annotations?.['vops.gitops.io/custom-ca-cert'] || item.metadata?.annotations?.['vops.gitops.io/oidc-ca-cert'] || oidc.caCertificate;
    if (customCaCert) {
      oidc.caCertificate = customCaCert;
    }
    const customCaSecret = item.metadata?.annotations?.['vops.gitops.io/custom-ca-secret'] || oidc.caSecretName;
    if (customCaSecret) {
      oidc.caSecretName = customCaSecret;
    }
    const customCaConfigMap = item.metadata?.annotations?.['vops.gitops.io/custom-ca-configmap'] || oidc.caConfigMapName;
    if (customCaConfigMap) {
      oidc.caConfigMapName = customCaConfigMap;
    }
  } catch {
    // fallback
  }

  const customCaCert = item.metadata?.annotations?.['vops.gitops.io/custom-ca-cert'] || item.metadata?.annotations?.['vops.gitops.io/oidc-ca-cert'] || oidc.caCertificate;
  const customCaSecret = item.metadata?.annotations?.['vops.gitops.io/custom-ca-secret'] || oidc.caSecretName;
  const customCaConfigMap = item.metadata?.annotations?.['vops.gitops.io/custom-ca-configmap'] || oidc.caConfigMapName;

  return {
    name,
    namespace,
    spec: {
      clusterName: spec.clusterName || name,
      clusterType: spec.clusterType || 'vcluster',
      namespaces: spec.namespaces || [],
      vclusterVersion: spec.vclusterVersion || '',
      kubernetesVersion: spec.kubernetesVersion || '',
      sizePreset: ((item.metadata?.annotations?.['vops.gitops.io/sizing-tier'] || spec.sizePreset) as SizePreset) || 'normal',
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
      disasterRecovery: spec.disasterRecovery,
      rawConfig: spec.rawConfig,
      helmValues: spec.helmValues,
      customEndpoint,
      oidc,
    },
    status: {
      phase,
      conditions,
      clusterType: status.clusterType || spec.clusterType || 'vcluster',
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
      disasterRecovery: status.disasterRecovery,
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
      tags: [item.metadata?.annotations?.['vops.gitops.io/sizing-tier'] || spec.sizePreset || 'normal', spec.highAvailability ? 'ha-etcd' : 'single-node'],
      installedApps,
      customEndpoint,
      oidc,
      oidcInheritance: oidc.source,
      oidcInheritedFrom: oidc.inheritedFrom,
      customCaCert,
      customCaSecret,
      customCaConfigMap,
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
    if (targetNs) {
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
    }

    // Fallback: If targetNs was omitted or the cluster was not found in targetNs, search across all namespaces
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    if (match) {
      targetNs = match.namespace;
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
    }

    return null;
  } catch {
    return null;
  }
}

export async function getVirtualClusterEvents(namespace: string, name: string): Promise<K8sEvent[]> {
  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`
    );
    if (res.statusCode === 200 && Array.isArray(res.data?.items)) {
      return res.data.items.map((it: any) => ({
        name: it.metadata?.name,
        type: (it.type === 'Warning' ? 'Warning' : 'Normal') as 'Normal' | 'Warning',
        reason: it.reason || '',
        message: it.message || '',
        count: it.count || 1,
        firstTimestamp: it.firstTimestamp,
        lastTimestamp: it.lastTimestamp || it.eventTime || it.metadata?.creationTimestamp,
        source: it.source,
        sourceComponent: it.reportingComponent || it.source?.component || 'vc-operator',
        involvedObject: it.involvedObject
          ? {
              kind: it.involvedObject.kind,
              name: it.involvedObject.name,
              namespace: it.involvedObject.namespace,
            }
          : undefined,
      })).sort((a: any, b: any) => new Date(b.lastTimestamp || 0).getTime() - new Date(a.lastTimestamp || 0).getTime());
    }
  } catch (err) {
    console.error('Failed fetching events for virtual cluster:', err);
  }
  return [];
}

/**
 * Compacts installed app metadata for safe persistence inside Kubernetes metadata.annotations.
 * Strips bulky raw YAML manifests and raw Helm custom values, keeping only essential metadata,
 * status, Helm release references, and created resource names.
 */
export function compactInstalledAppsForAnnotation(apps: InstalledApp[]): InstalledApp[] {
  return apps.map((app) => ({
    appId: app.appId,
    name: app.name,
    version: app.version,
    category: app.category,
    installedAt: app.installedAt,
    installedBy: app.installedBy,
    status: app.status,
    error: app.error ? String(app.error).slice(0, 300) : undefined,
    helm: app.helm
      ? {
          name: app.helm.name,
          repo: app.helm.repo,
          version: app.helm.version,
          releaseName: app.helm.releaseName,
          namespace: app.helm.namespace,
        }
      : undefined,
    resourcesCreated: app.resourcesCreated,
  }));
}

/**
 * Ensures metadata.annotations stay well within the Kubernetes hard limit of 262,144 bytes (256 KiB).
 * Strips duplicate CA certificates, truncates excessive group lists, compacts installed apps,
 * and prunes non-critical annotations if total payload size approaches the limit.
 */
export function sanitizeAnnotations(annotations: Record<string, string | null | undefined>): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(annotations)) {
    if (v === null) {
      result[k] = null;
    } else if (v !== undefined) {
      result[k] = String(v);
    }
  }

  // 1. CA Certificate Deduplication
  // If custom-ca-cert is present and non-empty, remove redundant oidc-ca-cert
  if (result['vops.gitops.io/custom-ca-cert'] && result['vops.gitops.io/oidc-ca-cert']) {
    delete result['vops.gitops.io/oidc-ca-cert'];
  }

  // 2. Strip redundant caCertificate embedded inside oidc-config JSON
  if (typeof result['vops.gitops.io/oidc-config'] === 'string') {
    try {
      const parsed = JSON.parse(result['vops.gitops.io/oidc-config']);
      if (
        parsed.caCertificate &&
        (result['vops.gitops.io/custom-ca-cert'] ||
          result['vops.gitops.io/oidc-ca-cert'] ||
          parsed.caSecretName ||
          parsed.caConfigMapName)
      ) {
        delete parsed.caCertificate;
        result['vops.gitops.io/oidc-config'] = JSON.stringify(parsed);
      }
    } catch {}
  }

  // 3. Cap allowed-groups to avoid directory explosion (e.g. 1000+ AD/LDAP groups)
  if (typeof result['vops.gitops.io/allowed-groups'] === 'string') {
    const groups = result['vops.gitops.io/allowed-groups']
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
    if (groups.length > 50) {
      result['vops.gitops.io/allowed-groups'] = groups.slice(0, 50).join(',');
    }
  }

  // 4. Cap allowed-emails if excessive
  if (typeof result['vops.gitops.io/allowed-emails'] === 'string') {
    const emails = result['vops.gitops.io/allowed-emails']
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length > 100) {
      result['vops.gitops.io/allowed-emails'] = emails.slice(0, 100).join(',');
    }
  }

  // 5. Compact installed-apps JSON (ensure no raw manifests or raw values)
  if (typeof result['vops.gitops.io/installed-apps'] === 'string') {
    try {
      const raw = JSON.parse(result['vops.gitops.io/installed-apps']);
      if (Array.isArray(raw)) {
        const compacted = compactInstalledAppsForAnnotation(raw);
        result['vops.gitops.io/installed-apps'] = JSON.stringify(compacted);
      }
    } catch {}
  }

  // 6. Hard safety check against the 262,144 byte Kubernetes limit
  // Threshold: 192 KiB to leave plenty of headroom for system annotations like last-applied-configuration
  const MAX_SAFE_BYTES = 192 * 1024;
  let totalBytes = 0;
  for (const [k, v] of Object.entries(result)) {
    if (v !== null) {
      totalBytes += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
    }
  }

  if (totalBytes > MAX_SAFE_BYTES) {
    console.warn(
      `[sanitizeAnnotations] Annotations total size (${totalBytes} bytes) exceeds safe limit (${MAX_SAFE_BYTES} bytes). Pruning non-essential keys...`
    );
    const nonEssential = [
      'vops.gitops.io/installed-apps',
      'vops.gitops.io/oidc-config',
      'vops.gitops.io/restore-snapshot',
      'vops.gitops.io/restored-at',
      'vops.gitops.io/restored-from',
    ];
    for (const key of nonEssential) {
      if (totalBytes <= MAX_SAFE_BYTES) break;
      if (result[key]) {
        const itemBytes = Buffer.byteLength(key, 'utf8') + Buffer.byteLength(result[key]!, 'utf8');
        delete result[key];
        totalBytes -= itemBytes;
      }
    }
  }

  return result;
}

export async function createVirtualCluster(data: {
  clusterName: string;
  clusterType?: 'vcluster' | 'namespaced' | 'host';
  namespaces?: string[];
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
  etcdVersion?: string;
  storageClass?: string;
  etcdStorageClass?: string;
  coreDNSVersion?: string;
  metricsServerVersion?: string;
  istioVersion?: string;
  policies?: PoliciesSpec;
  customResources?: { cpu?: string; memory?: string; storage?: string };
  ignoreCapacityCheck?: boolean;
  disasterRecovery?: DisasterRecoverySpec;
  initialBackupRestore?: string;
  customYaml?: string;
  installedApps?: Array<{ appId: string; customValues?: string }>;
  customEndpoint?: string;
  oidc?: OidcConfig;
  customCaCert?: string;
  customCaSecret?: string;
  customCaConfigMap?: string;
  istio?: {
    enabled: boolean;
    meshEnabled?: boolean;
    certificateIssuer?: string;
    certificateIssuerKind?: string;
    hosts?: string[];
    certSecretName?: string;
    ingressGateway?: {
      enabled?: boolean;
      serviceType?: string;
      replicas?: number;
      selector?: Record<string, string>;
    };
    hostRouting?: {
      enabled: boolean;
      defaultGateway?: string;
      ingressGatewaySelector?: Record<string, string>;
      apiHost?: string;
    };
  };
  gatewayAPI?: {
    enabled: boolean;
    gatewayClassName?: string;
    hosts?: string[];
    certificateIssuer?: string;
    certificateIssuerKind?: 'ClusterIssuer' | 'Issuer';
    gatewayConfig?: {
      replicas?: number;
      defaultGateway?: string;
    };
    hostRouting?: {
      enabled: boolean;
      gatewayName?: string;
      gatewayNamespace?: string;
      apiHost?: string;
    };
  };
}): Promise<VirtualCluster> {
  const name = data.clusterName.trim().toLowerCase();
  const isNamespaced = data.clusterType === 'namespaced' || data.clusterType === 'host';
  const effectiveClusterType = isNamespaced ? 'namespaced' : 'vcluster';
  let k8sVer = data.kubernetesVersion;
  let vclusterVer = data.vclusterVersion;
  let etcdVer = data.etcdVersion;
  let coreDNSVer = data.coreDNSVersion;
  let metricsVer = data.metricsServerVersion;
  let istioVer = data.istioVersion;

  try {
    const { getDefaultVersions } = await import('./version-registry');
    const defaults = await getDefaultVersions();
    k8sVer = k8sVer || defaults.kubernetesVersion;
    vclusterVer = vclusterVer || defaults.vclusterVersion;
    etcdVer = etcdVer || defaults.etcdVersion;
    coreDNSVer = coreDNSVer || defaults.coreDNSVersion;
    metricsVer = metricsVer || defaults.metricsServerVersion;
    istioVer = istioVer || defaults.istioVersion;
  } catch {}

  const missingCore = [
    !k8sVer && 'Kubernetes',
    !isNamespaced && !vclusterVer && 'vCluster Engine',
    !isNamespaced && !etcdVer && 'etcd',
  ].filter(Boolean);
  if (missingCore.length > 0) {
    throw new Error(
      `Cannot deploy ${isNamespaced ? 'cluster' : 'virtual cluster'}: Missing version for core component(s): ${missingCore.join(', ')}. An administrator must import a version registry manifest first.`
    );
  }
  // Pre-flight host capacity guardrail
  if (!data.ignoreCapacityCheck) {
    try {
      const cap = await getHostClusterCapacity();
      const demands = getVClusterDemands({
        sizePreset: data.preset,
        customResources: data.customResources,
        policies: data.policies,
      });

      if (demands.reqCpuMillis > cap.availableCpuMillis) {
        throw new Error(
          `Host overallocation prevented: Requesting ${demands.reqCpuStr} CPU exceeds available cluster headroom (${cap.availableCpuStr} remaining of ${cap.allocatableCpuStr} allocatable).`
        );
      }
      if (demands.reqMemBytes > cap.availableMemoryBytes) {
        throw new Error(
          `Host overallocation prevented: Requesting ${demands.reqMemStr} Memory exceeds available cluster headroom (${cap.availableMemoryStr} remaining of ${cap.allocatableMemoryStr} allocatable).`
        );
      }
      if (demands.reqStorageBytes > cap.availableStorageBytes) {
        throw new Error(
          `Host overallocation prevented: Requesting ${demands.reqStorageStr} Storage exceeds available cluster headroom (${cap.availableStorageStr} remaining of ${cap.allocatableStorageStr} allocatable).`
        );
      }
    } catch (e: any) {
      if (e.message?.startsWith('Host overallocation prevented')) {
        throw e;
      }
      console.warn('Pre-flight capacity check skipped due to error:', e);
    }
  }

  const isHA = data.preset === 'ha' || data.preset === 'large' || data.preset === 'medium';
  const namespace = (data as any).namespace || (name === 'team-alpha-dev' ? 'default' : name);

  if (namespace !== 'default') {
    await k8sRequest('/api/v1/namespaces', 'POST', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace },
    }).catch(() => {});
  }

  if (data.namespaces && data.namespaces.length > 0) {
    for (const ns of data.namespaces) {
      if (ns && ns !== 'default' && ns !== namespace) {
        await k8sRequest('/api/v1/namespaces', 'POST', {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: { name: ns },
        }).catch(() => {});
      }
    }
  }

  const annotations: Record<string, string> = {
    'vops.gitops.io/owner': data.owner || 'Platform User',
  };
  if (data.ignoreCapacityCheck) {
    annotations['vops.gitops.io/ignore-capacity-check'] = 'true';
  }
  if (data.allowedGroups && data.allowedGroups.length > 0) {
    annotations['vops.gitops.io/allowed-groups'] = data.allowedGroups.join(',');
  }
  if (data.allowedEmails && data.allowedEmails.length > 0) {
    annotations['vops.gitops.io/allowed-emails'] = data.allowedEmails.join(',');
  }

  if (data.initialBackupRestore) {
    annotations['vops.gitops.io/restored-from'] = data.initialBackupRestore;
  }
  if (data.customEndpoint) {
    annotations['vops.gitops.io/custom-endpoint'] = data.customEndpoint.trim();
  }
  const groupsList = Array.isArray(data.clusterGroups) && data.clusterGroups.length > 0
    ? data.clusterGroups
    : (data.clusterGroup ? [data.clusterGroup] : []);
  if (groupsList.length > 0) {
    annotations['vops.gitops.io/cluster-groups'] = groupsList.join(',');
    annotations['vops.gitops.io/cluster-group'] = groupsList[0];
  }

  let effectiveOidc = data.oidc;
  if (!effectiveOidc) {
    try {
      const { getOidcRegistry, resolveOidcForCluster } = await import('./oidc-registry');
      const registry = await getOidcRegistry();
      const resolved = resolveOidcForCluster({ name, metadata: { clusterGroups: groupsList } } as any, registry);
      if (resolved && resolved.oidc && resolved.oidc.enabled) {
        effectiveOidc = resolved.oidc;
      }
    } catch {
      // Ignore resolution error during cluster creation
    }
  }

  if (effectiveOidc) {
    const oidcToStore = { ...effectiveOidc };
    if (oidcToStore.caCertificate && (data.customCaCert || oidcToStore.caSecretName || oidcToStore.caConfigMapName)) {
      delete oidcToStore.caCertificate;
    }
    annotations['vops.gitops.io/oidc-config'] = JSON.stringify(oidcToStore);
    if (effectiveOidc.issuerUrl) annotations['vops.gitops.io/oidc-issuer-url'] = effectiveOidc.issuerUrl;
    if (effectiveOidc.clientId) annotations['vops.gitops.io/oidc-client-id'] = effectiveOidc.clientId;
    if (effectiveOidc.usernameClaim) annotations['vops.gitops.io/oidc-username-claim'] = effectiveOidc.usernameClaim;
    if (effectiveOidc.groupsClaim) annotations['vops.gitops.io/oidc-groups-claim'] = effectiveOidc.groupsClaim;
    if (effectiveOidc.source) annotations['vops.gitops.io/oidc-source'] = effectiveOidc.source;
    if (effectiveOidc.inheritedFrom) annotations['vops.gitops.io/oidc-inherited-from'] = effectiveOidc.inheritedFrom;
  }

  const customCa = data.customCaCert || effectiveOidc?.caCertificate;
  if (customCa && customCa.trim()) {
    annotations['vops.gitops.io/custom-ca-cert'] = customCa.trim();
    annotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
  }
  const customSec = data.customCaSecret || effectiveOidc?.caSecretName;
  if (customSec && customSec.trim()) {
    annotations['vops.gitops.io/custom-ca-secret'] = customSec.trim();
    annotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
  }
  const customCm = data.customCaConfigMap || effectiveOidc?.caConfigMapName;
  if (customCm && customCm.trim()) {
    annotations['vops.gitops.io/custom-ca-configmap'] = customCm.trim();
    annotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
  }

  const labels: Record<string, string> = {
    'vops.gitops.io/cluster': name,
    'vops.gitops.io/owner': (data.owner || 'platform-user').replace(/[^a-zA-Z0-9_-]/g, '-'),
    'vops.gitops.io/environment': data.environment || 'development',
  };
  if (groupsList.length > 0) {
    labels['vops.gitops.io/cluster-group'] = groupsList[0].replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 63);
  }

  const KNOWN_CRD_PRESETS = ['normal', 'ha', 'small', 'medium', 'large', 'custom'];
  const isKnownPreset = KNOWN_CRD_PRESETS.includes(data.preset);
  const effectiveSizePreset = isKnownPreset ? data.preset : 'custom';
  annotations['vops.gitops.io/sizing-tier'] = data.preset;

  const effectiveCustomResources = data.customResources || (
    !isKnownPreset
      ? {
          cpu: data.policies?.resourceQuota?.limitsCPU || '4',
          memory: data.policies?.resourceQuota?.limitsMemory || '8Gi',
          storage: data.policies?.resourceQuota?.requestsStorage || '20Gi',
        }
      : undefined
  );

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
      clusterType: effectiveClusterType,
      ...(data.namespaces && data.namespaces.length > 0 ? { namespaces: data.namespaces } : {}),
      ...(!isNamespaced && vclusterVer ? { vclusterVersion: vclusterVer } : {}),
      kubernetesVersion: k8sVer || '',
      ...(!isNamespaced && etcdVer ? { etcdVersion: etcdVer } : {}),
      ...(data.storageClass ? { storageClass: data.storageClass } : {}),
      ...(!isNamespaced && data.etcdStorageClass ? { etcdStorageClass: data.etcdStorageClass } : {}),
      sizePreset: effectiveSizePreset,
      highAvailability: isHA,
      ...(effectiveCustomResources ? { customResources: effectiveCustomResources } : {}),
      components: {
        coreDNS: {
          enabled: data.enableMonitoringAndDNS ?? true,
          version: coreDNSVer,
        },
        metricsServer: {
          enabled: data.enableMonitoringAndDNS ?? true,
          version: metricsVer,
        },
        ...(data.istio
          ? {
              istio: {
                ...data.istio,
                version: istioVer,
              },
            }
          : {}),
        ...(data.gatewayAPI
          ? {
              gatewayAPI: data.gatewayAPI,
            }
          : {}),
      },
      ...(!isNamespaced ? { sync: { pods: true, services: true, ingresses: true } } : {}),
      lifecycle: {
        autoSleep: data.autoSleep ?? false,
        ttlHours: data.ttlHours ?? 0,
      },
      policies: data.policies,
      ...(!isNamespaced
        ? {
            disasterRecovery: data.disasterRecovery || {
              enabled: true,
              schedule: 'daily',
              retentionCount: 7,
              storageSize: '10Gi',
              initialBackupRestore: data.initialBackupRestore,
            },
          }
        : {}),
    },
  };

  if (data.initialBackupRestore && body.spec.disasterRecovery) {
    body.spec.disasterRecovery.initialBackupRestore = data.initialBackupRestore;
  }

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

      // Store compacted installed apps metadata in annotations (strips raw manifests and custom values)
      annotations['vops.gitops.io/installed-apps'] = JSON.stringify(compactInstalledAppsForAnnotation(appsToSave));

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

  body.metadata.annotations = sanitizeAnnotations(annotations);

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
  namespace?: string,
  ignoreCapacityCheck?: boolean
): Promise<VirtualCluster | null> {
  const all = await listVirtualClusters();
  const currentCluster = all.find((c) => c.name === name);
  const targetNs = namespace || (currentCluster ? currentCluster.namespace : 'default');

  // Pre-flight capacity check if increasing requested quota
  if (!ignoreCapacityCheck && policies.resourceQuota) {
    try {
      const cap = await getHostClusterCapacity();
      const currentDemands = currentCluster
        ? getVClusterDemands({
            sizePreset: currentCluster.spec?.sizePreset || (currentCluster as any).sizePreset,
            customResources: currentCluster.spec?.customResources || (currentCluster as any).raw?.spec?.customResources,
            policies: currentCluster.spec?.policies || (currentCluster as any).policies,
          })
        : { reqCpuMillis: 0, reqMemBytes: 0, reqStorageBytes: 0, reqCpuStr: '0', reqMemStr: '0', reqStorageStr: '0' };

      const newDemands = getVClusterDemands({
        sizePreset: currentCluster?.spec?.sizePreset || (currentCluster as any)?.sizePreset,
        policies,
      });

      const deltaCpu = newDemands.reqCpuMillis - currentDemands.reqCpuMillis;
      const deltaMem = newDemands.reqMemBytes - currentDemands.reqMemBytes;
      const deltaStorage = newDemands.reqStorageBytes - currentDemands.reqStorageBytes;

      if (deltaCpu > 0 && deltaCpu > cap.availableCpuMillis) {
        throw new Error(
          `Host overallocation prevented: Increasing CPU to ${newDemands.reqCpuStr} exceeds remaining host capacity (${cap.availableCpuStr} available).`
        );
      }
      if (deltaMem > 0 && deltaMem > cap.availableMemoryBytes) {
        throw new Error(
          `Host overallocation prevented: Increasing Memory to ${newDemands.reqMemStr} exceeds remaining host capacity (${cap.availableMemoryStr} available).`
        );
      }
      if (deltaStorage > 0 && deltaStorage > cap.availableStorageBytes) {
        throw new Error(
          `Host overallocation prevented: Increasing Storage to ${newDemands.reqStorageStr} exceeds remaining host capacity (${cap.availableStorageStr} available).`
        );
      }
    } catch (e: any) {
      if (e.message?.startsWith('Host overallocation prevented')) {
        throw e;
      }
      console.warn('Capacity validation skipped:', e);
    }
  }

  const patch: any = {
    spec: {
      policies,
    },
  };

  if (ignoreCapacityCheck) {
    patch.metadata = {
      annotations: {
        'vops.gitops.io/ignore-capacity-check': 'true',
      },
    };
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

  // Trigger immediate reconcile
  updatedAnnotations['vops.gitops.io/reconcile-trigger'] = Date.now().toString();

  const patch = {
    metadata: {
      annotations: sanitizeAnnotations(updatedAnnotations),
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
    // Fast-path guest RBAC sync
    try {
      const rawKc = await getKubeconfig(name, targetNs);
      if (rawKc) {
        const effectiveOwner = rbac.owner !== undefined ? rbac.owner : updatedAnnotations['vops.gitops.io/owner'];
        const effectiveGroups = rbac.allowedGroups !== undefined
          ? rbac.allowedGroups
          : (updatedAnnotations['vops.gitops.io/allowed-groups'] || '').split(',').filter(Boolean);
        const effectiveEmails = rbac.allowedEmails !== undefined
          ? rbac.allowedEmails
          : (updatedAnnotations['vops.gitops.io/allowed-emails'] || '').split(',').filter(Boolean);

        await syncGuestClusterRBAC(rawKc, name, targetNs, effectiveOwner, effectiveGroups, effectiveEmails);
      }
    } catch (e: any) {
      console.warn(`[updateVirtualClusterRBAC] Guest RBAC fast-path sync failed for ${name}:`, e.message);
    }

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
    etcdVersion?: string;
    coreDNSVersion?: string;
    metricsServerVersion?: string;
    istioVersion?: string;
  },
  namespace?: string
): Promise<VirtualCluster | null> {
  let targetNs = namespace;
  if (!targetNs) {
    const all = await listVirtualClusters();
    const match = all.find((c) => c.name === name);
    targetNs = match ? match.namespace : 'default';
  }

  const patch: any = {
    metadata: {
      annotations: {
        'vops.gitops.io/reconcile-trigger': Date.now().toString(),
      },
    },
    spec: {},
  };
  if (upgrades.kubernetesVersion) {
    patch.spec.kubernetesVersion = upgrades.kubernetesVersion;
  }
  if (upgrades.vclusterVersion) {
    patch.spec.vclusterVersion = upgrades.vclusterVersion;
  }
  if (upgrades.etcdVersion) {
    patch.spec.etcdVersion = upgrades.etcdVersion;
  }
  if (upgrades.coreDNSVersion || upgrades.metricsServerVersion || upgrades.istioVersion) {
    patch.spec.components = {};
    if (upgrades.coreDNSVersion) {
      patch.spec.components.coreDNS = { version: upgrades.coreDNSVersion };
    }
    if (upgrades.metricsServerVersion) {
      patch.spec.components.metricsServer = { version: upgrades.metricsServerVersion };
    }
    if (upgrades.istioVersion) {
      patch.spec.components.istio = { version: upgrades.istioVersion };
    }
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
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return true;
    }
    // Fallback: If VirtualCluster CR is not found (404), check if a dedicated namespace exists and clean it up
    if (
      res.statusCode === 404 &&
      targetNs &&
      targetNs !== 'default' &&
      targetNs !== 'kube-system' &&
      targetNs !== 'vcop-system'
    ) {
      const nsRes = await k8sRequest<any>(`/api/v1/namespaces/${targetNs}`, 'DELETE');
      return nsRes.statusCode >= 200 && nsRes.statusCode < 300;
    }
    return false;
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

  let effectiveCaData = caData;
  if (!effectiveCaData && cluster.metadata?.customCaCert) {
    effectiveCaData = Buffer.from(cluster.metadata.customCaCert.trim()).toString('base64');
  }

  let clusterLines = `cluster:\n    server: ${endpoint}\n`;
  if (effectiveCaData) {
    clusterLines += `    certificate-authority-data: ${effectiveCaData}\n`;
  } else {
    clusterLines += `    insecure-skip-tls-verify: true\n`;
  }
  clusterLines += `  name: ${clusterName}`;

  const scopeLines = extraScopes.map((s) => `      - --oidc-extra-scope=${s}`).join('\n');

  return `apiVersion: v1
kind: Config
preferences: {}
clusters:
- ${clusterLines.trim()}
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
      - --oidc-pkce-method=auto
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
    customCaCert?: string;
    customCaSecret?: string;
    customCaConfigMap?: string;
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
      if (oidc.source) {
        updatedAnnotations['vops.gitops.io/oidc-source'] = oidc.source;
      }
      if (oidc.inheritedFrom) {
        updatedAnnotations['vops.gitops.io/oidc-inherited-from'] = oidc.inheritedFrom;
      } else {
        delete updatedAnnotations['vops.gitops.io/oidc-inherited-from'];
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
      if (!oidc.caFile) {
        mergedArgs = mergedArgs.filter((a) => !a.startsWith('--oidc-ca-file='));
      }

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

  // 3. Handle Custom CA Certificates
  if (data.customCaCert !== undefined) {
    const trimmed = data.customCaCert.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-ca-cert'] = trimmed;
      delete updatedAnnotations['vops.gitops.io/oidc-ca-cert'];
      updatedAnnotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-ca-cert'];
      delete updatedAnnotations['vops.gitops.io/oidc-ca-cert'];
    }
  } else if (data.oidc?.caCertificate !== undefined) {
    const trimmed = data.oidc.caCertificate.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-ca-cert'] = trimmed;
      delete updatedAnnotations['vops.gitops.io/oidc-ca-cert'];
      updatedAnnotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-ca-cert'];
      delete updatedAnnotations['vops.gitops.io/oidc-ca-cert'];
    }
  }

  if (data.customCaSecret !== undefined) {
    const trimmed = data.customCaSecret.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-ca-secret'] = trimmed;
      updatedAnnotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-ca-secret'];
    }
  } else if (data.oidc?.caSecretName !== undefined) {
    const trimmed = data.oidc.caSecretName.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-ca-secret'] = trimmed;
      updatedAnnotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-ca-secret'];
    }
  }

  if (data.customCaConfigMap !== undefined) {
    const trimmed = data.customCaConfigMap.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-ca-configmap'] = trimmed;
      updatedAnnotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-ca-configmap'];
    }
  } else if (data.oidc?.caConfigMapName !== undefined) {
    const trimmed = data.oidc.caConfigMapName.trim();
    if (trimmed) {
      updatedAnnotations['vops.gitops.io/custom-ca-configmap'] = trimmed;
      updatedAnnotations['vops.gitops.io/oidc-ca-file'] = '/etc/ssl/custom-ca/ca.crt';
    } else {
      delete updatedAnnotations['vops.gitops.io/custom-ca-configmap'];
    }
  }

  const hasAnyCa = Boolean(
    updatedAnnotations['vops.gitops.io/custom-ca-cert'] ||
    updatedAnnotations['vops.gitops.io/oidc-ca-cert'] ||
    updatedAnnotations['vops.gitops.io/custom-ca-secret'] ||
    updatedAnnotations['vops.gitops.io/custom-ca-configmap']
  );
  if (!hasAnyCa) {
    delete updatedAnnotations['vops.gitops.io/oidc-ca-file'];
  }

  // Trigger operator reconciliation
  updatedAnnotations['vops.gitops.io/reconcile-trigger'] = Date.now().toString();

  // Explicitly set removed annotations to null so RFC 7396 merge patch deletes them
  const patchAnnotations: Record<string, string | null> = {};
  for (const k of Object.keys(existing.metadata?.annotations || {})) {
    if (!(k in updatedAnnotations)) {
      patchAnnotations[k] = null;
    }
  }
  for (const [k, v] of Object.entries(updatedAnnotations)) {
    patchAnnotations[k] = v;
  }

  const patch = {
    metadata: {
      annotations: sanitizeAnnotations(patchAnnotations),
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

/**
 * Updates or configures the opinionated Istio entrypoint & mesh settings on a VirtualCluster.
 */
export async function updateVirtualClusterIstio(
  name: string,
  istioConfig: {
    enabled: boolean;
    meshEnabled?: boolean;
    certificateIssuer?: string;
    certificateIssuerKind?: string;
    hosts?: string[];
    version?: string;
    ingressGateway?: {
      enabled?: boolean;
      serviceType?: string;
      replicas?: number;
      selector?: Record<string, string>;
    };
    hostRouting?: {
      enabled: boolean;
      defaultGateway?: string;
      ingressGatewaySelector?: Record<string, string>;
      apiHost?: string;
    };
  },
  namespace?: string
): Promise<VirtualCluster> {
  const targetNs = namespace || (name === 'team-alpha-dev' ? 'default' : name);
  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`
  );

  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Virtual cluster ${name} not found in namespace ${targetNs}`);
  }

  const existing = getRes.data;
  const existingComponents = existing.spec?.components || {};

  const patch = {
    metadata: {
      annotations: {
        'vops.gitops.io/reconcile-trigger': Date.now().toString(),
      },
    },
    spec: {
      components: {
        ...existingComponents,
        istio: istioConfig,
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

  throw new Error((res.data as any)?.message || `Failed to update virtual cluster Istio: HTTP ${res.statusCode}`);
}

/**
 * Update opinionated Kubernetes Gateway API configuration on a VirtualCluster
 */
export async function updateVirtualClusterGatewayAPI(
  name: string,
  gatewayAPIConfig: {
    enabled: boolean;
    version?: string;
    gatewayClassName?: string;
    replicas?: number;
    gatewayConfig?: {
      enabled?: boolean;
      serviceType?: string;
      replicas?: number;
      selector?: Record<string, string>;
    };
    certificateIssuer?: string;
    certificateIssuerKind?: string;
    hosts?: string[];
    certSecretName?: string;
    hostRouting?: {
      enabled: boolean;
      defaultGateway?: string;
      ingressGatewaySelector?: Record<string, string>;
      apiHost?: string;
    };
  },
  namespace?: string
): Promise<VirtualCluster> {
  const targetNs = namespace || (name === 'team-alpha-dev' ? 'default' : name);
  const getRes = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${name}`
  );

  if (getRes.statusCode !== 200 || !getRes.data) {
    throw new Error(`Virtual cluster ${name} not found in namespace ${targetNs}`);
  }

  const existing = getRes.data;
  const existingComponents = existing.spec?.components || {};

  const patch = {
    metadata: {
      annotations: {
        'vops.gitops.io/reconcile-trigger': Date.now().toString(),
      },
    },
    spec: {
      components: {
        ...existingComponents,
        gatewayAPI: gatewayAPIConfig,
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

  throw new Error((res.data as any)?.message || `Failed to update virtual cluster Gateway API: HTTP ${res.statusCode}`);
}

// ==========================================
// Capacity & Overallocation Management
// ==========================================

export function getVClusterDemands(vc: {
  sizePreset?: SizePreset;
  customResources?: { cpu?: string; memory?: string; storage?: string };
  policies?: { resourceQuota?: any };
}) {
  let reqCpu = '4';
  let reqMem = '8Gi';
  let reqStorage = '25Gi';
  let limCpu = '8';
  let limMem = '16Gi';

  const preset = vc.sizePreset || 'medium';
  if (preset === 'small' || preset === 'normal') {
    reqCpu = '1';
    reqMem = '2Gi';
    reqStorage = '10Gi';
    limCpu = '2';
    limMem = '4Gi';
  } else if (preset === 'ha' || preset === 'large') {
    reqCpu = '8';
    reqMem = '16Gi';
    reqStorage = '50Gi';
    limCpu = '16';
    limMem = '32Gi';
  }

  if (vc.customResources) {
    if (vc.customResources.cpu) {
      reqCpu = vc.customResources.cpu;
      limCpu = vc.customResources.cpu;
    }
    if (vc.customResources.memory) {
      reqMem = vc.customResources.memory;
      limMem = vc.customResources.memory;
    }
    if (vc.customResources.storage) {
      reqStorage = vc.customResources.storage;
    }
  }

  if (vc.policies?.resourceQuota) {
    const rq = vc.policies.resourceQuota;
    if (rq.requestsCPU) reqCpu = rq.requestsCPU;
    if (rq.requestsMemory) reqMem = rq.requestsMemory;
    if (rq.requestsStorage) reqStorage = rq.requestsStorage;
    if (rq.limitsCPU) limCpu = rq.limitsCPU;
    if (rq.limitsMemory) limMem = rq.limitsMemory;
  }

  return {
    reqCpuMillis: parseCpuMillis(reqCpu),
    reqMemBytes: parseBytes(reqMem),
    reqStorageBytes: parseBytes(reqStorage),
    limCpuMillis: parseCpuMillis(limCpu),
    limMemBytes: parseBytes(limMem),
    reqCpuStr: reqCpu,
    reqMemStr: reqMem,
    reqStorageStr: reqStorage,
    limCpuStr: limCpu,
    limMemStr: limMem,
  };
}

/**
 * Dynamically detects cluster accelerator and host hardware.
 * Probes:
 * 1. vcop-system/vcop-hardware-info ConfigMap (published by the operator)
 * 2. Host cluster nodes for allocatable GPUs and accelerator labels
 * 3. Local host driver (/proc/driver/nvidia/gpus) if accessible
 * 4. Falls back to host CPU architecture and thread capacity
 */
export async function getClusterHardware(): Promise<DetectedHardwareInfo> {
  // 1. Check vcop-hardware-info ConfigMap (populated by vc-operator)
  try {
    const cmRes = await k8sRequest<any>('/api/v1/namespaces/vcop-system/configmaps/vcop-hardware-info');
    if (cmRes.statusCode === 200 && cmRes.data?.data) {
      const data = cmRes.data.data;
      const totalGpus = parseInt(data.totalGpus || '0', 10);
      const allocatableGpus = parseInt(data.allocatableGpus || '0', 10);
      const vendor = data.gpuVendor || 'None';
      const model = data.gpuModel || 'None';
      const cpuCount = os.cpus ? os.cpus().length : 8;
      const hardwareString = data.hardwareString || (vendor !== 'None' ? `${model} (${vendor})` : `CPU Engine (${cpuCount} Cores)`);
      return {
        isGpu: vendor !== 'None' && totalGpus > 0,
        vendor,
        model,
        hardwareString,
        totalGpus,
        allocatableGpus,
      };
    }
  } catch {}

  // 2. Query cluster nodes directly from Kubernetes API
  let totalGpus = 0;
  let allocatableGpus = 0;
  let vendor = 'None';
  let model = '';

  try {
    const nodesRes = await k8sRequest<any>('/api/v1/nodes').catch(() => null);
    const nodes = nodesRes?.data?.items || [];

    for (const node of nodes) {
      const alloc = node.status?.allocatable || {};
      const cap = node.status?.capacity || {};
      const labels = node.metadata?.labels || {};

      for (const [key, val] of Object.entries(alloc)) {
        const kLower = key.toLowerCase();
        if (kLower.includes('gpu')) {
          allocatableGpus += parseInt(String(val) || '0', 10);
          if (kLower.includes('nvidia')) vendor = 'NVIDIA';
          else if (kLower.includes('amd')) vendor = 'AMD';
          else if (kLower.includes('intel')) vendor = 'Intel';
        }
      }

      for (const [key, val] of Object.entries(cap)) {
        if (key.toLowerCase().includes('gpu')) {
          totalGpus += parseInt(String(val) || '0', 10);
        }
      }

      for (const [key, val] of Object.entries(labels)) {
        const kLower = key.toLowerCase();
        if (
          (kLower.includes('gpu.product') ||
           kLower.includes('accelerator') ||
           kLower.includes('gpu-model') ||
           kLower.includes('gpu.family')) &&
          val
        ) {
          if (!model) {
            model = String(val).replace(/[-_]/g, ' ');
          }
        }
      }
    }
  } catch {}

  // 3. Check host kernel driver proc (/proc/driver/nvidia/gpus/*/information)
  if (!model) {
    try {
      const nvidiaProcDir = '/proc/driver/nvidia/gpus';
      if (fs.existsSync(nvidiaProcDir)) {
        const entries = fs.readdirSync(nvidiaProcDir);
        for (const entry of entries) {
          const infoPath = path.join(nvidiaProcDir, entry, 'information');
          if (fs.existsSync(infoPath)) {
            const content = fs.readFileSync(infoPath, 'utf8');
            const modelMatch = content.match(/Model:\s*([^\r\n]+)/i);
            if (modelMatch && modelMatch[1]) {
              model = modelMatch[1].trim();
              vendor = 'NVIDIA';
              if (totalGpus === 0) {
                totalGpus = 1;
                allocatableGpus = 1;
              }
              break;
            }
          }
        }
      }
    } catch {}
  }

  if (model) {
    if (vendor === 'NVIDIA') {
      if (!model.toLowerCase().startsWith('nvidia')) {
        model = 'NVIDIA ' + model;
      }
      return {
        isGpu: true,
        vendor,
        model,
        hardwareString: `${model} (CUDA)`,
        totalGpus: totalGpus || 1,
        allocatableGpus: allocatableGpus || 1,
      };
    } else if (vendor === 'AMD') {
      return {
        isGpu: true,
        vendor,
        model,
        hardwareString: `${model} (ROCm)`,
        totalGpus: totalGpus || 1,
        allocatableGpus: allocatableGpus || 1,
      };
    } else if (vendor === 'Intel') {
      return {
        isGpu: true,
        vendor,
        model,
        hardwareString: `${model} (oneAPI)`,
        totalGpus: totalGpus || 1,
        allocatableGpus: allocatableGpus || 1,
      };
    }
    return {
      isGpu: true,
      vendor,
      model,
      hardwareString: model,
      totalGpus: totalGpus || 1,
      allocatableGpus: allocatableGpus || 1,
    };
  }

  // 4. Default CPU fallback
  const cpus = os.cpus ? os.cpus() : [];
  const cpuCount = cpus.length || 8;
  const cpuModel = cpus[0]?.model ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'Host Multi-Threaded';
  return {
    isGpu: false,
    vendor: 'None',
    model: 'CPU',
    hardwareString: `CPU Engine (${cpuCount} Cores • ${cpuModel.split(' ')[0]})`,
    totalGpus: 0,
    allocatableGpus: 0,
  };
}

export async function getHostClusterCapacity(): Promise<ClusterCapacityData> {
  const [nodesRes, hw] = await Promise.all([
    k8sRequest<any>('/api/v1/nodes').catch((e) => {
      console.warn('Failed listing nodes for capacity:', e);
      return { statusCode: 500, data: { items: [] } };
    }),
    getClusterHardware().catch(() => ({
      isGpu: false,
      vendor: 'None',
      model: 'CPU',
      hardwareString: 'CPU Engine',
      totalGpus: 0,
      allocatableGpus: 0,
    })),
  ]);

  const nodes = nodesRes.data?.items || [];
  let allocatableCpuMillis = 0;
  let allocatableMemoryBytes = 0;
  let allocatableStorageBytes = 0;
  let totalCpuMillis = 0;
  let totalMemoryBytes = 0;
  let totalStorageBytes = 0;
  const nodeNames: string[] = [];

  for (const node of nodes) {
    nodeNames.push(node.metadata?.name || 'unknown');
    const alloc = node.status?.allocatable || {};
    const cap = node.status?.capacity || {};

    allocatableCpuMillis += parseCpuMillis(alloc.cpu);
    allocatableMemoryBytes += parseBytes(alloc.memory);
    allocatableStorageBytes += parseBytes(alloc['ephemeral-storage']);

    totalCpuMillis += parseCpuMillis(cap.cpu);
    totalMemoryBytes += parseBytes(cap.memory);
    totalStorageBytes += parseBytes(cap['ephemeral-storage']);
  }

  // Fallbacks if not connected to live cluster
  if (allocatableCpuMillis === 0) allocatableCpuMillis = 32000;
  if (allocatableMemoryBytes === 0) allocatableMemoryBytes = 32 * 1024 ** 3;
  if (allocatableStorageBytes === 0) allocatableStorageBytes = 2000 * 1024 ** 3;
  if (totalCpuMillis === 0) totalCpuMillis = allocatableCpuMillis;
  if (totalMemoryBytes === 0) totalMemoryBytes = allocatableMemoryBytes;
  if (totalStorageBytes === 0) totalStorageBytes = allocatableStorageBytes;

  const clusters = await listVirtualClusters().catch(() => []);

  let requestedCpuMillis = 0;
  let requestedMemoryBytes = 0;
  let requestedStorageBytes = 0;
  let limitsCpuMillis = 0;
  let limitsMemoryBytes = 0;
  let usedCpuMillis = 0;
  let usedMemoryBytes = 0;
  let usedStorageBytes = 0;

  const vclusters: VClusterCapacityItem[] = [];

  for (const c of clusters) {
    const demands = getVClusterDemands({
      sizePreset: c.spec?.sizePreset || (c as any).sizePreset,
      customResources: c.spec?.customResources || (c as any).raw?.spec?.customResources,
      policies: c.spec?.policies || (c as any).policies,
    });

    requestedCpuMillis += demands.reqCpuMillis;
    requestedMemoryBytes += demands.reqMemBytes;
    requestedStorageBytes += demands.reqStorageBytes;
    limitsCpuMillis += demands.limCpuMillis;
    limitsMemoryBytes += demands.limMemBytes;

    const uCpu = parseCpuMillis(c.status?.quota?.used?.['requests.cpu'] || c.status?.metrics?.cpuUsage || (c as any).quota?.used?.['requests.cpu'] || (c as any).metrics?.cpuUsage || '0');
    const uMem = parseBytes(c.status?.quota?.used?.['requests.memory'] || c.status?.metrics?.memoryUsage || (c as any).quota?.used?.['requests.memory'] || (c as any).metrics?.memoryUsage || '0');
    const uStorage = parseBytes(c.status?.quota?.used?.['requests.storage'] || (c as any).quota?.used?.['requests.storage'] || '0');

    usedCpuMillis += uCpu;
    usedMemoryBytes += uMem;
    usedStorageBytes += uStorage;

    const cpuShare = allocatableCpuMillis > 0 ? (demands.reqCpuMillis / allocatableCpuMillis) * 100 : 0;
    const memShare = allocatableMemoryBytes > 0 ? (demands.reqMemBytes / allocatableMemoryBytes) * 100 : 0;
    const storageShare = allocatableStorageBytes > 0 ? (demands.reqStorageBytes / allocatableStorageBytes) * 100 : 0;

    vclusters.push({
      name: c.name,
      namespace: c.namespace,
      phase: c.status?.phase || (c as any).phase || 'Unknown',
      preset: c.spec?.sizePreset || (c as any).sizePreset || 'normal',
      requestedCpuMillis: demands.reqCpuMillis,
      requestedCpuStr: demands.reqCpuStr,
      requestedMemoryBytes: demands.reqMemBytes,
      requestedMemoryStr: demands.reqMemStr,
      requestedStorageBytes: demands.reqStorageBytes,
      requestedStorageStr: demands.reqStorageStr,
      limitsCpuMillis: demands.limCpuMillis,
      limitsCpuStr: demands.limCpuStr,
      limitsMemoryBytes: demands.limMemBytes,
      limitsMemoryStr: demands.limMemStr,
      usedCpuMillis: uCpu,
      usedCpuStr: formatCpuMillis(uCpu),
      usedMemoryBytes: uMem,
      usedMemoryStr: formatBytes(uMem),
      usedStorageBytes: uStorage,
      usedStorageStr: formatBytes(uStorage),
      cpuSharePercent: Math.round(cpuShare * 10) / 10,
      memorySharePercent: Math.round(memShare * 10) / 10,
      storageSharePercent: Math.round(storageShare * 10) / 10,
    });
  }

  const availableCpuMillis = Math.max(0, allocatableCpuMillis - requestedCpuMillis);
  const availableMemoryBytes = Math.max(0, allocatableMemoryBytes - requestedMemoryBytes);
  const availableStorageBytes = Math.max(0, allocatableStorageBytes - requestedStorageBytes);

  const cpuUtilizationPct = allocatableCpuMillis > 0 ? Math.round((requestedCpuMillis / allocatableCpuMillis) * 1000) / 10 : 0;
  const memoryUtilizationPct = allocatableMemoryBytes > 0 ? Math.round((requestedMemoryBytes / allocatableMemoryBytes) * 1000) / 10 : 0;
  const storageUtilizationPct = allocatableStorageBytes > 0 ? Math.round((requestedStorageBytes / allocatableStorageBytes) * 1000) / 10 : 0;

  return {
    totalNodes: nodes.length || 1,
    nodeNames,
    allocatableCpuMillis,
    allocatableCpuStr: formatCpuMillis(allocatableCpuMillis),
    allocatableMemoryBytes,
    allocatableMemoryStr: formatBytes(allocatableMemoryBytes),
    allocatableStorageBytes,
    allocatableStorageStr: formatBytes(allocatableStorageBytes),
    totalCpuMillis,
    totalCpuStr: formatCpuMillis(totalCpuMillis),
    totalMemoryBytes,
    totalMemoryStr: formatBytes(totalMemoryBytes),
    totalStorageBytes,
    totalStorageStr: formatBytes(totalStorageBytes),
    requestedCpuMillis,
    requestedCpuStr: formatCpuMillis(requestedCpuMillis),
    requestedMemoryBytes,
    requestedMemoryStr: formatBytes(requestedMemoryBytes),
    requestedStorageBytes,
    requestedStorageStr: formatBytes(requestedStorageBytes),
    limitsCpuMillis,
    limitsCpuStr: formatCpuMillis(limitsCpuMillis),
    limitsMemoryBytes,
    limitsMemoryStr: formatBytes(limitsMemoryBytes),
    usedCpuMillis,
    usedCpuStr: formatCpuMillis(usedCpuMillis),
    usedMemoryBytes,
    usedMemoryStr: formatBytes(usedMemoryBytes),
    usedStorageBytes,
    usedStorageStr: formatBytes(usedStorageBytes),
    availableCpuMillis,
    availableCpuStr: formatCpuMillis(availableCpuMillis),
    availableMemoryBytes,
    availableMemoryStr: formatBytes(availableMemoryBytes),
    availableStorageBytes,
    availableStorageStr: formatBytes(availableStorageBytes),
    cpuUtilizationPct,
    memoryUtilizationPct,
    storageUtilizationPct,
    isCpuOverallocated: requestedCpuMillis > allocatableCpuMillis,
    isMemoryOverallocated: requestedMemoryBytes > allocatableMemoryBytes,
    isStorageOverallocated: requestedStorageBytes > allocatableStorageBytes,
    totalGpus: hw.totalGpus,
    allocatableGpus: hw.allocatableGpus,
    gpuModel: hw.model,
    gpuVendor: hw.vendor,
    hardwareString: hw.hardwareString,
    vclusters,
  };
}

export async function triggerEtcdBackup(clusterName: string, namespace?: string): Promise<{ success: boolean; jobName: string }> {
  const all = await listVirtualClusters();
  const cluster = all.find((c) => c.name === clusterName);
  const targetNs = namespace || (cluster ? cluster.namespace : (clusterName === 'team-alpha-dev' ? 'default' : clusterName));
  const jobName = `${clusterName}-etcd-backup-manual-${Date.now()}`;
  const retentionCount = cluster?.spec?.disasterRecovery?.retentionCount || 7;

  const jobManifest = {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: targetNs,
      labels: {
        'app.kubernetes.io/name': 'vcluster-etcd-backup',
        'app.kubernetes.io/instance': clusterName,
        'app.kubernetes.io/managed-by': 'vc-operator',
        'vops.gitops.io/cluster': clusterName,
        'vops.gitops.io/backup-type': 'manual',
      },
    },
    spec: {
      backoffLimit: 2,
      ttlSecondsAfterFinished: 86400,
      template: {
        metadata: {
          labels: {
            'app.kubernetes.io/name': 'vcluster-etcd-backup',
            'app.kubernetes.io/instance': clusterName,
            'app.kubernetes.io/managed-by': 'vc-operator',
            'vops.gitops.io/cluster': clusterName,
          },
        },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'etcd-backup',
              image: 'vops/etcd-dr-runner:v1.3.0',
              imagePullPolicy: 'IfNotPresent',
              command: ['/scripts/backup.sh'],
              env: [
                { name: 'CLUSTER_NAME', value: clusterName },
                { name: 'ETCD_ENDPOINT', value: `https://${clusterName}-etcd:2379` },
                { name: 'CACERT', value: '/run/config/pki/etcd-ca.crt' },
                { name: 'CERT', value: '/run/config/pki/etcd-server.crt' },
                { name: 'KEY', value: '/run/config/pki/etcd-server.key' },
                { name: 'RETENTION_COUNT', value: String(retentionCount) },
              ],
              volumeMounts: [
                { name: 'backups', mountPath: '/backup' },
                { name: 'shared-backups', mountPath: '/shared-backups' },
                { name: 'certs', mountPath: '/run/config/pki', readOnly: true },
              ],
            },
          ],
          volumes: [
            {
              name: 'backups',
              persistentVolumeClaim: { claimName: `${clusterName}-etcd-backups` },
            },
            {
              name: 'shared-backups',
              hostPath: { path: '/tmp/vcop-dr-backups', type: 'DirectoryOrCreate' },
            },
            {
              name: 'certs',
              secret: { secretName: `${clusterName}-certs` },
            },
          ],
        },
      },
    },
  };

  const res = await k8sRequest<any>(
    `/apis/batch/v1/namespaces/${targetNs}/jobs`,
    'POST',
    jobManifest
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    // Reconcile trigger
    await k8sRequest<any>(
      `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`,
      'PATCH',
      {
        metadata: {
          annotations: {
            'vops.gitops.io/reconcile-trigger': Date.now().toString(),
          },
        },
      },
      'application/merge-patch+json'
    ).catch(() => {});

    return { success: true, jobName };
  }

  throw new Error((res.data as any)?.message || `Failed to trigger backup job: HTTP ${res.statusCode}`);
}

export async function updateDisasterRecovery(
  clusterName: string,
  drSpec: DisasterRecoverySpec,
  namespace?: string
): Promise<VirtualCluster | null> {
  const all = await listVirtualClusters();
  const currentCluster = all.find((c) => c.name === clusterName);
  const targetNs = namespace || (currentCluster ? currentCluster.namespace : (clusterName === 'team-alpha-dev' ? 'default' : clusterName));

  const patch = {
    metadata: {
      annotations: {
        'vops.gitops.io/reconcile-trigger': Date.now().toString(),
      },
    },
    spec: {
      disasterRecovery: drSpec,
    },
  };

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to update disaster recovery spec: HTTP ${res.statusCode}`);
}

export async function restoreEtcdSnapshot(
  clusterName: string,
  snapshotName: string,
  namespace?: string
): Promise<VirtualCluster | null> {
  const all = await listVirtualClusters();
  const currentCluster = all.find((c) => c.name === clusterName);
  const targetNs = namespace || (currentCluster ? currentCluster.namespace : (clusterName === 'team-alpha-dev' ? 'default' : clusterName));

  const patch = {
    metadata: {
      annotations: {
        'vops.gitops.io/reconcile-trigger': Date.now().toString(),
        'vops.gitops.io/restore-snapshot': snapshotName,
        'vops.gitops.io/restored-at': new Date().toISOString(),
      },
    },
    spec: {
      disasterRecovery: {
        ...(currentCluster?.spec?.disasterRecovery || { enabled: true, schedule: 'daily' }),
        restoreSnapshotName: snapshotName,
      },
    },
  };

  const res = await k8sRequest<any>(
    `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${clusterName}`,
    'PATCH',
    patch,
    'application/merge-patch+json'
  );

  if (res.statusCode >= 200 && res.statusCode < 300) {
    // Also restart StatefulSet pods to initiate restore immediately
    await k8sRequest<any>(
      `/apis/apps/v1/namespaces/${targetNs}/statefulsets/${clusterName}-etcd`,
      'PATCH',
      {
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                'vops.gitops.io/restore-snapshot': snapshotName,
              },
            },
          },
        },
      },
      'application/merge-patch+json'
    ).catch(() => {});

    return mapK8sResourceToVirtualCluster(res.data);
  }

  throw new Error((res.data as any)?.message || `Failed to trigger snapshot restore: HTTP ${res.statusCode}`);
}

export async function listFleetBackups(): Promise<BackupItem[]> {
  const all = await listVirtualClusters();
  const backupsMap = new Map<string, BackupItem>();

  for (const c of all) {
    const clusterBackups = c.status?.disasterRecovery?.recentBackups || [];
    for (const b of clusterBackups) {
      const key = `${b.clusterOrigin || c.name}-${b.name || b.filename}`;
      if (!backupsMap.has(key)) {
        backupsMap.set(key, {
          ...b,
          clusterOrigin: b.clusterOrigin || c.name,
          etcdVersion: b.etcdVersion || c.spec?.etcdVersion || '3.6.8-0',
        });
      }
    }
  }

  return Array.from(backupsMap.values()).sort((a, b) => {
    const tA = new Date(a.timestamp).getTime() || 0;
    const tB = new Date(b.timestamp).getTime() || 0;
    return tB - tA;
  });
}

export interface PodItem {
  name: string;
  namespace: string;
  phase: string;
  ready: boolean;
  readyContainers: number;
  totalContainers: number;
  restarts: number;
  nodeName?: string;
  ip?: string;
  age: string;
  creationTimestamp: string;
}

export interface ClusterPodsSummary {
  total: number;
  running: number;
  pending: number;
  failed: number;
  completed: number;
  byNamespace: Record<string, { total: number; running: number; failed: number }>;
  items: PodItem[];
}

export async function listClusterPods(namespace?: string): Promise<ClusterPodsSummary> {
  const reqUrl = namespace ? `/api/v1/namespaces/${namespace}/pods` : '/api/v1/pods';
  const res = await k8sRequest<{ items: any[] }>(reqUrl);
  const rawItems = res.data?.items || [];

  const summary: ClusterPodsSummary = {
    total: rawItems.length,
    running: 0,
    pending: 0,
    failed: 0,
    completed: 0,
    byNamespace: {},
    items: [],
  };

  for (const p of rawItems) {
    const ns = p.metadata?.namespace || 'default';
    const phase = p.status?.phase || 'Unknown';
    const containerStatuses = p.status?.containerStatuses || [];
    const readyContainers = containerStatuses.filter((c: any) => c.ready).length;
    const totalContainers = containerStatuses.length || (p.spec?.containers?.length || 1);
    const restarts = containerStatuses.reduce((acc: number, c: any) => acc + (c.restartCount || 0), 0);
    const ready = readyContainers === totalContainers && totalContainers > 0 && phase === 'Running';

    if (phase === 'Running') summary.running++;
    else if (phase === 'Pending') summary.pending++;
    else if (phase === 'Failed') summary.failed++;
    else if (phase === 'Succeeded') summary.completed++;

    if (!summary.byNamespace[ns]) {
      summary.byNamespace[ns] = { total: 0, running: 0, failed: 0 };
    }
    summary.byNamespace[ns].total++;
    if (phase === 'Running') summary.byNamespace[ns].running++;
    if (phase === 'Failed') summary.byNamespace[ns].failed++;

    const createdAt = p.metadata?.creationTimestamp ? new Date(p.metadata.creationTimestamp) : new Date();
    const diffSec = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000));
    let age = `${diffSec}s`;
    if (diffSec >= 86400) age = `${Math.floor(diffSec / 86400)}d`;
    else if (diffSec >= 3600) age = `${Math.floor(diffSec / 3600)}h`;
    else if (diffSec >= 60) age = `${Math.floor(diffSec / 60)}m`;

    summary.items.push({
      name: p.metadata?.name || 'unknown',
      namespace: ns,
      phase,
      ready,
      readyContainers,
      totalContainers,
      restarts,
      nodeName: p.spec?.nodeName,
      ip: p.status?.podIP,
      age,
      creationTimestamp: p.metadata?.creationTimestamp || '',
    });
  }

  return summary;
}

export async function listClusterNamespaces(): Promise<string[]> {
  try {
    const res = await k8sRequest<{ items: any[] }>('/api/v1/namespaces');
    return (res.data?.items || []).map((ns: any) => ns.metadata?.name || '').filter(Boolean);
  } catch {
    return [];
  }
}

export interface WorkloadRestartResult {
  success: boolean;
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Pod';
  name: string;
  namespace: string;
  message: string;
  restartedAt: string;
  cliCommand: string;
  rolloutCommand?: string;
  replicas?: {
    desired: number;
    ready: number;
    updated: number;
  };
}

export interface WorkloadScaleResult {
  success: boolean;
  kind: 'Deployment' | 'StatefulSet';
  name: string;
  namespace: string;
  message: string;
  previousReplicas: number;
  newReplicas: number;
  cliCommand: string;
}

export interface WorkloadDeleteResult {
  success: boolean;
  kind: string;
  name: string;
  namespace: string;
  message: string;
  cliCommand: string;
}

export interface DeploymentSummary {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  updatedReplicas: number;
  age: string;
  images: string[];
}

export async function listAllDeployments(namespace?: string): Promise<DeploymentSummary[]> {
  try {
    const reqUrl = namespace ? `/apis/apps/v1/namespaces/${namespace}/deployments` : '/apis/apps/v1/deployments';
    const res = await k8sRequest<{ items: any[] }>(reqUrl);
    const items = res.data?.items || [];
    return items.map((d: any) => {
      const createdAt = d.metadata?.creationTimestamp ? new Date(d.metadata.creationTimestamp) : new Date();
      const diffSec = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1000));
      let age = `${diffSec}s`;
      if (diffSec >= 86400) age = `${Math.floor(diffSec / 86400)}d`;
      else if (diffSec >= 3600) age = `${Math.floor(diffSec / 3600)}h`;
      else if (diffSec >= 60) age = `${Math.floor(diffSec / 60)}m`;

      const containers = d.spec?.template?.spec?.containers || [];
      const images = containers.map((c: any) => c.image).filter(Boolean);

      return {
        name: d.metadata?.name || 'unknown',
        namespace: d.metadata?.namespace || 'default',
        replicas: d.spec?.replicas ?? 1,
        readyReplicas: d.status?.readyReplicas ?? 0,
        updatedReplicas: d.status?.updatedReplicas ?? 0,
        age,
        images,
      };
    });
  } catch (err: any) {
    console.warn('[k8s-client] listAllDeployments error:', err.message);
    return [];
  }
}

export async function findWorkload(
  name: string,
  namespace?: string
): Promise<{ kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Pod'; name: string; namespace: string; raw: any } | null> {
  const targetName = name.trim().toLowerCase();

  // 1. Try finding in deployments
  try {
    const depUrl = namespace ? `/apis/apps/v1/namespaces/${namespace}/deployments` : '/apis/apps/v1/deployments';
    const depRes = await k8sRequest<{ items: any[] }>(depUrl);
    const deps = depRes.data?.items || [];
    const matchedDep = deps.find((d: any) => {
      const dName = (d.metadata?.name || '').toLowerCase();
      return dName === targetName || dName.includes(targetName) || targetName.includes(dName);
    });
    if (matchedDep) {
      return {
        kind: 'Deployment',
        name: matchedDep.metadata?.name,
        namespace: matchedDep.metadata?.namespace || 'default',
        raw: matchedDep,
      };
    }
  } catch {}

  // 2. Try finding in statefulsets
  try {
    const stsUrl = namespace ? `/apis/apps/v1/namespaces/${namespace}/statefulsets` : '/apis/apps/v1/statefulsets';
    const stsRes = await k8sRequest<{ items: any[] }>(stsUrl);
    const stss = stsRes.data?.items || [];
    const matchedSts = stss.find((s: any) => {
      const sName = (s.metadata?.name || '').toLowerCase();
      return sName === targetName || sName.includes(targetName) || targetName.includes(sName);
    });
    if (matchedSts) {
      return {
        kind: 'StatefulSet',
        name: matchedSts.metadata?.name,
        namespace: matchedSts.metadata?.namespace || 'default',
        raw: matchedSts,
      };
    }
  } catch {}

  // 3. Try finding in daemonsets
  try {
    const dsUrl = namespace ? `/apis/apps/v1/namespaces/${namespace}/daemonsets` : '/apis/apps/v1/daemonsets';
    const dsRes = await k8sRequest<{ items: any[] }>(dsUrl);
    const dss = dsRes.data?.items || [];
    const matchedDs = dss.find((ds: any) => {
      const dsName = (ds.metadata?.name || '').toLowerCase();
      return dsName === targetName || dsName.includes(targetName) || targetName.includes(dsName);
    });
    if (matchedDs) {
      return {
        kind: 'DaemonSet',
        name: matchedDs.metadata?.name,
        namespace: matchedDs.metadata?.namespace || 'default',
        raw: matchedDs,
      };
    }
  } catch {}

  // 4. Try finding in pods
  try {
    const podSummary = await listClusterPods(namespace);
    const matchedPod = podSummary.items.find((p) => {
      const pName = p.name.toLowerCase();
      return pName === targetName || pName.includes(targetName);
    });
    if (matchedPod) {
      return {
        kind: 'Pod',
        name: matchedPod.name,
        namespace: matchedPod.namespace,
        raw: matchedPod,
      };
    }
  } catch {}

  return null;
}

export async function restartWorkload(
  name: string,
  namespace?: string
): Promise<WorkloadRestartResult> {
  const found = await findWorkload(name, namespace);
  if (!found) {
    throw new Error(`Workload '${name}' not found${namespace ? ` in namespace '${namespace}'` : ' across the cluster'}`);
  }

  const restartedAt = new Date().toISOString();
  const targetNs = found.namespace;
  const targetName = found.name;

  if (found.kind === 'Deployment') {
    const patchBody = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'kubectl.kubernetes.io/restartedAt': restartedAt,
            },
          },
        },
      },
    };

    const patchUrl = `/apis/apps/v1/namespaces/${targetNs}/deployments/${targetName}`;
    const patchRes = await k8sRequest<any>(patchUrl, 'PATCH', patchBody, 'application/strategic-merge-patch+json');

    if (patchRes.statusCode >= 400) {
      throw new Error(`Failed to restart deployment ${targetName}: HTTP ${patchRes.statusCode}`);
    }

    const updated = patchRes.data;
    return {
      success: true,
      kind: 'Deployment',
      name: targetName,
      namespace: targetNs,
      message: `Rollout restart successfully initiated for deployment '${targetName}' in namespace '${targetNs}'.`,
      restartedAt,
      cliCommand: `kubectl rollout restart deployment/${targetName} -n ${targetNs}`,
      rolloutCommand: `kubectl rollout status deployment/${targetName} -n ${targetNs}`,
      replicas: {
        desired: updated?.spec?.replicas ?? 1,
        ready: updated?.status?.readyReplicas ?? 0,
        updated: updated?.status?.updatedReplicas ?? 0,
      },
    };
  }

  if (found.kind === 'StatefulSet') {
    const patchBody = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'kubectl.kubernetes.io/restartedAt': restartedAt,
            },
          },
        },
      },
    };

    const patchUrl = `/apis/apps/v1/namespaces/${targetNs}/statefulsets/${targetName}`;
    const patchRes = await k8sRequest<any>(patchUrl, 'PATCH', patchBody, 'application/strategic-merge-patch+json');

    if (patchRes.statusCode >= 400) {
      throw new Error(`Failed to restart statefulset ${targetName}: HTTP ${patchRes.statusCode}`);
    }

    return {
      success: true,
      kind: 'StatefulSet',
      name: targetName,
      namespace: targetNs,
      message: `Rollout restart successfully initiated for statefulset '${targetName}' in namespace '${targetNs}'.`,
      restartedAt,
      cliCommand: `kubectl rollout restart statefulset/${targetName} -n ${targetNs}`,
      rolloutCommand: `kubectl rollout status statefulset/${targetName} -n ${targetNs}`,
    };
  }

  if (found.kind === 'DaemonSet') {
    const patchBody = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'kubectl.kubernetes.io/restartedAt': restartedAt,
            },
          },
        },
      },
    };

    const patchUrl = `/apis/apps/v1/namespaces/${targetNs}/daemonsets/${targetName}`;
    const patchRes = await k8sRequest<any>(patchUrl, 'PATCH', patchBody, 'application/strategic-merge-patch+json');

    if (patchRes.statusCode >= 400) {
      throw new Error(`Failed to restart daemonset ${targetName}: HTTP ${patchRes.statusCode}`);
    }

    return {
      success: true,
      kind: 'DaemonSet',
      name: targetName,
      namespace: targetNs,
      message: `Rollout restart successfully initiated for daemonset '${targetName}' in namespace '${targetNs}'.`,
      restartedAt,
      cliCommand: `kubectl rollout restart daemonset/${targetName} -n ${targetNs}`,
      rolloutCommand: `kubectl rollout status daemonset/${targetName} -n ${targetNs}`,
    };
  }

  if (found.kind === 'Pod') {
    const deleteUrl = `/api/v1/namespaces/${targetNs}/pods/${targetName}`;
    const delRes = await k8sRequest<any>(deleteUrl, 'DELETE');
    if (delRes.statusCode >= 400) {
      throw new Error(`Failed to delete pod ${targetName}: HTTP ${delRes.statusCode}`);
    }

    return {
      success: true,
      kind: 'Pod',
      name: targetName,
      namespace: targetNs,
      message: `Pod '${targetName}' deleted in namespace '${targetNs}' to initiate restart.`,
      restartedAt,
      cliCommand: `kubectl delete pod ${targetName} -n ${targetNs}`,
    };
  }

  throw new Error(`Unsupported workload kind: ${(found as any).kind}`);
}

export async function scaleWorkload(
  name: string,
  replicas: number,
  namespace?: string
): Promise<WorkloadScaleResult> {
  const found = await findWorkload(name, namespace);
  if (!found || (found.kind !== 'Deployment' && found.kind !== 'StatefulSet')) {
    throw new Error(`Scalable workload '${name}' (Deployment or StatefulSet) not found`);
  }

  const targetNs = found.namespace;
  const targetName = found.name;
  const previousReplicas = found.raw?.spec?.replicas ?? 1;

  const patchBody = {
    spec: {
      replicas,
    },
  };

  const endpoint = found.kind === 'Deployment' ? 'deployments' : 'statefulsets';
  const patchUrl = `/apis/apps/v1/namespaces/${targetNs}/${endpoint}/${targetName}`;
  const patchRes = await k8sRequest<any>(patchUrl, 'PATCH', patchBody, 'application/strategic-merge-patch+json');

  if (patchRes.statusCode >= 400) {
    throw new Error(`Failed to scale ${found.kind.toLowerCase()} ${targetName}: HTTP ${patchRes.statusCode}`);
  }

  return {
    success: true,
    kind: found.kind,
    name: targetName,
    namespace: targetNs,
    message: `Successfully scaled ${found.kind.toLowerCase()} '${targetName}' from ${previousReplicas} to ${replicas} replica(s).`,
    previousReplicas,
    newReplicas: replicas,
    cliCommand: `kubectl scale ${found.kind.toLowerCase()} ${targetName} --replicas=${replicas} -n ${targetNs}`,
  };
}

export async function deleteWorkload(
  name: string,
  namespace?: string,
  kind?: string
): Promise<WorkloadDeleteResult> {
  let targetKind = kind;
  let targetNs = namespace;
  let targetName = name;

  // If kind was not explicitly provided or was generic, discover from live workloads
  if (!targetKind || targetKind.toLowerCase() === 'workload' || targetKind.toLowerCase() === 'resource') {
    const found = await findWorkload(name, namespace);
    if (found) {
      targetKind = found.kind;
      targetNs = found.namespace;
      targetName = found.name;
    }
  }

  // Sensible default kind
  if (!targetKind) {
    targetKind = 'Pod';
  }
  if (!targetNs && targetKind.toLowerCase() !== 'namespace') {
    targetNs = 'default';
  }

  let deleteUrl = '';
  let cliCommand = '';
  const lowerKind = targetKind.toLowerCase();

  switch (lowerKind) {
    case 'pod':
    case 'pods':
      targetKind = 'Pod';
      deleteUrl = `/api/v1/namespaces/${targetNs}/pods/${targetName}`;
      cliCommand = `kubectl delete pod ${targetName} -n ${targetNs}`;
      break;
    case 'deployment':
    case 'deploy':
    case 'deployments':
      targetKind = 'Deployment';
      deleteUrl = `/apis/apps/v1/namespaces/${targetNs}/deployments/${targetName}`;
      cliCommand = `kubectl delete deployment ${targetName} -n ${targetNs}`;
      break;
    case 'statefulset':
    case 'sts':
    case 'statefulsets':
      targetKind = 'StatefulSet';
      deleteUrl = `/apis/apps/v1/namespaces/${targetNs}/statefulsets/${targetName}`;
      cliCommand = `kubectl delete statefulset ${targetName} -n ${targetNs}`;
      break;
    case 'daemonset':
    case 'ds':
    case 'daemonsets':
      targetKind = 'DaemonSet';
      deleteUrl = `/apis/apps/v1/namespaces/${targetNs}/daemonsets/${targetName}`;
      cliCommand = `kubectl delete daemonset ${targetName} -n ${targetNs}`;
      break;
    case 'service':
    case 'svc':
    case 'services':
      targetKind = 'Service';
      deleteUrl = `/api/v1/namespaces/${targetNs}/services/${targetName}`;
      cliCommand = `kubectl delete svc ${targetName} -n ${targetNs}`;
      break;
    case 'configmap':
    case 'cm':
    case 'configmaps':
      targetKind = 'ConfigMap';
      deleteUrl = `/api/v1/namespaces/${targetNs}/configmaps/${targetName}`;
      cliCommand = `kubectl delete configmap ${targetName} -n ${targetNs}`;
      break;
    case 'secret':
    case 'secrets':
      targetKind = 'Secret';
      deleteUrl = `/api/v1/namespaces/${targetNs}/secrets/${targetName}`;
      cliCommand = `kubectl delete secret ${targetName} -n ${targetNs}`;
      break;
    case 'namespace':
    case 'ns':
    case 'namespaces':
      targetKind = 'Namespace';
      targetNs = targetName;
      deleteUrl = `/api/v1/namespaces/${targetName}`;
      cliCommand = `kubectl delete namespace ${targetName}`;
      break;
    case 'virtualcluster':
    case 'vcluster':
    case 'virtualclusters':
    case 'vclusters':
      targetKind = 'VirtualCluster';
      deleteUrl = `/apis/vops.gitops.io/v1alpha1/namespaces/${targetNs}/virtualclusters/${targetName}`;
      cliCommand = `kubectl delete virtualcluster ${targetName} -n ${targetNs}`;
      break;
    default:
      targetKind = 'Pod';
      deleteUrl = `/api/v1/namespaces/${targetNs}/pods/${targetName}`;
      cliCommand = `kubectl delete pod ${targetName} -n ${targetNs}`;
      break;
  }

  const res = await k8sRequest<any>(deleteUrl, 'DELETE');
  if (res.statusCode >= 400 && res.statusCode !== 404) {
    throw new Error(`Failed to delete ${targetKind} '${targetName}': HTTP ${res.statusCode}${res.data?.message ? ` (${res.data.message})` : ''}`);
  }

  return {
    success: true,
    kind: targetKind,
    name: targetName,
    namespace: targetNs || 'default',
    message: `Successfully deleted ${targetKind} '${targetName}'${targetNs ? ` in namespace '${targetNs}'` : ''}.`,
    cliCommand,
  };
}

/**
 * Retrieves all StorageClasses from the host Kubernetes cluster.
 * Identifies the cluster default storage class and drive provisioner.
 */
export async function listStorageClasses(): Promise<StorageClassInfo[]> {
  try {
    const res = await k8sRequest<{ items?: any[] }>('/apis/storage.k8s.io/v1/storageclasses');
    const items = res.data?.items || [];
    return items.map((sc: any) => {
      const annotations = sc.metadata?.annotations || {};
      const isDefault =
        annotations['storageclass.kubernetes.io/is-default-class'] === 'true' ||
        annotations['storageclass.beta.kubernetes.io/is-default-class'] === 'true';
      return {
        name: sc.metadata?.name || '',
        provisioner: sc.provisioner || '',
        reclaimPolicy: sc.reclaimPolicy,
        volumeBindingMode: sc.volumeBindingMode,
        isDefault,
        allowVolumeExpansion: sc.allowVolumeExpansion,
      };
    });
  } catch (error) {
    console.error('Failed to list storage classes from Kubernetes API:', error);
    return [];
  }
}

export interface SecurityAuditFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: 'Pod Security' | 'Network Isolation' | 'RBAC & Identity' | 'Data Protection & DR' | 'Service Mesh';
  title: string;
  description: string;
  resource?: string;
  remediation?: string;
}

export interface SecurityAuditReport {
  targetScope: string;
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  summary: {
    totalEvaluated: number;
    passed: number;
    failed: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
  metrics: {
    totalPods: number;
    restrictedPodsPct: number;
    nonRootPodsPct: number;
    readOnlyRootFsPct: number;
    networkPoliciesConfigured: number;
    rbacClusterAdminBindings: number;
    activeEtcdBackups: number;
  };
  findings: SecurityAuditFinding[];
}

/**
 * Retrieves the standard output/error stream logs for a pod.
 */
export async function getPodLogs(
  podName: string,
  namespace?: string,
  tailLines = 60,
  container?: string
): Promise<{ pod: string; namespace: string; logs: string; lineCount: number; cliCommand: string }> {
  let targetNs = namespace;
  let targetPod = podName.trim();

  if (!targetNs) {
    const summary = await listClusterPods().catch(() => ({ total: 0, items: [] } as any));
    const found = summary.items.find(
      (p: any) => p.name.toLowerCase() === targetPod.toLowerCase() || p.name.toLowerCase().includes(targetPod.toLowerCase())
    );
    if (found) {
      targetNs = found.namespace;
      targetPod = found.name;
    } else {
      targetNs = 'default';
    }
  }

  const query = new URLSearchParams({ tailLines: String(tailLines) });
  if (container) query.set('container', container);

  const url = `/api/v1/namespaces/${targetNs}/pods/${targetPod}/log?${query.toString()}`;
  const res = await k8sRequest<string>(url, 'GET');

  if (res.statusCode >= 400) {
    const errMsg = typeof res.data === 'object' ? (res.data as any)?.message : String(res.data);
    throw new Error(`Failed to retrieve logs for pod '${targetPod}': HTTP ${res.statusCode} (${errMsg || 'Error'})`);
  }

  const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
  const lines = raw ? raw.trim().split('\n') : [];
  const cliCommand = `kubectl logs ${targetPod} -n ${targetNs} --tail=${tailLines}${container ? ` -c ${container}` : ''}`;

  return {
    pod: targetPod,
    namespace: targetNs,
    logs: raw.trim() || '(Container output stream is empty - 0 bytes written to stdout/stderr)',
    lineCount: lines.length,
    cliCommand,
  };
}

/**
 * Cordon or uncordon a Kubernetes node to control pod scheduling.
 */
export async function cordonNode(
  nodeName: string,
  unschedulable: boolean
): Promise<{ node: string; unschedulable: boolean; message: string; cliCommand: string }> {
  const patchBody = {
    spec: {
      unschedulable,
    },
  };

  const url = `/api/v1/nodes/${nodeName}`;
  const res = await k8sRequest<any>(url, 'PATCH', patchBody, 'application/strategic-merge-patch+json');

  if (res.statusCode >= 400) {
    throw new Error(`Failed to update node '${nodeName}': HTTP ${res.statusCode} (${res.data?.message || 'Failed'})`);
  }

  const actionStr = unschedulable ? 'cordoned (scheduling disabled)' : 'uncordoned (scheduling active)';
  return {
    node: nodeName,
    unschedulable,
    message: `Node '${nodeName}' has been successfully ${actionStr}.`,
    cliCommand: `kubectl ${unschedulable ? 'cordon' : 'uncordon'} ${nodeName}`,
  };
}

/**
 * Rolls back a Deployment, StatefulSet, or DaemonSet to its previous revision.
 */
export async function rollbackWorkload(
  name: string,
  namespace?: string
): Promise<{ success: boolean; kind: string; name: string; namespace: string; message: string; cliCommand: string }> {
  const found = await findWorkload(name, namespace);
  if (!found) {
    throw new Error(`Workload '${name}' not found${namespace ? ` in namespace '${namespace}'` : ' across the cluster'}`);
  }

  const cliCommand = `kubectl rollout undo ${found.kind.toLowerCase()}/${found.name} -n ${found.namespace}`;
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  try {
    await execAsync(cliCommand);
    return {
      success: true,
      kind: found.kind,
      name: found.name,
      namespace: found.namespace,
      message: `Rollout undo successfully initiated for ${found.kind} '${found.name}' in namespace '${found.namespace}'. Restoring previous healthy revision.`,
      cliCommand,
    };
  } catch (err: any) {
    throw new Error(`Rollout undo failed: ${err.message}`);
  }
}

/**
 * Applies a raw YAML or JSON Kubernetes manifest directly to the cluster via kubectl.
 */
export async function applyKubernetesManifest(
  manifestYaml: string
): Promise<{ success: boolean; output: string; cliCommand: string }> {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve, reject) => {
    const proc = spawn('kubectl', ['apply', '-f', '-']);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim() || 'Resources successfully applied to cluster.',
          cliCommand: 'kubectl apply -f -',
        });
      } else {
        reject(new Error(stderr.trim() || `kubectl apply exited with code ${code}`));
      }
    });

    proc.stdin.write(manifestYaml);
    proc.stdin.end();
  });
}

/**
 * Performs a comprehensive DevSecOps (DSO) security audit on the cluster or a target namespace.
 * Evaluates Pod Security Standards (PSS), Zero-Trust Network Policies, RBAC least privilege,
 * and Disaster Recovery readiness.
 */
export async function performSecurityAudit(namespace?: string): Promise<SecurityAuditReport> {
  const targetScope = namespace ? `Namespace '${namespace}'` : 'Cluster-Wide (All Namespaces)';
  const findings: SecurityAuditFinding[] = [];

  let totalPods = 0;
  let nonRootCount = 0;
  let readOnlyRootFsCount = 0;
  let restrictedPodCount = 0;
  let networkPoliciesConfigured = 0;
  let rbacClusterAdminBindings = 0;
  let activeEtcdBackups = 0;

  // 1. Audit Pod Security Standards (PSS) & Container Hardening
  try {
    const podsUrl = namespace ? `/api/v1/namespaces/${namespace}/pods` : '/api/v1/pods';
    const podsRes = await k8sRequest<{ items: any[] }>(podsUrl);
    const pods = podsRes.data?.items || [];
    totalPods = pods.length;

    for (const pod of pods) {
      const pName = pod.metadata?.name || 'unknown';
      const pNs = pod.metadata?.namespace || 'default';
      const spec = pod.spec || {};
      const podSec = spec.securityContext || {};
      const containers = spec.containers || [];

      // Critical Checks: Privileged containers or host namespaces
      if (spec.hostNetwork) {
        findings.push({
          severity: 'CRITICAL',
          category: 'Pod Security',
          title: `Pod '${pName}' shares host network namespace (hostNetwork: true)`,
          description: `Pod ${pNs}/${pName} has hostNetwork enabled, allowing it to bypass network isolation and sniff host interfaces.`,
          resource: `pod/${pName} in ${pNs}`,
          remediation: `Remove 'hostNetwork: true' from pod spec.`,
        });
      }
      if (spec.hostPID || spec.hostIPC) {
        findings.push({
          severity: 'CRITICAL',
          category: 'Pod Security',
          title: `Pod '${pName}' shares host PID/IPC namespace`,
          description: `Pod ${pNs}/${pName} can inspect host processes and memory segments.`,
          resource: `pod/${pName} in ${pNs}`,
          remediation: `Remove 'hostPID' and 'hostIPC' flags from workload specification.`,
        });
      }

      let podIsFullyHardened = true;
      for (const c of containers) {
        const cSec = c.securityContext || {};
        const isPrivileged = cSec.privileged === true;
        const runAsNonRoot = cSec.runAsNonRoot === true || podSec.runAsNonRoot === true || (cSec.runAsUser && cSec.runAsUser > 0);
        const readOnlyRoot = cSec.readOnlyRootFilesystem === true;
        const allowPrivilegeEscalation = cSec.allowPrivilegeEscalation === false;
        const dropsAllCaps = Array.isArray(cSec.capabilities?.drop) && cSec.capabilities.drop.includes('ALL');

        if (isPrivileged) {
          findings.push({
            severity: 'CRITICAL',
            category: 'Pod Security',
            title: `Container '${c.name}' runs with full root privilege (privileged: true)`,
            description: `Privileged containers can easily break out of cgroup boundaries and compromise the host node kernel.`,
            resource: `pod/${pName} (container: ${c.name}) in ${pNs}`,
            remediation: `Set 'securityContext.privileged: false' and grant only required Linux capabilities.`,
          });
          podIsFullyHardened = false;
        }

        if (runAsNonRoot) {
          nonRootCount++;
        } else if (!pNs.startsWith('kube-')) {
          findings.push({
            severity: 'HIGH',
            category: 'Pod Security',
            title: `Container '${c.name}' missing 'runAsNonRoot: true'`,
            description: `Container runs without explicit non-root enforcement. May execute as UID 0 (root).`,
            resource: `pod/${pName} (container: ${c.name}) in ${pNs}`,
            remediation: `Configure 'securityContext.runAsNonRoot: true' and 'runAsUser: 10001'.`,
          });
          podIsFullyHardened = false;
        }

        if (readOnlyRoot) {
          readOnlyRootFsCount++;
        } else if (!pNs.startsWith('kube-')) {
          findings.push({
            severity: 'MEDIUM',
            category: 'Pod Security',
            title: `Container '${c.name}' root filesystem is writable`,
            description: `A writable root filesystem enables malicious persistence and binary tampering if an application is exploited.`,
            resource: `pod/${pName} (container: ${c.name}) in ${pNs}`,
            remediation: `Set 'securityContext.readOnlyRootFilesystem: true' and mount emptyDir volumes for writable temp directories.`,
          });
          podIsFullyHardened = false;
        }

        if (!allowPrivilegeEscalation && !pNs.startsWith('kube-')) {
          findings.push({
            severity: 'LOW',
            category: 'Pod Security',
            title: `Container '${c.name}' allows privilege escalation`,
            description: `Child processes can gain more privileges than their parent (setuid binaries).`,
            resource: `pod/${pName} (container: ${c.name}) in ${pNs}`,
            remediation: `Set 'securityContext.allowPrivilegeEscalation: false'.`,
          });
          podIsFullyHardened = false;
        }

        if (!dropsAllCaps && !pNs.startsWith('kube-')) {
          podIsFullyHardened = false;
        }
      }

      if (podIsFullyHardened) {
        restrictedPodCount++;
      }
    }
  } catch (err: any) {
    console.warn('[auditSecurityPosture] Pods check error:', err.message);
  }

  // 2. Audit Zero Trust Network Isolation (NetworkPolicies)
  try {
    const netUrl = namespace ? `/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies` : '/apis/networking.k8s.io/v1/networkpolicies';
    const netRes = await k8sRequest<{ items: any[] }>(netUrl);
    const netpols = netRes.data?.items || [];
    networkPoliciesConfigured = netpols.length;

    if (networkPoliciesConfigured === 0) {
      findings.push({
        severity: 'HIGH',
        category: 'Network Isolation',
        title: `No NetworkPolicies enforced in scope (${targetScope})`,
        description: `Zero-Trust Default-Deny is missing. By default, all Kubernetes pods can communicate with all other pods across the cluster without restriction.`,
        remediation: `Apply a default-deny Ingress and Egress NetworkPolicy to enforce least-privilege East-West traffic.`,
      });
    } else {
      findings.push({
        severity: 'INFO',
        category: 'Network Isolation',
        title: `${networkPoliciesConfigured} NetworkPolicy rules configured`,
        description: `Active network segmentation policies detected protecting workloads.`,
      });
    }
  } catch (err: any) {
    console.warn('[auditSecurityPosture] NetworkPolicies check error:', err.message);
  }

  // 3. Audit RBAC Least Privilege (ClusterRoleBindings)
  try {
    const rbacRes = await k8sRequest<{ items: any[] }>('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings');
    const crbs = rbacRes.data?.items || [];

    const adminBindings = crbs.filter(
      (b) => b.roleRef?.name === 'cluster-admin' &&
        b.subjects?.some((s: any) => s.namespace && !['kube-system', 'vcop-system'].includes(s.namespace))
    );
    rbacClusterAdminBindings = adminBindings.length;

    if (adminBindings.length > 0) {
      findings.push({
        severity: 'HIGH',
        category: 'RBAC & Identity',
        title: `${adminBindings.length} third-party subjects granted full 'cluster-admin'`,
        description: `Overly permissive cluster-admin bindings detected outside system namespaces: ${adminBindings.map((b) => b.metadata?.name).join(', ')}.`,
        remediation: `Replace cluster-admin with scoped Roles and RoleBindings granting only explicit verbs (least privilege).`,
      });
    } else {
      findings.push({
        severity: 'INFO',
        category: 'RBAC & Identity',
        title: `RBAC cluster-admin bindings tightly scoped to system namespaces`,
        description: `No unapproved third-party service accounts hold unrestricted root cluster privileges.`,
      });
    }
  } catch (err: any) {
    console.warn('[auditSecurityPosture] RBAC check error:', err.message);
  }

  // 4. Audit Disaster Recovery & etcd Backup Schedules
  try {
    const cronRes = await k8sRequest<{ items: any[] }>('/apis/batch/v1/cronjobs');
    const cronjobs = cronRes.data?.items || [];
    const backupJobs = cronjobs.filter((c) => /backup|etcd|snapshot|dr/i.test(c.metadata?.name || ''));
    activeEtcdBackups = backupJobs.length;

    if (activeEtcdBackups === 0) {
      findings.push({
        severity: 'MEDIUM',
        category: 'Data Protection & DR',
        title: `No automated etcd backup CronJobs detected`,
        description: `Disaster Recovery automation is not scheduled. Unrecoverable control plane loss risk in the event of etcd corruption.`,
        remediation: `Enable automated etcd snapshot CronJobs via the vCOp Operations Center DR dashboard.`,
      });
    } else {
      findings.push({
        severity: 'INFO',
        category: 'Data Protection & DR',
        title: `${activeEtcdBackups} automated backup schedules active`,
        description: `Scheduled etcd snapshots configured for rapid recovery and RTO/RPO compliance.`,
      });
    }
  } catch (err: any) {
    console.warn('[auditSecurityPosture] DR check error:', err.message);
  }

  // Calculate DSO Score (0 - 100)
  const criticals = findings.filter((f) => f.severity === 'CRITICAL').length;
  const highs = findings.filter((f) => f.severity === 'HIGH').length;
  const mediums = findings.filter((f) => f.severity === 'MEDIUM').length;
  const lows = findings.filter((f) => f.severity === 'LOW').length;

  let penalty = criticals * 25 + highs * 15 + mediums * 8 + lows * 3;
  const score = Math.max(10, Math.min(100, 100 - penalty));

  let grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'F';
  if (score >= 95) grade = 'A+';
  else if (score >= 88) grade = 'A';
  else if (score >= 78) grade = 'B';
  else if (score >= 68) grade = 'C';
  else if (score >= 55) grade = 'D';

  const nonRootPct = totalPods > 0 ? Math.round((nonRootCount / totalPods) * 100) : 100;
  const readOnlyPct = totalPods > 0 ? Math.round((readOnlyRootFsCount / totalPods) * 100) : 100;
  const restrictedPct = totalPods > 0 ? Math.round((restrictedPodCount / totalPods) * 100) : 100;

  return {
    targetScope,
    score,
    grade,
    summary: {
      totalEvaluated: totalPods + networkPoliciesConfigured + rbacClusterAdminBindings + activeEtcdBackups,
      passed: findings.filter((f) => f.severity === 'INFO').length,
      failed: criticals + highs + mediums + lows,
      criticalCount: criticals,
      highCount: highs,
      mediumCount: mediums,
      lowCount: lows,
    },
    metrics: {
      totalPods,
      restrictedPodsPct: restrictedPct,
      nonRootPodsPct: nonRootPct,
      readOnlyRootFsPct: readOnlyPct,
      networkPoliciesConfigured,
      rbacClusterAdminBindings,
      activeEtcdBackups,
    },
    findings,
  };
}
