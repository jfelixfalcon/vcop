import type { APIRoute } from 'astro';
import { saveAppDefinition } from '../../../../lib/appstore';
import { canUserManageCluster } from '../../../../lib/auth';
import type { AppDefinition } from '../../../../lib/types';

export const POST: APIRoute = async ({ request, locals }) => {
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

  try {
    const body = (await request.json()) as AppDefinition;
    if (!body.name || !body.category) {
      return new Response(
        JSON.stringify({ success: false, error: 'App Name and Category are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Auto-generate or sanitize ID
    if (!body.id || !body.id.trim()) {
      body.id = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } else {
      body.id = body.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }
    body.version = body.version || '1.0.0';

    const author = user?.email || user?.username || 'Platform Operator';
    const commitMessage = (body as any).commitMessage;

    const catalog = await saveAppDefinition(body, author, commitMessage);
    const saved = catalog.apps.find((a) => a.id === body.id);

    return new Response(JSON.stringify({ success: true, data: saved }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to save application definition' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
