import type { APIRoute } from 'astro';
import {
  getVirtualCluster,
  getKubeconfigDetails,
  generateOidcKubeconfig,
  generateMockKubeconfig,
} from '../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../lib/auth';

export const GET: APIRoute = async ({ params, url, locals }) => {
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
      JSON.stringify({ success: false, error: 'Forbidden: You do not have permission to access kubeconfig for this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const type = url.searchParams.get('type') === 'oidc' ? 'oidc' : 'admin';
  const endpointOverride = url.searchParams.get('endpoint')?.trim() || undefined;
  const effectiveEndpoint = endpointOverride || cluster.metadata?.customEndpoint || cluster.status.endpoint || 'https://kubernetes.default.svc';
  const download = url.searchParams.get('download') === 'true';

  const details = await getKubeconfigDetails(name, cluster.namespace);
  let kubeconfig = '';

  if (type === 'oidc') {
    kubeconfig = generateOidcKubeconfig(cluster, cluster.metadata?.oidc, effectiveEndpoint, details?.caData);
  } else {
    if (details?.config) {
      kubeconfig = details.config;
      if (effectiveEndpoint) {
        kubeconfig = kubeconfig.replace(/server:\s*https?:\/\/[^\s]+/g, `server: ${effectiveEndpoint}`);
      }
    } else {
      kubeconfig = generateMockKubeconfig(cluster, effectiveEndpoint);
    }
  }

  if (download) {
    const filename = type === 'oidc' ? `${name}-oidc-kubeconfig.yaml` : `${name}-kubeconfig.yaml`;
    return new Response(kubeconfig, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      kubeconfig,
      type,
      endpoint: effectiveEndpoint,
      isCustomEndpoint: Boolean(cluster.metadata?.customEndpoint || endpointOverride),
      oidc: cluster.metadata?.oidc,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
