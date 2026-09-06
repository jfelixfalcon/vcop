import type { APIRoute } from 'astro';
import { getAppStoreCatalog } from '../../../lib/appstore';

export const GET: APIRoute = async () => {
  try {
    const catalog = await getAppStoreCatalog();
    return new Response(JSON.stringify({ success: true, data: catalog }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to retrieve App Store catalog' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
