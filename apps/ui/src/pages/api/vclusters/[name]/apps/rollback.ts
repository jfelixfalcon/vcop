import type { APIRoute } from 'astro';
import { rollbackClusterApp } from '../../../../../lib/cluster-apps';
import { canUserManageCluster } from '../../../../../lib/auth';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const clusterName = params.name;
  const user = locals.user;

  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Insufficient privileges to rollback cluster applications' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!clusterName) {
    return new Response(
      JSON.stringify({ success: false, error: 'Cluster name is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = (await request.json()) as {
      appId: string;
      revisionId?: string;
      version?: string;
      customValues?: string;
      namespace?: string;
    };

    if (!body.appId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Application ID (appId) is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updatedApps = await rollbackClusterApp(
      clusterName,
      body.appId,
      body.revisionId,
      body.version,
      user,
      body.namespace,
      body.customValues
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully rolled back ${body.appId} in cluster ${clusterName}`,
        data: updatedApps,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Rollback failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
