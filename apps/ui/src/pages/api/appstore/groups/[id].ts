import type { APIRoute } from 'astro';
import { deleteAppGroup } from '../../../../lib/appstore';
import { canUserManageCluster } from '../../../../lib/auth';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required to manage App Store groups' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { id } = params;
  if (!id) {
    return new Response(JSON.stringify({ success: false, error: 'Group ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await deleteAppGroup(id);
    return new Response(
      JSON.stringify({ success: true, message: `Application group ${id} deleted` }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete group' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
