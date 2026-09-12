import type { APIRoute } from 'astro';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../../lib/auth';
import { probeEndpoint, recordEndpointProbeResult, getClusterNetflowData } from '../../../../../lib/netflow-service';

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
    let { endpointId, targetIp, port, protocol, targetType } = body;

    let resolvedIp = (targetIp || '').trim();
    let resolvedPort = typeof port === 'number' ? port : parseInt(String(port), 10);
    let resolvedProto = protocol ? (String(protocol).toUpperCase() as 'TCP' | 'HTTP' | 'HTTPS') : 'TCP';

    // If endpointId is provided, validate against actual cluster topology to ensure correct Service VIP vs Pod Port
    if (endpointId) {
      try {
        const netflowData = await getClusterNetflowData(name);
        const ep = netflowData.endpoints.find((e) => e.id === endpointId);
        if (ep) {
          const isExternal = ep.tier === 'external' || ep.id.startsWith('external/') || ep.clusterIP === 'External';
          const isHeadless = !ep.clusterIP || ep.clusterIP === 'None';
          const isPodTarget = targetType === 'pod' || ep.backingPods.some((p) => p.ip === resolvedIp);

          if (isPodTarget) {
            // Probing a specific backing pod instance directly
            const matchedPod = ep.backingPods.find((p) => p.ip === resolvedIp) || ep.backingPods[0];
            resolvedIp = matchedPod?.ip || resolvedIp;
            // Backing pods listen on targetPort (container port)
            resolvedPort = ep.ports[0]?.targetPort || ep.ports[0]?.port || 80;
          } else if (isExternal) {
            // External egress / internet ingress probe
            resolvedIp = ep.externalIP || '1.1.1.1';
            resolvedPort = ep.ports[0]?.port || 443;
          } else if (isHeadless && ep.backingPods.length > 0) {
            // Headless service without ClusterIP VIP -> route to first backing pod targetPort
            resolvedIp = ep.backingPods[0].ip;
            resolvedPort = ep.ports[0]?.targetPort || ep.ports[0]?.port || 80;
          } else {
            // Standard Kubernetes Service VIP
            resolvedIp = ep.clusterIP && ep.clusterIP !== 'None' ? ep.clusterIP : (ep.backingPods[0]?.ip || '1.1.1.1');
            resolvedPort = ep.ports[0]?.port || 80;
          }

          // Auto-detect protocol if not explicitly specified
          if (!protocol) {
            if (resolvedPort === 443 || ep.ports[0]?.name?.includes('https')) {
              resolvedProto = 'HTTPS';
            } else if (resolvedPort === 80 || ep.ports[0]?.name?.includes('http')) {
              resolvedProto = 'HTTP';
            }
          }
        }
      } catch (err: any) {
        console.warn('[netflow/probe] Endpoint lookup fallback:', err.message);
      }
    }

    if (!resolvedIp || resolvedIp === 'External' || resolvedIp === 'external' || resolvedIp === 'None') {
      resolvedIp = '1.1.1.1';
      if (!resolvedPort || isNaN(resolvedPort)) resolvedPort = 443;
    }

    if (!resolvedPort || isNaN(resolvedPort)) {
      resolvedPort = 80;
    }

    // Run active reachability probe
    const probeResult = await probeEndpoint(
      resolvedIp,
      resolvedPort,
      resolvedProto
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
