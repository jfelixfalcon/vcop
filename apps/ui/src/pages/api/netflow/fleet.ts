import type { APIRoute } from 'astro';
import { listVirtualClusters } from '../../../lib/k8s-client';
import { canUserViewCluster } from '../../../lib/auth';
import { getClusterNetflowData } from '../../../lib/netflow-service';

export const GET: APIRoute = async ({ locals }) => {
  try {
    const allClusters = await listVirtualClusters();
    const user = locals.user;

    const visibleClusters =
      user && user.role !== 'admin'
        ? allClusters.filter((c) => canUserViewCluster(user, c))
        : allClusters;

    const fleetSummaries = await Promise.all(
      visibleClusters.map(async (c) => {
        try {
          const data = await getClusterNetflowData(c.name);
          return {
            clusterName: c.name,
            namespace: c.namespace,
            phase: c.status?.phase || 'Unknown',
            summary: data.summary,
            endpointsCount: data.endpoints.length,
          };
        } catch {
          return {
            clusterName: c.name,
            namespace: c.namespace,
            phase: c.status?.phase || 'Unknown',
            summary: null,
            endpointsCount: 0,
          };
        }
      })
    );

    return new Response(JSON.stringify({ success: true, fleet: fleetSummaries }), {
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
