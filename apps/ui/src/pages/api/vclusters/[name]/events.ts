import type { APIRoute } from 'astro';
import { getVirtualCluster, getVirtualClusterEvents } from '../../../../lib/k8s-client';

export const GET: APIRoute = async ({ params }) => {
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

  const events = await getVirtualClusterEvents(cluster.namespace, cluster.name);
  return new Response(JSON.stringify({ success: true, events }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
