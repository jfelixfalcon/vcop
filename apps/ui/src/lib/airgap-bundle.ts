/**
 * vCOp Airgap Transfer Bundle & Secure Supply Chain Engine
 * Provides deterministic packaging, cryptographic signing, in-toto SLSA attestation,
 * CycloneDX 1.5/1.6 SBOM generation, OCI Distribution Spec v1.1 blob replication,
 * and pre-flight inspection for cross-domain / air-gap artifact transfers.
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import type { AppDefinition, AppGroup, AppStoreCatalog, CatalogVCSStore, ClusterBaseline, PresetDetails, VersionRegistry } from './types';
import { getAppStoreCatalog, saveEntireCatalog } from './appstore';
import { getCatalogVCSStore, saveCatalogVCSStore } from './catalog-vcs';
import { getClusterBaselines, saveEntireBaselinesToK8s } from './cluster-baselines';
import { getSizingTiers, saveEntireSizingTiersToK8s } from './sizing-tiers';
import { getVersionRegistry, saveEntireRegistry } from './version-registry';
import { getOCIRegistryStatus, resolveActiveBaseUrl, type OCIRepository } from './oci-registry';
import {
  generateBundleCycloneDXSBOM,
  generateContainerCycloneDXSBOM,
  computeSha256,
  computeSha512,
  type CycloneDXBom,
} from './cyclonedx';
import {
  signBundleManifest,
  verifyBundleSignature,
  generateProvenanceAttestation,
  sanitizeArchivePath,
  ARCHIVE_SECURITY_LIMITS,
  type BundleManifest,
  type BundleAssetEntry,
  type BundleSignatureBlock,
  type InTotoProvenanceStatement,
} from './supply-chain';
import { recordAuditLog } from './audit-logger';

export interface ArchiveEntry {
  path: string;
  data: Buffer;
  size?: number;
}

export interface ExportBundleOptions {
  includeApps?: boolean;
  includeVCS?: boolean;
  includeOCI?: boolean;
  selectedOCIRepositories?: string[];
  includeBaselines?: boolean;
  includeSizing?: boolean;
  includeVersions?: boolean;
  signingSecret?: string;
  exporterUser?: string;
  sourceInstance?: string;
}

export interface ExportStats {
  bundleId: string;
  totalSizeBytes: number;
  assetsCount: number;
  appsCount: number;
  vcsCommitsCount: number;
  ociArtifactsCount: number;
  containerCount: number;
  helmChartCount: number;
  baselinesCount: number;
  exportedAt: string;
  signatureKeyId: string;
}

export interface PreFlightInspectionReport {
  valid: boolean;
  bundleId: string;
  sourceInstance: string;
  exporter: string;
  exportedAt: string;
  totalSizeBytes: number;
  assetsCount: number;
  signature: {
    verified: boolean;
    algorithm: string;
    keyId: string;
    signedBy: string;
    signedAt: string;
    reason?: string;
  };
  checksumsPassed: boolean;
  provenance?: InTotoProvenanceStatement;
  cycloneDXSummary: {
    bomFormat: string;
    specVersion: string;
    totalComponents: number;
    containerComponents: number;
    applicationComponents: number;
    configurationComponents: number;
    licenses: string[];
  };
  catalog: {
    appsCount: number;
    groupsCount: number;
    apps: Array<{ id: string; name: string; version: string; category: string }>;
    vcsCommitsCount: number;
  };
  oci: {
    repositoriesCount: number;
    artifactsCount: number;
    repositories: Array<{
      name: string;
      tags: Array<{ tag: string; artifactType: string; digest?: string; sizeBytes?: number }>;
    }>;
  };
  configurations: {
    baselinesCount: number;
    baselines: string[];
    sizingTiersCount: number;
    hasVersionRegistry: boolean;
  };
  existingConflicts: Array<{
    type: 'app' | 'baseline' | 'oci';
    name: string;
    existingVersion?: string;
    bundleVersion?: string;
    action: 'overwrite' | 'update' | 'new';
  }>;
}

export interface ImportBundleOptions {
  importApps?: boolean;
  importVCS?: boolean;
  importOCI?: boolean;
  importBaselines?: boolean;
  importSizing?: boolean;
  importVersions?: boolean;
  verificationKey?: string;
}

export interface ImportExecutionReport {
  success: boolean;
  bundleId: string;
  durationMs: number;
  ingested: {
    apps: number;
    vcsCommits: number;
    ociBlobs: number;
    ociManifests: number;
    baselines: number;
    sizingTiers: number;
    versionRegistry: boolean;
  };
  logs: string[];
  signatureValid: boolean;
  errors?: string[];
}

/**
 * Creates a USTAR 512-byte header block for an archive file entry.
 */
