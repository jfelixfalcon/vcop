import React, { useState, useEffect } from 'react';
import {
  Server,
  Package,
  HardDrive,
  Copy,
  Check,
  X,
  RefreshCw,
  Terminal,
  ExternalLink,
  ShieldCheck,
  Layers,
  Box,
  FileCode,
  Zap,
} from 'lucide-react';
import type { OCIRegistryStatus } from '../lib/oci-registry';
import { ModalPortal } from './ModalPortal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUseChart?: (chartRef: string) => void;
}

export const OCIRegistryModal: React.FC<Props> = ({ isOpen, onClose, onUseChart }) => {
  const [status, setStatus] = useState<OCIRegistryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'artifacts' | 'cli-commands'>('artifacts');

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/registry');
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch OCI registry status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    }
  }, [isOpen]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  const endpoint = status?.inClusterEndpoint || 'vcop-registry.vcop-system.svc:5000';
  const externalEndpoint = status?.endpoint || 'localhost:5000';

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/80 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
        <div className="bg-cyber-950 border border-cyber-700/90 rounded-3xl w-full max-w-5xl h-[85vh] max-h-[850px] flex flex-col shadow-2xl overflow-hidden relative text-slate-100">
          {/* Header */}
          <div className="px-6 py-4 border-b border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">In-Cluster OCI Artifact & Container Registry</h2>
                  {status?.online ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>Online (OCI Spec v1.1)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      <span>In-Cluster Service Ready</span>
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Private OCI-compliant repository pod for hosting container images, Helm charts, and custom OCI artifacts.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Metrics Bar */}
          <div className="px-6 py-3 border-b border-cyber-800 bg-cyber-900/40 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono shrink-0">
            <div>
              <span className="text-slate-500 block text-[10px]">IN-CLUSTER ENDPOINT</span>
              <span className="text-cyan-300 font-bold flex items-center gap-1">
                <code>{endpoint}</code>
                <button
                  onClick={() => handleCopy(endpoint, 'ep-in')}
                  className="p-0.5 hover:text-white text-slate-500"
                  title="Copy in-cluster endpoint"
                >
                  {copiedKey === 'ep-in' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">EXTERNAL / PORT-FORWARD</span>
              <span className="text-slate-200 font-bold flex items-center gap-1">
                <code>{externalEndpoint}</code>
                <button
                  onClick={() => handleCopy(externalEndpoint, 'ep-ext')}
                  className="p-0.5 hover:text-white text-slate-500"
                  title="Copy external endpoint"
                >
                  {copiedKey === 'ep-ext' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">REPOSITORIES</span>
              <span className="text-white font-bold text-sm">
                {status?.repositoriesCount || 0}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">STORED ARTIFACTS / TAGS</span>
              <span className="text-emerald-400 font-bold text-sm">
                {status?.totalArtifactsCount || 0}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-b border-cyber-800 bg-cyber-900/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('artifacts')}
                className={`px-3 py-2.5 text-xs font-mono font-semibold border-b-2 transition-all ${
                  activeTab === 'artifacts'
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                Artifacts & Repositories ({status?.repositories?.length || 0})
              </button>
              <button
                onClick={() => setActiveTab('cli-commands')}
                className={`px-3 py-2.5 text-xs font-mono font-semibold border-b-2 transition-all ${
                  activeTab === 'cli-commands'
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                Push & Pull CLI Snippets
              </button>
            </div>

            <button
              onClick={fetchStatus}
              disabled={loading}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors flex items-center gap-1 text-xs font-mono"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'artifacts' && (
              <div className="space-y-4">
                {(!status?.repositories || status.repositories.length === 0) ? (
                  <div className="py-16 text-center rounded-3xl bg-cyber-900/30 border border-cyber-800 p-8 space-y-3">
                    <Server className="w-10 h-10 text-slate-600 mx-auto" />
                    <h3 className="text-sm font-bold text-white font-mono">No Artifacts Pushed Yet</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Your in-cluster OCI registry pod is configured and ready. Push container images, Helm charts, or OCI artifacts using standard CLI tools.
                    </p>
                    <button
                      onClick={() => setActiveTab('cli-commands')}
                      className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-mono font-semibold transition-all"
                    >
                      View Push Commands &rarr;
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {status.repositories.map((repo) => {
                      const isHelm = repo.artifactType === 'helm-chart';
                      const fullRef = `oci://${endpoint}/${repo.name}`;

                      return (
                        <div
                          key={repo.name}
                          className="p-4 bg-cyber-900/80 border border-cyber-800 rounded-2xl flex flex-col justify-between gap-3 hover:border-emerald-500/40 transition-all"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <div className={`p-2 rounded-xl ${
                                  isHelm ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                }`}>
                                  {isHelm ? <Package className="w-4 h-4" /> : <Box className="w-4 h-4" />}
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold text-white font-mono">{repo.name}</h4>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {repo.artifactType === 'helm-chart' ? 'Helm OCI Chart' : 'Container Image'}
                                  </span>
                                </div>
                              </div>

                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyber-950 text-slate-300 border border-cyber-800">
                                {repo.tags.length} tag{repo.tags.length !== 1 ? 's' : ''}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {repo.tags.map((t) => (
                                <span
                                  key={t.tag}
                                  className="px-2 py-0.5 rounded bg-cyber-950 text-[10px] font-mono text-emerald-300 border border-cyber-800"
                                >
                                  {t.tag}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="pt-2 border-t border-cyber-800 flex items-center justify-between gap-2">
                            <code className="text-[10px] font-mono text-slate-400 truncate flex-1">
                              {fullRef}
                            </code>
                            <button
                              onClick={() => handleCopy(fullRef, `ref-${repo.name}`)}
                              className="p-1 text-slate-400 hover:text-white rounded"
                              title="Copy OCI reference URI"
                            >
                              {copiedKey === `ref-${repo.name}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                            {isHelm && onUseChart && (
                              <button
                                onClick={() => {
                                  onUseChart(fullRef);
                                  onClose();
                                }}
                                className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-mono font-semibold"
                              >
                                Use in App
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'cli-commands' && (
              <div className="space-y-6">
                {/* Helm OCI Guide */}
                <div className="p-4 bg-cyber-900/60 border border-cyber-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-cyan-400" />
                      <h4 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
                        1. Push & Pull Helm Charts via OCI
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                      Standard Helm 3.8+
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans">
                    Package and push any Helm chart directly into your private vCOp OCI repository:
                  </p>
                  <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 font-mono text-[11px] text-slate-200 relative group">
                    <pre className="overflow-x-auto whitespace-pre">
{`# 1. Package the Helm chart
helm package ./my-helm-chart

# 2. Push chart tarball to the local OCI registry pod
helm push my-helm-chart-1.0.0.tgz oci://${externalEndpoint}/charts

# 3. Pull or install directly inside any virtual cluster
helm install my-app oci://${endpoint}/charts/my-helm-chart --version 1.0.0`}
                    </pre>
                    <button
                      onClick={() => handleCopy(`helm package ./my-chart && helm push my-chart-1.0.0.tgz oci://${externalEndpoint}/charts`, 'helm-cli')}
                      className="absolute top-2 right-2 p-1.5 bg-cyber-900 hover:bg-cyber-850 rounded border border-cyber-800 text-slate-400 hover:text-white"
                      title="Copy command"
                    >
                      {copiedKey === 'helm-cli' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Docker & Podman Container Guide */}
                <div className="p-4 bg-cyber-900/60 border border-cyber-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Box className="w-4 h-4 text-purple-400" />
                      <h4 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
                        2. Push Container Images (Docker / Podman)
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono text-purple-400 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/60">
                      OCI Container Images
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans">
                    Tag and push container images to serve your guest virtual clusters without external internet registries:
                  </p>
                  <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 font-mono text-[11px] text-slate-200 relative group">
                    <pre className="overflow-x-auto whitespace-pre">
{`# Tag built container image
docker tag my-service:latest ${externalEndpoint}/apps/my-service:1.0.0

# Push container to in-cluster registry
docker push ${externalEndpoint}/apps/my-service:1.0.0

# Guest virtual clusters can pull via internal service DNS:
# ${endpoint}/apps/my-service:1.0.0`}
                    </pre>
                    <button
                      onClick={() => handleCopy(`docker tag my-service:latest ${externalEndpoint}/apps/my-service:1.0.0 && docker push ${externalEndpoint}/apps/my-service:1.0.0`, 'docker-cli')}
                      className="absolute top-2 right-2 p-1.5 bg-cyber-900 hover:bg-cyber-850 rounded border border-cyber-800 text-slate-400 hover:text-white"
                      title="Copy command"
                    >
                      {copiedKey === 'docker-cli' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* ORAS / Arbitrary OCI Artifacts */}
                <div className="p-4 bg-cyber-900/60 border border-cyber-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      <h4 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
                        3. Push OCI Artifacts (ORAS / Cosign / Wasm)
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                      OCI Spec v1.1 Artifacts
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans">
                    Store raw Kubernetes manifests, Cosign signatures, SBOMs, or WebAssembly binaries:
                  </p>
                  <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 font-mono text-[11px] text-slate-200 relative group">
                    <pre className="overflow-x-auto whitespace-pre">
{`# Push Kubernetes manifest bundle via ORAS CLI
oras push ${externalEndpoint}/manifests/security-bundle:v1.0.0 \\
  ./manifests.yaml:application/vnd.k8s.manifests.v1+yaml

# Pull artifact from registry
oras pull ${externalEndpoint}/manifests/security-bundle:v1.0.0`}
                    </pre>
                    <button
                      onClick={() => handleCopy(`oras push ${externalEndpoint}/manifests/bundle:v1.0.0 ./manifests.yaml:application/vnd.k8s.manifests.v1+yaml`, 'oras-cli')}
                      className="absolute top-2 right-2 p-1.5 bg-cyber-900 hover:bg-cyber-850 rounded border border-cyber-800 text-slate-400 hover:text-white"
                      title="Copy command"
                    >
                      {copiedKey === 'oras-cli' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Full compliance with CNCF OCI Image & Distribution Specifications</span>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-200 rounded-xl transition-colors font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
