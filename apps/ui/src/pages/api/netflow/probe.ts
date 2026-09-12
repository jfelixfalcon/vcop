import type { APIRoute } from 'astro';
import { probeEndpoint, recordEndpointProbeResult, getGenericNetflowData } from '../../../lib/netflow-service';
import { getVirtualCluster } from '../../../lib/k8s-client';
import { canUserViewCluster } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    let { endpointId, targetIp, port, protocol, targetType, scope, target } = body;

    const user = locals.user;
    if (scope === 'vcluster' && target && target !== 'all') {
      const cluster = await getVirtualCluster(target);
      if (cluster && user && !canUserViewCluster(user, cluster)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden: Insufficient privileges.' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    let resolvedIp = (targetIp || '').trim();
    let resolvedPort = typeof port === 'number' ? port : parseInt(String(port), 10);
    let resolvedProto = protocol ? (String(protocol).toUpperCase() as 'TCP' | 'HTTP' | 'HTTPS') : 'TCP';

    // If endpointId is provided, validate against actual cluster topology
    if (endpointId) {
      try {
        const netflowData = await getGenericNetflowData({
          scope: scope || 'all',
          target: target || 'all',
        });
        const ep = netflowData.endpoints.find((e) => e.id === endpointId);
        if (ep) {
          const isPodTarget = targetType === 'pod' || ep.backingPods.some((p) => p.ip === resolvedIp);

          if (isPodTarget) {
            const matchedPod = ep.backingPods.find((p) => p.ip === resolvedIp) || ep.backingPods[0];
            resolvedIp = matchedPod?.ip || resolvedIp;
            resolvedPort = Number(ep.ports[0]?.targetPort) || ep.ports[0]?.port || 80;
          } else if (ep.type === 'Pod') {
            resolvedIp = ep.clusterIP || ep.backingPods[0]?.ip || resolvedIp;
            resolvedPort = ep.ports[0]?.port || Number(ep.ports[0]?.targetPort) || 80;
          } else if (ep.clusterIP && ep.clusterIP !== 'None' && ep.clusterIP !== 'External') {
            resolvedIp = ep.clusterIP;
            resolvedPort = ep.ports[0]?.port || 80;
          } else if (ep.backingPods.length > 0) {
            resolvedIp = ep.backingPods[0].ip;
            resolvedPort = Number(ep.ports[0]?.targetPort) || ep.ports[0]?.port || 80;
          } else if (ep.externalIP) {
            resolvedIp = ep.externalIP;
            resolvedPort = ep.ports[0]?.port || 443;
          }

          if (!protocol) {
            if (resolvedPort === 443 || ep.ports[0]?.name?.includes('https')) {
              resolvedProto = 'HTTPS';
            } else if (resolvedPort === 80 || ep.ports[0]?.name?.includes('http')) {
              resolvedProto = 'HTTP';
            }
          }
        }
      } catch (err: any) {
        console.warn('[netflow/probe] Endpoint lookup error:', err.message);
      }
    }

    if (!resolvedIp || resolvedIp === 'None' || resolvedIp.toLowerCase() === 'pending' || resolvedIp === 'External') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cannot probe: Endpoint does not exist or has no active IP address.',
          probe: {
            targetEndpoint: `${resolvedIp || 'none'}:${resolvedPort || 0}`,
            targetIp: resolvedIp || 'None',
            targetPort: resolvedPort || 0,
            protocol: resolvedProto,
            reachable: false,
            latencyMs: 0,
            checkedAt: new Date().toISOString(),
            details: 'Target endpoint does not exist or has no allocated IP address.',
          },
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!resolvedPort || isNaN(resolvedPort)) {
      resolvedPort = 80;
    }

    // Execute active socket / HTTP probe
    const probeResult = await probeEndpoint(resolvedIp, resolvedPort, resolvedProto);

    // Cache probe result
    if (endpointId) {
      const clusterKey = scope === 'vcluster' && target ? target : 'cluster-wide';
      recordEndpointProbeResult(clusterKey, endpointId, probeResult);
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
