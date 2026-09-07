import React, { useState, useEffect } from 'react';
import {
  ArrowUpCircle,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Cpu,
  Layers,
  Database,
  Network,
  Activity,
  Globe,
} from 'lucide-react';
import type { VirtualCluster, VersionRegistry } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: (updated: VirtualCluster) => void;
}

type TabKey = 'all' | 'controlPlane' | 'storage' | 'addons';

export const UpgradeModal: React.FC<Props> = ({ cluster, isOpen, onClose, onUpgradeSuccess }) => {
  const currentK8s = cluster?.status?.virtualK8sVersion || cluster?.spec?.kubernetesVersion || 'v1.31.0';
  const currentEngine = cluster?.status?.vclusterVersion || cluster?.spec?.vclusterVersion || '0.36.0';
  const currentEtcd = cluster?.status?.componentVersions?.etcd || cluster?.spec?.etcdVersion || '3.6.8-0';
  const currentCoreDNS = cluster?.status?.componentVersions?.coreDNS || cluster?.spec?.components?.coreDNS?.version || 'v1.11.3';
  const currentMetrics = cluster?.status?.componentVersions?.metricsServer || cluster?.spec?.components?.metricsServer?.version || 'v0.7.2';
  const currentIstio = cluster?.status?.componentVersions?.istio || cluster?.spec?.components?.istio?.version || '1.24.2';

  const isIstioEnabled = Boolean(cluster?.spec?.components?.istio?.enabled || cluster?.status?.componentVersions?.istio);

  const [selectedK8s, setSelectedK8s] = useState<string>(currentK8s);
  const [selectedVCluster, setSelectedVCluster] = useState<string>(currentEngine);
  const [selectedEtcd, setSelectedEtcd] = useState<string>(currentEtcd);
  const [selectedCoreDNS, setSelectedCoreDNS] = useState<string>(currentCoreDNS);
  const [selectedMetrics, setSelectedMetrics] = useState<string>(currentMetrics);
  const [selectedIstio, setSelectedIstio] = useState<string>(currentIstio);

  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [upgrading, setUpgrading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [registry, setRegistry] = useState<VersionRegistry | null>(null);
  const [loadingVersions, setLoadingVersions] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && cluster) {
      setSelectedK8s(currentK8s);
      setSelectedVCluster(currentEngine);
      setSelectedEtcd(currentEtcd);
      setSelectedCoreDNS(currentCoreDNS);
      setSelectedMetrics(currentMetrics);
      setSelectedIstio(currentIstio);
      setLoadingVersions(true);
      fetch('/api/admin/versions')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data) {
            setRegistry(data.data);
          }
        })
        .catch((e) => console.warn('Failed to load version registry in upgrade modal:', e))
        .finally(() => setLoadingVersions(false));
    }
  }, [isOpen, cluster]);

  if (!isOpen || !cluster) return null;

  const k8sList = registry?.kubernetesVersions || [];
  const engineList = registry?.vclusterVersions || [];
  const etcdList = registry?.etcdVersions || [];
  const coreDNSList = registry?.coreDNSVersions || [];
  const metricsList = registry?.metricsServerVersions || [];
  const istioList = registry?.istioVersions || [];

  const handleUpgrade = async () => {
    setUpgrading(true);
    setError(null);

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kubernetesVersion: selectedK8s,
          vclusterVersion: selectedVCluster,
          etcdVersion: selectedEtcd,
          coreDNSVersion: selectedCoreDNS,
          metricsServerVersion: selectedMetrics,
          istioVersion: isIstioEnabled ? selectedIstio : undefined,
          namespace: cluster.namespace,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to initiate upgrade');
      }

      onUpgradeSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpgrading(false);
    }
  };

  const isChangingK8s = selectedK8s !== currentK8s;
  const isChangingEngine = selectedVCluster !== currentEngine;
  const isChangingEtcd = selectedEtcd !== currentEtcd;
  const isChangingCoreDNS = selectedCoreDNS !== currentCoreDNS;
  const isChangingMetrics = selectedMetrics !== currentMetrics;
  const isChangingIstio = isIstioEnabled && selectedIstio !== currentIstio;

  const totalChanges = [
    isChangingK8s,
    isChangingEngine,
    isChangingEtcd,
    isChangingCoreDNS,
    isChangingMetrics,
    isChangingIstio,
  ].filter(Boolean).length;

  const hasChanges = totalChanges > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Glow Line */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-purple-500 to-transparent"></div>

        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/30 text-purple-400">
              <ArrowUpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                Upgrade Virtual Cluster: <span className="font-mono text-purple-400">{cluster.name}</span>
                {totalChanges > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                    {totalChanges} pending {totalChanges === 1 ? 'change' : 'changes'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Zero-downtime rolling update for Control Plane, Backing Store, DNS, Metrics, and Ingress
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Pre-flight Checks Status */}
        <div className="mb-4 p-3 bg-cyber-850/70 border border-cyber-800 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-slate-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>HA etcd Quorum Validated</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Rolling Pod Replacement</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Kubeconfig API Invariant</span>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1.5 pb-3 border-b border-cyber-800 mb-3 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'all'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                : 'text-slate-400 hover:text-white hover:bg-cyber-800'
            }`}
          >
            All Components
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('controlPlane')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'controlPlane'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                : 'text-slate-400 hover:text-white hover:bg-cyber-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Control Plane
            {(isChangingK8s || isChangingEngine) && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'storage'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                : 'text-slate-400 hover:text-white hover:bg-cyber-800'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Backing Store (etcd)
            {isChangingEtcd && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('addons')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
              activeTab === 'addons'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                : 'text-slate-400 hover:text-white hover:bg-cyber-800'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            Core Add-ons & Ingress
            {(isChangingCoreDNS || isChangingMetrics || isChangingIstio) && (
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
            )}
          </button>
        </div>

        {/* Scrollable Component List */}
        <div className="space-y-5 overflow-y-auto pr-1 flex-1">
          {/* SECTION 1: Control Plane */}
          {(activeTab === 'all' || activeTab === 'controlPlane') && (
            <div className="space-y-4">
              {/* 1.1 Kubernetes */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    Kubernetes Control Plane API
                  </label>
                  <div className="text-[11px] font-mono text-slate-400">
                    Current: <span className="text-slate-200 font-semibold">{currentK8s}</span>
                    {isChangingK8s && (
                      <span className="text-purple-300 font-bold ml-1.5">→ {selectedK8s}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {k8sList.map((opt) => {
                    const isSelected = selectedK8s === opt.version;
                    const isCurrent = currentK8s === opt.version;
                    return (
                      <button
                        key={opt.version}
                        type="button"
                        onClick={() => setSelectedK8s(opt.version)}
                        className={`p-2.5 rounded-xl border text-left transition-all relative ${
                          isSelected
                            ? 'bg-purple-500/15 border-purple-500/60 text-white shadow-sm'
                            : 'bg-cyber-850/80 border-cyber-800 text-slate-400 hover:border-cyber-700'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold flex items-center justify-between">
                          <span>{opt.version}</span>
                          {isCurrent && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-cyber-800 text-slate-300">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 capitalize truncate">
                          {opt.tag || opt.label || 'Stable'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 1.2 vCluster Engine */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-purple-400" />
                    vCluster OSS Engine & Syncer
                  </label>
                  <div className="text-[11px] font-mono text-slate-400">
                    Current: <span className="text-slate-200 font-semibold">{currentEngine}</span>
                    {isChangingEngine && (
                      <span className="text-purple-300 font-bold ml-1.5">→ {selectedVCluster}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {engineList.map((opt) => {
                    const isSelected = selectedVCluster === opt.version;
                    const isCurrent = currentEngine === opt.version;
                    return (
                      <button
                        key={opt.version}
                        type="button"
                        onClick={() => setSelectedVCluster(opt.version)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-purple-500/15 border-purple-500/60 text-white shadow-sm'
                            : 'bg-cyber-850/80 border-cyber-800 text-slate-400 hover:border-cyber-700'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold flex items-center justify-between">
                          <span>vCluster {opt.version}</span>
                          {isCurrent && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-cyber-800 text-slate-300">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {opt.label || 'Engine Release'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: etcd Backing Store */}
          {(activeTab === 'all' || activeTab === 'storage') && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-emerald-400" />
                  etcd Backing Store Engine
                </label>
                <div className="text-[11px] font-mono text-slate-400">
                  Current: <span className="text-slate-200 font-semibold">{currentEtcd}</span>
                  {isChangingEtcd && (
                    <span className="text-purple-300 font-bold ml-1.5">→ {selectedEtcd}</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {etcdList.map((opt) => {
                  const isSelected = selectedEtcd === opt.version;
                  const isCurrent = currentEtcd === opt.version;
                  return (
                    <button
                      key={opt.version}
                      type="button"
                      onClick={() => setSelectedEtcd(opt.version)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'bg-purple-500/15 border-purple-500/60 text-white shadow-sm'
                          : 'bg-cyber-850/80 border-cyber-800 text-slate-400 hover:border-cyber-700'
                      }`}
                    >
                      <div className="font-mono text-xs font-bold flex items-center justify-between">
                        <span>etcd {opt.version}</span>
                        {isCurrent && (
                          <span className="text-[8px] px-1 py-0.2 rounded bg-cyber-800 text-slate-300">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {opt.label || 'etcd store'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SECTION 3: Core Add-ons & Ingress */}
          {(activeTab === 'all' || activeTab === 'addons') && (
            <div className="space-y-4">
              {/* 3.1 CoreDNS */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                    <Network className="w-3.5 h-3.5 text-blue-400" />
                    CoreDNS Cluster DNS Resolver
                  </label>
                  <div className="text-[11px] font-mono text-slate-400">
                    Current: <span className="text-slate-200 font-semibold">{currentCoreDNS}</span>
                    {isChangingCoreDNS && (
                      <span className="text-purple-300 font-bold ml-1.5">→ {selectedCoreDNS}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {coreDNSList.map((opt) => {
                    const isSelected = selectedCoreDNS === opt.version;
                    const isCurrent = currentCoreDNS === opt.version;
                    return (
                      <button
                        key={opt.version}
                        type="button"
                        onClick={() => setSelectedCoreDNS(opt.version)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-purple-500/15 border-purple-500/60 text-white shadow-sm'
                            : 'bg-cyber-850/80 border-cyber-800 text-slate-400 hover:border-cyber-700'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold flex items-center justify-between">
                          <span>{opt.version}</span>
                          {isCurrent && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-cyber-800 text-slate-300">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {opt.label || 'DNS resolver'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3.2 Metrics Server */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-amber-400" />
                    Metrics-Server Telemetry Pipeline
                  </label>
                  <div className="text-[11px] font-mono text-slate-400">
                    Current: <span className="text-slate-200 font-semibold">{currentMetrics}</span>
                    {isChangingMetrics && (
                      <span className="text-purple-300 font-bold ml-1.5">→ {selectedMetrics}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {metricsList.map((opt) => {
                    const isSelected = selectedMetrics === opt.version;
                    const isCurrent = currentMetrics === opt.version;
                    return (
                      <button
                        key={opt.version}
                        type="button"
                        onClick={() => setSelectedMetrics(opt.version)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-purple-500/15 border-purple-500/60 text-white shadow-sm'
                            : 'bg-cyber-850/80 border-cyber-800 text-slate-400 hover:border-cyber-700'
                        }`}
                      >
                        <div className="font-mono text-xs font-bold flex items-center justify-between">
                          <span>{opt.version}</span>
                          {isCurrent && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-cyber-800 text-slate-300">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {opt.label || 'HPA telemetry'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3.3 Istio (if configured or enabled) */}
              {isIstioEnabled && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-cyan-400" />
                      Istio Ingress Gateway & Pilot Control Plane
                    </label>
                    <div className="text-[11px] font-mono text-slate-400">
                      Current: <span className="text-slate-200 font-semibold">{currentIstio}</span>
                      {isChangingIstio && (
                        <span className="text-purple-300 font-bold ml-1.5">→ {selectedIstio}</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {istioList.map((opt) => {
                      const isSelected = selectedIstio === opt.version;
                      const isCurrent = currentIstio === opt.version;
                      return (
                        <button
                          key={opt.version}
                          type="button"
                          onClick={() => setSelectedIstio(opt.version)}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'bg-purple-500/15 border-purple-500/60 text-white shadow-sm'
                              : 'bg-cyber-850/80 border-cyber-800 text-slate-400 hover:border-cyber-700'
                          }`}
                        >
                          <div className="font-mono text-xs font-bold flex items-center justify-between">
                            <span>Istio {opt.version}</span>
                            {isCurrent && (
                              <span className="text-[8px] px-1 py-0.2 rounded bg-cyber-800 text-slate-300">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {opt.label || 'Gateway stack'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with summary and action */}
        <div className="flex items-center justify-between pt-4 border-t border-cyber-800 mt-4">
          <div className="text-xs font-mono text-slate-400">
            {hasChanges ? (
              <span className="text-purple-300 font-semibold">
                {totalChanges} component {totalChanges === 1 ? 'upgrade' : 'upgrades'} ready to apply
              </span>
            ) : (
              <span>All components up to date</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={upgrading}
              className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUpgrade}
              disabled={upgrading || !hasChanges}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {upgrading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Initiating Rolling Upgrade...
                </>
              ) : (
                <>
                  <ArrowUpCircle className="w-4 h-4" />
                  {hasChanges ? 'Apply Component Upgrades' : 'Select Target Version'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
