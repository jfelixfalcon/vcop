import type { APIRoute } from 'astro';
import { getAppStoreCatalog } from '../../../lib/appstore';
import { getClusterBaselines } from '../../../lib/cluster-baselines';
import { getSizingTiers } from '../../../lib/sizing-tiers';
import { getVersionRegistry } from '../../../lib/version-registry';
import { getOCIRegistryStatus } from '../../../lib/oci-registry';
import { generateBundleCycloneDXSBOM } from '../../../lib/cyclonedx';

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const user = locals.user;
    const download = url.searchParams.get('download') === 'true';

    const [catalog, baselines, sizingTiers, versionRegistry, ociStatus] = await Promise.all([
      getAppStoreCatalog(),
      getClusterBaselines(),
      getSizingTiers(),
      getVersionRegistry(),
      getOCIRegistryStatus(),
    ]);

    const sbom = generateBundleCycloneDXSBOM({
      bundleId: 'live-inventory',
      sourceInstance: 'vcop-host-cluster',
      catalog,
      ociRepositories: ociStatus.repositories || [],
      baselines,
      sizingTiers,
      versionRegistry,
      exporterUser: user?.username || 'admin',
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.cyclonedx+json; charset=utf-8',
    };

    if (download) {
      headers['Content-Disposition'] = 'attachment; filename="vcop-cyclonedx-sbom.json"';
    }

    return new Response(JSON.stringify(sbom, null, 2), {
      status: 200,
      headers,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to generate live CycloneDX SBOM' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
