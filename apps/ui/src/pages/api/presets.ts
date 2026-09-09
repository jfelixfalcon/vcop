import type { APIRoute } from 'astro';
import { getSizingTiers } from '../../lib/sizing-tiers';
import { getClusterBaselines } from '../../lib/cluster-baselines';
import { listStorageClasses } from '../../lib/k8s-client';

export const GET: APIRoute = async () => {
  try {
    const [presets, baselines, storageClasses] = await Promise.all([
      getSizingTiers().catch(() => []),
      getClusterBaselines().catch(() => []),
      listStorageClasses().catch(() => []),
    ]);
    return new Response(JSON.stringify({
      success: true,
      presets,
      baselines,
      storageClasses,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    const presets = await getSizingTiers().catch(() => []);
    return new Response(JSON.stringify({
      success: true,
      presets,
      storageClasses: [],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
