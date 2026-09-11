import type { APIRoute } from 'astro';
import { inspectAirgapBundle } from '../../../lib/airgap-bundle';

export const POST: APIRoute = async ({ request, locals }) => {
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

    const report = await inspectAirgapBundle(bundleBuffer, verificationKey);

    return new Response(
      JSON.stringify({ success: true, data: report }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('[bundles/inspect] Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to inspect bundle archive' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
