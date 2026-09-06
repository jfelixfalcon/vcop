import type { APIRoute } from 'astro';
import { validateBreakglass, createSessionToken, SESSION_COOKIE_NAME } from '../../../lib/auth';

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
      if (isFormData) {
        return redirect('/login?error=invalid_credentials');
      }
      return new Response(JSON.stringify({ success: false, error: 'Invalid username or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
