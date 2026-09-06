import type { APIRoute } from 'astro';
import {
  getOidcRegistry,
  saveGlobalOidcProfile,
  saveGroupOidcProfile,
  deleteGroupOidcProfile,
} from '../../../../lib/oidc-registry';
import { listVirtualClusters } from '../../../../lib/k8s-client';
import type { OidcProfile } from '../../../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const registry = await getOidcRegistry();
    const clusters = await listVirtualClusters();

    // Compute cluster counts and inheritance stats
    const clusterStats = {
      total: clusters.length,
      globalCount: 0,
      groupCount: 0,
      customCount: 0,
      disabledCount: 0,
      clusters: clusters.map((c) => {
        const groups =
          c.metadata?.clusterGroups && c.metadata.clusterGroups.length > 0
            ? c.metadata.clusterGroups
            : c.metadata?.clusterGroup
            ? [c.metadata.clusterGroup]
            : [];

        const oidc = c.metadata?.oidc;
        const isEnabled = Boolean(oidc?.enabled);
        const source = c.metadata?.oidcInheritance || oidc?.source || (isEnabled ? 'custom' : 'global');
        const inheritedFrom = c.metadata?.oidcInheritedFrom || oidc?.inheritedFrom;

        if (!isEnabled) {
          // Count as disabled
        } else if (source === 'global') {
          // Count as global
        }

        return {
          name: c.name,
          namespace: c.namespace,
          groups,
          oidcEnabled: isEnabled,
          source,
          inheritedFrom,
          issuerUrl: oidc?.issuerUrl || '',
          clientId: oidc?.clientId || '',
        };
      }),
    };

    clusterStats.clusters.forEach((item) => {
      if (!item.oidcEnabled) {
        clusterStats.disabledCount++;
      } else if (item.source === 'global') {
        clusterStats.globalCount++;
      } else if (item.source === 'group') {
        clusterStats.groupCount++;
      } else {
        clusterStats.customCount++;
      }
    });

    return new Response(
      JSON.stringify({ success: true, data: registry, clusterStats }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to fetch OIDC registry' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

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
    const { scope, groupName, profile, apply } = body as {
      scope: 'global' | 'group';
      groupName?: string;
      profile: Partial<OidcProfile>;
      apply?: boolean;
    };

    if (scope === 'global') {
      const result = await saveGlobalOidcProfile(profile, Boolean(apply));
      return new Response(
        JSON.stringify({
          success: true,
          data: result.registry,
          appliedCount: result.appliedCount,
          message: apply
            ? `Global OIDC policy saved and applied to ${result.appliedCount} virtual clusters!`
            : 'Global OIDC policy saved successfully.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else if (scope === 'group') {
      if (!groupName || !groupName.trim()) {
        return new Response(
          JSON.stringify({ success: false, error: 'groupName is required for group OIDC scope' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const result = await saveGroupOidcProfile(groupName.trim(), profile, Boolean(apply));
      return new Response(
        JSON.stringify({
          success: true,
          data: result.registry,
          appliedCount: result.appliedCount,
          message: apply
            ? `OIDC profile for group "${groupName}" saved and applied to ${result.appliedCount} clusters!`
            : `OIDC profile for group "${groupName}" saved successfully.`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid scope; must be "global" or "group"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed saving OIDC configuration' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const DELETE: APIRoute = async ({ request, url, locals }) => {
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
    let groupName = url.searchParams.get('groupName');
    if (!groupName) {
      try {
        const body = await request.json();
        groupName = body.groupName;
      } catch {
        // ignore
      }
    }

    if (!groupName || !groupName.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'groupName is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = await deleteGroupOidcProfile(groupName.trim());
    return new Response(
      JSON.stringify({ success: true, data: updated }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed deleting group OIDC profile' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
