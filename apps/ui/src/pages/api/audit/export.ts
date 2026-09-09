import type { APIRoute } from 'astro';
import { exportAuditLogs } from '../../../lib/audit-logger';
import { isUserAdmin } from '../../../lib/auth';
import type { AuditCategory, AuditStatus } from '../../../lib/types';

export const GET: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: Authentication required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  const search = url.searchParams.get('search') || undefined;
  const category = (url.searchParams.get('category') as AuditCategory) || undefined;
  const status = (url.searchParams.get('status') as AuditStatus) || undefined;
  let username = url.searchParams.get('username') || undefined;
  const resourceType = url.searchParams.get('resourceType') || undefined;
  const resourceName = url.searchParams.get('resourceName') || undefined;

  const isAdmin = isUserAdmin(user);
  if (!isAdmin && user.role === 'viewer') {
    username = user.username;
  }

  try {
    const data = await exportAuditLogs(format, {
      search,
      category,
      status,
      username,
      resourceType,
      resourceName,
    });

    const filename = `vcop-audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`;
    const contentType = format === 'json' ? 'application/json' : 'text/csv; charset=utf-8';

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Export failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
