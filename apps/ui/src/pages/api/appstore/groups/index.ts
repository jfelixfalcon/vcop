import type { APIRoute } from 'astro';
import { saveAppGroup } from '../../../../lib/appstore';
import { canUserManageCluster } from '../../../../lib/auth';
import type { AppGroup } from '../../../../lib/types';

export const POST: APIRoute = async ({ request, locals }) => {
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

  try {
    const body = (await request.json()) as AppGroup;
    if (!body.name) {
      return new Response(
        JSON.stringify({ success: false, error: 'Group Name is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!body.id || !body.id.trim()) {
      body.id = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } else {
      body.id = body.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }
    body.appIds = Array.isArray(body.appIds) ? body.appIds : [];

    const author = user?.email || user?.username || 'Platform Operator';
    const commitMessage = (body as any).commitMessage;

    const catalog = await saveAppGroup(body, author, commitMessage);
    const saved = catalog.groups.find((g) => g.id === body.id);

    return new Response(JSON.stringify({ success: true, data: saved }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to save application group' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
