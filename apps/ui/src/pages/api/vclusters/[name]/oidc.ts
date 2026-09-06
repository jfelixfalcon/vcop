import type { APIRoute } from 'astro';
import { getVirtualCluster, updateVirtualClusterEndpointAndOidc } from '../../../../lib/k8s-client';
import { canUserManageCluster, canUserViewCluster } from '../../../../lib/auth';
import type { OidcConfig } from '../../../../lib/types';

export const GET: APIRoute = async ({ params, locals }) => {
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
      JSON.stringify({ success: false, error: 'Forbidden: You do not have permission to view this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      oidc: cluster.metadata?.oidc || {
        enabled: false,
        issuerUrl: '',
        clientId: '',
        usernameClaim: 'email',
        usernamePrefix: '',
        groupsClaim: 'groups',
        groupsPrefix: '',
        extraScopes: ['email', 'profile', 'groups'],
      },
      customEndpoint: cluster.metadata?.customEndpoint || '',
      defaultEndpoint: cluster.status.endpoint || '',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

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
      JSON.stringify({ success: false, error: 'Forbidden: You do not have permission to configure OIDC for this cluster.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    const enabled = Boolean(body.enabled);
    const issuerUrl = typeof body.issuerUrl === 'string' ? body.issuerUrl.trim() : '';
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const usernameClaim = typeof body.usernameClaim === 'string' && body.usernameClaim.trim() ? body.usernameClaim.trim() : 'email';
    const usernamePrefix = typeof body.usernamePrefix === 'string' ? body.usernamePrefix.trim() : '';
    const groupsClaim = typeof body.groupsClaim === 'string' && body.groupsClaim.trim() ? body.groupsClaim.trim() : 'groups';
    const groupsPrefix = typeof body.groupsPrefix === 'string' ? body.groupsPrefix.trim() : '';
    const caFile = typeof body.caFile === 'string' ? body.caFile.trim() : undefined;
    const caCertificate = typeof body.caCertificate === 'string' ? body.caCertificate.trim() : undefined;
    const caSecretName = typeof body.caSecretName === 'string' ? body.caSecretName.trim() : undefined;
    const caConfigMapName = typeof body.caConfigMapName === 'string' ? body.caConfigMapName.trim() : undefined;
    const customEndpoint = typeof body.customEndpoint === 'string' ? body.customEndpoint.trim() : undefined;

    let extraScopes: string[] = ['email', 'profile', 'groups'];
    if (Array.isArray(body.extraScopes) && body.extraScopes.length > 0) {
      extraScopes = body.extraScopes.map((s: string) => s.trim()).filter(Boolean);
    } else if (typeof body.extraScopes === 'string' && body.extraScopes.trim()) {
      extraScopes = body.extraScopes.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (enabled) {
      if (!issuerUrl) {
        return new Response(
          JSON.stringify({ success: false, error: 'OIDC Issuer URL is required when OIDC is enabled' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!issuerUrl.startsWith('https://') && !issuerUrl.startsWith('http://')) {
        return new Response(
          JSON.stringify({ success: false, error: 'OIDC Issuer URL must start with https:// (or http://)' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!clientId) {
        return new Response(
          JSON.stringify({ success: false, error: 'OIDC Client ID is required when OIDC is enabled' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const oidcConfig: OidcConfig = {
      enabled,
      issuerUrl,
      clientId,
      usernameClaim,
      usernamePrefix,
      groupsClaim,
      groupsPrefix,
      extraScopes,
      caFile: caFile || (caCertificate ? '/etc/ssl/custom-ca/ca.crt' : undefined),
      caCertificate,
      caSecretName,
      caConfigMapName,
      source: body.source || 'custom',
    };

    const updated = await updateVirtualClusterEndpointAndOidc(
      name,
      {
        oidc: oidcConfig,
        customEndpoint,
        customCaCert: caCertificate,
        customCaSecret: caSecretName,
        customCaConfigMap: caConfigMapName,
      },
      cluster.namespace
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: enabled ? 'OIDC configuration saved and control plane updated' : 'OIDC disabled on virtual cluster',
        cluster: updated,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to update OIDC configuration' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const PUT = POST;
