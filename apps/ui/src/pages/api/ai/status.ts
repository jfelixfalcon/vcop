import type { APIRoute } from 'astro';
import { checkAiServiceHealth } from '../../../lib/ai-engine';
import { getMetricsDbHealth } from '../../../lib/metrics-db';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const aiHealth = await checkAiServiceHealth();
    const dbHealth = await getMetricsDbHealth();

    return new Response(
      JSON.stringify({
        ai: aiHealth,
        metricsDb: dbHealth,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
