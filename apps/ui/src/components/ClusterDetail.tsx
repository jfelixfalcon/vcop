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
} from 'lucide-react';
import type { VirtualCluster } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { MetricSparkline } from './MetricSparkline';
import { KubeconfigModal } from './KubeconfigModal';
import { UpgradeModal } from './UpgradeModal';
import { DeleteModal } from './DeleteModal';

interface Props {
  clusterName: string;
}

export const ClusterDetail: React.FC<Props> = ({ clusterName }) => {
  const [cluster, setCluster] = useState<VirtualCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'etcd' | 'addons' | 'yaml'>('telemetry');
  const [activeModal, setActiveModal] = useState<'kubeconfig' | 'upgrade' | 'delete' | null>(null);

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
    fetchCluster();
    const interval = setInterval(fetchCluster, 3000);
    return () => clearInterval(interval);
  }, [clusterName]);

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
  const k8sVer = cluster.status.virtualK8sVersion || cluster.spec.kubernetesVersion || 'v1.31.0';
  const vclusterVer = cluster.status.vclusterVersion || cluster.spec.vclusterVersion || '0.37.0';

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
        </div>
      </div>

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
                  <h4 className="text-sm font-bold text-white">Internal CoreDNS Add-on</h4>
                  <p className="text-xs text-slate-400">Independent intra-vcluster service discovery</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                CoreDNS runs inside the virtual control plane. Tenant workloads resolve local service names (e.g. <code className="text-cyber-accent">svc.default.cluster.local</code>) completely isolated from the host cluster DNS.
              </p>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                Status: Serving Queries
              </span>
            </div>

            {/* Metrics Server */}
            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Metrics Server Integration</h4>
                  <p className="text-xs text-slate-400">kubectl top & HPA controller enablement</p>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mb-3">
                Integrations metrics server allows tenant horizontal pod autoscalers (HPAs) to evaluate pod memory and CPU without exposing host cluster metrics.
              </p>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                Status: Active (integrations.metricsServer.enabled)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Effective vCluster 0.37 YAML */}
      {activeTab === 'yaml' && (
        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 font-mono text-xs animate-in fade-in duration-150">
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-300 font-semibold">Compiled vcluster.yaml (v0.37 Unified Schema)</span>
            <span className="text-slate-500 text-[10px]">Stored in host ConfigMap: {cluster.name}-config</span>
          </div>
          <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-4 text-slate-300 overflow-x-auto whitespace-pre leading-relaxed">
{`controlPlane:
  distro:
    k8s:
      enabled: true
      version: "${k8sVer}"
      image: "registry.k8s.io/kube-apiserver:${k8sVer}"
      controllerManager:
        image: "registry.k8s.io/kube-controller-manager:${k8sVer}"
  backingStore:
    etcd:
      deploy:
        statefulSet:
          highAvailability:
            replicas: ${isHA ? 3 : 1}
          persistence:
            volumeClaim:
              size: "10Gi"
  coreDNS:
    enabled: true
integrations:
  metricsServer:
    enabled: true
sync:
  toHost:
    pods:
      enabled: true
    services:
      enabled: true
    ingresses:
      enabled: true`}
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
    </div>
  );
};
