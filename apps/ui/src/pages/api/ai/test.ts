import type { APIRoute } from 'astro';
import { testRemoteAIConnection } from '../../../lib/ai-config';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const result = await testRemoteAIConnection({
      endpoint: body.endpoint,
      model: body.model,
      apiKey: body.apiKey,
      testLocal: body.testLocal,
    });

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        message: err.message || 'Unknown test error',
        error: err.message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
