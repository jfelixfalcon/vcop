/**
 * OCI Distribution Spec v1.1 In-Cluster Registry Client & Management Engine
 * Connects to the embedded vcop-registry pod to inspect repositories, tags,
 * Helm charts, container images, and arbitrary OCI artifacts.
 */

export interface OCIRepositoryTag {
  tag: string;
  digest?: string;
  sizeBytes?: number;
  mediaType?: string;
  artifactType?: 'container' | 'helm-chart' | 'artifact';
  createdAt?: string;
  description?: string;
  title?: string;
  rawManifest?: any;
}

export interface OCIRepository {
  name: string;
  tags: OCIRepositoryTag[];
  artifactType: 'container' | 'helm-chart' | 'artifact' | 'mixed';
  latestTag?: string;
  description?: string;
  totalSize?: number;
}

export interface OCIRegistryStatus {
  online: boolean;
  endpoint: string;
  inClusterEndpoint: string;
  version: string;
  repositoriesCount: number;
  totalArtifactsCount: number;
  repositories: OCIRepository[];
  pushCommands: {
    helm: string;
    docker: string;
    oras: string;
  };
  lastChecked: string;
  error?: string;
}

const REGISTRY_HOST = process.env.OCI_REGISTRY_HOST || 'vcop-registry.vcop-system.svc';
const REGISTRY_PORT = process.env.OCI_REGISTRY_PORT || '5000';
const REGISTRY_EXTERNAL_HOST = process.env.OCI_REGISTRY_EXTERNAL_HOST || 'localhost:5000';

async function resolveActiveBaseUrl(): Promise<string> {
  const candidates = [
    `http://${REGISTRY_HOST}:${REGISTRY_PORT}`,
    'http://localhost:5000',
    'http://127.0.0.1:5000',
  ];

  for (const candidate of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(`${candidate}/v2/`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (res.status === 200 || res.status === 401) {
        return candidate;
      }
    } catch {}
  }
  return `http://${REGISTRY_HOST}:${REGISTRY_PORT}`;
}

/**
 * Checks connectivity and retrieves the catalog of repositories and artifacts from the OCI registry.
 */
