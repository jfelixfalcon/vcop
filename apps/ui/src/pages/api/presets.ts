import type { APIRoute } from 'astro';
import { PRESETS } from '../../lib/presets';
import { getClusterBaselines } from '../../lib/cluster-baselines';
import { listStorageClasses } from '../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const [baselines, storageClasses] = await Promise.all([
      getClusterBaselines().catch(() => []),
      listStorageClasses().catch(() => []),
    ]);
    return new Response(JSON.stringify({
      success: true,
      presets: PRESETS,
      baselines,
      storageClasses,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({
      success: true,
      presets: PRESETS,
      storageClasses: [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
