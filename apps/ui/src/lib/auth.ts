import crypto from 'node:crypto';
import type { VirtualCluster } from './types';

export type UserRole = 'admin' | 'developers' | 'developer' | 'viewer';

export interface UserSession {
  id: string;
  username: string;
  email: string;
  name?: string;
  role: UserRole;
  groups: string[];
  method: 'breakglass' | 'oidc';
  accessToken?: string;
  idToken?: string;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = 'vcop_session';
export const OIDC_STATE_COOKIE_NAME = 'vcop_oidc_state';
export const OIDC_VERIFIER_COOKIE_NAME = 'vcop_oidc_verifier';

const SESSION_SECRET = process.env.SESSION_SECRET || 'vcop-super-secret-jwt-signing-key-2026';
const BREAKGLASS_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const BREAKGLASS_PASSWORD = process.env.ADMIN_PASSWORD || 'vcop-breakglass-admin';
const DEV_USERNAME = process.env.DEV_USERNAME || 'dev';
const DEV_PASSWORD = process.env.DEV_PASSWORD || 'dev123';
const VIEWER_USERNAME = process.env.VIEWER_USERNAME || 'viewer';
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || 'viewer123';

// Auto-allow custom CA / self-signed TLS certificates for internal cluster IdPs unless explicitly forbidden with '1'
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export const isAuthDebug =
  process.env.DEBUG === 'true' ||
  process.env.DEBUG === '1' ||
  process.env.AUTH_DEBUG === 'true' ||
  process.env.LOG_LEVEL === 'debug' ||
  process.env.NODE_ENV !== 'production';

export function authLog(message: string, ...args: any[]) {
  if (isAuthDebug) {
    console.log(`[AUTH-DEBUG ${new Date().toISOString()}] ${message}`, ...args);
  }
}

export const OIDC_CONFIG = {
  enabled: process.env.OIDC_ENABLED === 'true' || Boolean(process.env.OIDC_ISSUER_URL),
  issuerUrl: (process.env.OIDC_ISSUER_URL || '').replace(/\/$/, ''),
  userInfoUrl: (process.env.OIDC_USERINFO_URL || '').trim(),
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  redirectUri: process.env.OIDC_REDIRECT_URI || '',
  scopes: process.env.OIDC_SCOPES || 'openid email profile groups',
  providerName: process.env.OIDC_PROVIDER_NAME || 'Single Sign-On (OIDC)',
  groupsClaim: process.env.OIDC_GROUPS_CLAIM || 'groups',
  adminGroups: (process.env.OIDC_ADMIN_GROUPS || 'admins,vcluster-admins,platform-ops,default-roles-master')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  adminEmails: (process.env.OIDC_ADMIN_EMAILS || 'admin@vops.local,admin@example.com,dso@local')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

/**
 * Accurately determines the public origin of an incoming request, accounting for
 * reverse proxies, Ingress controllers, and TLS termination.
 */
export function getRequestOrigin(request: Request, url: URL): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host') || url.host;
  const proto = forwardedProto || (url.protocol ? url.protocol.replace(':', '') : 'http');
  return `${proto}://${host}`;
}

/**
 * Resolves effective OIDC configuration, checking environment variables first
 * and falling back to cluster ConfigMap/vcop-oidc-profiles if configured.
 */
export async function getEffectiveOidcConfig() {
  if (OIDC_CONFIG.enabled && OIDC_CONFIG.issuerUrl) {
    authLog('Effective OIDC config from ENV:', {
      issuerUrl: OIDC_CONFIG.issuerUrl,
      clientId: OIDC_CONFIG.clientId,
      hasSecret: Boolean(OIDC_CONFIG.clientSecret),
      redirectUri: OIDC_CONFIG.redirectUri,
      groupsClaim: OIDC_CONFIG.groupsClaim,
    });
    return OIDC_CONFIG;
  }

  try {
    const { getOidcRegistry } = await import('./oidc-registry');
    const reg = await getOidcRegistry();
    if (reg.global && reg.global.enabled && reg.global.issuerUrl) {
      const config = {
        enabled: true,
        issuerUrl: reg.global.issuerUrl,
        userInfoUrl: reg.global.userInfoUrl || OIDC_CONFIG.userInfoUrl || '',
        clientId: reg.global.clientId || 'vcop-ui',
        clientSecret: reg.global.clientSecret || OIDC_CONFIG.clientSecret || '',
        redirectUri: OIDC_CONFIG.redirectUri,
        scopes: reg.global.extraScopes?.length
          ? ['openid', ...reg.global.extraScopes].join(' ')
          : 'openid email profile groups',
        providerName: reg.global.name || 'Single Sign-On (OIDC)',
        adminGroups: OIDC_CONFIG.adminGroups,
        adminEmails: OIDC_CONFIG.adminEmails,
        groupsClaim: reg.global.groupsClaim || OIDC_CONFIG.groupsClaim || 'groups',
      };
      authLog('Effective OIDC config from ConfigMap:', {
        issuerUrl: config.issuerUrl,
        userInfoUrl: config.userInfoUrl,
        clientId: config.clientId,
        hasSecret: Boolean(config.clientSecret),
        redirectUri: config.redirectUri,
        groupsClaim: config.groupsClaim,
      });
      return config;
    }
  } catch (e) {
    authLog('ConfigMap fallback error:', e);
  }

  return OIDC_CONFIG;
}

/**
 * Creates a signed, base64url-encoded session token using HMAC-SHA256.
 */
export function createSessionToken(user: UserSession): string {
  const payload = Buffer.from(JSON.stringify(user)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Validates and decodes a signed session token.
 */
export function verifySessionToken(token: string): UserSession | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UserSession;
    if (Date.now() > data.expiresAt) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Validates local credentials (Breakglass Administrator or Developer Viewer).
 */
export function validateBreakglass(username: string, password: string): UserSession | null {
  const u = username.trim();
  const p = password.trim();

  // 1. Breakglass Super Admin
  if (u === BREAKGLASS_USERNAME && p === BREAKGLASS_PASSWORD) {
    return {
      id: 'breakglass-admin',
      username: BREAKGLASS_USERNAME,
      email: `${BREAKGLASS_USERNAME}@local`,
      name: 'Breakglass Admin',
      role: 'admin',
      groups: ['admin', 'system:masters'],
      method: 'breakglass',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }

  // 2. Developer User (test account)
  if ((u === DEV_USERNAME || u === 'developer' || u === 'developers') && p === DEV_PASSWORD) {
    return {
      id: 'dev-user',
      username: DEV_USERNAME,
      email: 'dev@vops.local',
      name: 'Developer User',
      role: 'developers',
      groups: ['developers'],
      method: 'breakglass',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }

  // 3. Viewer User (test account)
  if (u === VIEWER_USERNAME && p === VIEWER_PASSWORD) {
    return {
      id: 'viewer-user',
      username: VIEWER_USERNAME,
      email: 'viewer@vops.local',
      name: 'Viewer User',
      role: 'viewer',
      groups: ['viewers'],
      method: 'breakglass',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }

  return null;
}

/**
 * Strips LDAP distinguished name prefixes (e.g. "CN=developers,OU=Groups,DC=example,DC=com" -> "developers")
 * and normalizes Keycloak group paths (e.g. "/admins" -> "admins").
 */
export function cleanGroupName(g: string): string {
  let trimmed = g.trim();
  if (trimmed.toLowerCase().startsWith('cn=')) {
    const match = trimmed.match(/^cn=([^,]+)/i);
    if (match && match[1]) {
      trimmed = match[1].trim();
    }
  }
  return trimmed.replace(/^\/+|\/+$/g, '').trim();
}

/**
 * Extracts and consolidates all groups and roles across token claims, UserInfo payloads,
 * and IdP-specific structures (Keycloak realm/client roles, Cognito, Active Directory, Okta, Authentik, etc.).
 */
export function extractGroupsFromClaims(
  claims: any,
  configuredGroupsClaim?: string,
  clientId?: string
): string[] {
  if (!claims || typeof claims !== 'object') {
    return [];
  }

  const extracted = new Set<string>();

  const addGroupString = (str: string) => {
    const trimmed = str.trim();
    if (!trimmed) return;
    extracted.add(trimmed);

    // If LDAP CN= format, extract the CN value
    if (trimmed.toLowerCase().startsWith('cn=')) {
      const match = trimmed.match(/^cn=([^,]+)/i);
      if (match && match[1]) {
        addGroupString(match[1]);
      }
    }

    // Strip leading/trailing slashes (e.g. "/admins" -> "admins")
    const stripped = trimmed.replace(/^\/+|\/+$/g, '');
    if (stripped) {
      extracted.add(stripped);
      // If hierarchical path (e.g. "engineering/developers" or "/engineering/developers")
      if (stripped.includes('/')) {
        const parts = stripped.split('/').filter(Boolean);
        for (const p of parts) {
          const partTrimmed = p.trim();
          if (partTrimmed) extracted.add(partTrimmed);
        }
      }
    }
  };

  const addCandidate = (val: any) => {
    if (!val) return;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string') {
          addGroupString(item);
        } else if (typeof item === 'object' && item !== null) {
          if (typeof item.name === 'string') {
            addGroupString(item.name);
          } else if (typeof item.role === 'string') {
            addGroupString(item.role);
          } else if (typeof item.path === 'string') {
            addGroupString(item.path);
          }
        }
      }
    } else if (typeof val === 'string') {
      for (const part of val.split(',')) {
        addGroupString(part);
      }
    }
  };

  // 1. Configured custom groupsClaim (if provided in OidcProfile or env)
  if (configuredGroupsClaim && claims[configuredGroupsClaim] !== undefined) {
    addCandidate(claims[configuredGroupsClaim]);
  }

  // 2. Standard and vendor-specific claims
  addCandidate(claims.groups);
  addCandidate(claims.roles);
  addCandidate(claims['cognito:groups']);
  addCandidate(claims['roles_claim']);
  addCandidate(claims['memberOf']);
  addCandidate(claims.group);
  addCandidate(claims.user_groups);
  addCandidate(claims.groups_direct);
  addCandidate(claims.directoryRoles);
  addCandidate(claims.wids);
  addCandidate(claims.authorities);

  // 3. Keycloak realm_access.roles
  if (claims.realm_access?.roles) {
    addCandidate(claims.realm_access.roles);
  }

  // 4. Keycloak resource_access.<clientId>.roles and any other client roles
  if (claims.resource_access && typeof claims.resource_access === 'object') {
    if (clientId && claims.resource_access[clientId]?.roles) {
      addCandidate(claims.resource_access[clientId].roles);
    }
    for (const clientKey of Object.keys(claims.resource_access)) {
      if (claims.resource_access[clientKey]?.roles) {
        addCandidate(claims.resource_access[clientKey].roles);
      }
    }
  }

  return Array.from(extracted);
}

/**
 * Resolves whether an OIDC user is assigned Admin, Developers, or Viewer role based on email, username, or groups.
 * Consults the active PlatformAccessPolicy stored in Kubernetes ConfigMap.
 */
export function resolveOidcRole(email: string, groups: string[], username?: string): UserRole {
  try {
    const { resolveRoleWithPolicy } = require('./access-policy');
    const result = resolveRoleWithPolicy(email, groups, username);
    return result.role;
  } catch {
    // Fallback if access-policy module is not loaded yet
    const normEmail = email.toLowerCase().trim();
    const normGroups = groups.map((g) => g.toLowerCase().trim());
    if (OIDC_CONFIG.adminEmails.includes(normEmail)) return 'admin';
    for (const ag of OIDC_CONFIG.adminGroups) {
      if (normGroups.includes(ag)) return 'admin';
    }
    if (normGroups.some((g) => g === 'developers' || g === 'devs' || g === 'engineering')) return 'developers';
    return 'viewer';
  }
}

/**
 * Async version of resolveOidcRole that ensures the latest Kubernetes ConfigMap access policy is fetched.
 */
export async function resolveOidcRoleAsync(
  email: string,
  groups: string[],
  username?: string
): Promise<{ role: UserRole; reason: string }> {
  try {
    const { getAccessPolicy, resolveRoleWithPolicy } = await import('./access-policy');
    const policy = await getAccessPolicy();
    return resolveRoleWithPolicy(email, groups, username, policy);
  } catch (err) {
    authLog('Failed fetching access policy from ConfigMap, using fallback:', err);
    return { role: resolveOidcRole(email, groups, username), reason: 'Fallback to environment policy' };
  }
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  introspection_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  introspection_endpoint_auth_methods_supported?: string[];
}

let cachedDiscovery: { data: OidcDiscovery; timestamp: number } | null = null;

export async function getOidcDiscovery(customIssuerUrl?: string): Promise<OidcDiscovery> {
  const now = Date.now();
  const config = await getEffectiveOidcConfig();
  const rawIssuer = customIssuerUrl || config.issuerUrl || '';
  const issuer = rawIssuer.replace(/\/$/, '');

  if (cachedDiscovery && cachedDiscovery.data.issuer === issuer && now - cachedDiscovery.timestamp < 3600000) {
    return cachedDiscovery.data;
  }

  const configUrl = `${issuer}/.well-known/openid-configuration`;

  try {
    const res = await fetch(configUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = (await res.json()) as OidcDiscovery;
      cachedDiscovery = { data, timestamp: now };
      return data;
    }
  } catch (err) {
    console.warn(`OIDC discovery failed at ${configUrl}, falling back to standard endpoints:`, err);
  }

  // Fallback endpoints for Keycloak / Dex / standard OIDC providers
  return {
    issuer,
    authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
    token_endpoint: `${issuer}/protocol/openid-connect/token`,
    userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
    introspection_endpoint: `${issuer}/protocol/openid-connect/token/introspect`,
  };
}

/**
 * Generates the OIDC Authorization URL for redirecting the user to the IdP.
 * Supports standard RFC 7636 PKCE S256 code challenge and dynamically negotiates supported scopes.
 */
export async function getOidcAuthorizationUrl(
  origin: string,
  state: string,
  codeVerifier?: string
): Promise<string> {
  const config = await getEffectiveOidcConfig();
  const discovery = await getOidcDiscovery(config.issuerUrl);
  const redirectUri = config.redirectUri || `${origin}/api/auth/callback`;

  const requestedScopes = (config.scopes || 'openid email profile groups')
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!requestedScopes.includes('openid')) {
    requestedScopes.unshift('openid');
  }

  const finalScopes = requestedScopes;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: finalScopes.join(' '),
    state,
  });

