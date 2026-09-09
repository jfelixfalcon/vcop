import type { APIRoute } from 'astro';
import {
  SESSION_COOKIE_NAME,
  OIDC_STATE_COOKIE_NAME,
  OIDC_VERIFIER_COOKIE_NAME,
  exchangeOidcCode,
  authenticateFromTokens,
  createSessionToken,
  getRequestOrigin,
  authLog,
  type UserSession,
} from '../../../lib/auth';
import { recordAuditLog } from '../../../lib/audit-logger';

/**
 * Universal OIDC Callback Handler
 * Supports:
 * - Authorization Code Flow (?code=...&state=...)
 * - PKCE code verification
 * - Direct Token Authentication (?access_token=... or ?id_token=...)
 * - HTTP POST (OIDC response_mode=form_post and JSON from client-side script)
 * - URL Hash Fragment Fallback (#access_token=... / #id_token=...) via interactive client-side handler
 */
async function handleCallback(context: {
  request: Request;
  url: URL;
  cookies: any;
  redirect: (path: string, status?: number) => Response;
  isPost: boolean;
}): Promise<Response> {
  const { request, url, cookies, redirect, isPost } = context;
  const origin = getRequestOrigin(request, url);

  let code: string | null = null;
  let state: string | null = null;
  let error: string | null = null;
  let errorDesc: string | null = null;
  let accessToken: string | null = null;
  let idToken: string | null = null;
  let isJsonRequest = false;

  // 1. Parse incoming parameters from URL query string
  code = url.searchParams.get('code');
  state = url.searchParams.get('state');
  error = url.searchParams.get('error');
  errorDesc = url.searchParams.get('error_description');
  accessToken = url.searchParams.get('access_token') || url.searchParams.get('token');
  idToken = url.searchParams.get('id_token');

  // 2. Parse incoming parameters from POST body (form_post or json)
  if (isPost) {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      isJsonRequest = true;
      try {
        const body = await request.json();
        code = body.code || code;
        state = body.state || state;
        error = body.error || error;
        errorDesc = body.error_description || errorDesc;
        accessToken = body.access_token || body.token || accessToken;
        idToken = body.id_token || idToken;
      } catch (e) {
        console.warn('Failed parsing JSON body in OIDC callback:', e);
      }
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      try {
        const formData = await request.formData();
        code = (formData.get('code') as string) || code;
        state = (formData.get('state') as string) || state;
        error = (formData.get('error') as string) || error;
        errorDesc = (formData.get('error_description') as string) || errorDesc;
        accessToken = (formData.get('access_token') as string) || (formData.get('token') as string) || accessToken;
        idToken = (formData.get('id_token') as string) || idToken;
      } catch (e) {
        console.warn('Failed parsing form data in OIDC callback:', e);
      }
    }
  }

  console.log(
    `[OIDC Callback] Incoming ${request.method} request (hasCode=${Boolean(code)}, hasState=${Boolean(state)}, hasAccessToken=${Boolean(accessToken)}, hasIdToken=${Boolean(idToken)})`
  );
  authLog('OIDC Callback request parsed:', {
    method: request.method,
    url: url.pathname + url.search,
    hasCode: Boolean(code),
    state,
    error,
    hasAccessToken: Boolean(accessToken),
    hasIdToken: Boolean(idToken),
  });

  if (error) {
    console.error('[AUTH-DEBUG] OIDC provider returned error:', error, errorDesc);
    const errMessage = errorDesc || error;
    if (isJsonRequest) {
      return new Response(JSON.stringify({ success: false, error: errMessage }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return redirect(`/login?error=${encodeURIComponent(errMessage)}`);
  }

  // 4. Handle Direct Token Authentication (Implicit Flow, Hybrid, or direct token grant)
  if (idToken || accessToken) {
    try {
      authLog('Authenticating directly from received tokens...');
      const user = await authenticateFromTokens({
        id_token: idToken || undefined,
        access_token: accessToken || undefined,
      });

      const sessionToken = createSessionToken(user);
      cookies.set(SESSION_COOKIE_NAME, sessionToken, {
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 86400, // 24 hours
      });

      await recordAuditLog({
        action: 'OIDC_LOGIN_SUCCESS',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'oidc-token',
        username: user.username,
        userRole: user.role,
        userId: user.id,
        status: 'SUCCESS',
        details: { method: 'oidc-token', email: user.email, groups: user.groups },
        request,
      });

      console.log(`[OIDC] Session cookie created (${SESSION_COOKIE_NAME}, length=${sessionToken.length} bytes). Redirecting authenticated browser session to /`);
      authLog('Direct token authentication succeeded. User:', user.username, 'Role:', user.role);

      if (isJsonRequest) {
        return new Response(JSON.stringify({ success: true, user, redirect: '/' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return redirect('/');
    } catch (err: any) {
      console.error('[AUTH-DEBUG] Direct token authentication failed:', err);
      await recordAuditLog({
        action: 'OIDC_LOGIN_FAILED',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'oidc-token',
        username: 'unknown',
        userRole: 'unknown',
        status: 'FAILURE',
        details: { error: err.message || 'token_authentication_failed' },
        request,
      });

      if (isJsonRequest) {
        return new Response(
          JSON.stringify({ success: false, error: err.message || 'token_authentication_failed' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return redirect(`/login?error=${encodeURIComponent(err.message || 'token_authentication_failed')}`);
    }
  }

  // 5. Handle Authorization Code Exchange (Standard Flow / PKCE)
  if (code) {
    const savedState = cookies.get(OIDC_STATE_COOKIE_NAME)?.value;
    cookies.delete(OIDC_STATE_COOKIE_NAME, { path: '/' });

    const codeVerifier = cookies.get(OIDC_VERIFIER_COOKIE_NAME)?.value;
    cookies.delete(OIDC_VERIFIER_COOKIE_NAME, { path: '/' });

    authLog('Authorization code received, verifying state & verifier:', {
      hasSavedState: Boolean(savedState),
      receivedState: state,
      stateMatched: !savedState || savedState === state,
      hasCodeVerifier: Boolean(codeVerifier),
    });

    // Validate state if previously generated
    if (savedState && state && savedState !== state) {
      console.warn('[AUTH-DEBUG] OIDC state verification failed:', { savedState, receivedState: state });
      await recordAuditLog({
        action: 'OIDC_LOGIN_FAILED',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'oidc-code',
        username: 'unknown',
        userRole: 'unknown',
        status: 'FAILURE',
        details: { error: 'invalid_state' },
        request,
      });

      if (isJsonRequest) {
        return new Response(JSON.stringify({ success: false, error: 'invalid_state' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return redirect('/login?error=invalid_state');
    }

    try {
      authLog('Invoking exchangeOidcCode with origin:', origin);
      const user = await exchangeOidcCode(code, origin, codeVerifier);
      authLog('OIDC exchange succeeded. Session user:', user.username, 'Role:', user.role);

      const sessionToken = createSessionToken(user);
      cookies.set(SESSION_COOKIE_NAME, sessionToken, {
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 86400, // 24 hours
      });

      await recordAuditLog({
        action: 'OIDC_LOGIN_SUCCESS',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'oidc-code',
        username: user.username,
        userRole: user.role,
        userId: user.id,
        status: 'SUCCESS',
        details: { method: 'oidc', email: user.email, groups: user.groups },
        request,
      });

      if (isJsonRequest) {
        return new Response(JSON.stringify({ success: true, user, redirect: '/' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`[OIDC] Session cookie created (${SESSION_COOKIE_NAME}, length=${sessionToken.length} bytes). Redirecting authenticated browser session to /`);
      return redirect('/');
    } catch (err: any) {
      console.error('[AUTH-DEBUG] OIDC code exchange failed:', err);
      await recordAuditLog({
        action: 'OIDC_LOGIN_FAILED',
        category: 'AUTH',
        resourceType: 'auth',
        resourceName: 'oidc-code',
        username: 'unknown',
        userRole: 'unknown',
        status: 'FAILURE',
        details: { error: err.message || 'oidc_exchange_failed' },
        request,
      });

      if (isJsonRequest) {
        return new Response(
          JSON.stringify({ success: false, error: err.message || 'oidc_exchange_failed' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return redirect(`/login?error=${encodeURIComponent(err.message || 'oidc_exchange_failed')}`);
    }
  }

  // 6. If request is POST with missing parameters, return 400
  if (isPost) {
    if (isJsonRequest) {
      return new Response(
        JSON.stringify({ success: false, error: 'missing_authorization_code_or_token' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return redirect('/login?error=missing_authorization_code');
  }

  // 7. On GET with no query parameters, render client-side hash fragment detector.
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authenticating - vCluster Operations Center</title>
</head>
<body style="background:#030712;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;max-width:420px;padding:32px 24px;border:1px solid #1e293b;border-radius:24px;background:#0f172a;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
    <div style="display:inline-block;width:36px;height:36px;border:3px solid #38bdf8;border-top-color:transparent;border-radius:50%;animation:spin 0.9s linear infinite;margin-bottom:16px;"></div>
    <h2 style="font-size:16px;font-weight:600;margin:0 0 8px 0;letter-spacing:-0.025em;">Authenticating with Operations Center</h2>
    <p style="color:#94a3b8;font-size:12px;margin:0;">Validating identity credentials & security tokens...</p>
  </div>
  <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
  <script>
    (async function() {
      const hash = window.location.hash ? window.location.hash.substring(1) : '';
      if (hash && hash.length > 1) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token') || params.get('token');
        const idToken = params.get('id_token');
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error') || params.get('error_description');

        if (error) {
          window.location.href = '/login?error=' + encodeURIComponent(error);
          return;
        }

        if (accessToken || idToken || code) {
          try {
            const res = await fetch('/api/auth/callback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ access_token: accessToken, id_token: idToken, code, state })
            });
            if (res.ok) {
              window.location.href = '/';
              return;
            }
            const data = await res.json().catch(() => ({}));
            window.location.href = '/login?error=' + encodeURIComponent(data.error || 'token_authentication_failed');
            return;
          } catch (e) {
            window.location.href = '/login?error=token_verification_failed';
            return;
          }
        }
      }

      window.location.href = '/login?error=missing_authorization_code';
    })();
  </script>
</body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

export const GET: APIRoute = async ({ request, url, cookies, redirect }) => {
  return handleCallback({ request, url, cookies, redirect, isPost: false });
};

export const POST: APIRoute = async ({ request, url, cookies, redirect }) => {
  return handleCallback({ request, url, cookies, redirect, isPost: true });
};
