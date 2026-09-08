import type { APIRoute } from 'astro';
import YAML from 'yaml';
import { getAppStoreCatalog, importAppStoreCatalog } from '../../../lib/appstore';

export const GET: APIRoute = async () => {
  try {
    const catalog = await getAppStoreCatalog();
    const yamlString = YAML.stringify({
      appStore: {
        groups: catalog.groups,
        apps: catalog.apps,
      },
    });

    return new Response(yamlString, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-yaml',
        'Content-Disposition': 'attachment; filename="appstore-catalog.yaml"',
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to export app catalog' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Platform Administrator privileges required' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    let input: string | any;
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      input = body.manifest || body.yaml || body;
    } else {
      input = await request.text();
    }

    if (!input) {
      return new Response(
        JSON.stringify({ success: false, error: 'Manifest payload cannot be empty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = await importAppStoreCatalog(input);
    return new Response(JSON.stringify({ success: true, data: updated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to import app catalog' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
