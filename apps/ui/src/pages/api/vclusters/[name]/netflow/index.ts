import type { APIRoute } from 'astro';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../../lib/auth';
import { getGenericNetflowData } from '../../../../../lib/netflow-service';

export const GET: APIRoute = async ({ params, locals }) => {
  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Support cluster-wide scope fallback
  if (name === 'all' || name === 'cluster-wide') {
    try {
      const netflowData = await getGenericNetflowData({ scope: 'all' });
      return new Response(JSON.stringify(netflowData), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message || 'Failed to get NetFlow data' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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

  try {
    const netflowData = await getGenericNetflowData({ scope: 'vcluster', target: name });
    return new Response(JSON.stringify(netflowData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Failed to get NetFlow data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
