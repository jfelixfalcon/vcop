import type { APIRoute } from 'astro';
import { clearAppStoreCatalog } from '../../../lib/appstore';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const updated = await clearAppStoreCatalog();
    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to clear app catalog' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
