import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GuestRBACSubject {
  kind: 'User' | 'Group';
  name: string;
}

/**
 * Prepares an internal kubeconfig for communicating with the vcluster service from inside the cluster pod.
 */
function prepareGuestKubeconfig(raw: string, clusterName: string, clusterNamespace: string): string {
  let processed = raw.replace(/\s*certificate-authority-data:\s*[A-Za-z0-9+/=]+/g, '\n    insecure-skip-tls-verify: true');
  if (!processed.includes('insecure-skip-tls-verify: true')) {
    processed = processed.replace(/(cluster:\s*\n)/g, '$1    insecure-skip-tls-verify: true\n');
  }
  // Point directly to in-cluster service DNS
  processed = processed.replace(/server:\s*https?:\/\/[^\s]+/g, `server: https://${clusterName}.${clusterNamespace}.svc:443`);
  return processed;
}

/**
 * Synchronizes the guest virtual cluster ClusterRoleBinding for delegated users and groups.
 */
export async function syncGuestClusterRBAC(
  rawKubeconfig: string,
  clusterName: string,
  namespace: string,
  owner?: string,
  allowedGroups?: string[],
  allowedEmails?: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!rawKubeconfig) {
      return { success: false, error: `No kubeconfig provided for ${clusterName} in ${namespace}` };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcop-guest-rbac-'));
    const kcPath = path.join(tempDir, 'kubeconfig.yaml');

    try {
      const internalKc = prepareGuestKubeconfig(rawKubeconfig, clusterName, namespace);
      fs.writeFileSync(kcPath, internalKc, { mode: 0o600 });

      // Build unique subjects
      const subjects: GuestRBACSubject[] = [];
      const seen = new Set<string>();

      // 1. Owner
      if (owner && owner.trim()) {
        const trimmed = owner.trim();
        if (
          trimmed.toLowerCase() !== 'platform user' &&
          trimmed.toLowerCase() !== 'platform-user' &&
          trimmed.toLowerCase() !== 'system:admin'
        ) {
          const key = `User:${trimmed}`;
          if (!seen.has(key)) {
            seen.add(key);
            subjects.push({ kind: 'User', name: trimmed });
          }
        }
      }

      // 2. Allowed emails
      if (allowedEmails && Array.isArray(allowedEmails)) {
        for (const email of allowedEmails) {
          const trimmed = email.trim();
          if (trimmed) {
            const key = `User:${trimmed}`;
            if (!seen.has(key)) {
              seen.add(key);
              subjects.push({ kind: 'User', name: trimmed });
            }
          }
        }
      }

      // 3. Allowed groups (capped at 50 to prevent massive RBAC manifests)
      if (allowedGroups && Array.isArray(allowedGroups)) {
        for (const grp of allowedGroups.slice(0, 50)) {
          const trimmed = grp.trim();
          if (trimmed) {
            const key = `Group:${trimmed}`;
            if (!seen.has(key)) {
              seen.add(key);
              subjects.push({ kind: 'Group', name: trimmed });
            }
          }
        }
      }

      if (subjects.length === 0) {
        // Delete binding if subjects are empty
        try {
          await execFileAsync(
            'kubectl',
            ['--kubeconfig', kcPath, 'delete', 'clusterrolebinding', 'vcop-oidc-admins', '--ignore-not-found'],
            { timeout: 10000 }
          );
        } catch {}
        return { success: true };
      }

      const subjectsYaml = subjects
        .map(
          (s) => `  - kind: ${s.kind}
    name: "${s.name}"
    apiGroup: rbac.authorization.k8s.io`
        )
        .join('\n');

      const manifest = `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: vcop-oidc-admins
  labels:
    app.kubernetes.io/managed-by: vcop-ui
    vops.gitops.io/cluster: ${clusterName}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
${subjectsYaml}
`;

      const manifestPath = path.join(tempDir, 'crb.yaml');
      fs.writeFileSync(manifestPath, manifest, 'utf8');

      await execFileAsync('kubectl', ['--kubeconfig', kcPath, 'apply', '--server-side', '--force-conflicts', '-f', manifestPath], {
        timeout: 15000,
      });

      return { success: true };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  } catch (err: any) {
    console.warn(`[syncGuestClusterRBAC] Failed to sync guest RBAC for ${clusterName}:`, err.message);
    return { success: false, error: err.message };
  }
}
