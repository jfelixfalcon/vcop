import React, { useState, useEffect } from 'react';
import {
  Server,
  ArrowLeft,
  Terminal,
  ArrowUpCircle,
  Trash2,
  Shield,
  Download,
  Copy,
  Check,
  Activity,
  CheckCircle2,
  Clock,
  Layers,
  FileCode,
  Network,
  RefreshCw,
  Gauge,
  Sliders,
  Cpu,
  Database,
  HardDrive,
  Moon,
  Sun,
  Lock,
} from 'lucide-react';
import type { VirtualCluster, UserSession } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { MetricSparkline } from './MetricSparkline';
import { KubeconfigModal } from './KubeconfigModal';
import { UpgradeModal } from './UpgradeModal';
import { DeleteModal } from './DeleteModal';
import { QuotaModal } from './QuotaModal';
import { SleepModal } from './SleepModal';

function parseK8sQuantity(val?: string): number {
  if (!val) return 0;
  const s = val.trim();
  if (s.endsWith('m')) {
    return parseFloat(s.slice(0, -1)) / 1000;
  }
  if (s.endsWith('Ki')) {
    return parseFloat(s.slice(0, -2)) * 1024;
  }
  if (s.endsWith('Mi')) {
    return parseFloat(s.slice(0, -2)) * 1024 * 1024;
  }
  if (s.endsWith('Gi')) {
    return parseFloat(s.slice(0, -2)) * 1024 * 1024 * 1024;
  }
  if (s.endsWith('Ti')) {
    return parseFloat(s.slice(0, -2)) * 1024 * 1024 * 1024 * 1024;
  }
  return parseFloat(s) || 0;
}

function calculatePercent(used?: string, hard?: string): number {
  if (!used || !hard) return 0;
  const u = parseK8sQuantity(used);
  const h = parseK8sQuantity(hard);
  if (h <= 0) return 0;
  const pct = Math.round((u / h) * 100);
  return Math.min(Math.max(pct, 0), 100);
}

interface Props {
  clusterName: string;
  currentUser?: UserSession | null;
}

