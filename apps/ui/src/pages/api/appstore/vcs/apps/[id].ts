import type { APIRoute } from 'astro';
import { getAppRevisions, toggleAppWorkingVersion } from '../../../../../lib/catalog-vcs';
import { rollbackAppDefinition } from '../../../../../lib/appstore';
import { canUserManageCluster } from '../../../../../lib/auth';

export const GET: APIRoute = async ({ params }) => {
  const appId = params.id;
  if (!appId) {
    return new Response(JSON.stringify({ success: false, error: 'App ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const revisions = await getAppRevisions(appId);
    return new Response(JSON.stringify({ success: true, data: { revisions } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Failed to get revisions' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const appId = params.id;
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!appId) {
    return new Response(JSON.stringify({ success: false, error: 'App ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await request.json()) as {
      action: 'rollback' | 'tag-working';
      revisionId: string;
      isWorking?: boolean;
    };

    if (body.action === 'rollback') {
      const author = user.email || user.username || 'Platform Administrator';
      const newCatalog = await rollbackAppDefinition(appId, body.revisionId, author);
      const restoredApp = newCatalog.apps.find((a) => a.id === appId);
      const revisions = await getAppRevisions(appId);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully rolled back ${appId} to revision ${body.revisionId}`,
          data: { app: restoredApp, revisions },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else if (body.action === 'tag-working') {
      const isWorking = body.isWorking !== false;
      await toggleAppWorkingVersion(appId, body.revisionId, isWorking);
      const revisions = await getAppRevisions(appId);

      return new Response(
        JSON.stringify({
          success: true,
          message: isWorking ? 'Marked as known working release' : 'Unmarked working release tag',
          data: { revisions },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: false, error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Operation failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
