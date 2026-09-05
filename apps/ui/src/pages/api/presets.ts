import type { APIRoute } from 'astro';
import { PRESETS } from '../../lib/k8s-client';

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({
    success: true,
    presets: PRESETS,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