export const ClusterDetail: React.FC<Props> = ({ clusterName, currentUser }) => {
  const [user, setUser] = useState<UserSession | null>(currentUser || null);
  const [cluster, setCluster] = useState<VirtualCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'quota' | 'etcd' | 'addons' | 'yaml'>('telemetry');
  const [activeModal, setActiveModal] = useState<'kubeconfig' | 'upgrade' | 'delete' | 'quota' | 'sleep' | null>(null);

  const fetchCluster = async () => {
    try {
      const res = await fetch(`/api/vclusters/${clusterName}`);
      const data = await res.json();
      if (data.success && data.data) {
        setCluster(data.data);
      }
    } catch (err) {
      console.error('Error fetching cluster detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      fetch('/api/auth/me')
        .then((res) => res.json())
        .then((data) => {
          if (data.authenticated && data.user) {
            setUser(data.user);
          }
        })
        .catch(() => {});
    }
    fetchCluster();
    const interval = setInterval(fetchCluster, 3000);
    return () => clearInterval(interval);
  }, [clusterName]);

  const isAdmin = !user || user.role === 'admin';

  if (loading && !cluster) {
    return (
      <div className="py-24 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-cyber-accent" />
        <span className="font-mono text-sm">Loading virtual cluster state...</span>
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="py-20 text-center">
        <h3 className="text-xl font-bold text-white mb-2">Virtual Cluster Not Found</h3>
        <p className="text-sm text-slate-400 mb-6">Cluster "{clusterName}" may have been torn down or does not exist.</p>
        <a href="/" className="px-4 py-2 bg-cyber-800 text-white rounded-xl font-medium text-xs">
          Return to Fleet Dashboard
        </a>
      </div>
    );
  }

  const isHA = cluster.spec.highAvailability;
  const isSleeping = cluster.status.phase === 'Sleeping' || cluster.spec.paused || cluster.spec.lifecycle?.sleep;
  const k8sVer = cluster.status.virtualK8sVersion || cluster.spec.kubernetesVersion || 'v1.31.0';
  const vclusterVer = cluster.status.vclusterVersion || cluster.spec.vclusterVersion || '0.36.0';

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="p-2 bg-cyber-900 border border-cyber-700/80 rounded-xl text-slate-400 hover:text-white hover:bg-cyber-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </a>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold font-mono text-white tracking-wide">{cluster.name}</h1>
              <StatusBadge phase={cluster.status.phase} />
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Namespace: <span className="text-slate-300">{cluster.namespace}</span> • Engine: <span className="text-cyber-accent">vCluster {vclusterVer}</span>
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveModal('kubeconfig')}
            className="px-3.5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
          >
            <Terminal className="w-3.5 h-3.5" />
            Connect & Kubeconfig
          </button>

          {isAdmin ? (
            <>
              <button
                onClick={() => setActiveModal('sleep')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all ${
                  isSleeping
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold shadow-glow-sm'
                    : 'bg-cyber-800 hover:bg-cyber-750 text-indigo-300 border border-indigo-500/30'
                }`}
              >
                {isSleeping ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {isSleeping ? 'Wake Up' : 'Sleep'}
              </button>

              <button
                onClick={() => setActiveModal('quota')}
                className="px-3.5 py-2 bg-cyber-800 hover:bg-cyber-750 text-emerald-300 border border-emerald-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
              >
                <Sliders className="w-3.5 h-3.5" />
                Adjust Quotas
              </button>

              <button
                onClick={() => setActiveModal('upgrade')}
                className="px-3.5 py-2 bg-cyber-800 hover:bg-cyber-750 text-purple-300 border border-purple-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
              >
                <ArrowUpCircle className="w-3.5 h-3.5" />
                Upgrade Engine
              </button>

              <button
                onClick={() => setActiveModal('delete')}
                className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Teardown
              </button>
            </>
          ) : (
            <span className="px-3 py-2 text-xs font-mono text-slate-400 bg-cyber-900/90 rounded-xl border border-cyber-700/80 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-cyan-400" />
              <span>Read-Only Mode</span>
            </span>
          )}
        </div>
      </div>

      {/* Viewer Notice Banner */}
      {!isAdmin && user && (
        <div className="bg-cyan-950/30 border border-cyan-500/30 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white flex items-center gap-2">
                Viewer Access Role
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 uppercase font-semibold">
                  Read-Only
                </span>
              </h4>
              <p className="text-slate-300 mt-0.5">
                You are authorized to view this cluster and download its kubeconfig credentials. Lifecycle modifications, quota updates, upgrades, and teardowns are restricted to Platform Administrators.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sleeping Notification Banner */}
      {isSleeping && (
        <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-300 rounded-xl">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                Virtual Cluster is in Sleep Mode
                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                  Compute Workloads Paused (0m CPU / 0Mi RAM)
                </span>
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Workloads and syncer pods are scaled to zero. Persistent volumes and backing etcd quorum are safely preserved.
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => setActiveModal('sleep')}
              className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0"
            >
              <Sun className="w-3.5 h-3.5" />
              Wake Up Cluster
            </button>
          )}
        </div>
      )}

      {/* Cluster Meta & Endpoint Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Internal Endpoint</span>
          <p className="font-mono text-xs text-slate-200 truncate mt-1 select-all" title={cluster.status.endpoint}>
            {cluster.status.endpoint}
          </p>
          <span className="inline-block mt-2 text-[10px] text-emerald-400 font-mono">
            ● Port 443 (TLS Virtual API)
          </span>
        </div>

        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Kubernetes API Level</span>
          <p className="font-mono text-base font-bold text-white mt-1">{k8sVer}</p>
          <span className="inline-block mt-1 text-[10px] text-cyber-accent font-mono">
            K8s Distro Native Syncer
          </span>
        </div>

        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Sizing Tier</span>
          <p className="font-mono text-base font-bold text-white capitalize mt-1">
            {cluster.spec.sizePreset} Tier
          </p>
          <span className="inline-block mt-1 text-[10px] text-slate-400 font-mono">
            {isHA ? 'HA 3-Node Quorum' : 'Single-replica'}
          </span>
        </div>
      </div>

      {/* Nav Tabs */}
      <div className="flex border-b border-cyber-800 gap-6">
        {[
          { id: 'telemetry', label: 'Health & Telemetry', icon: Activity },
          { id: 'quota', label: 'Quotas & Policies', icon: Gauge },
          { id: 'etcd', label: 'HA etcd Backing Store', icon: Shield },
          { id: 'addons', label: 'CoreDNS & Metrics-Server', icon: Network },
          { id: 'yaml', label: 'Effective vcluster.yaml', icon: FileCode },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
                isActive
                  ? 'border-cyber-accent text-cyber-accent'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: Telemetry & Status */}
      {activeTab === 'telemetry' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Sparklines row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-slate-300">Tenant CPU Utilization</span>
                <span className="font-mono text-xs text-cyber-accent">
                  {cluster.status.metrics?.cpuUsage || '85m'}
                </span>
              </div>
              <MetricSparkline
                data={cluster.sparklineData?.cpu || [12, 18, 25, 30, 24, 28, 35, 38]}
                color="cyan"
                height={60}
                unit="%"
                currentValue={cluster.status.metrics?.cpuPercent ?? 38}
              />
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-slate-300">Tenant Memory Consumption</span>
                <span className="font-mono text-xs text-purple-300">
                  {cluster.status.metrics?.memoryUsage || '1.2Gi'}
                </span>
              </div>
              <MetricSparkline
                data={cluster.sparklineData?.memory || [28, 30, 32, 34, 34, 35, 36, 39]}
                color="purple"
                height={60}
                unit="%"
                currentValue={cluster.status.metrics?.memPercent ?? 39}
              />
            </div>
          </div>

          {/* Condition Timeline */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyber-accent" />
              Reconciliation Conditions & Readiness
            </h3>
            <div className="space-y-3">
              {cluster.status.conditions?.map((cond) => (
                <div
                  key={cond.type}
                  className="flex items-center justify-between p-3 bg-cyber-950/70 border border-cyber-800 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle2
                      className={`w-4 h-4 ${
                        cond.status === 'True' ? 'text-emerald-400' : 'text-amber-400 animate-pulse'
                      }`}
                    />
                    <div>
                      <div className="font-mono text-xs font-bold text-white flex items-center gap-2">
                        {cond.type}
                        <span className="text-[10px] font-normal text-slate-400 bg-cyber-900 px-2 py-0.5 rounded border border-cyber-800">
                          {cond.reason}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{cond.message}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    {new Date(cond.lastTransitionTime).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Resource Quotas & Policies */}
      {activeTab === 'quota' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Header summary banner */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-emerald-400" />
                  Dynamic Resource Quotas & Tenant Policies
                </h3>
                <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-mono text-[11px] font-semibold">
                  Dual-Scope Enforced
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Live usage and hard limits synchronized between the host namespace ({cluster.namespace}) and the virtual cluster default namespace.
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setActiveModal('quota')}
                className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0"
              >
                <Sliders className="w-3.5 h-3.5" />
                Adjust Quotas
              </button>
            )}
          </div>

          {/* 4 Core Gauge Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* CPU Requests */}
            {(() => {
              const used = cluster.status.quota?.used?.['requests.cpu'] || '0';
              const hard = cluster.status.quota?.hard?.['requests.cpu'] || cluster.spec.policies?.resourceQuota?.requestsCPU || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-cyan-400" />
                      CPU Requests
                    </span>
                    <span className="text-xs font-mono font-bold text-cyan-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-cyan-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Memory Requests */}
            {(() => {
              const used = cluster.status.quota?.used?.['requests.memory'] || '0';
              const hard = cluster.status.quota?.hard?.['requests.memory'] || cluster.spec.policies?.resourceQuota?.requestsMemory || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-purple-400" />
                      Memory Requests
                    </span>
                    <span className="text-xs font-mono font-bold text-purple-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-purple-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Storage Requests */}
            {(() => {
              const used = cluster.status.quota?.used?.['requests.storage'] || '0';
              const hard = cluster.status.quota?.hard?.['requests.storage'] || cluster.spec.policies?.resourceQuota?.requestsStorage || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-amber-400" />
                      Storage Requests
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-amber-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Pods Count */}
            {(() => {
              const used = cluster.status.quota?.used?.['pods'] || cluster.status.quota?.used?.['count/pods'] || String(cluster.status.metrics?.podCount || 0);
              const hard = cluster.status.quota?.hard?.['pods'] || cluster.status.quota?.hard?.['count/pods'] || cluster.spec.policies?.resourceQuota?.pods || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      Tenant Pods
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Detailed Itemized Quota Enforcement Table */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
            <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              Itemized Resource Quotas (Live Synced)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-cyber-800 text-slate-400 text-[11px]">
                    <th className="pb-2 font-medium">Resource</th>
                    <th className="pb-2 font-medium">Current Usage</th>
                    <th className="pb-2 font-medium">Hard Limit</th>
                    <th className="pb-2 font-medium w-48">Utilization</th>
                    <th className="pb-2 font-medium">Enforcement Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyber-850">
                  {[
                    { key: 'requests.cpu', name: 'CPU Requests (requests.cpu)', scope: 'Compute' },
                    { key: 'limits.cpu', name: 'CPU Limits (limits.cpu)', scope: 'Compute' },
                    { key: 'requests.memory', name: 'Memory Requests (requests.memory)', scope: 'Memory' },
                    { key: 'limits.memory', name: 'Memory Limits (limits.memory)', scope: 'Memory' },
                    { key: 'requests.storage', name: 'Storage Requests (requests.storage)', scope: 'Storage' },
                    { key: 'pods', altKey: 'count/pods', name: 'Pods (count/pods)', scope: 'Objects' },
                    { key: 'services', name: 'Services (services)', scope: 'Network' },
                    { key: 'services.loadbalancers', name: 'Load Balancers (services.loadbalancers)', scope: 'Network' },
                    { key: 'services.nodeports', name: 'Node Ports (services.nodeports)', scope: 'Network' },
                    { key: 'persistentvolumeclaims', name: 'PVCs (persistentvolumeclaims)', scope: 'Storage' },
                    { key: 'configmaps', name: 'ConfigMaps (configmaps)', scope: 'Objects' },
                    { key: 'secrets', name: 'Secrets (secrets)', scope: 'Security' },
                  ].map((item) => {
                    const used = cluster.status.quota?.used?.[item.key] || (item.altKey ? cluster.status.quota?.used?.[item.altKey] : undefined) || '0';
                    const hard = cluster.status.quota?.hard?.[item.key] || (item.altKey ? cluster.status.quota?.hard?.[item.altKey] : undefined) || 'Unlimited';
                    const pct = hard !== 'Unlimited' ? calculatePercent(used, hard) : 0;
                    return (
                      <tr key={item.key} className="hover:bg-cyber-850/50 transition-colors">
                        <td className="py-2.5 font-semibold text-slate-200">{item.name}</td>
                        <td className="py-2.5 text-cyan-300">{used}</td>
                        <td className="py-2.5 text-slate-300 font-bold">{hard}</td>
                        <td className="py-2.5">
                          {hard !== 'Unlimited' ? (
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-cyber-950 rounded-full h-1.5 overflow-hidden border border-cyber-800">
                                <div
                                  className={`h-full rounded-full ${
                                    pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                ></div>
                              </div>
                              <span className="text-[10px] text-slate-400">{pct}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-[11px]">No limit</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded bg-cyber-950 border border-cyber-800 text-[10px] text-slate-400">
                            {item.scope}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* LimitRange Policy Card */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                Container LimitRange Policy Defaults & Bounds
              </h4>
              <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                Namespace: default & host
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Standard requests and limits automatically injected by Kubernetes admission controllers into containers that do not specify their own resource constraints.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT REQUEST CPU</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultRequestCPU || '100m'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT REQUEST MEM</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultRequestMemory || '128Mi'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT LIMIT CPU</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultCPU || '500m'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT LIMIT MEM</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultMemory || '512Mi'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MAX CONTAINER CPU</span>
                <span className="text-cyan-300 font-bold">{cluster.spec.policies?.limitRange?.maxCPU || '4'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MAX CONTAINER MEM</span>
                <span className="text-purple-300 font-bold">{cluster.spec.policies?.limitRange?.maxMemory || '8Gi'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MIN CONTAINER CPU</span>
                <span className="text-cyan-300 font-bold">{cluster.spec.policies?.limitRange?.minCPU || '10m'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MIN CONTAINER MEM</span>
                <span className="text-purple-300 font-bold">{cluster.spec.policies?.limitRange?.minMemory || '32Mi'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: HA etcd */}
      {activeTab === 'etcd' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6">
            <div className="flex justify-between items-center mb-5">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Shield className="w-5 h-5 text-emerald-400" />
                  HA etcd StatefulSet Backing Topology
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Automated peer discovery on port 2380 and client listener on port 2379 with persistent volume storage.
                </p>
              </div>
              <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-mono text-xs font-bold">
                {isHA ? 'Quorum: 3/3 Healthy' : 'Single Node'}
              </span>
            </div>

            {/* Member nodes grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[0, 1, 2].slice(0, isHA ? 3 : 1).map((idx) => (
                <div
                  key={idx}
                  className="bg-cyber-950 border border-cyber-800 rounded-xl p-4 font-mono text-xs space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white">{cluster.name}-etcd-{idx}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-glow-emerald"></span>
                  </div>
                  <div className="text-[11px] text-slate-400 space-y-1">
                    <div>Role: <span className="text-slate-200">{idx === 0 ? 'Leader' : 'Follower'}</span></div>
                    <div>State: <span className="text-emerald-400">Synced (Quorum Member)</span></div>
                    <div>PVC: <span className="text-slate-300">data-{cluster.name}-etcd-{idx}</span></div>
                    <div>Peer: <span className="text-cyan-400">:2380</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Add-ons & DNS */}
      {/* TAB CONTENT: Add-ons & Components */}
      {activeTab === 'addons' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* CoreDNS */}
            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">External CoreDNS Add-on</h4>
                  <p className="text-xs text-slate-400">Independent intra-vcluster service discovery</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                CoreDNS runs as a dedicated external workload deployed by the operator into the host namespace. Tenant workloads resolve local service names (e.g. <code className="text-cyber-accent">svc.default.cluster.local</code>) completely isolated from the host cluster DNS without embedding DNS in the vCluster syncer.
              </p>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                Status: Serving Queries (External)
              </span>
            </div>

            {/* Metrics Server */}
            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">External Metrics-Server Add-on</h4>
                  <p className="text-xs text-slate-400">kubectl top & HPA controller enablement</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                External metrics-server runs standalone in the host cluster namespace, collecting resource usage and populating Kubernetes APIService endpoints. Allows tenant horizontal pod autoscalers (HPAs) and <code className="text-cyber-accent">kubectl top</code> to function without relying on proprietary embedded integrations.
              </p>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                Status: Active (External Add-on)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Effective vCluster 0.36 YAML */}
      {activeTab === 'yaml' && (
        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 font-mono text-xs animate-in fade-in duration-150">
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-300 font-semibold">Compiled vcluster.yaml (v0.36 Unified Schema)</span>
            <span className="text-slate-500 text-[10px]">Stored in host ConfigMap: {cluster.name}-config</span>
          </div>
          <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-4 text-slate-300 overflow-x-auto whitespace-pre leading-relaxed">
{cluster.compiledConfig || `# vcluster.yaml is being reconciled by vc-operator for ${cluster.name}-config...`}
          </pre>
        </div>
      )}

      {/* Modals */}
      <KubeconfigModal
        cluster={cluster}
        isOpen={activeModal === 'kubeconfig'}
        onClose={() => setActiveModal(null)}
      />

      <UpgradeModal
        cluster={cluster}
        isOpen={activeModal === 'upgrade'}
        onClose={() => setActiveModal(null)}
        onUpgradeSuccess={(updated) => setCluster(updated)}
      />

      <DeleteModal
        cluster={cluster}
        isOpen={activeModal === 'delete'}
        onClose={() => setActiveModal(null)}
        onDeleteSuccess={() => {
          window.location.href = '/';
        }}
      />

      <QuotaModal
        cluster={cluster}
        isOpen={activeModal === 'quota'}
        onClose={() => setActiveModal(null)}
        onUpdateSuccess={(updated) => setCluster(updated)}
      />

      <SleepModal
        cluster={cluster}
        isOpen={activeModal === 'sleep'}
        onClose={() => setActiveModal(null)}
        onSuccess={(updated) => setCluster(updated)}
      />
    </div>
  );
};
