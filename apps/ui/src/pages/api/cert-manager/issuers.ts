import type { APIRoute } from 'astro';
import { k8sRequest } from '../../../lib/k8s-client';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace') || 'default';

  try {
    // 1. Check if cert-manager API group is present
    const groupRes = await k8sRequest<any>('/apis/cert-manager.io/v1');
    if (groupRes.statusCode !== 200) {
      return new Response(JSON.stringify({
        installed: false,
        clusterIssuers: [],
        issuers: [],
        error: 'cert-manager CRDs are not detected on the host cluster',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Fetch ClusterIssuers
    const clusterIssuers: string[] = [];
    const ciRes = await k8sRequest<{ items?: Array<{ metadata?: { name?: string } }> }>(
      '/apis/cert-manager.io/v1/clusterissuers'
    );
    if (ciRes.statusCode === 200 && Array.isArray(ciRes.data?.items)) {
      for (const item of ciRes.data.items) {
        if (item.metadata?.name) {
          clusterIssuers.push(item.metadata.name);
        }
      }
    }

    // 3. Fetch namespaced Issuers
    const issuers: string[] = [];
    if (namespace) {
      const iRes = await k8sRequest<{ items?: Array<{ metadata?: { name?: string } }> }>(
        `/apis/cert-manager.io/v1/namespaces/${namespace}/issuers`
      );
      if (iRes.statusCode === 200 && Array.isArray(iRes.data?.items)) {
        for (const item of iRes.data.items) {
          if (item.metadata?.name) {
            issuers.push(item.metadata.name);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      installed: true,
      clusterIssuers,
      issuers,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({
      installed: false,
      clusterIssuers: [],
      issuers: [],
      error: err.message || 'Failed checking cert-manager status',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
