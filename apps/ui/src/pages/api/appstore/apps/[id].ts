import type { APIRoute } from 'astro';
import { deleteAppDefinition } from '../../../../lib/appstore';
import { canUserManageCluster } from '../../../../lib/auth';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required to manage App Store' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ success: false, error: 'App ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await deleteAppDefinition(id);
    return new Response(
      JSON.stringify({ success: true, message: `Application ${id} deleted from App Store catalog` }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete application' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
