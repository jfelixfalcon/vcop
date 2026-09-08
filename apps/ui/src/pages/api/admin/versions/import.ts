import type { APIRoute } from 'astro';
import YAML from 'yaml';
import { getVersionRegistry, importVersionRegistry } from '../../../../lib/version-registry';

export const GET: APIRoute = async () => {
  try {
    const registry = await getVersionRegistry();
    const yamlString = YAML.stringify({
      versionRegistry: {
        kubernetesVersions: registry.kubernetesVersions,
        vclusterVersions: registry.vclusterVersions,
        etcdVersions: registry.etcdVersions,
        coreDNSVersions: registry.coreDNSVersions,
        metricsServerVersions: registry.metricsServerVersions,
        istioVersions: registry.istioVersions,
      },
    });

    return new Response(yamlString, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': 'attachment; filename="version-registry.yaml"',
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to export version registry' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let input: string | any;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      input = body.manifest || body.yaml || body;
    } else {
      input = await request.text();
    }

    if (!input) {
      return new Response(
        JSON.stringify({ success: false, error: 'Manifest payload cannot be empty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = await importVersionRegistry(input);
    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to import version registry' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
