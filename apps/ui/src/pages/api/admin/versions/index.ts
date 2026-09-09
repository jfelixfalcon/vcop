import type { APIRoute } from 'astro';
import {
  getVersionRegistry,
  saveVersion,
  deleteVersion,
  setDefaultVersion,
  saveImagePattern,
} from '../../../../lib/version-registry';
import type { VersionItem } from '../../../../lib/types';

export const GET: APIRoute = async () => {
  try {
    const registry = await getVersionRegistry();
    return new Response(JSON.stringify({ success: true, data: registry }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to fetch version registry' }),
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
    const { action, type, item, version, pattern } = body as {
      action?: 'add' | 'update' | 'setDefault' | 'setImagePattern';
      type: 'k8s' | 'vcluster' | 'etcd' | 'coredns' | 'metricsServer' | 'istio';
      item?: VersionItem;
      version?: string;
      pattern?: string;
    };

    const validTypes = ['k8s', 'vcluster', 'etcd', 'coredns', 'metricsServer', 'istio'];
    if (!validTypes.includes(type)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid version type; must be one of: ${validTypes.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'setImagePattern') {
      const updated = await saveImagePattern(type, pattern || '');
      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'setDefault') {
      if (!version) {
        return new Response(
          JSON.stringify({ success: false, error: 'Target version is required to set default' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const updated = await setDefaultVersion(type, version);
      return new Response(JSON.stringify({ success: true, data: updated }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Add or update version item
    if (!item || !item.version || !item.version.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Version string is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = await saveVersion(type, item);
    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to update version registry' }),
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
    let type: any = url.searchParams.get('type');
    let version: string | null = url.searchParams.get('version');

    if (!type || !version) {
      try {
        const body = await request.json();
        type = type || body.type;
        version = version || body.version;
      } catch {
        // body was empty or not json
      }
    }

    const validTypes = ['k8s', 'vcluster', 'etcd', 'coredns', 'metricsServer', 'istio'];
    if (!validTypes.includes(type) || !version) {
      return new Response(
        JSON.stringify({ success: false, error: `Query or body must specify valid "type" (${validTypes.join(', ')}) and "version"` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = await deleteVersion(type, version);
    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete version from registry' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
