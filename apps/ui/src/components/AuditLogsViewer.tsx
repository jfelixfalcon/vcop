import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  Download,
  Clock,
  User,
  Layers,
  Terminal,
  Database,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  LogIn,
  LogOut,
  Sliders,
  Package,
  Activity,
  Globe,
  HardDrive,
} from 'lucide-react';
import type { AuditEvent, AuditCategory, AuditStatus, AuditLogStats } from '../lib/types';

interface AuditLogsViewerProps {
  currentUser?: {
    username: string;
    role: string;
    email?: string;
  } | null;
}

export function AuditLogsViewer({ currentUser }: AuditLogsViewerProps) {
  const [logs, setLogs] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AuditLogStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Filter States
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AuditCategory | 'ALL'>('ALL');
  const [status, setStatus] = useState<AuditStatus | 'ALL'>('ALL');
  const [timeRange, setTimeRange] = useState<'all' | '1h' | '24h' | '7d' | '30d'>('all');
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Details Modal State
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);

  // Compute date range based on timeRange selector
  const dateFilters = useMemo(() => {
    if (timeRange === 'all') return {};
    const now = new Date();
    let start: Date;
    if (timeRange === '1h') {
      start = new Date(now.getTime() - 60 * 60 * 1000);
    } else if (timeRange === '24h') {
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (timeRange === '7d') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    return { startDate: start.toISOString() };
  }, [timeRange]);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await fetch('/api/audit/stats');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setStats(json.data);
        }
      }
    } catch (err) {
      console.warn('Failed fetching audit stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (category !== 'ALL') params.set('category', category);
      if (status !== 'ALL') params.set('status', status);
      if (dateFilters.startDate) params.set('startDate', dateFilters.startDate);

      params.set('limit', String(limit));
      params.set('offset', String((page - 1) * limit));

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setLogs(json.data || []);
          setTotal(json.pagination?.total || 0);
        }
      }
    } catch (err) {
      console.warn('Failed fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [search, category, status, dateFilters, limit, page]);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs();
      fetchStats();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs, fetchStats]);

  const handleExport = (format: 'json' | 'csv') => {
    const params = new URLSearchParams();
    params.set('format', format);
    if (search.trim()) params.set('search', search.trim());
    if (category !== 'ALL') params.set('category', category);
    if (status !== 'ALL') params.set('status', status);
    if (dateFilters.startDate) params.set('startDate', dateFilters.startDate);
    window.open(`/api/audit/export?${params.toString()}`, '_blank');
  };

  const handleCopyPayload = (details: any) => {
    if (!details) return;
    navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  // Helper formatting
  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      if (diffSecs < 10) return 'just now';
      if (diffSecs < 60) return `${diffSecs}s ago`;
      const diffMins = Math.floor(diffSecs / 60);
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return isoString;
    }
  };

  const formatAbsoluteTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return isoString;
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Role Badge Styling
  const renderRoleBadge = (role: string) => {
    const r = role.toLowerCase();
    if (r === 'admin') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/40">
          Admin
        </span>
      );
    }
    if (r === 'developer' || r === 'developers') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40">
          Developer
        </span>
      );
    }
    if (r === 'system') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-500/20 text-slate-300 border border-slate-500/40">
          System
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
        Viewer
      </span>
    );
  };

  // Action Badge Styling
  const renderActionBadge = (action: string, cat: AuditCategory) => {
    let icon = <Activity className="w-3.5 h-3.5" />;
    let colorClass = 'text-slate-300 bg-slate-800/60 border-slate-700';

    if (action.includes('LOGIN')) {
      icon = <LogIn className="w-3.5 h-3.5" />;
      colorClass = 'text-emerald-300 bg-emerald-950/60 border-emerald-800/80';
    } else if (action.includes('LOGOUT')) {
      icon = <LogOut className="w-3.5 h-3.5" />;
      colorClass = 'text-slate-300 bg-slate-900 border-slate-800';
    } else if (action.includes('CLUSTER_CREATE')) {
      icon = <Layers className="w-3.5 h-3.5" />;
      colorClass = 'text-cyan-300 bg-cyan-950/60 border-cyan-800/80';
    } else if (action.includes('CLUSTER_DELETE')) {
      icon = <XCircle className="w-3.5 h-3.5" />;
      colorClass = 'text-rose-300 bg-rose-950/60 border-rose-800/80';
    } else if (action.includes('APP')) {
      icon = <Package className="w-3.5 h-3.5" />;
      colorClass = 'text-purple-300 bg-purple-950/60 border-purple-800/80';
    } else if (action.includes('DENIED') || action.includes('SECURITY')) {
      icon = <ShieldAlert className="w-3.5 h-3.5" />;
      colorClass = 'text-rose-300 bg-rose-950/80 border-rose-700';
    } else if (action.includes('ADMIN') || action.includes('OIDC') || action.includes('BASELINE')) {
      icon = <Sliders className="w-3.5 h-3.5" />;
      colorClass = 'text-blue-300 bg-blue-950/60 border-blue-800/80';
    }

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium border ${colorClass}`}>
        {icon}
        <span className="truncate max-w-[200px]">{action}</span>
      </span>
    );
  };

  // Status Badge
  const renderStatusBadge = (st: AuditStatus) => {
    if (st === 'SUCCESS') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3 stroke-[2.5]" />
          <span>SUCCESS</span>
        </span>
      );
    }
    if (st === 'FAILURE') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <XCircle className="w-3 h-3 stroke-[2.5]" />
          <span>FAILED</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <AlertTriangle className="w-3 h-3 stroke-[2.5]" />
        <span>WARN</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyber-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono flex items-center gap-2.5">
              <ShieldCheck className="w-7 h-7 text-cyan-400" />
              <span>Audit Trail & Activity Logs</span>
            </h1>
            <span className="px-2 py-0.5 text-[11px] font-mono font-bold uppercase rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
              Live Auditing
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1 font-mono">
            Immutable audit record of user authentications, cluster lifecycle mutations, and security events.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          {/* Auto Refresh Toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all border ${
              autoRefresh
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                : 'bg-cyber-900 text-slate-400 hover:text-slate-200 border-cyber-800'
            }`}
            title="Auto-refresh audit stream every 15 seconds"
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
            <span>Auto Refresh</span>
          </button>

          {/* Manual Refresh */}
          <button
            type="button"
            onClick={() => {
              fetchLogs();
              fetchStats();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-semibold bg-cyber-900 hover:bg-cyber-800 text-slate-300 hover:text-white border border-cyber-700/80 transition-all disabled:opacity-50"
            title="Refresh logs immediately"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Export Dropdown / Buttons */}
          <div className="flex items-center rounded-xl bg-cyber-900 border border-cyber-700/80 overflow-hidden">
            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-300 hover:text-white hover:bg-cyber-800 transition-colors flex items-center gap-1"
              title="Download audit logs as CSV"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>CSV</span>
            </button>
            <div className="w-px h-4 bg-cyber-800" />
            <button
              type="button"
              onClick={() => handleExport('json')}
              className="px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-300 hover:text-white hover:bg-cyber-800 transition-colors"
              title="Download audit logs as JSON"
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Events (24h) */}
        <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 backdrop-blur-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-xl group-hover:bg-cyan-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Audit Events (24h)</span>
            <Activity className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">
            {statsLoading ? (
              <span className="inline-block w-12 h-6 bg-cyber-800 rounded animate-pulse" />
            ) : (
              stats?.totalEvents ?? total
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span>Active streaming database</span>
          </div>
        </div>

        {/* Card 2: Successful Logins */}
        <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 backdrop-blur-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>User Logins (24h)</span>
            <LogIn className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono mt-2">
            {statsLoading ? (
              <span className="inline-block w-12 h-6 bg-cyber-800 rounded animate-pulse" />
            ) : (
              stats?.totalLogins ?? 0
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-1">
            SSO / Enterprise & Breakglass
          </div>
        </div>

        {/* Card 3: Failed Login Attempts */}
        <div className={`p-4 rounded-2xl border backdrop-blur-md relative overflow-hidden transition-all ${
          (stats?.failedLogins || 0) > 0
            ? 'bg-rose-950/30 border-rose-800/80 shadow-[0_0_15px_rgba(244,63,94,0.15)]'
            : 'bg-cyber-900/60 border-cyber-800/80'
        }`}>
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Failed Logins (24h)</span>
            <ShieldAlert className={`w-4 h-4 ${(stats?.failedLogins || 0) > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
          </div>
          <div className={`text-2xl font-bold font-mono mt-2 ${(stats?.failedLogins || 0) > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
            {statsLoading ? (
              <span className="inline-block w-12 h-6 bg-cyber-800 rounded animate-pulse" />
            ) : (
              stats?.failedLogins ?? 0
            )}
          </div>
          <div className="text-[11px] font-mono mt-1 text-slate-500">
            {(stats?.failedLogins || 0) > 0 ? (
              <span className="text-rose-300 font-medium">Potential security attention needed</span>
            ) : (
              <span>Zero authentication anomalies</span>
            )}
          </div>
        </div>

        {/* Card 4: Cluster Operations */}
        <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 backdrop-blur-md relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl group-hover:bg-blue-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>Cluster Operations (24h)</span>
            <Layers className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">
            {statsLoading ? (
              <span className="inline-block w-12 h-6 bg-cyber-800 rounded animate-pulse" />
            ) : (
              stats?.clusterMutations ?? 0
            )}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-1">
            Provision, upgrade, sleep, apps
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-cyber-900/80 border border-cyber-800/80 backdrop-blur-md space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search user, action, cluster name, resource, IP..."
              className="w-full pl-10 pr-9 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Dropdown */}
          <div className="shrink-0 flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as any);
                setPage(1);
              }}
              aria-label="Filter by Status"
              className="px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 text-xs font-mono text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 cursor-pointer"
            >
              <option value="ALL">All Outcomes</option>
              <option value="SUCCESS">Success Only</option>
              <option value="FAILURE">Failed Only</option>
              <option value="WARNING">Warnings</option>
            </select>

            {/* Time Range Dropdown */}
            <select
              value={timeRange}
              onChange={(e) => {
                setTimeRange(e.target.value as any);
                setPage(1);
              }}
              aria-label="Filter by Time Range"
              className="px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 text-xs font-mono text-slate-300 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="1h">Past 1 Hour</option>
              <option value="24h">Past 24 Hours</option>
              <option value="7d">Past 7 Days</option>
              <option value="30d">Past 30 Days</option>
            </select>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-mono">
          <span className="text-slate-500 text-[11px] uppercase tracking-wider shrink-0 mr-1">Categories:</span>
          {(
            [
              { id: 'ALL', label: 'All Events' },
              { id: 'AUTH', label: 'Authentication' },
              { id: 'CLUSTER', label: 'Clusters' },
              { id: 'APP', label: 'Applications' },
              { id: 'ADMIN', label: 'Administration' },
              { id: 'SECURITY', label: 'Security' },
            ] as const
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                setCategory(cat.id);
                setPage(1);
              }}
              className={`px-3 py-1 rounded-lg transition-all whitespace-nowrap text-xs font-medium ${
                category === cat.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-950 border border-transparent'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Logs Table */}
      <div className="rounded-2xl bg-cyber-900/60 border border-cyber-800/80 overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono divide-y divide-cyber-800/80">
            <thead className="bg-cyber-950/80 text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th scope="col" className="px-4 py-3.5">Timestamp</th>
                <th scope="col" className="px-4 py-3.5">User / Actor</th>
                <th scope="col" className="px-4 py-3.5">Action</th>
                <th scope="col" className="px-4 py-3.5">Resource</th>
                <th scope="col" className="px-4 py-3.5">Status</th>
                <th scope="col" className="px-4 py-3.5">Client IP</th>
                <th scope="col" className="px-4 py-3.5 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-800/40">
              {loading && logs.length === 0 ? (
                // Skeletons
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    <td className="px-4 py-3.5"><div className="w-24 h-4 bg-cyber-800 rounded" /></td>
                    <td className="px-4 py-3.5"><div className="w-28 h-4 bg-cyber-800 rounded" /></td>
                    <td className="px-4 py-3.5"><div className="w-32 h-4 bg-cyber-800 rounded" /></td>
                    <td className="px-4 py-3.5"><div className="w-24 h-4 bg-cyber-800 rounded" /></td>
                    <td className="px-4 py-3.5"><div className="w-16 h-4 bg-cyber-800 rounded" /></td>
                    <td className="px-4 py-3.5"><div className="w-20 h-4 bg-cyber-800 rounded" /></td>
                    <td className="px-4 py-3.5 text-right"><div className="w-12 h-4 bg-cyber-800 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Shield className="w-8 h-8 text-slate-600 mb-1" />
                      <p className="text-sm font-semibold text-slate-400">No audit events match your filters</p>
                      <p className="text-xs text-slate-600">Try adjusting your search terms, category, or time range.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-cyber-800/40 transition-colors group cursor-pointer"
                    onClick={() => setSelectedEvent(log)}
                  >
                    {/* Timestamp */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-300" title={log.timestamp}>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="font-semibold text-white">{formatRelativeTime(log.timestamp)}</span>
                        <span className="text-[10px] text-slate-500 hidden xl:inline">({formatAbsoluteTime(log.timestamp).split(', ')[1]})</span>
                      </div>
                    </td>

                    {/* Actor */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-md bg-cyber-800 flex items-center justify-center text-[10px] font-bold uppercase text-slate-300">
                          {log.username.slice(0, 2)}
                        </div>
                        <span className="font-semibold text-slate-200 truncate max-w-[130px]" title={log.username}>
                          {log.username}
                        </span>
                        {renderRoleBadge(log.userRole)}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {renderActionBadge(log.action, log.category)}
                    </td>

                    {/* Resource */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-300">
                      {log.resourceName ? (
                        <div className="flex items-center gap-1.5 truncate max-w-[180px]">
                          <span className="text-slate-500 text-[10px] lowercase">{log.resourceType}:</span>
                          <span className="text-cyan-300 font-semibold truncate" title={log.resourceName}>
                            {log.resourceName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px] capitalize">{log.resourceType}</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {renderStatusBadge(log.status)}
                    </td>

                    {/* Client IP */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                      {log.ipAddress || '127.0.0.1'}
                    </td>

                    {/* Details Action */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(log);
                        }}
                        className="p-1 text-slate-400 hover:text-cyan-300 hover:bg-cyber-800 rounded-lg transition-colors inline-flex items-center gap-1 text-[11px] font-mono"
                        title="View raw event details and JSON payload"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 bg-cyber-950/80 border-t border-cyber-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span>Showing</span>
            <span className="text-white font-semibold">{total > 0 ? (page - 1) * limit + 1 : 0}</span>
            <span>to</span>
            <span className="text-white font-semibold">{Math.min(page * limit, total)}</span>
            <span>of</span>
            <span className="text-white font-semibold">{total}</span>
            <span>records</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Limit Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 text-[11px]">Per page:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                aria-label="Records per page"
                className="px-2 py-1 rounded-lg bg-cyber-900 border border-cyber-700/80 text-xs font-mono text-slate-300 focus:outline-none"
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>

            {/* Prev / Next Buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded-lg bg-cyber-900 border border-cyber-800 text-slate-400 hover:text-white hover:bg-cyber-800 disabled:opacity-40 transition-colors"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 text-slate-300">
                Page <span className="text-white font-bold">{page}</span> of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1.5 rounded-lg bg-cyber-900 border border-cyber-800 text-slate-400 hover:text-white hover:bg-cyber-800 disabled:opacity-40 transition-colors"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Details Inspection Modal */}
      {selectedEvent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-cyber-950 border border-cyber-700 shadow-2xl p-6 relative max-h-[90vh] flex flex-col font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-cyber-800 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 id="audit-modal-title" className="text-base font-bold text-white">
                    Audit Event Details
                  </h3>
                  <p className="text-xs text-slate-400">ID: {selectedEvent.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                aria-label="Close modal"
                className="p-1 text-slate-400 hover:text-white hover:bg-cyber-900 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Event Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-4">
              <div className="p-2.5 rounded-xl bg-cyber-900/60 border border-cyber-800">
                <span className="text-slate-500 text-[10px] uppercase block">Action</span>
                <span className="text-white font-semibold mt-0.5 block truncate">{selectedEvent.action}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-cyber-900/60 border border-cyber-800">
                <span className="text-slate-500 text-[10px] uppercase block">Category</span>
                <span className="text-cyan-300 font-semibold mt-0.5 block">{selectedEvent.category}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-cyber-900/60 border border-cyber-800">
                <span className="text-slate-500 text-[10px] uppercase block">Status</span>
                <span className="mt-0.5 block">{renderStatusBadge(selectedEvent.status)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-cyber-900/60 border border-cyber-800">
                <span className="text-slate-500 text-[10px] uppercase block">Actor (User)</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-white font-semibold truncate">{selectedEvent.username}</span>
                  {renderRoleBadge(selectedEvent.userRole)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-cyber-900/60 border border-cyber-800">
                <span className="text-slate-500 text-[10px] uppercase block">Client IP</span>
                <span className="text-slate-300 font-semibold mt-0.5 block">{selectedEvent.ipAddress || '127.0.0.1'}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-cyber-900/60 border border-cyber-800">
                <span className="text-slate-500 text-[10px] uppercase block">Timestamp</span>
                <span className="text-slate-300 text-[11px] mt-0.5 block truncate" title={selectedEvent.timestamp}>
                  {formatAbsoluteTime(selectedEvent.timestamp)}
                </span>
              </div>
            </div>

            {selectedEvent.resourceName && (
              <div className="mb-4 p-3 rounded-xl bg-cyber-900/80 border border-cyber-800 text-xs flex items-center justify-between">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase block">Target Resource</span>
                  <span className="text-cyan-300 font-bold">{selectedEvent.resourceType}: {selectedEvent.resourceName}</span>
                </div>
                {selectedEvent.userAgent && (
                  <span className="text-slate-500 text-[10px] max-w-[240px] truncate" title={selectedEvent.userAgent}>
                    {selectedEvent.userAgent}
                  </span>
                )}
              </div>
            )}

            {/* Details JSON Payload */}
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1.5 text-xs text-slate-400">
                <span>Structured Event Payload:</span>
                <button
                  type="button"
                  onClick={() => handleCopyPayload(selectedEvent.details)}
                  className="inline-flex items-center gap-1 text-slate-400 hover:text-cyan-300 text-[11px] transition-colors"
                >
                  {copiedPayload ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedPayload ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>
              <div className="flex-1 p-3.5 rounded-xl bg-cyber-950 border border-cyber-800 overflow-auto max-h-60 text-xs font-mono text-cyan-300">
                <pre className="whitespace-pre-wrap">
                  {selectedEvent.details
                    ? JSON.stringify(selectedEvent.details, null, 2)
                    : '// No additional payload attached'}
                </pre>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 mt-4 border-t border-cyber-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyber-800 hover:bg-cyber-700 text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
