import type { APIRoute } from 'astro';
import { getInstalledApps, installAppsToCluster, syncClusterApps } from '../../../../../lib/cluster-apps';
import { getVirtualCluster } from '../../../../../lib/k8s-client';
import { canUserViewCluster, canUserManageCluster, canUserDeployApps } from '../../../../../lib/auth';

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
    return new Response(JSON.stringify({ success: false, error: 'Forbidden: View access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const apps = await getInstalledApps(name, cluster.namespace);
    return new Response(JSON.stringify({ success: true, data: apps }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to fetch installed apps' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
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

  if (!user || !canUserDeployApps(user)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Administrator or Developer privileges required to deploy applications.',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
  try {
    const body = await request.json();
    const { apps, namespace, action } = body;

    if (action === 'sync') {
      const synced = await syncClusterApps(name, namespace);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully synchronized applications on ${name}`,
          data: synced,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!apps || !Array.isArray(apps) || apps.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Array of apps to install is required: [{ appId, customValues }]' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const updatedApps = await installAppsToCluster(name, apps, user, namespace);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully installed ${apps.length} application(s) to ${name}`,
        data: updatedApps,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to install applications' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
