import type { APIRoute } from 'astro';
import { uninstallAppFromCluster } from '../../../../../lib/cluster-apps';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster } from '../../../../../lib/auth';
import { recordAuditLog } from '../../../../../lib/audit-logger';

export const DELETE: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  const { name, appId } = params;
  if (!name || !appId) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name and App ID required' }), {
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

  if (user && !canUserViewCluster(user, cluster)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: You do not have permission to modify applications on this cluster.',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const remainingApps = await uninstallAppFromCluster(name, appId);

    if (user) {
      await recordAuditLog({
        action: 'CLUSTER_APP_UNINSTALL',
        category: 'APP',
        resourceType: 'virtualcluster',
        resourceName: name,
        username: user.username,
        userRole: user.role,
        userId: user.id,
        status: 'SUCCESS',
        details: { clusterName: name, uninstalledAppId: appId },
        request,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully uninstalled application ${appId} from ${name}`,
        data: remainingApps,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to uninstall application' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
