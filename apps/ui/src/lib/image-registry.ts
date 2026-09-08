import { k8sRequest } from './k8s-client';

export const IMAGE_REGISTRY_CONFIGMAP_NAME = 'vcop-image-registry';
export const IMAGE_REGISTRY_NAMESPACE = 'vcop-system';

export interface ImageSwapRule {
  from: string;
  to: string;
}

export interface ImageRegistryConfig {
  targetRegistry?: string;
  swapFrom?: string;
  swapTo?: string;
  flatten: boolean;
  rules?: ImageSwapRule[];
  updatedAt?: string;
}

export interface CanonicalImageItem {
  component: string;
  category: 'controlPlane' | 'backingStore' | 'addons' | 'meshAndIngress' | 'disasterRecovery' | 'platform';
  role: string;
  defaultImage: string;
  registry: string;
  repository: string;
  tag: string;
}

export const CANONICAL_IMAGES: CanonicalImageItem[] = [
  {
    component: 'syncer',
    category: 'controlPlane',
    role: 'vCluster core synchronization and control-loop engine',
    defaultImage: 'ghcr.io/loft-sh/vcluster-oss:0.36.0',
    registry: 'ghcr.io',
    repository: 'loft-sh/vcluster-oss',
    tag: '0.36.0',
  },
  {
    component: 'kubernetes-v1.31',
    category: 'controlPlane',
    role: 'Guest Kubernetes API server and controller binaries (v1.31)',
    defaultImage: 'ghcr.io/loft-sh/kubernetes:v1.31.0',
    registry: 'ghcr.io',
    repository: 'loft-sh/kubernetes',
    tag: 'v1.31.0',
  },
  {
    component: 'kubernetes-v1.32',
    category: 'controlPlane',
    role: 'Guest Kubernetes API server and controller binaries (v1.32)',
    defaultImage: 'ghcr.io/loft-sh/kubernetes:v1.32.0',
    registry: 'ghcr.io',
    repository: 'loft-sh/kubernetes',
    tag: 'v1.32.0',
  },
  {
    component: 'kubernetes-v1.33',
    category: 'controlPlane',
    role: 'Guest Kubernetes API server and controller binaries (v1.33)',
    defaultImage: 'ghcr.io/loft-sh/kubernetes:v1.33.0',
    registry: 'ghcr.io',
    repository: 'loft-sh/kubernetes',
    tag: 'v1.33.0',
  },
  {
    component: 'etcd-v3.6',
    category: 'backingStore',
    role: 'Dedicated high-throughput etcd backing store (v3.6)',
    defaultImage: 'registry.k8s.io/etcd:3.6.8-0',
    registry: 'registry.k8s.io',
    repository: 'etcd',
    tag: '3.6.8-0',
  },
  {
    component: 'etcd-v3.5',
    category: 'backingStore',
    role: 'Long-term support etcd backing store (v3.5)',
    defaultImage: 'registry.k8s.io/etcd:3.5.18-0',
    registry: 'registry.k8s.io',
    repository: 'etcd',
    tag: '3.5.18-0',
  },
  {
    component: 'coredns',
    category: 'addons',
    role: 'In-cluster CoreDNS resolver service',
    defaultImage: 'registry.k8s.io/coredns/coredns:v1.11.3',
    registry: 'registry.k8s.io',
    repository: 'coredns/coredns',
    tag: 'v1.11.3',
  },
  {
    component: 'metrics-server',
    category: 'addons',
    role: 'Resource telemetry and Horizontal Pod Autoscaling (HPA) provider',
    defaultImage: 'registry.k8s.io/metrics-server/metrics-server:v0.7.2',
    registry: 'registry.k8s.io',
    repository: 'metrics-server/metrics-server',
    tag: 'v0.7.2',
  },
  {
    component: 'istio-pilot',
    category: 'meshAndIngress',
    role: 'Istio discovery control plane (istiod)',
    defaultImage: 'docker.io/istio/pilot:1.24.2',
    registry: 'docker.io',
    repository: 'istio/pilot',
    tag: '1.24.2',
  },
  {
    component: 'istio-proxy',
    category: 'meshAndIngress',
    role: 'Istio Envoy ingress gateway proxy',
    defaultImage: 'docker.io/istio/proxyv2:1.24.2',
    registry: 'docker.io',
    repository: 'istio/proxyv2',
    tag: '1.24.2',
  },
  {
    component: 'dr-runner',
    category: 'disasterRecovery',
    role: 'Automated snapshot backup and point-in-time restore runner',
    defaultImage: 'vops/etcd-dr-runner:v1.3.0',
    registry: 'docker.io',
    repository: 'vops/etcd-dr-runner',
    tag: 'v1.3.0',
  },
  {
    component: 'operator',
    category: 'platform',
    role: 'Virtual cluster Kubernetes custom controller',
    defaultImage: 'vops/vc-operator:v1.4.1',
    registry: 'docker.io',
    repository: 'vops/vc-operator',
    tag: 'v1.4.1',
  },
  {
    component: 'operations-center-ui',
    category: 'platform',
    role: 'Operations Center multi-tenant dashboard and UI',
    defaultImage: 'vops/vc-operations-center:v1.4.1',
    registry: 'docker.io',
    repository: 'vops/vc-operations-center',
    tag: 'v1.4.1',
  },
  {
    component: 'ai-inference-engine',
    category: 'platform',
    role: 'vCOp AI copilot, cost analyzer, and triage engine',
    defaultImage: 'vops/vc-ai:v1.4.1',
    registry: 'docker.io',
    repository: 'vops/vc-ai',
    tag: 'v1.4.1',
  },
  {
    component: 'metrics-db',
    category: 'platform',
    role: 'Timescale/PostgreSQL time-series telemetry store',
    defaultImage: 'docker.io/library/postgres:16-alpine',
    registry: 'docker.io',
    repository: 'library/postgres',
    tag: '16-alpine',
  },
];

