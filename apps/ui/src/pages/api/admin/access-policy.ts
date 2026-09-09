import type { APIRoute } from 'astro';
import { isUserAdmin } from '../../../lib/auth';
import {
  getAccessPolicy,
  saveAccessPolicy,
  getDefaultAccessPolicy,
  resolveRoleWithPolicy,
} from '../../../lib/access-policy';
import type { PlatformAccessPolicy } from '../../../lib/types';

export const prerender = false;

/**
 * GET /api/admin/access-policy
 * Retrieves the active platform access policy and role mappings.
 * Restricted to Administrators.
 */
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user || !isUserAdmin(user)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Administrator privileges required to inspect platform access policy.',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const policy = await getAccessPolicy();
    const defaults = getDefaultAccessPolicy();

    return new Response(
      JSON.stringify({
        success: true,
        data: policy,
        defaults,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Failed fetching access policy' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/admin/access-policy
 * Saves the platform access policy to Kubernetes ConfigMap vcop-access-policy.
 * Restricted to Administrators.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || !isUserAdmin(user)) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Administrator privileges required to modify platform access policy.',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const policy = body.policy as PlatformAccessPolicy;

    if (!policy || !policy.admin || !policy.developers || !policy.viewers) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid policy payload: admin, developers, and viewers role definitions required.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const saved = await saveAccessPolicy(policy);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Platform access policy successfully saved to cluster ConfigMap.',
        data: saved,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Failed saving access policy' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * PUT /api/admin/access-policy
 * Simulates role resolution for a hypothetical user/group combination.
 */
export const PUT: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || !isUserAdmin(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { email = '', username = '', groups = [] } = body;
    const policy = await getAccessPolicy();

    const result = resolveRoleWithPolicy(email, groups, username, policy);

    return new Response(
      JSON.stringify({
        success: true,
        simulated: {
          email,
          username,
          groups,
        },
        resolvedRole: result.role,
        reason: result.reason,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Failed simulating role resolution' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
