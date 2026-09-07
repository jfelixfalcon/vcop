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
    let rbacWarning: string | undefined;
    const ciRes = await k8sRequest<{ items?: Array<{ metadata?: { name?: string } }> }>(
      '/apis/cert-manager.io/v1/clusterissuers'
    );
    if (ciRes.statusCode === 200 && Array.isArray(ciRes.data?.items)) {
      for (const item of ciRes.data.items) {
        if (item.metadata?.name) {
          clusterIssuers.push(item.metadata.name);
        }
      }
    } else if (ciRes.statusCode === 403) {
      rbacWarning = 'Permission denied listing ClusterIssuers (HTTP 403). Check UI RBAC roles.';
      console.warn('[cert-manager/issuers] 403 Forbidden while listing clusterissuers');
    } else if (ciRes.statusCode !== 200) {
      console.warn(`[cert-manager/issuers] Unexpected HTTP ${ciRes.statusCode} while listing clusterissuers`);
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
      } else if (iRes.statusCode !== 200) {
        console.warn(`[cert-manager/issuers] Failed to list issuers in ${namespace} (HTTP ${iRes.statusCode})`);
      }
    }

    return new Response(JSON.stringify({
      installed: true,
      clusterIssuers,
      issuers,
      warning: rbacWarning,
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
