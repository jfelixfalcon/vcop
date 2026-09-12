import React, { useState, useEffect } from 'react';
import { Network, Layers, Server, Activity, ShieldCheck, ChevronDown, Sparkles, RefreshCw } from 'lucide-react';
import type { VirtualCluster, UserSession } from '../lib/types';
import { NetFlowViewer } from './NetFlowViewer';

interface Props {
  currentUser?: UserSession | null;
}

export const NetFlowFleetDashboard: React.FC<Props> = ({ currentUser }) => {
  const [clusters, setClusters] = useState<VirtualCluster[]>([]);
  const [selectedClusterName, setSelectedClusterName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchClusters = async () => {
      try {
        const res = await fetch('/api/vclusters');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setClusters(json.data);
          if (json.data.length > 0) {
            // Default to first ready cluster or first cluster
            const ready = json.data.find((c: VirtualCluster) => c.status?.phase === 'Ready');
            setSelectedClusterName(ready ? ready.name : json.data[0].name);
          }
        } else {
          setError(json.error || 'Failed to load virtual clusters');
        }
      } catch (err: any) {
        setError(err.message || 'Error communicating with cluster API');
      } finally {
        setLoading(false);
      }
    };

    fetchClusters();
  }, []);

  const selectedCluster = clusters.find((c) => c.name === selectedClusterName);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-28 font-mono space-y-3">
        <div className="w-10 h-10 rounded-xl border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
        <span className="text-sm text-cyan-300">Loading Fleet NetFlow Engine...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 font-mono">
      {/* Fleet NetFlow Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-5 shadow-xl backdrop-blur-md">
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
            Real-time Layer 3/4 & Layer 7 service mesh telemetry, endpoint health monitoring, live packet verdict analytics, and interactive topology visualizer.
          </p>
        </div>

        {/* Cluster Selector Dropdown */}
        {clusters.length > 0 && (
          <div className="flex items-center gap-2 self-start md:self-auto bg-cyber-950 p-1.5 rounded-xl border border-cyber-800">
            <Layers className="w-4 h-4 text-cyan-400 ml-2" />
            <span className="text-xs text-slate-400">Target Cluster:</span>
            <select
              value={selectedClusterName}
              onChange={(e) => setSelectedClusterName(e.target.value)}
              className="bg-cyber-900 text-cyan-300 border border-cyber-700 rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-cyan-400 cursor-pointer"
            >
              {clusters.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.namespace}) - {c.status?.phase || 'Unknown'}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Cluster NetFlow Viewer */}
      {selectedCluster ? (
        <NetFlowViewer cluster={selectedCluster} />
      ) : (
        <div className="bg-cyber-900/80 border border-cyber-800 rounded-2xl p-12 text-center text-slate-400">
          <Server className="w-10 h-10 mx-auto mb-3 text-slate-600" />
          <p className="text-sm font-bold text-white">No active virtual clusters discovered</p>
          <p className="text-xs text-slate-500 mt-1">Provision a virtual cluster to inspect live network flows and endpoint health.</p>
        </div>
      )}
    </div>
  );
};
