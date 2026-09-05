import type { APIRoute } from 'astro';
import { getVirtualCluster, getKubeconfig, generateMockKubeconfig } from '../../../../lib/k8s-client';

export const GET: APIRoute = async ({ params, url }) => {
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

  const realKubeconfig = await getKubeconfig(name);
  const kubeconfig = realKubeconfig || generateMockKubeconfig(cluster);
  const download = url.searchParams.get('download') === 'true';

  if (download) {
    return new Response(kubeconfig, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': `attachment; filename="${name}-kubeconfig.yaml"`,
      },
    });
  }

  return new Response(JSON.stringify({ success: true, kubeconfig, endpoint: cluster.status.endpoint }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
