import type { APIRoute } from 'astro';
import {
  getImageRegistryConfig,
  saveImageRegistryConfig,
  getResolvedImages,
  rewriteImage,
  type ImageRegistryConfig,
} from '../../../lib/image-registry';

export const GET: APIRoute = async () => {
  try {
    const config = await getImageRegistryConfig();
    const images = getResolvedImages(config);
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          config,
          images,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to fetch registry config' }),
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
    const body = await request.json();

    // Check if this is a live dry-run test
    if (body.action === 'testRewrite') {
      const testImage = body.image || '';
      const rewritten = rewriteImage(
        testImage,
        body.targetRegistry,
        body.swapFrom,
        body.swapTo,
        body.flatten ?? true
      );
      return new Response(
        JSON.stringify({
          success: true,
          original: testImage,
          rewritten,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updatedConfig: Partial<ImageRegistryConfig> = {
      targetRegistry: body.targetRegistry,
      swapFrom: body.swapFrom,
      swapTo: body.swapTo,
      flatten: body.flatten ?? true,
      rules: body.rules || [],
    };

    const saved = await saveImageRegistryConfig(updatedConfig);
    const images = getResolvedImages(saved);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Image registry configuration applied successfully',
        data: {
          config: saved,
          images,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to save image registry config' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
