import type { PlatformAccessPolicy, RoleAssignment, UserRole } from './types';
import { k8sRequest } from './k8s-client';

const ACCESS_POLICY_CONFIGMAP_NAME = 'vcop-access-policy';
const ACCESS_POLICY_NAMESPACE = 'vcop-system';

let cachedPolicy: PlatformAccessPolicy | null = null;
let lastFetchTime = 0;

/**
 * Returns the default access policy based on system environment variables and default role seeds.
 */
export function getDefaultAccessPolicy(): PlatformAccessPolicy {
  const adminGroupsEnv = (
    process.env.OIDC_ADMIN_GROUPS || 'admins,vcluster-admins'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const adminUsersEnv = (
    process.env.OIDC_ADMIN_EMAILS || 'admin@vops.local'
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const devGroupsEnv = (
    process.env.OIDC_DEV_GROUPS ||
    process.env.OIDC_DEVELOPER_GROUPS ||
    ''
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const devUsersEnv = (
    process.env.OIDC_DEV_EMAILS ||
    process.env.OIDC_DEVELOPER_EMAILS ||
    ''
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const viewerGroupsEnv = (
    process.env.OIDC_VIEWER_GROUPS ||
    ''
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const viewerUsersEnv = (
    process.env.OIDC_VIEWER_EMAILS ||
    ''
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    updatedAt: new Date().toISOString(),
    admin: {
      groups: Array.from(new Set(adminGroupsEnv)),
      users: Array.from(new Set(adminUsersEnv)),
    },
    developers: {
      groups: Array.from(new Set(devGroupsEnv)),
      users: Array.from(new Set(devUsersEnv)),
    },
    viewers: {
      groups: Array.from(new Set(viewerGroupsEnv)),
      users: Array.from(new Set(viewerUsersEnv)),
    },
    defaultRole: 'viewer',
  };
}

/**
 * Retrieves the Platform Access Policy from Kubernetes ConfigMap.
 * Falls back to environment variable configuration if not yet persisted.
 */
export async function getAccessPolicy(): Promise<PlatformAccessPolicy> {
  const now = Date.now();
  if (cachedPolicy && now - lastFetchTime < 5000) {
    return cachedPolicy;
  }

  try {
    const res = await k8sRequest<any>(
      `/api/v1/namespaces/${ACCESS_POLICY_NAMESPACE}/configmaps/${ACCESS_POLICY_CONFIGMAP_NAME}`
    );

    if (res.statusCode === 200 && res.data?.data?.['access-policy.json']) {
      const parsed = JSON.parse(res.data.data['access-policy.json']) as PlatformAccessPolicy;
      cachedPolicy = parsed;
      lastFetchTime = now;
      return parsed;
    }
  } catch (err) {
    // ConfigMap not created yet
  }

  // Not found: initialize with default policy
  const defaultPolicy = getDefaultAccessPolicy();
  try {
    await saveAccessPolicy(defaultPolicy);
    cachedPolicy = defaultPolicy;
    lastFetchTime = now;
    return defaultPolicy;
  } catch (e) {
    cachedPolicy = defaultPolicy;
    return defaultPolicy;
  }
}

/**
 * Saves the updated Platform Access Policy to Kubernetes ConfigMap.
 */
export async function saveAccessPolicy(
  policy: PlatformAccessPolicy
): Promise<PlatformAccessPolicy> {
  const cleanList = (list: string[] = []): string[] =>
    Array.from(new Set(list.map((s) => (s || '').toLowerCase().trim()).filter(Boolean)));

  const sanitized: PlatformAccessPolicy = {
    updatedAt: new Date().toISOString(),
    admin: {
      groups: cleanList(policy.admin?.groups),
      users: cleanList(policy.admin?.users),
    },
    developers: {
      groups: cleanList(policy.developers?.groups),
      users: cleanList(policy.developers?.users),
    },
    viewers: {
      groups: cleanList(policy.viewers?.groups),
      users: cleanList(policy.viewers?.users),
    },
    defaultRole: policy.defaultRole === 'developers' ? 'developers' : 'viewer',
  };

  const cmData = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: ACCESS_POLICY_CONFIGMAP_NAME,
      namespace: ACCESS_POLICY_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'vcop-access-policy',
        'app.kubernetes.io/part-of': 'vcop',
      },
    },
    data: {
      'access-policy.json': JSON.stringify(sanitized, null, 2),
    },
  };

  const checkRes = await k8sRequest<any>(
    `/api/v1/namespaces/${ACCESS_POLICY_NAMESPACE}/configmaps/${ACCESS_POLICY_CONFIGMAP_NAME}`
  );

  if (checkRes.statusCode === 200) {
    await k8sRequest(
      `/api/v1/namespaces/${ACCESS_POLICY_NAMESPACE}/configmaps/${ACCESS_POLICY_CONFIGMAP_NAME}`,
      'PUT',
      cmData
    );
  } else {
    await k8sRequest(
      `/api/v1/namespaces/${ACCESS_POLICY_NAMESPACE}/configmaps`,
      'POST',
      cmData
    );
  }

  cachedPolicy = sanitized;
  lastFetchTime = Date.now();
  return sanitized;
}

/**
 * Resolves a user's role against the active PlatformAccessPolicy.
 * Evaluates strictly according to the explicit access policy:
 * 1. Administrator Users / Emails
 * 2. Administrator Groups
 * 3. Developer Users / Emails
 * 4. Developer Groups
 * 5. Viewer Users / Emails
 * 6. Viewer Groups
 * 7. Default fallback role (strictly 'viewer' unless explicitly configured)
 */
export function resolveRoleWithPolicy(
  email: string,
  groups: string[],
  username?: string,
  policy?: PlatformAccessPolicy
): { role: UserRole; reason: string } {
  const p = policy || cachedPolicy || getDefaultAccessPolicy();

  const normEmail = (email || '').toLowerCase().trim();
  const normUsername = (username || '').toLowerCase().trim();
  const emailPrefix = normEmail.includes('@') ? normEmail.split('@')[0] : '';

  const normGroups = (groups || []).flatMap((g) => {
    const raw = (g || '').toLowerCase().trim();
    if (!raw) return [];
    const stripped = raw.replace(/^cn=([^,]+).*/i, '$1').replace(/^\/+|\/+$/g, '').trim();
    if (stripped && stripped !== raw) {
      if (stripped.includes('/')) {
        return [raw, stripped, ...stripped.split('/').filter(Boolean)];
      }
      return [raw, stripped];
    }
    return [raw];
  });

  const isUserInList = (userList: string[] = []): boolean => {
    return userList.some((u) => {
      const normU = (u || '').toLowerCase().trim();
      return (
        (normEmail && normU === normEmail) ||
        (normUsername && normU === normUsername) ||
        (emailPrefix && normU === emailPrefix)
      );
    });
  };

  const isGroupInList = (groupList: string[] = []): string | undefined => {
    return groupList.find((g) => {
      const normG = (g || '').toLowerCase().trim().replace(/^\/+|\/+$/g, '');
      return normGroups.includes(normG) || normGroups.includes((g || '').toLowerCase().trim());
    });
  };

  // 1. Check Administrator Users (by email or username)
  if (isUserInList(p.admin?.users)) {
    return { role: 'admin', reason: 'Directly assigned to Administrator user list' };
  }

  // 2. Check Administrator Groups
  const matchedAdminGroup = isGroupInList(p.admin?.groups);
  if (matchedAdminGroup) {
    return { role: 'admin', reason: `Belongs to Administrator group '${matchedAdminGroup}'` };
  }

  // 3. Check Developer Users (by email or username)
  if (isUserInList(p.developers?.users)) {
    return { role: 'developers', reason: 'Directly assigned to Developer user list' };
  }

  // 4. Check Developer Groups
  const matchedDevGroup = isGroupInList(p.developers?.groups);
  if (matchedDevGroup) {
    return { role: 'developers', reason: `Belongs to Developer group '${matchedDevGroup}'` };
  }

  // 5. Check Viewer Users
  if (isUserInList(p.viewers?.users)) {
    return { role: 'viewer', reason: 'Directly assigned to Viewer user list' };
  }

  // 6. Check Viewer Groups
  const matchedViewerGroup = isGroupInList(p.viewers?.groups);
  if (matchedViewerGroup) {
    return { role: 'viewer', reason: `Belongs to Viewer group '${matchedViewerGroup}'` };
  }

  // 7. Strict Fallback for Unassigned Users
  const fallback = p.defaultRole === 'developers' ? 'developers' : 'viewer';
  return { role: fallback, reason: `Default fallback role '${fallback}' for unassigned users` };
}
