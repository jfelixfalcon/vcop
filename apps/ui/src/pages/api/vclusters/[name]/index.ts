import type { APIRoute } from 'astro';
import {
  getVirtualCluster,
  deleteVirtualCluster,
  updateVirtualClusterPolicies,
  setVirtualClusterSleep,
  updateVirtualClusterRBAC,
  updateVirtualClusterGroups,
  upgradeVirtualCluster,
} from '../../../../lib/k8s-client';
import { canUserViewCluster, canUserManageCluster, canUserDeleteCluster } from '../../../../lib/auth';
import { recordAuditLog } from '../../../../lib/audit-logger';

export const GET: APIRoute = async ({ params, locals }) => {
  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cluster = await getVirtualCluster(name);
  if (!cluster) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = locals.user;
  if (user && !canUserViewCluster(user, cluster)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: You do not have access to view this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(JSON.stringify({ success: true, data: cluster }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required to modify cluster resources.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { policies, namespace, sleep, paused, rbac, owner, allowedGroups, allowedEmails, clusterGroups, clusterGroup } = body;

    let updated = null;
    if (sleep !== undefined || paused !== undefined) {
      updated = await setVirtualClusterSleep(name, Boolean(sleep ?? paused), namespace);
    }
    if (policies) {
      updated = await updateVirtualClusterPolicies(name, policies, namespace, body.ignoreCapacityCheck);
    }
    if (rbac || owner !== undefined || allowedGroups !== undefined || allowedEmails !== undefined) {
      const rbacData = rbac || { owner, allowedGroups, allowedEmails };
      updated = await updateVirtualClusterRBAC(name, rbacData, namespace);
    }
    if (clusterGroups !== undefined || clusterGroup !== undefined) {
      const groupsToSet = clusterGroups !== undefined ? clusterGroups : clusterGroup;
      updated = await updateVirtualClusterGroups(name, groupsToSet, namespace);
    }
    if (body.kubernetesVersion || body.vclusterVersion) {
      const existing = await getVirtualCluster(name, namespace);
      if (existing && (existing.spec.clusterType === 'namespaced' || existing.status.clusterType === 'namespaced')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Engine upgrade is not applicable for host namespaced clusters.' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updated = await upgradeVirtualCluster(name, {
        kubernetesVersion: body.kubernetesVersion,
        vclusterVersion: body.vclusterVersion,
      }, namespace);
    }

    if (!updated) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No valid update parameters provided (policies, sleep, paused, rbac, clusterGroups, or versions)',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Determine specific action type
    let auditAction = 'CLUSTER_UPDATE';
    if (sleep !== undefined || paused !== undefined) {
      auditAction = Boolean(sleep ?? paused) ? 'CLUSTER_SLEEP' : 'CLUSTER_WAKE';
    } else if (policies) {
      auditAction = 'CLUSTER_UPDATE_QUOTA';
    } else if (rbac || owner !== undefined || allowedGroups !== undefined || allowedEmails !== undefined) {
      auditAction = 'CLUSTER_UPDATE_RBAC';
    } else if (clusterGroups !== undefined || clusterGroup !== undefined) {
      auditAction = 'CLUSTER_UPDATE_GROUPS';
    } else if (body.kubernetesVersion || body.vclusterVersion) {
      auditAction = 'CLUSTER_UPGRADE';
    }

    await recordAuditLog({
      action: auditAction,
      category: 'CLUSTER',
      resourceType: 'virtualcluster',
      resourceName: name,
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: 'SUCCESS',
      details: {
        clusterName: name,
        namespace,
        updates: {
          sleep: sleep !== undefined || paused !== undefined ? Boolean(sleep ?? paused) : undefined,
          hasPolicies: Boolean(policies),
          hasRbac: Boolean(rbac || owner || allowedGroups || allowedEmails),
          hasGroups: Boolean(clusterGroups !== undefined || clusterGroup !== undefined),
          upgrade: body.kubernetesVersion || body.vclusterVersion ? { k8s: body.kubernetesVersion, vcluster: body.vclusterVersion } : undefined,
        },
      },
      request,
    });

    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user || !canUserDeleteCluster(user)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Administrator privileges required to teardown clusters. Developers cannot delete vclusters.',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const deleted = await deleteVirtualCluster(name);
  if (!deleted) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster not found or already deleted' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await recordAuditLog({
    action: 'CLUSTER_DELETE',
    category: 'CLUSTER',
    resourceType: 'virtualcluster',
    resourceName: name,
    username: user.username,
    userRole: user.role,
    userId: user.id,
    status: 'SUCCESS',
    details: { clusterName: name },
    request,
  });

  return new Response(JSON.stringify({ success: true, message: `Cluster ${name} scheduled for teardown` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

