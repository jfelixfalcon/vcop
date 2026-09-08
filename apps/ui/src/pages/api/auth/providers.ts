import type { APIRoute } from 'astro';
import { getAuthConfig } from '../../../lib/auth';

export const GET: APIRoute = async () => {
  const config = await getAuthConfig();
  return new Response(JSON.stringify(config), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