  if (codeVerifier) {
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

/**
 * Queries the OAuth 2.0 Token Introspection endpoint (RFC 7662) using client_id and client_secret.
 * Reliably returns the full token claims, user groups, and realm/client roles from Keycloak, Okta, etc.
 */
export async function introspectOidcToken(
  accessToken: string,
  discovery?: OidcDiscovery,
  customIssuerUrl?: string
): Promise<any | null> {
  if (!accessToken || !accessToken.trim()) return null;

  try {
    const config = await getEffectiveOidcConfig();
    const issuer = (customIssuerUrl || config.issuerUrl || '').replace(/\/$/, '');
    const disc = discovery || (issuer ? await getOidcDiscovery(issuer) : null);
    let endpoint =
      disc?.introspection_endpoint ||
      `${issuer}/protocol/openid-connect/token/introspect`;

    if (endpoint && endpoint.startsWith('/') && issuer) {
      endpoint = `${issuer}${endpoint}`;
    }

    const clientId = config.clientId;
    const clientSecret = config.clientSecret;

    if (!endpoint || !clientId) {
      return null;
    }

    authLog(`Introspecting token with client credentials (${clientId}) at: ${endpoint}`);

    // Method 1: Client Secret Basic (Authorization: Basic base64(client_id:client_secret))
    if (clientSecret) {
      const basicCreds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const bodyParams = new URLSearchParams({
        token: accessToken.trim(),
        token_type_hint: 'access_token',
      });

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicCreds}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: bodyParams.toString(),
          signal: AbortSignal.timeout(7000),
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.active !== false) {
            authLog('Token introspection succeeded via client_secret_basic:', data);
            return data;
          }
        }
      } catch (e: any) {
        authLog('Basic auth introspection error:', e.message);
      }
    }

    // Method 2: Client Secret Post (client_id and client_secret in POST body)
    const postBody = new URLSearchParams({
      token: accessToken.trim(),
      client_id: clientId,
      token_type_hint: 'access_token',
    });
    if (clientSecret) {
      postBody.append('client_secret', clientSecret);
    }

    const postRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: postBody.toString(),
      signal: AbortSignal.timeout(7000),
    });

    if (postRes.ok) {
      const data = await postRes.json();
      if (data && data.active !== false) {
        authLog('Token introspection succeeded via client_secret_post:', data);
        return data;
      }
    }
  } catch (err: any) {
    authLog('Token introspection error:', err.message);
  }
  return null;
}

