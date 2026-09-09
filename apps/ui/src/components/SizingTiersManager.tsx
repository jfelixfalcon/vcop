import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Check,
  ShieldCheck,
  RefreshCw,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Database,
  HardDrive,
  Sparkles,
  Server,
  Zap,
} from 'lucide-react';
import type { PresetDetails } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface SizingTiersManagerProps {
  initialTiers: PresetDetails[];
  isAdmin: boolean;
}

export function SizingTiersManager({
  initialTiers,
  isAdmin,
}: SizingTiersManagerProps) {
  const [tiers, setTiers] = useState<PresetDetails[]>(initialTiers);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PresetDetails | null>(null);

  // Form fields
  const [formData, setFormData] = useState<{
    id: string;
    name: string;
    cpu: string;
    memory: string;
    storage: string;
    ha: boolean;
    badge: string;
    description: string;
    isDefault: boolean;
    requestsCPU: string;
    limitsCPU: string;
    requestsMemory: string;
    limitsMemory: string;
    requestsStorage: string;
    pods: string;
  }>({
    id: '',
    name: '',
    cpu: '2 vCPU',
    memory: '4 GB RAM',
    storage: '10 GB NVMe',
    ha: false,
    badge: 'Standard',
    description: '',
    isDefault: false,
    requestsCPU: '1',
    limitsCPU: '2',
    requestsMemory: '2Gi',
    limitsMemory: '4Gi',
    requestsStorage: '10Gi',
    pods: '15',
  });

  const showNotification = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4500);
  };

  const handleOpenCreateModal = () => {
    setEditingTier(null);
    setFormData({
      id: '',
      name: '',
      cpu: '4 vCPU',
      memory: '8 GB RAM',
      storage: '20 GB NVMe',
      ha: false,
      badge: 'Custom',
      description: 'Custom hardware tier for dedicated application workloads.',
      isDefault: tiers.length === 0,
      requestsCPU: '2',
      limitsCPU: '4',
      requestsMemory: '4Gi',
      limitsMemory: '8Gi',
      requestsStorage: '20Gi',
      pods: '25',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (t: PresetDetails) => {
    setEditingTier(t);
    setFormData({
      id: t.id,
      name: t.name,
      cpu: t.cpu,
      memory: t.memory,
      storage: t.storage,
      ha: t.ha,
      badge: t.badge || '',
      description: t.description || '',
      isDefault: Boolean(t.isDefault),
      requestsCPU: t.requestsCPU || '1',
      limitsCPU: t.limitsCPU || '2',
      requestsMemory: t.requestsMemory || '2Gi',
      limitsMemory: t.limitsMemory || '4Gi',
      requestsStorage: t.requestsStorage || '10Gi',
      pods: t.pods || '20',
    });
    setIsModalOpen(true);
  };

  const handleSetDefault = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/sizing-tiers/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update default sizing tier.');
      }
      setTiers(data.data);
      showNotification('success', 'Default sizing tier updated successfully.');
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete sizing tier "${name}"?`)) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/admin/sizing-tiers?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete sizing tier.');
      }
      setTiers(data.data);
      showNotification('success', `Sizing tier "${name}" deleted successfully.`);
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      showNotification('error', 'Sizing tier name is required.');
      return;
    }

    const id = formData.id.trim()
      ? formData.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      : formData.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const payload: Partial<PresetDetails> & { id: string; name: string } = {
      id,
      name: formData.name.trim(),
      cpu: formData.cpu.trim(),
      memory: formData.memory.trim(),
      storage: formData.storage.trim(),
      ha: formData.ha,
      badge: formData.badge.trim() || 'Standard',
      description: formData.description.trim(),
      isDefault: formData.isDefault,
      requestsCPU: formData.requestsCPU.trim() || '1',
      limitsCPU: formData.limitsCPU.trim() || '2',
      requestsMemory: formData.requestsMemory.trim() || '2Gi',
      limitsMemory: formData.limitsMemory.trim() || '4Gi',
      requestsStorage: formData.requestsStorage.trim() || '10Gi',
      pods: formData.pods.trim() || '20',
    };

    try {
      setLoading(true);
      const res = await fetch('/api/admin/sizing-tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save sizing tier.');
      }
      setTiers(data.data);
      setIsModalOpen(false);
      showNotification('success', `Sizing tier "${payload.name}" saved successfully.`);
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const haCount = tiers.filter((t) => t.ha).length;
  const singleCount = tiers.length - haCount;

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {feedback && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between shadow-lg transition-all animate-in fade-in slide-in-from-top-2 duration-200 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/80 border-rose-500/40 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-3">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="text-sm font-medium font-mono">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs text-slate-400 hover:text-white px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Hero Header */}
      <div className="p-6 rounded-3xl bg-cyber-900/60 border border-cyber-800 backdrop-blur-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-purple-500/10 via-cyan-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-mono">
              <Zap className="w-3.5 h-3.5" />
              <span>Compute, Memory & Topology Governance</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Cluster Sizing Tiers
            </h2>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              Define hardware capacity tiers, CPU/memory limits, storage sizes, and high-availability topologies.
              Configured tiers are immediately available when provisioning clusters and configuring baselines.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-500/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] font-mono shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>New Sizing Tier</span>
            </button>
          )}
        </div>

        {/* Overview Stats Bar */}
        <div className="mt-6 pt-5 border-t border-cyber-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-cyber-950/60 border border-cyber-800/60">
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <div className="text-slate-400 text-[11px]">Total Tiers</div>
              <div className="text-white font-bold text-sm">{tiers.length} Configured</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-2xl bg-cyber-950/60 border border-cyber-800/60">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="text-slate-400 text-[11px]">Production HA (3-Node)</div>
              <div className="text-emerald-300 font-bold text-sm">{haCount} Tiers</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-2xl bg-cyber-950/60 border border-cyber-800/60">
            <Server className="w-4 h-4 text-purple-400 shrink-0" />
            <div>
              <div className="text-slate-400 text-[11px]">Single-Node Footprint</div>
              <div className="text-purple-300 font-bold text-sm">{singleCount} Tiers</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sizing Tiers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className={`p-5 rounded-3xl border transition-all duration-300 flex flex-col justify-between relative group ${
              tier.isDefault
                ? 'bg-gradient-to-b from-cyber-900/90 to-cyber-950/90 border-purple-500/50 shadow-xl shadow-purple-500/10'
                : 'bg-cyber-900/40 hover:bg-cyber-900/60 border-cyber-800 hover:border-cyber-700'
            }`}
          >
            <div>
              {/* Top Bar: Badges & ID */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {tier.isDefault ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 text-[10px] font-mono font-bold tracking-wide shadow-sm">
                      <Sparkles className="w-3 h-3 text-purple-400" />
                      Default Tier
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyber-950 text-slate-400 border border-cyber-800 text-[10px] font-mono">
                      Optional
                    </span>
                  )}

                  {tier.badge && (
                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono">
                      {tier.badge}
                    </span>
                  )}

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                      tier.ha
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-semibold'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/60'
                    }`}
                  >
                    {tier.ha ? '3x Quorum HA' : '1x Single Node'}
                  </span>
                </div>

                <span className="text-[10px] font-mono text-slate-500 font-semibold uppercase">
                  {tier.id}
                </span>
              </div>

              {/* Title & Description */}
              <h3 className="text-lg font-bold text-white mb-1 group-hover:text-purple-300 transition-colors">
                {tier.name}
              </h3>
              <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                {tier.description || 'Predefined compute & storage allocation tier.'}
              </p>

              {/* Specs Grid */}
              <div className="grid grid-cols-3 gap-2 text-[11px] font-mono mb-4">
                <div className="p-2.5 rounded-2xl bg-cyber-950/60 border border-cyber-800/80 text-center">
                  <div className="flex items-center justify-center gap-1 text-cyan-400 mb-1">
                    <Cpu className="w-3.5 h-3.5" />
                    <span className="text-[10px] text-slate-500">CPU</span>
                  </div>
                  <div className="text-white font-bold truncate">{tier.cpu}</div>
                </div>

                <div className="p-2.5 rounded-2xl bg-cyber-950/60 border border-cyber-800/80 text-center">
                  <div className="flex items-center justify-center gap-1 text-purple-400 mb-1">
                    <Database className="w-3.5 h-3.5" />
                    <span className="text-[10px] text-slate-500">Memory</span>
                  </div>
                  <div className="text-white font-bold truncate">{tier.memory}</div>
                </div>

                <div className="p-2.5 rounded-2xl bg-cyber-950/60 border border-cyber-800/80 text-center">
                  <div className="flex items-center justify-center gap-1 text-emerald-400 mb-1">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span className="text-[10px] text-slate-500">Storage</span>
                  </div>
                  <div className="text-white font-bold truncate">{tier.storage}</div>
                </div>
              </div>

              {/* Quota Defaults Breakdown */}
              <div className="p-3 rounded-2xl bg-cyber-950/80 border border-cyber-800/80 space-y-1.5 mb-4 text-[11px] font-mono">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Quota Request / Limit:</span>
                  <span className="text-cyan-300 font-semibold">
                    {tier.requestsCPU || '1'} / {tier.limitsCPU || '2'} CPU • {tier.requestsMemory || '2Gi'} / {tier.limitsMemory || '4Gi'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-500 pt-1 border-t border-cyber-900">
                  <span>Default Max Pods:</span>
                  <span className="text-slate-300 font-semibold">{tier.pods || '20'} Pods</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 border-t border-cyber-800 flex items-center justify-between gap-2">
              {!tier.isDefault ? (
                <button
                  type="button"
                  disabled={loading || !isAdmin}
                  onClick={() => handleSetDefault(tier.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyber-950 hover:bg-cyber-800 border border-cyber-700 text-xs font-mono text-slate-300 hover:text-white transition-all disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5 text-purple-400" />
                  <span>Set Default</span>
                </button>
              ) : (
                <span className="text-[11px] font-mono text-purple-400/80 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Default Tier
                </span>
              )}

              {isAdmin && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(tier)}
                    className="p-2 rounded-xl bg-cyber-950 hover:bg-cyber-800 text-slate-400 hover:text-slate-200 transition-colors border border-cyber-800"
                    title="Edit sizing tier"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={loading || tiers.length <= 1}
                    onClick={() => handleDelete(tier.id, tier.name)}
                    className="p-2 rounded-xl bg-cyber-950 hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors border border-cyber-800 hover:border-rose-500/40 disabled:opacity-30"
                    title="Delete sizing tier"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit Sizing Tier Modal */}
      {isModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-cyber-900 border border-cyber-700/80 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl my-auto">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-b from-cyber-800/80 to-cyber-900/80 border-b border-cyber-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-purple-400" />
                  <span>{editingTier ? `Edit Sizing Tier: ${editingTier.name}` : 'New Sizing Tier'}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Configure hardware resources, HA topology, and resource quota defaults.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-cyber-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveModal} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Identity & Naming */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Tier Display Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. GPU Accelerated High-Compute"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Tier ID (Slug) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    placeholder="e.g. gpu-workload (lowercase letters, numbers, hyphens)"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Badge & Description */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Badge / Tag
                  </label>
                  <input
                    type="text"
                    value={formData.badge}
                    onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                    placeholder="e.g. High Compute, Standard"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description for developers and non-technical users"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Hardware Specifications */}
              <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-300 font-mono">
                    <Server className="w-4 h-4 text-purple-400" />
                    <span>Hardware Allocations & Labels</span>
                  </div>
                  <span className="text-[10px] font-mono text-purple-400 uppercase">Hardware Presets</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 font-mono">
                      Compute (CPU) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.cpu}
                      onChange={(e) => setFormData({ ...formData, cpu: e.target.value })}
                      placeholder="e.g. 4 vCPU or 4"
                      className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 font-mono">
                      Memory (RAM) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.memory}
                      onChange={(e) => setFormData({ ...formData, memory: e.target.value })}
                      placeholder="e.g. 8 GB RAM or 8Gi"
                      className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300 font-mono">
                      Disk Storage <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.storage}
                      onChange={(e) => setFormData({ ...formData, storage: e.target.value })}
                      placeholder="e.g. 25 GB NVMe or 25Gi"
                      className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-purple-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* High Availability Toggle */}
                <div className="pt-2 border-t border-purple-900/60">
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-cyber-950 border border-purple-500/20 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.ha}
                      onChange={(e) => setFormData({ ...formData, ha: e.target.checked })}
                      className="rounded bg-cyber-900 border-cyber-700 text-purple-500 focus:ring-purple-500"
                    />
                    <div className="text-xs font-mono">
                      <div className="text-white font-medium flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>High Availability (HA) Control Plane</span>
                      </div>
                      <div className="text-slate-400 text-[10px]">
                        {formData.ha
                          ? 'Deploys 3x etcd quorum nodes, 3x vCluster syncer replicas, and 3x CoreDNS for zero-single-point-of-failure.'
                          : 'Deploys 1x etcd, 1x vCluster control plane, and 1x CoreDNS for lightweight efficiency.'}
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Resource Quota Enforcement Defaults */}
              <div className="p-4 rounded-2xl bg-cyber-950 border border-cyber-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-300 font-mono">
                    <Cpu className="w-4 h-4 text-cyan-400" />
                    <span>Resource Quota Baseline Limits</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Kubernetes ResourceQuota</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">CPU Requests</label>
                    <input
                      type="text"
                      value={formData.requestsCPU}
                      onChange={(e) => setFormData({ ...formData, requestsCPU: e.target.value })}
                      placeholder="e.g. 2"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-cyber-900 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">CPU Limits</label>
                    <input
                      type="text"
                      value={formData.limitsCPU}
                      onChange={(e) => setFormData({ ...formData, limitsCPU: e.target.value })}
                      placeholder="e.g. 4"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-cyber-900 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">Memory Requests</label>
                    <input
                      type="text"
                      value={formData.requestsMemory}
                      onChange={(e) => setFormData({ ...formData, requestsMemory: e.target.value })}
                      placeholder="e.g. 4Gi"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-cyber-900 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">Memory Limits</label>
                    <input
                      type="text"
                      value={formData.limitsMemory}
                      onChange={(e) => setFormData({ ...formData, limitsMemory: e.target.value })}
                      placeholder="e.g. 8Gi"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-cyber-900 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">Storage Requests</label>
                    <input
                      type="text"
                      value={formData.requestsStorage}
                      onChange={(e) => setFormData({ ...formData, requestsStorage: e.target.value })}
                      placeholder="e.g. 20Gi"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-cyber-900 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">Max Pods</label>
                    <input
                      type="text"
                      value={formData.pods}
                      onChange={(e) => setFormData({ ...formData, pods: e.target.value })}
                      placeholder="e.g. 25"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-cyber-900 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Set as Default Checkbox */}
              <div className="pt-2 border-t border-cyber-800">
                <label className="flex items-center gap-3 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded bg-cyber-900 border-cyber-700 text-purple-500 focus:ring-purple-500"
                  />
                  <div className="text-xs font-mono">
                    <div className="text-white font-medium flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                      <span>Set as Default Sizing Tier</span>
                    </div>
                    <div className="text-slate-500 text-[10px]">
                      This tier will be the pre-selected hardware size when creating new clusters or baselines.
                    </div>
                  </div>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="pt-4 border-t border-cyber-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 text-xs font-mono text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs font-mono shadow-lg shadow-purple-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Sizing Tier</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
      )}
    </div>
  );
}
