import type { APIRoute } from 'astro';
import { listFleetBackups } from '../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const backups = await listFleetBackups();
    return new Response(
      JSON.stringify({
        success: true,
        data: backups,
        count: backups.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to list fleet backups' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