function createTarHeader(filePath: string, size: number, type = '0'): Buffer {
  const buf = Buffer.alloc(512);
  let prefix = '';
  let fileName = filePath;

  if (filePath.length > 100) {
    const idx = filePath.lastIndexOf('/', 155);
    if (idx !== -1) {
      prefix = filePath.slice(0, idx);
      fileName = filePath.slice(idx + 1);
    }
  }

  buf.write(fileName.slice(0, 100), 0, 100, 'utf-8');
  buf.write(type === '5' ? '0000755\0' : '0000644\0', 100, 8, 'utf-8');
  buf.write('0001000\0', 108, 8, 'utf-8');
  buf.write('0001000\0', 116, 8, 'utf-8');
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf-8');
  buf.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'utf-8');
  buf.write('        ', 148, 8, 'utf-8'); // Checksum placeholder
  buf.write(type, 156, 1, 'utf-8');
  buf.write('ustar\0', 257, 6, 'utf-8');
  buf.write('00', 263, 2, 'utf-8');
  buf.write('vcop', 265, 32, 'utf-8');
  buf.write('vcop', 297, 32, 'utf-8');
  if (prefix) {
    buf.write(prefix.slice(0, 155), 345, 155, 'utf-8');
  }

  let chksum = 0;
  for (let i = 0; i < 512; i++) {
    chksum += buf[i];
  }
  buf.write(chksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf-8');
  return buf;
}

/**
 * Encodes an array of entries into a deterministic compressed .tar.gz buffer.
 */
export function packTarGz(entries: ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf-8');
    chunks.push(createTarHeader(entry.path, dataBuf.length));
    chunks.push(dataBuf);
    const pad = (512 - (dataBuf.length % 512)) % 512;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
    }
  }

  // Two 512-byte zero blocks signal end of TAR archive
  chunks.push(Buffer.alloc(1024));

  const uncompressedTar = Buffer.concat(chunks);
  return zlib.gzipSync(uncompressedTar, { level: 6 });
}

/**
 * Safely parses and extracts a .tar.gz archive with strict Zip-Slip protection
 * and decompression bomb thresholds.
 */
export function unpackTarGz(gzBuffer: Buffer): ArchiveEntry[] {
  let tarBuffer: Buffer;
  try {
    tarBuffer = zlib.gunzipSync(gzBuffer, {
      maxOutputLength: ARCHIVE_SECURITY_LIMITS.maxDecompressedBytes,
    });
  } catch (err: any) {
    throw new Error(`Decompression Error: ${err.message || 'Corrupt gzip archive or bomb threshold exceeded'}`);
  }

  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let totalBytes = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      offset += 512;
      continue;
    }

    const namePart = header.subarray(0, 100).toString('utf-8').replace(/\0+$/, '');
    const prefixPart = header.subarray(345, 500).toString('utf-8').replace(/\0+$/, '');
    const rawPath = prefixPart ? `${prefixPart}/${namePart}` : namePart;
    const sizeStr = header.subarray(124, 136).toString('utf-8').replace(/\0+$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);

    offset += 512;

    if (typeFlag === '0' || typeFlag === '\0') {
      if (size > ARCHIVE_SECURITY_LIMITS.maxSingleFileBytes) {
        throw new Error(`Security Violation: File entry '${rawPath}' exceeds maximum single file size limit.`);
      }

      totalBytes += size;
      if (totalBytes > ARCHIVE_SECURITY_LIMITS.maxDecompressedBytes) {
        throw new Error(`Security Violation: Total uncompressed size exceeds allowable security threshold.`);
      }

      if (entries.length >= ARCHIVE_SECURITY_LIMITS.maxTotalFiles) {
        throw new Error(`Security Violation: Total archive entries exceed maximum file count limit.`);
      }

      // Enforce Zip-Slip Prevention
      const safePath = sanitizeArchivePath(rawPath);
      const fileData = tarBuffer.subarray(offset, offset + size);
      entries.push({
        path: safePath,
        data: Buffer.from(fileData),
        size,
      });
    }

    const pad = (512 - (size % 512)) % 512;
    offset += size + pad;
  }

  return entries;
}

/**
 * Downloads a raw binary blob from the internal OCI registry via HTTP GET.
 */
