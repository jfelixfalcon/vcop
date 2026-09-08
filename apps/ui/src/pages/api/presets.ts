import type { APIRoute } from 'astro';
import { PRESETS } from '../../lib/presets';
import { getClusterBaselines } from '../../lib/cluster-baselines';

export const GET: APIRoute = async () => {
  try {
    const baselines = await getClusterBaselines();
    return new Response(JSON.stringify({
      success: true,
      presets: PRESETS,
      baselines,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({
      success: true,
      presets: PRESETS,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
