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
 * Strips LDAP distinguished name prefixes (e.g. "CN=developers,OU=Groups,DC=example,DC=com" -> "developers").
 */
export function cleanGroupName(g: string): string {
  const trimmed = g.trim();
  if (trimmed.toLowerCase().startsWith('cn=')) {
    const match = trimmed.match(/^cn=([^,]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return trimmed;
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

  const addCandidate = (val: any) => {
    if (!val) return;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) {
          const raw = item.trim();
          extracted.add(raw);
          const clean = cleanGroupName(raw);
          if (clean) extracted.add(clean);
        } else if (typeof item === 'object' && item !== null) {
          if (typeof item.name === 'string' && item.name.trim()) {
            extracted.add(item.name.trim());
          } else if (typeof item.role === 'string' && item.role.trim()) {
            extracted.add(item.role.trim());
          }
        }
      }
    } else if (typeof val === 'string' && val.trim()) {
      for (const part of val.split(',')) {
        const raw = part.trim();
        if (raw) {
          extracted.add(raw);
          const clean = cleanGroupName(raw);
          if (clean) extracted.add(clean);
        }
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
 * Resolves whether an OIDC user is assigned Admin, Developers, or Viewer role based on email or groups.
 */
export function resolveOidcRole(email: string, groups: string[]): UserRole {
  const normEmail = email.toLowerCase().trim();
  const normGroups = groups.map((g) => g.toLowerCase().trim());

  if (OIDC_CONFIG.adminEmails.includes(normEmail)) {
    return 'admin';
  }

  for (const adminGroup of OIDC_CONFIG.adminGroups) {
    if (normGroups.includes(adminGroup)) {
      return 'admin';
    }
  }

  // Also check if any group matches common administrator keywords
  if (
    normGroups.some(
      (g) =>
        g === 'admin' ||
        g === 'admins' ||
        g === 'administrator' ||
        g === 'administrators' ||
        g.endsWith('-admin') ||
        g.endsWith('-admins') ||
        g.startsWith('admin-')
    )
  ) {
    return 'admin';
  }

  // Check Developer groups (configurable via env OIDC_DEV_GROUPS)
  const devEnv = (process.env.OIDC_DEV_GROUPS || process.env.OIDC_DEVELOPER_GROUPS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const devGroups = [
    'developers',
    'devs',
    'developer',
    'engineering',
    'dev',
    'vcluster-developers',
    'platform-devs',
    'devops',
    ...devEnv,
  ];

  for (const dg of devGroups) {
    if (
      normGroups.includes(dg) ||
      normGroups.some((g) => g === dg || g.endsWith(`-${dg}`) || g.startsWith(`${dg}-`))
    ) {
      return 'developers';
    }
  }

  return 'viewer';
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
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

  const requestedScopes = (config.scopes || 'openid email profile')
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);

  let finalScopes = requestedScopes;
  if (discovery?.scopes_supported && Array.isArray(discovery.scopes_supported)) {
    finalScopes = requestedScopes.filter((s) => discovery.scopes_supported!.includes(s));
    if (!finalScopes.includes('openid')) {
      finalScopes.unshift('openid');
    }
  }

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
 * Queries the OIDC Provider's UserInfo endpoint using the Access Token.
 * Retrieves authoritative user profile attributes and group memberships.
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
    let endpoint = discovery?.userinfo_endpoint;
    let issuer = customIssuerUrl;

    if (!endpoint) {
      const config = await getEffectiveOidcConfig();
      issuer = issuer || config.issuerUrl;
      if (issuer) {
        const disc = await getOidcDiscovery(issuer);
        endpoint = disc.userinfo_endpoint;
      }
    }

    if (!endpoint && issuer) {
      const cleanIssuer = issuer.replace(/\/$/, '');
      endpoint = `${cleanIssuer}/protocol/openid-connect/userinfo`;
    }

    if (!endpoint) {
      authLog('OIDC UserInfo endpoint cannot be resolved');
      return null;
    }

    authLog(`Querying OIDC UserInfo endpoint: ${endpoint}`);

    // Attempt 1: Standard RFC 6749 / OIDC Core 5.3.1 GET request
    let res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(7000),
    });

    // Attempt 2: If IdP requires POST (RFC 6749 allows POST), retry
    if (!res.ok && (res.status === 405 || res.status === 400 || res.status === 401)) {
      authLog(`UserInfo GET returned HTTP ${res.status}, retrying with POST to ${endpoint}`);
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(7000),
      });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[AUTH-DEBUG] UserInfo request failed (HTTP ${res.status}) from ${endpoint}:`, errText);
      return null;
    }

    const userInfo = await res.json();
    authLog('OIDC UserInfo fetched successfully:', userInfo);
    return userInfo;
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

  const role = resolveOidcRole(email, groups);
  authLog(`Assigned role '${role}' to user '${username}' (${email}) with extracted groups:`, groups);

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
 * Admins, Developers, and Viewers can see all virtual clusters, telemetry, and metrics across the fleet.
 */
export function canUserViewCluster(user: UserSession, cluster?: VirtualCluster): boolean {
  if (user.role === 'admin' || user.role === 'viewer' || user.role === 'developers' || user.role === 'developer') {
    return true;
  }
  return false;
}

/**
 * Evaluates whether a user is authorized to retrieve the cluster kubeconfig.
 * Admins, Developers, and Viewers can connect and download kubeconfigs.
 */
export function canUserGetKubeconfig(user: UserSession, cluster?: VirtualCluster): boolean {
  return user.role === 'admin' || user.role === 'viewer' || user.role === 'developers' || user.role === 'developer';
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
