import type { APIRoute } from 'astro';
import { setVirtualClusterSleep } from '../../../../lib/k8s-client';
import { canUserManageCluster } from '../../../../lib/auth';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required to change sleep state.' }),
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
    const sleep = body.sleep !== undefined ? Boolean(body.sleep) : (body.paused !== undefined ? Boolean(body.paused) : true);
    const namespace = body.namespace;

    const updated = await setVirtualClusterSleep(name, sleep, namespace);
    return new Response(
      JSON.stringify({
        success: true,
        data: updated,
        message: sleep ? `Cluster ${name} is now in sleep mode` : `Cluster ${name} has been awakened`,
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
