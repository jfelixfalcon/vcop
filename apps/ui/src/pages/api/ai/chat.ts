import type { APIRoute } from 'astro';
import { generateChatResponse, type ChatMessage } from '../../../lib/ai-engine';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const messages: ChatMessage[] = body.messages || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid or empty messages array' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await generateChatResponse(messages);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[api/ai/chat] Error generating chat response:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal AI engine error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
