import type { APIRoute } from 'astro';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../../lib/auth';
import { probeEndpoint, recordEndpointProbeResult } from '../../../../../lib/netflow-service';

export const POST: APIRoute = async ({ params, request, locals }) => {
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
      JSON.stringify({ success: false, error: 'Forbidden: Insufficient privileges.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    const { endpointId, targetIp, port = 80, protocol = 'TCP' } = body;

    if (!targetIp) {
      return new Response(JSON.stringify({ success: false, error: 'targetIp is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Run active probe
    const probeResult = await probeEndpoint(
      targetIp,
      parseInt(String(port), 10) || 80,
      protocol.toUpperCase() as 'TCP' | 'HTTP' | 'HTTPS'
    );

    // Cache probe result for this endpoint
    if (endpointId) {
      recordEndpointProbeResult(name, endpointId, probeResult);
    }

    return new Response(JSON.stringify({ success: true, probe: probeResult }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Probe execution failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
