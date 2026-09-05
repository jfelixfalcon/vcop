import type { APIRoute } from 'astro';
import { listVirtualClusters, createVirtualCluster } from '../../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const clusters = await listVirtualClusters();
    return new Response(JSON.stringify({ success: true, data: clusters }), {
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    if (!body.clusterName) {
      return new Response(JSON.stringify({ success: false, error: 'clusterName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cluster = await createVirtualCluster(body);
    return new Response(JSON.stringify({ success: true, data: cluster }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
