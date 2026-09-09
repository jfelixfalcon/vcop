import type { APIRoute } from 'astro';
import { SESSION_COOKIE_NAME } from '../../../lib/auth';
import { recordAuditLog } from '../../../lib/audit-logger';

export const GET: APIRoute = async ({ cookies, redirect, locals, request }) => {
  const user = locals.user;
  if (user) {
    await recordAuditLog({
      action: 'LOGOUT',
      category: 'AUTH',
      resourceType: 'auth',
      resourceName: user.method,
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: 'SUCCESS',
      details: { method: user.method },
      request,
    });
  }

  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  return redirect('/login');
};

export const POST: APIRoute = async ({ cookies, locals, request }) => {
  const user = locals.user;
  if (user) {
    await recordAuditLog({
      action: 'LOGOUT',
      category: 'AUTH',
      resourceType: 'auth',
      resourceName: user.method,
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: 'SUCCESS',
      details: { method: user.method },
      request,
    });
  }

  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  return new Response(JSON.stringify({ success: true, message: 'Logged out' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