/**
 * Queries the OIDC Provider's UserInfo endpoint using the Access Token as a standard Bearer token (RFC 6750).
 * Also performs token introspection (RFC 7662) if client credentials are provided to reliably retrieve
 * all user groups, roles, and claims from Keycloak, Okta, Dex, etc.
 */
export async function fetchOidcUserInfo(
  accessToken: string,
  discovery?: OidcDiscovery,
  customIssuerUrl?: string
): Promise<any | null> {
  if (!accessToken || !accessToken.trim()) {
    return null;
  }

  try {
    const config = await getEffectiveOidcConfig();
    let issuer = (customIssuerUrl || config.issuerUrl || '').replace(/\/$/, '');
    let endpoint = config.userInfoUrl || discovery?.userinfo_endpoint;

    if (!endpoint && issuer) {
      const disc = await getOidcDiscovery(issuer);
      endpoint = disc.userinfo_endpoint;
    }

    if (!endpoint && issuer) {
      endpoint = `${issuer}/protocol/openid-connect/userinfo`;
    }

    if (endpoint && endpoint.startsWith('/') && issuer) {
      endpoint = `${issuer}${endpoint}`;
    }

    if (!endpoint) {
      authLog('OIDC UserInfo endpoint cannot be resolved');
      return null;
    }

    const clientId = config.clientId;
    const clientSecret = config.clientSecret;

    authLog(`Querying OIDC UserInfo endpoint: ${endpoint} (client: ${clientId || 'none'}, hasSecret: ${Boolean(clientSecret)})`);

    let userInfo: any = null;

    // Strategy 1: Standard RFC 6750 / OIDC Core 1.0 Section 5.3.1 GET request with Bearer token
    // Standard UserInfo endpoints (Keycloak, Dex, Okta, Google, Azure AD) require ONLY Bearer authorization.
    try {
      const resGet = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (resGet.ok) {
        userInfo = await resGet.json();
        authLog('UserInfo standard GET succeeded:', userInfo);
      } else {
        authLog(`UserInfo standard GET returned HTTP ${resGet.status}`);
      }
    } catch (e: any) {
      authLog('UserInfo standard GET error:', e.message);
    }

    // Strategy 2: Standard RFC 6750 POST request with Bearer token header
    if (!userInfo) {
      try {
        const resPostFallback = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken.trim()}`,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (resPostFallback.ok) {
          userInfo = await resPostFallback.json();
          authLog('UserInfo standard POST succeeded:', userInfo);
        } else {
          authLog(`UserInfo standard POST returned HTTP ${resPostFallback.status}`);
        }
      } catch (e: any) {
        authLog('UserInfo standard POST error:', e.message);
      }
    }

    // Strategy 3: Token Introspection (RFC 7662) with client credentials
    let introspectionData: any = null;
    if (clientId && clientSecret) {
      introspectionData = await introspectOidcToken(accessToken, discovery, customIssuerUrl);
    }

    if (!userInfo && !introspectionData) {
      return null;
    }

    const consolidated = {
      ...(introspectionData || {}),
      ...(userInfo || {}),
    };

    if (introspectionData) {
      const mergedGroups = new Set<any>([
        ...(Array.isArray(userInfo?.groups) ? userInfo.groups : []),
        ...(Array.isArray(introspectionData?.groups) ? introspectionData.groups : []),
      ]);
      if (mergedGroups.size > 0) {
        consolidated.groups = Array.from(mergedGroups);
      }

      const mergedRoles = new Set<any>([
        ...(Array.isArray(userInfo?.roles) ? userInfo.roles : []),
        ...(Array.isArray(introspectionData?.roles) ? introspectionData.roles : []),
      ]);
      if (mergedRoles.size > 0) {
        consolidated.roles = Array.from(mergedRoles);
      }

      if (introspectionData.realm_access || userInfo?.realm_access) {
        consolidated.realm_access = {
          ...(userInfo?.realm_access || {}),
          ...(introspectionData?.realm_access || {}),
          roles: Array.from(new Set([
            ...(userInfo?.realm_access?.roles || []),
            ...(introspectionData?.realm_access?.roles || []),
          ])),
        };
      }

      if (introspectionData.resource_access || userInfo?.resource_access) {
        consolidated.resource_access = {
          ...(userInfo?.resource_access || {}),
          ...(introspectionData?.resource_access || {}),
        };
      }
    }

    authLog('Consolidated UserInfo + Introspection claims:', consolidated);
    return consolidated;
  } catch (err: any) {
    console.warn('[AUTH-DEBUG] Failed to fetch OIDC UserInfo:', err.message);
    return null;
  }
}

/**
 * Directly authenticates a user from an OIDC token payload (id_token and/or access_token).
 * Extracts claims, queries UserInfo endpoint with access_token, and assigns roles.
 */
export async function authenticateFromTokens(
  tokenData: { id_token?: string; access_token?: string },
  discovery?: OidcDiscovery
): Promise<UserSession> {
  if (!tokenData.id_token && !tokenData.access_token) {
    throw new Error('OIDC provider returned neither id_token nor access_token');
  }

  const config = await getEffectiveOidcConfig();
  if (!discovery && config.issuerUrl) {
    discovery = await getOidcDiscovery(config.issuerUrl);
  }

  let claims: any = {};
  if (tokenData.id_token) {
    try {
      const payloadPart = tokenData.id_token.split('.')[1];
      claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch (e) {
      console.warn('Failed parsing OIDC id_token payload:', e);
    }
  }

  // If token is JWT access token, extract any additional claims
  if (tokenData.access_token) {
    try {
      const accessParts = tokenData.access_token.split('.');
      if (accessParts.length === 3) {
        const accessClaims = JSON.parse(Buffer.from(accessParts[1], 'base64url').toString('utf8'));
        claims = { ...accessClaims, ...claims };
      }
    } catch {
      // not a JWT, opaque token
    }
  }

  // ALWAYS query UserInfo endpoint when access_token is available to fetch authoritative groups & profile
  if (tokenData.access_token) {
    authLog('Access token present, querying OIDC provider UserInfo endpoint for user groups & profile...');
    const userInfo = await fetchOidcUserInfo(tokenData.access_token, discovery, config.issuerUrl);
    if (userInfo && typeof userInfo === 'object') {
      claims = { ...claims, ...userInfo };
      if (userInfo.realm_access) {
        claims.realm_access = { ...claims.realm_access, ...userInfo.realm_access };
      }
      if (userInfo.resource_access) {
        claims.resource_access = { ...claims.resource_access, ...userInfo.resource_access };
      }
    }
  }

  const email: string =
    claims.email || claims.upn || claims.preferred_username || claims.sub || 'user@oidc.local';
  const username: string =
    claims.preferred_username || claims.nickname || claims.name || email.split('@')[0] || 'oidc-user';
  const name: string = claims.name || username;

  // Extract groups and roles across all claims, UserInfo payloads, and token data
  const groups = extractGroupsFromClaims(claims, config.groupsClaim, config.clientId);

  const { role, reason } = await resolveOidcRoleAsync(email, groups, username);
  authLog(`Assigned role '${role}' to user '${username}' (${email}) [${reason}] with extracted groups:`, groups);

  return {
    id: claims.sub || `oidc-${username}`,
    username,
    email,
    name,
    role,
    groups,
    method: 'oidc',
    accessToken: tokenData.access_token,
    idToken: tokenData.id_token,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

/**
 * Handles the authorization code exchange and claims extraction from IdP.
 * Safely handles public clients (omits client_secret) and supports PKCE code_verifier.
 */
export async function exchangeOidcCode(
  code: string,
  origin: string,
  codeVerifier?: string
): Promise<UserSession> {
  const config = await getEffectiveOidcConfig();
  const discovery = await getOidcDiscovery(config.issuerUrl);
  const redirectUri = config.redirectUri || `${origin}/api/auth/callback`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  // RFC 6749 Section 2.3 strictly forbids using more than one authentication method in each request.
  // We use standard client_secret_post without Basic Auth header, or pure client_secret_basic if requested.
  if (config.clientSecret && config.clientSecret.trim().length > 0) {
    const secret = config.clientSecret.trim();
    const supportedMethods = discovery.token_endpoint_auth_methods_supported;
    if (supportedMethods && supportedMethods.includes('client_secret_basic') && !supportedMethods.includes('client_secret_post')) {
      const basicAuth = Buffer.from(`${config.clientId}:${secret}`).toString('base64');
      headers['Authorization'] = `Basic ${basicAuth}`;
      body.delete('client_id');
    } else {
      body.set('client_secret', secret);
    }
  }

  if (codeVerifier) {
    body.set('code_verifier', codeVerifier);
  }

  authLog(`Exchanging authorization code with token endpoint: ${discovery.token_endpoint}`, {
    clientId: config.clientId,
    redirectUri,
    hasVerifier: Boolean(codeVerifier),
    hasSecret: Boolean(config.clientSecret),
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[AUTH-DEBUG] OIDC Token exchange failed HTTP ${res.status} at ${discovery.token_endpoint}:`, errorText);
    throw new Error(`OIDC Token exchange failed (HTTP ${res.status}): ${errorText}`);
  }

  const tokenData = (await res.json()) as { access_token?: string; id_token?: string };
  authLog('OIDC Token exchange succeeded. Received tokens:', {
    has_access_token: Boolean(tokenData.access_token),
    has_id_token: Boolean(tokenData.id_token),
  });
  return authenticateFromTokens(tokenData, discovery);
}