export const DEFAULT_IMAGE_CONFIG: ImageRegistryConfig = {
  targetRegistry: process.env.GLOBAL_IMAGE_REGISTRY || '',
  swapFrom: process.env.IMAGE_SWAP_FROM || '',
  swapTo: process.env.IMAGE_SWAP_TO || '',
  flatten: process.env.IMAGE_FLATTEN !== 'false',
  rules: [],
  updatedAt: new Date().toISOString(),
};

let configCache: ImageRegistryConfig | null = null;
let lastFetchTime = 0;

/**
 * Retrieves image registry relocation and swap settings from Kubernetes ConfigMap
 */
export async function getImageRegistryConfig(): Promise<ImageRegistryConfig> {
  const now = Date.now();
  if (configCache && now - lastFetchTime < 5000) {
    return configCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${IMAGE_REGISTRY_NAMESPACE}/configmaps/${IMAGE_REGISTRY_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['image-registry.json']) {
      const parsed = JSON.parse(res.data.data['image-registry.json']) as ImageRegistryConfig;
      configCache = {
        ...DEFAULT_IMAGE_CONFIG,
        ...parsed,
      };
      lastFetchTime = now;
      return configCache;
    }
  } catch (err) {
    // ConfigMap not created yet, return defaults
  }

  configCache = DEFAULT_IMAGE_CONFIG;
  return DEFAULT_IMAGE_CONFIG;
}

/**
 * Persists image registry swap settings to the Kubernetes ConfigMap
 */
