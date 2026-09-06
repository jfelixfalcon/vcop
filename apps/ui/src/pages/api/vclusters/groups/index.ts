import type { APIRoute } from 'astro';
import { getFleetClusterGroups, listVirtualClusters, updateVirtualClusterGroups } from '../../../../lib/k8s-client';
import { canUserManageCluster } from '../../../../lib/auth';

export const GET: APIRoute = async () => {
  try {
    const groups = await getFleetClusterGroups();
    return new Response(JSON.stringify({ success: true, data: groups }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required to manage cluster groups.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    const { groupName, clusterNames, action } = body;

    if (!groupName || typeof groupName !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'groupName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trimmedGroup = groupName.trim();
    if (!trimmedGroup) {
      return new Response(JSON.stringify({ success: false, error: 'groupName cannot be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const clusters = await listVirtualClusters();
    const targetClusters = Array.isArray(clusterNames) ? clusterNames : [];

    // If target clusters were provided, update them
    for (const c of clusters) {
      const isTarget = targetClusters.includes(c.name);
      const currentGroups = c.metadata?.clusterGroups || (c.metadata?.clusterGroup ? [c.metadata.clusterGroup] : []);

      if (action === 'remove') {
        if (isTarget && currentGroups.includes(trimmedGroup)) {
          const newGroups = currentGroups.filter((g) => g !== trimmedGroup);
          await updateVirtualClusterGroups(c.name, newGroups, c.namespace);
        }
      } else if (action === 'delete-group') {
        // Remove this group from all clusters that have it
        if (currentGroups.includes(trimmedGroup)) {
          const newGroups = currentGroups.filter((g) => g !== trimmedGroup);
          await updateVirtualClusterGroups(c.name, newGroups, c.namespace);
        }
      } else {
        // Add to target clusters
        if (isTarget && !currentGroups.includes(trimmedGroup)) {
          const newGroups = [...currentGroups, trimmedGroup];
          await updateVirtualClusterGroups(c.name, newGroups, c.namespace);
        }
      }
    }

    const updatedGroups = await getFleetClusterGroups();
    return new Response(JSON.stringify({ success: true, data: updatedGroups }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
