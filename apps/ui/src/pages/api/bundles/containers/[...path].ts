import type { APIRoute } from 'astro';
import { resolveActiveBaseUrl } from '../../../../lib/oci-registry';
import { generateContainerCycloneDXSBOM } from '../../../../lib/cyclonedx';

export const GET: APIRoute = async ({ params, url }) => {
  try {
    const rawPath = params.path || '';
    // Format: repo/subrepo/.../tag
    const parts = rawPath.split('/');
    if (parts.length < 2) {
      return new Response(
        JSON.stringify({ success: false, error: 'Expected format: /api/bundles/containers/<repo>/<tag>' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tag = parts[parts.length - 1];
    const repo = parts.slice(0, -1).join('/');
    const download = url.searchParams.get('download') === 'true';

    const baseUrl = await resolveActiveBaseUrl();

    // 1. Fetch manifest from OCI registry
    const manifestRes = await fetch(`${baseUrl}/v2/${repo}/manifests/${tag}`, {
      headers: {
        Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, */*',
      },
    });

    if (!manifestRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Container artifact ${repo}:${tag} not found in registry (${manifestRes.status})` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const digest = manifestRes.headers.get('docker-content-digest') || '';
    const rawManifest = await manifestRes.json();

    // 2. Fetch config blob if present
    let configBlob: any = undefined;
    const configDigest = rawManifest?.config?.digest;
    if (configDigest) {
      try {
        const configRes = await fetch(`${baseUrl}/v2/${repo}/blobs/${configDigest}`);
        if (configRes.ok) {
          configBlob = await configRes.json();
        }
      } catch {}
    }

    // 3. Generate Dedicated Container CycloneDX SBOM
    const sbom = generateContainerCycloneDXSBOM(repo, tag, digest, rawManifest, configBlob);

    const safeRepo = repo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.cyclonedx+json; charset=utf-8',
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${safeRepo}-${tag}-cyclonedx.json"`;
    }

    return new Response(JSON.stringify(sbom, null, 2), {
      status: 200,
      headers,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to generate container CycloneDX report' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
