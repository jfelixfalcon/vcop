import type { OidcConfig, OidcProfile, OidcRegistry, VirtualCluster } from './types';
import { k8sRequest, listVirtualClusters, updateVirtualClusterEndpointAndOidc } from './k8s-client';

const OIDC_CONFIGMAP_NAME = 'vcop-oidc-profiles';
const OIDC_NAMESPACE = 'vcop-system';

export const DEFAULT_OIDC_REGISTRY: OidcRegistry = {
  updatedAt: new Date().toISOString(),
  global: {
    id: 'global',
    name: 'Global Default Profile',
    scope: 'global',
    enabled: false,
    issuerUrl: '',
    userInfoUrl: '',
    clientId: '',
    usernameClaim: 'email',
    usernamePrefix: '',
    groupsClaim: 'groups',
    groupsPrefix: '',
    extraScopes: ['email', 'profile', 'groups'],
    caFile: '',
    caCertificate: '',
    caSecretName: '',
    caConfigMapName: '',
  },
  groups: {},
};

let memoryRegistryCache: OidcRegistry | null = null;
let lastFetchTime = 0;

/**
 * Retrieves the full OIDC Profiles Registry from Kubernetes ConfigMap.
 */
export async function getOidcRegistry(): Promise<OidcRegistry> {
  const now = Date.now();
  if (memoryRegistryCache && now - lastFetchTime < 5000) {
    return memoryRegistryCache;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${OIDC_NAMESPACE}/configmaps/${OIDC_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['oidc-profiles.json']) {
      const parsed = JSON.parse(res.data.data['oidc-profiles.json']) as OidcRegistry;
      memoryRegistryCache = parsed;
      lastFetchTime = now;
      return parsed;
    }
  } catch (err) {
    // ConfigMap not created yet
  }

  // Persist default registry
  try {
    await saveEntireOidcRegistryToK8s(DEFAULT_OIDC_REGISTRY);
    memoryRegistryCache = DEFAULT_OIDC_REGISTRY;
    lastFetchTime = now;
    return DEFAULT_OIDC_REGISTRY;
  } catch (e) {
    console.warn('Could not persist OIDC Profiles ConfigMap, using in-memory default:', e);
    memoryRegistryCache = DEFAULT_OIDC_REGISTRY;
    return DEFAULT_OIDC_REGISTRY;
  }
}

/**
 * Saves the entire OIDC registry structure to Kubernetes ConfigMap.
 */
export async function saveEntireOidcRegistryToK8s(registry: OidcRegistry): Promise<void> {
  const payload: OidcRegistry = {
    ...registry,
    updatedAt: new Date().toISOString(),
  };

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: OIDC_CONFIGMAP_NAME,
      namespace: OIDC_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-oidc-profiles',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'oidc-profiles.json': JSON.stringify(payload, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${OIDC_NAMESPACE}/configmaps/${OIDC_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${OIDC_NAMESPACE}/configmaps/${OIDC_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${OIDC_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }

  memoryRegistryCache = payload;
  lastFetchTime = Date.now();
}

/**
 * Saves the Global OIDC profile and optionally applies to all fleet clusters.
 */
export async function saveGlobalOidcProfile(
  profile: Partial<OidcProfile>,
  applyToFleet = false
): Promise<{ registry: OidcRegistry; appliedCount: number; errors?: string[] }> {
  const registry = await getOidcRegistry();

  registry.global = {
    ...registry.global,
    ...profile,
    id: 'global',
    name: 'Global Default Profile',
    scope: 'global',
    updatedAt: new Date().toISOString(),
  };

  await saveEntireOidcRegistryToK8s(registry);

  let appliedCount = 0;
  let errors: string[] = [];
  if (applyToFleet) {
    const clusters = await listVirtualClusters();
    const result = await applyOidcProfileToClusters(clusters, registry.global);
    appliedCount = result.updated;
    errors = result.errors;
  }

  return { registry, appliedCount, errors };
}

/**
 * Saves a Group-level OIDC profile and optionally applies to all clusters in that group.
 */
