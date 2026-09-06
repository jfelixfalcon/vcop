import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Cpu,
  Database,
  HardDrive,
  Activity,
  Layers,
  Box,
  Server,
  RefreshCw,
  Search,
  Filter,
  Clock,
  ArrowUpDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Flame,
  Maximize2,
  Minimize2,
  BarChart3,
  Calendar,
  Sparkles,
  Info,
  X,
} from 'lucide-react';
import type {
  VirtualCluster,
  ClusterMetricsResponse,
  LivePodMetric,
  LiveWorkloadMetric,
  MetricTimeBucket,
  WorkloadKind,
} from '../lib/types';
import { formatCpuMillis, formatMemoryBytes } from '../lib/metrics-utils';

interface Props {
  cluster: VirtualCluster;
}

type TimeRange = '15m' | '1h' | '6h' | '24h' | '7d';
type ViewMode = 'workloads' | 'pods' | 'heatmap';
type SortField = 'cpu' | 'memory' | 'restarts' | 'name';

export const WorkloadMetricsView: React.FC<Props> = ({ cluster }) => {
  // Data states
  const [liveData, setLiveData] = useState<ClusterMetricsResponse | null>(null);
  const [historicalBuckets, setHistoricalBuckets] = useState<MetricTimeBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states
  const [timeRange, setTimeRange] = useState<TimeRange>('1h');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [selectedKind, setSelectedKind] = useState<string>('all');
  const [selectedHealth, setSelectedHealth] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('cpu');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>('workloads');
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(15);

  // Interaction states
  const [expandedWorkloads, setExpandedWorkloads] = useState<Record<string, boolean>>({});
  const [selectedPod, setSelectedPod] = useState<LivePodMetric | null>(null);
  const [focusedWorkload, setFocusedWorkload] = useState<LiveWorkloadMetric | null>(null);

  // Chart hover crosshair state
  const [hoveredBucket, setHoveredBucket] = useState<{
    bucket: MetricTimeBucket;
    xPercent: number;
  } | null>(null);

  // Fetch Live Metrics
  const fetchLiveMetrics = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/metrics/live`);
      const data = await res.json();
      if (data.success) {
        setLiveData(data);
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch live metrics');
      }
    } catch (err: any) {
      setError(err.message || 'Connection error while fetching metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch Historical Metrics
  const fetchHistoricalMetrics = async () => {
    try {
      let url = `/api/vclusters/${cluster.name}/metrics/historical?range=${timeRange}`;
      if (selectedNamespace !== 'all') {
        url += `&namespace=${encodeURIComponent(selectedNamespace)}`;
      }
      if (focusedWorkload) {
        url += `&workload=${encodeURIComponent(focusedWorkload.name)}&kind=${encodeURIComponent(focusedWorkload.kind)}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.buckets) {
        setHistoricalBuckets(data.buckets);
      }
    } catch (err) {
      console.warn('Failed to load historical metrics:', err);
    }
  };

  // Initial load and polling setup
  useEffect(() => {
    fetchLiveMetrics();
    fetchHistoricalMetrics();
  }, [cluster.name]);

  useEffect(() => {
    fetchHistoricalMetrics();
  }, [timeRange, selectedNamespace, focusedWorkload]);

  // Periodic live refresh interval
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;
    const interval = setInterval(() => {
      fetchLiveMetrics();
    }, refreshIntervalSec * 1000);
    return () => clearInterval(interval);
  }, [cluster.name, refreshIntervalSec]);

  // Available namespaces
  const namespaces = useMemo(() => {
    if (!liveData) return [];
    return liveData.summary.namespaces || [];
  }, [liveData]);

  // Filtered and Sorted Workloads
  const filteredWorkloads = useMemo(() => {
    if (!liveData) return [];
    let list = [...liveData.workloads];

    if (selectedNamespace !== 'all') {
      list = list.filter((w) => w.namespace === selectedNamespace);
    }
    if (selectedKind !== 'all') {
      list = list.filter((w) => w.kind === selectedKind);
    }
    if (selectedHealth !== 'all') {
      list = list.filter((w) => w.status.toLowerCase() === selectedHealth.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          w.namespace.toLowerCase().includes(q) ||
          w.pods.some((p) => p.name.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let valA: any = a.totalCpuMillis;
      let valB: any = b.totalCpuMillis;
      if (sortField === 'memory') {
        valA = a.totalMemoryBytes;
        valB = b.totalMemoryBytes;
      } else if (sortField === 'restarts') {
        valA = a.totalRestarts;
        valB = b.totalRestarts;
      } else if (sortField === 'name') {
        valA = a.name;
        valB = b.name;
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [liveData, selectedNamespace, selectedKind, selectedHealth, searchQuery, sortField, sortAsc]);

  // Filtered and Sorted Pods
  const filteredPods = useMemo(() => {
    if (!liveData) return [];
    let list = [...liveData.pods];

    if (selectedNamespace !== 'all') {
      list = list.filter((p) => p.namespace === selectedNamespace);
    }
    if (selectedKind !== 'all') {
      list = list.filter((p) => p.workloadKind === selectedKind);
    }
    if (selectedHealth !== 'all') {
      if (selectedHealth === 'healthy') list = list.filter((p) => p.ready && p.phase === 'Running');
      else if (selectedHealth === 'degraded') list = list.filter((p) => !p.ready && p.phase === 'Running');
      else if (selectedHealth === 'critical') list = list.filter((p) => p.phase === 'CrashLoopBackOff' || p.phase === 'Failed');
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.namespace.toLowerCase().includes(q) ||
          p.workloadName.toLowerCase().includes(q) ||
          (p.nodeName && p.nodeName.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => {
      let valA: any = a.cpuMillis;
      let valB: any = b.cpuMillis;
      if (sortField === 'memory') {
        valA = a.memoryBytes;
        valB = b.memoryBytes;
      } else if (sortField === 'restarts') {
        valA = a.restarts;
        valB = b.restarts;
      } else if (sortField === 'name') {
        valA = a.name;
        valB = b.name;
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    return list;
  }, [liveData, selectedNamespace, selectedKind, selectedHealth, searchQuery, sortField, sortAsc]);

  // SVG Chart Computations
  const chartData = useMemo(() => {
    if (!historicalBuckets || historicalBuckets.length === 0) {
      return null;
    }
    const maxCpu = Math.max(...historicalBuckets.map((b) => b.totalCpuMillis), 50);
    const maxMem = Math.max(...historicalBuckets.map((b) => b.totalMemoryBytes), 64 * 1024 * 1024);

    const width = 800;
    const height = 220;
    const padding = { top: 20, right: 30, bottom: 35, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const pointsCpu: { x: number; y: number; bucket: MetricTimeBucket }[] = [];
    const pointsMem: { x: number; y: number; bucket: MetricTimeBucket }[] = [];

    const n = historicalBuckets.length;
    historicalBuckets.forEach((b, i) => {
      const x = padding.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
      const yCpu = padding.top + chartH - (b.totalCpuMillis / maxCpu) * chartH;
      const yMem = padding.top + chartH - (b.totalMemoryBytes / maxMem) * chartH;
      pointsCpu.push({ x, y: Math.max(padding.top, Math.min(height - padding.bottom, yCpu)), bucket: b });
      pointsMem.push({ x, y: Math.max(padding.top, Math.min(height - padding.bottom, yMem)), bucket: b });
    });

    // Build SVG Path Strings
    const buildPath = (pts: { x: number; y: number }[], closeBottom = false) => {
      if (pts.length === 0) return '';
      let d = `M ${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const cur = pts[i];
        const cx = (prev.x + cur.x) / 2;
        d += ` C ${cx} ${prev.y}, ${cx} ${cur.y}, ${cur.x} ${cur.y}`;
      }
      if (closeBottom) {
        d += ` L ${pts[pts.length - 1].x} ${padding.top + chartH} L ${pts[0].x} ${padding.top + chartH} Z`;
      }
      return d;
    };

    return {
      width,
      height,
      padding,
      chartW,
      chartH,
      maxCpu,
      maxMem,
      cpuPath: buildPath(pointsCpu, false),
      cpuArea: buildPath(pointsCpu, true),
      memPath: buildPath(pointsMem, false),
      memArea: buildPath(pointsMem, true),
      pointsCpu,
      pointsMem,
    };
  }, [historicalBuckets]);

  const toggleWorkloadExpand = (key: string) => {
    setExpandedWorkloads((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const getWorkloadKindIcon = (kind: WorkloadKind) => {
    switch (kind) {
      case 'Deployment':
        return <Box className="w-4 h-4 text-cyan-400" />;
      case 'StatefulSet':
        return <Database className="w-4 h-4 text-purple-400" />;
      case 'DaemonSet':
        return <Layers className="w-4 h-4 text-emerald-400" />;
      case 'Job':
      case 'CronJob':
        return <Clock className="w-4 h-4 text-amber-400" />;
      default:
        return <Server className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-cyber-900/60 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Workload Observability & Pod Telemetry
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                  2026 Engine
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time container performance with historical workload continuity backed by PostgreSQL
              </p>
            </div>
          </div>
        </div>

        {/* Global Controls & Auto-Refresh */}
        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-auto">
          {/* Refresh interval dropdown */}
          <div className="flex items-center bg-cyber-950/80 border border-cyber-750 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
            <select
              value={refreshIntervalSec}
              onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value={5} className="bg-cyber-900">Live (5s)</option>
              <option value={15} className="bg-cyber-900">15s</option>
              <option value={30} className="bg-cyber-900">30s</option>
              <option value={0} className="bg-cyber-900">Paused</option>
            </select>
          </div>

          {/* Manual Refresh button */}
          <button
            onClick={() => fetchLiveMetrics(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-200 border border-cyber-700 rounded-xl text-xs font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
            title="Refresh metrics immediately"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hero KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU Usage Card */}
        <div className="relative overflow-hidden bg-cyber-900/80 border border-cyan-500/20 rounded-2xl p-5 shadow-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              CPU Utilization
            </span>
            <div className="p-2 bg-cyan-500/10 rounded-xl text-cyan-400 border border-cyan-500/20">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold font-mono text-white">
              {liveData?.summary?.totalCpuUsage || '0m'}
            </span>
            {liveData?.summary?.cpuPercent !== undefined && (
              <span className="text-xs font-mono text-cyan-400 font-semibold">
                ({liveData.summary.cpuPercent}%)
              </span>
            )}
          </div>
          <div className="w-full bg-cyber-950 rounded-full h-1.5 overflow-hidden mt-3 border border-cyber-800">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
              style={{
                width: `${Math.min(100, liveData?.summary?.cpuPercent || (liveData?.summary?.totalCpuMillis ? Math.min(100, (liveData.summary.totalCpuMillis / 2000) * 100) : 5))}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-2">
            <span>Aggregated Active Millicores</span>
            <span className="text-cyan-400 font-semibold">Live</span>
          </div>
        </div>

        {/* Memory Usage Card */}
        <div className="relative overflow-hidden bg-cyber-900/80 border border-purple-500/20 rounded-2xl p-5 shadow-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Memory Working Set
            </span>
            <div className="p-2 bg-purple-500/10 rounded-xl text-purple-400 border border-purple-500/20">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold font-mono text-white">
              {liveData?.summary?.totalMemoryUsage || '0Mi'}
            </span>
            {liveData?.summary?.memPercent !== undefined && (
              <span className="text-xs font-mono text-purple-400 font-semibold">
                ({liveData.summary.memPercent}%)
              </span>
            )}
          </div>
          <div className="w-full bg-cyber-950 rounded-full h-1.5 overflow-hidden mt-3 border border-cyber-800">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
              style={{
                width: `${Math.min(100, liveData?.summary?.memPercent || (liveData?.summary?.totalMemoryBytes ? Math.min(100, (liveData.summary.totalMemoryBytes / (4 * 1024 * 1024 * 1024)) * 100) : 10))}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-2">
            <span>Aggregated RSS + Cache</span>
            <span className="text-purple-400 font-semibold">Live</span>
          </div>
        </div>

        {/* Pods Status Breakdown Card */}
        <div className="relative overflow-hidden bg-cyber-900/80 border border-emerald-500/20 rounded-2xl p-5 shadow-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Active Pods
            </span>
            <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold font-mono text-white">
              {liveData?.summary?.totalPods ?? 0}
            </span>
            <span className="text-xs text-slate-400">instances</span>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-mono text-[11px] border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {liveData?.summary?.runningPods ?? 0} Running
            </span>
            {(liveData?.summary?.pendingPods || 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 font-mono text-[11px] border border-amber-500/20">
                {liveData?.summary?.pendingPods} Pending
              </span>
            )}
            {(liveData?.summary?.failedPods || 0) > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 font-mono text-[11px] border border-rose-500/20">
                {liveData?.summary?.failedPods} Critical
              </span>
            )}
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-2">
            <span>Health & Scheduling</span>
            <span className="text-emerald-400 font-semibold">Ready</span>
          </div>
        </div>

        {/* Workloads & Container Restarts Card */}
        <div className="relative overflow-hidden bg-cyber-900/80 border border-amber-500/20 rounded-2xl p-5 shadow-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Workloads & Restarts
            </span>
            <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400 border border-amber-500/20">
              <Flame className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold font-mono text-white">
              {liveData?.summary?.totalWorkloads ?? 0}
            </span>
            <span className="text-xs text-slate-400">controllers</span>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] border ${
                (liveData?.summary?.totalRestarts || 0) > 0
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}
            >
              {(liveData?.summary?.totalRestarts || 0) === 0 ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  0 Restarts
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  {liveData?.summary?.totalRestarts} Restarts
                </>
              )}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-2">
            <span>Durable Workload Tracking</span>
            <span className="text-amber-400 font-semibold font-mono">Continuous</span>
          </div>
        </div>
      </div>

      {/* Historical Time-Series Interactive Charts (Grafana Replacement) */}
      <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-3xl p-6 shadow-2xl relative">
        {/* Chart Header & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-cyber-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Historical Performance Curves
                {focusedWorkload && (
                  <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-normal">
                    Filtering: {focusedWorkload.kind}/{focusedWorkload.name}
                  </span>
                )}
              </h3>
              {focusedWorkload && (
                <button
                  onClick={() => setFocusedWorkload(null)}
                  className="text-xs text-slate-400 hover:text-white underline ml-1"
                >
                  Reset filter
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Unbroken telemetry across pod replacements and deployment rollouts
            </p>
          </div>

          {/* Time Range Selector */}
          <div className="flex items-center bg-cyber-950 p-1 rounded-xl border border-cyber-750">
            {(['15m', '1h', '6h', '24h', '7d'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  timeRange === r
                    ? 'bg-cyan-500 text-black font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Dual Chart Area (CPU & Memory) */}
        {chartData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CPU Chart */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  CPU Consumption ({formatCpuMillis(chartData.maxCpu)} peak)
                </span>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                  millicores (m)
                </span>
              </div>
              <div className="relative bg-cyber-950/70 border border-cyber-800 rounded-2xl p-2">
                <svg
                  viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                  className="w-full h-48 overflow-visible"
                  onMouseLeave={() => setHoveredBucket(null)}
                >
                  <defs>
                    <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0.25, 0.5, 0.75, 1].map((p) => {
                    const y = chartData.padding.top + chartData.chartH * (1 - p);
                    return (
                      <g key={p}>
                        <line
                          x1={chartData.padding.left}
                          y1={y}
                          x2={chartData.width - chartData.padding.right}
                          y2={y}
                          stroke="#1e293b"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x={chartData.padding.left - 8}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#64748b"
                          fontFamily="monospace"
                        >
                          {Math.round(chartData.maxCpu * p)}m
                        </text>
                      </g>
                    );
                  })}

                  {/* CPU Area & Line */}
                  <path d={chartData.cpuArea} fill="url(#cpuGrad)" />
                  <path d={chartData.cpuPath} fill="none" stroke="#06b6d4" strokeWidth="2.5" />

                  {/* Interactive Points on Hover */}
                  {chartData.pointsCpu.map((pt, idx) => (
                    <circle
                      key={idx}
                      cx={pt.x}
                      cy={pt.y}
                      r="3.5"
                      fill="#06b6d4"
                      className="transition-all hover:r-5 cursor-pointer opacity-70 hover:opacity-100"
                      onMouseEnter={() =>
                        setHoveredBucket({
                          bucket: pt.bucket,
                          xPercent: (pt.x / chartData.width) * 100,
                        })
                      }
                    />
                  ))}

                  {/* Crosshair indicator */}
                  {hoveredBucket && (
                    <line
                      x1={(hoveredBucket.xPercent / 100) * chartData.width}
                      y1={chartData.padding.top}
                      x2={(hoveredBucket.xPercent / 100) * chartData.width}
                      y2={chartData.height - chartData.padding.bottom}
                      stroke="#38bdf8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  )}
                </svg>
              </div>
            </div>

            {/* Memory Chart */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
                  Memory Utilization ({formatMemoryBytes(chartData.maxMem)} peak)
                </span>
                <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                  working set
                </span>
              </div>
              <div className="relative bg-cyber-950/70 border border-cyber-800 rounded-2xl p-2">
                <svg
                  viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                  className="w-full h-48 overflow-visible"
                  onMouseLeave={() => setHoveredBucket(null)}
                >
                  <defs>
                    <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0.25, 0.5, 0.75, 1].map((p) => {
                    const y = chartData.padding.top + chartData.chartH * (1 - p);
                    return (
                      <g key={p}>
                        <line
                          x1={chartData.padding.left}
                          y1={y}
                          x2={chartData.width - chartData.padding.right}
                          y2={y}
                          stroke="#1e293b"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x={chartData.padding.left - 8}
                          y={y + 3}
                          textAnchor="end"
                          fontSize="9"
                          fill="#64748b"
                          fontFamily="monospace"
                        >
                          {formatMemoryBytes(chartData.maxMem * p)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Memory Area & Line */}
                  <path d={chartData.memArea} fill="url(#memGrad)" />
                  <path d={chartData.memPath} fill="none" stroke="#c084fc" strokeWidth="2.5" />

                  {/* Interactive Points on Hover */}
                  {chartData.pointsMem.map((pt, idx) => (
                    <circle
                      key={idx}
                      cx={pt.x}
                      cy={pt.y}
                      r="3.5"
                      fill="#c084fc"
                      className="transition-all hover:r-5 cursor-pointer opacity-70 hover:opacity-100"
                      onMouseEnter={() =>
                        setHoveredBucket({
                          bucket: pt.bucket,
                          xPercent: (pt.x / chartData.width) * 100,
                        })
                      }
                    />
                  ))}

                  {/* Crosshair indicator */}
                  {hoveredBucket && (
                    <line
                      x1={(hoveredBucket.xPercent / 100) * chartData.width}
                      y1={chartData.padding.top}
                      x2={(hoveredBucket.xPercent / 100) * chartData.width}
                      y2={chartData.height - chartData.padding.bottom}
                      stroke="#c084fc"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  )}
                </svg>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-14 text-center text-slate-500 font-mono text-xs flex flex-col items-center justify-center gap-2">
            <Activity className="w-6 h-6 text-slate-600 animate-pulse" />
            <span>Telemetry buffer warming up... recording live pod samples to PostgreSQL.</span>
          </div>
        )}

        {/* Hover Snapshot Tooltip */}
        {hoveredBucket && (
          <div className="mt-4 p-3 bg-cyber-950/95 border border-cyan-500/40 rounded-xl flex flex-wrap items-center justify-between gap-4 text-xs font-mono shadow-2xl animate-in fade-in duration-100">
            <div className="flex items-center gap-2 text-slate-300">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>{new Date(hoveredBucket.bucket.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="flex items-center gap-6">
              <span className="text-cyan-300 font-bold">
                CPU: {formatCpuMillis(hoveredBucket.bucket.totalCpuMillis)}
              </span>
              <span className="text-purple-300 font-bold">
                RAM: {formatMemoryBytes(hoveredBucket.bucket.totalMemoryBytes)}
              </span>
              <span className="text-emerald-300 font-bold">
                Pods: {hoveredBucket.bucket.activePods} active
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Filter & Control Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-cyber-900/70 border border-cyber-750 p-4 rounded-2xl">
        {/* Search & Namespace Filters */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search deployment, pod, node..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-cyber-950 border border-cyber-700 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Namespace Filter */}
          <div className="flex items-center bg-cyber-950 border border-cyber-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
            <Filter className="w-3 h-3 text-slate-400 mr-1.5" />
            <span className="text-slate-500 mr-1">ns:</span>
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-cyber-900">All Namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns} className="bg-cyber-900">
                  {ns}
                </option>
              ))}
            </select>
          </div>

          {/* Workload Kind Filter */}
          <div className="flex items-center bg-cyber-950 border border-cyber-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
            <span className="text-slate-500 mr-1">kind:</span>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-cyber-900">All Workloads</option>
              <option value="Deployment" className="bg-cyber-900">Deployments</option>
              <option value="StatefulSet" className="bg-cyber-900">StatefulSets</option>
              <option value="DaemonSet" className="bg-cyber-900">DaemonSets</option>
              <option value="Job" className="bg-cyber-900">Jobs</option>
              <option value="Pod" className="bg-cyber-900">Standalone Pods</option>
            </select>
          </div>

          {/* Health Filter */}
          <div className="flex items-center bg-cyber-950 border border-cyber-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300">
            <span className="text-slate-500 mr-1">status:</span>
            <select
              value={selectedHealth}
              onChange={(e) => setSelectedHealth(e.target.value)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-cyber-900">All Health</option>
              <option value="healthy" className="bg-cyber-900">Healthy</option>
              <option value="degraded" className="bg-cyber-900">Degraded</option>
              <option value="critical" className="bg-cyber-900">Critical / Failing</option>
            </select>
          </div>
        </div>

        {/* View Mode Switcher & Sort */}
        <div className="flex items-center gap-3 self-end md:self-auto">
          {/* Sort selector */}
          <div className="flex items-center bg-cyber-950 border border-cyber-700 rounded-xl px-2 py-1 text-xs text-slate-300">
            <ArrowUpDown className="w-3 h-3 text-slate-400 mr-1" />
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as any)}
              className="bg-transparent text-xs text-slate-200 focus:outline-none cursor-pointer mr-1"
            >
              <option value="cpu" className="bg-cyber-900">CPU Usage</option>
              <option value="memory" className="bg-cyber-900">Memory Usage</option>
              <option value="restarts" className="bg-cyber-900">Restarts</option>
              <option value="name" className="bg-cyber-900">Name</option>
            </select>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="text-[10px] px-1 text-cyan-400 font-mono"
            >
              {sortAsc ? '▲' : '▼'}
            </button>
          </div>

          {/* View Mode Buttons */}
          <div className="flex items-center bg-cyber-950 p-1 rounded-xl border border-cyber-750">
            <button
              onClick={() => setViewMode('workloads')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                viewMode === 'workloads'
                  ? 'bg-cyber-750 text-cyan-400 font-semibold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Group pods by Deployment / StatefulSet"
            >
              Workloads
            </button>
            <button
              onClick={() => setViewMode('pods')}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                viewMode === 'pods'
                  ? 'bg-cyber-750 text-cyan-400 font-semibold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Individual pods list"
            >
              Pods
            </button>
          </div>
        </div>
      </div>

      {/* VIEW 1: Workloads Grouped View (Flagship, Solves Pod Rollouts) */}
      {viewMode === 'workloads' && (
        <div className="space-y-3">
          {filteredWorkloads.length === 0 ? (
            <div className="p-12 text-center bg-cyber-900/40 border border-cyber-800 rounded-3xl text-slate-500 font-mono text-xs">
              No workloads match current filter criteria.
            </div>
          ) : (
            filteredWorkloads.map((w) => {
              const key = `${w.namespace}/${w.kind}/${w.name}`;
              const isExpanded = !!expandedWorkloads[key];

              return (
                <div
                  key={key}
                  className="bg-cyber-900/80 border border-cyber-750/70 hover:border-cyan-500/40 rounded-2xl overflow-hidden transition-all duration-150 shadow-md"
                >
                  {/* Workload Row Header */}
                  <div
                    onClick={() => toggleWorkloadExpand(key)}
                    className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-cyber-800/40"
                  >
                    {/* Left: Kind Icon + Name + Namespace */}
                    <div className="flex items-center gap-3">
                      <button className="p-1 text-slate-400 hover:text-white">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-cyan-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <div className="p-2 bg-cyber-950 border border-cyber-700 rounded-xl">
                        {getWorkloadKindIcon(w.kind)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white text-sm font-mono tracking-tight">
                            {w.name}
                          </h4>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-cyber-950 text-slate-300 font-mono border border-cyber-750">
                            {w.kind}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-cyber-950 text-cyan-300 font-mono border border-cyan-500/20">
                            ns: {w.namespace}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                          <span>
                            {w.readyPodsCount}/{w.podsCount} Pods Ready
                          </span>
                          <span>•</span>
                          <span
                            className={
                              w.totalRestarts > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'
                            }
                          >
                            {w.totalRestarts} Restarts
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Right: Aggregated Metrics Bars + Actions */}
                    <div className="flex flex-wrap items-center gap-6 self-start md:self-auto">
                      {/* CPU Metric pill */}
                      <div className="flex flex-col min-w-[110px]">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">
                          Total CPU
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono font-bold text-white text-sm">
                            {w.totalCpuUsage}
                          </span>
                        </div>
                        <div className="w-24 bg-cyber-950 rounded-full h-1 mt-1 overflow-hidden border border-cyber-800">
                          <div
                            className="bg-cyan-400 h-full"
                            style={{
                              width: `${Math.min(100, Math.max(5, (w.totalCpuMillis / 1000) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Memory Metric pill */}
                      <div className="flex flex-col min-w-[110px]">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold">
                          Total Memory
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono font-bold text-white text-sm">
                            {w.totalMemoryUsage}
                          </span>
                        </div>
                        <div className="w-24 bg-cyber-950 rounded-full h-1 mt-1 overflow-hidden border border-cyber-800">
                          <div
                            className="bg-purple-400 h-full"
                            style={{
                              width: `${Math.min(100, Math.max(5, (w.totalMemoryBytes / (1024 * 1024 * 1024)) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Focus Workload Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedWorkload(focusedWorkload?.name === w.name ? null : w);
                        }}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-mono transition-all ${
                          focusedWorkload?.name === w.name
                            ? 'bg-cyan-500 text-black border-cyan-400 font-bold shadow-glow-cyan'
                            : 'bg-cyber-950 hover:bg-cyber-800 text-slate-300 border-cyber-700'
                        }`}
                        title="Focus historical chart on this continuous workload"
                      >
                        {focusedWorkload?.name === w.name ? 'Focused' : 'Chart History'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Sub-Pods List */}
                  {isExpanded && (
                    <div className="bg-cyber-950/90 border-t border-cyber-800 p-4 sm:p-5 space-y-2">
                      <div className="flex items-center justify-between pb-2 border-b border-cyber-850 text-slate-400 text-xs font-mono">
                        <span>Replicas & Pod Revisions ({w.pods.length})</span>
                        <span>Historical continuity maintained across pod lifecycles</span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                          <thead>
                            <tr className="text-slate-400 border-b border-cyber-800/80">
                              <th className="py-2 px-3">Pod Instance</th>
                              <th className="py-2 px-3">Status</th>
                              <th className="py-2 px-3">Restarts</th>
                              <th className="py-2 px-3">CPU</th>
                              <th className="py-2 px-3">Memory</th>
                              <th className="py-2 px-3">Age</th>
                              <th className="py-2 px-3 text-right">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-cyber-800/40">
                            {w.pods.map((p) => (
                              <tr
                                key={p.name}
                                className="hover:bg-cyber-900/60 transition-colors"
                              >
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-white">{p.name}</div>
                                  <div className="text-[10px] text-slate-500">
                                    node: {p.nodeName || 'unknown'} • IP: {p.podIP || 'none'}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
                                      p.phase === 'Running'
                                        ? p.ready
                                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                                          : 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                                        : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        p.ready ? 'bg-emerald-400' : 'bg-amber-400'
                                      }`}
                                    />
                                    {p.phase}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-slate-300">
                                  {p.restarts > 0 ? (
                                    <span className="text-amber-400 font-bold">
                                      {p.restarts}
                                    </span>
                                  ) : (
                                    '0'
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-cyan-300 font-bold">
                                  {p.cpuUsage}
                                </td>
                                <td className="py-2.5 px-3 text-purple-300 font-bold">
                                  {p.memoryUsage}
                                </td>
                                <td className="py-2.5 px-3 text-slate-400">{p.age}</td>
                                <td className="py-2.5 px-3 text-right">
                                  <button
                                    onClick={() => setSelectedPod(p)}
                                    className="px-2.5 py-1 bg-cyber-800 hover:bg-cyber-750 text-slate-200 rounded-lg text-[11px] border border-cyber-700 transition-all"
                                  >
                                    Inspect
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW 2: Flat Pods Table View */}
      {viewMode === 'pods' && (
        <div className="bg-cyber-900/80 border border-cyber-750 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="bg-cyber-950/80 text-slate-400 border-b border-cyber-800">
                  <th className="py-3 px-4">Pod Name & Namespace</th>
                  <th className="py-3 px-4">Owner Workload</th>
                  <th className="py-3 px-4">Phase</th>
                  <th className="py-3 px-4">Containers</th>
                  <th className="py-3 px-4">Restarts</th>
                  <th className="py-3 px-4">CPU Usage</th>
                  <th className="py-3 px-4">Memory Usage</th>
                  <th className="py-3 px-4">Node</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-800/60">
                {filteredPods.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500">
                      No pods found matching query.
                    </td>
                  </tr>
                ) : (
                  filteredPods.map((p) => (
                    <tr
                      key={`${p.namespace}/${p.name}`}
                      className="hover:bg-cyber-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{p.name}</div>
                        <div className="text-[10px] text-cyan-400">ns: {p.namespace}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyber-950 border border-cyber-800 text-slate-300">
                          {getWorkloadKindIcon(p.workloadKind)}
                          <span>{p.workloadName}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
                            p.phase === 'Running'
                              ? p.ready
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                              : 'bg-rose-500/15 text-rose-300 border border-rose-500/20'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              p.ready ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          {p.phase}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {p.containers.filter((c) => c.ready).length}/{p.containers.length}
                      </td>
                      <td className="py-3 px-4">
                        {p.restarts > 0 ? (
                          <span className="text-amber-400 font-bold">{p.restarts}</span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-cyan-300">{p.cpuUsage}</div>
                        <div className="w-16 bg-cyber-950 rounded-full h-1 mt-1 overflow-hidden border border-cyber-800">
                          <div
                            className="bg-cyan-400 h-full"
                            style={{
                              width: `${Math.min(100, (p.cpuMillis / 500) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-purple-300">{p.memoryUsage}</div>
                        <div className="w-16 bg-cyber-950 rounded-full h-1 mt-1 overflow-hidden border border-cyber-800">
                          <div
                            className="bg-purple-400 h-full"
                            style={{
                              width: `${Math.min(100, (p.memoryBytes / (512 * 1024 * 1024)) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {p.nodeName || 'kind-control-plane'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setSelectedPod(p)}
                          className="px-3 py-1 bg-cyber-800 hover:bg-cyber-750 text-slate-200 rounded-xl text-xs border border-cyber-700 transition-all"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pod Deep-Dive Inspector Modal */}
      {selectedPod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyan-500/40 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-start mb-4 border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">{selectedPod.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    Namespace: <span className="text-cyan-400">{selectedPod.namespace}</span> •
                    Workload: <span className="text-slate-200">{selectedPod.workloadName}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPod(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
              {/* Telemetry Highlights */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 uppercase">CPU Usage</span>
                  <p className="font-bold text-cyan-400 text-sm mt-0.5">{selectedPod.cpuUsage}</p>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 uppercase">Memory RSS</span>
                  <p className="font-bold text-purple-400 text-sm mt-0.5">{selectedPod.memoryUsage}</p>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 uppercase">Phase</span>
                  <p className="font-bold text-emerald-400 text-sm mt-0.5">{selectedPod.phase}</p>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 uppercase">Restarts</span>
                  <p className="font-bold text-amber-400 text-sm mt-0.5">{selectedPod.restarts}</p>
                </div>
              </div>

              {/* Containers Table */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                  Container Performance & Quotas
                </h4>
                <div className="bg-cyber-950 rounded-2xl border border-cyber-800 overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-cyber-800/80 text-slate-400">
                        <th className="py-2.5 px-3">Container</th>
                        <th className="py-2.5 px-3">CPU Usage</th>
                        <th className="py-2.5 px-3">RAM Usage</th>
                        <th className="py-2.5 px-3">Limits</th>
                        <th className="py-2.5 px-3">Restarts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyber-800/40">
                      {selectedPod.containers.map((c) => (
                        <tr key={c.name} className="hover:bg-cyber-900/40">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-white">{c.name}</div>
                            <div className="text-[9px] text-slate-500 truncate max-w-[150px]">
                              {c.image}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-cyan-300 font-bold">{c.cpuUsage}</td>
                          <td className="py-2.5 px-3 text-purple-300 font-bold">{c.memoryUsage}</td>
                          <td className="py-2.5 px-3 text-[10px] text-slate-400">
                            <div>cpu: {c.cpuLimit || 'unlimited'}</div>
                            <div>mem: {c.memoryLimit || 'unlimited'}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{c.restartCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pod Metadata and Labels */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                  Labels & Metadata
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(selectedPod.labels || {}).map(([k, v]) => (
                    <span
                      key={k}
                      className="px-2 py-0.5 bg-cyber-950 text-slate-300 border border-cyber-800 rounded-md text-[10px] font-mono"
                    >
                      <span className="text-slate-500">{k}:</span> {v}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-5 pt-3 border-t border-cyber-800 flex justify-end">
              <button
                onClick={() => setSelectedPod(null)}
                className="px-4 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-200 text-xs font-medium rounded-xl border border-cyber-700 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
