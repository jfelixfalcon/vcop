import type { APIRoute } from 'astro';
import { validateBreakglass, createSessionToken, SESSION_COOKIE_NAME } from '../../../lib/auth';
import { recordAuditLog } from '../../../lib/audit-logger';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  try {
    let username = '';
    let password = '';
    let isFormData = false;

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await request.json();
      username = body.username || '';
      password = body.password || '';
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      isFormData = true;
      const formData = await request.formData();
      username = (formData.get('username') as string) || '';
      password = (formData.get('password') as string) || '';
    }

    if (!username || !password) {
      await recordAuditLog({
        action: 'LOGIN_FAILED',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'local',
        username: username || 'anonymous',
        userRole: 'unknown',
        status: 'FAILURE',
        details: { reason: 'missing_credentials' },
        request,
      });

      if (isFormData) {
        return redirect('/login?error=missing_credentials');
      }
      return new Response(JSON.stringify({ success: false, error: 'Username and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const user = validateBreakglass(username, password);
    if (!user) {
      await recordAuditLog({
        action: 'LOGIN_FAILED',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'local',
        username,
        userRole: 'unknown',
        status: 'FAILURE',
        details: { reason: 'invalid_credentials' },
        request,
      });

      if (isFormData) {
        return redirect('/login?error=invalid_credentials');
      }
      return new Response(JSON.stringify({ success: false, error: 'Invalid username or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await recordAuditLog({
      action: 'LOGIN_SUCCESS',
      category: 'AUTH',
      resourceType: 'auth',
      resourceName: 'local',
      username: user.username,
      userRole: user.role,
      userId: user.id,
      status: 'SUCCESS',
      details: {
        method: user.method,
        email: user.email,
        role: user.role,
      },
      request,
    });

    const token = createSessionToken(user);
    cookies.set(SESSION_COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      secure: false, // Allows working seamlessly over HTTP behind local reverse proxy / port-forward
      sameSite: 'lax',
      maxAge: 86400, // 24 hours
    });

    if (isFormData) {
      return redirect('/');
    }

    return new Response(JSON.stringify({ success: true, user }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Login failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
