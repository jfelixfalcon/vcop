import type { APIRoute } from 'astro';
import {
  getImageRegistryConfig,
  getResolvedImages,
  generatePlainTextManifest,
  generateDockerSyncScript,
} from '../../../lib/image-registry';

export const GET: APIRoute = async ({ url }) => {
  try {
    const config = await getImageRegistryConfig();
    const format = url.searchParams.get('format') || 'json';
    const isDownload = url.searchParams.get('download') === 'true';

    if (format === 'txt') {
      const text = generatePlainTextManifest(config);
      const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8',
      };
      if (isDownload) {
        headers['Content-Disposition'] = 'attachment; filename="vcluster-images.txt"';
      }
      return new Response(text, { status: 200, headers });
    }

    if (format === 'sync') {
      const script = generateDockerSyncScript(config);
      const headers: Record<string, string> = {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
      };
      if (isDownload) {
        headers['Content-Disposition'] = 'attachment; filename="sync-vcluster-images.sh"';
      }
      return new Response(script, { status: 200, headers });
    }

    if (format === 'yaml') {
      const images = getResolvedImages(config);
      const yaml = [
        '# vCOp vCluster Images Manifest',
        'apiVersion: vops.gitops.io/v1alpha1',
        'kind: ImageManifest',
        'metadata:',
        '  name: vcop-vcluster-images',
        `  targetRegistry: "${config.targetRegistry || ''}"`,
        `  flatten: ${config.flatten}`,
        'spec:',
        '  images:',
        ...images.map(
          (img) => `    - component: "${img.component}"
      category: "${img.category}"
      role: "${img.role}"
      defaultImage: "${img.defaultImage}"
      resolvedImage: "${img.resolvedImage}"
      isRewritten: ${img.isRewritten}`
        ),
      ].join('\n');

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-yaml; charset=utf-8',
      };
      if (isDownload) {
        headers['Content-Disposition'] = 'attachment; filename="vcluster-images.yaml"';
      }
      return new Response(yaml, { status: 200, headers });
    }

    // Default: JSON
    const images = getResolvedImages(config);
    const data = {
      success: true,
      config,
      total: images.length,
      images,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (isDownload) {
      headers['Content-Disposition'] = 'attachment; filename="vcluster-images.json"';
    }

    return new Response(JSON.stringify(data, null, 2), { status: 200, headers });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Failed to retrieve image manifest' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
