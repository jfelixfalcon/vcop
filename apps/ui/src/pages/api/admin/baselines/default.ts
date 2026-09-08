import type { APIRoute } from 'astro';
import { setDefaultClusterBaseline } from '../../../../lib/cluster-baselines';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator role required.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Baseline "id" is required.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const updatedList = await setDefaultClusterBaseline(body.id);
    return new Response(JSON.stringify({ success: true, data: updatedList }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
