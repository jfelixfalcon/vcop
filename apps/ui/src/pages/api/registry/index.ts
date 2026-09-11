import type { APIRoute } from 'astro';
import { getOCIRegistryStatus, deleteOCIRepositoryTag } from '../../../lib/oci-registry';

export const GET: APIRoute = async () => {
  try {
    const status = await getOCIRegistryStatus();
    return new Response(JSON.stringify({ success: true, data: status }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to check OCI registry status' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const user = locals.user;
    if (user && user.role !== 'admin' && user.role !== 'developers' && user.role !== 'developer') {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Admin or Developer role required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { repo, digest, tag } = body;
    if (!repo || (!digest && !tag)) {
      return new Response(JSON.stringify({ success: false, error: 'Repository name and tag/digest are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await deleteOCIRepositoryTag(repo, digest || tag);
    return new Response(JSON.stringify({ success: true, message: `Successfully deleted ${repo}:${tag || digest}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to delete OCI artifact' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

