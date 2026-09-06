import type { APIRoute } from 'astro';
import { getVirtualCluster, updateVirtualClusterRBAC } from '../../../../lib/k8s-client';
import { canUserViewCluster, canUserManageCluster } from '../../../../lib/auth';

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
    return new Response(JSON.stringify({ success: false, error: 'Forbidden: View access required.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        owner: cluster.metadata?.owner || '',
        allowedGroups: cluster.metadata?.allowedGroups || [],
        allowedEmails: cluster.metadata?.allowedEmails || [],
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Administrator privileges required to update cluster RBAC delegation.',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { owner, allowedGroups, allowedEmails, namespace } = body;

    const updated = await updateVirtualClusterRBAC(
      name,
      {
        owner: typeof owner === 'string' ? owner : undefined,
        allowedGroups: Array.isArray(allowedGroups)
          ? allowedGroups
          : typeof allowedGroups === 'string'
          ? allowedGroups.split(',').map((s: string) => s.trim())
          : undefined,
        allowedEmails: Array.isArray(allowedEmails)
          ? allowedEmails
          : typeof allowedEmails === 'string'
          ? allowedEmails.split(',').map((s: string) => s.trim())
          : undefined,
      },
      namespace
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `RBAC access delegation for ${name} updated successfully`,
        data: updated,
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
