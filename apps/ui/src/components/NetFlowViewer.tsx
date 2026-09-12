import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Activity,
  Network,
  Radio,
  Server,
  Globe,
  Database,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Filter,
  Pause,
  Play,
  RefreshCw,
  Sliders,
  Eye,
  Zap,
  Clock,
  ArrowRight,
  ArrowUpRight,
  Layers,
  Box,
  Maximize2,
  Minimize2,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  X,
  Sparkles,
  Cpu,
  Wifi,
  WifiOff,
  Gauge,
  RotateCcw,
} from 'lucide-react';
import type {
  NetflowClusterData,
  NetflowEndpoint,
  NetflowEdge,
  NetflowEvent,
  NetflowProbeResult,
  EndpointHealthStatus,
  NetflowVerdict,
  NetflowProtocol,
  ServiceTier,
} from '../lib/netflow-types';
import type { VirtualCluster } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  cluster: VirtualCluster;
}

type ViewTab = 'topology' | 'endpoints' | 'flows' | 'matrix';

interface NodePosition {
  x: number;
  y: number;
  tier: ServiceTier;
}

export const NetFlowViewer: React.FC<Props> = ({ cluster }) => {
  // Main Data States
  const [data, setData] = useState<NetflowClusterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live Stream Control
  const [isStreaming, setIsStreaming] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewTab>('topology');

  // Filter States (Multi-dimensional filters)
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [selectedApplication, setSelectedApplication] = useState<string>('all');
  const [selectedVerdict, setSelectedVerdict] = useState<'all' | 'FORWARDED' | 'DROPPED' | 'ERROR'>('all');
  const [selectedProtocol, setSelectedProtocol] = useState<'all' | NetflowProtocol>('all');
  const [selectedHealth, setSelectedHealth] = useState<'all' | EndpointHealthStatus>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Node / Edge Inspector States
  const [selectedEndpoint, setSelectedEndpoint] = useState<NetflowEndpoint | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<NetflowEdge | null>(null);
  const [inspectedFlow, setInspectedFlow] = useState<NetflowEvent | null>(null);

  // Probe Running State
  const [probingEndpointId, setProbingEndpointId] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<NetflowProbeResult | null>(null);

  // Graph Layout & Drag States
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [showParticleAnimations, setShowParticleAnimations] = useState(true);

  const graphSvgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch Live NetFlow Telemetry
  const fetchNetflowData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/netflow`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Failed to retrieve NetFlow data');
      }
    } catch (err: any) {
      setError(err.message || 'Connection error querying NetFlow API');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cluster.name]);

  // Initial Load & Streaming Interval
  useEffect(() => {
    fetchNetflowData();
  }, [fetchNetflowData]);

  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      fetchNetflowData();
    }, 2800);
    return () => clearInterval(interval);
  }, [isStreaming, fetchNetflowData]);

  // Calculate default Tier-based Grid Positions for Nodes
  useEffect(() => {
    if (!data || !data.endpoints) return;

    // Check if we already have positions
    if (Object.keys(nodePositions).length > 0) return;

    const width = 960;
    const height = 540;

    // Categorize by tier
    const tiers: Record<ServiceTier, NetflowEndpoint[]> = {
      external: [],
      ingress: [],
      service: [],
      backend: [],
      system: [],
    };

    data.endpoints.forEach((ep) => {
      tiers[ep.tier]?.push(ep);
    });

    const tierOrder: ServiceTier[] = ['external', 'ingress', 'service', 'backend', 'system'];
    const positions: Record<string, { x: number; y: number }> = {};

    const colWidth = width / (tierOrder.length + 0.5);

    tierOrder.forEach((tier, colIndex) => {
      const nodes = tiers[tier] || [];
      const x = 70 + colIndex * colWidth;
      const count = nodes.length;

      nodes.forEach((node, rowIndex) => {
        const rowHeight = height / (count + 1);
        const y = (rowIndex + 1) * rowHeight;
        positions[node.id] = { x, y };
      });
    });

    setNodePositions(positions);
  }, [data]);

  // Filtered Endpoints
  const filteredEndpoints = useMemo(() => {
    if (!data?.endpoints) return [];
    return data.endpoints.filter((ep) => {
      if (selectedNamespace !== 'all' && ep.namespace !== selectedNamespace) return false;
      if (selectedApplication !== 'all' && ep.name !== selectedApplication) return false;
      if (selectedHealth !== 'all' && ep.healthStatus !== selectedHealth) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = ep.name.toLowerCase().includes(q);
        const matchesNs = ep.namespace.toLowerCase().includes(q);
        const matchesIp = ep.clusterIP.toLowerCase().includes(q);
        const matchesPort = ep.ports.some((p) => String(p.port).includes(q));
        if (!matchesName && !matchesNs && !matchesIp && !matchesPort) return false;
      }
      return true;
    });
  }, [data?.endpoints, selectedNamespace, selectedApplication, selectedHealth, searchQuery]);

  const filteredEndpointIds = useMemo(() => {
    return new Set(filteredEndpoints.map((e) => e.id));
  }, [filteredEndpoints]);

  // Filtered Edges
  const filteredEdges = useMemo(() => {
    if (!data?.edges) return [];
    return data.edges.filter((edge) => {
      const srcIncluded = filteredEndpointIds.has(edge.sourceId);
      const tgtIncluded = filteredEndpointIds.has(edge.targetId);
      if (!srcIncluded || !tgtIncluded) return false;

      if (selectedProtocol !== 'all' && edge.protocol !== selectedProtocol) return false;
      if (selectedVerdict === 'DROPPED' && edge.verdicts.dropped === 0) return false;
      if (selectedVerdict === 'ERROR' && edge.verdicts.error === 0) return false;
      return true;
    });
  }, [data?.edges, filteredEndpointIds, selectedProtocol, selectedVerdict]);

  // Filtered Live Flows (Event Log)
  const filteredFlows = useMemo(() => {
    if (!data?.recentFlows) return [];
    return data.recentFlows.filter((flow) => {
      if (selectedNamespace !== 'all') {
        const matchesSrc = flow.source.namespace === selectedNamespace;
        const matchesDst = flow.destination.namespace === selectedNamespace;
        if (!matchesSrc && !matchesDst) return false;
      }
      if (selectedApplication !== 'all') {
        const matchesSrc = flow.source.name === selectedApplication;
        const matchesDst = flow.destination.name === selectedApplication;
        if (!matchesSrc && !matchesDst) return false;
      }
      if (selectedVerdict !== 'all' && flow.verdict !== selectedVerdict) return false;
      if (selectedProtocol !== 'all' && flow.protocol !== selectedProtocol) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSrc = flow.source.name.toLowerCase().includes(q) || flow.source.ip.includes(q);
        const matchesDst = flow.destination.name.toLowerCase().includes(q) || flow.destination.ip.includes(q);
        const matchesPath = flow.l7Info?.path?.toLowerCase().includes(q);
        const matchesDomain = flow.l7Info?.domain?.toLowerCase().includes(q);
        if (!matchesSrc && !matchesDst && !matchesPath && !matchesDomain) return false;
      }
      return true;
    });
  }, [data?.recentFlows, selectedNamespace, selectedApplication, selectedVerdict, selectedProtocol, searchQuery]);

  // Run Active Live Endpoint Probe
  const handleRunProbe = async (endpoint: NetflowEndpoint) => {
    setProbingEndpointId(endpoint.id);
    setProbeResult(null);

    const targetPort = endpoint.ports[0]?.port || 80;
    const protocol = endpoint.ports[0]?.name?.includes('https') ? 'HTTPS' : 'TCP';

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/netflow/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointId: endpoint.id,
          targetIp: endpoint.backingPods[0]?.ip || endpoint.clusterIP,
          port: targetPort,
          protocol,
        }),
      });
      const json = await res.json();
      if (json.success && json.probe) {
        setProbeResult(json.probe);
        // Refresh local endpoint probe status
        if (data) {
          const updatedEndpoints = data.endpoints.map((e) =>
            e.id === endpoint.id
              ? {
                  ...e,
                  lastProbeStatus: {
                    reachable: json.probe.reachable,
                    latencyMs: json.probe.latencyMs,
                    statusCode: json.probe.statusCode,
                    message: json.probe.details,
                  },
                }
              : e
          );
          setData({ ...data, endpoints: updatedEndpoints });
        }
      }
    } catch (err: any) {
      console.error('Probe failed:', err);
    } finally {
      setProbingEndpointId(null);
    }
  };

  // Drag handlers for topology nodes
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const current = nodePositions[nodeId] || { x: 100, y: 100 };
    setDraggedNodeId(nodeId);
    setDragOffset({
      x: e.clientX - current.x,
      y: e.clientY - current.y,
    });
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (!draggedNodeId) return;
    const rect = graphSvgRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.max(40, Math.min(940, e.clientX - rect.left));
    const y = Math.max(40, Math.min(500, e.clientY - rect.top));

    setNodePositions((prev) => ({
      ...prev,
      [draggedNodeId]: { x, y },
    }));
  };

  const handleSvgMouseUp = () => {
    setDraggedNodeId(null);
  };

  // Reset Node Positions to default grid
  const handleResetPositions = () => {
    setNodePositions({});
  };

  // Helper icons for service tiers
  const getTierIcon = (tier: ServiceTier) => {
    switch (tier) {
      case 'ingress':
        return Globe;
      case 'backend':
        return Database;
      case 'system':
        return Network;
      case 'external':
        return Radio;
      default:
        return Server;
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4 font-mono">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
          <Network className="w-6 h-6 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
        </div>
        <p className="text-sm text-cyan-300 font-semibold tracking-wide">Initializing NetFlow Observability Engine...</p>
        <p className="text-xs text-slate-500">Mapping Cilium eBPF endpoint topologies and active sockets</p>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6 font-mono select-none">
      {/* 2026 Sleek Top Telemetry Ribbon */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Health Pulse */}
          <div className="bg-cyber-900/80 border border-cyber-700/80 rounded-2xl p-3.5 backdrop-blur-md relative overflow-hidden group hover:border-cyan-500/40 transition-all">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
              <span>Cluster Network</span>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-white tracking-tight">{summary.overallHealthPercent}%</span>
              <span className="text-[11px] text-emerald-400 font-semibold">UP</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1 truncate">
              {summary.healthyEndpoints}/{summary.totalEndpoints} Endpoints Ready
            </p>
          </div>

          {/* Endpoints Availability */}
          <div className="bg-cyber-900/80 border border-cyber-700/80 rounded-2xl p-3.5 backdrop-blur-md relative overflow-hidden group hover:border-cyan-500/40 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
              <span>Endpoints Active</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-emerald-300">{summary.healthyEndpoints}</span>
              <span className="text-xs text-slate-400">/ {summary.totalEndpoints}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              {summary.degradedEndpoints > 0 ? `${summary.degradedEndpoints} Degraded` : '0 Degraded • 0 Down'}
            </p>
          </div>

          {/* Active Flow Rate */}
          <div className="bg-cyber-900/80 border border-cyber-700/80 rounded-2xl p-3.5 backdrop-blur-md relative overflow-hidden group hover:border-cyan-500/40 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
              <span>NetFlow Rate</span>
              <Zap className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-cyan-300">{summary.flowRatePerSec.toLocaleString()}</span>
              <span className="text-[10px] text-slate-400">flows/s</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">{summary.totalActiveFlows} Concurrent Sockets</p>
          </div>

          {/* Flow Verdict Spectrum */}
          <div className="bg-cyber-900/80 border border-cyber-700/80 rounded-2xl p-3.5 backdrop-blur-md relative overflow-hidden group hover:border-cyan-500/40 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
              <span>Traffic Verdict</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-white">{summary.forwardedPercent}%</span>
              <span className="text-[10px] text-emerald-400 font-semibold">PASS</span>
            </div>
            {/* Visual ratio bar */}
            <div className="w-full bg-cyber-950 rounded-full h-1.5 mt-2 flex overflow-hidden">
              <div className="bg-emerald-500 h-full" style={{ width: `${summary.forwardedPercent}%` }} />
              <div className="bg-rose-500 h-full" style={{ width: `${summary.droppedPercent}%` }} />
            </div>
          </div>

          {/* Average Latency */}
          <div className="bg-cyber-900/80 border border-cyber-700/80 rounded-2xl p-3.5 backdrop-blur-md relative overflow-hidden group hover:border-cyan-500/40 transition-all">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1.5">
              <span>Avg Latency (RTT)</span>
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-cyan-300">{summary.avgLatencyMs}</span>
              <span className="text-[10px] text-slate-400">ms</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">P95: {summary.p95LatencyMs}ms</p>
          </div>

          {/* Live Controls */}
          <div className="bg-cyber-900/80 border border-cyber-700/80 rounded-2xl p-3.5 backdrop-blur-md flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span>Stream Status</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isStreaming ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                {isStreaming ? 'LIVE' : 'PAUSED'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <button
                onClick={() => setIsStreaming(!isStreaming)}
                className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
                  isStreaming
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                    : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                }`}
                title={isStreaming ? 'Pause streaming' : 'Resume live stream'}
              >
                {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isStreaming ? 'Pause' : 'Stream'}</span>
              </button>
              <button
                onClick={() => fetchNetflowData(true)}
                disabled={refreshing}
                className="p-1.5 rounded-xl bg-cyber-800 hover:bg-cyber-700 text-slate-300 hover:text-white border border-cyber-700 transition-all disabled:opacity-50"
                title="Refresh NetFlow Telemetry"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Primary Navigation & Filter Bar */}
      <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-4 shadow-xl space-y-4">
        {/* Top Tab Bar & Quick Search */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border-b border-cyber-800 pb-3.5">
          {/* Views Toggles */}
          <div className="flex items-center gap-1 bg-cyber-950/80 p-1 rounded-xl border border-cyber-800/80 text-xs">
            <button
              onClick={() => setActiveTab('topology')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'topology'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Topology Visualizer</span>
            </button>
            <button
              onClick={() => setActiveTab('endpoints')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'endpoints'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Endpoints & Probes</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-cyber-900 border border-cyber-700 text-cyan-300">
                {filteredEndpoints.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('flows')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
                activeTab === 'flows'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Live Flow Stream</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-cyber-900 border border-cyber-700 text-emerald-300">
                {filteredFlows.length}
              </span>
            </button>
          </div>

          {/* Quick Search */}
          <div className="relative w-full md:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search service, IP, port, path..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-cyber-950 border border-cyber-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Multi-Dimensional Filters */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Namespace Filter */}
          <div className="flex items-center gap-1.5 bg-cyber-950 px-2.5 py-1.5 rounded-xl border border-cyber-800">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider">Namespace:</span>
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              className="bg-transparent text-cyan-300 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-cyber-950 text-white">All Namespaces</option>
              {summary?.namespaces.map((ns) => (
                <option key={ns} value={ns} className="bg-cyber-950 text-white">
                  {ns}
                </option>
              ))}
            </select>
          </div>

          {/* Application / Workload Filter */}
          <div className="flex items-center gap-1.5 bg-cyber-950 px-2.5 py-1.5 rounded-xl border border-cyber-800">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider">App:</span>
            <select
              value={selectedApplication}
              onChange={(e) => setSelectedApplication(e.target.value)}
              className="bg-transparent text-cyan-300 text-xs focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-cyber-950 text-white">All Workloads</option>
              {summary?.applications.map((app) => (
                <option key={app} value={app} className="bg-cyber-950 text-white">
                  {app}
                </option>
              ))}
            </select>
          </div>

          {/* Verdict Filter */}
          <div className="flex items-center gap-1 bg-cyber-950 px-1.5 py-1 rounded-xl border border-cyber-800">
            <span className="text-[11px] text-slate-500 px-1 uppercase tracking-wider">Verdict:</span>
            {(['all', 'FORWARDED', 'DROPPED', 'ERROR'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setSelectedVerdict(v)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                  selectedVerdict === v
                    ? v === 'DROPPED'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : v === 'ERROR'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {v === 'all' ? 'All' : v}
              </button>
            ))}
          </div>

          {/* Protocol Filter */}
          <div className="flex items-center gap-1 bg-cyber-950 px-1.5 py-1 rounded-xl border border-cyber-800">
            <span className="text-[11px] text-slate-500 px-1 uppercase tracking-wider">Proto:</span>
            {(['all', 'HTTP', 'TCP', 'UDP', 'DNS'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setSelectedProtocol(p as any)}
                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all ${
                  selectedProtocol === p
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Endpoint Health Filter */}
          <div className="flex items-center gap-1 bg-cyber-950 px-1.5 py-1 rounded-xl border border-cyber-800">
            <span className="text-[11px] text-slate-500 px-1 uppercase tracking-wider">Status:</span>
            {(['all', 'healthy', 'degraded', 'unhealthy'] as const).map((h) => (
              <button
                key={h}
                onClick={() => setSelectedHealth(h)}
                className={`px-2 py-0.5 rounded-lg text-[11px] capitalize transition-all ${
                  selectedHealth === h
                    ? h === 'healthy'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : h === 'degraded'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {h}
              </button>
            ))}
          </div>

          {/* Reset Filters button */}
          {(selectedNamespace !== 'all' ||
            selectedApplication !== 'all' ||
            selectedVerdict !== 'all' ||
            selectedProtocol !== 'all' ||
            selectedHealth !== 'all' ||
            searchQuery) && (
            <button
              onClick={() => {
                setSelectedNamespace('all');
                setSelectedApplication('all');
                setSelectedVerdict('all');
                setSelectedProtocol('all');
                setSelectedHealth('all');
                setSearchQuery('');
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-slate-400 hover:text-rose-300 text-xs transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* VIEW 1: Interactive NetFlow Topology Graph */}
      {activeTab === 'topology' && (
        <div className="relative bg-[#070b12] border border-cyber-700/80 rounded-3xl overflow-hidden shadow-2xl">
          {/* Subtle Cybernetic Grid Pattern */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage: 'radial-gradient(#06b6d4 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />

          {/* Floating Controls Bar */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-cyber-950/90 border border-cyber-800/90 p-1.5 rounded-2xl backdrop-blur-md shadow-xl text-xs">
            <span className="text-[11px] text-slate-400 px-2 font-semibold">NetFlow Service Map</span>
            <div className="h-4 w-px bg-cyber-800" />
            <button
              onClick={() => setShowParticleAnimations(!showParticleAnimations)}
              className={`px-2 py-1 rounded-xl text-[11px] font-semibold flex items-center gap-1 transition-all ${
                showParticleAnimations ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-white'
              }`}
              title="Toggle packet particle animations"
            >
              <Zap className="w-3 h-3" />
              <span>{showParticleAnimations ? 'Flows Active' : 'Flows Static'}</span>
            </button>
            <button
              onClick={handleResetPositions}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-cyber-800 transition-colors"
              title="Auto-arrange layout"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Graph Legend */}
          <div className="absolute top-4 right-4 z-20 hidden sm:flex items-center gap-3 bg-cyber-950/90 border border-cyber-800/90 px-3 py-1.5 rounded-2xl backdrop-blur-md text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span>Forwarded</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
              <span>Dropped / Policy</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
              <span>Active Sockets</span>
            </div>
          </div>

          {/* Interactive SVG Flow Canvas */}
          <svg
            ref={graphSvgRef}
            viewBox="0 0 960 540"
            className="w-full h-[540px] select-none cursor-crosshair"
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
          >
            <defs>
              {/* Glow Filter for Active Paths */}
              <filter id="glow-emerald" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-rose" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Architectural Tier Columns Guide */}
            <g className="opacity-15 pointer-events-none">
              <line x1="180" y1="20" x2="180" y2="520" stroke="#06b6d4" strokeDasharray="4 4" />
              <line x1="380" y1="20" x2="380" y2="520" stroke="#06b6d4" strokeDasharray="4 4" />
              <line x1="580" y1="20" x2="580" y2="520" stroke="#06b6d4" strokeDasharray="4 4" />
              <line x1="780" y1="20" x2="780" y2="520" stroke="#06b6d4" strokeDasharray="4 4" />
            </g>

            {/* Flow Edges (Cubic Bezier curves) */}
            {filteredEdges.map((edge) => {
              const srcPos = nodePositions[edge.sourceId];
              const tgtPos = nodePositions[edge.targetId];
              if (!srcPos || !tgtPos) return null;

              const isSelected = selectedEdge?.id === edge.id;
              const isDrop = edge.verdicts.dropped > 0 && edge.verdicts.forwarded === 0;

              // Cubic bezier control points
              const dx = tgtPos.x - srcPos.x;
              const cpx1 = srcPos.x + dx * 0.45;
              const cpy1 = srcPos.y;
              const cpx2 = srcPos.x + dx * 0.55;
              const cpy2 = tgtPos.y;

              const pathData = `M ${srcPos.x} ${srcPos.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${tgtPos.x} ${tgtPos.y}`;

              const strokeColor = isDrop ? '#f43f5e' : isSelected ? '#06b6d4' : '#10b981';

              return (
                <g key={edge.id} className="cursor-pointer group" onClick={() => setSelectedEdge(edge)}>
                  {/* Outer glow line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 5 : 2.5}
                    strokeOpacity={isSelected ? 0.9 : 0.45}
                    strokeDasharray={isDrop ? '6 4' : undefined}
                  />

                  {/* Flow Label pill at curve midpoint */}
                  <g
                    transform={`translate(${(srcPos.x + tgtPos.x) / 2}, ${(srcPos.y + tgtPos.y) / 2})`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <rect
                      x="-45"
                      y="-11"
                      width="90"
                      height="22"
                      rx="6"
                      fill="#0b1320"
                      stroke={strokeColor}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      {edge.protocol}:{edge.port} ({edge.activeFlows}f)
                    </text>
                  </g>

                  {/* Animated Particle Packets flowing along path */}
                  {showParticleAnimations && (
                    <circle r={isDrop ? 3 : 2.5} fill={isDrop ? '#f43f5e' : '#34d399'}>
                      <animateMotion
                        path={pathData}
                        dur={isDrop ? '3.5s' : `${Math.max(1.2, 2.5 - edge.activeFlows / 250)}s`}
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                </g>
              );
            })}

            {/* Service & Endpoint Nodes */}
            {filteredEndpoints.map((endpoint) => {
              const pos = nodePositions[endpoint.id];
              if (!pos) return null;

              const isSelected = selectedEndpoint?.id === endpoint.id;
              const isHealthy = endpoint.healthStatus === 'healthy';
              const isDegraded = endpoint.healthStatus === 'degraded';

              const ringColor = isHealthy ? '#10b981' : isDegraded ? '#f59e0b' : '#f43f5e';
              const TierIcon = getTierIcon(endpoint.tier);

              return (
                <g
                  key={endpoint.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  className="cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => handleNodeMouseDown(e, endpoint.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedEndpoint(endpoint);
                  }}
                >
                  {/* Ambient Health Glow Aura */}
                  <circle
                    r={isSelected ? 34 : 26}
                    fill={ringColor}
                    opacity={isSelected ? 0.35 : 0.15}
                    className={isHealthy ? 'animate-pulse' : ''}
                  />

                  {/* Outer Halo Ring */}
                  <circle
                    r={26}
                    fill="#080e1a"
                    stroke={ringColor}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeDasharray={isDegraded ? '4 2' : undefined}
                  />

                  {/* Node Icon Graphic */}
                  <circle r={18} fill="#0d1829" />
                  <foreignObject x="-10" y="-10" width="20" height="20" className="pointer-events-none">
                    <TierIcon className="w-5 h-5 text-cyan-300" />
                  </foreignObject>

                  {/* Ready Pods Mini Pill Badge */}
                  <g transform="translate(14, -14)">
                    <circle r="7" fill={ringColor} />
                    <text
                      x="0"
                      y="2.5"
                      textAnchor="middle"
                      fill="#040810"
                      fontSize="7"
                      fontWeight="black"
                      fontFamily="monospace"
                    >
                      {endpoint.readyCount}
                    </text>
                  </g>

                  {/* Node Label Below */}
                  <g transform="translate(0, 36)">
                    <rect
                      x="-60"
                      y="-7"
                      width="120"
                      height="26"
                      rx="6"
                      fill="#060c17"
                      stroke={isSelected ? '#06b6d4' : '#1e293b'}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="10"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {endpoint.name.length > 14 ? `${endpoint.name.slice(0, 13)}…` : endpoint.name}
                    </text>
                    <text
                      x="0"
                      y="14"
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      {endpoint.namespace} • {endpoint.ports[0]?.port || '80'}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* Bottom helper tip */}
          <div className="absolute bottom-3 left-4 text-[11px] text-slate-500 font-mono flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Click any node to inspect endpoint health & trigger reachability probes. Drag nodes to customize topology.</span>
          </div>
        </div>
      )}

      {/* VIEW 2: Endpoints & Health Probe Matrix */}
      {activeTab === 'endpoints' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" />
                <span>Cluster Network Endpoints & Probes</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time reachability, backing pod instances, port mappings, and active probe diagnostics
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-400 bg-cyan-950 px-2.5 py-1 rounded-xl border border-cyan-800">
              {filteredEndpoints.length} Monitored Endpoints
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEndpoints.map((ep) => {
              const isHealthy = ep.healthStatus === 'healthy';
              const isDegraded = ep.healthStatus === 'degraded';
              const isProbing = probingEndpointId === ep.id;

              return (
                <div
                  key={ep.id}
                  className="bg-cyber-900/90 border border-cyber-700/80 hover:border-cyan-500/50 rounded-2xl p-4 transition-all duration-200 shadow-lg flex flex-col justify-between group"
                >
                  <div>
                    {/* Top Row: Service Name & Health Pill */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white truncate">{ep.name}</h4>
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-cyber-950 border border-cyber-800 text-slate-400">
                            {ep.type}
                          </span>
                        </div>
                        <p className="text-xs text-cyan-400 truncate mt-0.5">{ep.namespace}</p>
                      </div>

                      <div
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 ${
                          isHealthy
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : isDegraded
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isHealthy ? 'bg-emerald-400 animate-ping' : isDegraded ? 'bg-amber-400' : 'bg-rose-400'
                          }`}
                        />
                        <span className="uppercase">{ep.healthStatus}</span>
                      </div>
                    </div>

                    {/* Network Details & Cluster IP */}
                    <div className="mt-3 bg-cyber-950/80 p-2.5 rounded-xl border border-cyber-800 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Cluster IP:</span>
                        <span className="text-slate-200 font-mono">{ep.clusterIP}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Port(s):</span>
                        <span className="text-cyan-300 font-mono">
                          {ep.ports.map((p) => `${p.port}/${p.protocol}`).join(', ') || 'None'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Backing Pods:</span>
                        <span className="text-emerald-400 font-bold font-mono">
                          {ep.readyCount} / {ep.totalCount} Ready
                        </span>
                      </div>
                    </div>

                    {/* Backing Pod List Mini Table */}
                    {ep.backingPods.length > 0 && (
                      <div className="mt-2.5 space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                          Target Endpoints ({ep.backingPods.length}):
                        </span>
                        {ep.backingPods.slice(0, 3).map((pod) => (
                          <div
                            key={pod.ip}
                            className="flex items-center justify-between text-[11px] bg-cyber-950/50 px-2 py-1 rounded-lg border border-cyber-800/60"
                          >
                            <span className="text-slate-300 truncate max-w-[150px]">{pod.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-400 font-mono">{pod.ip}</span>
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  pod.ready ? 'bg-emerald-400' : 'bg-rose-500'
                                }`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Last Probe Status Alert */}
                    {ep.lastProbeStatus && (
                      <div
                        className={`mt-2.5 p-2 rounded-xl text-[11px] flex items-center justify-between ${
                          ep.lastProbeStatus.reachable
                            ? 'bg-emerald-950/40 border border-emerald-800/50 text-emerald-300'
                            : 'bg-rose-950/40 border border-rose-800/50 text-rose-300'
                        }`}
                      >
                        <span className="truncate">{ep.lastProbeStatus.message}</span>
                        <span className="font-bold shrink-0">{ep.lastProbeStatus.latencyMs}ms</span>
                      </div>
                    )}
                  </div>

                  {/* Actions Row: Live Probe & Inspect */}
                  <div className="mt-4 pt-3 border-t border-cyber-800/80 flex items-center gap-2">
                    <button
                      onClick={() => handleRunProbe(ep)}
                      disabled={isProbing}
                      className="flex-1 py-1.5 px-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {isProbing ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                      <span>{isProbing ? 'Probing...' : 'Test Probe'}</span>
                    </button>
                    <button
                      onClick={() => setSelectedEndpoint(ep)}
                      className="py-1.5 px-3 rounded-xl bg-cyber-800 hover:bg-cyber-700 text-slate-300 hover:text-white border border-cyber-700 text-xs transition-all"
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: Live NetFlow Event Stream */}
      {activeTab === 'flows' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>eBPF Live NetFlow Stream</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time Layer 3/4 & Layer 7 flow logs, verdicts, latency profiling, and network security policies
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">Stream Buffer:</span>
              <span className="text-emerald-300 font-bold bg-cyber-950 px-2 py-0.5 rounded-md border border-cyber-800">
                {filteredFlows.length} Events
              </span>
            </div>
          </div>

          <div className="border border-cyber-700/80 rounded-2xl bg-cyber-900/90 overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-cyber-800 bg-cyber-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Destination</th>
                    <th className="py-3 px-4">Protocol</th>
                    <th className="py-3 px-4">Verdict</th>
                    <th className="py-3 px-4">L7 Details</th>
                    <th className="py-3 px-4 text-right">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyber-800/60 font-mono">
                  {filteredFlows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        No NetFlow records match the active filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredFlows.map((flow) => {
                      const isDrop = flow.verdict === 'DROPPED';
                      const isError = flow.verdict === 'ERROR';

                      return (
                        <tr
                          key={flow.id}
                          className="hover:bg-cyber-800/50 transition-colors cursor-pointer"
                          onClick={() => setInspectedFlow(flow)}
                        >
                          <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                            {new Date(flow.timestamp).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="text-cyan-400 font-semibold">{flow.source.name}</span>
                              <span className="text-[10px] text-slate-500">({flow.source.namespace})</span>
                            </div>
                            <div className="text-[10px] text-slate-500">{flow.source.ip}</div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="text-white font-semibold">{flow.destination.name}</span>
                              <span className="text-[10px] text-slate-500">({flow.destination.namespace})</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {flow.destination.ip}:{flow.destination.port}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyber-950 border border-cyber-800 text-slate-300">
                              {flow.protocol}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                                isDrop
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : isError
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isDrop ? 'bg-rose-400' : isError ? 'bg-amber-400' : 'bg-emerald-400'
                                }`}
                              />
                              <span>{flow.verdict}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-300 text-[11px] max-w-xs truncate">
                            {flow.l7Info?.type === 'http' ? (
                              <span>
                                <strong className="text-cyan-400">{flow.l7Info.method}</strong> {flow.l7Info.path}{' '}
                                <span className={isDrop ? 'text-rose-400' : isError ? 'text-amber-400' : 'text-emerald-400'}>
                                  [{flow.l7Info.status}]
                                </span>
                              </span>
                            ) : flow.l7Info?.type === 'dns' ? (
                              <span>
                                <strong className="text-purple-400">DNS {flow.l7Info.queryType}</strong> {flow.l7Info.domain}
                              </span>
                            ) : (
                              <span className="text-slate-500">TCP Handshake ESTABLISHED</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap font-mono text-[11px]">
                            <span
                              className={
                                flow.latencyMs > 20
                                  ? 'text-rose-400'
                                  : flow.latencyMs > 5
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              }
                            >
                              {flow.latencyMs}ms
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Endpoint Health Inspector & Live Reachability Probe Drawer */}
      {selectedEndpoint && (
        <ModalPortal>
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className="bg-[#090f1a] border border-cyber-700 w-full max-w-2xl rounded-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200 font-mono">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">{selectedEndpoint.name}</h3>
                    <span className="px-2 py-0.5 rounded text-xs bg-cyber-900 border border-cyber-700 text-cyan-300">
                      {selectedEndpoint.type}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        selectedEndpoint.healthStatus === 'healthy'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : selectedEndpoint.healthStatus === 'degraded'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      }`}
                    >
                      {selectedEndpoint.healthStatus.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Namespace: {selectedEndpoint.namespace}</p>
                </div>
                <button
                  onClick={() => setSelectedEndpoint(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-cyber-900 hover:bg-cyber-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Endpoint Overview Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 block">Cluster IP</span>
                  <span className="font-bold text-white mt-0.5 block truncate">{selectedEndpoint.clusterIP}</span>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 block">Ready Endpoints</span>
                  <span className="font-bold text-emerald-400 mt-0.5 block">
                    {selectedEndpoint.readyCount} / {selectedEndpoint.totalCount}
                  </span>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 block">Avg RTT Latency</span>
                  <span className="font-bold text-cyan-300 mt-0.5 block">{selectedEndpoint.avgLatencyMs}ms</span>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 block">Availability</span>
                  <span className="font-bold text-emerald-300 mt-0.5 block">{selectedEndpoint.uptimePercent}%</span>
                </div>
              </div>

              {/* Live Probe Section */}
              <div className="bg-cyber-950/90 border border-cyber-800 p-4 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-cyan-400" />
                    <span>Active Endpoint Reachability Probe</span>
                  </span>
                  <button
                    onClick={() => handleRunProbe(selectedEndpoint)}
                    disabled={probingEndpointId === selectedEndpoint.id}
                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)] disabled:opacity-50"
                  >
                    {probingEndpointId === selectedEndpoint.id ? 'Running Probe...' : 'Run Probe Now'}
                  </button>
                </div>

                {probeResult ? (
                  <div
                    className={`p-3 rounded-xl text-xs space-y-1 ${
                      probeResult.reachable
                        ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-200'
                        : 'bg-rose-950/40 border border-rose-800/60 text-rose-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>Status: {probeResult.reachable ? 'REACHABLE (Healthy)' : 'UNREACHABLE'}</span>
                      <span>RTT: {probeResult.latencyMs}ms</span>
                    </div>
                    <p className="text-[11px] opacity-80">{probeResult.details}</p>
                    <p className="text-[10px] opacity-60">Target: {probeResult.targetEndpoint}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Click 'Run Probe Now' to perform a real-time TCP/HTTP handshake test against this endpoint.
                  </p>
                )}
              </div>

              {/* Backing Pod Instances List */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-white block">Backing Pod Endpoints ({selectedEndpoint.backingPods.length})</span>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {selectedEndpoint.backingPods.map((pod) => (
                    <div
                      key={pod.ip}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-cyber-950 border border-cyber-800 text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white">{pod.name}</span>
                        <div className="text-[10px] text-slate-500">
                          IP: {pod.ip} • Node: {pod.nodeName || 'kind-control-plane'} • Restarts: {pod.restarts}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          pod.ready ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {pod.ready ? 'Ready' : 'Not Ready'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* MODAL 2: NetFlow Record Inspector */}
      {inspectedFlow && (
        <ModalPortal>
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className="bg-[#090f1a] border border-cyber-700 w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-200 font-mono text-xs">
              <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span className="font-bold text-white text-sm">Flow Telemetry Record</span>
                </div>
                <button onClick={() => setInspectedFlow(null)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Flow ID:</span>
                  <span className="text-slate-300 font-mono">{inspectedFlow.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Timestamp:</span>
                  <span className="text-slate-300">{new Date(inspectedFlow.timestamp).toISOString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Verdict:</span>
                  <span
                    className={`font-bold ${
                      inspectedFlow.verdict === 'DROPPED'
                        ? 'text-rose-400'
                        : inspectedFlow.verdict === 'ERROR'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {inspectedFlow.verdict}
                  </span>
                </div>
                {inspectedFlow.dropReason && (
                  <div className="flex justify-between text-rose-300">
                    <span>Drop Reason:</span>
                    <span className="max-w-xs text-right">{inspectedFlow.dropReason}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Source</span>
                  <span className="font-bold text-cyan-300 block mt-1">{inspectedFlow.source.name}</span>
                  <span className="text-[10px] text-slate-400 block">{inspectedFlow.source.ip}</span>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Destination</span>
                  <span className="font-bold text-white block mt-1">{inspectedFlow.destination.name}</span>
                  <span className="text-[10px] text-slate-400 block">
                    {inspectedFlow.destination.ip}:{inspectedFlow.destination.port}
                  </span>
                </div>
              </div>

              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Metrics</span>
                <div className="flex justify-between text-slate-300">
                  <span>Round Trip Latency:</span>
                  <span className="text-emerald-400 font-bold">{inspectedFlow.latencyMs}ms</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Packets / Bytes:</span>
                  <span>
                    {inspectedFlow.packets} pkts / {inspectedFlow.bytes} B
                  </span>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
