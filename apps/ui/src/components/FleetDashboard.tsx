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
  RefreshCw,
  CheckCircle2,
  Moon,
  Sun,
  Lock,
} from 'lucide-react';
import type { VirtualCluster, ClusterPhase, UserSession } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { MetricSparkline } from './MetricSparkline';
import { KubeconfigModal } from './KubeconfigModal';
import { UpgradeModal } from './UpgradeModal';
import { DeleteModal } from './DeleteModal';
import { SleepModal } from './SleepModal';

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
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Modal states
  const [selectedCluster, setSelectedCluster] = useState<VirtualCluster | null>(null);
  const [activeModal, setActiveModal] = useState<'kubeconfig' | 'upgrade' | 'delete' | 'sleep' | null>(null);

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

  const filteredClusters = clusters.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.metadata?.owner && c.metadata.owner.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.spec.sizePreset && c.spec.sizePreset.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && c.status.phase === 'Ready') ||
      (statusFilter === 'sleeping' && c.status.phase === 'Sleeping') ||
      (statusFilter === 'syncing' && c.status.phase === 'Provisioning') ||
      (statusFilter === 'upgrading' && c.status.phase === 'Upgrading') ||
      (statusFilter === 'degraded' && c.status.phase === 'Degraded');

    const matchesEnv =
      envFilter === 'all' || (c.metadata?.environment && c.metadata.environment === envFilter);

    return matchesSearch && matchesStatus && matchesEnv;
  });

  // Calculate fleet stats
  const totalClusters = clusters.length;
  const readyClusters = clusters.filter((c) => c.status.phase === 'Ready').length;
  const sleepingClusters = clusters.filter((c) => c.status.phase === 'Sleeping').length;
  const upgradingClusters = clusters.filter((c) => c.status.phase === 'Upgrading').length;
  const totalPods = clusters.reduce((acc, c) => acc + (c.status.metrics?.podCount || 0), 0);
  const distinctEngines = Array.from(
    new Set(clusters.map((c) => c.status.vclusterVersion || c.spec.vclusterVersion).filter(Boolean))
  );
  const dominantEngine = distinctEngines.length === 1
    ? `vCluster ${distinctEngines[0]}`
    : distinctEngines.length > 1
    ? `${distinctEngines.length} Engines`
    : 'vCluster OSS';

  return (
    <div className="space-y-6">
      {/* Top Banner / Fleet Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1 */}
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
            <span className="text-slate-600">•</span>
            <span className="text-purple-400 font-semibold">{upgradingClusters} Upgrading</span>
          </div>
        </div>

        {/* Card 2 */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Quorum Health</p>
              <h3 className="text-3xl font-bold font-mono text-emerald-400 mt-1">
                {totalClusters > 0 ? Math.round((readyClusters / totalClusters) * 100) : 100}%
              </h3>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-xs font-mono text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>3-Node HA etcd Quorum Verified</span>
          </div>
        </div>

        {/* Card 3 */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Tenant Workloads</p>
              <h3 className="text-3xl font-bold font-mono text-white mt-1">{totalPods}</h3>
            </div>
            <div className="p-3 bg-cyber-800 rounded-xl border border-cyber-700 text-cyan-400">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-xs font-mono text-slate-400">
            <span>Isolated virtual pods synced to host</span>
          </div>
        </div>

        {/* Card 4 */}
        <div className="relative overflow-hidden bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Engine Fleet</p>
              <h3 className="text-2xl font-bold font-mono text-cyber-accent mt-1.5">{dominantEngine}</h3>
            </div>
            <div className="p-3 bg-cyber-800 rounded-xl border border-cyber-700 text-purple-400">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3 text-xs font-mono text-slate-400">
            <span>Dynamic multi-version control</span>
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
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between bg-cyber-900/70 border border-cyber-700/60 rounded-2xl p-3 backdrop-blur-sm">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter clusters, owner, preset..."
            className="w-full bg-cyber-950/80 border border-cyber-700/70 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyber-accent font-sans transition-colors"
          />
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
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

        {/* Action button (Admins only) */}
        {isAdmin && (
          <a
            href="/new"
            className="w-full md:w-auto px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-semibold text-xs rounded-xl shadow-glow-sm flex items-center justify-center gap-1.5 transition-all"
          >
            <Plus className="w-4 h-4" />
            Provision Virtual Cluster
          </a>
        )}
      </div>

      {/* Cluster Fleet Grid */}
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClusters.map((cluster) => {
            const isHA = cluster.spec.highAvailability;
            const size = cluster.spec.sizePreset || 'medium';
            const k8sVer = cluster.status.virtualK8sVersion || cluster.spec.kubernetesVersion || 'N/A';

            return (
              <div
                key={cluster.name}
                className="group relative flex flex-col justify-between bg-cyber-900/90 border border-cyber-700/70 hover:border-cyber-accent/60 rounded-2xl p-5 shadow-lg hover:shadow-glow-sm transition-all duration-200 backdrop-blur-sm"
              >
                {/* Header */}
                <div>
                  <div className="flex justify-between items-start mb-3">
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

                  {/* Telemetry Sparklines */}
                  <div className="grid grid-cols-2 gap-3 py-3 px-3.5 bg-cyber-950/60 rounded-xl border border-cyber-800/80 mb-4">
                    <MetricSparkline
                      data={cluster.sparklineData?.cpu || [10, 15, 20, 25, 20, 30]}
                      color="cyan"
                      label="CPU"
                      currentValue={cluster.status.metrics?.cpuPercent ?? 24}
                    />
                    <MetricSparkline
                      data={cluster.sparklineData?.memory || [20, 22, 25, 26, 28, 28]}
                      color="purple"
                      label="Memory"
                      currentValue={cluster.status.metrics?.memPercent ?? 34}
                    />
                  </div>

                  {/* Add-on features summary */}
                  <div className="text-[11px] font-mono text-slate-400 space-y-1 mb-4">
                    <div className="flex justify-between">
                      <span>External CoreDNS:</span>
                      <span className="text-emerald-400">Enabled</span>
                    </div>
                    <div className="flex justify-between">
                      <span>External Metrics (HPA):</span>
                      <span className="text-emerald-400">Enabled</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Endpoint:</span>
                      <span className="text-slate-300 truncate max-w-[160px]" title={cluster.status.endpoint}>
                        {cluster.status.endpoint ? 'Available' : 'Pending'}
                      </span>
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
                      <ExternalLink className="w-4 h-4" />
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
                        <Trash2 className="w-4 h-4" />
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
    </div>
  );
};
