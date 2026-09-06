import type { APIRoute } from 'astro';
import { getVirtualCluster, updateVirtualClusterEndpointAndOidc } from '../../../../lib/k8s-client';
import { canUserManageCluster } from '../../../../lib/auth';

export const POST: APIRoute = async ({ params, request, locals }) => {
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
  if (user && !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: You do not have permission to modify this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';

    if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Endpoint must start with https:// or http://' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const updated = await updateVirtualClusterEndpointAndOidc(
      name,
      { customEndpoint: endpoint },
      cluster.namespace
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: endpoint ? `Custom endpoint set to ${endpoint}` : 'Reset to default internal cluster endpoint',
        cluster: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to update endpoint' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const PUT = POST;
