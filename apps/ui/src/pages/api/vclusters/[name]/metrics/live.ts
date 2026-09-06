import type { APIRoute } from 'astro';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../../lib/auth';
import { collectClusterLiveMetrics } from '../../../../../lib/metrics-collector';

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

  try {
    const data = await collectClusterLiveMetrics(cluster.name, cluster.namespace);
    return new Response(JSON.stringify(data), {
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
