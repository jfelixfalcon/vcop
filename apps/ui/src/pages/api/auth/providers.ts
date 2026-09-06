import type { APIRoute } from 'astro';
import { getAuthConfig } from '../../../lib/auth';

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(getAuthConfig()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
