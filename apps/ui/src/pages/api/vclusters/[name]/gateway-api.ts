import type { APIRoute } from 'astro';
import { getVirtualCluster, updateVirtualClusterGatewayAPI } from '../../../../lib/k8s-client';
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
    const existingGW = cluster.spec?.components?.gatewayAPI || ({} as any);

    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : Boolean(existingGW.enabled);
    const gatewayClassName = typeof body.gatewayClassName === 'string' && body.gatewayClassName.trim()
      ? body.gatewayClassName.trim()
      : (existingGW.gatewayClassName || 'eg');

    const certificateIssuer = typeof body.certificateIssuer === 'string'
      ? body.certificateIssuer.trim()
      : (typeof existingGW.certificateIssuer === 'string' ? existingGW.certificateIssuer : '');
    const certificateIssuerKind = body.certificateIssuerKind === 'Issuer'
      ? 'Issuer'
      : (body.certificateIssuerKind === 'ClusterIssuer' ? 'ClusterIssuer' : (existingGW.certificateIssuerKind || 'ClusterIssuer'));
    const hosts = Array.isArray(body.hosts)
      ? body.hosts.filter((h: any) => typeof h === 'string' && h.trim())
      : (Array.isArray(existingGW.hosts) ? existingGW.hosts : []);

    let hostRouting = undefined;
    if (body.hostRouting !== undefined) {
      if (typeof body.hostRouting === 'boolean') {
        hostRouting = { enabled: body.hostRouting };
      } else if (body.hostRouting && typeof body.hostRouting === 'object') {
        hostRouting = {
          enabled: Boolean(body.hostRouting.enabled),
          defaultGateway: typeof body.hostRouting.defaultGateway === 'string' ? body.hostRouting.defaultGateway.trim() : undefined,
          ingressGatewaySelector: body.hostRouting.ingressGatewaySelector && typeof body.hostRouting.ingressGatewaySelector === 'object'
            ? body.hostRouting.ingressGatewaySelector
            : undefined,
          apiHost: typeof body.hostRouting.apiHost === 'string' ? body.hostRouting.apiHost.trim() : undefined,
        };
      }
    } else if (body.enableHostRouting !== undefined) {
      hostRouting = {
        enabled: Boolean(body.enableHostRouting),
        defaultGateway: typeof body.hostDefaultGateway === 'string' ? body.hostDefaultGateway.trim() : undefined,
        ingressGatewaySelector: body.hostGatewaySelector && typeof body.hostGatewaySelector === 'object' ? body.hostGatewaySelector : undefined,
        apiHost: typeof body.hostApiHost === 'string' ? body.hostApiHost.trim() : undefined,
      };
    } else if (existingGW.hostRouting) {
      hostRouting = existingGW.hostRouting;
    }

    let gatewayConfig = undefined;
    if (body.gatewayConfig !== undefined && typeof body.gatewayConfig === 'object') {
      gatewayConfig = {
        enabled: body.gatewayConfig.enabled !== false,
        serviceType: typeof body.gatewayConfig.serviceType === 'string' ? body.gatewayConfig.serviceType : undefined,
        replicas: typeof body.gatewayConfig.replicas === 'number' ? body.gatewayConfig.replicas : undefined,
        selector: body.gatewayConfig.selector && typeof body.gatewayConfig.selector === 'object'
          ? body.gatewayConfig.selector
          : undefined,
      };
    } else if (existingGW.gatewayConfig) {
      gatewayConfig = existingGW.gatewayConfig;
    }

    const version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : existingGW.version;
    const certSecretName = typeof body.certSecretName === 'string' && body.certSecretName.trim() ? body.certSecretName.trim() : existingGW.certSecretName;

    const updated = await updateVirtualClusterGatewayAPI(
      name,
      {
        enabled,
        gatewayClassName,
        certificateIssuer,
        certificateIssuerKind,
        hosts,
        version,
        certSecretName,
        gatewayConfig,
        hostRouting,
      },
      cluster.namespace
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: enabled ? 'Opinionated Gateway API entrypoint configured' : 'Gateway API entrypoint disabled',
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
        error: err.message || 'Failed to update Gateway API configuration',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
