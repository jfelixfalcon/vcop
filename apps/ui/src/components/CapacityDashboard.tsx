import React, { useState, useEffect } from 'react';
import {
  Cpu,
  HardDrive,
  Database,
  Server,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  BarChart3,
  AlertOctagon,
  Layers,
  Search,
  ExternalLink,
  ShieldAlert,
  Info,
  SlidersHorizontal,
} from 'lucide-react';
import type { ClusterCapacityData, VClusterCapacityItem } from '../lib/types';

export default function CapacityDashboard() {
  const [data, setData] = useState<ClusterCapacityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchCapacity = async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsRefreshing(true);
    try {
      const res = await fetch('/api/cluster/capacity');
      const json = await res.json();
      if (json.success && json.capacity) {
        setData(json.capacity);
        setError(null);
        setLastRefreshed(new Date());
      } else {
        setError(json.error || 'Failed to fetch cluster capacity');
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching cluster capacity');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCapacity();
    const interval = setInterval(() => {
      fetchCapacity(true);
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const filteredClusters = (data?.vclusters || []).filter((vc) =>
    vc.name.toLowerCase().includes(search.toLowerCase()) ||
    vc.namespace.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-cyber-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Cluster Capacity & Overallocation Guard
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <span className="text-[10px] text-slate-500 block font-mono">Last Synced</span>
            <span className="text-xs text-slate-300 font-mono">
              {lastRefreshed.toLocaleTimeString()}
            </span>
          </div>
          <button
            onClick={() => fetchCapacity(true)}
            disabled={isRefreshing || loading}
            className="flex items-center gap-2 px-3 py-2 bg-cyber-900 hover:bg-cyber-800 border border-cyber-700 rounded-xl text-xs font-mono text-slate-300 hover:text-white transition-all disabled:opacity-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>Refresh</span>
          </button>
          <a
            href="/new"
            className="flex items-center gap-2 px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs rounded-xl shadow-glow-sm transition-all"
          >
            <span>+ Provision vCluster</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-rose-300 text-xs">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
          <div>
            <strong className="font-semibold block text-sm">Failed to load capacity telemetry</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Overcommit Alert Banners */}
      {data && (data.isCpuOverallocated || data.isMemoryOverallocated || data.isStorageOverallocated) && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/70 to-red-900/40 border border-rose-500/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-glow-rose">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
              <AlertOctagon className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-rose-200 uppercase tracking-wide flex items-center gap-2">
                Overallocation Guard Triggered
                <span className="px-2 py-0.5 text-[10px] font-mono bg-rose-900/80 text-rose-300 border border-rose-700 rounded">
                  Admission Locked
                </span>
              </h3>
              <p className="text-xs text-rose-300/90 mt-0.5">
                Cluster quota requests exceed physical allocatable host capacity (
                {data.isCpuOverallocated && `CPU: ${data.requestedCpuStr} > ${data.allocatableCpuStr} `}
                {data.isMemoryOverallocated && `Memory: ${data.requestedMemoryStr} > ${data.allocatableMemoryStr} `}
                {data.isStorageOverallocated && `Storage: ${data.requestedStorageStr} > ${data.allocatableStorageStr}`}
                ). New vCluster provisioning is automatically blocked to safeguard host stability.
              </p>
            </div>
          </div>
        </div>
      )}

      {data && !data.isCpuOverallocated && !data.isMemoryOverallocated && !data.isStorageOverallocated && (data.cpuUtilizationPct > 80 || data.memoryUtilizationPct > 80) && (
        <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/40 flex items-center gap-3 text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <div className="text-xs">
            <strong className="font-semibold text-amber-300 block">High Allocation Warning:</strong>
            Virtual clusters have claimed over 80% of cluster allocatable resources. Plan for node scale-up before provisioning large workloads.
          </div>
        </div>
      )}

      {/* 3 Core Capacity Telemetry Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* CPU Card */}
        <div className="p-5 rounded-2xl bg-cyber-900/70 border border-cyber-700/80 relative overflow-hidden backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-mono uppercase text-slate-400 tracking-wider">Host CPU Pool</span>
                <div className="text-xl font-bold text-white font-mono">
                  {data?.allocatableCpuStr || '32 CPU'}
                </div>
              </div>
            </div>
            <div className="text-right font-mono">
              <span
                className={`text-xs font-bold px-2 py-1 rounded-md border ${
                  (data?.cpuUtilizationPct || 0) > 100
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : (data?.cpuUtilizationPct || 0) > 80
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                }`}
              >
                {data?.cpuUtilizationPct || 0}% Allocated
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-full bg-cyber-950 rounded-full overflow-hidden border border-cyber-700/50 p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (data?.cpuUtilizationPct || 0) > 100
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-gradient-to-r from-cyan-500 to-blue-500'
                }`}
                style={{ width: `${Math.min(100, data?.cpuUtilizationPct || 0)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>{data?.requestedCpuStr || '0 CPU'} Requested</span>
              <span className="text-emerald-400 font-semibold">{data?.availableCpuStr || '0 CPU'} Available</span>
            </div>
          </div>

          {/* Breakdown Pills */}
          <div className="mt-4 pt-4 border-t border-cyber-800 grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="bg-cyber-950/60 p-2 rounded-lg border border-cyber-800/80">
              <span className="text-[10px] text-slate-500 block">Fleet Limits</span>
              <span className="text-slate-200 font-semibold">{data?.limitsCpuStr || '0 CPU'}</span>
            </div>
            <div className="bg-cyber-950/60 p-2 rounded-lg border border-cyber-800/80">
              <span className="text-[10px] text-slate-500 block">Actual Live Usage</span>
              <span className="text-cyan-300 font-semibold">{data?.usedCpuStr || '0m'}</span>
            </div>
          </div>
        </div>

        {/* Memory Card */}
        <div className="p-5 rounded-2xl bg-cyber-900/70 border border-cyber-700/80 relative overflow-hidden backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-mono uppercase text-slate-400 tracking-wider">Host Memory Pool</span>
                <div className="text-xl font-bold text-white font-mono">
                  {data?.allocatableMemoryStr || '0 GiB'}
                </div>
              </div>
            </div>
            <div className="text-right font-mono">
              <span
                className={`text-xs font-bold px-2 py-1 rounded-md border ${
                  (data?.memoryUtilizationPct || 0) > 100
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : (data?.memoryUtilizationPct || 0) > 80
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                }`}
              >
                {data?.memoryUtilizationPct || 0}% Allocated
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-full bg-cyber-950 rounded-full overflow-hidden border border-cyber-700/50 p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (data?.memoryUtilizationPct || 0) > 100
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-gradient-to-r from-purple-500 to-indigo-500'
                }`}
                style={{ width: `${Math.min(100, data?.memoryUtilizationPct || 0)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>{data?.requestedMemoryStr || '0 GiB'} Requested</span>
              <span className="text-emerald-400 font-semibold">{data?.availableMemoryStr || '0 GiB'} Available</span>
            </div>
          </div>

          {/* Breakdown Pills */}
          <div className="mt-4 pt-4 border-t border-cyber-800 grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="bg-cyber-950/60 p-2 rounded-lg border border-cyber-800/80">
              <span className="text-[10px] text-slate-500 block">Fleet Limits</span>
              <span className="text-slate-200 font-semibold">{data?.limitsMemoryStr || '0 GiB'}</span>
            </div>
            <div className="bg-cyber-950/60 p-2 rounded-lg border border-cyber-800/80">
              <span className="text-[10px] text-slate-500 block">Actual Live Usage</span>
              <span className="text-purple-300 font-semibold">{data?.usedMemoryStr || '0 MiB'}</span>
            </div>
          </div>
        </div>

        {/* Storage Card */}
        <div className="p-5 rounded-2xl bg-cyber-900/70 border border-cyber-700/80 relative overflow-hidden backdrop-blur-md shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-mono uppercase text-slate-400 tracking-wider">Host Storage Pool</span>
                <div className="text-xl font-bold text-white font-mono">
                  {data?.allocatableStorageStr || '0 GiB'}
                </div>
              </div>
            </div>
            <div className="text-right font-mono">
              <span
                className={`text-xs font-bold px-2 py-1 rounded-md border ${
                  (data?.storageUtilizationPct || 0) > 100
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : (data?.storageUtilizationPct || 0) > 80
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {data?.storageUtilizationPct || 0}% Allocated
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-full bg-cyber-950 rounded-full overflow-hidden border border-cyber-700/50 p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (data?.storageUtilizationPct || 0) > 100
                    ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500'
                }`}
                style={{ width: `${Math.min(100, data?.storageUtilizationPct || 0)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-400">
              <span>{data?.requestedStorageStr || '0 GiB'} Requested</span>
              <span className="text-emerald-400 font-semibold">{data?.availableStorageStr || '0 GiB'} Available</span>
            </div>
          </div>

          {/* Breakdown Pills */}
          <div className="mt-4 pt-4 border-t border-cyber-800 grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="bg-cyber-950/60 p-2 rounded-lg border border-cyber-800/80">
              <span className="text-[10px] text-slate-500 block">Host Node Count</span>
              <span className="text-slate-200 font-semibold">{data?.totalNodes || 1} Node(s)</span>
            </div>
            <div className="bg-cyber-950/60 p-2 rounded-lg border border-cyber-800/80">
              <span className="text-[10px] text-slate-500 block">Actual Live Bound</span>
              <span className="text-emerald-300 font-semibold">{data?.usedStorageStr || '0 GiB'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Virtual Cluster Quota Breakdown Table */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Tenant Resource Demands</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-cyber-800 border border-cyber-700 font-mono text-slate-300">
                {filteredClusters.length}
              </span>
            </h2>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Filter by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-cyber-900 border border-cyber-700 rounded-xl text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-cyber-800 bg-cyber-900/60 backdrop-blur-md">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-cyber-800 bg-cyber-950/70 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3.5 px-4 font-semibold">Virtual Cluster</th>
                <th className="py-3.5 px-4 font-semibold">Preset & Phase</th>
                <th className="py-3.5 px-4 font-semibold">CPU Demands</th>
                <th className="py-3.5 px-4 font-semibold">RAM Demands</th>
                <th className="py-3.5 px-4 font-semibold">Storage Demands</th>
                <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-800/60 font-mono">
              {filteredClusters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No virtual clusters matching filter.
                  </td>
                </tr>
              ) : (
                filteredClusters.map((vc) => (
                  <tr key={vc.name} className="hover:bg-cyber-800/40 transition-colors">
                    {/* Cluster Name & Namespace */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-cyber-800 border border-cyber-700 flex items-center justify-center text-cyan-400 font-bold">
                          {vc.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <a
                            href={`/clusters/${vc.name}`}
                            className="font-bold text-white hover:text-cyan-400 transition-colors flex items-center gap-1"
                          >
                            <span>{vc.name}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </a>
                          <span className="text-[10px] text-slate-500 block">ns: {vc.namespace}</span>
                        </div>
                      </div>
                    </td>

                    {/* Preset & Status */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1">
                        <span className="capitalize px-2 py-0.5 rounded bg-cyber-800 text-slate-300 border border-cyber-700 text-[10px] w-fit font-semibold">
                          {vc.preset}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            vc.phase === 'Ready'
                              ? 'text-emerald-400'
                              : vc.phase === 'Sleeping'
                              ? 'text-indigo-400'
                              : 'text-amber-400'
                          }`}
                        >
                          ● {vc.phase}
                        </span>
                      </div>
                    </td>

                    {/* CPU Demands */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4 text-slate-200">
                          <span>Req: <strong className="text-white">{vc.requestedCpuStr}</strong></span>
                          <span className="text-[10px] text-cyan-400 bg-cyan-950/60 px-1.5 py-0.2 rounded border border-cyan-800/60">
                            {vc.cpuSharePercent}% of Host
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-2">
                          <span>Lim: {vc.limitsCpuStr}</span>
                          <span>•</span>
                          <span className="text-cyan-300">Used: {vc.usedCpuStr}</span>
                        </div>
                      </div>
                    </td>

                    {/* RAM Demands */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4 text-slate-200">
                          <span>Req: <strong className="text-white">{vc.requestedMemoryStr}</strong></span>
                          <span className="text-[10px] text-purple-400 bg-purple-950/60 px-1.5 py-0.2 rounded border border-purple-800/60">
                            {vc.memorySharePercent}% of Host
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-2">
                          <span>Lim: {vc.limitsMemoryStr}</span>
                          <span>•</span>
                          <span className="text-purple-300">Used: {vc.usedMemoryStr}</span>
                        </div>
                      </div>
                    </td>

                    {/* Storage Demands */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-4 text-slate-200">
                          <span>Req: <strong className="text-white">{vc.requestedStorageStr}</strong></span>
                          <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-800/60">
                            {vc.storageSharePercent}% of Host
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          <span className="text-emerald-300">Used: {vc.usedStorageStr}</span>
                        </div>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <a
                        href={`/clusters/${vc.name}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyber-800 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-cyber-700 hover:border-cyan-500/40 transition-colors"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>Adjust Quota</span>
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
