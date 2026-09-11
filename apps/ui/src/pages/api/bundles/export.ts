import type { APIRoute } from 'astro';
import { exportAirgapBundle } from '../../../lib/airgap-bundle';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let options: any = {};
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      options = await request.json().catch(() => ({}));
    }

    const { buffer, manifest, stats } = await exportAirgapBundle({
      includeApps: options.includeApps !== false,
      includeVCS: options.includeVCS !== false,
      includeOCI: options.includeOCI !== false,
      selectedOCIRepositories: options.selectedOCIRepositories,
      includeBaselines: options.includeBaselines !== false,
      includeSizing: options.includeSizing !== false,
      includeVersions: options.includeVersions !== false,
      signingSecret: options.signingSecret,
      exporterUser: user.name || user.username || 'admin',
      sourceInstance: options.sourceInstance || 'vcop-connected-instance',
    });

    const filename = `vcop-airgap-bundle-${manifest.bundleId}.tar.gz`;

    // Return the .tar.gz binary archive directly
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-VCOp-Bundle-Id': manifest.bundleId,
        'X-VCOp-Assets-Count': String(stats.assetsCount),
        'X-VCOp-Total-Size': String(stats.totalSizeBytes),
      },
    });
  } catch (err: any) {
    console.error('[bundles/export] Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to export airgap bundle' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
