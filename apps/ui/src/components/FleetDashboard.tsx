import React, { useState, useEffect } from 'react';
import {
  Server,
  Plus,
  Search,
  Layers,
  Activity,
  Terminal,
  ArrowUpCircle,
  Trash2,
  ExternalLink,
  Shield,
  ShieldCheck,
  Cpu,
  Package,
  LayoutGrid,
  List,
  RefreshCw,
  CheckCircle2,
  Moon,
  Sun,
  Lock,
  FolderGit2,
  Tag,
} from 'lucide-react';
import type { VirtualCluster, ClusterPhase, UserSession } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { MetricSparkline } from './MetricSparkline';
import { KubeconfigModal } from './KubeconfigModal';
import { UpgradeModal } from './UpgradeModal';
import { DeleteModal } from './DeleteModal';
import { SleepModal } from './SleepModal';
import { ClusterGroupModal } from './ClusterGroupModal';
import { parseCpuMillis, parseMemoryBytes, getClusterCapacity } from '../lib/metrics-utils';

interface FleetDashboardProps {
  currentUser?: UserSession | null;
}

export const FleetDashboard: React.FC<FleetDashboardProps> = ({ currentUser }) => {
  const [user, setUser] = useState<UserSession | null>(currentUser || null);
  const [clusters, setClusters] = useState<VirtualCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [envFilter, setEnvFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modal states
  const [selectedCluster, setSelectedCluster] = useState<VirtualCluster | null>(null);
  const [activeModal, setActiveModal] = useState<'kubeconfig' | 'upgrade' | 'delete' | 'sleep' | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupModalTargetCluster, setGroupModalTargetCluster] = useState<VirtualCluster | null>(null);

  const fetchClusters = async () => {
    try {
      const res = await fetch('/api/vclusters');
      const data = await res.json();
      if (data.success && data.data) {
        setClusters(data.data);
      }
    } catch (err) {
      console.error('Failed fetching clusters:', err);
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
    fetchClusters();
    const interval = setInterval(fetchClusters, 3000);
    return () => clearInterval(interval);
  }, []);

  const isAdmin = !user || user.role === 'admin';

  // Extract all distinct cluster groups across fleet
  const availableGroups = Array.from(
    new Set(
      clusters.flatMap((c) => {
        if (c.metadata?.clusterGroups && c.metadata.clusterGroups.length > 0) {
          return c.metadata.clusterGroups;
        }
        if (c.metadata?.clusterGroup) {
          return [c.metadata.clusterGroup];
        }
        return [];
      })
    )
  ).filter(Boolean);

  const filteredClusters = clusters.filter((c) => {
    const cGroups =
      c.metadata?.clusterGroups && c.metadata.clusterGroups.length > 0
        ? c.metadata.clusterGroups
        : c.metadata?.clusterGroup
        ? [c.metadata.clusterGroup]
        : [];

    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.metadata?.owner && c.metadata.owner.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.spec.sizePreset && c.spec.sizePreset.toLowerCase().includes(searchQuery.toLowerCase())) ||
      cGroups.some((g) => g.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && c.status.phase === 'Ready') ||
      (statusFilter === 'sleeping' && c.status.phase === 'Sleeping') ||
      (statusFilter === 'syncing' && c.status.phase === 'Provisioning') ||
      (statusFilter === 'upgrading' && c.status.phase === 'Upgrading') ||
      (statusFilter === 'degraded' && c.status.phase === 'Degraded');

    const matchesEnv =
      envFilter === 'all' || (c.metadata?.environment && c.metadata.environment === envFilter);

    const matchesGroup =
      groupFilter === 'all' || cGroups.includes(groupFilter);

    return matchesSearch && matchesStatus && matchesEnv && matchesGroup;
  });

  // Calculate fleet stats
  const totalClusters = clusters.length;
  const readyClusters = clusters.filter((c) => c.status.phase === 'Ready').length;
  const sleepingClusters = clusters.filter((c) => c.status.phase === 'Sleeping').length;
  const upgradingClusters = clusters.filter((c) => c.status.phase === 'Upgrading').length;
  const degradedClusters = clusters.filter((c) => c.status.phase === 'Degraded').length;

  const totalPods = clusters.reduce((acc, c) => acc + (c.status.metrics?.podCount || 0), 0);
  const totalInstalledApps = clusters.reduce((acc, c) => acc + (c.metadata?.installedApps?.length || 0), 0);
  const totalHelmReleases = clusters.reduce((acc, c) => acc + (c.metadata?.installedApps?.filter((a) => a.helm)?.length || 0), 0);
  const totalManifests = clusters.reduce((acc, c) => acc + (c.metadata?.installedApps?.filter((a) => a.manifests)?.length || 0), 0);

  const haClustersCount = clusters.filter((c) => c.spec.highAvailability).length;
  const quorumPercent = totalClusters > 0 ? Math.round((readyClusters / totalClusters) * 100) : 100;

  // Compute resource allocations across fleet
  let totalCommittedCores = 0;
  let totalCommittedMemBytes = 0;
  let totalUsedCpuMillis = 0;
  let totalUsedMemBytes = 0;

  clusters.forEach((c) => {
    const isSleeping = c.status.phase === 'Sleeping' || c.spec.paused;
    const capacity = getClusterCapacity(c.spec);
    totalCommittedCores += capacity.cpuMillis / 1000;
    totalCommittedMemBytes += capacity.memoryBytes;

    if (!isSleeping && c.status.metrics) {
      totalUsedCpuMillis += parseCpuMillis(c.status.metrics.cpuUsage);
      totalUsedMemBytes += parseMemoryBytes(c.status.metrics.memoryUsage);
    }
  });

  const totalCommittedMemGiB = totalCommittedMemBytes / (1024 * 1024 * 1024);
  const totalUsedMemDisplay = totalUsedMemBytes >= 1024 * 1024 * 1024
    ? `${(totalUsedMemBytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`
    : `${Math.round(totalUsedMemBytes / (1024 * 1024))} MiB`;

  const totalUsedCpuDisplay = totalUsedCpuMillis >= 1000
    ? `${(totalUsedCpuMillis / 1000).toFixed(1)} Cores`
    : `${totalUsedCpuMillis}m`;

  const fleetCpuLoad = totalCommittedCores > 0
    ? Math.round((totalUsedCpuMillis / (totalCommittedCores * 1000)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Top Banner / Fleet Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Fleet Scale */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Fleet Clusters</p>
              <h3 className="text-3xl font-bold font-mono text-white mt-1">{totalClusters}</h3>
            </div>
            <div className="p-3 bg-cyber-800 rounded-xl border border-cyber-700 text-cyber-accent">
              <Server className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs font-mono">
            <span className="text-emerald-400 font-semibold">{readyClusters} Active</span>
            {sleepingClusters > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span className="text-indigo-400 font-semibold">{sleepingClusters} Sleeping</span>
              </>
            )}
            {upgradingClusters > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span className="text-purple-400 font-semibold">{upgradingClusters} Upgrading</span>
              </>
            )}
            {degradedClusters > 0 && (
              <>
                <span className="text-slate-600">•</span>
                <span className="text-rose-400 font-semibold">{degradedClusters} Degraded</span>
              </>
            )}
          </div>
        </div>

        {/* Card 2: Fleet Compute Allocation */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Fleet Compute Allocated</p>
              <h3 className="text-2xl font-bold font-mono text-cyan-300 mt-1.5">
                {totalCommittedCores} Cores <span className="text-slate-500 font-normal text-base">•</span> {Math.round(totalCommittedMemGiB)} GiB
              </h3>
            </div>
            <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/20 text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>In Use: <strong className="text-slate-200">{totalUsedCpuDisplay}</strong> • <strong className="text-slate-200">{totalUsedMemDisplay}</strong></span>
            <span className="text-cyan-400 font-semibold">{fleetCpuLoad}% Load</span>
          </div>
        </div>

        {/* Card 3: Workloads & Apps */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Workloads & Apps</p>
              <h3 className="text-3xl font-bold font-mono text-white mt-1">
                {totalPods} <span className="text-sm font-normal text-slate-400 font-sans">Pods</span>
              </h3>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-xs font-mono text-slate-400 flex items-center justify-between">
            <span>{totalInstalledApps} App Releases</span>
            <span className="text-emerald-400 font-semibold">{totalHelmReleases} Helm • {totalManifests} Manifest</span>
          </div>
        </div>

        {/* Card 4: HA Quorum & Governance (Replaces Engine Fleet) */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">HA Quorum & Governance</p>
              <h3 className="text-3xl font-bold font-mono text-emerald-400 mt-1">
                {quorumPercent}%
              </h3>
            </div>
            <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-xs font-mono text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{haClustersCount}/{totalClusters} clusters with 3-Node HA etcd</span>
          </div>
        </div>
      </div>

      {/* Viewer Access Mode Alert Banner */}
      {!isAdmin && user && (
        <div className="bg-cyan-950/30 border border-cyan-500/30 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white flex items-center gap-2">
                Viewer Access Mode
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 uppercase font-semibold">
                  Read-Only
                </span>
              </h4>
              <p className="text-slate-300 mt-0.5">
                Signed in as <strong className="text-white">{user.email || user.username}</strong>. Showing only virtual clusters assigned to you or your groups. You have full access to view clusters and download kubeconfig. Modifications require administrator privileges.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Control Toolbar */}
      <div className="flex flex-col gap-3 bg-cyber-900/70 border border-cyber-700/60 rounded-2xl p-3.5 backdrop-blur-sm">
        {/* Main Controls Row */}
        <div className="flex flex-col xl:flex-row gap-3 xl:items-center justify-between">
          {/* Left: Search & Group Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search */}
            <div className="relative w-full sm:w-64 md:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cluster, group, owner..."
                className="w-full bg-cyber-950/80 border border-cyber-700/70 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyber-accent font-sans transition-colors"
              />
            </div>

            {/* Group Filter Dropdown */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-mono text-slate-400 uppercase shrink-0 flex items-center gap-1">
                <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
                Group:
              </span>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="bg-cyber-950/90 border border-cyber-700/80 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                title="Filter by Cluster Group"
              >
                <option value="all">All Groups ({clusters.length})</option>
                {availableGroups.map((g) => {
                  const count = clusters.filter((c) => {
                    const grps =
                      c.metadata?.clusterGroups && c.metadata.clusterGroups.length > 0
                        ? c.metadata.clusterGroups
                        : c.metadata?.clusterGroup
                        ? [c.metadata.clusterGroup]
                        : [];
                    return grps.includes(g);
                  }).length;
                  return (
                    <option key={g} value={g}>
                      {g} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Right: Actions & View Switcher */}
          <div className="flex flex-wrap items-center gap-2.5 justify-start sm:justify-end shrink-0">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-cyber-950 p-1 rounded-xl border border-cyber-800 shrink-0">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-cyber-800 text-cyber-accent shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-lg transition-colors ${
                  viewMode === 'table'
                    ? 'bg-cyber-800 text-cyber-accent shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Table View"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {/* Manage Groups Modal Trigger (Admin) */}
            {isAdmin && (
              <button
                onClick={() => {
                  setGroupModalTargetCluster(null);
                  setIsGroupModalOpen(true);
                }}
                className="px-3 py-2 bg-cyber-800 hover:bg-cyber-750 text-cyan-300 border border-cyan-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-sm shrink-0"
                title="Manage Fleet Cluster Groups"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>Groups</span>
                {availableGroups.length > 0 && (
                  <span className="px-1.5 py-0.2 bg-cyan-500/20 text-cyan-400 rounded-full text-[10px] font-mono font-bold">
                    {availableGroups.length}
                  </span>
                )}
              </button>
            )}

            {/* OIDC Policy Governance (Admin) */}
            {isAdmin && (
              <a
                href="/admin/oidc"
                className="px-3 py-2 bg-cyber-800 hover:bg-cyber-750 text-purple-300 border border-purple-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-sm shrink-0"
                title="Global & Group OIDC Policy Governance"
              >
                <Lock className="w-3.5 h-3.5 text-purple-400" />
                <span>OIDC Policy</span>
              </a>
            )}

            {/* Action button (Admins only) */}
            {isAdmin && (
              <a
                href="/new"
                className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold text-xs rounded-xl shadow-glow-sm flex items-center justify-center gap-1.5 transition-all shrink-0"
              >
                <Plus className="w-4 h-4" />
                Provision Virtual Cluster
              </a>
            )}
          </div>
        </div>

        {/* Status Filter Chips Row */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-cyber-800/60">
          <span className="text-[11px] font-mono text-slate-400 uppercase mr-1">Status:</span>
          {[
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'sleeping', label: 'Sleeping' },
            { id: 'syncing', label: 'Syncing' },
            { id: 'upgrading', label: 'Upgrading' },
            { id: 'degraded', label: 'Degraded' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setStatusFilter(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === item.id
                  ? 'bg-cyber-accent text-slate-950 font-semibold shadow-glow-sm'
                  : 'bg-cyber-800/80 text-slate-400 hover:text-white hover:bg-cyber-750'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cluster Fleet Content */}
      {loading ? (
        <div className="py-20 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-cyber-accent" />
          <span className="font-mono text-xs">Querying Kubernetes API for virtual clusters...</span>
        </div>
      ) : filteredClusters.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-cyber-700 rounded-2xl bg-cyber-900/30">
          <Server className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h4 className="text-base font-medium text-slate-300">No matching virtual clusters</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {isAdmin
              ? 'No virtual clusters match your current filter criteria or none have been provisioned yet.'
              : 'No virtual clusters have been assigned to your account or groups.'}
          </p>
          {isAdmin ? (
            <a
              href="/new"
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-cyber-800 hover:bg-cyber-700 text-slate-200 text-xs rounded-xl border border-cyber-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create First Cluster
            </a>
          ) : (
            <p className="mt-3 text-xs text-slate-400 font-mono">
              Contact your platform administrator to request access or cluster provisioning.
            </p>
          )}
        </div>
      ) : viewMode === 'table' ? (
        <div className="overflow-x-auto bg-cyber-900/90 border border-cyber-700/70 rounded-2xl shadow-lg backdrop-blur-sm">
          <table className="w-full text-left text-xs text-slate-300 font-mono min-w-[1150px]">
            <thead className="bg-cyber-950/80 border-b border-cyber-800 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Cluster</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Group</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Status</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Tier & Engine</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">HA Backing</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Workloads</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">CPU Usage</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Memory Usage</th>
                <th className="py-3.5 px-4 font-medium whitespace-nowrap">Apps</th>
                <th className="py-3.5 px-4 font-medium text-right whitespace-nowrap min-w-[190px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-800/60">
              {filteredClusters.map((cluster) => {
                const isHA = cluster.spec.highAvailability;
                const size = cluster.spec.sizePreset || 'medium';
                const k8sVer = cluster.status.virtualK8sVersion || cluster.spec.kubernetesVersion || 'N/A';
                const isSleeping = cluster.status.phase === 'Sleeping';
                const clusterGroups =
                  cluster.metadata?.clusterGroups && cluster.metadata.clusterGroups.length > 0
                    ? cluster.metadata.clusterGroups
                    : cluster.metadata?.clusterGroup
                    ? [cluster.metadata.clusterGroup]
                    : [];

                return (
                  <tr key={cluster.name} className="hover:bg-cyber-850/50 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <a href={`/clusters/${cluster.name}`} className="font-bold text-white hover:text-cyber-accent transition-colors">
                          {cluster.name}
                        </a>
                        {cluster.metadata?.environment && (
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-cyber-800 text-slate-400 border border-cyber-700">
                            {cluster.metadata.environment}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 font-sans">
                        {cluster.metadata?.owner || 'Tenant Space'}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1 flex-nowrap">
                        {clusterGroups.length > 0 ? (
                          clusterGroups.map((g) => (
                            <button
                              key={g}
                              type="button"
                              onClick={() => setGroupFilter(g)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[10px] hover:bg-cyan-500/25 transition-colors shrink-0"
                              title={`Filter fleet by group ${g}`}
                            >
                              <Tag className="w-2.5 h-2.5" />
                              {g}
                            </button>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-500 italic">—</span>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setGroupModalTargetCluster(cluster);
                              setIsGroupModalOpen(true);
                            }}
                            className="p-1 text-slate-500 hover:text-cyan-400 rounded hover:bg-cyber-800 transition-colors shrink-0"
                            title="Manage Cluster Groups"
                          >
                            <FolderGit2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusBadge phase={cluster.status.phase} />
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="capitalize text-white font-semibold">{size}</div>
                      <div className="text-[10px] text-cyber-accent">{k8sVer}</div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {isHA ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                          3-Node HA
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px]">
                          Single Node
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap text-white font-bold">
                      {cluster.status.metrics?.podCount || 0} pods
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="text-cyan-300 font-semibold">{cluster.status.metrics?.cpuUsage || '0m'}</div>
                      <div className="text-[10px] text-slate-500">{cluster.status.metrics?.cpuPercent ?? 0}% allocated</div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="text-purple-300 font-semibold">{cluster.status.metrics?.memoryUsage || '0Mi'}</div>
                      <div className="text-[10px] text-slate-500">{cluster.status.metrics?.memPercent ?? 0}% allocated</div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyber-800 text-slate-300 border border-cyber-700 text-[10px]">
                        <Package className="w-3 h-3 text-emerald-400" />
                        {cluster.metadata?.installedApps?.length || 0}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5 flex-nowrap shrink-0">
                        <button
                          onClick={() => {
                            setSelectedCluster(cluster);
                            setActiveModal('kubeconfig');
                          }}
                          className="w-7 h-7 flex items-center justify-center shrink-0 bg-cyber-800 hover:bg-cyber-700 text-slate-200 rounded-lg border border-cyber-700 transition-colors"
                          title="Connect via Kubeconfig & Access"
                        >
                          <Terminal className="w-3.5 h-3.5 text-cyber-accent" />
                        </button>
                        {isAdmin ? (
                          <>
                            <button
                              onClick={() => {
                                setSelectedCluster(cluster);
                                setActiveModal('upgrade');
                              }}
                              className="w-7 h-7 flex items-center justify-center shrink-0 bg-cyber-800 hover:bg-cyber-700 text-purple-300 rounded-lg border border-cyber-700 transition-colors"
                              title="Upgrade Engine / K8s Version"
                            >
                              <ArrowUpCircle className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setSelectedCluster(cluster);
                                setActiveModal('sleep');
                              }}
                              className={`w-7 h-7 flex items-center justify-center shrink-0 rounded-lg border transition-colors ${
                                isSleeping
                                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                  : 'bg-cyber-800 hover:bg-cyber-700 text-indigo-300 border-cyber-700'
                              }`}
                              title={isSleeping ? 'Wake Cluster' : 'Sleep Cluster'}
                            >
                              {isSleeping ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-400" />}
                            </button>
                          </>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[9px] font-mono text-slate-400 bg-cyber-950 rounded border border-cyber-800 flex items-center gap-0.5 shrink-0">
                            <Lock className="w-2.5 h-2.5 text-cyan-400" />
                            <span>Read Only</span>
                          </span>
                        )}
                        <a
                          href={`/clusters/${cluster.name}`}
                          className="w-7 h-7 flex items-center justify-center shrink-0 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800 transition-colors"
                          title="View Details"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setSelectedCluster(cluster);
                              setActiveModal('delete');
                            }}
                            className="w-7 h-7 flex items-center justify-center shrink-0 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                            title="Delete Cluster"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClusters.map((cluster) => {
            const isHA = cluster.spec.highAvailability;
            const size = cluster.spec.sizePreset || 'medium';
            const k8sVer = cluster.status.virtualK8sVersion || cluster.spec.kubernetesVersion || 'N/A';
            const clusterGroups =
              cluster.metadata?.clusterGroups && cluster.metadata.clusterGroups.length > 0
                ? cluster.metadata.clusterGroups
                : cluster.metadata?.clusterGroup
                ? [cluster.metadata.clusterGroup]
                : [];

            return (
              <div
                key={cluster.name}
                className="group relative flex flex-col justify-between bg-cyber-900/90 border border-cyber-700/70 hover:border-cyber-accent/60 rounded-2xl p-5 shadow-lg hover:shadow-glow-sm transition-all duration-200 backdrop-blur-sm"
              >
                {/* Header */}
                <div>
                  <div className="flex justify-between items-start mb-2.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-mono text-base font-bold text-white group-hover:text-cyber-accent transition-colors">
                          {cluster.name}
                        </h4>
                        {cluster.metadata?.environment && (
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyber-800 text-slate-400 border border-cyber-700">
                            {cluster.metadata.environment}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {cluster.metadata?.owner || 'Tenant Space'}
                      </p>
                    </div>
                    <StatusBadge phase={cluster.status.phase} />
                  </div>

                  {/* Cluster Group Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {clusterGroups.length > 0 ? (
                      clusterGroups.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGroupFilter(g);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 text-[10px] font-mono hover:bg-cyan-500/25 transition-colors"
                          title={`Filter fleet by group: ${g}`}
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {g}
                        </button>
                      ))
                    ) : (
                      <span className="text-[10px] font-mono text-slate-500 italic">No group</span>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGroupModalTargetCluster(cluster);
                          setIsGroupModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-cyan-400 hover:bg-cyber-850 border border-cyber-800 transition-colors"
                        title="Manage Cluster Groups"
                      >
                        <FolderGit2 className="w-3 h-3" />
                        <span>{clusterGroups.length === 0 ? '+ Group' : 'Edit'}</span>
                      </button>
                    )}
                  </div>

                  {/* Sizing & Spec Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-cyber-850 text-slate-300 border border-cyber-800">
                      Tier: <strong className="text-white capitalize">{size}</strong>
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-cyber-850 text-slate-300 border border-cyber-800">
                      K8s: <strong className="text-cyber-accent">{k8sVer}</strong>
                    </span>
                    {isHA && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        3-Node HA etcd
                      </span>
                    )}
                  </div>

                  {/* Telemetry Sparklines with Live Usage */}
                  <div className="grid grid-cols-2 gap-3 py-3 px-3.5 bg-cyber-950/60 rounded-xl border border-cyber-800/80 mb-4">
                    <div>
                      <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mb-1">
                        <span>CPU</span>
                        <span className="text-cyan-400 font-bold">{cluster.status.metrics?.cpuUsage || '0m'}</span>
                      </div>
                      <MetricSparkline
                        data={cluster.sparklineData?.cpu || [0, 0, 0, 0, 0]}
                        color="cyan"
                        label=""
                        currentValue={cluster.status.metrics?.cpuPercent ?? 0}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mb-1">
                        <span>RAM</span>
                        <span className="text-purple-400 font-bold">{cluster.status.metrics?.memoryUsage || '0Mi'}</span>
                      </div>
                      <MetricSparkline
                        data={cluster.sparklineData?.memory || [0, 0, 0, 0, 0]}
                        color="purple"
                        label=""
                        currentValue={cluster.status.metrics?.memPercent ?? 0}
                      />
                    </div>
                  </div>

                  {/* Add-on features & apps summary */}
                  <div className="text-[11px] font-mono text-slate-400 space-y-1 mb-4">
                    <div className="flex justify-between">
                      <span>Applications:</span>
                      <span className="text-slate-200 font-semibold flex items-center gap-1">
                        <Package className="w-3 h-3 text-emerald-400" />
                        {cluster.metadata?.installedApps?.length || 0} Installed
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>External CoreDNS:</span>
                      <span className="text-emerald-400">Enabled</span>
                    </div>
                    <div className="flex justify-between">
                      <span>External Metrics (HPA):</span>
                      <span className="text-emerald-400">Enabled</span>
                    </div>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-cyber-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setSelectedCluster(cluster);
                        setActiveModal('kubeconfig');
                      }}
                      className="px-2.5 py-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-200 text-xs font-medium rounded-lg border border-cyber-700 flex items-center gap-1.5 transition-colors"
                      title="Download Kubeconfig and CLI connection snippet"
                    >
                      <Terminal className="w-3.5 h-3.5 text-cyber-accent" />
                      Connect
                    </button>

                    {isAdmin ? (
                      <>
                        <button
                          onClick={() => {
                            setSelectedCluster(cluster);
                            setActiveModal('upgrade');
                          }}
                          className="px-2.5 py-1.5 bg-cyber-800 hover:bg-cyber-700 text-purple-300 text-xs font-medium rounded-lg border border-cyber-700 flex items-center gap-1.5 transition-colors"
                          title="Upgrade Kubernetes or vCluster Engine"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          Upgrade
                        </button>

                        <button
                          onClick={() => {
                            setSelectedCluster(cluster);
                            setActiveModal('sleep');
                          }}
                          className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border flex items-center gap-1.5 transition-colors ${
                            cluster.status.phase === 'Sleeping'
                              ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : 'bg-cyber-800 hover:bg-cyber-750 text-indigo-300 border-cyber-700'
                          }`}
                          title={cluster.status.phase === 'Sleeping' ? 'Wake up virtual cluster' : 'Put virtual cluster to sleep'}
                        >
                          {cluster.status.phase === 'Sleeping' ? (
                            <>
                              <Sun className="w-3.5 h-3.5 text-amber-400" />
                              Wake
                            </>
                          ) : (
                            <>
                              <Moon className="w-3.5 h-3.5 text-indigo-400" />
                              Sleep
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <span className="px-2 py-1 text-[10px] font-mono text-slate-400 bg-cyber-950 rounded-lg border border-cyber-800 flex items-center gap-1">
                        <Lock className="w-3 h-3 text-cyan-400" />
                        <span>Read Only</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <a
                      href={`/clusters/${cluster.name}`}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800 transition-colors"
                      title="View Details"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {isAdmin && (
                      <button
                        onClick={() => {
                          setSelectedCluster(cluster);
                          setActiveModal('delete');
                        }}
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                        title="Teardown Cluster"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <KubeconfigModal
        cluster={selectedCluster}
        isOpen={activeModal === 'kubeconfig'}
        onClose={() => setActiveModal(null)}
      />

      <SleepModal
        cluster={selectedCluster}
        isOpen={activeModal === 'sleep'}
        onClose={() => setActiveModal(null)}
        onSuccess={(updated) => {
          setClusters((prev) => prev.map((c) => (c.name === updated.name ? updated : c)));
        }}
      />

      <UpgradeModal
        cluster={selectedCluster}
        isOpen={activeModal === 'upgrade'}
        onClose={() => setActiveModal(null)}
        onUpgradeSuccess={(updated) => {
          setClusters((prev) => prev.map((c) => (c.name === updated.name ? updated : c)));
        }}
      />

      <DeleteModal
        cluster={selectedCluster}
        isOpen={activeModal === 'delete'}
        onClose={() => setActiveModal(null)}
        onDeleteSuccess={(deletedName) => {
          setClusters((prev) => prev.filter((c) => c.name !== deletedName));
        }}
      />

      <ClusterGroupModal
        cluster={groupModalTargetCluster}
        isOpen={isGroupModalOpen}
        onClose={() => {
          setIsGroupModalOpen(false);
          setGroupModalTargetCluster(null);
        }}
        onSuccess={(updated) => {
          if (updated) {
            setClusters((prev) => prev.map((c) => (c.name === updated.name ? updated : c)));
          } else {
            fetchClusters();
          }
        }}
        allClusters={clusters}
      />
    </div>
  );
};