export async function saveGroupOidcProfile(
  groupName: string,
  profile: Partial<OidcProfile>,
  applyToGroupClusters = false
): Promise<{ registry: OidcRegistry; appliedCount: number; errors?: string[] }> {
  const trimmedGroup = groupName.trim();
  if (!trimmedGroup) {
    throw new Error('Group name cannot be empty');
  }

  const registry = await getOidcRegistry();
  registry.groups = registry.groups || {};

  const existing = registry.groups[trimmedGroup] || {
    id: trimmedGroup,
    name: `${trimmedGroup} OIDC Profile`,
    scope: 'group',
    targetGroup: trimmedGroup,
    enabled: true,
    issuerUrl: '',
    clientId: '',
    usernameClaim: 'email',
    usernamePrefix: '',
    groupsClaim: 'groups',
    groupsPrefix: '',
    extraScopes: ['email', 'profile', 'groups'],
  };

  registry.groups[trimmedGroup] = {
    ...existing,
    ...profile,
    id: trimmedGroup,
    name: profile.name || `${trimmedGroup} OIDC Profile`,
    scope: 'group',
    targetGroup: trimmedGroup,
    updatedAt: new Date().toISOString(),
  };

  await saveEntireOidcRegistryToK8s(registry);

  let appliedCount = 0;
  let errors: string[] = [];
  if (applyToGroupClusters) {
    const allClusters = await listVirtualClusters();
    const groupClusters = allClusters.filter((c) => {
      const cGroups =
        c.metadata?.clusterGroups && c.metadata.clusterGroups.length > 0
          ? c.metadata.clusterGroups
          : c.metadata?.clusterGroup
          ? [c.metadata.clusterGroup]
          : [];
      return cGroups.includes(trimmedGroup);
    });

    const result = await applyOidcProfileToClusters(groupClusters, registry.groups[trimmedGroup]);
    appliedCount = result.updated;
    errors = result.errors;
  }

  return { registry, appliedCount, errors };
}

/**
 * Deletes a Group-level OIDC profile.
 */
export async function deleteGroupOidcProfile(groupName: string): Promise<OidcRegistry> {
  const registry = await getOidcRegistry();
  if (registry.groups && registry.groups[groupName]) {
    delete registry.groups[groupName];
    await saveEntireOidcRegistryToK8s(registry);
  }
  return registry;
}

/**
 * Resolves effective OIDC configuration for a virtual cluster based on
 * custom cluster settings, group-level profiles, and global default.
 */
