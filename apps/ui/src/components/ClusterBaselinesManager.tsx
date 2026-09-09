import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Check,
  Globe,
  Sliders,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  Trash2,
  Edit2,
  Copy,
  CheckCircle2,
  AlertCircle,
  Clock,
  Cpu,
  Database,
  ArrowRight,
  ExternalLink,
  Info,
} from 'lucide-react';
import type { ClusterBaseline, SizePreset, StorageClassInfo, PresetDetails } from '../lib/types';
import { computeClusterFqdn } from '../lib/baseline-utils';

interface ClusterBaselinesManagerProps {
  initialBaselines: ClusterBaseline[];
  initialSizingTiers?: PresetDetails[];
  isAdmin: boolean;
}

export function ClusterBaselinesManager({
  initialBaselines,
  initialSizingTiers = [],
  isAdmin,
}: ClusterBaselinesManagerProps) {
  const [baselines, setBaselines] = useState<ClusterBaseline[]>(initialBaselines);
  const [sizingTiers, setSizingTiers] = useState<PresetDetails[]>(initialSizingTiers);
  const [storageClasses, setStorageClasses] = useState<StorageClassInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load cluster storage classes and sizing tiers if needed
  React.useEffect(() => {
    if (sizingTiers.length === 0) {
      fetch('/api/admin/sizing-tiers')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.data)) {
            setSizingTiers(data.data);
          }
        })
        .catch((e) => console.warn('Failed to fetch sizing tiers:', e));
    }
    fetch('/api/cluster/storage-classes')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setStorageClasses(data.data);
        }
      })
      .catch((e) => console.warn('Failed to fetch storage classes:', e));
  }, []);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBaseline, setEditingBaseline] = useState<ClusterBaseline | null>(null);

  // Form fields
  const [formData, setFormData] = useState<{
    id: string;
    name: string;
    description: string;
    badge: string;
    isDefault: boolean;
    baseDomain: string;
    preset: SizePreset;
    environment: 'development' | 'staging' | 'production';
    kubernetesVersion: string;
    vclusterVersion: string;
    enableMonitoringAndDNS: boolean;
    autoSleep: boolean;
    enableIstio: boolean;
    certIssuer: string;
    certIssuerKind: 'ClusterIssuer' | 'Issuer';
    enableBackups: boolean;
    backupSchedule: string;
    backupRetention: number;
    requestsCPU: string;
    limitsCPU: string;
    requestsMemory: string;
    limitsMemory: string;
    requestsStorage: string;
    storageClass: string;
    etcdStorageClass: string;
  }>({
    id: '',
    name: '',
    description: '',
    badge: '',
    isDefault: false,
    baseDomain: 'test.example.com',
    preset: 'normal',
    environment: 'development',
    kubernetesVersion: 'v1.31.0',
    vclusterVersion: '0.36.0',
    enableMonitoringAndDNS: true,
    autoSleep: true,
    enableIstio: true,
    certIssuer: 'letsencrypt-staging',
    certIssuerKind: 'ClusterIssuer',
    enableBackups: true,
    backupSchedule: 'daily',
    backupRetention: 7,
    requestsCPU: '2',
    limitsCPU: '4',
    requestsMemory: '4Gi',
    limitsMemory: '8Gi',
    requestsStorage: '10Gi',
    storageClass: '',
    etcdStorageClass: '',
  });

  // Sample cluster name for interactive FQDN preview
  const [previewClusterName, setPreviewClusterName] = useState('demo-cluster');
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4500);
  };

  const handleOpenCreateModal = () => {
    setEditingBaseline(null);
    setFormData({
      id: '',
      name: '',
      description: 'Preconfigured baseline for non-technical users with automated wildcard Ingress.',
      badge: 'Quick Launch',
      isDefault: baselines.length === 0,
      baseDomain: 'test.example.com',
      preset: 'normal',
      environment: 'development',
      kubernetesVersion: 'v1.31.0',
      vclusterVersion: '0.36.0',
      enableMonitoringAndDNS: true,
      autoSleep: true,
      enableIstio: true,
      certIssuer: 'letsencrypt-staging',
      certIssuerKind: 'ClusterIssuer',
      enableBackups: true,
      backupSchedule: 'daily',
      backupRetention: 7,
      requestsCPU: '2',
      limitsCPU: '4',
      requestsMemory: '4Gi',
      limitsMemory: '8Gi',
      requestsStorage: '10Gi',
      storageClass: '',
      etcdStorageClass: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (b: ClusterBaseline) => {
    setEditingBaseline(b);
    setFormData({
      id: b.id,
      name: b.name,
      description: b.description,
      badge: b.badge || '',
      isDefault: b.isDefault,
      baseDomain: b.baseDomain || 'test.example.com',
      preset: b.preset || 'normal',
      environment: b.environment || 'development',
      kubernetesVersion: b.kubernetesVersion || 'v1.31.0',
      vclusterVersion: b.vclusterVersion || '0.36.0',
      enableMonitoringAndDNS: b.enableMonitoringAndDNS ?? true,
      autoSleep: b.autoSleep ?? false,
      enableIstio: b.istio?.enabled ?? true,
      certIssuer: b.istio?.certificateIssuer || 'letsencrypt-staging',
      certIssuerKind: b.istio?.certificateIssuerKind || 'ClusterIssuer',
      enableBackups: b.disasterRecovery?.enabled ?? true,
      backupSchedule: b.disasterRecovery?.schedule || 'daily',
      backupRetention: b.disasterRecovery?.retentionCount || 7,
      requestsCPU: b.policies?.resourceQuota?.requestsCPU || '2',
      limitsCPU: b.policies?.resourceQuota?.limitsCPU || '4',
      requestsMemory: b.policies?.resourceQuota?.requestsMemory || '4Gi',
      limitsMemory: b.policies?.resourceQuota?.limitsMemory || '8Gi',
      requestsStorage: b.policies?.resourceQuota?.requestsStorage || '10Gi',
      storageClass: b.storageClass || '',
      etcdStorageClass: b.etcdStorageClass || '',
    });
    setIsModalOpen(true);
  };

  const handleSetDefault = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/baselines/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update default baseline.');
      }
      setBaselines(data.data);
      showNotification('success', 'Default cluster baseline updated successfully.');
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete baseline "${name}"?`)) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/admin/baselines?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete baseline.');
      }
      setBaselines(data.data);
      showNotification('success', `Baseline "${name}" removed.`);
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      showNotification('error', 'Baseline name is required.');
      return;
    }

    const id = formData.id.trim()
      ? formData.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      : formData.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const payload: Partial<ClusterBaseline> & { id: string; name: string } = {
      id,
      name: formData.name.trim(),
      description: formData.description.trim(),
      badge: formData.badge.trim() || undefined,
      isDefault: formData.isDefault,
      baseDomain: formData.baseDomain.trim().replace(/^\*\.?/, ''),
      preset: formData.preset,
      environment: formData.environment,
      kubernetesVersion: formData.kubernetesVersion,
      vclusterVersion: formData.vclusterVersion,
      enableMonitoringAndDNS: formData.enableMonitoringAndDNS,
      autoSleep: formData.autoSleep,
      storageClass: formData.storageClass.trim() || undefined,
      etcdStorageClass: formData.etcdStorageClass.trim() || undefined,
      istio: {
        enabled: formData.enableIstio,
        certificateIssuer: formData.certIssuer.trim() || undefined,
        certificateIssuerKind: formData.certIssuerKind,
        serviceType: formData.preset === 'ha' ? 'LoadBalancer' : 'ClusterIP',
      },
      disasterRecovery: {
        enabled: formData.enableBackups,
        schedule: formData.backupSchedule,
        retentionCount: Number(formData.backupRetention) || 7,
      },
      policies: {
        resourceQuota: {
          requestsCPU: formData.requestsCPU,
          limitsCPU: formData.limitsCPU,
          requestsMemory: formData.requestsMemory,
          limitsMemory: formData.limitsMemory,
          requestsStorage: formData.requestsStorage,
          pods: '25',
          services: '15',
          persistentVolumeClaims: '10',
        },
      },
    };

    try {
      setLoading(true);
      const res = await fetch('/api/admin/baselines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save baseline.');
      }
      setBaselines(data.data);
      setIsModalOpen(false);
      showNotification('success', `Baseline "${payload.name}" saved successfully.`);
    } catch (err: any) {
      showNotification('error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedDomain(text);
    setTimeout(() => setCopiedDomain(null), 2000);
  };

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
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-cyan-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Self-Service & 1-Click Blueprints</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-3">
              Cluster Baselines & Predefined Configs
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              Preset cluster blueprints and automated Ingress FQDN standards. Non-technical users
              can select a baseline to deploy a production-ready virtual cluster with zero complex configurations.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all transform hover:scale-[1.02] active:scale-[0.98] font-mono shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>New Baseline</span>
            </button>
          )}
        </div>

        {/* Real-time FQDN Rule Demonstration Bar */}
        <div className="mt-6 pt-5 border-t border-cyber-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-300">
            <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Interactive Ingress Rule Preview:</span>
            <input
              type="text"
              value={previewClusterName}
              onChange={(e) => setPreviewClusterName(e.target.value)}
              placeholder="e.g. team-alpha"
              className="px-2.5 py-1 rounded-lg bg-cyber-950 border border-cyber-700 text-cyan-300 text-xs font-mono focus:border-cyan-400 focus:outline-none w-36"
              title="Type a sample cluster name to preview wildcard FQDN"
            />
          </div>
          <div className="text-slate-400">
            Automated Wildcard Rule:{' '}
            <code className="text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2 py-1 rounded-lg font-bold">
              *.{previewClusterName.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'name'}.test.example.com
            </code>
          </div>
        </div>
      </div>

      {/* Baselines Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {baselines.map((b) => {
          const fqdn = computeClusterFqdn(previewClusterName, b.baseDomain);

          return (
            <div
              key={b.id}
              className={`p-5 rounded-3xl border transition-all duration-300 flex flex-col justify-between relative group ${
                b.isDefault
                  ? 'bg-gradient-to-b from-cyber-900/90 to-cyber-950/90 border-cyan-500/50 shadow-xl shadow-cyan-500/10'
                  : 'bg-cyber-900/40 hover:bg-cyber-900/60 border-cyber-800 hover:border-cyber-700'
              }`}
            >
              {/* Top Bar: Badges */}
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {b.isDefault ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-bold tracking-wide shadow-sm">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        Active Default
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyber-950 text-slate-400 border border-cyber-800 text-[10px] font-mono">
                        Alternative
                      </span>
                    )}

                    {b.badge && (
                      <span className="px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-mono">
                        {b.badge}
                      </span>
                    )}

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono border capitalize ${
                        b.environment === 'production'
                          ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                          : b.environment === 'staging'
                          ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {b.environment}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-slate-500">
                    {b.preset.toUpperCase()}
                  </span>
                </div>

                {/* Title & Description */}
                <h3 className="text-lg font-bold text-white mb-1 group-hover:text-cyan-300 transition-colors">
                  {b.name}
                </h3>
                <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                  {b.description}
                </p>

                {/* Preconfigured Automated FQDN Banner */}
                <div className="p-3 rounded-2xl bg-cyber-950/80 border border-cyber-800/80 space-y-1.5 mb-4">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Globe className="w-3 h-3 text-cyan-400" />
                      Preconfigured Base Domain:
                    </span>
                    <button
                      onClick={() => copyToClipboard(b.baseDomain)}
                      className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                      title="Copy base domain"
                    >
                      {copiedDomain === b.baseDomain ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-400" />
                      )}
                      <span>{b.baseDomain}</span>
                    </button>
                  </div>

                  <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between pt-1 border-t border-cyber-900">
                    <span>Auto-Generated Ingress:</span>
                    <code className="text-emerald-400 font-semibold">{fqdn.wildcard}</code>
                  </div>
                </div>

                {/* Spec Summary Badges */}
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300 mb-4">
                  <div className="p-2 rounded-xl bg-cyber-950/50 border border-cyber-800/60 flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="truncate">
                      {b.policies?.resourceQuota?.requestsCPU || '2'} vCPU /{' '}
                      {b.policies?.resourceQuota?.requestsMemory || '4Gi'}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-cyber-950/50 border border-cyber-800/60 flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="truncate">
                      {b.istio?.enabled ? 'Istio Ingress' : 'Basic Syncer'}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-cyber-950/50 border border-cyber-800/60 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">
                      {b.autoSleep ? 'Auto-Sleep Idle' : 'Always Running'}
                    </span>
                  </div>

                  <div className="p-2 rounded-xl bg-cyber-950/50 border border-cyber-800/60 flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">
                      {b.disasterRecovery?.enabled ? `${b.disasterRecovery.schedule} backup` : 'No backup'}
                    </span>
                  </div>

                  <div className="col-span-2 p-2 rounded-xl bg-cyber-950/50 border border-cyber-800/60 flex items-center justify-between text-[11px] font-mono">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>etcd Drive:</span>
                    </span>
                    <span className="text-amber-300 font-semibold truncate max-w-[170px]" title={b.etcdStorageClass || 'Cluster Default'}>
                      {b.etcdStorageClass || 'Cluster Default'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-cyber-800 flex items-center justify-between gap-2">
                {!b.isDefault ? (
                  <button
                    type="button"
                    disabled={loading || !isAdmin}
                    onClick={() => handleSetDefault(b.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyber-950 hover:bg-cyber-800 border border-cyber-700 text-xs font-mono text-slate-300 hover:text-white transition-all disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Set Default</span>
                  </button>
                ) : (
                  <span className="text-[11px] font-mono text-cyan-400/80 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Selected on /new
                  </span>
                )}

                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(b)}
                      className="p-2 rounded-xl bg-cyber-950 hover:bg-cyber-800 text-slate-400 hover:text-slate-200 transition-colors border border-cyber-800"
                      title="Edit baseline configuration"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={loading || baselines.length <= 1}
                      onClick={() => handleDelete(b.id, b.name)}
                      className="p-2 rounded-xl bg-cyber-950 hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors border border-cyber-800 hover:border-rose-500/40 disabled:opacity-30"
                      title="Delete baseline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Baseline Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-cyber-900 border border-cyber-700/80 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl my-8">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-b from-cyber-800/80 to-cyber-900/80 border-b border-cyber-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-cyan-400" />
                  <span>{editingBaseline ? `Edit Baseline: ${editingBaseline.name}` : 'New Cluster Baseline'}</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Configure the pre-set architecture, size, and automated wildcard FQDN domain.
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
                    Baseline Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Developer Sandbox"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-cyan-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Baseline ID (Slug)
                  </label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    placeholder="e.g. dev-sandbox (auto-generated if empty)"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-cyan-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 font-mono">
                  Description (shown to non-technical users)
                </label>
                <textarea
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Explain who should select this baseline and what it provides..."
                  className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 focus:border-cyan-500 text-xs font-mono text-white placeholder-slate-500 focus:outline-none resize-none"
                />
              </div>

              {/* PRECONFIGURED BASE DOMAIN & FQDN AUTOMATION */}
              <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-cyan-300 font-mono">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    <span>Preconfigured Base FQDN Domain</span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-400/80 uppercase">Zero-Touch Ingress</span>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed font-mono">
                  When non-technical individuals deploy a vCluster with this baseline, they do not have
                  to enter any FQDN. The system will automatically prepend{' '}
                  <code className="text-cyan-300 bg-cyan-900/60 px-1 py-0.5 rounded">
                    *.[vcluster-name]
                  </code>{' '}
                  to this base domain.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-200 font-mono">
                    Base Domain Name
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.baseDomain}
                    onChange={(e) => setFormData({ ...formData, baseDomain: e.target.value })}
                    placeholder="e.g. test.example.com"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyan-500/50 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                {/* Real-time preview */}
                <div className="p-2.5 rounded-xl bg-cyber-950 border border-cyber-800 text-xs font-mono flex items-center justify-between">
                  <span className="text-slate-400">Resulting Wildcard Host:</span>
                  <span className="text-emerald-400 font-bold">
                    *.
                    {formData.name.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'vcluster-name'}
                    .{formData.baseDomain.replace(/^\*\.?/, '') || 'test.example.com'}
                  </span>
                </div>
              </div>

              {/* Sizing & Environment */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Sizing Tier
                  </label>
                  <select
                    value={formData.preset}
                    onChange={(e) => {
                      const selectedPreset = e.target.value as SizePreset;
                      const tier = sizingTiers.find((t) => t.id === selectedPreset);
                      setFormData({
                        ...formData,
                        preset: selectedPreset,
                        ...(tier
                          ? {
                              requestsCPU: tier.requestsCPU || formData.requestsCPU,
                              limitsCPU: tier.limitsCPU || formData.limitsCPU,
                              requestsMemory: tier.requestsMemory || formData.requestsMemory,
                              limitsMemory: tier.limitsMemory || formData.limitsMemory,
                              requestsStorage: tier.requestsStorage || formData.requestsStorage,
                            }
                          : {}),
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                  >
                    {sizingTiers.length > 0 ? (
                      sizingTiers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.cpu} / {t.memory} / {t.storage}{t.ha ? ' - 3x HA' : ''})
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="normal">Normal (2 vCPU / 4GB)</option>
                        <option value="ha">Production HA (6 vCPU / 12GB)</option>
                        <option value="small">Small (1 vCPU / 2GB)</option>
                        <option value="medium">Medium (4 vCPU / 8GB)</option>
                        <option value="large">Large (8 vCPU / 16GB)</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Environment
                  </label>
                  <select
                    value={formData.environment}
                    onChange={(e) => setFormData({ ...formData, environment: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                  >
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300 font-mono">
                    Badge / Tag
                  </label>
                  <input
                    type="text"
                    value={formData.badge}
                    onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                    placeholder="e.g. Quick Launch"
                    className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 text-xs font-mono text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* DATABASE & ETCD STORAGE CLASS */}
              <div className="p-4 rounded-2xl bg-amber-950/25 border border-amber-500/35 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-300 font-mono">
                    <Database className="w-4 h-4 text-amber-400" />
                    <span>etcd Database Storage Class</span>
                  </div>
                  <span className="text-[10px] font-mono text-amber-400/90 uppercase font-semibold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                    High-IOPS Drive
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed font-mono">
                  etcd is a consensus state database requiring fast, low-latency disk writes. Specify an SSD or NVMe-backed storage class to ensure optimal write-ahead log (WAL) fsync performance.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-200 font-mono">
                      Preset Cluster StorageClass
                    </label>
                    <select
                      value={formData.etcdStorageClass}
                      onChange={(e) => setFormData({ ...formData, etcdStorageClass: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-amber-500/40 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                    >
                      <option value="">Cluster Default StorageClass</option>
                      {storageClasses.map((sc) => (
                        <option key={sc.name} value={sc.name}>
                          {sc.name} {sc.isDefault ? '(Default)' : ''} — {sc.provisioner}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-200 font-mono">
                      Custom StorageClass Name
                    </label>
                    <input
                      type="text"
                      value={formData.etcdStorageClass}
                      onChange={(e) => setFormData({ ...formData, etcdStorageClass: e.target.value })}
                      placeholder="e.g. fast-nvme, local-ssd"
                      className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>

              {/* Add-ons and Istio */}
              <div className="space-y-3 pt-2 border-t border-cyber-800">
                <h4 className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider">
                  Add-on Components & Routing
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.enableIstio}
                      onChange={(e) => setFormData({ ...formData, enableIstio: e.target.checked })}
                      className="rounded bg-cyber-900 border-cyber-700 text-cyan-500 focus:ring-cyan-500"
                    />
                    <div className="text-xs font-mono">
                      <div className="text-white font-medium">Enable Istio Ingress Gateway</div>
                      <div className="text-slate-500 text-[10px]">Provides automated routing & TLS termination</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.autoSleep}
                      onChange={(e) => setFormData({ ...formData, autoSleep: e.target.checked })}
                      className="rounded bg-cyber-900 border-cyber-700 text-cyan-500 focus:ring-cyan-500"
                    />
                    <div className="text-xs font-mono">
                      <div className="text-white font-medium">Auto-Sleep When Idle</div>
                      <div className="text-slate-500 text-[10px]">Pauses pods when inactive to save cluster resources</div>
                    </div>
                  </label>
                </div>

                {formData.enableIstio && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400 font-mono">Cert-Manager Issuer</label>
                      <input
                        type="text"
                        value={formData.certIssuer}
                        onChange={(e) => setFormData({ ...formData, certIssuer: e.target.value })}
                        placeholder="e.g. letsencrypt-staging"
                        className="w-full px-3 py-1.5 rounded-lg bg-cyber-950 border border-cyber-800 text-xs font-mono text-white focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400 font-mono">Issuer Kind</label>
                      <select
                        value={formData.certIssuerKind}
                        onChange={(e) => setFormData({ ...formData, certIssuerKind: e.target.value as any })}
                        className="w-full px-3 py-1.5 rounded-lg bg-cyber-950 border border-cyber-800 text-xs font-mono text-white focus:outline-none"
                      >
                        <option value="ClusterIssuer">ClusterIssuer</option>
                        <option value="Issuer">Issuer</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Set as Default Checkbox */}
              <div className="pt-2 border-t border-cyber-800">
                <label className="flex items-center gap-3 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded bg-cyber-900 border-cyber-700 text-cyan-500 focus:ring-cyan-500"
                  />
                  <div className="text-xs font-mono">
                    <div className="text-white font-medium flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Set as Default Baseline</span>
                    </div>
                    <div className="text-slate-500 text-[10px]">
                      This baseline will be pre-selected when users open the Virtual Cluster creation page.
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
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs font-mono shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Baseline</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
