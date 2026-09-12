import type { APIRoute } from 'astro';
import { getGenericNetflowData } from '../../../lib/netflow-service';
import { getVirtualCluster } from '../../../lib/k8s-client';
import { canUserViewCluster } from '../../../lib/auth';

export const GET: APIRoute = async ({ url, locals }) => {
  const scopeParam = url.searchParams.get('scope') || 'all';
  const targetParam = url.searchParams.get('target') || '';

  const scope = (['all', 'vcluster', 'namespace'].includes(scopeParam)
    ? scopeParam
    : 'all') as 'all' | 'vcluster' | 'namespace';

  const user = locals.user;

  // If scoped to a specific vcluster, enforce access control
  if (scope === 'vcluster' && targetParam && targetParam !== 'all') {
    try {
      const cluster = await getVirtualCluster(targetParam);
      if (!cluster) {
        return new Response(JSON.stringify({ success: false, error: `Virtual cluster '${targetParam}' not found` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (user && !canUserViewCluster(user, cluster)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden: Insufficient permissions to view this cluster.' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message || 'Cluster validation failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const netflowData = await getGenericNetflowData({
      scope,
      target: targetParam,
    });

    return new Response(JSON.stringify(netflowData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Failed to retrieve NetFlow data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