export async function getOCIRegistryStatus(): Promise<OCIRegistryStatus> {
  const inClusterEndpoint = `${REGISTRY_HOST}:${REGISTRY_PORT}`;
  const externalEndpoint = REGISTRY_EXTERNAL_HOST;
  const baseUrl = await resolveActiveBaseUrl();
  const now = new Date().toISOString();

  const baseStatus: OCIRegistryStatus = {
    online: false,
    endpoint: externalEndpoint,
    inClusterEndpoint,
    version: 'OCI Distribution Spec v1.1',
    repositoriesCount: 0,
    totalArtifactsCount: 0,
    repositories: [],
    pushCommands: {
      helm: `helm package <chart-dir> && helm push <chart>-<version>.tgz oci://${externalEndpoint}/charts`,
      docker: `docker tag <image> ${externalEndpoint}/<repo>:<tag> && docker push ${externalEndpoint}/<repo>:<tag>`,
      oras: `oras push ${externalEndpoint}/artifacts/<name>:<tag> <file>`,
    },
    lastChecked: now,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    // 1. Verify /v2/ endpoint ping
    const pingRes = await fetch(`${baseUrl}/v2/`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).catch(() => null);

    clearTimeout(timeout);

    if (!pingRes || (pingRes.status !== 200 && pingRes.status !== 401)) {
      return {
        ...baseStatus,
        online: false,
        error: 'Registry endpoint not responding or pending startup',
      };
    }

    baseStatus.online = true;

    // 2. Query Catalog /v2/_catalog
    const catalogCtrl = new AbortController();
    const catTimeout = setTimeout(() => catalogCtrl.abort(), 4000);

    const catalogRes = await fetch(`${baseUrl}/v2/_catalog?n=100`, {
      signal: catalogCtrl.signal,
      headers: { Accept: 'application/json' },
    }).catch(() => null);

    clearTimeout(catTimeout);

    if (!catalogRes || !catalogRes.ok) {
      return {
        ...baseStatus,
        online: true,
      };
    }

    const catalogData = (await catalogRes.json()) as { repositories?: string[] };
    const repoNames = catalogData.repositories || [];
    baseStatus.repositoriesCount = repoNames.length;

    // 3. For each repository, inspect tags and artifact manifests
    const repositories: OCIRepository[] = [];
    let totalArtifacts = 0;

    for (const repo of repoNames.slice(0, 50)) {
      try {
        const tagRes = await fetch(`${baseUrl}/v2/${repo}/tags/list`, {
          headers: { Accept: 'application/json' },
        });

        if (tagRes.ok) {
          const tagData = (await tagRes.json()) as { name: string; tags: string[] | null };
          const tagsList = tagData.tags || [];
          totalArtifacts += tagsList.length;

          const repoTags: OCIRepositoryTag[] = [];
          let repoTotalSize = 0;
          let repoDesc = '';

          for (const tag of tagsList) {
            let digest: string | undefined;
            let sizeBytes: number | undefined;
            let mediaType: string | undefined;
            let artifactType: 'container' | 'helm-chart' | 'artifact' = repo.includes('chart') || repo.startsWith('helm/') ? 'helm-chart' : 'container';
            let createdAt: string | undefined;
            let description: string | undefined;
            let title: string | undefined;
            let rawManifest: any = undefined;

            try {
              const manifestRes = await fetch(`${baseUrl}/v2/${repo}/manifests/${tag}`, {
                headers: {
                  Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, */*',
                },
              });

              if (manifestRes.ok) {
                digest = manifestRes.headers.get('docker-content-digest') || undefined;
                mediaType = manifestRes.headers.get('content-type') || undefined;

                try {
                  rawManifest = await manifestRes.json();
                  const configMediaType = rawManifest?.config?.mediaType || '';
                  if (configMediaType.includes('helm') || repo.includes('chart')) {
                    artifactType = 'helm-chart';
                  } else if (configMediaType.includes('oras') || configMediaType.includes('artifact')) {
                    artifactType = 'artifact';
                  } else if (configMediaType.includes('image') || configMediaType.includes('docker')) {
                    artifactType = 'container';
                  }

                  const configSize = rawManifest?.config?.size || 0;
                  const layersSize = (rawManifest?.layers || []).reduce((acc: number, l: any) => acc + (l.size || 0), 0);
                  sizeBytes = configSize + layersSize;
                  repoTotalSize += sizeBytes;

                  const ann = rawManifest?.annotations || {};
                  createdAt = ann['org.opencontainers.image.created'] || ann['org.opencontainers.artifact.created'];
                  description = ann['org.opencontainers.image.description'] || ann['org.opencontainers.artifact.description'];
                  title = ann['org.opencontainers.image.title'] || ann['org.opencontainers.artifact.title'];
                  if (description && !repoDesc) {
                    repoDesc = description;
                  }
                } catch {}
              }
            } catch {}

            repoTags.push({
              tag,
              digest,
              sizeBytes,
              mediaType,
              artifactType,
              createdAt,
              description,
              title,
              rawManifest,
            });
          }

          const isHelm = repoTags.some((t) => t.artifactType === 'helm-chart') || repo.includes('chart');
          const isContainer = repoTags.some((t) => t.artifactType === 'container');
          const hasMultiple = (isHelm && isContainer);

          repositories.push({
            name: repo,
            tags: repoTags,
            artifactType: hasMultiple ? 'mixed' : isHelm ? 'helm-chart' : 'container',
            latestTag: tagsList[tagsList.length - 1],
            description: repoDesc || undefined,
            totalSize: repoTotalSize > 0 ? repoTotalSize : undefined,
          });
        }
      } catch {}
    }

    baseStatus.repositories = repositories;
    baseStatus.totalArtifactsCount = totalArtifacts;
    return baseStatus;
  } catch (err: any) {
    return {
      ...baseStatus,
      online: false,
      error: err.message || 'Error querying OCI registry',
    };
  }
}

/**
 * Deletes a tag or manifest from the OCI registry.
 */
export async function deleteOCIRepositoryTag(repo: string, digestOrTag: string): Promise<{ success: boolean; message?: string }> {
  const baseUrl = await resolveActiveBaseUrl();
  let digest = digestOrTag;

  // If not a digest (sha256:...), query HEAD to obtain Docker-Content-Digest header
  if (!digest.startsWith('sha256:')) {
    try {
      const headRes = await fetch(`${baseUrl}/v2/${repo}/manifests/${digestOrTag}`, {
        method: 'HEAD',
        headers: {
          Accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, */*',
        },
      });
      const resolved = headRes.headers.get('docker-content-digest');
      if (resolved) {
        digest = resolved;
      }
    } catch {}
  }

  const deleteRes = await fetch(`${baseUrl}/v2/${repo}/manifests/${digest}`, {
    method: 'DELETE',
  });

  if (deleteRes.status === 202 || deleteRes.status === 200 || deleteRes.status === 204) {
    return { success: true };
  }

  const errText = await deleteRes.text().catch(() => '');
  throw new Error(`Failed to delete manifest (${deleteRes.status}): ${errText || 'Delete rejected by registry'}`);
}
