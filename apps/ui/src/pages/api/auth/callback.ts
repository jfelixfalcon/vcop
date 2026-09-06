import type { APIRoute } from 'astro';
import {
  SESSION_COOKIE_NAME,
  OIDC_STATE_COOKIE_NAME,
  exchangeOidcCode,
  createSessionToken,
} from '../../../lib/auth';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (error) {
    console.error('OIDC provider returned error:', error, errorDesc);
    return redirect(`/login?error=${encodeURIComponent(errorDesc || error)}`);
  }

  if (!code) {
    return redirect('/login?error=missing_authorization_code');
  }

  const savedState = cookies.get(OIDC_STATE_COOKIE_NAME)?.value;
  cookies.delete(OIDC_STATE_COOKIE_NAME, { path: '/' });

  if (!savedState || savedState !== state) {
    console.warn('OIDC state verification failed:', { savedState, receivedState: state });
    return redirect('/login?error=invalid_state');
  }

  try {
    const user = await exchangeOidcCode(code, url.origin);
    const sessionToken = createSessionToken(user);

    cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 86400, // 24 hours
    });

    return redirect('/');
  } catch (err: any) {
    console.error('OIDC code exchange failed:', err);
    return redirect(`/login?error=${encodeURIComponent(err.message || 'oidc_exchange_failed')}`);
  }
};
