import type { APIRoute } from 'astro';
import { getVirtualCluster, deleteVirtualCluster } from '../../../../lib/k8s-client';

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

  return new Response(JSON.stringify({ success: true, data: cluster }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ params }) => {
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
