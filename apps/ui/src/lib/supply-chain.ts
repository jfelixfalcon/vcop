/**
 * Supply Chain Security & Cryptographic Integrity Engine
 * Aligned with NIST SP 800-218 (SSDF), SLSA v1.0, CISA Cross-Domain Guidance,
 * and Executive Order 14028.
 */

import crypto from 'node:crypto';
import path from 'node:path';

export interface BundleAssetEntry {
  path: string;
  sizeBytes: number;
  sha256: string;
  sha512: string;
  category: 'catalog' | 'vcs' | 'oci-blob' | 'oci-manifest' | 'config' | 'sbom' | 'provenance';
}

export interface BundleManifest {
  bundleFormatVersion: '1.0';
  bundleId: string;
  createdAt: string;
  sourceInstance: string;
  exporter: string;
  totalSizeBytes: number;
  assetsCount: number;
  assets: BundleAssetEntry[];
  compliance: {
    framework: string;
    cyclonedxVersion: string;
    slsaLevel: string;
    fipsCompliantHashing: boolean;
  };
}

export interface InTotoProvenanceStatement {
  _type: 'https://in-toto.io/Statement/v1';
  subject: Array<{
    name: string;
    digest: {
      sha256: string;
      sha512?: string;
    };
  }>;
  predicateType: 'https://slsa.dev/provenance/v1';
  predicate: {
    builder: {
      id: string;
    };
    buildDefinition: {
      buildType: string;
      externalParameters: Record<string, any>;
      systemParameters: Record<string, any>;
    };
    runDetails: {
      builder: {
        id: string;
        version: string;
      };
      metadata: {
        invocationId: string;
        startedOn: string;
        finishedOn: string;
      };
    };
  };
}

export interface BundleSignatureBlock {
  algorithm: 'HMAC-SHA256' | 'ECDSA-P256-SHA256';
  signedManifestSha256: string;
  signature: string;
  keyId: string;
  signedAt: string;
  signedBy: string;
}

export const PLATFORM_SIGNING_KEY = process.env.VCOP_BUNDLE_SIGNING_SECRET || 'vcop-default-sovereign-signing-key-2026';

/**
 * Computes SHA-256 hex string.
 */
export function sha256Digest(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Computes SHA-512 hex string.
 */
export function sha512Digest(data: string | Buffer): string {
  return crypto.createHash('sha512').update(data).digest('hex');
}

/**
 * Digitally signs a bundle manifest using HMAC-SHA256.
 */
export function signBundleManifest(
  manifestJson: string,
  key: string = PLATFORM_SIGNING_KEY,
  signedBy = 'Platform Security Officer'
): BundleSignatureBlock {
  const manifestSha256 = sha256Digest(manifestJson);
  const signature = crypto.createHmac('sha256', key).update(manifestSha256).digest('hex');

  return {
    algorithm: 'HMAC-SHA256',
    signedManifestSha256: manifestSha256,
    signature,
    keyId: sha256Digest(key).slice(0, 16),
    signedAt: new Date().toISOString(),
    signedBy,
  };
}

/**
 * Verifies the cryptographic digital signature of a bundle manifest.
 */
export function verifyBundleSignature(
  manifestJson: string,
  signatureBlock: BundleSignatureBlock,
  key: string = PLATFORM_SIGNING_KEY
): { valid: boolean; reason?: string } {
  if (!signatureBlock || !signatureBlock.signature) {
    return { valid: false, reason: 'Missing digital signature block' };
  }

  const computedManifestSha = sha256Digest(manifestJson);
  if (computedManifestSha !== signatureBlock.signedManifestSha256) {
    return {
      valid: false,
      reason: `Digest mismatch: manifest computed ${computedManifestSha} vs signed ${signatureBlock.signedManifestSha256}`,
    };
  }

  const expectedSignature = crypto.createHmac('sha256', key).update(computedManifestSha).digest('hex');
  if (expectedSignature !== signatureBlock.signature) {
    // If the provided key didn't match, check if they used an alternative key
    return {
      valid: false,
      reason: 'Cryptographic signature verification failed: invalid signing key or tampered bundle payload',
    };
  }

  return { valid: true };
}

/**
 * Generates an in-toto SLSA v1.0 Provenance Attestation statement.
 */
export function generateProvenanceAttestation(params: {
  bundleId: string;
  manifestSha256: string;
  sourceInstance: string;
  exporter: string;
  startedAt: string;
  finishedAt: string;
}): InTotoProvenanceStatement {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      {
        name: `vcop-airgap-bundle-${params.bundleId}.tar.gz`,
        digest: {
          sha256: params.manifestSha256,
        },
      },
    ],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: {
        id: 'https://vcop.local/builder/v1.4.19',
      },
      buildDefinition: {
        buildType: 'https://vcop.local/attestations/airgap-export/v1',
        externalParameters: {
          sourceInstance: params.sourceInstance,
          exporter: params.exporter,
          destinationDomain: 'Air-Gapped Sovereign Enclave',
        },
        systemParameters: {
          bundleId: params.bundleId,
          complianceFrameworks: ['NIST-SP-800-218', 'SLSA-v1.0', 'EO-14028'],
        },
      },
      runDetails: {
        builder: {
          id: 'https://vcop.local/builder/v1.4.19',
          version: '1.4.19',
        },
        metadata: {
          invocationId: crypto.randomUUID(),
          startedOn: params.startedAt,
          finishedOn: params.finishedAt,
        },
      },
    },
  };
}

/**
 * Defense against Zip-Slip / Directory Traversal attacks.
 * Validates that an archive entry relative path does not escape the destination target root.
 */
export function sanitizeArchivePath(entryPath: string): string {
  // Normalize and remove leading slashes and Windows drive letters
  let clean = entryPath.replace(/^[a-zA-Z]:[/\\]+/, '').replace(/^[/\\]+/, '');

  // Detect path traversal tokens
  const parts = clean.split(/[/\\]+/);
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new Error(`Security Violation: Illegal path traversal sequence detected in archive entry: "${entryPath}"`);
    }
  }

  // Double check path resolution safety
  const simulatedRoot = '/safe/enclave/extraction';
  const resolved = path.posix.resolve(simulatedRoot, clean.replace(/\\/g, '/'));
  if (!resolved.startsWith(simulatedRoot)) {
    throw new Error(`Security Violation: Zip Slip attack prevented for path: "${entryPath}"`);
  }

  return clean.replace(/\\/g, '/');
}

/**
 * Protection against Decompression Bombs & Resource Exhaustion.
 */
export const ARCHIVE_SECURITY_LIMITS = {
  maxTotalFiles: 10000,
  maxDecompressedBytes: 2 * 1024 * 1024 * 1024, // 2 Gigabytes
  maxSingleFileBytes: 1 * 1024 * 1024 * 1024,   // 1 Gigabyte
  maxCompressionRatio: 100,                     // 100:1
};
