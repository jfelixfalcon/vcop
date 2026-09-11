import type { APIRoute } from 'astro';
import { getGroupRevisions, toggleGroupWorkingVersion } from '../../../../../lib/catalog-vcs';
import { rollbackAppGroup } from '../../../../../lib/appstore';
import { canUserManageCluster } from '../../../../../lib/auth';

export const GET: APIRoute = async ({ params }) => {
  const groupId = params.id;
  if (!groupId) {
    return new Response(JSON.stringify({ success: false, error: 'Group ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const revisions = await getGroupRevisions(groupId);
    return new Response(JSON.stringify({ success: true, data: { revisions } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Failed to get group revisions' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const groupId = params.id;
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!groupId) {
    return new Response(JSON.stringify({ success: false, error: 'Group ID is required' }), {
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
      const newCatalog = await rollbackAppGroup(groupId, body.revisionId, author);
      const restoredGroup = newCatalog.groups.find((g) => g.id === groupId);
      const revisions = await getGroupRevisions(groupId);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully rolled back group ${groupId} to revision ${body.revisionId}`,
          data: { group: restoredGroup, revisions },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else if (body.action === 'tag-working') {
      const isWorking = body.isWorking !== false;
      await toggleGroupWorkingVersion(groupId, body.revisionId, isWorking);
      const revisions = await getGroupRevisions(groupId);

      return new Response(
        JSON.stringify({
          success: true,
          message: isWorking ? 'Marked group version as known working' : 'Unmarked working version tag',
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