/**
 * Evaluates whether a user is authorized to VIEW a specific virtual cluster.
 * - Administrators can view all virtual clusters across the entire fleet.
 * - Developers can view all clusters to deploy workloads and verify baselines.
 * - Viewers can ONLY view virtual clusters they are explicitly part of (as owner, via allowedEmails, via allowedGroups, or via team clusterGroup).
 */
export function canUserViewCluster(user: UserSession, cluster?: VirtualCluster): boolean {
  if (!cluster) {
    return false;
  }

  // 1. Administrators have fleet-wide global visibility
  if (user.role === 'admin') {
    return true;
  }

  // 2. Developers have fleet-wide workload visibility
  if (user.role === 'developers' || user.role === 'developer') {
    return true;
  }

  // 3. Viewers: strictly limited to clusters they are explicitly part of
  const normEmail = (user.email || '').toLowerCase().trim();
  const normUsername = (user.username || '').toLowerCase().trim();
  const userGroups = (user.groups || []).map((g) => g.toLowerCase().trim());

  const metadata = cluster.metadata || {};

  // Check direct owner match (email or username)
  const owner = (metadata.owner || '').toLowerCase().trim();
  if (owner && (owner === normEmail || owner === normUsername)) {
    return true;
  }

  // Check explicit allowedEmails
  const allowedEmails = (metadata.allowedEmails || []).map((e) => e.toLowerCase().trim());
  if (
    (normEmail && allowedEmails.includes(normEmail)) ||
    (normUsername && allowedEmails.includes(normUsername))
  ) {
    return true;
  }

  // Check explicit allowedGroups
  const allowedGroups = (metadata.allowedGroups || []).map((g) => g.toLowerCase().trim());
  if (allowedGroups.some((grp) => userGroups.includes(grp))) {
    return true;
  }

  // Check team clusterGroup or clusterGroups
  const clusterGroup = (metadata.clusterGroup || '').toLowerCase().trim();
  if (clusterGroup && userGroups.includes(clusterGroup)) {
    return true;
  }

  const clusterGroups = (metadata.clusterGroups || []).map((g) => g.toLowerCase().trim());
  if (clusterGroups.some((grp) => userGroups.includes(grp))) {
    return true;
  }

  // Viewer is not part of this cluster
  return false;
}

