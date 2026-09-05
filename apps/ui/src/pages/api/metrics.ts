import type { APIRoute } from 'astro';
import { listVirtualClusters } from '../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const clusters = await listVirtualClusters();

    const total = clusters.length;
    const ready = clusters.filter(c => c.status.phase === 'Ready').length;
    const provisioning = clusters.filter(c => c.status.phase === 'Provisioning').length;
    const upgrading = clusters.filter(c => c.status.phase === 'Upgrading').length;
    const degraded = clusters.filter(c => c.status.phase === 'Degraded').length;

    // Aggregate compute metrics
    let totalPods = 0;
    let totalNodes = 0;
    for (const c of clusters) {
      totalPods += c.status.metrics?.podCount || 0;
      totalNodes += c.status.metrics?.activeNodeCount || 0;
    }

    return new Response(JSON.stringify({
      success: true,
      summary: {
        total,
        ready,
        provisioning,
        upgrading,
        degraded,
        totalPods,
        totalNodes,
        healthPercentage: total > 0 ? Math.round((ready / total) * 100) : 100,
      },
    }), {
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
