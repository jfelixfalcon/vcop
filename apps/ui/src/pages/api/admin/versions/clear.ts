import type { APIRoute } from 'astro';
import { clearVersionRegistry } from '../../../../lib/version-registry';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const updated = await clearVersionRegistry();
    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to clear version registry' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
