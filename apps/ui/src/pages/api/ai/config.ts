import type { APIRoute } from 'astro';
import { getPublicAISettings, saveAISettings } from '../../../lib/ai-config';
import type { AISettingsConfig } from '../../../lib/types';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const config = await getPublicAISettings();
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as Partial<AISettingsConfig>;

    const updated = await saveAISettings({
      localModelEnabled: body.localModelEnabled,
      provider: body.provider,
      remoteEndpoint: body.remoteEndpoint,
      remoteModel: body.remoteModel,
      remoteApiKey: body.remoteApiKey,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });

    const publicSettings = await getPublicAISettings();

    return new Response(
      JSON.stringify({
        success: true,
        settings: publicSettings,
        message: 'AI settings updated successfully',
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
