import type { APIRoute } from 'astro';
import YAML from 'yaml';
import { getVersionRegistry, importVersionRegistry } from '../../../../lib/version-registry';
import { getAppStoreCatalog, importAppStoreCatalog } from '../../../../lib/appstore';

export const GET: APIRoute = async () => {
  try {
    const registry = await getVersionRegistry();
    const catalog = await getAppStoreCatalog();

    const yamlString = YAML.stringify({
      versionRegistry: {
        kubernetesVersions: registry.kubernetesVersions,
        vclusterVersions: registry.vclusterVersions,
        etcdVersions: registry.etcdVersions,
        coreDNSVersions: registry.coreDNSVersions,
        metricsServerVersions: registry.metricsServerVersions,
        istioVersions: registry.istioVersions,
      },
      appStore: {
        groups: catalog.groups,
        apps: catalog.apps,
      },
    });

    return new Response(yamlString, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': 'attachment; filename="platform-manifest.yaml"',
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to export platform manifest' }),
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
        JSON.stringify({ success: false, error: 'Platform manifest payload cannot be empty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let parsed: any = input;
    if (typeof input === 'string') {
      try {
        parsed = JSON.parse(input.trim());
      } catch {
        try {
          parsed = YAML.parse(input.trim());
        } catch (yamlErr: any) {
          throw new Error(`Failed to parse manifest: ${yamlErr.message}`);
        }
      }
    }

    let updatedVersions = null;
    let updatedCatalog = null;
    const imported = { versions: false, appStore: false };

    // Check if version registry is present in input
    const hasVersions =
      Boolean(parsed?.versionRegistry) ||
      Boolean(parsed?.versions) ||
      Boolean(parsed?.kubernetesVersions) ||
      (parsed?.kind === 'ConfigMap' && parsed?.metadata?.name === 'vcop-version-registry');

    // Check if app store is present in input
    const hasCatalog =
      Boolean(parsed?.appStore) ||
      Boolean(parsed?.appCatalog) ||
      Boolean(parsed?.catalog) ||
      Boolean(parsed?.apps) ||
      (parsed?.kind === 'ConfigMap' && parsed?.metadata?.name === 'vcop-appstore-catalog');

    if (hasVersions || (!hasVersions && !hasCatalog)) {
      try {
        updatedVersions = await importVersionRegistry(input);
        imported.versions = true;
      } catch (e: any) {
        if (!hasCatalog) throw e;
      }
    }

    if (hasCatalog || (!hasVersions && !hasCatalog)) {
      try {
        updatedCatalog = await importAppStoreCatalog(input);
        imported.appStore = true;
      } catch (e: any) {
        if (!hasVersions) throw e;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        versions: updatedVersions,
        catalog: updatedCatalog,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to import platform manifest' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
