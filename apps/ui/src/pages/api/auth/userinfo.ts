import type { APIRoute } from 'astro';
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  fetchOidcUserInfo,
  extractGroupsFromClaims,
  resolveOidcRole,
  resolveOidcRoleAsync,
  getEffectiveOidcConfig,
  authLog,
  type UserSession,
} from '../../../lib/auth';

export const prerender = false;

/**
 * GET /api/auth/userinfo
 * Queries the OIDC Identity Provider's UserInfo endpoint for the authenticated user,
 * extracts group memberships from the UserInfo response, dynamically updates the user's role,
 * and refreshes the session cookie.
 */
export const GET: APIRoute = async ({ locals, cookies }) => {
  const user = locals.user as UserSession | null;
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized: No active session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (user.method !== 'oidc' || !user.accessToken) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'no_access_token',
        message: 'No OIDC access token stored in session. Please authenticate via Enterprise SSO to query UserInfo.',
        user: {
          username: user.username,
          role: user.role,
          groups: user.groups,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const config = await getEffectiveOidcConfig();
    authLog(`Querying OIDC UserInfo for user ${user.username}...`);

    const userInfo = await fetchOidcUserInfo(user.accessToken, undefined, config.issuerUrl);
    if (!userInfo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'userinfo_empty',
          message: 'OIDC UserInfo endpoint returned no data or rejected the access token.',
          user,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Extract groups from UserInfo claims
    const userinfoGroups = extractGroupsFromClaims(userInfo, config.groupsClaim, config.clientId);

    // Merge and deduplicate with any existing groups
    const mergedGroups = Array.from(new Set([...user.groups, ...userinfoGroups]));

    // Re-resolve user role based on refreshed groups
    const { role: newRole } = await resolveOidcRoleAsync(user.email, mergedGroups, user.username);

    const updatedUser: UserSession = {
      ...user,
      groups: mergedGroups,
      role: newRole,
      name: userInfo.name || user.name,
    };

    // Update session cookie with new role and groups
    const newSessionToken = createSessionToken(updatedUser);
    cookies.set(SESSION_COOKIE_NAME, newSessionToken, {
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 86400, // 24 hours
    });

    authLog(`Refreshed user ${user.username} via UserInfo. Groups:`, mergedGroups, 'New Role:', newRole);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully queried OIDC UserInfo. Role updated to '${newRole}'.`,
        user: updatedUser,
        groups: mergedGroups,
        role: newRole,
        rawUserInfo: userInfo,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    console.error('[api/auth/userinfo] Exception querying UserInfo:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'userinfo_query_failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * POST /api/auth/userinfo
 * Allows direct testing or programmatic querying with an explicit access token in body.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  let bodyToken: string | undefined;
  try {
    const body = await request.json();
    bodyToken = body.access_token || body.accessToken;
  } catch {}

  const user = locals.user as UserSession | null;
  const accessToken = bodyToken || user?.accessToken;

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'missing_access_token',
        message: 'Provide an access_token in the JSON body or authenticate via OIDC.',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const config = await getEffectiveOidcConfig();
    const userInfo = await fetchOidcUserInfo(accessToken, undefined, config.issuerUrl);
    if (!userInfo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'userinfo_failed',
          message: 'Failed to retrieve UserInfo from OIDC provider.',
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const groups = extractGroupsFromClaims(userInfo, config.groupsClaim, config.clientId);
    const email = userInfo.email || user?.email || 'user@oidc.local';
    const { role } = await resolveOidcRoleAsync(email, groups, user?.username);

    if (user) {
      const mergedGroups = Array.from(new Set([...user.groups, ...groups]));
      const updatedUser: UserSession = {
        ...user,
        groups: mergedGroups,
        role,
        accessToken,
      };

      const newSessionToken = createSessionToken(updatedUser);
      cookies.set(SESSION_COOKIE_NAME, newSessionToken, {
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 86400,
      });

      return new Response(
        JSON.stringify({
          success: true,
          user: updatedUser,
          groups: mergedGroups,
          role,
          rawUserInfo: userInfo,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        groups,
        role,
        rawUserInfo: userInfo,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
