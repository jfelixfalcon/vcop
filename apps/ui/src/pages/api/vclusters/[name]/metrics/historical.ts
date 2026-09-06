import type { APIRoute } from 'astro';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../../lib/auth';
import { getHistoricalBuckets } from '../../../../../lib/metrics-db';

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
      JSON.stringify({ success: false, error: 'Forbidden: You do not have access to view this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const searchParams = url.searchParams;
  const timeRange = (searchParams.get('range') as any) || '1h';
  const namespace = searchParams.get('namespace') || undefined;
  const workloadName = searchParams.get('workload') || undefined;
  const workloadKind = searchParams.get('kind') || undefined;
  const podName = searchParams.get('pod') || undefined;

  try {
    const buckets = await getHistoricalBuckets({
      vcluster: name,
      timeRange,
      namespace,
      workloadName,
      workloadKind,
      podName,
    });

    return new Response(
      JSON.stringify({
        success: true,
        cluster: name,
        timeRange,
        buckets,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
