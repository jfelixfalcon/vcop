import type { APIRoute } from 'astro';
import { getVirtualCluster, updateVirtualClusterIstio } from '../../../../lib/k8s-client';
import { canUserManageCluster } from '../../../../lib/auth';

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
  if (user && !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: You do not have permission to modify this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    const enabled = Boolean(body.enabled);
    const meshEnabled = Boolean(body.meshEnabled);
    const certificateIssuer = typeof body.certificateIssuer === 'string' ? body.certificateIssuer.trim() : '';
    const certificateIssuerKind = body.certificateIssuerKind === 'Issuer' ? 'Issuer' : 'ClusterIssuer';
    const hosts = Array.isArray(body.hosts) ? body.hosts.filter((h: any) => typeof h === 'string' && h.trim()) : [];
    const hostRouting = body.hostRouting ? {
      enabled: Boolean(body.hostRouting.enabled),
      defaultGateway: typeof body.hostRouting.defaultGateway === 'string' ? body.hostRouting.defaultGateway.trim() : undefined,
      ingressGatewaySelector: body.hostRouting.ingressGatewaySelector && typeof body.hostRouting.ingressGatewaySelector === 'object'
        ? body.hostRouting.ingressGatewaySelector
        : undefined,
      apiHost: typeof body.hostRouting.apiHost === 'string' ? body.hostRouting.apiHost.trim() : undefined,
    } : undefined;

    const ingressGateway = body.ingressGateway ? {
      enabled: body.ingressGateway.enabled !== false,
      serviceType: typeof body.ingressGateway.serviceType === 'string' ? body.ingressGateway.serviceType : undefined,
      replicas: typeof body.ingressGateway.replicas === 'number' ? body.ingressGateway.replicas : undefined,
      selector: body.ingressGateway.selector && typeof body.ingressGateway.selector === 'object'
        ? body.ingressGateway.selector
        : undefined,
    } : undefined;

    const updated = await updateVirtualClusterIstio(
      name,
      {
        enabled,
        meshEnabled,
        certificateIssuer,
        certificateIssuerKind,
        hosts,
        ingressGateway,
        hostRouting,
      },
      cluster.namespace
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: enabled ? 'Opinionated Istio Ingress Entrypoint configured' : 'Istio Entrypoint disabled',
        cluster: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to update Istio configuration',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