export function resolveOidcForCluster(
  cluster: VirtualCluster,
  registry: OidcRegistry
): {
  oidc: OidcConfig;
  source: 'global' | 'group' | 'custom';
  inheritedFrom?: string;
  hasOverride: boolean;
} {
  const currentSource = cluster.metadata?.oidcInheritance || cluster.metadata?.oidc?.source;

  // 1. If cluster explicitly has custom settings and source is 'custom'
  if (currentSource === 'custom' && cluster.metadata?.oidc) {
    return {
      oidc: cluster.metadata.oidc,
      source: 'custom',
      hasOverride: true,
    };
  }

  // 2. Check cluster groups for a matching group profile
  const clusterGroups =
    cluster.metadata?.clusterGroups && cluster.metadata.clusterGroups.length > 0
      ? cluster.metadata.clusterGroups
      : cluster.metadata?.clusterGroup
      ? [cluster.metadata.clusterGroup]
      : [];

  for (const g of clusterGroups) {
    const groupProfile = registry.groups[g];
    if (groupProfile && groupProfile.enabled) {
      const resolvedClientId = groupProfile.clientId.includes('{cluster}')
        ? groupProfile.clientId.replace('{cluster}', cluster.name)
        : groupProfile.clientId || `${cluster.name}-client`;

      return {
        oidc: {
          enabled: groupProfile.enabled,
          issuerUrl: groupProfile.issuerUrl,
          clientId: resolvedClientId,
          usernameClaim: groupProfile.usernameClaim || 'email',
          usernamePrefix: groupProfile.usernamePrefix || '',
          groupsClaim: groupProfile.groupsClaim || 'groups',
          groupsPrefix: groupProfile.groupsPrefix || '',
          extraScopes: groupProfile.extraScopes || ['email', 'profile', 'groups'],
          caFile: groupProfile.caFile || (groupProfile.caCertificate ? '/etc/ssl/custom-ca/ca.crt' : ''),
          caCertificate: groupProfile.caCertificate || '',
          caSecretName: groupProfile.caSecretName || '',
          caConfigMapName: groupProfile.caConfigMapName || '',
          source: 'group',
          inheritedFrom: g,
        },
        source: 'group',
        inheritedFrom: g,
        hasOverride: false,
      };
    }
  }

  // 3. Fall back to Global OIDC Profile if enabled
  if (registry.global && registry.global.enabled) {
    const resolvedClientId = registry.global.clientId.includes('{cluster}')
      ? registry.global.clientId.replace('{cluster}', cluster.name)
      : registry.global.clientId || `${cluster.name}-client`;

    return {
      oidc: {
        enabled: registry.global.enabled,
        issuerUrl: registry.global.issuerUrl,
        clientId: resolvedClientId,
        usernameClaim: registry.global.usernameClaim || 'email',
        usernamePrefix: registry.global.usernamePrefix || '',
        groupsClaim: registry.global.groupsClaim || 'groups',
        groupsPrefix: registry.global.groupsPrefix || '',
        extraScopes: registry.global.extraScopes || ['email', 'profile', 'groups'],
        caFile: registry.global.caFile || (registry.global.caCertificate ? '/etc/ssl/custom-ca/ca.crt' : ''),
        caCertificate: registry.global.caCertificate || '',
        caSecretName: registry.global.caSecretName || '',
        caConfigMapName: registry.global.caConfigMapName || '',
        source: 'global',
        inheritedFrom: 'global',
      },
      source: 'global',
      inheritedFrom: 'global',
      hasOverride: false,
    };
  }

  // 4. If current cluster has any oidc configured
  if (cluster.metadata?.oidc?.enabled) {
    return {
      oidc: cluster.metadata.oidc,
      source: 'custom',
      hasOverride: true,
    };
  }

  // 5. Default disabled
  return {
    oidc: {
      enabled: false,
      issuerUrl: '',
      clientId: `${cluster.name}-client`,
      usernameClaim: 'email',
      usernamePrefix: '',
      groupsClaim: 'groups',
      groupsPrefix: '',
      extraScopes: ['email', 'profile', 'groups'],
      source: 'global',
    },
    source: 'global',
    hasOverride: false,
  };
}

/**
 * Applies an OIDC profile to a list of virtual clusters.
 */
export async function applyOidcProfileToClusters(
  clusters: VirtualCluster[],
  profile: OidcProfile
): Promise<{ updated: number; failed: number; errors: string[] }> {
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const c of clusters) {
    try {
      const resolvedClientId = profile.clientId.includes('{cluster}')
        ? profile.clientId.replace('{cluster}', c.name)
        : profile.clientId || `${c.name}-client`;

      const targetOidc: OidcConfig = {
        enabled: profile.enabled,
        issuerUrl: profile.issuerUrl.trim(),
        clientId: resolvedClientId.trim(),
        usernameClaim: profile.usernameClaim?.trim() || 'email',
        usernamePrefix: profile.usernamePrefix?.trim() || '',
        groupsClaim: profile.groupsClaim?.trim() || 'groups',
        groupsPrefix: profile.groupsPrefix?.trim() || '',
        extraScopes: profile.extraScopes || ['email', 'profile', 'groups'],
        caFile: profile.caFile?.trim() || (profile.caCertificate ? '/etc/ssl/custom-ca/ca.crt' : ''),
        caCertificate: profile.caCertificate?.trim() || '',
        caSecretName: profile.caSecretName?.trim() || '',
        caConfigMapName: profile.caConfigMapName?.trim() || '',
        source: profile.scope,
        inheritedFrom: profile.scope === 'group' ? profile.targetGroup : 'global',
      };

      await updateVirtualClusterEndpointAndOidc(
        c.name,
        {
          oidc: targetOidc,
          customCaCert: profile.caCertificate?.trim() || '',
          customCaSecret: profile.caSecretName?.trim() || '',
          customCaConfigMap: profile.caConfigMapName?.trim() || '',
        },
        c.namespace
      );
      updated++;
    } catch (err: any) {
      failed++;
      errors.push(`${c.name}: ${err.message || 'Unknown error'}`);
    }
  }

  return { updated, failed, errors };
}
