import React, { useState, useEffect } from 'react';
import {
  Layers,
  Cpu,
  Plus,
  Trash2,
  Star,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
} from 'lucide-react';
import type { VersionItem, VersionRegistry, VersionTag } from '../lib/types';

interface Props {
  initialRegistry?: VersionRegistry;
  isAdmin: boolean;
}

export const VersionRegistryManager: React.FC<Props> = ({ initialRegistry, isAdmin }) => {
  const [registry, setRegistry] = useState<VersionRegistry | null>(initialRegistry || null);
  const [loading, setLoading] = useState<boolean>(!initialRegistry);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalType, setModalType] = useState<'k8s' | 'vcluster'>('k8s');
  const [versionInput, setVersionInput] = useState<string>('');
  const [labelInput, setLabelInput] = useState<string>('');
  const [tagInput, setTagInput] = useState<VersionTag>('stable');
  const [notesInput, setNotesInput] = useState<string>('');
  const [isDefaultInput, setIsDefaultInput] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'k8s' | 'vcluster'; version: string } | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Fetch registry
  const fetchRegistry = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/versions');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch version registry');
      }
      setRegistry(data.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialRegistry) {
      fetchRegistry();
    }
  }, []);

  const openAddModal = (type: 'k8s' | 'vcluster') => {
    setModalType(type);
    setVersionInput('');
    setLabelInput('');
    setTagInput('stable');
    setNotesInput('');
    setIsDefaultInput(false);
    setIsModalOpen(true);
    setError(null);
    setSuccessMsg(null);
  };

  const handleSaveVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionInput.trim()) {
      setError('Version identifier is required (e.g. v1.33.0 or 0.37.0)');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        action: 'add',
        type: modalType,
        item: {
          version: versionInput.trim(),
          label: labelInput.trim() || versionInput.trim(),
          tag: isDefaultInput ? 'default' : tagInput,
          isDefault: isDefaultInput,
          notes: notesInput.trim(),
        },
      };

      const res = await fetch('/api/admin/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save version');
      }

      setRegistry(data.data);
      setIsModalOpen(false);
      setSuccessMsg(`Version ${versionInput.trim()} added successfully to ${modalType === 'k8s' ? 'Kubernetes' : 'vCluster'} registry.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (type: 'k8s' | 'vcluster', version: string) => {
    try {
      setError(null);
      const res = await fetch('/api/admin/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setDefault',
          type,
          version,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to set default version');
      }

      setRegistry(data.data);
      setSuccessMsg(`Set ${version} as the active default for ${type === 'k8s' ? 'Kubernetes control plane' : 'vCluster engine'}.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/versions?type=${deleteTarget.type}&version=${encodeURIComponent(deleteTarget.version)}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete version');
      }

      setRegistry(data.data);
      setDeleteTarget(null);
      setSuccessMsg(`Version ${deleteTarget.version} removed from registry.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const getTagBadge = (tag?: VersionTag, isDefault?: boolean) => {
    if (isDefault || tag === 'default') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-sm">
          <Star className="w-3 h-3 fill-cyan-400 text-cyan-400" />
          Default
        </span>
      );
    }
    switch (tag) {
      case 'lts':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
            LTS
          </span>
        );
      case 'preview':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Preview
          </span>
        );
      case 'deprecated':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
            Deprecated
          </span>
        );
      case 'stable':
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Stable
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-cyber-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400 shadow-glow-sm">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Version & Upgrade Registry
                <span className="text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-cyber-800 text-slate-300 border border-cyber-700">
                  Dynamic Operator
                </span>
              </h1>
              <p className="text-xs font-mono text-slate-400 mt-1">
                Configure supported Kubernetes control planes and vCluster engines for provisioning & upgrades.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchRegistry}
            disabled={loading}
            className="px-3 py-1.5 bg-cyber-900 hover:bg-cyber-850 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-2 transition-all disabled:opacity-50"
            title="Reload from Kubernetes ConfigMap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Sync
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Quick Summary Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-cyber-900/60 border border-cyber-700/60 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Default Kubernetes CP</div>
              <div className="text-base font-mono font-bold text-white">
                {registry?.kubernetesVersions.find(v => v.isDefault)?.version || 'v1.31.0'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-slate-500">Available Channels</div>
            <div className="text-xs font-mono text-cyan-400 font-semibold">
              {registry?.kubernetesVersions.length || 0} Versions
            </div>
          </div>
        </div>

        <div className="p-4 bg-cyber-900/60 border border-cyber-700/60 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Default vCluster Engine</div>
              <div className="text-base font-mono font-bold text-white">
                {registry?.vclusterVersions.find(v => v.isDefault)?.version || '0.36.0'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-slate-500">Available Engines</div>
            <div className="text-xs font-mono text-purple-400 font-semibold">
              {registry?.vclusterVersions.length || 0} Versions
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: Kubernetes Control Plane Versions */}
      <div className="bg-cyber-900/80 border border-cyber-700/70 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-cyber-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              Kubernetes Control Plane Versions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Defines the Kubernetes API server & distro version inside guest virtual clusters.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={() => openAddModal('k8s')}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs font-mono rounded-xl shadow-glow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Add K8s Version
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {registry?.kubernetesVersions.map((item) => (
            <div
              key={item.version}
              className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                item.isDefault
                  ? 'bg-cyan-950/20 border-cyan-500/50 shadow-glow-sm'
                  : 'bg-cyber-850/80 border-cyber-800 hover:border-cyber-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-mono font-bold text-white flex items-center gap-1.5">
                    {item.version}
                  </span>
                  {getTagBadge(item.tag, item.isDefault)}
                </div>

                <div className="text-xs font-semibold text-slate-300 mb-1">
                  {item.label || item.version}
                </div>

                {item.notes && (
                  <p className="text-[11px] text-slate-400 font-mono line-clamp-2 mt-1">
                    {item.notes}
                  </p>
                )}
              </div>

              {isAdmin && (
                <div className="mt-4 pt-3 border-t border-cyber-800/80 flex items-center justify-between gap-2">
                  {!item.isDefault ? (
                    <button
                      type="button"
                      onClick={() => handleSetDefault('k8s', item.version)}
                      className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
                    >
                      <Star className="w-3.5 h-3.5" />
                      Set Default
                    </button>
                  ) : (
                    <span className="text-[11px] font-mono text-cyan-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                      Active Default
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ type: 'k8s', version: item.version })}
                    disabled={(registry?.kubernetesVersions.length || 0) <= 1}
                    className="p-1 text-slate-500 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors"
                    title="Remove version from registry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2: vCluster Engine Versions */}
      <div className="bg-cyber-900/80 border border-cyber-700/70 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-cyber-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              vCluster OSS Engine Versions
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Syncer container versions and virtual cluster engine releases supported across the fleet.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={() => openAddModal('vcluster')}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs font-mono rounded-xl shadow-glow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Engine Version
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {registry?.vclusterVersions.map((item) => (
            <div
              key={item.version}
              className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                item.isDefault
                  ? 'bg-purple-950/20 border-purple-500/50 shadow-glow-sm'
                  : 'bg-cyber-850/80 border-cyber-800 hover:border-cyber-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-mono font-bold text-white flex items-center gap-1.5">
                    {item.version}
                  </span>
                  {getTagBadge(item.tag, item.isDefault)}
                </div>

                <div className="text-xs font-semibold text-slate-300 mb-1">
                  {item.label || item.version}
                </div>

                {item.notes && (
                  <p className="text-[11px] text-slate-400 font-mono line-clamp-2 mt-1">
                    {item.notes}
                  </p>
                )}
              </div>

              {isAdmin && (
                <div className="mt-4 pt-3 border-t border-cyber-800/80 flex items-center justify-between gap-2">
                  {!item.isDefault ? (
                    <button
                      type="button"
                      onClick={() => handleSetDefault('vcluster', item.version)}
                      className="text-[11px] font-mono text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
                    >
                      <Star className="w-3.5 h-3.5" />
                      Set Default
                    </button>
                  ) : (
                    <span className="text-[11px] font-mono text-purple-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                      Active Default
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ type: 'vcluster', version: item.version })}
                    disabled={(registry?.vclusterVersions.length || 0) <= 1}
                    className="p-1 text-slate-500 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors"
                    title="Remove version from registry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* MODAL: Add Version */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-cyan-400" />
                  Add {modalType === 'k8s' ? 'Kubernetes Version' : 'vCluster Engine Version'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Make a new version available for cluster creation and zero-downtime rolling upgrades.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVersion} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Version Identifier <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={modalType === 'k8s' ? 'e.g. v1.33.0 or v1.32.2' : 'e.g. 0.37.0 or 0.36.1'}
                  value={versionInput}
                  onChange={(e) => setVersionInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Display Label
                </label>
                <input
                  type="text"
                  placeholder={modalType === 'k8s' ? 'e.g. v1.33.0 (Next-Gen)' : 'e.g. 0.37.0 (Fast Syncer)'}
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Release Channel / Classification
                </label>
                <select
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value as VersionTag)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="stable">Stable</option>
                  <option value="lts">Long-Term Support (LTS)</option>
                  <option value="preview">Preview / Experimental</option>
                  <option value="deprecated">Deprecated</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Description / Release Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional details, compatibility guidance, or notable features..."
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefaultInput}
                    onChange={(e) => setIsDefaultInput(e.target.checked)}
                    className="w-4 h-4 rounded border-cyber-700 bg-cyber-950 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300">
                    Set as active default version for newly provisioned clusters
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-cyber-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-glow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Register Version
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Delete */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-rose-500/10 rounded-xl border border-rose-500/30 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Remove Version?</h3>
                <p className="text-xs text-slate-400">This will remove the version from future creation & upgrade selectors.</p>
              </div>
            </div>

            <p className="text-xs font-mono text-slate-300 bg-cyber-950 p-3 rounded-xl border border-cyber-800 mb-5">
              Removing: <span className="font-bold text-white">{deleteTarget.version}</span> ({deleteTarget.type === 'k8s' ? 'Kubernetes Control Plane' : 'vCluster Engine'})
            </p>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
