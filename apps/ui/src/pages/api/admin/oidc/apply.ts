import type { APIRoute } from 'astro';
import { getOidcRegistry, applyOidcProfileToClusters } from '../../../../lib/oidc-registry';
import { listVirtualClusters } from '../../../../lib/k8s-client';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    const { target, groupName, clusterNames } = body as {
      target: 'fleet' | 'group' | 'custom';
      groupName?: string;
      clusterNames?: string[];
    };

    const registry = await getOidcRegistry();
    const allClusters = await listVirtualClusters();

    let targetClusters = allClusters;
    let targetProfile = registry.global;

    if (target === 'group') {
      if (!groupName) {
        return new Response(
          JSON.stringify({ success: false, error: 'groupName required for group target' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const groupProfile = registry.groups[groupName];
      if (!groupProfile) {
        return new Response(
          JSON.stringify({ success: false, error: `No OIDC profile found for group "${groupName}"` }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      targetProfile = groupProfile;
      targetClusters = allClusters.filter((c) => {
        const cGroups =
          c.metadata?.clusterGroups && c.metadata.clusterGroups.length > 0
            ? c.metadata.clusterGroups
            : c.metadata?.clusterGroup
            ? [c.metadata.clusterGroup]
            : [];
        return cGroups.includes(groupName);
      });
    } else if (target === 'custom' && Array.isArray(clusterNames)) {
      targetClusters = allClusters.filter((c) => clusterNames.includes(c.name));
    }

    const result = await applyOidcProfileToClusters(targetClusters, targetProfile);

    return new Response(
      JSON.stringify({
        success: true,
        updated: result.updated,
        failed: result.failed,
        errors: result.errors,
        message: `Applied ${targetProfile.name} to ${result.updated} virtual cluster(s)!`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed applying OIDC configuration' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
