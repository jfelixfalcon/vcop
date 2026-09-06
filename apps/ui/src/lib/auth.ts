import crypto from 'node:crypto';
import type { VirtualCluster } from './types';

export type UserRole = 'admin' | 'viewer';

export interface UserSession {
  id: string;
  username: string;
  email: string;
  name?: string;
  role: UserRole;
  groups: string[];
  method: 'breakglass' | 'oidc';
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = 'vcop_session';
export const OIDC_STATE_COOKIE_NAME = 'vcop_oidc_state';

const SESSION_SECRET = process.env.SESSION_SECRET || 'vcop-super-secret-jwt-signing-key-2026';
const BREAKGLASS_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const BREAKGLASS_PASSWORD = process.env.ADMIN_PASSWORD || 'vcop-breakglass-admin';
const VIEWER_USERNAME = process.env.VIEWER_USERNAME || 'dev';
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || 'dev123';

export const OIDC_CONFIG = {
  enabled: process.env.OIDC_ENABLED === 'true' || Boolean(process.env.OIDC_ISSUER_URL),
  issuerUrl: process.env.OIDC_ISSUER_URL || '',
  clientId: process.env.OIDC_CLIENT_ID || '',
  clientSecret: process.env.OIDC_CLIENT_SECRET || '',
  redirectUri: process.env.OIDC_REDIRECT_URI || '',
  scopes: process.env.OIDC_SCOPES || 'openid email profile groups',
  providerName: process.env.OIDC_PROVIDER_NAME || 'Single Sign-On (OIDC)',
  adminGroups: (process.env.OIDC_ADMIN_GROUPS || 'admins,vcluster-admins,platform-ops')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  adminEmails: (process.env.OIDC_ADMIN_EMAILS || 'admin@vops.local,admin@example.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

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

  // 2. Developer Viewer (test account)
  if (u === VIEWER_USERNAME && p === VIEWER_PASSWORD) {
    return {
      id: 'viewer-dev',
      username: VIEWER_USERNAME,
      email: 'dev@vops.local',
      name: 'Dev User',
      role: 'viewer',
      groups: ['developers'],
      method: 'breakglass',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }

  return null;
}

/**
 * Resolves whether an OIDC user is assigned Admin or Viewer role based on email or groups.
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

  return 'viewer';
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

let cachedDiscovery: { data: OidcDiscovery; timestamp: number } | null = null;

async function getOidcDiscovery(): Promise<OidcDiscovery> {
  const now = Date.now();
  if (cachedDiscovery && now - cachedDiscovery.timestamp < 3600000) {
    return cachedDiscovery.data;
  }

  const issuer = OIDC_CONFIG.issuerUrl.replace(/\/$/, '');
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
 */
export async function getOidcAuthorizationUrl(origin: string, state: string): Promise<string> {
  const discovery = await getOidcDiscovery();
  const redirectUri = OIDC_CONFIG.redirectUri || `${origin}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: OIDC_CONFIG.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OIDC_CONFIG.scopes,
    state,
  });

  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

/**
 * Handles the authorization code exchange and claims extraction from IdP.
 */
export async function exchangeOidcCode(code: string, origin: string): Promise<UserSession> {
  const discovery = await getOidcDiscovery();
  const redirectUri = OIDC_CONFIG.redirectUri || `${origin}/api/auth/callback`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OIDC_CONFIG.clientId,
    client_secret: OIDC_CONFIG.clientSecret,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OIDC Token exchange failed (HTTP ${res.status}): ${errorText}`);
  }

  const tokenData = (await res.json()) as { access_token?: string; id_token?: string };
  if (!tokenData.id_token && !tokenData.access_token) {
    throw new Error('OIDC provider returned neither id_token nor access_token');
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

  // If userinfo endpoint exists and claims lack email or groups, fetch userinfo
  if (discovery.userinfo_endpoint && tokenData.access_token && (!claims.email || !claims.groups)) {
    try {
      const userinfoRes = await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (userinfoRes.ok) {
        const userInfo = (await userinfoRes.json()) as any;
        claims = { ...claims, ...userInfo };
      }
    } catch (e) {
      console.warn('Failed fetching OIDC userinfo:', e);
    }
  }

  const email: string =
    claims.email || claims.upn || claims.preferred_username || claims.sub || 'user@oidc.local';
  const username: string =
    claims.preferred_username || claims.nickname || claims.name || email.split('@')[0] || 'oidc-user';
  const name: string = claims.name || username;

  // Extract groups from common claim names
  let groups: string[] = [];
  const rawGroups =
    claims.groups ||
    claims.roles ||
    claims['cognito:groups'] ||
    claims['roles_claim'] ||
    claims['memberOf'] ||
    [];

  if (Array.isArray(rawGroups)) {
    groups = rawGroups.map(String);
  } else if (typeof rawGroups === 'string') {
    groups = rawGroups.split(',').map((s) => s.trim());
  }

  const role = resolveOidcRole(email, groups);

  return {
    id: claims.sub || `oidc-${username}`,
    username,
    email,
    name,
    role,
    groups,
    method: 'oidc',
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

/**
 * Evaluates whether a user is authorized to VIEW a specific virtual cluster.
 * Admins see all clusters.
 * Viewers see only clusters matching their email, username, or groups.
 */
export function canUserViewCluster(user: UserSession, cluster: VirtualCluster): boolean {
  if (user.role === 'admin') {
    return true;
  }

  const uEmail = user.email.toLowerCase().trim();
  const uName = user.username.toLowerCase().trim();
  const uEmailPrefix = uEmail.split('@')[0];
  const uGroups = user.groups.map((g) => g.toLowerCase().trim());

  const cOwner = (cluster.metadata?.owner || '').toLowerCase().trim();
  const cGroups = (cluster.metadata?.allowedGroups || []).map((g) => g.toLowerCase().trim());
  const cEmails = (cluster.metadata?.allowedEmails || []).map((e) => e.toLowerCase().trim());

  // 1. Direct owner match
  if (cOwner && (cOwner === uEmail || cOwner === uName || cOwner === uEmailPrefix)) {
    return true;
  }

  // 2. Allowed emails match
  if (cEmails.includes(uEmail) || cEmails.includes(uName) || cEmails.includes(uEmailPrefix)) {
    return true;
  }

  // 3. Allowed groups match
  for (const ug of uGroups) {
    if (cGroups.includes(ug)) {
      return true;
    }
  }

  // 4. Substring fallback for legacy/demo clusters like "Dev" matching "dev"
  if (cOwner && (cOwner.includes(uName) || uName.includes(cOwner))) {
    return true;
  }

  return false;
}

/**
 * Evaluates whether a user is authorized to MANAGE a virtual cluster.
 * Strictly restricted to Admins. Viewers CANNOT modify resources or delete clusters.
 */
export function canUserManageCluster(user: UserSession): boolean {
  return user.role === 'admin';
}

/**
 * Exposes provider configuration to frontend.
 */
export function getAuthConfig() {
  return {
    oidc: {
      enabled: OIDC_CONFIG.enabled,
      providerName: OIDC_CONFIG.providerName,
    },
    breakglass: {
      enabled: true,
      username: BREAKGLASS_USERNAME,
      hasDefaultCredentials: BREAKGLASS_USERNAME === 'admin' && BREAKGLASS_PASSWORD === 'vcop-breakglass-admin',
      demoViewerUsername: VIEWER_USERNAME,
    },
  };
}