/**
 * Evaluates whether a user is authorized to retrieve the cluster kubeconfig.
 * Admins and Developers have full access; Viewers can only get kubeconfigs for clusters they are part of.
 */
export function canUserGetKubeconfig(user: UserSession, cluster?: VirtualCluster): boolean {
  if (user.role === 'admin' || user.role === 'developers' || user.role === 'developer') {
    return true;
  }
  return canUserViewCluster(user, cluster);
}

/**
 * Evaluates whether a user is authorized to MANAGE a virtual cluster.
 * Restricted to Admins and Developers. Viewers CANNOT modify resources, scale, sleep, wake, or delete clusters.
 */
export function canUserManageCluster(user: UserSession): boolean {
  return user.role === 'admin' || user.role === 'developers' || user.role === 'developer';
}

/**
 * Evaluates whether a user is authorized to CREATE new virtual clusters.
 * Restricted to Admins and Developers (developers deploy via baselines). Viewers CANNOT provision new clusters.
 */
export function canUserCreateCluster(user: UserSession): boolean {
  return user.role === 'admin' || user.role === 'developers' || user.role === 'developer';
}

/**
 * Evaluates whether a user is authorized to DELETE virtual clusters.
 * Strictly restricted to Admins. Developers CANNOT delete vclusters.
 */
