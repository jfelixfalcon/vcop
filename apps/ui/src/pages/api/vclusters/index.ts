import type { APIRoute } from 'astro';
import { listVirtualClusters, createVirtualCluster } from '../../../lib/k8s-client';
import { canUserViewCluster, isUserAdmin, isUserDeveloper } from '../../../lib/auth';
import { getVersionRegistry, getMissingCoreComponents } from '../../../lib/version-registry';
import { recordAuditLog } from '../../../lib/audit-logger';

export const GET: APIRoute = async ({ locals }) => {
  try {
    const clusters = await listVirtualClusters();
    const user = locals.user;

    // RBAC Filtering: Viewers and developers only see clusters they have access to
    const visibleClusters =
      user && user.role !== 'admin'
        ? clusters.filter((c) => canUserViewCluster(user, c))
        : clusters;

    return new Response(JSON.stringify({ success: true, data: visibleClusters }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: Authentication required to provision virtual clusters.' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const isAdmin = isUserAdmin(user);
  const isDev = isUserDeveloper(user);

  if (!isAdmin && !isDev) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Insufficient privileges to provision virtual clusters.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    if (!body.clusterName) {
      return new Response(JSON.stringify({ success: false, error: 'clusterName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Guardrail: Verify core components exist in version registry before provisioning (only required for virtual clusters)
    const isNamespaced = body.clusterType === 'namespaced' || body.clusterType === 'host';
    if (!isNamespaced) {
      const registry = await getVersionRegistry();
      const missingCore = getMissingCoreComponents(registry);
      if (missingCore.length > 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Cannot deploy virtual cluster: Missing Version Registry for core component(s): ${missingCore.join(', ')}. An administrator must import a version registry manifest before clusters can be deployed.`,
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Strict guardrail for developers: must deploy using a predefined baseline
    if (isDev && !isAdmin) {
      if (!body.baselineId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Forbidden: Developers are strictly required to deploy clusters using predefined baselines.',
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Default owner to creating user if not specified
    if (!body.owner) {
      body.owner = user.email || user.username;
    }

    const cluster = await createVirtualCluster(body);

    await recordAuditLog({
      action: 'CLUSTER_CREATE',
      category: 'CLUSTER',
      resourceType: 'virtualcluster',
      resourceName: cluster.name,
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: 'SUCCESS',
      details: {
        clusterName: cluster.name,
        clusterType: body.clusterType || 'vcluster',
        namespace: cluster.namespace,
        baselineId: body.baselineId,
        preset: body.preset,
        environment: body.environment,
        appsCount: body.installedApps?.length || 0,
        owner: body.owner,
      },
      request,
    });

    return new Response(JSON.stringify({ success: true, data: cluster }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    await recordAuditLog({
      action: 'CLUSTER_CREATE_FAILED',
      category: 'CLUSTER',
      resourceType: 'virtualcluster',
      resourceName: 'unknown',
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: 'FAILURE',
      details: { error: error.message },
      request,
    });

    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

