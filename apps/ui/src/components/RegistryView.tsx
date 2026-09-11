import React, { useState, useEffect } from 'react';
import {
  Server,
  Package,
  Layers,
  Box,
  HardDrive,
  Terminal,
  Copy,
  Check,
  Search,
  Trash2,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  FileCode,
  ArrowLeft,
  AlertTriangle,
  Tag,
  ChevronRight,
  Sparkles,
  Clock,
  Plus,
  Download,
  Upload,
  Info,
  SlidersHorizontal,
  X,
  LayoutGrid,
  List,
} from 'lucide-react';
import type { OCIRegistryStatus, OCIRepository, OCIRepositoryTag } from '../lib/oci-registry';
import type { UserSession } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  currentUser?: UserSession | null;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const RegistryView: React.FC<Props> = ({ currentUser }) => {
  const [status, setStatus] = useState<OCIRegistryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<'all' | 'helm-chart' | 'container' | 'artifact'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [selectedRepo, setSelectedRepo] = useState<OCIRepository | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isPushGuideOpen, setIsPushGuideOpen] = useState(false);
  const [pushGuideTab, setPushGuideTab] = useState<'helm' | 'docker' | 'podman' | 'oras'>('helm');
  const [inspectedTag, setInspectedTag] = useState<OCIRepositoryTag | null>(null);
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isAdmin = currentUser?.role === 'admin';
  const isDeveloper = currentUser?.role === 'developers' || currentUser?.role === 'developer';
  const canManage = isAdmin || isDeveloper;

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/registry');
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus(data.data);
        // If viewing a repo, refresh it in state
        if (selectedRepo) {
          const updated = data.data.repositories.find((r: OCIRepository) => r.name === selectedRepo.name);
          setSelectedRepo(updated || null);
        }
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Failed to connect to OCI Registry' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Error fetching registry catalog' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDeleteTag = async (repo: string, tag: OCIRepositoryTag) => {
    if (!confirm(`Are you sure you want to delete artifact tag ${repo}:${tag.tag}?`)) {
      return;
    }

    setDeletingTag(tag.tag);
    try {
      const res = await fetch('/api/registry', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo,
          tag: tag.tag,
          digest: tag.digest,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete artifact');
      }

      setActionMessage({ type: 'success', text: `Artifact tag ${tag.tag} deleted successfully.` });
      await fetchStatus();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to delete tag' });
    } finally {
      setDeletingTag(null);
    }
  };

  // Filter repositories
  const repositories = status?.repositories || [];
  const filteredRepos = repositories.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.tags.some((t) => t.tag.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedType === 'all') return true;
    if (selectedType === 'helm-chart') return r.artifactType === 'helm-chart' || r.name.includes('chart');
    if (selectedType === 'container') return r.artifactType === 'container';
    if (selectedType === 'artifact') return r.artifactType === 'artifact';
    return true;
  });

  const helmCount = repositories.filter((r) => r.artifactType === 'helm-chart' || r.name.includes('chart')).length;
  const containerCount = repositories.filter((r) => r.artifactType === 'container').length;
  const artifactCount = repositories.filter((r) => r.artifactType === 'artifact').length;

  const inClusterEndpoint = status?.inClusterEndpoint || 'vcop-registry.vcop-system.svc:5000';
  const externalEndpoint = status?.endpoint || 'localhost:5000';

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Action Notification Toast */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between shadow-xl transition-all ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2.5 text-xs font-mono">
            {actionMessage.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="p-1 hover:bg-cyber-900 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Harbor-Style Header Banner */}
      <div className="bg-cyber-900/90 border border-cyber-750/70 rounded-3xl p-6 sm:p-7 relative overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-cyan-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-500/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                <Server className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-3">
                  <span>OCI Artifact Registry</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                      status?.online
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        status?.online ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'
                      }`}
                    />
                    <span>{status?.online ? 'Online & Healthy' : 'Offline'}</span>
                  </span>
                </h1>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Internal CNCF OCI Distribution Spec v1.1 Registry for containers, Helm charts, and artifacts
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="px-3.5 py-2 bg-cyber-950 hover:bg-cyber-800 text-slate-300 hover:text-white border border-cyber-750 rounded-xl text-xs font-mono font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => setIsPushGuideOpen(true)}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.3)] flex items-center gap-2 transition-all"
            >
              <Terminal className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Push Artifact Guide</span>
            </button>
          </div>
        </div>

        {/* 4 Stat Metric Cards (Harbor Style) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-6 pt-6 border-t border-cyber-800/80">
          {/* In-Cluster Endpoint */}
          <div className="bg-cyber-950/80 border border-cyber-800 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] font-mono uppercase tracking-wider">In-Cluster Endpoint</span>
              <button
                onClick={() => copyToClipboard(`oci://${inClusterEndpoint}`, 'in-cluster')}
                className="p-1 hover:bg-cyber-800 rounded text-cyan-400 transition-colors"
                title="Copy in-cluster OCI endpoint"
              >
                {copiedKey === 'in-cluster' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-xs font-mono text-cyan-300 font-bold truncate" title={inClusterEndpoint}>
              {inClusterEndpoint}
            </div>
            <span className="text-[10px] font-mono text-slate-500 mt-1">Direct Pod & In-Guest Ingress</span>
          </div>

          {/* External Endpoint */}
          <div className="bg-cyber-950/80 border border-cyber-800 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-[11px] font-mono uppercase tracking-wider">External Push Host</span>
              <button
                onClick={() => copyToClipboard(externalEndpoint, 'external')}
                className="p-1 hover:bg-cyber-800 rounded text-cyan-400 transition-colors"
                title="Copy external host"
              >
                {copiedKey === 'external' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-xs font-mono text-purple-300 font-bold truncate" title={externalEndpoint}>
              {externalEndpoint}
            </div>
            <span className="text-[10px] font-mono text-slate-500 mt-1">Docker / Helm CLI Target</span>
          </div>

          {/* Repositories & Artifacts Count */}
          <div className="bg-cyber-950/80 border border-cyber-800 rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Inventory Stats
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-white font-mono">{status?.repositoriesCount || 0}</span>
              <span className="text-xs font-mono text-slate-400">repos</span>
              <span className="text-slate-600 font-mono">•</span>
              <span className="text-xl font-bold text-cyan-400 font-mono">{status?.totalArtifactsCount || 0}</span>
              <span className="text-xs font-mono text-slate-400">tags</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 mt-1">Air-gap sovereign storage</span>
          </div>

          {/* Storage PVC & Compliance */}
          <div className="bg-cyber-950/80 border border-cyber-800 rounded-2xl p-4 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-1">
              Storage Engine
            </span>
            <div className="text-xs font-mono text-white font-semibold flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              <span>PVC: vcop-registry-data</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 mt-1">20Gi Standard • Delete Enabled</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {selectedRepo ? (
        /* LEVEL 2: REPOSITORY DRILL-DOWN (HARBOR REPOSITORY DETAIL VIEW) */
        <div className="space-y-5 animate-in fade-in duration-150">
          {/* Breadcrumb & Repo Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-cyber-900/60 border border-cyber-800 p-5 rounded-3xl">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setSelectedRepo(null);
                  setTagSearch('');
                }}
                className="p-2 rounded-xl bg-cyber-950 hover:bg-cyber-800 text-slate-300 hover:text-white border border-cyber-750 transition-colors"
                title="Back to All Repositories"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                  <span
                    className="hover:text-cyan-400 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedRepo(null);
                      setTagSearch('');
                    }}
                  >
                    Repositories
                  </span>
                  <span>/</span>
                  <span className="text-cyan-300 font-semibold">{selectedRepo.name}</span>
                </div>
                <h2 className="text-lg font-bold text-white font-mono mt-0.5 flex items-center gap-2.5">
                  <span>{selectedRepo.name}</span>
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-cyan-950 text-cyan-400 border border-cyan-800">
                    {selectedRepo.artifactType.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-slate-400 font-normal">
                    ({selectedRepo.tags.length} artifact{selectedRepo.tags.length === 1 ? '' : 's'})
                  </span>
                </h2>
                {selectedRepo.description && (
                  <p className="text-xs text-slate-300 mt-1 max-w-2xl">{selectedRepo.description}</p>
                )}
              </div>
            </div>

            {/* Quick Actions for this Repo */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const pullCmd =
                    selectedRepo.artifactType === 'helm-chart' || selectedRepo.name.includes('chart')
                      ? `helm pull oci://${inClusterEndpoint}/${selectedRepo.name} --version ${selectedRepo.latestTag || 'latest'}`
                      : `docker pull ${externalEndpoint}/${selectedRepo.name}:${selectedRepo.latestTag || 'latest'}`;
                  copyToClipboard(pullCmd, `repo-pull-${selectedRepo.name}`);
                }}
                className="px-3.5 py-2 bg-cyber-950 hover:bg-cyber-800 text-slate-300 text-xs font-mono rounded-xl border border-cyber-750 transition-colors flex items-center gap-2"
              >
                {copiedKey === `repo-pull-${selectedRepo.name}` ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>Copy Pull Command</span>
              </button>

              {(selectedRepo.artifactType === 'helm-chart' || selectedRepo.name.includes('chart')) && (
                <a
                  href="/apps"
                  className="px-3.5 py-2 bg-purple-950/80 hover:bg-purple-900/80 text-purple-300 text-xs font-mono font-bold rounded-xl border border-purple-800 transition-colors flex items-center gap-1.5"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Deploy as App &rarr;</span>
                </a>
              )}
            </div>
          </div>

          {/* Tags Filter & Search */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="Search tags or digests..."
                className="w-full pl-9 pr-4 py-2 bg-cyber-900/90 border border-cyber-750 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
            <span className="text-xs font-mono text-slate-400">
              Showing {selectedRepo.tags.filter((t) => t.tag.toLowerCase().includes(tagSearch.toLowerCase())).length} of{' '}
              {selectedRepo.tags.length} tags
            </span>
          </div>

          {/* Harbor-Style Artifacts / Tags Table */}
          <div className="bg-cyber-900/90 border border-cyber-750/70 rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-cyber-950/90 border-b border-cyber-800 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3.5 px-5">Tag / Version</th>
                    <th className="py-3.5 px-5">Digest (SHA-256)</th>
                    <th className="py-3.5 px-4">Artifact Type</th>
                    <th className="py-3.5 px-4">Size</th>
                    <th className="py-3.5 px-5">Created / Pushed</th>
                    <th className="py-3.5 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyber-800/60">
                  {selectedRepo.tags
                    .filter((t) => t.tag.toLowerCase().includes(tagSearch.toLowerCase()))
                    .map((tag) => {
                      const isLatest = tag.tag === selectedRepo.latestTag;
                      const isHelm = tag.artifactType === 'helm-chart' || selectedRepo.name.includes('chart');

                      return (
                        <tr key={tag.tag} className="hover:bg-cyber-800/40 transition-colors group">
                          {/* Tag Name */}
                          <td className="py-4 px-5">
                            <div className="flex items-center gap-2">
                              <Tag className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span className="text-white font-bold">{tag.tag}</span>
                              {isLatest && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                  latest
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Digest */}
                          <td className="py-4 px-5">
                            {tag.digest ? (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-slate-400 text-[11px] truncate max-w-[160px]"
                                  title={tag.digest}
                                >
                                  {tag.digest.replace('sha256:', '').slice(0, 16)}...
                                </span>
                                <button
                                  onClick={() => copyToClipboard(tag.digest || '', `digest-${tag.tag}`)}
                                  className="p-1 hover:bg-cyber-800 text-slate-500 hover:text-cyan-400 rounded transition-colors"
                                  title="Copy full digest"
                                >
                                  {copiedKey === `digest-${tag.tag}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>

                          {/* Artifact Type */}
                          <td className="py-4 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                isHelm
                                  ? 'bg-purple-950/80 text-purple-300 border border-purple-800/80'
                                  : 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/80'
                              }`}
                            >
                              {isHelm ? 'Helm Chart' : 'Container'}
                            </span>
                          </td>

                          {/* Size */}
                          <td className="py-4 px-4 text-slate-300">{formatBytes(tag.sizeBytes)}</td>

                          {/* Created */}
                          <td className="py-4 px-5 text-slate-400 text-[11px]">
                            {tag.createdAt ? new Date(tag.createdAt).toLocaleString() : 'Recent'}
                          </td>

                          {/* Actions */}
                          <td className="py-4 px-5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Copy Pull Command */}
                              <button
                                onClick={() => {
                                  const cmd = isHelm
                                    ? `helm pull oci://${inClusterEndpoint}/${selectedRepo.name} --version ${tag.tag}`
                                    : `docker pull ${externalEndpoint}/${selectedRepo.name}:${tag.tag}`;
                                  copyToClipboard(cmd, `cmd-${tag.tag}`);
                                }}
                                className="px-2.5 py-1 bg-cyber-950 hover:bg-cyber-800 text-slate-300 hover:text-white border border-cyber-750 rounded-lg text-[11px] transition-colors flex items-center gap-1"
                                title="Copy pull command for this tag"
                              >
                                {copiedKey === `cmd-${tag.tag}` ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-cyan-400" />
                                )}
                                <span>Pull</span>
                              </button>

                              {/* Inspect Manifest */}
                              {tag.rawManifest && (
                                <button
                                  onClick={() => setInspectedTag(tag)}
                                  className="p-1.5 bg-cyber-950 hover:bg-cyber-800 text-slate-400 hover:text-cyan-400 border border-cyber-750 rounded-lg transition-colors"
                                  title="Inspect OCI Manifest JSON"
                                >
                                  <FileCode className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Delete Tag */}
                              {canManage && (
                                <button
                                  onClick={() => handleDeleteTag(selectedRepo.name, tag)}
                                  disabled={deletingTag === tag.tag}
                                  className="p-1.5 bg-cyber-950 hover:bg-rose-950/80 text-slate-500 hover:text-rose-400 border border-cyber-750 hover:border-rose-800 rounded-lg transition-colors disabled:opacity-50"
                                  title="Delete this artifact tag"
                                >
                                  {deletingTag === tag.tag ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* LEVEL 1: ALL REPOSITORIES (HARBOR PROJECT CATALOG) */
        <div className="space-y-5">
          {/* Filter Tabs & Search Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-cyber-900/60 border border-cyber-800 p-4 rounded-3xl backdrop-blur-md">
            {/* Category / Type Tabs */}
            <div className="flex items-center flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedType('all')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                  selectedType === 'all'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                }`}
              >
                All Artifacts ({repositories.length})
              </button>
              <button
                onClick={() => setSelectedType('helm-chart')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
                  selectedType === 'helm-chart'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-glow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Helm Charts ({helmCount})</span>
              </button>
              <button
                onClick={() => setSelectedType('container')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
                  selectedType === 'container'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-glow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>Container Images ({containerCount})</span>
              </button>
            </div>

            {/* Search and View Mode */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter repositories..."
                  className="w-full pl-9 pr-4 py-2 bg-cyber-950 border border-cyber-750 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              <div className="flex items-center p-1 bg-cyber-950 border border-cyber-800 rounded-xl">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 rounded-lg transition-colors ${
                    viewMode === 'cards' ? 'bg-cyber-800 text-cyan-400' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Card Grid View"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-lg transition-colors ${
                    viewMode === 'table' ? 'bg-cyber-800 text-cyan-400' : 'text-slate-400 hover:text-white'
                  }`}
                  title="Detailed Table View"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Repositories Display */}
          {loading && repositories.length === 0 ? (
            <div className="text-center py-16 bg-cyber-900/50 border border-cyber-800 rounded-3xl">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
              <p className="text-sm font-mono text-slate-300">Connecting to internal OCI Registry...</p>
              <p className="text-xs font-mono text-slate-500 mt-1">Inspecting /v2/_catalog and manifest manifests</p>
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="text-center py-16 bg-cyber-900/50 border border-cyber-800 rounded-3xl p-8">
              <Server className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-white mb-1 font-mono">No OCI Artifacts Found</h3>
              <p className="text-xs text-slate-400 font-mono max-w-md mx-auto mb-5 leading-relaxed">
                Your sovereign OCI registry is running healthy, but no container images or Helm charts have been pushed
                yet.
              </p>
              <button
                onClick={() => setIsPushGuideOpen(true)}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-glow-sm inline-flex items-center gap-2"
              >
                <Terminal className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>View Push Commands Cheat Sheet</span>
              </button>
            </div>
          ) : viewMode === 'cards' ? (
            /* CARD GRID VIEW */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRepos.map((repo) => {
                const isHelm = repo.artifactType === 'helm-chart' || repo.name.includes('chart');

                return (
                  <div
                    key={repo.name}
                    className="bg-cyber-900/90 border border-cyber-750/70 hover:border-cyan-500/50 rounded-3xl p-5 flex flex-col justify-between transition-all hover:shadow-[0_0_25px_rgba(6,182,212,0.15)] group"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`p-2 rounded-xl border ${
                              isHelm
                                ? 'bg-purple-950/80 text-purple-400 border-purple-800'
                                : 'bg-cyan-950/80 text-cyan-400 border-cyan-800'
                            }`}
                          >
                            {isHelm ? <Layers className="w-4 h-4" /> : <Box className="w-4 h-4" />}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                              isHelm
                                ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                            }`}
                          >
                            {isHelm ? 'Helm Chart' : 'Container'}
                          </span>
                        </div>

                        <span className="text-[11px] font-mono text-slate-400 bg-cyber-950 px-2 py-0.5 rounded-lg border border-cyber-800">
                          {repo.tags.length} tag{repo.tags.length === 1 ? '' : 's'}
                        </span>
                      </div>

                      {/* Repository Name */}
                      <h3
                        onClick={() => setSelectedRepo(repo)}
                        className="text-base font-bold text-white font-mono group-hover:text-cyan-300 transition-colors cursor-pointer truncate"
                        title={repo.name}
                      >
                        {repo.name}
                      </h3>

                      {repo.description ? (
                        <p className="text-xs text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                          {repo.description}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 font-mono mt-1.5">
                          OCI compliant repository on port 5000
                        </p>
                      )}

                      {/* Tags Preview Pills */}
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {repo.tags.slice(0, 4).map((t) => (
                          <span
                            key={t.tag}
                            className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyber-950 border border-cyber-800 text-slate-300"
                          >
                            {t.tag}
                          </span>
                        ))}
                        {repo.tags.length > 4 && (
                          <span className="text-[10px] font-mono text-slate-500 self-center">
                            +{repo.tags.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bottom Metadata & Drill-down Button */}
                    <div className="mt-5 pt-4 border-t border-cyber-800/80 flex items-center justify-between">
                      <div className="text-[11px] font-mono text-slate-500">
                        {repo.totalSize ? formatBytes(repo.totalSize) : '—'}
                      </div>

                      <button
                        onClick={() => setSelectedRepo(repo)}
                        className="px-3 py-1.5 bg-cyber-950 hover:bg-cyber-800 text-cyan-300 hover:text-white border border-cyber-750 rounded-xl text-xs font-mono font-medium flex items-center gap-1.5 transition-colors"
                      >
                        <span>Explore Tags</span>
                        <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* DETAILED TABLE VIEW (HARBOR STYLE) */
            <div className="bg-cyber-900/90 border border-cyber-750/70 rounded-3xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-cyber-950/90 border-b border-cyber-800 text-slate-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3.5 px-5">Repository Name</th>
                      <th className="py-3.5 px-4">Type</th>
                      <th className="py-3.5 px-4">Tags Count</th>
                      <th className="py-3.5 px-4">Latest Tag</th>
                      <th className="py-3.5 px-4">Size</th>
                      <th className="py-3.5 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyber-800/60">
                    {filteredRepos.map((repo) => {
                      const isHelm = repo.artifactType === 'helm-chart' || repo.name.includes('chart');

                      return (
                        <tr key={repo.name} className="hover:bg-cyber-800/40 transition-colors group">
                          <td className="py-4 px-5">
                            <div
                              onClick={() => setSelectedRepo(repo)}
                              className="font-bold text-white hover:text-cyan-300 cursor-pointer transition-colors"
                            >
                              {repo.name}
                            </div>
                            {repo.description && (
                              <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-md">{repo.description}</p>
                            )}
                          </td>

                          <td className="py-4 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                isHelm
                                  ? 'bg-purple-950/80 text-purple-300 border border-purple-800/80'
                                  : 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/80'
                              }`}
                            >
                              {isHelm ? 'Helm Chart' : 'Container'}
                            </span>
                          </td>

                          <td className="py-4 px-4 text-slate-300">{repo.tags.length}</td>

                          <td className="py-4 px-4">
                            <span className="px-2 py-0.5 rounded bg-cyber-950 border border-cyber-800 text-cyan-300 font-bold">
                              {repo.latestTag || '—'}
                            </span>
                          </td>

                          <td className="py-4 px-4 text-slate-400">{formatBytes(repo.totalSize)}</td>

                          <td className="py-4 px-5 text-right">
                            <button
                              onClick={() => setSelectedRepo(repo)}
                              className="px-3 py-1.5 bg-cyber-950 hover:bg-cyber-800 text-cyan-300 hover:text-white border border-cyber-750 rounded-xl text-xs font-mono font-medium inline-flex items-center gap-1.5 transition-colors"
                            >
                              <span>View Artifacts</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL: Push Artifact Guide / Harbor Cheat Sheet */}
      {isPushGuideOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
            <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyan-500/40 rounded-3xl shadow-2xl p-6 sm:p-7 my-auto">
              <div className="flex items-center justify-between pb-4 border-b border-cyber-800 mb-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-cyan-500/10 rounded-2xl border border-cyan-500/30 text-cyan-400">
                    <Terminal className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-mono">Push Artifact to Registry</h3>
                    <p className="text-xs text-slate-400 font-mono">CLI instructions for Helm, Docker, Podman, and ORAS</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsPushGuideOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-cyber-800 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tool Selection Tabs */}
              <div className="flex items-center gap-2 mb-4">
                <button
                  onClick={() => setPushGuideTab('helm')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                    pushGuideTab === 'helm'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                  }`}
                >
                  Helm 3 OCI
                </button>
                <button
                  onClick={() => setPushGuideTab('docker')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                    pushGuideTab === 'docker'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                  }`}
                >
                  Docker
                </button>
                <button
                  onClick={() => setPushGuideTab('podman')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                    pushGuideTab === 'podman'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                  }`}
                >
                  Podman
                </button>
                <button
                  onClick={() => setPushGuideTab('oras')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                    pushGuideTab === 'oras'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-cyber-800'
                  }`}
                >
                  ORAS (Arbitrary OCI)
                </button>
              </div>

              {/* Instructions Code Block */}
              <div className="space-y-3">
                {pushGuideTab === 'helm' && (
                  <div>
                    <p className="text-xs text-slate-300 mb-2 leading-relaxed">
                      Package your Helm chart and push directly as an OCI artifact using standard Helm 3:
                    </p>
                    <div className="relative">
                      <pre className="bg-cyber-950 border border-cyber-800 rounded-2xl p-4 text-xs font-mono text-purple-300 overflow-x-auto whitespace-pre leading-relaxed">
{`# 1. Package your Helm chart directory
helm package ./my-chart

# 2. Push directly to the vCOp OCI registry
helm push my-chart-1.0.0.tgz oci://${externalEndpoint}/charts

# 3. Pull or deploy from anywhere in the cluster:
helm pull oci://${inClusterEndpoint}/charts/my-chart --version 1.0.0`}
                      </pre>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `helm package ./my-chart && helm push my-chart-1.0.0.tgz oci://${externalEndpoint}/charts`,
                            'guide-helm'
                          )
                        }
                        className="absolute top-3 right-3 p-1.5 bg-cyber-900 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-700 transition-colors"
                        title="Copy snippet"
                      >
                        {copiedKey === 'guide-helm' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {pushGuideTab === 'docker' && (
                  <div>
                    <p className="text-xs text-slate-300 mb-2 leading-relaxed">
                      Tag and push any container image to the internal registry:
                    </p>
                    <div className="relative">
                      <pre className="bg-cyber-950 border border-cyber-800 rounded-2xl p-4 text-xs font-mono text-blue-300 overflow-x-auto whitespace-pre leading-relaxed">
{`# 1. Tag existing local image with registry host
docker tag my-app:v1.0.0 ${externalEndpoint}/my-app:v1.0.0

# 2. Push to vCOp internal registry
docker push ${externalEndpoint}/my-app:v1.0.0

# 3. Pull in tenant pods:
# image: ${inClusterEndpoint}/my-app:v1.0.0`}
                      </pre>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `docker tag my-app:v1.0.0 ${externalEndpoint}/my-app:v1.0.0 && docker push ${externalEndpoint}/my-app:v1.0.0`,
                            'guide-docker'
                          )
                        }
                        className="absolute top-3 right-3 p-1.5 bg-cyber-900 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-700 transition-colors"
                        title="Copy snippet"
                      >
                        {copiedKey === 'guide-docker' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {pushGuideTab === 'podman' && (
                  <div>
                    <p className="text-xs text-slate-300 mb-2 leading-relaxed">
                      Rootless container operations with Podman:
                    </p>
                    <div className="relative">
                      <pre className="bg-cyber-950 border border-cyber-800 rounded-2xl p-4 text-xs font-mono text-amber-300 overflow-x-auto whitespace-pre leading-relaxed">
{`# 1. Tag image
podman tag my-app:v1.0.0 ${externalEndpoint}/my-app:v1.0.0

# 2. Push with plain HTTP support
podman push --tls-verify=false ${externalEndpoint}/my-app:v1.0.0`}
                      </pre>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `podman push --tls-verify=false ${externalEndpoint}/my-app:v1.0.0`,
                            'guide-podman'
                          )
                        }
                        className="absolute top-3 right-3 p-1.5 bg-cyber-900 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-700 transition-colors"
                        title="Copy snippet"
                      >
                        {copiedKey === 'guide-podman' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {pushGuideTab === 'oras' && (
                  <div>
                    <p className="text-xs text-slate-300 mb-2 leading-relaxed">
                      Store arbitrary configuration files, Wasm binaries, or GitOps manifests using CNCF ORAS:
                    </p>
                    <div className="relative">
                      <pre className="bg-cyber-950 border border-cyber-800 rounded-2xl p-4 text-xs font-mono text-cyan-300 overflow-x-auto whitespace-pre leading-relaxed">
{`# 1. Push arbitrary file as an OCI artifact
oras push --plain-http ${externalEndpoint}/artifacts/config:v1.0 config.yaml

# 2. Pull artifact anywhere:
oras pull --plain-http ${inClusterEndpoint}/artifacts/config:v1.0`}
                      </pre>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            `oras push --plain-http ${externalEndpoint}/artifacts/config:v1.0 config.yaml`,
                            'guide-oras'
                          )
                        }
                        className="absolute top-3 right-3 p-1.5 bg-cyber-900 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-700 transition-colors"
                        title="Copy snippet"
                      >
                        {copiedKey === 'guide-oras' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-cyber-800 flex justify-end">
                <button
                  onClick={() => setIsPushGuideOpen(false)}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* MODAL: Inspect OCI Manifest JSON */}
      {inspectedTag && inspectedTag.rawManifest && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
            <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-750 rounded-3xl shadow-2xl p-6 my-auto">
              <div className="flex items-center justify-between pb-4 border-b border-cyber-800 mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400">
                    <FileCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                      <span>{selectedRepo?.name}:{inspectedTag.tag}</span>
                    </h3>
                    <p className="text-xs text-slate-400 font-mono">Raw OCI Image / Artifact Manifest</p>
                  </div>
                </div>
                <button
                  onClick={() => setInspectedTag(null)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-cyber-800 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="relative">
                <pre className="bg-cyber-950 border border-cyber-800 rounded-2xl p-4 text-xs font-mono text-cyan-300 overflow-x-auto whitespace-pre leading-relaxed max-h-96">
                  {JSON.stringify(inspectedTag.rawManifest, null, 2)}
                </pre>
                <button
                  onClick={() =>
                    copyToClipboard(JSON.stringify(inspectedTag.rawManifest, null, 2), 'manifest-json')
                  }
                  className="absolute top-3 right-3 p-1.5 bg-cyber-900 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-700 transition-colors"
                  title="Copy JSON"
                >
                  {copiedKey === 'manifest-json' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                </button>
              </div>

              <div className="mt-4 pt-3 border-t border-cyber-800 flex justify-end">
                <button
                  onClick={() => setInspectedTag(null)}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
