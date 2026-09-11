import type { APIRoute } from 'astro';
import { importAirgapBundle } from '../../../lib/airgap-bundle';

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const contentType = request.headers.get('content-type') || '';
    let bundleBuffer: Buffer;
    let importApps = true;
    let importVCS = true;
    let importOCI = true;
    let importBaselines = true;
    let importSizing = true;
    let importVersions = true;
    let verificationKey: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('bundle') as File | null;
      if (!file) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing bundle file in form field "bundle"' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      importApps = formData.get('importApps') !== 'false';
      importVCS = formData.get('importVCS') !== 'false';
      importOCI = formData.get('importOCI') !== 'false';
      importBaselines = formData.get('importBaselines') !== 'false';
      importSizing = formData.get('importSizing') !== 'false';
      importVersions = formData.get('importVersions') !== 'false';
      verificationKey = (formData.get('verificationKey') as string) || undefined;

      const arrayBuffer = await file.arrayBuffer();
      bundleBuffer = Buffer.from(arrayBuffer);
    } else {
      const arrayBuffer = await request.arrayBuffer();
      bundleBuffer = Buffer.from(arrayBuffer);
      verificationKey = request.headers.get('x-vcop-verification-key') || undefined;
    }

    if (!bundleBuffer || bundleBuffer.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Empty bundle payload provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const report = await importAirgapBundle(
      bundleBuffer,
      {
        importApps,
        importVCS,
        importOCI,
        importBaselines,
        importSizing,
        importVersions,
        verificationKey,
      },
      user.name || user.username || 'admin',
      clientAddress
    );

    return new Response(
      JSON.stringify({ success: report.success, data: report }),
      { status: report.success ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[bundles/import] Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to import airgap bundle' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
