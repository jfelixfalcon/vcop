import type { APIRoute } from 'astro';
import { queryAuditLogs, recordAuditLog } from '../../../lib/audit-logger';
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
  const search = url.searchParams.get('search') || undefined;
  const category = (url.searchParams.get('category') as AuditCategory) || undefined;
  const status = (url.searchParams.get('status') as AuditStatus) || undefined;
  let username = url.searchParams.get('username') || undefined;
  const resourceType = url.searchParams.get('resourceType') || undefined;
  const resourceName = url.searchParams.get('resourceName') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  // If user is not an admin and not a developer, restrict query to their own activities
  const isAdmin = isUserAdmin(user);
  if (!isAdmin && user.role === 'viewer') {
    username = user.username;
  }

  try {
    const result = await queryAuditLogs({
      search,
      category,
      status,
      username,
      resourceType,
      resourceName,
      startDate,
      endDate,
      limit,
      offset,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: result.logs,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed fetching audit logs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: Authentication required.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    if (!body.action || !body.category || !body.resourceType) {
      return new Response(
        JSON.stringify({ success: false, error: 'action, category, and resourceType are required.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const event = await recordAuditLog({
      action: body.action,
      category: body.category,
      resourceType: body.resourceType,
      resourceName: body.resourceName,
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: body.status || 'SUCCESS',
      details: body.details,
      request,
    });

    return new Response(
      JSON.stringify({ success: true, data: event }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed recording audit log' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
