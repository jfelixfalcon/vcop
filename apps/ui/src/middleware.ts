import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE_NAME, verifySessionToken, authLog, isAuthDebug } from './lib/auth';
import { startMetricsDaemon } from './lib/metrics-collector';
import { recordAuditLog } from './lib/audit-logger';

// Start continuous background telemetry & metrics collection to PostgreSQL
startMetricsDaemon();

const PUBLIC_PATHS = [
  '/login',
  '/callback',
  '/auth/callback',
  '/api/auth/login',
  '/api/auth/oidc',
  '/api/auth/callback',
  '/api/auth/logout',
  '/api/auth/providers',
  '/api/metrics',
  '/api/health',
  '/api/presets',
  '/api/registry/images',
  '/api/cluster/capacity',
  '/api/cluster/storage-classes',
  '/api/cluster/namespaces',
  '/api/cert-manager/issuers',
  '/api/ai/status',
  '/api/ai/chat',
  '/api/ai/config',
  '/api/ai/test',
  '/healthz',
  '/docs',
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

  if (isAuthDebug) {
    authLog(`[Middleware] ${request.method} ${pathname} | hasSession: ${Boolean(user)} (cookie: ${Boolean(sessionCookie)}, len=${sessionCookie?.length || 0}) | user: ${user?.username || 'anonymous'} (role=${user?.role || 'none'}) | isPublic: ${isPublicPath}`);
  }

  // 3. Handle unauthenticated access
  if (!user) {
    if (isPublicPath) {
      return next();
    }

    if (pathname.startsWith('/api/')) {
      authLog(`[Middleware] Unauthorized API call to ${pathname}`);
      recordAuditLog({
        action: 'API_UNAUTHORIZED',
        category: 'SECURITY',
        resourceType: 'api',
        resourceName: pathname,
        username: 'anonymous',
        userRole: 'none',
        status: 'FAILURE',
        details: { path: pathname, method: request.method },
        request,
      });

      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized: Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Redirect browser to /login
    authLog(`[Middleware] Redirecting unauthenticated browser from ${pathname} to /login?redirect=${encodeURIComponent(pathname)}`);
    return context.redirect(`/login?redirect=${encodeURIComponent(pathname)}`);
  }

  // 4. Authenticated users hitting /login get redirected to home
  if (pathname === '/login') {
    return context.redirect('/');
  }

  // 5. RBAC Persona Guards
  const isAdmin = user.role === 'admin';
  const isDeveloper = user.role === 'developers' || user.role === 'developer';
  const isViewer = !isAdmin && !isDeveloper;

  // A. Provisioning Wizard (/new):
  // Admins and Developers can access /new. Viewers CANNOT!
  if (pathname === '/new' || pathname.startsWith('/new/')) {
    if (isViewer) {
      authLog(`[Middleware] Blocking viewer from accessing provisioning wizard ${pathname}`);
      recordAuditLog({
        action: 'ACCESS_DENIED',
        category: 'SECURITY',
        resourceType: 'ui_page',
        resourceName: pathname,
        username: user.username,
        userRole: user.role,
        userId: user.id,
        status: 'FAILURE',
        details: { path: pathname, reason: 'viewer_cannot_provision' },
        request,
      });
      return context.redirect('/?denied=admin_required');
    }
  }

  // B. Administration pages and APIs (/admin/*, /api/admin/*):
  // Version registry, OIDC policies, Baselines management, AI models are ADMIN ONLY.
  // Exception: Authenticated developers need to read baselines via GET /api/admin/baselines to render presets in /new.
  if (pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
    const isBaselinesRead = pathname === '/api/admin/baselines' && request.method.toUpperCase() === 'GET';
    if (!isAdmin && !isBaselinesRead) {
      authLog(`[Middleware] Blocking non-admin user (${user.username}, role=${user.role}) from admin route ${request.method} ${pathname}`);
      recordAuditLog({
        action: 'ACCESS_DENIED',
        category: 'SECURITY',
        resourceType: 'admin_route',
        resourceName: pathname,
        username: user.username,
        userRole: user.role,
        userId: user.id,
        status: 'FAILURE',
        details: { path: pathname, method: request.method, reason: 'admin_required' },
        request,
      });

      if (pathname.startsWith('/api/')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Forbidden: Administrator privileges required.',
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      return context.redirect('/?denied=admin_required');
    }
  }

  // C. AI model configuration mutations (/api/ai/config) and Registry mutations (/api/registry/config):
  // Strictly ADMIN ONLY.
  if (
    (pathname.startsWith('/api/ai/config') || pathname.startsWith('/api/registry/config')) &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())
  ) {
    if (!isAdmin) {
      authLog(`[Middleware] Blocking non-admin (${user.username}) from configuring AI/registry`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Administrator privileges required.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // D. AppStore catalog modifications:
  // POST/PUT/DELETE on /api/appstore/apps and /api/appstore/groups are ADMIN ONLY.
  if (pathname.startsWith('/api/appstore/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) {
    if (!isAdmin) {
      authLog(`[Middleware] Blocking non-admin (${user.username}) from modifying appstore catalog`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Administrator privileges required to manage App Store catalog.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // E. Cluster lifecycle and mutation guards:
  // Admins and Developers can create and mutate virtual clusters (quotas, RBAC, sleep/wake, apps, DR).
  // Viewers CANNOT perform any mutations (POST, PUT, PATCH, DELETE).
  const method = request.method.toUpperCase();

  // Cluster deletion (DELETE /api/vclusters/:name) is STRICTLY ADMIN ONLY!
  // Developers cannot delete virtual clusters under any circumstances.
  if (method === 'DELETE' && /^\/api\/vclusters\/[^/]+$/.test(pathname)) {
    if (!isAdmin) {
      authLog(`[Middleware] Blocking non-admin ${user.username} (role=${user.role}) from deleting cluster ${pathname}`);
      recordAuditLog({
        action: 'CLUSTER_DELETE_DENIED',
        category: 'SECURITY',
        resourceType: 'virtualcluster',
        resourceName: pathname,
        username: user.username,
        userRole: user.role,
        userId: user.id,
        status: 'FAILURE',
        details: { reason: 'developer_cannot_delete_vcluster', path: pathname },
        request,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Virtual cluster deletion is strictly reserved for Administrators. Developers cannot delete vclusters.',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (isViewer) {
      if (pathname.startsWith('/api/vclusters')) {
        authLog(`[Middleware] Blocking viewer ${user.username} from mutating ${method} ${pathname}`);
        recordAuditLog({
          action: 'MUTATION_DENIED',
          category: 'SECURITY',
          resourceType: 'virtualcluster',
          resourceName: pathname,
          username: user.username,
          userRole: user.role,
          userId: user.id,
          status: 'FAILURE',
          details: { reason: 'viewer_read_only', method, path: pathname },
          request,
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: 'Forbidden: Viewer persona has read-only access. Administrator or Developer privileges required.',
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