export async function saveImageRegistryConfig(config: Partial<ImageRegistryConfig>): Promise<ImageRegistryConfig> {
  const current = await getImageRegistryConfig();
  const updated: ImageRegistryConfig = {
    ...current,
    ...config,
    targetRegistry: config.targetRegistry?.trim() || '',
    swapFrom: config.swapFrom?.trim() || '',
    swapTo: config.swapTo?.trim() || '',
    flatten: config.flatten ?? true,
    rules: config.rules || current.rules || [],
    updatedAt: new Date().toISOString(),
  };

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: IMAGE_REGISTRY_CONFIGMAP_NAME,
      namespace: IMAGE_REGISTRY_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': IMAGE_REGISTRY_CONFIGMAP_NAME,
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'image-registry.json': JSON.stringify(updated, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${IMAGE_REGISTRY_NAMESPACE}/configmaps/${IMAGE_REGISTRY_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${IMAGE_REGISTRY_NAMESPACE}/configmaps/${IMAGE_REGISTRY_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${IMAGE_REGISTRY_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }

  configCache = updated;
  lastFetchTime = Date.now();
  return updated;
}

export interface ParsedImage {
  original: string;
  domain: string;
  path: string;
  repository: string;
  tag: string;
  digest: string;
}

export function parseImage(image: string): ParsedImage {
  const parsed: ParsedImage = {
    original: image,
    domain: '',
    path: '',
    repository: '',
    tag: '',
    digest: '',
  };

  let ref = image;
  if (ref.includes('@')) {
    const parts = ref.split('@');
    ref = parts[0];
    parsed.digest = parts[1];
  }

  const lastSlash = ref.lastIndexOf('/');
  let tagColon = -1;
  if (lastSlash === -1) {
    tagColon = ref.indexOf(':');
  } else {
    const sub = ref.substring(lastSlash + 1);
    const idx = sub.indexOf(':');
    if (idx !== -1) {
      tagColon = lastSlash + 1 + idx;
    }
  }

  if (tagColon !== -1) {
    parsed.tag = ref.substring(tagColon + 1);
    ref = ref.substring(0, tagColon);
  }

  let parts = ref.split('/');
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    parsed.domain = parts[0];
    parts = parts.slice(1);
  }

  if (parts.length > 0) {
    parsed.repository = parts[parts.length - 1];
    if (parts.length > 1) {
      parsed.path = parts.slice(0, parts.length - 1).join('/');
    }
  }

  return parsed;
}

export function rewriteImage(
  originalImage: string,
  targetRegistry?: string,
  swapFrom?: string,
  swapTo?: string,
  flatten: boolean = true
): string {
  if (!originalImage) return originalImage;

  const target = (targetRegistry || '').replace(/\/+$/, '').trim();
  const from = (swapFrom || '').replace(/\/+$/, '').trim();
  const to = (swapTo || '').replace(/\/+$/, '').trim();

  const parsed = parseImage(originalImage);
  const tagSuffix = parsed.tag ? `:${parsed.tag}` : parsed.digest ? `@${parsed.digest}` : '';

  // 1. Explicit Swap Rule
  if (from && to) {
    let domainAndPath = parsed.domain;
    if (domainAndPath && parsed.path) domainAndPath += `/${parsed.path}`;

    if (
      originalImage.startsWith(from) ||
      domainAndPath.startsWith(from) ||
      parsed.domain === from
    ) {
      if (flatten) {
        return `${to}/${parsed.repository}${tagSuffix}`;
      }
      let trimmed = originalImage.replace(from, '').replace(/^\/+/, '');
      return `${to}/${trimmed}`;
    }
  }

  // 2. Target Registry Relocation
  if (target) {
    if (flatten) {
      return `${target}/${parsed.repository}${tagSuffix}`;
    }
    if (parsed.path) {
      return `${target}/${parsed.path}/${parsed.repository}${tagSuffix}`;
    }
    return `${target}/${parsed.repository}${tagSuffix}`;
  }

  return originalImage;
}

export interface ResolvedImageItem extends CanonicalImageItem {
  resolvedImage: string;
  isRewritten: boolean;
}

export function getResolvedImages(config: ImageRegistryConfig): ResolvedImageItem[] {
  return CANONICAL_IMAGES.map((img) => {
    let effective = img.defaultImage;

    // Check custom rules
    let appliedRule = false;
    if (config.rules && config.rules.length > 0) {
      for (const rule of config.rules) {
        if (rule.from && rule.to && img.defaultImage.includes(rule.from)) {
          effective = rewriteImage(img.defaultImage, '', rule.from, rule.to, config.flatten);
          appliedRule = true;
          break;
        }
      }
    }

    if (!appliedRule) {
      effective = rewriteImage(
        img.defaultImage,
        config.targetRegistry,
        config.swapFrom,
        config.swapTo,
        config.flatten
      );
    }

    return {
      ...img,
      resolvedImage: effective,
      isRewritten: effective !== img.defaultImage,
    };
  });
}

export function generatePlainTextManifest(config: ImageRegistryConfig): string {
  const images = getResolvedImages(config);
  const lines = [
    '# vCluster Operations Center (vCOp) Canonical Image List',
    `# Target Registry: ${config.targetRegistry || '(Default)'}`,
    `# Swap Rule: ${config.swapFrom || 'none'} -> ${config.swapTo || 'none'} (Flatten: ${config.flatten})`,
    `# Generated At: ${new Date().toISOString()}`,
    '',
  ];

  for (const img of images) {
    lines.push(img.resolvedImage);
  }

  return lines.join('\n');
}

export function generateDockerSyncScript(config: ImageRegistryConfig): string {
  const images = getResolvedImages(config);
  const lines = [
    '#!/usr/bin/env bash',
    '# ============================================================================== ',
    '# vCOp Air-Gap Image Mirroring & Sync Script',
    `# Target Registry: ${config.targetRegistry || config.swapTo || 'registry.local/library'}`,
    `# Flatten Mode: ${config.flatten}`,
    `# Generated: ${new Date().toISOString()}`,
    '# ============================================================================== ',
    'set -euo pipefail',
    '',
    'echo "=== Synchronizing vCluster container images to target private registry ==="',
    '',
  ];

  for (const img of images) {
    lines.push(`# ${img.component} (${img.role})`);
    lines.push(`echo "Mirroring: ${img.defaultImage} -> ${img.resolvedImage}"`);
    lines.push(`if command -v skopeo &>/dev/null; then`);
    lines.push(`  skopeo copy "docker://${img.defaultImage}" "docker://${img.resolvedImage}"`);
    lines.push(`elif command -v docker &>/dev/null; then`);
    lines.push(`  docker pull "${img.defaultImage}"`);
    lines.push(`  docker tag "${img.defaultImage}" "${img.resolvedImage}"`);
    lines.push(`  docker push "${img.resolvedImage}"`);
    lines.push(`elif command -v podman &>/dev/null; then`);
    lines.push(`  podman pull "${img.defaultImage}"`);
    lines.push(`  podman tag "${img.defaultImage}" "${img.resolvedImage}"`);
    lines.push(`  podman push "${img.resolvedImage}"`);
    lines.push(`fi`);
    lines.push('');
  }

  lines.push('echo "[✓] All vCluster images synchronized successfully!"');
  return lines.join('\n');
}
