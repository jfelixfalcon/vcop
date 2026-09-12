import type { APIRoute } from 'astro';
import { listClusterNamespaces } from '../../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const namespaces = await listClusterNamespaces();
    return new Response(
      JSON.stringify({
        success: true,
        namespaces,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to list namespaces',
        namespaces: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
