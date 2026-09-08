import type { APIRoute } from 'astro';
import { listStorageClasses } from '../../../lib/k8s-client';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const storageClasses = await listStorageClasses();
    return new Response(
      JSON.stringify({
        success: true,
        data: storageClasses,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to list storage classes',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
