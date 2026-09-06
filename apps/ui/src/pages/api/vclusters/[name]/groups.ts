import type { APIRoute } from 'astro';
import { getVirtualCluster, updateVirtualClusterGroups } from '../../../../lib/k8s-client';
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
    return new Response(JSON.stringify({ success: false, error: 'Forbidden: View access required.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        clusterGroup: cluster.metadata?.clusterGroup || '',
        clusterGroups: cluster.metadata?.clusterGroups || [],
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Administrator privileges required to update cluster groups.',
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

  try {
    const body = await request.json();
    const { clusterGroups, clusterGroup, groups, namespace } = body;

    const groupsToSet = clusterGroups !== undefined ? clusterGroups : (groups !== undefined ? groups : clusterGroup);
    const updated = await updateVirtualClusterGroups(name, groupsToSet || [], namespace);

    return new Response(
      JSON.stringify({
        success: true,
        data: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