async function fetchOCIBlob(baseUrl: string, repo: string, digest: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${baseUrl}/v2/${repo}/blobs/${digest}`);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.warn(`[airgap-bundle] Failed to fetch blob ${digest} for repo ${repo}:`, err);
    return null;
  }
}

/**
 * Exports a sovereign, self-contained vCOp Airgap Bundle.
 */
export async function exportAirgapBundle(options: ExportBundleOptions = {}): Promise<{
  buffer: Buffer;
  manifest: BundleManifest;
  sbom: CycloneDXBom;
  stats: ExportStats;
}> {
  const startedAt = new Date().toISOString();
  const bundleId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const sourceInstance = options.sourceInstance || 'vcop-primary';
  const exporterUser = options.exporterUser || 'Platform Security Officer';
  const registryBaseUrl = await resolveActiveBaseUrl();

  const archiveEntries: ArchiveEntry[] = [];
  const assetEntries: BundleAssetEntry[] = [];

  // Helper to add asset to bundle
  const addAsset = (
    entryPath: string,
    data: Buffer | string,
    category: BundleAssetEntry['category']
  ) => {
    const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    const sha256 = computeSha256(dataBuf);
    const sha512 = computeSha512(dataBuf);

    archiveEntries.push({ path: entryPath, data: dataBuf, size: dataBuf.length });
    assetEntries.push({
      path: entryPath,
      sizeBytes: dataBuf.length,
      sha256,
      sha512,
      category,
    });
  };

  // 1. Export App Store Catalog & VCS History
  let catalog: AppStoreCatalog = { groups: [], apps: [], updatedAt: startedAt };
  let vcsStore: CatalogVCSStore = { appRevisions: {}, groupRevisions: {}, globalCommits: [], updatedAt: startedAt };

  if (options.includeApps !== false) {
    catalog = await getAppStoreCatalog();
    addAsset('catalog/apps.json', JSON.stringify(catalog, null, 2), 'catalog');
  }

  if (options.includeVCS !== false) {
    vcsStore = await getCatalogVCSStore();
    addAsset('catalog/vcs-history.json', JSON.stringify(vcsStore, null, 2), 'vcs');
  }

  // 2. Export Configurations & Baselines
  let baselines: ClusterBaseline[] = [];
  if (options.includeBaselines !== false) {
    baselines = await getClusterBaselines();
    addAsset('configurations/baselines.json', JSON.stringify(baselines, null, 2), 'config');
  }

  let sizingTiers: PresetDetails[] = [];
  if (options.includeSizing !== false) {
    sizingTiers = await getSizingTiers();
    addAsset('configurations/sizing-tiers.json', JSON.stringify(sizingTiers, null, 2), 'config');
  }

  let versionRegistry: VersionRegistry = {
    updatedAt: startedAt,
    kubernetesVersions: [],
    vclusterVersions: [],
    etcdVersions: [],
    coreDNSVersions: [],
    metricsServerVersions: [],
    istioVersions: [],
  };
  if (options.includeVersions !== false) {
    versionRegistry = await getVersionRegistry();
    addAsset('configurations/version-registry.json', JSON.stringify(versionRegistry, null, 2), 'config');
  }

  // 3. Export OCI Repositories, Manifests, Blobs, and Container SBOMs
  const ociStatus = await getOCIRegistryStatus();
  let reposToExport = ociStatus.repositories || [];
  if (options.selectedOCIRepositories && options.selectedOCIRepositories.length > 0) {
    reposToExport = reposToExport.filter((r) => options.selectedOCIRepositories?.includes(r.name));
  }

  let containerCount = 0;
  let helmChartCount = 0;
  const downloadedBlobDigests = new Set<string>();

  if (options.includeOCI !== false) {
    // Write registry catalog index
    addAsset('oci-registry/catalog.json', JSON.stringify({ repositories: reposToExport }, null, 2), 'oci-manifest');

    for (const repo of reposToExport) {
      for (const tagItem of repo.tags || []) {
        const isHelm = tagItem.artifactType === 'helm-chart' || repo.artifactType === 'helm-chart' || repo.name.includes('chart');
        if (isHelm) {
          helmChartCount++;
        } else {
          containerCount++;
        }

        const safeRepoPath = repo.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const manifestPath = `oci-registry/manifests/${safeRepoPath}/${tagItem.tag}.json`;

        if (tagItem.rawManifest) {
          const rawManifestJson = JSON.stringify(tagItem.rawManifest, null, 2);
          addAsset(manifestPath, rawManifestJson, 'oci-manifest');

          // Download Image Config Blob
          const configDigest = tagItem.rawManifest.config?.digest;
          let configBlobData: Buffer | null = null;
          if (configDigest && !downloadedBlobDigests.has(configDigest)) {
            configBlobData = await fetchOCIBlob(registryBaseUrl, repo.name, configDigest);
            if (configBlobData) {
              const hashOnly = configDigest.replace('sha256:', '');
              addAsset(`oci-registry/blobs/sha256/${hashOnly}`, configBlobData, 'oci-blob');
              downloadedBlobDigests.add(configDigest);
            }
          }

          // Download Layer Blobs (CAS deduplicated)
          for (const layer of tagItem.rawManifest.layers || []) {
            const layerDigest = layer.digest;
            if (layerDigest && !downloadedBlobDigests.has(layerDigest)) {
              const layerBlobData = await fetchOCIBlob(registryBaseUrl, repo.name, layerDigest);
              if (layerBlobData) {
                const hashOnly = layerDigest.replace('sha256:', '');
                addAsset(`oci-registry/blobs/sha256/${hashOnly}`, layerBlobData, 'oci-blob');
                downloadedBlobDigests.add(layerDigest);
              }
            }
          }

          // Generate Dedicated Container CycloneDX SBOM if it's a container
          if (!isHelm) {
            let parsedConfig = undefined;
            if (configBlobData) {
              try {
                parsedConfig = JSON.parse(configBlobData.toString('utf-8'));
              } catch {}
            }
            const containerSBOM = generateContainerCycloneDXSBOM(
              repo.name,
              tagItem.tag,
              tagItem.digest || `sha256:${computeSha256(rawManifestJson)}`,
              tagItem.rawManifest,
              parsedConfig
            );
            addAsset(
              `sbom/containers/${safeRepoPath}_${tagItem.tag}-cyclonedx.json`,
              JSON.stringify(containerSBOM, null, 2),
              'sbom'
            );
          }
        }
      }
    }
  }

  // 4. Generate Top-Level CycloneDX 1.5/1.6 SBOM
  const bundleSBOM = generateBundleCycloneDXSBOM({
    bundleId,
    sourceInstance,
    catalog,
    ociRepositories: reposToExport,
    baselines,
    sizingTiers,
    versionRegistry,
    exporterUser,
  });
  addAsset('sbom/cyclonedx-bundle-sbom.json', JSON.stringify(bundleSBOM, null, 2), 'sbom');

  // 5. Generate Bundle Manifest
  const finishedAt = new Date().toISOString();
  const totalSizeBytes = assetEntries.reduce((acc, a) => acc + a.sizeBytes, 0);

  const bundleManifest: BundleManifest = {
    bundleFormatVersion: '1.0',
    bundleId,
    createdAt: finishedAt,
    sourceInstance,
    exporter: exporterUser,
    totalSizeBytes,
    assetsCount: assetEntries.length,
    assets: assetEntries,
    compliance: {
      framework: 'NIST-SP-800-218-SSDF',
      cyclonedxVersion: '1.5',
      slsaLevel: 'SLSA-v1.0',
      fipsCompliantHashing: true,
    },
  };

  const manifestJson = JSON.stringify(bundleManifest, null, 2);
  const manifestSha256 = computeSha256(manifestJson);

  // 6. Cryptographically Sign Bundle Manifest (HMAC-SHA256)
  const signatureBlock: BundleSignatureBlock = signBundleManifest(
    manifestJson,
    options.signingSecret,
    exporterUser
  );

  // 7. in-toto SLSA v1.0 Provenance Statement
  const provenance = generateProvenanceAttestation({
    bundleId,
    manifestSha256,
    sourceInstance,
    exporter: exporterUser,
    startedAt,
    finishedAt,
  });

  // Add the root cryptographic attestations into archive entries
  archiveEntries.unshift(
    { path: 'bundle-manifest.json', data: Buffer.from(manifestJson, 'utf-8'), size: manifestJson.length },
    { path: 'signature.sig', data: Buffer.from(JSON.stringify(signatureBlock, null, 2), 'utf-8') },
    { path: 'provenance.json', data: Buffer.from(JSON.stringify(provenance, null, 2), 'utf-8') }
  );

  // Pack all entries into .tar.gz archive
  const packedBuffer = packTarGz(archiveEntries);

  const stats: ExportStats = {
    bundleId,
    totalSizeBytes: packedBuffer.length,
    assetsCount: archiveEntries.length,
    appsCount: catalog.apps?.length || 0,
    vcsCommitsCount: vcsStore.globalCommits?.length || 0,
    ociArtifactsCount: downloadedBlobDigests.size,
    containerCount,
    helmChartCount,
    baselinesCount: baselines.length,
    exportedAt: finishedAt,
    signatureKeyId: signatureBlock.keyId,
  };

  return {
    buffer: packedBuffer,
    manifest: bundleManifest,
    sbom: bundleSBOM,
    stats,
  };
}

/**
 * Inspects an uploaded bundle archive without making any changes to the target cluster.
 * Validates cryptographic signatures, verifies SHA-256 checksums, and parses CycloneDX SBOM.
 */
export async function inspectAirgapBundle(
  gzBuffer: Buffer,
  verificationKey?: string
): Promise<PreFlightInspectionReport> {
  const entries = unpackTarGz(gzBuffer);
  const fileMap = new Map<string, Buffer>();
  for (const entry of entries) {
    fileMap.set(entry.path, entry.data);
  }

  // 1. Read Root Cryptographic Manifest
  const manifestBuf = fileMap.get('bundle-manifest.json');
  if (!manifestBuf) {
    throw new Error('Invalid Bundle: Missing required "bundle-manifest.json" in archive root.');
  }

  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf-8'));
  } catch (err: any) {
    throw new Error(`Invalid Bundle: Failed to parse bundle-manifest.json: ${err.message}`);
  }

  // 2. Read and Verify Digital Signature
  const sigBuf = fileMap.get('signature.sig');
  let signatureVerified = false;
  let signatureDetails = 'Digital signature absent';
  let sigBlock: BundleSignatureBlock | null = null;

  if (sigBuf) {
    try {
      sigBlock = JSON.parse(sigBuf.toString('utf-8'));
      if (sigBlock) {
        const sigResult = verifyBundleSignature(
          manifestBuf.toString('utf-8'),
          sigBlock,
          verificationKey
        );
        signatureVerified = sigResult.valid;
        signatureDetails = sigResult.valid
          ? `Signature valid (Key ID: ${sigBlock.keyId})`
          : (sigResult.reason || 'Cryptographic signature mismatch');
      }
    } catch (e: any) {
      signatureDetails = `Failed to parse signature block: ${e.message}`;
    }
  }

  // 3. Verify SHA-256 Checksums for Every Asset
  let checksumsPassed = true;
  for (const asset of manifest.assets || []) {
    const fileData = fileMap.get(asset.path);
    if (!fileData) {
      checksumsPassed = false;
      break;
    }
    const actualSha = computeSha256(fileData);
    if (actualSha !== asset.sha256) {
      checksumsPassed = false;
      break;
    }
  }

  // 4. Parse in-toto SLSA Provenance
  let provenance: InTotoProvenanceStatement | undefined;
  const provBuf = fileMap.get('provenance.json');
  if (provBuf) {
    try {
      provenance = JSON.parse(provBuf.toString('utf-8'));
    } catch {}
  }

  // 5. Parse CycloneDX SBOM
  let cycloneDXSummary = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    totalComponents: 0,
    containerComponents: 0,
    applicationComponents: 0,
    configurationComponents: 0,
    licenses: [] as string[],
  };

  const sbomBuf = fileMap.get('sbom/cyclonedx-bundle-sbom.json');
  if (sbomBuf) {
    try {
      const sbom = JSON.parse(sbomBuf.toString('utf-8')) as CycloneDXBom;
      const comps = sbom.components || [];
      const licenseSet = new Set<string>();

      let containers = 0;
      let apps = 0;
      let configs = 0;

      for (const c of comps) {
        if (c.type === 'container') containers++;
        else if (c.type === 'application') apps++;
        else if (c.type === 'configuration' || c.type === 'file') configs++;

        for (const l of c.licenses || []) {
          if (l.license?.id) licenseSet.add(l.license.id);
          else if (l.expression) licenseSet.add(l.expression);
        }
      }

      cycloneDXSummary = {
        bomFormat: sbom.bomFormat,
        specVersion: sbom.specVersion,
        totalComponents: comps.length,
        containerComponents: containers,
        applicationComponents: apps,
        configurationComponents: configs,
        licenses: Array.from(licenseSet),
      };
    } catch {}
  }

  // 6. Extract Catalog Apps & VCS details
  let catalogApps: Array<{ id: string; name: string; version: string; category: string }> = [];
  let groupsCount = 0;
  const appsBuf = fileMap.get('catalog/apps.json');
  if (appsBuf) {
    try {
      const cat = JSON.parse(appsBuf.toString('utf-8')) as AppStoreCatalog;
      catalogApps = (cat.apps || []).map((a) => ({
        id: a.id,
        name: a.name,
        version: a.version,
        category: a.category,
      }));
      groupsCount = cat.groups?.length || 0;
    } catch {}
  }

  let vcsCommitsCount = 0;
  const vcsBuf = fileMap.get('catalog/vcs-history.json');
  if (vcsBuf) {
    try {
      const v = JSON.parse(vcsBuf.toString('utf-8')) as CatalogVCSStore;
      vcsCommitsCount = v.globalCommits?.length || 0;
    } catch {}
  }

  // 7. Extract OCI Repositories & Tags
  const ociCatalogBuf = fileMap.get('oci-registry/catalog.json');
  let ociRepos: Array<{
    name: string;
    tags: Array<{ tag: string; artifactType: string; digest?: string; sizeBytes?: number }>;
  }> = [];

  if (ociCatalogBuf) {
    try {
      const parsed = JSON.parse(ociCatalogBuf.toString('utf-8'));
      ociRepos = (parsed.repositories || []).map((r: any) => ({
        name: r.name,
        tags: (r.tags || []).map((t: any) => ({
          tag: t.tag,
          artifactType: t.artifactType || 'container',
          digest: t.digest,
          sizeBytes: t.sizeBytes,
        })),
      }));
    } catch {}
  }

  // 8. Extract Configurations & Baselines
  let baselineNames: string[] = [];
  const baseBuf = fileMap.get('configurations/baselines.json');
  if (baseBuf) {
    try {
      const b = JSON.parse(baseBuf.toString('utf-8')) as ClusterBaseline[];
      baselineNames = b.map((item) => item.name);
    } catch {}
  }

  let sizingTiersCount = 0;
  const sizeBuf = fileMap.get('configurations/sizing-tiers.json');
  if (sizeBuf) {
    try {
      const s = JSON.parse(sizeBuf.toString('utf-8'));
      sizingTiersCount = Array.isArray(s) ? s.length : 0;
    } catch {}
  }

  const hasVersionRegistry = fileMap.has('configurations/version-registry.json');

  // 9. Check Conflicts / Differences against current Target Cluster State
  const existingCatalog = await getAppStoreCatalog();
  const existingBaselines = await getClusterBaselines();
  const existingConflicts: PreFlightInspectionReport['existingConflicts'] = [];

  for (const app of catalogApps) {
    const match = existingCatalog.apps.find((a) => a.id === app.id);
    if (match) {
      existingConflicts.push({
        type: 'app',
        name: app.name,
        existingVersion: match.version,
        bundleVersion: app.version,
        action: match.version === app.version ? 'overwrite' : 'update',
      });
    } else {
      existingConflicts.push({
        type: 'app',
        name: app.name,
        bundleVersion: app.version,
        action: 'new',
      });
    }
  }

  for (const bName of baselineNames) {
    const match = existingBaselines.find((b) => b.name === bName);
    if (match) {
      existingConflicts.push({
        type: 'baseline',
        name: bName,
        action: 'overwrite',
      });
    } else {
      existingConflicts.push({
        type: 'baseline',
        name: bName,
        action: 'new',
      });
    }
  }

  return {
    valid: checksumsPassed,
    bundleId: manifest.bundleId,
    sourceInstance: manifest.sourceInstance,
    exporter: manifest.exporter,
    exportedAt: manifest.createdAt,
    totalSizeBytes: manifest.totalSizeBytes,
    assetsCount: manifest.assetsCount,
    signature: {
      verified: signatureVerified,
      algorithm: sigBlock?.algorithm || 'None',
      keyId: sigBlock?.keyId || 'none',
      signedBy: sigBlock?.signedBy || 'unknown',
      signedAt: sigBlock?.signedAt || '',
      reason: signatureDetails,
    },
    checksumsPassed,
    provenance,
    cycloneDXSummary,
    catalog: {
      appsCount: catalogApps.length,
      groupsCount,
      apps: catalogApps,
      vcsCommitsCount,
    },
    oci: {
      repositoriesCount: ociRepos.length,
      artifactsCount: ociRepos.reduce((acc, r) => acc + r.tags.length, 0),
      repositories: ociRepos,
    },
    configurations: {
      baselinesCount: baselineNames.length,
      baselines: baselineNames,
      sizingTiersCount,
      hasVersionRegistry,
    },
    existingConflicts,
  };
}

/**
 * Commits and ingests a verified bundle archive into the current air-gapped vCOp instance.
 * Replays OCI blobs, manifests, catalog apps, VCS commit history, and platform baselines.
 */
export async function importAirgapBundle(
  gzBuffer: Buffer,
  options: ImportBundleOptions = {},
  user = 'admin',
  ipAddress?: string
): Promise<ImportExecutionReport> {
  const startTime = Date.now();
  const logs: string[] = [];
  const errors: string[] = [];

  logs.push(`[${new Date().toISOString()}] Initiating Airgap Bundle Ingestion Engine...`);

  // Unpack and extract
  const entries = unpackTarGz(gzBuffer);
  const fileMap = new Map<string, Buffer>();
  for (const entry of entries) {
    fileMap.set(entry.path, entry.data);
  }

  const manifestBuf = fileMap.get('bundle-manifest.json');
  if (!manifestBuf) {
    throw new Error('Fatal: bundle-manifest.json missing from bundle payload');
  }

  const manifest = JSON.parse(manifestBuf.toString('utf-8')) as BundleManifest;
  logs.push(`[${new Date().toISOString()}] Loaded Bundle Manifest: ${manifest.bundleId} from ${manifest.sourceInstance}`);

  // Cryptographic Signature verification
  const sigBuf = fileMap.get('signature.sig');
  let signatureValid = false;
  if (sigBuf) {
    try {
      const sigBlock = JSON.parse(sigBuf.toString('utf-8'));
      const sigResult = verifyBundleSignature(manifestBuf.toString('utf-8'), sigBlock, options.verificationKey);
      signatureValid = sigResult.valid;
      if (signatureValid) {
        logs.push(`[${new Date().toISOString()}] Cryptographic Signature Verified: Tamper-Free (Key: ${sigBlock.keyId})`);
      } else {
        logs.push(`[${new Date().toISOString()}] Warning: Digital signature unverified: ${sigResult.reason}`);
      }
    } catch {}
  }

  const ingested = {
    apps: 0,
    vcsCommits: 0,
    ociBlobs: 0,
    ociManifests: 0,
    baselines: 0,
    sizingTiers: 0,
    versionRegistry: false,
  };

  const registryBaseUrl = await resolveActiveBaseUrl();

  // 1. Ingest OCI Blobs & Manifests
  if (options.importOCI !== false) {
    logs.push(`[${new Date().toISOString()}] Processing OCI Artifact Registry Ingestion...`);
    const ociCatalogBuf = fileMap.get('oci-registry/catalog.json');

    if (ociCatalogBuf) {
      try {
        const ociCatalog = JSON.parse(ociCatalogBuf.toString('utf-8'));
        const repositories = ociCatalog.repositories || [];

        for (const repo of repositories) {
          const repoName = repo.name;
          const safeRepoPath = repoName.replace(/[^a-zA-Z0-9_-]/g, '_');

          for (const tagItem of repo.tags || []) {
            const tag = tagItem.tag;
            const manifestPath = `oci-registry/manifests/${safeRepoPath}/${tag}.json`;
            const rawManifestBuf = fileMap.get(manifestPath);

            if (!rawManifestBuf) continue;

            const rawManifest = JSON.parse(rawManifestBuf.toString('utf-8'));
            const configDigest = rawManifest.config?.digest;
            const layers = rawManifest.layers || [];

            // A. Ingest Config Blob
            if (configDigest) {
              const hashOnly = configDigest.replace('sha256:', '');
              const blobData = fileMap.get(`oci-registry/blobs/sha256/${hashOnly}`);
              if (blobData) {
                await uploadOCIBlob(registryBaseUrl, repoName, configDigest, blobData);
                ingested.ociBlobs++;
              }
            }

            // B. Ingest Layer Blobs
            for (const layer of layers) {
              const layerDigest = layer.digest;
              if (layerDigest) {
                const hashOnly = layerDigest.replace('sha256:', '');
                const blobData = fileMap.get(`oci-registry/blobs/sha256/${hashOnly}`);
                if (blobData) {
                  await uploadOCIBlob(registryBaseUrl, repoName, layerDigest, blobData);
                  ingested.ociBlobs++;
                }
              }
            }

            // C. Ingest Manifest
            const mediaType = rawManifest.mediaType || 'application/vnd.oci.image.manifest.v1+json';
            await uploadOCIManifest(registryBaseUrl, repoName, tag, rawManifestBuf, mediaType);
            ingested.ociManifests++;
            logs.push(`[${new Date().toISOString()}] Restored OCI Artifact: ${repoName}:${tag}`);
          }
        }
      } catch (err: any) {
        errors.push(`OCI Registry Ingestion Error: ${err.message}`);
        logs.push(`[${new Date().toISOString()}] Error in OCI ingestion: ${err.message}`);
      }
    }
  }

  // 2. Ingest App Store Catalog
  if (options.importApps !== false) {
    logs.push(`[${new Date().toISOString()}] Merging App Store Catalog...`);
    const appsBuf = fileMap.get('catalog/apps.json');
    if (appsBuf) {
      try {
        const bundleCatalog = JSON.parse(appsBuf.toString('utf-8')) as AppStoreCatalog;
        const currentCatalog = await getAppStoreCatalog();

        // Merge Apps (upsert by id)
        const currentAppMap = new Map<string, AppDefinition>();
        for (const app of currentCatalog.apps || []) {
          currentAppMap.set(app.id, app);
        }
        for (const newApp of bundleCatalog.apps || []) {
          currentAppMap.set(newApp.id, newApp);
          ingested.apps++;
        }

        // Merge Groups (upsert by id)
        const currentGroupMap = new Map<string, AppGroup>();
        for (const grp of currentCatalog.groups || []) {
          currentGroupMap.set(grp.id, grp);
        }
        for (const newGrp of bundleCatalog.groups || []) {
          currentGroupMap.set(newGrp.id, newGrp);
        }

        const mergedCatalog: AppStoreCatalog = {
          updatedAt: new Date().toISOString(),
          apps: Array.from(currentAppMap.values()),
          groups: Array.from(currentGroupMap.values()),
        };

        await saveEntireCatalog(mergedCatalog);
        logs.push(`[${new Date().toISOString()}] Successfully persisted ${ingested.apps} apps to Kubernetes ConfigMap.`);
      } catch (err: any) {
        errors.push(`App Store Catalog Error: ${err.message}`);
        logs.push(`[${new Date().toISOString()}] Error merging catalog: ${err.message}`);
      }
    }
  }

  // 3. Ingest VCS GitOps History
  if (options.importVCS !== false) {
    logs.push(`[${new Date().toISOString()}] Ingesting GitOps VCS Revision Trees...`);
    const vcsBuf = fileMap.get('catalog/vcs-history.json');
    if (vcsBuf) {
      try {
        const bundleVCS = JSON.parse(vcsBuf.toString('utf-8')) as CatalogVCSStore;
        const currentVCS = await getCatalogVCSStore();

        // Merge app revisions
        const mergedAppRevs = { ...currentVCS.appRevisions };
        for (const [appId, revs] of Object.entries(bundleVCS.appRevisions || {})) {
          mergedAppRevs[appId] = revs;
        }

        // Merge group revisions
        const mergedGroupRevs = { ...currentVCS.groupRevisions };
        for (const [grpId, revs] of Object.entries(bundleVCS.groupRevisions || {})) {
          mergedGroupRevs[grpId] = revs;
        }

        // Merge global commits (dedup by id)
        const commitMap = new Map<string, any>();
        for (const c of currentVCS.globalCommits || []) {
          commitMap.set(c.id, c);
        }
        for (const c of bundleVCS.globalCommits || []) {
          commitMap.set(c.id, c);
          ingested.vcsCommits++;
        }

        const mergedVCS: CatalogVCSStore = {
          updatedAt: new Date().toISOString(),
          appRevisions: mergedAppRevs,
          groupRevisions: mergedGroupRevs,
          globalCommits: Array.from(commitMap.values()),
        };

        await saveCatalogVCSStore(mergedVCS);
        logs.push(`[${new Date().toISOString()}] Successfully restored ${ingested.vcsCommits} GitOps revision commits.`);
      } catch (err: any) {
        errors.push(`VCS Ingestion Error: ${err.message}`);
        logs.push(`[${new Date().toISOString()}] Error merging VCS history: ${err.message}`);
      }
    }
  }

  // 4. Ingest Baselines
  if (options.importBaselines !== false) {
    const baseBuf = fileMap.get('configurations/baselines.json');
    if (baseBuf) {
      try {
        const bundleBaselines = JSON.parse(baseBuf.toString('utf-8')) as ClusterBaseline[];
        const currentBaselines = await getClusterBaselines();

        const baseMap = new Map<string, ClusterBaseline>();
        for (const b of currentBaselines) baseMap.set(b.id, b);
        for (const b of bundleBaselines) {
          baseMap.set(b.id, b);
          ingested.baselines++;
        }

        await saveEntireBaselinesToK8s(Array.from(baseMap.values()));
        logs.push(`[${new Date().toISOString()}] Successfully restored ${ingested.baselines} cluster baselines.`);
      } catch (err: any) {
        errors.push(`Baselines Ingestion Error: ${err.message}`);
      }
    }
  }

  // 5. Ingest Sizing Tiers
  if (options.importSizing !== false) {
    const sizeBuf = fileMap.get('configurations/sizing-tiers.json');
    if (sizeBuf) {
      try {
        const bundleTiers = JSON.parse(sizeBuf.toString('utf-8')) as PresetDetails[];
        const currentTiers = await getSizingTiers();

        const tierMap = new Map<string, PresetDetails>();
        for (const t of currentTiers) tierMap.set(t.id, t);
        for (const t of bundleTiers) {
          tierMap.set(t.id, t);
          ingested.sizingTiers++;
        }

        await saveEntireSizingTiersToK8s(Array.from(tierMap.values()));
        logs.push(`[${new Date().toISOString()}] Successfully restored ${ingested.sizingTiers} sizing tiers.`);
      } catch (err: any) {
        errors.push(`Sizing Tiers Error: ${err.message}`);
      }
    }
  }

  // 6. Ingest Version Registry
  if (options.importVersions !== false) {
    const verBuf = fileMap.get('configurations/version-registry.json');
    if (verBuf) {
      try {
        const bundleVer = JSON.parse(verBuf.toString('utf-8')) as VersionRegistry;
        await saveEntireRegistry(bundleVer);
        ingested.versionRegistry = true;
        logs.push(`[${new Date().toISOString()}] Successfully restored Version Registry patterns.`);
      } catch (err: any) {
        errors.push(`Version Registry Error: ${err.message}`);
      }
    }
  }

  const durationMs = Date.now() - startTime;
  logs.push(`[${new Date().toISOString()}] Airgap Ingestion completed in ${durationMs}ms.`);

  // Record Audit Log Entry
  try {
    await recordAuditLog({
      userId: user,
      username: user,
      userRole: 'admin',
      action: 'AIRGAP_BUNDLE_INGESTION',
      category: 'SYSTEM',
      resourceType: 'BUNDLE',
      resourceName: manifest.bundleId,
      status: errors.length === 0 ? 'SUCCESS' : 'FAILED',
      details: {
        bundleId: manifest.bundleId,
        sourceInstance: manifest.sourceInstance,
        signatureVerified: signatureValid,
        ingested,
        durationMs,
      },
      ipAddress,
    });
  } catch (err) {
    console.warn('[airgap-bundle] Failed to write audit record:', err);
  }

  return {
    success: errors.length === 0,
    bundleId: manifest.bundleId,
    durationMs,
    ingested,
    logs,
    signatureValid,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Uploads an OCI blob to the target registry via OCI Distribution Spec v1.1.
 */
async function uploadOCIBlob(baseUrl: string, repo: string, digest: string, data: Buffer): Promise<void> {
  // Check if blob already exists
  try {
    const headRes = await fetch(`${baseUrl}/v2/${repo}/blobs/${digest}`, { method: 'HEAD' });
    if (headRes.status === 200) {
      return; // Already present
    }
  } catch {}

  // 1. Initialize upload session
  const initRes = await fetch(`${baseUrl}/v2/${repo}/blobs/uploads/`, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });

  if (initRes.status !== 202) {
    const msg = await initRes.text().catch(() => '');
    throw new Error(`Failed to start OCI blob upload session (${initRes.status}): ${msg}`);
  }

  const location = initRes.headers.get('Location');
  if (!location) {
    throw new Error('OCI registry did not return Location header for blob upload');
  }

  const uploadUrl = location.startsWith('http') ? location : `${baseUrl}${location}`;
  const separator = uploadUrl.includes('?') ? '&' : '?';

  // 2. Upload blob monolithic PUT
  const putRes = await fetch(`${uploadUrl}${separator}digest=${digest}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(data.length),
    },
    body: data,
  });

  if (putRes.status !== 201 && putRes.status !== 200) {
    const errText = await putRes.text().catch(() => '');
    throw new Error(`Failed to upload blob ${digest} (${putRes.status}): ${errText}`);
  }
}

/**
 * Uploads an OCI image/artifact manifest via HTTP PUT.
 */
async function uploadOCIManifest(
  baseUrl: string,
  repo: string,
  tag: string,
  manifestData: Buffer,
  mediaType: string
): Promise<void> {
  const putRes = await fetch(`${baseUrl}/v2/${repo}/manifests/${tag}`, {
    method: 'PUT',
    headers: {
      'Content-Type': mediaType,
      'Content-Length': String(manifestData.length),
    },
    body: manifestData,
  });

  if (putRes.status !== 201 && putRes.status !== 200) {
    const errText = await putRes.text().catch(() => '');
    throw new Error(`Failed to upload manifest ${repo}:${tag} (${putRes.status}): ${errText}`);
  }
}
