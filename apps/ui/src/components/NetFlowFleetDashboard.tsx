import React, { useState, useEffect } from 'react';
import { Network, Layers, Server, Globe, FolderGit2, Sparkles, Filter, Activity } from 'lucide-react';
import type { VirtualCluster, UserSession } from '../lib/types';
import { NetFlowViewer } from './NetFlowViewer';

interface Props {
  currentUser?: UserSession | null;
}

export const NetFlowFleetDashboard: React.FC<Props> = ({ currentUser }) => {
  const [clusters, setClusters] = useState<VirtualCluster[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [targetKey, setTargetKey] = useState<string>('all:all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [clusterRes, nsRes] = await Promise.allSettled([
          fetch('/api/vclusters').then((r) => r.json()),
          fetch('/api/cluster/namespaces').then((r) => r.json()),
        ]);

        if (clusterRes.status === 'fulfilled' && clusterRes.value?.success && Array.isArray(clusterRes.value.data)) {
          setClusters(clusterRes.value.data);
        }

        if (nsRes.status === 'fulfilled' && nsRes.value?.success && Array.isArray(nsRes.value.namespaces)) {
          setNamespaces(nsRes.value.namespaces);
        }
      } catch (err: any) {
        setError(err.message || 'Error communicating with cluster API');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Parse targetKey into scope and target
  const [scope, target] = (targetKey || 'all:all').split(':') as ['all' | 'vcluster' | 'namespace', string];
  const selectedCluster = scope === 'vcluster' ? clusters.find((c) => c.name === target) : undefined;

  let scopeLabel = '🌐 All Cluster Pods (Cluster-Wide)';
  if (scope === 'vcluster') {
    scopeLabel = `📦 Virtual Cluster: ${target}`;
  } else if (scope === 'namespace') {
    scopeLabel = `🏷️ Namespace: ${target}`;
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 font-mono space-y-3">
        <div className="w-10 h-10 rounded-xl border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <span className="text-sm text-cyan-300">Loading Cluster NetFlow Telemetry Engine...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-mono">
      {/* NetFlow Observability Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-5 shadow-xl backdrop-blur-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <Network className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-black text-white tracking-tight">
              NetFlow & Endpoint Observability
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950 border border-cyan-800 text-cyan-300">
              eBPF NetFlow Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Real-time cluster-wide socket reachability, Layer 3/4 flow graph, active pod health probing, and interactive multi-dimensional topology.
          </p>
        </div>

        {/* Scope Selector Dropdown */}
        <div className="flex items-center gap-2 self-start lg:self-auto bg-cyber-950 p-2 rounded-xl border border-cyber-800">
          <Layers className="w-4 h-4 text-cyan-400 ml-1.5 shrink-0" />
          <span className="text-xs text-slate-400 font-semibold shrink-0">Observability Scope:</span>
          <select
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
            className="bg-cyber-900 text-cyan-300 border border-cyber-700 hover:border-cyan-500/50 rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-cyan-400 cursor-pointer min-w-[240px]"
          >
            <optgroup label="🌐 Global Scope">
              <option value="all:all">🌐 All Cluster Pods (Cluster-Wide)</option>
            </optgroup>

            {clusters.length > 0 && (
              <optgroup label="📦 Virtual Clusters">
                {clusters.map((c) => (
                  <option key={c.name} value={`vcluster:${c.name}`}>
                    vCluster: {c.name} ({c.namespace}) - {c.status?.phase || 'Unknown'}
                  </option>
                ))}
              </optgroup>
            )}

            {namespaces.length > 0 && (
              <optgroup label="🏷️ Host Namespaces">
                {namespaces.map((ns) => (
                  <option key={ns} value={`namespace:${ns}`}>
                    Namespace: {ns}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* Quick-select filter chips for instant switching */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <span className="text-slate-500 text-[11px] font-bold flex items-center gap-1 shrink-0">
          <Filter className="w-3 h-3 text-cyan-400" />
          Quick Switch:
        </span>

        <button
          onClick={() => setTargetKey('all:all')}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
            targetKey === 'all:all'
              ? 'bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
              : 'bg-cyber-900/90 text-slate-300 border border-cyber-800 hover:border-cyan-500/40 hover:text-white'
          }`}
        >
          <Globe className="w-3 h-3" />
          <span>All Cluster Pods</span>
        </button>

        {/* Top namespaces chips */}
        {namespaces.slice(0, 5).map((ns) => {
          const key = `namespace:${ns}`;
          const isSelected = targetKey === key;
          return (
            <button
              key={ns}
              onClick={() => setTargetKey(key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-cyan-500 text-slate-950 shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                  : 'bg-cyber-900/90 text-slate-400 border border-cyber-800 hover:border-cyan-500/40 hover:text-cyan-300'
              }`}
            >
              <span>{ns}</span>
            </button>
          );
        })}

        {/* Virtual clusters chips */}
        {clusters.map((c) => {
          const key = `vcluster:${c.name}`;
          const isSelected = targetKey === key;
          return (
            <button
              key={c.name}
              onClick={() => setTargetKey(key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                  : 'bg-cyber-900/90 text-purple-300 border border-purple-900/60 hover:border-purple-500/40'
              }`}
            >
              <Server className="w-3 h-3" />
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>

      {/* Main NetFlow Visualizer Component */}
      <NetFlowViewer
        scope={scope}
        target={target}
        cluster={selectedCluster}
        scopeLabel={scopeLabel}
      />
    </div>
  );
};
