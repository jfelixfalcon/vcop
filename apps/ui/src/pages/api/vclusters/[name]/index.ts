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
import { canUserViewCluster, canUserManageCluster } from '../../../../lib/auth';

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
      updated = await updateVirtualClusterPolicies(name, policies, namespace);
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

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required to teardown clusters.' }),
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

  return new Response(JSON.stringify({ success: true, message: `Cluster ${name} scheduled for teardown` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

