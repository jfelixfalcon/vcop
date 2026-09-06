import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { OIDC_CONFIG, OIDC_STATE_COOKIE_NAME, getOidcAuthorizationUrl } from '../../../lib/auth';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  if (!OIDC_CONFIG.enabled || !OIDC_CONFIG.issuerUrl) {
    return redirect('/login?error=oidc_not_configured');
  }

  const state = crypto.randomBytes(16).toString('hex');
  cookies.set(OIDC_STATE_COOKIE_NAME, state, {
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  });

  try {
    const authUrl = await getOidcAuthorizationUrl(url.origin, state);
    return redirect(authUrl);
  } catch (err: any) {
    console.error('Failed to generate OIDC authorization URL:', err);
    return redirect(`/login?error=${encodeURIComponent(err.message || 'oidc_initiation_failed')}`);
  }
};
