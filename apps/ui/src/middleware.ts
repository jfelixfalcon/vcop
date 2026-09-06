import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE_NAME, verifySessionToken } from './lib/auth';
import { startMetricsDaemon } from './lib/metrics-collector';

// Start continuous background telemetry & metrics collection to PostgreSQL
startMetricsDaemon();

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/oidc',
  '/api/auth/callback',
  '/api/auth/logout',
  '/api/auth/providers',
  '/api/metrics',
  '/api/health',
  '/api/presets',
  '/healthz',
];

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, cookies, request } = context;
  const pathname = url.pathname;

  // 1. Always allow static assets and probe endpoints
  if (
    pathname.startsWith('/_astro') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(svg|png|jpg|jpeg|ico|css|js|woff2?)$/)
  ) {
    return next();
  }

  // 2. Extract and verify session
  const sessionCookie = cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = sessionCookie ? verifySessionToken(sessionCookie) : null;
  context.locals.user = user;

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // 3. Handle unauthenticated access
  if (!user) {
    if (isPublicPath) {
      return next();
    }

    if (pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Redirect browser to /login
    return context.redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
  }

  // 4. Authenticated users hitting /login get redirected to home
  if (pathname === '/login') {
    return context.redirect('/');
  }

  // 5. RBAC Guards for Viewers
  if (user.role !== 'admin') {
    // Block viewers from provisioning page
    if (pathname === '/new' || pathname.startsWith('/new/')) {
      return context.redirect('/?denied=admin_required');
    }

    // Block write operations on virtual clusters API (except apps endpoints which enforce cluster ownership)
    if (pathname.startsWith('/api/vclusters') && !pathname.includes('/apps')) {
      const method = request.method.toUpperCase();
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Forbidden: Administrator privileges required to modify or delete clusters.',
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }
  }

  return next();
});
