import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import {
  getEffectiveOidcConfig,
  OIDC_STATE_COOKIE_NAME,
  OIDC_VERIFIER_COOKIE_NAME,
  getRequestOrigin,
  getOidcAuthorizationUrl,
} from '../../../lib/auth';

export const GET: APIRoute = async ({ request, url, cookies, redirect }) => {
  const config = await getEffectiveOidcConfig();
  if (!config.enabled || !config.issuerUrl) {
    return redirect('/login?error=oidc_not_configured');
  }

  const origin = getRequestOrigin(request, url);
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  cookies.set(OIDC_STATE_COOKIE_NAME, state, {
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  });

  cookies.set(OIDC_VERIFIER_COOKIE_NAME, codeVerifier, {
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  });

  try {
    const authUrl = await getOidcAuthorizationUrl(origin, state, codeVerifier);
    console.log(`[OIDC] Initiating login redirect. Redirecting browser to: ${authUrl}`);
    return redirect(authUrl);
  } catch (err: any) {
    console.error('[OIDC] Failed to generate OIDC authorization URL:', err);
    return redirect(`/login?error=${encodeURIComponent(err.message || 'oidc_initiation_failed')}`);
  }
};
