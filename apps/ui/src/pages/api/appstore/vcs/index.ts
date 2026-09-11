import type { APIRoute } from 'astro';
import { getCatalogVCSStore } from '../../../../lib/catalog-vcs';

export const GET: APIRoute = async () => {
  try {
    const store = await getCatalogVCSStore();
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          globalCommits: store.globalCommits,
          updatedAt: store.updatedAt,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to retrieve VCS commits' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