export function canUserDeleteCluster(user: UserSession): boolean {
  return user.role === 'admin';
}

/**
 * Evaluates whether a user is authorized to deploy applications from the catalog.
 * Allowed for Admins and Developers. Viewers CANNOT deploy applications.
 */
export function canUserDeployApps(user: UserSession): boolean {
  return user.role === 'admin' || user.role === 'developers' || user.role === 'developer';
}

/**
 * Evaluates whether a user is an administrator.
 */
export function isUserAdmin(user: UserSession): boolean {
  return user.role === 'admin';
}

/**
 * Evaluates whether a user has the developer persona.
 */
export function isUserDeveloper(user: UserSession): boolean {
  return user.role === 'developers' || user.role === 'developer';
}

/**
 * Evaluates whether a user has the viewer persona.
 */
export function isUserViewer(user: UserSession): boolean {
  return user.role === 'viewer';
}

/**
 * Evaluates whether a user is authorized to manage admin settings (registries, OIDC, baselines, AI).
 * Strictly restricted to Admins.
 */
export function canUserManageAdminSettings(user: UserSession): boolean {
  return user.role === 'admin';
}

/**
 * Exposes provider configuration to frontend.
 */
export async function getAuthConfig() {
  const oidc = await getEffectiveOidcConfig();
  return {
    oidc: {
      enabled: oidc.enabled,
      providerName: oidc.providerName,
      redirectUri: oidc.redirectUri || '/api/auth/callback',
    },
    breakglass: {
      enabled: true,
      username: BREAKGLASS_USERNAME,
      hasDefaultCredentials: BREAKGLASS_USERNAME === 'admin' && BREAKGLASS_PASSWORD === 'vcop-breakglass-admin',
      demoDevUsername: DEV_USERNAME,
      demoViewerUsername: VIEWER_USERNAME,
    },
  };
}
