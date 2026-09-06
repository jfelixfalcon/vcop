import type { APIRoute } from 'astro';
import { getVirtualCluster, upgradeVirtualCluster } from '../../../../lib/k8s-client';
import { canUserManageCluster } from '../../../../lib/auth';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required to upgrade clusters.' }),
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

  const cluster = await getVirtualCluster(name);
  if (!cluster) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const targetNs = body.namespace || cluster.namespace || 'default';
    const updated = await upgradeVirtualCluster(name, {
      kubernetesVersion: body.kubernetesVersion,
      vclusterVersion: body.vclusterVersion,
    }, targetNs);

    return new Response(JSON.stringify({
      success: true,
      message: `Upgrade initiated for ${name}`,
      data: updated,
    }), {
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
