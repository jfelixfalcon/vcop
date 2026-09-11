import type { APIRoute } from 'astro';
import { computeTextDiff } from '../../../../lib/catalog-vcs';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { oldText?: string; newText?: string };
    const diff = computeTextDiff(body.oldText || '', body.newText || '');
    return new Response(
      JSON.stringify({ success: true, data: { diff } }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to compute diff' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
