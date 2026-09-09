import type { APIRoute } from 'astro';
import { getAuditStats } from '../../../lib/audit-logger';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: Authentication required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const stats = await getAuditStats();
    return new Response(
      JSON.stringify({ success: true, data: stats }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed fetching audit stats' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
