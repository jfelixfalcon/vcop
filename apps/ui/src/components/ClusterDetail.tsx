import React, { useState, useEffect, useRef } from 'react';
import {
  Server,
  ArrowLeft,
  Terminal,
  ArrowUpCircle,
  Trash2,
  Shield,
  ShieldAlert,
  Download,
  Copy,
  Check,
  Activity,
  CheckCircle2,
  Clock,
  Layers,
  FileCode,
  RefreshCw,
  Gauge,
  Sliders,
  Cpu,
  Database,
  HardDrive,
  Moon,
  Sun,
  Lock,
  BookOpen,
  Users,
  Mail,
  ShieldCheck,
  UserPlus,
  XCircle,
  Package,
  Box,
  ExternalLink,
  X,
  Plus,
  Sparkles,
  FolderGit2,
  Tag,
  AlertTriangle,
  Globe,
  Settings,
  Network,
  ChevronDown,
  RotateCcw,
} from 'lucide-react';
import type { VirtualCluster, ClusterCondition, UserSession, InstalledApp, AppStoreCatalog, AppGroup, AppDefinition, K8sEvent } from '../lib/types';
import { StatusBadge } from './StatusBadge';
import { ModalPortal } from './ModalPortal';
import { MetricSparkline } from './MetricSparkline';
import { AppRollbackModal } from './AppRollbackModal';
import { KubeconfigModal } from './KubeconfigModal';
import { UpgradeModal } from './UpgradeModal';
import { DeleteModal } from './DeleteModal';
import { QuotaModal } from './QuotaModal';
import { SleepModal } from './SleepModal';
import { RbacModal } from './RbacModal';
import { InstallAppModal } from './InstallAppModal';
import { ClusterGroupModal } from './ClusterGroupModal';
import { WorkloadMetricsView } from './WorkloadMetricsView';
import { IstioModal } from './IstioModal';
import { GatewayAPIModal } from './GatewayAPIModal';
import { DisasterRecoveryTab } from './DisasterRecoveryTab';

function parseK8sQuantity(val?: string): number {
  if (!val) return 0;
  const s = val.trim();
  if (s.endsWith('m')) {
    return parseFloat(s.slice(0, -1)) / 1000;
  }
  if (s.endsWith('Ki')) {
    return parseFloat(s.slice(0, -2)) * 1024;
  }
  if (s.endsWith('Mi')) {
    return parseFloat(s.slice(0, -2)) * 1024 * 1024;
  }
  if (s.endsWith('Gi')) {
    return parseFloat(s.slice(0, -2)) * 1024 * 1024 * 1024;
  }
  if (s.endsWith('Ti')) {
    return parseFloat(s.slice(0, -2)) * 1024 * 1024 * 1024 * 1024;
  }
  return parseFloat(s) || 0;
}

function calculatePercent(used?: string, hard?: string): number {
  if (!used || !hard) return 0;
  const u = parseK8sQuantity(used);
  const h = parseK8sQuantity(hard);
  if (h <= 0) return 0;
  const pct = Math.round((u / h) * 100);
  return Math.min(Math.max(pct, 0), 100);
}

function getConditionMeta(cond: ClusterCondition) {
  const isSleepingCond = cond.type === 'Sleeping';
  const isNominal = isSleepingCond ? cond.status === 'False' : cond.status === 'True';
  const isDegraded = isSleepingCond ? false : cond.status === 'False';

  switch (cond.type) {
    case 'ControlPlaneReady':
      return {
        label: 'Control Plane',
        category: 'Compute',
        icon: Cpu,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Ready',
      };
    case 'GatewayAPIReady':
      return {
        label: 'Gateway API',
        category: 'Network',
        icon: Globe,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Active',
      };
    case 'IstioReady':
      return {
        label: 'Istio Mesh',
        category: 'Network',
        icon: Layers,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Active',
      };
    case 'EtcdReady':
      return {
        label: 'etcd Quorum',
        category: 'Storage',
        icon: Database,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'QuorumReady',
      };
    case 'AddonsReady':
      return {
        label: 'Core Addons',
        category: 'Core Stack',
        icon: Package,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Configured',
      };
    case 'QuotaReady':
      return {
        label: 'Resource Quotas',
        category: 'Governance',
        icon: Gauge,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Enforced',
      };
    case 'RBACReady':
      return {
        label: 'Guest RBAC',
        category: 'Security',
        icon: Users,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Reconciled',
      };
    case 'KubeconfigGenerated':
      return {
        label: 'Kubeconfig',
        category: 'Security',
        icon: Terminal,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Generated',
      };
    case 'CapacityAvailable':
      return {
        label: 'Host Capacity',
        category: 'Compute',
        icon: HardDrive,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Allocated',
      };
    case 'DisasterRecoveryReady':
      return {
        label: 'Disaster Recovery',
        category: 'Backup & DR',
        icon: ShieldCheck,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Configured',
      };
    case 'CertificateReady':
      return {
        label: 'TLS Certificates',
        category: 'Security',
        icon: Lock,
        isNominal,
        isDegraded,
        displayReason: cond.reason || 'Issued',
      };
    case 'Sleeping':
      return {
        label: 'Power State',
        category: 'Lifecycle',
        icon: cond.status === 'True' ? Moon : Sun,
        isNominal: true,
        isDegraded: false,
        displayReason: cond.status === 'True' ? 'Sleeping' : 'Awake & Active',
      };
    default:
      return {
        label: cond.type.replace(/Ready$|Generated$|Configured$/, '') || cond.type,
        category: 'Subsystem',
        icon: Activity,
        isNominal,
        isDegraded,
        displayReason: cond.reason || cond.status,
      };
  }
}

interface Props {
  clusterName: string;
  currentUser?: UserSession | null;
}

export const ClusterDetail: React.FC<Props> = ({ clusterName, currentUser }) => {
  const [user, setUser] = useState<UserSession | null>(currentUser || null);
  const [cluster, setCluster] = useState<VirtualCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'workloads' | 'quota' | 'access' | 'apps' | 'dr' | 'yaml'>('telemetry');
  const [activeModal, setActiveModal] = useState<'kubeconfig' | 'upgrade' | 'delete' | 'quota' | 'sleep' | 'rbac' | 'install-app' | 'group' | 'istio' | 'gateway-api' | null>(null);
  const [kubeconfigInitialTab, setKubeconfigInitialTab] = useState<'admin' | 'oidc' | 'endpoint' | 'settings'>('admin');
  const [installAppTab, setInstallAppTab] = useState<'catalog' | 'direct' | 'add-app' | 'create-group'>('catalog');
  const [catalog, setCatalog] = useState<AppStoreCatalog | null>(null);
  const [inspectedApp, setInspectedApp] = useState<InstalledApp | null>(null);
  const [rollbackTargetApp, setRollbackTargetApp] = useState<InstalledApp | null>(null);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [syncingApps, setSyncingApps] = useState<boolean>(false);
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState<boolean>(false);
  const [actionsOpen, setActionsOpen] = useState<boolean>(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [selectedConditionType, setSelectedConditionType] = useState<string | null>(null);
  const [conditionViewMode, setConditionViewMode] = useState<'matrix' | 'table'>('matrix');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionsOpen(false);
      }
    };
    if (actionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionsOpen]);

  const openKubeconfigModal = (tab: 'admin' | 'oidc' | 'endpoint' | 'settings' = 'admin') => {
    setKubeconfigInitialTab(tab);
    setActiveModal('kubeconfig');
  };

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

  const fetchEvents = async () => {
    try {
      setEventsLoading(true);
      const res = await fetch(`/api/vclusters/${clusterName}/events`);
      const data = await res.json();
      if (data.success && data.events) {
        setEvents(data.events);
      }
    } catch (err) {
      console.error('Error fetching cluster events:', err);
    } finally {
      setEventsLoading(false);
    }
  };

  const fetchCatalog = async () => {
    try {
      const res = await fetch('/api/appstore');
      const data = await res.json();
      if (data.success && data.data) {
        setCatalog(data.data);
      }
    } catch (err) {
      console.error('Error fetching App Store catalog:', err);
    }
  };

  const openInstallModal = (tab: 'catalog' | 'direct' | 'add-app' | 'create-group' = 'catalog') => {
    setInstallAppTab(tab);
    setActiveModal('install-app');
  };

  const activeModalRef = useRef(activeModal);
  useEffect(() => {
    activeModalRef.current = activeModal;
  }, [activeModal]);

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
    fetchCluster();
    fetchCatalog();
    fetchEvents();
    const interval = setInterval(() => {
      if (!activeModalRef.current) {
        fetchCluster();
        fetchEvents();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [clusterName]);

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developers' || user?.role === 'developer';
  const isViewer = !isAdmin && !isDeveloper;
  const canManage = isAdmin || isDeveloper;

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
  const isSleeping = cluster.status.phase === 'Sleeping' || cluster.spec.paused || cluster.spec.lifecycle?.sleep;
  const k8sVer = cluster.status.virtualK8sVersion || cluster.spec.kubernetesVersion || 'N/A';
  const vclusterVer = cluster.status.vclusterVersion || cluster.spec.vclusterVersion || 'N/A';
  const clusterGroups =
    cluster.metadata?.clusterGroups && cluster.metadata.clusterGroups.length > 0
      ? cluster.metadata.clusterGroups
      : cluster.metadata?.clusterGroup
      ? [cluster.metadata.clusterGroup]
      : [];

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
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold font-mono text-white tracking-wide">{cluster.name}</h1>
              <StatusBadge phase={cluster.status.phase} />
              {cluster.metadata?.environment && (
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyber-800 text-slate-400 border border-cyber-700">
                  {cluster.metadata.environment}
                </span>
              )}
              {clusterGroups.map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                >
                  <Tag className="w-3 h-3" />
                  {g}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Namespace: <span className="text-slate-300">{cluster.namespace}</span></span>
              <span>•</span>
              <span>Engine: <span className="text-cyan-400">vCluster {vclusterVer}</span></span>
              <span>•</span>
              {canManage ? (
                <button
                  onClick={() => openKubeconfigModal('endpoint')}
                  className="hover:text-cyan-300 hover:underline flex items-center gap-1 text-slate-300"
                  title="Click to view/change API server endpoint"
                >
                  <Globe className="w-3 h-3 text-blue-400" />
                  Endpoint: <span className="text-slate-200">{cluster.metadata?.customEndpoint || cluster.status.endpoint || 'Internal'}</span>
                  {cluster.metadata?.customEndpoint && (
                    <span className="text-[10px] px-1 bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
                      custom
                    </span>
                  )}
                </button>
              ) : (
                <span className="flex items-center gap-1 text-slate-300">
                  <Globe className="w-3 h-3 text-blue-400" />
                  Endpoint: <span className="text-slate-200">{cluster.metadata?.customEndpoint || cluster.status.endpoint || 'Internal'}</span>
                  {cluster.metadata?.customEndpoint && (
                    <span className="text-[10px] px-1 bg-purple-500/20 text-purple-300 rounded border border-purple-500/30">
                      custom
                    </span>
                  )}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 relative">
          <button
            onClick={() => openKubeconfigModal('admin')}
            className="px-3.5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
          >
            <Terminal className="w-3.5 h-3.5" />
            Connect & Kubeconfig
          </button>

          {canManage && (
            <>
              <button
                onClick={() => setActiveModal('sleep')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all ${
                  isSleeping
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold shadow-glow-sm'
                    : 'bg-cyber-800 hover:bg-cyber-750 text-indigo-300 border border-indigo-500/30'
                }`}
                title={isSleeping ? 'Wake Up Virtual Cluster' : 'Put Virtual Cluster to Sleep'}
              >
                {isSleeping ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {isSleeping ? 'Wake Up' : 'Sleep'}
              </button>

              {/* Actions Dropdown */}
              <div className="relative" ref={actionsRef}>
                <button
                  type="button"
                  onClick={() => setActionsOpen(!actionsOpen)}
                  aria-expanded={actionsOpen}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl border flex items-center gap-1.5 transition-all ${
                    actionsOpen
                      ? 'bg-cyber-750 text-white border-cyan-500/60 shadow-glow-sm'
                      : 'bg-cyber-800 hover:bg-cyber-750 text-slate-200 border-cyber-700/80 hover:border-slate-500'
                  }`}
                  title="More Cluster Management Actions"
                >
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Actions</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${actionsOpen ? 'rotate-180 text-cyan-400' : ''}`} />
                </button>

                {actionsOpen && (
                  <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-cyber-950/95 backdrop-blur-2xl border border-cyber-700/80 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 divide-y divide-cyber-800/80">
                    {/* Control Plane & Distro */}
                    <div className="pb-1.5">
                      <span className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 block">Control Plane</span>
                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          setActiveModal('upgrade');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-cyber-900 rounded-xl transition-colors text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <ArrowUpCircle className="w-4 h-4 text-purple-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Upgrade Engine</div>
                            <div className="text-[10px] text-slate-400 font-mono">Distro & components</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono bg-purple-500/10 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                          {k8sVer}
                        </span>
                      </button>
                    </div>

                    {/* Ingress & Networking */}
                    <div className="py-1.5">
                      <span className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 block">Ingress & Gateways</span>
                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          setActiveModal('gateway-api');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-cyber-900 rounded-xl transition-colors text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Gateway API</div>
                            <div className="text-[10px] text-slate-400 font-mono">Envoy HTTPRoutes & TLS</div>
                          </div>
                        </div>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          cluster.spec.components?.gatewayAPI?.enabled
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : 'bg-cyber-800 text-slate-500 border-cyber-700'
                        }`}>
                          {cluster.spec.components?.gatewayAPI?.enabled ? 'Active' : 'Off'}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          setActiveModal('istio');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-cyber-900 rounded-xl transition-colors text-left mt-0.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Istio Service Mesh</div>
                            <div className="text-[10px] text-slate-400 font-mono">mTLS & VirtualService</div>
                          </div>
                        </div>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          cluster.spec.components?.istio?.enabled
                            ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                            : 'bg-cyber-800 text-slate-500 border-cyber-700'
                        }`}>
                          {cluster.spec.components?.istio?.enabled ? 'Active' : 'Off'}
                        </span>
                      </button>
                    </div>

                    {/* Governance & Policies */}
                    <div className="py-1.5">
                      <span className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 block">Governance & Policies</span>
                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          setActiveModal('group');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-cyber-900 rounded-xl transition-colors text-left"
                      >
                        <div className="flex items-center gap-2.5">
                          <FolderGit2 className="w-4 h-4 text-indigo-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Cluster Groups</div>
                            <div className="text-[10px] text-slate-400 font-mono">Labels & organization</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30">
                          {clusterGroups.length}
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          setActiveModal('quota');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-cyber-900 rounded-xl transition-colors text-left mt-0.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <Gauge className="w-4 h-4 text-teal-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Resource Quotas</div>
                            <div className="text-[10px] text-slate-400 font-mono">CPU, Memory & Storage</div>
                          </div>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setActionsOpen(false);
                          setActiveModal('rbac');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs text-slate-300 hover:text-white hover:bg-cyber-900 rounded-xl transition-colors text-left mt-0.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <Users className="w-4 h-4 text-blue-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Access & RBAC</div>
                            <div className="text-[10px] text-slate-400 font-mono">Ownership & bindings</div>
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Danger Zone (Admin Only) */}
                    {isAdmin && (
                      <div className="pt-1.5">
                        <button
                          onClick={() => {
                            setActionsOpen(false);
                            setActiveModal('delete');
                          }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 rounded-xl transition-colors text-left"
                        >
                          <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                          <div>
                            <div className="font-semibold">Teardown Cluster</div>
                            <div className="text-[10px] text-rose-300/70 font-mono">Permanently delete cluster</div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isAdmin && (
                <button
                  onClick={() => setActiveModal('delete')}
                  className="px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
                  title="Teardown Cluster (Admin Only)"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Teardown
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Developer Notice Banner */}
      {isDeveloper && user && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white flex items-center gap-2 font-mono">
                Developer Persona Active
                <span className="text-[10px] font-mono text-amber-400 bg-amber-950 px-2 py-0.5 rounded border border-amber-800 uppercase font-semibold">
                  Cluster Operations & App Deployment
                </span>
              </h4>
              <p className="text-slate-300 mt-0.5 font-mono text-[11px] leading-relaxed">
                Signed in as <strong className="text-white">{user.email || user.username}</strong>. You have permissions to configure quotas, RBAC, sleep/wake, deploy catalog applications, and run Disaster Recovery. Cluster teardown, global registries, baselines, and AI models are strictly reserved for administrators.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Viewer Notice Banner */}
      {isViewer && user && (
        <div className="bg-cyan-950/30 border border-cyan-500/30 rounded-2xl p-4 flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/20 text-cyan-400 rounded-xl shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-white flex items-center gap-2 font-mono">
                Viewer Persona Active
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 uppercase font-semibold">
                  Read-Only & Kubeconfig Access
                </span>
              </h4>
              <p className="text-slate-300 mt-0.5 font-mono text-[11px] leading-relaxed">
                Signed in as <strong className="text-white">{user.email || user.username}</strong>. You have read-only visibility into cluster state, workloads, and telemetry, and can retrieve kubeconfigs via "Connect & Kubeconfig". Resource mutations and administrative controls are reserved for administrators and developers.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sleeping Notification Banner */}
      {isSleeping && (
        <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl shrink-0">
              <Moon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                Virtual Cluster is in Sleep Mode
                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                  Compute Workloads Paused (0m CPU / 0Mi RAM)
                </span>
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Workloads and syncer pods are scaled to zero. Persistent volumes and backing etcd quorum are safely preserved.
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setActiveModal('sleep')}
              className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0"
            >
              <Sun className="w-3.5 h-3.5" />
              Wake Up Cluster
            </button>
          )}
        </div>
      )}

      {/* Syncing / Provisioning Banner with live event */}
      {cluster.status.phase === 'Provisioning' && (
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl shrink-0">
              <RefreshCw className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                Virtual Cluster Syncing & Provisioning In Progress
                <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                  Phase: Provisioning
                </span>
              </h4>
              <p className="text-xs text-slate-300 mt-0.5">
                {events.length > 0
                  ? `Latest operator event: [${events[0].reason}] ${events[0].message}`
                  : 'The operator is bootstrapping control plane components, reconciling guest RBAC, and waiting for health checks.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Cluster Meta & Endpoint Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
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
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Kubernetes API Level</span>
            {canManage && (
              <button
                onClick={() => setActiveModal('upgrade')}
                className="text-[10px] font-mono text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
                title="Upgrade Kubernetes or vCluster Engine"
              >
                <ArrowUpCircle className="w-3 h-3" />
                Upgrade
              </button>
            )}
          </div>
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

        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4 backdrop-blur-sm flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Cluster Grouping</span>
              {canManage && (
                <button
                  onClick={() => setActiveModal('group')}
                  className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
                >
                  <FolderGit2 className="w-3 h-3" />
                  Edit
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {clusterGroups.length > 0 ? (
                clusterGroups.map((g) => (
                  <span
                    key={g}
                    className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/25"
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {g}
                  </span>
                ))
              ) : (
                <p className="font-mono text-xs text-slate-500 italic">No group assigned</p>
              )}
            </div>
          </div>
          <span className="mt-2 text-[10px] text-slate-400 font-mono">
            {clusterGroups.length} active grouping{clusterGroups.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Nav Tabs */}
      <div className="flex border-b border-cyber-800 gap-6">
        {[
          { id: 'telemetry', label: 'Health & Telemetry', icon: Activity },
          { id: 'workloads', label: 'Pods & Metrics', icon: Cpu },
          { id: 'quota', label: 'Quotas & Policies', icon: Gauge },
          { id: 'access', label: 'Access & RBAC', icon: Users },
          { id: 'apps', label: 'Applications ', icon: Package },
          { id: 'dr', label: 'Disaster Recovery', icon: ShieldAlert },
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
                  {cluster.status.metrics?.cpuUsage || '0m'} ({cluster.status.metrics?.cpuPercent ?? 0}%)
                </span>
              </div>
              <MetricSparkline
                data={cluster.sparklineData?.cpu || [0, 0, 0, 0, 0]}
                color="cyan"
                height={60}
                unit="%"
                currentValue={cluster.status.metrics?.cpuPercent ?? 0}
              />
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-slate-300">Tenant Memory Consumption</span>
                <span className="font-mono text-xs text-purple-300">
                  {cluster.status.metrics?.memoryUsage || '0Mi'} ({cluster.status.metrics?.memPercent ?? 0}%)
                </span>
              </div>
              <MetricSparkline
                data={cluster.sparklineData?.memory || [0, 0, 0, 0, 0]}
                color="purple"
                height={60}
                unit="%"
                currentValue={cluster.status.metrics?.memPercent ?? 0}
              />
            </div>
          </div>

          {/* Opinionated Core Stack & App Entrypoint */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 shadow-glow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  Opinionated Core Stack & Application Entrypoint
                  <span className="text-[10px] font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800 font-bold">
                    vCluster Core
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  CoreDNS, Metrics-Server, and Ingress (Gateway API or Istio) with Cert-Manager TLS termination.
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    onClick={() => setActiveModal('gateway-api')}
                    className={`px-3 py-1.5 ${cluster.spec.components?.gatewayAPI?.enabled ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50' : 'bg-cyber-800 text-slate-300 border-cyber-700'} hover:bg-cyber-750 border text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Gateway API
                  </button>
                  <button
                    onClick={() => setActiveModal('istio')}
                    className={`px-3 py-1.5 ${cluster.spec.components?.istio?.enabled ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50' : 'bg-cyber-800 text-slate-300 border-cyber-700'} hover:bg-cyber-750 border text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Istio
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {/* CoreDNS */}
              <div className="p-3.5 bg-cyber-950/70 border border-cyber-800 rounded-xl space-y-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">DNS Resolver</span>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white">CoreDNS</span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono block">kube-dns.kube-system</span>
              </div>

              {/* Metrics Server */}
              <div className="p-3.5 bg-cyber-950/70 border border-cyber-800 rounded-xl space-y-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Cluster Telemetry</span>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white">Metrics Server</span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono block">metrics.k8s.io active</span>
              </div>

              {/* Ingress Gateway (Gateway API or Istio) */}
              <div className="p-3.5 bg-cyber-950/70 border border-cyber-800 rounded-xl space-y-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Ingress Entrypoint</span>
                <div className="flex items-center gap-2">
                  {cluster.spec.components?.gatewayAPI?.enabled ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-300">
                        Gateway API {cluster.spec.highAvailability && <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800 ml-1">HA (3x)</span>}
                      </span>
                    </>
                  ) : cluster.spec.components?.istio?.enabled ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-bold text-cyan-300">
                        Istio Ingressgateway {cluster.spec.highAvailability && <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800 ml-1">HA (3x)</span>}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-semibold text-slate-500">Not Configured</span>
                    </>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 font-mono block">
                  {cluster.spec.components?.gatewayAPI?.enabled
                    ? (cluster.spec.highAvailability ? '3 Gateways (HA) • Port 80 & 443' : '1 Gateway • Port 80 & 443')
                    : cluster.spec.components?.istio?.enabled
                    ? (cluster.spec.highAvailability ? '3 Gateways & 3 istiod • Port 80 & 443' : '1 Gateway & 1 istiod • Port 80 & 443')
                    : 'Disabled'}
                </span>
              </div>

              {/* Cert-Manager TLS */}
              <div className="p-3.5 bg-cyber-950/70 border border-cyber-800 rounded-xl space-y-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">TLS Certificate</span>
                <div className="flex items-center gap-2">
                  {cluster.spec.components?.gatewayAPI?.certificateIssuer || cluster.spec.components?.istio?.certificateIssuer ? (
                    <>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-white font-mono truncate">
                        {cluster.spec.components?.gatewayAPI?.certificateIssuer || cluster.spec.components?.istio?.certificateIssuer}
                      </span>
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-semibold text-slate-500">No Issuer Set</span>
                    </>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 font-mono block truncate">
                  {cluster.spec.components?.gatewayAPI?.certificateIssuer
                    ? `${cluster.spec.components.gatewayAPI.certificateIssuerKind || 'ClusterIssuer'} (Host)`
                    : cluster.spec.components?.istio?.certificateIssuer
                    ? `${cluster.spec.components.istio.certificateIssuerKind || 'ClusterIssuer'} (Host)`
                    : 'Unencrypted HTTP'}
                </span>
              </div>

              {/* Host Ingress & API Passthrough */}
              <div className="p-3.5 bg-cyber-950/70 border border-cyber-800 rounded-xl space-y-1">
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Host Routing</span>
                <div className="flex items-center gap-2">
                  {cluster.spec.components?.gatewayAPI?.hostRouting?.enabled ? (
                    <>
                      <Network className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-emerald-300">
                        Active (Gateway API)
                      </span>
                    </>
                  ) : cluster.spec.components?.istio?.hostRouting?.enabled ? (
                    <>
                      <Network className="w-4 h-4 text-cyan-400" />
                      <span className="text-xs font-bold text-cyan-300">
                        Active (Istio)
                      </span>
                    </>
                  ) : (
                    <>
                      <Network className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-semibold text-slate-500">Disabled</span>
                    </>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 font-mono block truncate" title={cluster.spec.components?.gatewayAPI?.hostRouting?.apiHost || cluster.spec.components?.gatewayAPI?.hostRouting?.defaultGateway || cluster.spec.components?.istio?.hostRouting?.apiHost || cluster.spec.components?.istio?.hostRouting?.defaultGateway || 'Host Entrypoint'}>
                  {cluster.spec.components?.gatewayAPI?.hostRouting?.enabled
                    ? (cluster.spec.components.gatewayAPI.hostRouting.apiHost || cluster.spec.components.gatewayAPI.hostRouting.defaultGateway || 'Envoy Gateway')
                    : cluster.spec.components?.istio?.hostRouting?.enabled
                    ? (cluster.spec.components.istio.hostRouting.apiHost || cluster.spec.components.istio.hostRouting.defaultGateway || 'Istio Gateway')
                    : 'Gateway Only'}
                </span>
              </div>
            </div>

            {/* Gateway API Live Link Banner */}
            {cluster.spec.components?.gatewayAPI?.enabled && (
              <div className="mt-3 pt-3 border-t border-cyber-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">Main Entrypoint HTTPRoute:</span>
                    <a
                      href={`https://${cluster.spec.components?.gatewayAPI?.hosts?.[0] || cluster.spec.customEndpoint || `${cluster.name}.local`}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-emerald-400 hover:text-emerald-300 underline flex items-center gap-1"
                    >
                      https://{cluster.spec.components?.gatewayAPI?.hosts?.[0] || cluster.spec.customEndpoint || `${cluster.name}.local`}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  {cluster.spec.components?.gatewayAPI?.hostRouting?.enabled && cluster.spec.components.gatewayAPI.hostRouting.apiHost && (
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-400">API Host:</span>
                      <span className="font-mono text-emerald-300">
                        https://{cluster.spec.components.gatewayAPI.hostRouting.apiHost}:443
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-500">
                    Host Routing: {cluster.spec.components?.gatewayAPI?.hostRouting?.enabled ? 'Active (Gateway API)' : 'Disabled'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    GatewayClass: {cluster.spec.components?.gatewayAPI?.gatewayClassName || 'eg'}
                  </span>
                </div>
              </div>
            )}

            {/* Istio Live Link Banner */}
            {cluster.spec.components?.istio?.enabled && (
              <div className="mt-3 pt-3 border-t border-cyber-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">Main Entrypoint VirtualService:</span>
                    <a
                      href={`https://${cluster.spec.components?.istio?.hosts?.[0] || cluster.spec.customEndpoint || `${cluster.name}.example.com`}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-cyan-400 hover:text-cyan-300 underline flex items-center gap-1"
                    >
                      https://{cluster.spec.components?.istio?.hosts?.[0] || cluster.spec.customEndpoint || `${cluster.name}.example.com`}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  {cluster.spec.components?.istio?.hostRouting?.enabled && cluster.spec.components.istio.hostRouting.apiHost && (
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-400">API Passthrough (SNI):</span>
                      <span className="font-mono text-cyan-300">
                        https://{cluster.spec.components.istio.hostRouting.apiHost}:443
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-500">
                    Host Routing: {cluster.spec.components?.istio?.hostRouting?.enabled ? 'Active (mTLS/SNI)' : 'Disabled'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    Service Mesh: {cluster.spec.components?.istio?.meshEnabled ? 'Active (mTLS auto-injection)' : 'Disabled (Gateway only)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Subsystem Reconciliation & Readiness Matrix */}
          {(() => {
            const conditions = cluster.status.conditions || [];
            const totalConditions = conditions.length;
            const passingConditions = conditions.filter((c) => {
              if (c.type === 'Sleeping') return true;
              return c.status === 'True';
            }).length;
            const isAllNominal = totalConditions > 0 && passingConditions === totalConditions;
            const selectedCond = conditions.find((c) => c.type === selectedConditionType);

            return (
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 backdrop-blur-sm">
                {/* Header HUD */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-white font-mono">
                          Reconciliation & Subsystem Readiness
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border flex items-center gap-1.5 ${
                            isAllNominal
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.15)]'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isAllNominal
                                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse'
                                : 'bg-amber-400'
                            }`}
                          />
                          {passingConditions}/{totalConditions} Subsystems Nominal
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Circuit Scanner & View Toggle */}
                  <div className="flex items-center gap-3 self-start sm:self-auto">
                    {/* Miniature Segmented Circuit Bar */}
                    {totalConditions > 0 && (
                      <div
                        className="hidden md:flex items-center gap-1 h-2 px-1.5 py-0.5 bg-cyber-950 rounded-full border border-cyber-800"
                        title={`${passingConditions} of ${totalConditions} subsystems passing`}
                      >
                        {conditions.map((c, i) => {
                          const meta = getConditionMeta(c);
                          return (
                            <div
                              key={c.type || i}
                              className={`w-2 h-1 rounded-full transition-all duration-300 ${
                                meta.isNominal
                                  ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]'
                                  : meta.isDegraded
                                  ? 'bg-rose-500 animate-pulse'
                                  : 'bg-amber-400'
                              }`}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-cyber-950 rounded-xl border border-cyber-800 p-0.5">
                      <button
                        type="button"
                        onClick={() => setConditionViewMode('matrix')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1.5 transition-all ${
                          conditionViewMode === 'matrix'
                            ? 'bg-cyber-800 text-cyan-300 shadow-sm border border-cyber-700 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Matrix Bento Grid View"
                      >
                        <Layers className="w-3 h-3" />
                        <span>Matrix</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConditionViewMode('table')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-mono flex items-center gap-1.5 transition-all ${
                          conditionViewMode === 'table'
                            ? 'bg-cyber-800 text-cyan-300 shadow-sm border border-cyber-700 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Detailed Timeline List View"
                      >
                        <Clock className="w-3 h-3" />
                        <span>Timeline</span>
                      </button>
                    </div>
                  </div>
                </div>

                {conditions.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 font-mono text-xs bg-cyber-950/40 rounded-xl border border-cyber-800/60">
                    No active reconciliation conditions reported by the operator.
                  </div>
                ) : conditionViewMode === 'matrix' ? (
                  <div className="space-y-3">
                    {/* 2026 Micro-Bento Matrix Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                      {conditions.map((cond) => {
                        const meta = getConditionMeta(cond);
                        const isSelected = selectedConditionType === cond.type;
                        const Icon = meta.icon;
                        return (
                          <button
                            key={cond.type}
                            type="button"
                            onClick={() => setSelectedConditionType(isSelected ? null : cond.type)}
                            className={`group relative p-3 rounded-xl border transition-all duration-200 text-left flex flex-col justify-between overflow-hidden ${
                              isSelected
                                ? 'bg-cyber-900 border-cyan-400 shadow-[0_0_16px_rgba(6,182,212,0.25)] ring-1 ring-cyan-500/50'
                                : meta.isNominal
                                ? 'bg-cyber-950/70 hover:bg-cyber-900/90 border-cyber-800/80 hover:border-cyan-500/40 hover:shadow-glow-sm'
                                : 'bg-amber-950/30 border-amber-500/50 hover:border-amber-400'
                            }`}
                          >
                            {/* Neon Hairline Edge */}
                            <div
                              className={`absolute top-0 left-0 right-0 h-[2px] transition-all duration-300 ${
                                isSelected
                                  ? 'bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 opacity-100'
                                  : meta.isNominal
                                  ? 'bg-emerald-500/30 group-hover:bg-emerald-400 group-hover:opacity-100 opacity-50'
                                  : 'bg-amber-400 opacity-100'
                              }`}
                            />

                            {/* Top Domain & Status Beacon */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 transition-all ${
                                    meta.isNominal
                                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                                      : meta.isDegraded
                                      ? 'bg-rose-400 animate-ping shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                                      : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                                  }`}
                                />
                                <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 group-hover:text-slate-300">
                                  {meta.category}
                                </span>
                              </div>
                              <Icon
                                className={`w-3.5 h-3.5 transition-colors ${
                                  isSelected ? 'text-cyan-400' : 'text-slate-400 group-hover:text-cyan-300'
                                }`}
                              />
                            </div>

                            {/* Subsystem Name & K8s Condition Type */}
                            <div className="mb-2.5">
                              <div className="text-xs font-bold text-white group-hover:text-cyan-200 transition-colors font-mono truncate">
                                {meta.label}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                                {cond.type}
                              </div>
                            </div>

                            {/* Status Pill & Transition Time */}
                            <div className="flex items-center justify-between pt-2 border-t border-cyber-800/60 text-[10px] font-mono">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                  meta.isNominal
                                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                    : meta.isDegraded
                                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                                    : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                }`}
                              >
                                {meta.displayReason}
                              </span>
                              <span className="text-slate-400 text-[10px]">
                                {new Date(cond.lastTransitionTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Telemetry Inspector Console */}
                    <div className="p-3.5 rounded-xl bg-cyber-950/90 border border-cyber-800/90 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      {selectedCond ? (
                        <>
                          <div className="flex items-start sm:items-center gap-3">
                            <div className="p-2 rounded-lg bg-cyber-900 border border-cyber-750 shrink-0">
                              {(() => {
                                const SIcon = getConditionMeta(selectedCond).icon;
                                return <SIcon className="w-4 h-4 text-cyan-400" />;
                              })()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold text-white">{selectedCond.type}</span>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyber-900 text-slate-300 border border-cyber-700">
                                  Reason: {selectedCond.reason}
                                </span>
                                <span className="text-[10px] font-mono text-emerald-400">
                                  ● Status: {selectedCond.status}
                                </span>
                              </div>
                              <p className="text-xs text-slate-300 mt-1 font-sans">
                                {selectedCond.message || 'Subsystem is reconciled and operating within specifications.'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto text-[11px] font-mono text-slate-400">
                            <span>
                              Transitioned: {new Date(selectedCond.lastTransitionTime).toLocaleTimeString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedConditionType(null)}
                              className="text-slate-400 hover:text-white p-1 hover:bg-cyber-800 rounded transition-colors"
                              title="Deselect"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2.5 text-slate-300">
                            <Sparkles className="w-4 h-4 text-cyber-accent shrink-0" />
                            <span>
                              <strong className="text-white">Active Reconciler Telemetry:</strong> All{' '}
                              {conditions.length} subsystems are monitored by the GitOps operator loop. Click any
                              capsule above to inspect diagnostic messages.
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 hidden md:inline shrink-0">
                            Live Control Loop Active
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Timeline List View */
                  <div className="space-y-2">
                    {conditions.map((cond) => {
                      const meta = getConditionMeta(cond);
                      const Icon = meta.icon;
                      return (
                        <div
                          key={cond.type}
                          className="flex items-center justify-between p-3 bg-cyber-950/70 border border-cyber-800/80 rounded-xl hover:bg-cyber-900/40 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-cyber-900 border border-cyber-800 text-slate-300">
                              <Icon className="w-3.5 h-3.5 text-cyan-400" />
                            </div>
                            <div>
                              <div className="font-mono text-xs font-bold text-white flex items-center gap-2">
                                {meta.label}
                                <span className="text-[10px] font-mono text-slate-400 font-normal">
                                  ({cond.type})
                                </span>
                                <span
                                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                                    meta.isNominal
                                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                  }`}
                                >
                                  {cond.reason}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">{cond.message}</p>
                            </div>
                          </div>
                          <div className="text-right text-[10px] font-mono text-slate-400">
                            <div>{new Date(cond.lastTransitionTime).toLocaleTimeString()}</div>
                            <span className={meta.isNominal ? 'text-emerald-400' : 'text-amber-400'}>
                              ● {cond.status}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Cluster Lifecycle & Operator Event Logs */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                Cluster Lifecycle & Operator Event Logs
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800 font-semibold">
                  {events.length > 0 ? `Live Stream (${events.length})` : 'Reconciliation Audit'}
                </span>
              </h3>
              <button
                onClick={fetchEvents}
                disabled={eventsLoading}
                className="text-xs font-mono text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                title="Refresh events"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${eventsLoading ? 'animate-spin text-cyan-400' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {(() => {
              const displayEvents = events.length > 0 ? events : (cluster.status.conditions || []).map((cond) => ({
                name: `${cluster.name}-${cond.type}`,
                type: (cond.status === 'False' && cond.type !== 'Sleeping' ? 'Warning' : 'Normal') as 'Normal' | 'Warning',
                reason: cond.reason || cond.type,
                message: cond.message || `${cond.type} reconciled to ${cond.status}`,
                count: 1,
                lastTimestamp: cond.lastTransitionTime,
                sourceComponent: 'virtualcluster-controller',
                involvedObject: {
                  kind: 'VirtualCluster',
                  name: cluster.name,
                  namespace: cluster.namespace,
                },
              }));

              if (displayEvents.length === 0) {
                return (
                  <div className="p-6 text-center text-slate-500 font-mono text-xs bg-cyber-950/40 rounded-xl border border-cyber-800/60">
                    No recent operator events recorded for this virtual cluster.
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-cyber-800 text-slate-400 text-[10px] uppercase">
                        <th className="pb-2 font-semibold">Type</th>
                        <th className="pb-2 font-semibold">Reason</th>
                        <th className="pb-2 font-semibold">Message</th>
                        <th className="pb-2 font-semibold">Involved Object</th>
                        <th className="pb-2 font-semibold">Component</th>
                        <th className="pb-2 font-semibold text-right">Age / Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyber-800/50 text-slate-300">
                      {displayEvents.map((ev, idx) => {
                        const isWarn = ev.type === 'Warning';
                        return (
                          <tr key={ev.name || idx} className="hover:bg-cyber-800/30 transition-colors">
                            <td className="py-2.5 pr-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isWarn
                                    ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                    : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                }`}
                              >
                                {isWarn ? <AlertTriangle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                                {ev.type}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">
                              {ev.reason}
                            </td>
                            <td className="py-2.5 pr-3 font-sans text-xs text-slate-300 max-w-md break-words">
                              {ev.message}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                              {ev.involvedObject ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyber-950 border border-cyber-800 text-slate-300">
                                  <span className="text-slate-500">{ev.involvedObject.kind || 'Resource'}/</span>
                                  <span className="text-white font-semibold truncate max-w-[150px]" title={ev.involvedObject.name}>
                                    {ev.involvedObject.name || cluster.name}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-slate-500">{cluster.name}</span>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap text-[11px]">
                              {ev.sourceComponent || ev.source?.component || 'vc-operator'}
                            </td>
                            <td className="py-2.5 text-right text-slate-400 whitespace-nowrap text-[10px]">
                              <div>{ev.lastTimestamp ? new Date(ev.lastTimestamp).toLocaleTimeString() : 'now'}</div>
                              {ev.count && ev.count > 1 && (
                                <div className="text-cyan-400 font-semibold">(x{ev.count})</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB CONTENT: Workloads & Pod Metrics (Grafana Replacement) */}
      {activeTab === 'workloads' && (
        <WorkloadMetricsView cluster={cluster} />
      )}

      {/* TAB CONTENT: Resource Quotas & Policies */}
      {activeTab === 'quota' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Header summary banner */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Gauge className="w-5 h-5 text-emerald-400" />
                Resource Quotas
              </h3>
              <span className="px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-mono text-[11px] font-semibold">
                Dual-Scope
              </span>
            </div>
            {canManage && (
              <button
                onClick={() => setActiveModal('quota')}
                className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0"
              >
                <Sliders className="w-3.5 h-3.5" />
                Adjust Quotas
              </button>
            )}
          </div>

          {/* 4 Core Gauge Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* CPU Requests */}
            {(() => {
              const used = cluster.status.quota?.used?.['requests.cpu'] || '0';
              const hard = cluster.status.quota?.hard?.['requests.cpu'] || cluster.spec.policies?.resourceQuota?.requestsCPU || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-cyan-400" />
                      CPU Requests
                    </span>
                    <span className="text-xs font-mono font-bold text-cyan-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-cyan-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Memory Requests */}
            {(() => {
              const used = cluster.status.quota?.used?.['requests.memory'] || '0';
              const hard = cluster.status.quota?.hard?.['requests.memory'] || cluster.spec.policies?.resourceQuota?.requestsMemory || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-purple-400" />
                      Memory Requests
                    </span>
                    <span className="text-xs font-mono font-bold text-purple-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-purple-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Storage Requests */}
            {(() => {
              const used = cluster.status.quota?.used?.['requests.storage'] || '0';
              const hard = cluster.status.quota?.hard?.['requests.storage'] || cluster.spec.policies?.resourceQuota?.requestsStorage || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <HardDrive className="w-4 h-4 text-amber-400" />
                      Storage Requests
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-amber-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Pods Count */}
            {(() => {
              const used = cluster.status.quota?.used?.['pods'] || cluster.status.quota?.used?.['count/pods'] || String(cluster.status.metrics?.podCount || 0);
              const hard = cluster.status.quota?.hard?.['pods'] || cluster.status.quota?.hard?.['count/pods'] || cluster.spec.policies?.resourceQuota?.pods || 'N/A';
              const pct = calculatePercent(used, hard);
              return (
                <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      Tenant Pods
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">{pct}%</span>
                  </div>
                  <div className="w-full bg-cyber-950 rounded-full h-2 overflow-hidden mb-3 border border-cyber-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between items-baseline font-mono text-xs">
                    <span className="text-slate-400 text-[11px]">Used: <strong className="text-white">{used}</strong></span>
                    <span className="text-slate-400 text-[11px]">Limit: <strong className="text-white">{hard}</strong></span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Detailed Itemized Quota Enforcement Table */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
            <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-cyan-400" />
              Itemized Resource Quotas (Live Synced)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-cyber-800 text-slate-400 text-[11px]">
                    <th className="pb-2 font-medium">Resource</th>
                    <th className="pb-2 font-medium">Current Usage</th>
                    <th className="pb-2 font-medium">Hard Limit</th>
                    <th className="pb-2 font-medium w-48">Utilization</th>
                    <th className="pb-2 font-medium">Enforcement Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyber-850">
                  {[
                    { key: 'requests.cpu', name: 'CPU Requests (requests.cpu)', scope: 'Compute' },
                    { key: 'limits.cpu', name: 'CPU Limits (limits.cpu)', scope: 'Compute' },
                    { key: 'requests.memory', name: 'Memory Requests (requests.memory)', scope: 'Memory' },
                    { key: 'limits.memory', name: 'Memory Limits (limits.memory)', scope: 'Memory' },
                    { key: 'requests.storage', name: 'Storage Requests (requests.storage)', scope: 'Storage' },
                    { key: 'pods', altKey: 'count/pods', name: 'Pods (count/pods)', scope: 'Objects' },
                    { key: 'services', name: 'Services (services)', scope: 'Network' },
                    { key: 'services.loadbalancers', name: 'Load Balancers (services.loadbalancers)', scope: 'Network' },
                    { key: 'services.nodeports', name: 'Node Ports (services.nodeports)', scope: 'Network' },
                    { key: 'persistentvolumeclaims', name: 'PVCs (persistentvolumeclaims)', scope: 'Storage' },
                    { key: 'configmaps', name: 'ConfigMaps (configmaps)', scope: 'Objects' },
                    { key: 'secrets', name: 'Secrets (secrets)', scope: 'Security' },
                  ].map((item) => {
                    const used = cluster.status.quota?.used?.[item.key] || (item.altKey ? cluster.status.quota?.used?.[item.altKey] : undefined) || '0';
                    const hard = cluster.status.quota?.hard?.[item.key] || (item.altKey ? cluster.status.quota?.hard?.[item.altKey] : undefined) || 'Unlimited';
                    const pct = hard !== 'Unlimited' ? calculatePercent(used, hard) : 0;
                    return (
                      <tr key={item.key} className="hover:bg-cyber-850/50 transition-colors">
                        <td className="py-2.5 font-semibold text-slate-200">{item.name}</td>
                        <td className="py-2.5 text-cyan-300">{used}</td>
                        <td className="py-2.5 text-slate-300 font-bold">{hard}</td>
                        <td className="py-2.5">
                          {hard !== 'Unlimited' ? (
                            <div className="flex items-center gap-2">
                              <div className="w-24 bg-cyber-950 rounded-full h-1.5 overflow-hidden border border-cyber-800">
                                <div
                                  className={`h-full rounded-full ${
                                    pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                ></div>
                              </div>
                              <span className="text-[10px] text-slate-400">{pct}%</span>
                            </div>
                          ) : (
                            <span className="text-slate-500 text-[11px]">No limit</span>
                          )}
                        </td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded bg-cyber-950 border border-cyber-800 text-[10px] text-slate-400">
                            {item.scope}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* LimitRange Policy Card */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                LimitRange Defaults
              </h4>
              <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                Namespace: default & host
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT REQUEST CPU</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultRequestCPU || '100m'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT REQUEST MEM</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultRequestMemory || '128Mi'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT LIMIT CPU</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultCPU || '500m'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">DEFAULT LIMIT MEM</span>
                <span className="text-white font-bold">{cluster.spec.policies?.limitRange?.defaultMemory || '512Mi'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MAX CONTAINER CPU</span>
                <span className="text-cyan-300 font-bold">{cluster.spec.policies?.limitRange?.maxCPU || '4'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MAX CONTAINER MEM</span>
                <span className="text-purple-300 font-bold">{cluster.spec.policies?.limitRange?.maxMemory || '8Gi'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MIN CONTAINER CPU</span>
                <span className="text-cyan-300 font-bold">{cluster.spec.policies?.limitRange?.minCPU || '10m'}</span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MIN CONTAINER MEM</span>
                <span className="text-purple-300 font-bold">{cluster.spec.policies?.limitRange?.minMemory || '32Mi'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Access & RBAC Delegation */}
      {activeTab === 'access' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Top Access Overview Header */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-cyan-400" />
                  Access & RBAC Delegation
                </h3>
              </div>
              {canManage && (
                <button
                  onClick={() => setActiveModal('rbac')}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all self-start sm:self-auto shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  Edit Access & RBAC
                </button>
              )}
            </div>

            {/* Access Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              {/* Primary Owner */}
              <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-cyan-400">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="text-xs font-semibold text-slate-200">Primary Owner</span>
                </div>
                <div className="mt-2 font-mono text-sm text-white font-bold break-all">
                  {cluster.metadata?.owner || 'Platform User'}
                </div>
              </div>

              {/* Authorized Groups */}
              <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-purple-400">
                  <Users className="w-4 h-4" />
                  <span className="text-xs font-semibold text-slate-200">Authorized Groups (OIDC/SSO)</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cluster.metadata?.allowedGroups && cluster.metadata.allowedGroups.length > 0 ? (
                    cluster.metadata.allowedGroups.map((grp, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 font-mono text-xs"
                      >
                        {grp}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500 text-xs italic">No groups delegated (Admin-only)</span>
                  )}
                </div>
              </div>

              {/* Authorized User Emails */}
              <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2 text-blue-400">
                  <Mail className="w-4 h-4" />
                  <span className="text-xs font-semibold text-slate-200">Authorized User Emails</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cluster.metadata?.allowedEmails && cluster.metadata.allowedEmails.length > 0 ? (
                    cluster.metadata.allowedEmails.map((email, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-xs"
                      >
                        {email}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500 text-xs italic">No individual users delegated</span>
                  )}
                </div>
              </div>
            </div>

            {/* OIDC Authentication & API Server Endpoint Configuration Card */}
            <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-5 mt-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-cyber-850">
                <div>
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-purple-400" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      OIDC Authentication & Endpoint
                    </h4>
                    {cluster.metadata?.oidc?.enabled ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[10px]">
                        Active (PKCE)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono text-[10px]">
                        Disabled / Not Configured
                      </span>
                    )}
                    {cluster.metadata?.oidc?.source === 'group' ? (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono text-[10px]">
                        Group: {cluster.metadata.oidc.inheritedFrom || 'assigned'}
                      </span>
                    ) : cluster.metadata?.oidc?.source === 'global' ? (
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-[10px]">
                        Global Policy
                      </span>
                    ) : null}
                    {(cluster.metadata?.customCaCert || cluster.metadata?.oidc?.caCertificate || cluster.metadata?.customCaSecret || cluster.metadata?.oidc?.caSecretName) && (
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-cyan-400" />
                        Custom CA Trusted
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openKubeconfigModal('endpoint')}
                    className="px-3 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-200 text-xs font-medium rounded-lg border border-cyber-700 flex items-center gap-1.5 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5 text-blue-400" />
                    Edit Endpoint
                  </button>
                  <button
                    onClick={() => openKubeconfigModal('settings')}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    Configure OIDC
                  </button>
                  <button
                    onClick={() => openKubeconfigModal('oidc')}
                    className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    OIDC Kubeconfig
                  </button>
                </div>
              </div>

              {/* Endpoint & OIDC Spec Summary Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mt-4 text-xs font-mono">
                {/* Active Endpoint */}
                <div className="bg-cyber-900/80 border border-cyber-800 p-3 rounded-lg">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Globe className="w-3 h-3 text-blue-400" />
                    API Endpoint
                  </span>
                  <div className="text-slate-200 truncate font-bold" title={cluster.metadata?.customEndpoint || cluster.status.endpoint}>
                    {cluster.metadata?.customEndpoint || cluster.status.endpoint || 'ClusterIP'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {cluster.metadata?.customEndpoint ? 'Custom Ingress / VirtualService' : 'Host Cluster Internal Service'}
                  </div>
                </div>

                {/* Issuer URL */}
                <div className="bg-cyber-900/80 border border-cyber-800 p-3 rounded-lg">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Lock className="w-3 h-3 text-purple-400" />
                    IdP Issuer
                  </span>
                  <div className="text-slate-200 truncate font-bold" title={cluster.metadata?.oidc?.issuerUrl || 'Not configured'}>
                    {cluster.metadata?.oidc?.issuerUrl || 'Not configured'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Client ID: {cluster.metadata?.oidc?.clientId || 'N/A'}
                  </div>
                </div>

                {/* Username Claim */}
                <div className="bg-cyber-900/80 border border-cyber-800 p-3 rounded-lg">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Mail className="w-3 h-3 text-cyan-400" />
                    Username Claim
                  </span>
                  <div className="text-cyan-300 font-bold">
                    {cluster.metadata?.oidc?.usernameClaim || 'email'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Matches Authorized Emails
                  </div>
                </div>

                {/* Groups Claim */}
                <div className="bg-cyber-900/80 border border-cyber-800 p-3 rounded-lg">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <Users className="w-3 h-3 text-purple-400" />
                    Groups Claim
                  </span>
                  <div className="text-purple-300 font-bold">
                    {cluster.metadata?.oidc?.groupsClaim || 'groups'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Matches Authorized Groups
                  </div>
                </div>

                {/* Custom CA Status */}
                <div className="bg-cyber-900/80 border border-cyber-800 p-3 rounded-lg">
                  <span className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                    <ShieldCheck className={`w-3 h-3 ${(cluster.metadata?.customCaCert || cluster.metadata?.oidc?.caCertificate || cluster.metadata?.customCaSecret || cluster.metadata?.oidc?.caSecretName) ? 'text-cyan-400' : 'text-slate-500'}`} />
                    TLS CA Trust
                  </span>
                  {(cluster.metadata?.customCaCert || cluster.metadata?.oidc?.caCertificate || cluster.metadata?.customCaSecret || cluster.metadata?.oidc?.caSecretName) ? (
                    <>
                      <div className="text-cyan-300 font-bold truncate">
                        {cluster.metadata?.customCaSecret || cluster.metadata?.oidc?.caSecretName || 'Custom CA'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 truncate">
                        /etc/ssl/custom-ca
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-slate-400 font-bold">Standard</div>
                      <div className="text-[10px] text-slate-500 mt-1">
                        System Cert Pool
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Documentation Notice for RBAC Matrix */}
          <div className="bg-cyber-950 border border-cyber-800/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
                <BookOpen className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Role-Based Access Control (RBAC) Matrix</h4>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                  The Persona Permissions Matrix and authorization policies have moved to Documentation.
                </p>
              </div>
            </div>
            <a
              href="/docs#rbac"
              className="px-3 py-1.5 rounded-lg bg-cyber-900 hover:bg-cyber-850 border border-cyber-700 hover:border-cyan-500/50 text-cyan-400 hover:text-cyan-300 text-xs font-mono font-medium inline-flex items-center gap-1.5 transition-all shrink-0"
            >
              <span>View Docs Matrix</span>
              <span>&rarr;</span>
            </a>
          </div>

          {/* Kubernetes Metadata Storage Details */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6">
            <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              GitOps Metadata
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">METADATA ANNOTATION</span>
                <span className="text-cyan-300 font-bold block">vops.gitops.io/owner</span>
                <span className="text-[11px] text-slate-300 mt-1 block truncate">
                  {cluster.metadata?.owner || 'Platform User'}
                </span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">METADATA ANNOTATION</span>
                <span className="text-purple-300 font-bold block">vops.gitops.io/allowed-groups</span>
                <span className="text-[11px] text-slate-300 mt-1 block truncate">
                  {(cluster.metadata?.allowedGroups || []).join(', ') || '(none)'}
                </span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">METADATA ANNOTATION</span>
                <span className="text-blue-300 font-bold block">vops.gitops.io/allowed-emails</span>
                <span className="text-[11px] text-slate-300 mt-1 block truncate">
                  {(cluster.metadata?.allowedEmails || []).join(', ') || '(none)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: Applications & App Store  */}
      {activeTab === 'apps' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Top Header Card */}
          <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-cyan-400" />
                  Applications
                </h3>
              </div>

              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openInstallModal('catalog')}
                    className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Package className="w-4 h-4" />
                    <span>Deploy App / Pack</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openInstallModal('direct')}
                    className="px-3.5 py-2 bg-cyber-800 hover:bg-cyber-750 text-cyan-300 font-semibold text-xs rounded-xl border border-cyan-500/30 flex items-center gap-1.5 transition-all"
                  >
                    <Terminal className="w-4 h-4" />
                    <span>+ Deploy Custom App</span>
                  </button>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openInstallModal('add-app')}
                        className="px-3.5 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-200 font-semibold text-xs rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        <span>+ Add to Store</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openInstallModal('create-group')}
                        className="px-3.5 py-2 bg-purple-950/70 hover:bg-purple-900/70 text-purple-300 font-semibold text-xs rounded-xl border border-purple-800/80 flex items-center gap-1.5 transition-all"
                      >
                        <Layers className="w-4 h-4" />
                        <span>+ Create App Group</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      setSyncingApps(true);
                      try {
                        const res = await fetch(`/api/vclusters/${cluster.name}/apps`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'sync' }),
                        });
                        const data = await res.json();
                        if (!res.ok || !data.success) {
                          alert(data.error || 'Failed to sync applications');
                          return;
                        }
                        await fetchCluster();
                      } catch (err: any) {
                        alert(err.message || 'Error syncing applications');
                      } finally {
                        setSyncingApps(false);
                      }
                    }}
                    disabled={syncingApps}
                    className="px-3.5 py-2 bg-cyber-900 hover:bg-cyber-850 text-cyan-400 font-semibold text-xs rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-all disabled:opacity-50"
                    title="Reconcile and deploy all registered applications into the guest virtual cluster"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingApps ? 'animate-spin' : ''}`} />
                    <span>{syncingApps ? 'Syncing...' : 'Sync All Workloads'}</span>
                  </button>
                </div>
              ) : (
                <span className="px-3 py-1.5 rounded-xl bg-cyber-950 text-slate-400 border border-cyber-800 font-mono text-xs">
                  Read-Only Application View
                </span>
              )}
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 font-mono text-xs">
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">TOTAL APPS INSTALLED</span>
                <span className="text-white font-bold text-base">
                  {cluster.metadata?.installedApps?.length || 0}
                </span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">HELM RELEASES</span>
                <span className="text-cyan-300 font-bold text-base">
                  {(cluster.metadata?.installedApps || []).filter((a) => a.helm).length}
                </span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">MANIFEST </span>
                <span className="text-emerald-300 font-bold text-base">
                  {(cluster.metadata?.installedApps || []).filter((a) => a.manifests).length}
                </span>
              </div>
              <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                <span className="text-[10px] text-slate-500 block mb-1">CATALOG REGISTRY</span>
                <a
                  href="/apps"
                  className="text-purple-400 hover:text-purple-300 flex items-center gap-1 mt-0.5"
                >
                  <span>Open App Store</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          {/* Installed Applications List */}
          {(!cluster.metadata?.installedApps || cluster.metadata.installedApps.length === 0) ? (
            <div className="bg-cyber-900/50 border border-cyber-800 rounded-3xl p-8 sm:p-10 text-center space-y-6">
              <div className="max-w-md mx-auto">
                <Package className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h4 className="text-base font-bold text-white">No Applications Deployed</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Deploy Helm charts or Kubernetes manifests to this cluster.
                </p>
              </div>

              {/* 3 Quick Action Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto text-left">
                <div
                  onClick={() => openInstallModal('direct')}
                  className="p-4 rounded-2xl bg-cyber-950 border border-cyber-800 hover:border-cyan-500/50 hover:bg-cyber-900 transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="p-2.5 w-fit rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mb-3 group-hover:scale-105 transition-transform">
                      <Terminal className="w-5 h-5" />
                    </div>
                    <h5 className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
                      Deploy Workload
                    </h5>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Deploy a Helm chart or YAML manifest directly.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-cyan-400 flex items-center gap-1 mt-4 group-hover:translate-x-0.5 transition-transform">
                    Deploy &rarr;
                  </span>
                </div>

                <div
                  onClick={() => openInstallModal('add-app')}
                  className="p-4 rounded-2xl bg-cyber-950 border border-cyber-800 hover:border-blue-500/50 hover:bg-cyber-900 transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="p-2.5 w-fit rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 mb-3 group-hover:scale-105 transition-transform">
                      <Plus className="w-5 h-5" />
                    </div>
                    <h5 className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                      Add to Catalog
                    </h5>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Register an application into the App Store catalog.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-blue-400 flex items-center gap-1 mt-4 group-hover:translate-x-0.5 transition-transform">
                    Add &rarr;
                  </span>
                </div>

                <div
                  onClick={() => openInstallModal('create-group')}
                  className="p-4 rounded-2xl bg-cyber-950 border border-cyber-800 hover:border-purple-500/50 hover:bg-cyber-900 transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    <div className="p-2.5 w-fit rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 mb-3 group-hover:scale-105 transition-transform">
                      <Layers className="w-5 h-5" />
                    </div>
                    <h5 className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors">
                      Create App Group
                    </h5>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Bundle multiple services into a reusable application pack.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-purple-400 flex items-center gap-1 mt-4 group-hover:translate-x-0.5 transition-transform">
                    Create &rarr;
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {cluster.metadata.installedApps.map((app) => (
                <div
                  key={app.appId}
                  className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="p-3 bg-cyber-950 border border-cyber-750 rounded-2xl text-cyan-400 shrink-0">
                      <Box className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{app.name}</h4>
                        {app.version && (
                          <span className="text-[10px] font-mono text-slate-400 bg-cyber-950 px-2 py-0.5 rounded border border-cyber-800">
                            v{app.version}
                          </span>
                        )}
                        {app.category && (
                          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
                            {app.category}
                          </span>
                        )}
                        {app.status === 'Failed' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            <span>Failed</span>
                          </span>
                        ) : app.status === 'Installing' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Installing</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{app.status || 'Installed'}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs font-mono text-slate-400">
                        {app.helm && (
                          <span>
                            Release: <strong className="text-slate-200">{app.helm.releaseName}</strong> ({app.helm.namespace || 'default'})
                          </span>
                        )}
                        {app.manifests && (
                          <span className="text-emerald-400">
                            ✓ Manifests Reconciled
                          </span>
                        )}
                        {app.installedAt && (
                          <span className="text-slate-500 text-[11px]">
                            Installed: {new Date(app.installedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      {app.error && (
                        <div className="mt-2.5 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[11px] font-mono text-rose-400 max-w-2xl">
                          <div className="font-semibold flex items-center gap-1.5 mb-1 text-rose-300">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Deployment Error:</span>
                          </div>
                          <p className="text-[10px] text-rose-300/90 whitespace-pre-wrap">{app.error}</p>
                        </div>
                      )}

                      {app.resourcesCreated && app.resourcesCreated.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[10px] text-slate-500 font-mono">Live Resources:</span>
                          {app.resourcesCreated.map((res, idx) => (
                            <span key={idx} className="text-[10px] font-mono bg-cyber-950 text-cyan-300 px-2 py-0.5 rounded border border-cyber-800">
                              {res.kind}/{res.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                    {canManage && (
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/vclusters/${cluster.name}/apps`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                apps: [{ appId: app.appId, customValues: app.customValues }],
                              }),
                            });
                            const data = await res.json();
                            if (!res.ok || !data.success) {
                              alert(data.error || 'Failed to sync application');
                              return;
                            }
                            await fetchCluster();
                          } catch (err: any) {
                            alert(err.message || 'Error syncing application');
                          }
                        }}
                        className="px-2.5 py-1.5 bg-cyber-950 hover:bg-cyber-800 text-cyan-400 border border-cyber-800 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
                        title="Redeploy and materialize in guest cluster"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Sync</span>
                      </button>
                    )}

                    {canManage && (
                      <button
                        onClick={() => {
                          setRollbackTargetApp(app);
                          setIsRollbackModalOpen(true);
                        }}
                        className="px-2.5 py-1.5 bg-cyber-950 hover:bg-cyber-800 text-amber-400 border border-cyber-800 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
                        title="Rollback or redeploy to a specific GitOps version"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Rollback</span>
                      </button>
                    )}

                    <button
                      onClick={() => setInspectedApp(app)}
                      className="px-3 py-1.5 bg-cyber-950 hover:bg-cyber-800 text-slate-200 border border-cyber-800 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
                    >
                      <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Config & Values</span>
                    </button>

                    {canManage && (
                      <button
                        onClick={async () => {
                          if (
                            confirm(
                              `Are you sure you want to uninstall and remove ${app.name} from ${cluster.name}?`
                            )
                          ) {
                            try {
                              const res = await fetch(
                                `/api/vclusters/${cluster.name}/apps/${app.appId}`,
                                { method: 'DELETE' }
                              );
                              const data = await res.json();
                              if (!res.ok || !data.success) {
                                alert(data.error || 'Failed to uninstall app');
                                return;
                              }
                              await fetchCluster();
                            } catch (err: any) {
                              alert(err.message || 'Error uninstalling app');
                            }
                          }
                        }}
                        className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold rounded-xl flex items-center gap-1 transition-all"
                        title="Uninstall Application"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Uninstall</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* App Store Catalog & Quick-Deploy Suites Section */}
          {canManage && (
            <div className="bg-cyber-900/60 border border-cyber-800 rounded-3xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    App Catalog
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openInstallModal('add-app')}
                    className="text-xs font-mono text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    + Add App
                  </button>
                  <span className="text-slate-700">|</span>
                  <button
                    type="button"
                    onClick={() => openInstallModal('create-group')}
                    className="text-xs font-mono text-purple-400 hover:underline flex items-center gap-1"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    + Create Group
                  </button>
                </div>
              </div>

              {(!catalog || (catalog.apps.length === 0 && catalog.groups.length === 0)) ? (
                <div className="p-6 rounded-2xl border border-dashed border-cyber-800 bg-cyber-950/40 text-center space-y-3">
                  <Package className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    No applications or groups in catalog.
                  </p>
                  <div className="flex justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openInstallModal('add-app')}
                      className="px-3.5 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-cyan-400 border border-cyan-500/30 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      + Add Application to Store
                    </button>
                    <button
                      type="button"
                      onClick={() => openInstallModal('create-group')}
                      className="px-3.5 py-1.5 bg-purple-950/70 hover:bg-purple-900/70 text-purple-300 border border-purple-800 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      + Create App Group
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Available Groups */}
                  {catalog.groups.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {catalog.groups.map((grp) => (
                        <div
                          key={grp.id}
                          className="p-4 rounded-2xl bg-cyber-950 border border-cyber-800 hover:border-purple-500/40 transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <h5 className="text-xs font-bold text-white">{grp.name}</h5>
                              <span className="text-[10px] font-mono text-purple-400 bg-purple-950 px-2 py-0.5 rounded border border-purple-800">
                                {grp.appIds.length} Apps
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{grp.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              openInstallModal('catalog');
                            }}
                            className="mt-3 w-full py-1.5 bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs font-mono font-semibold rounded-lg border border-purple-500/30 flex items-center justify-center gap-1 transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Deploy Suite
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Available Individual Apps */}
                  {catalog.apps.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {catalog.apps.map((app) => {
                        const isAlreadyInstalled = (cluster.metadata?.installedApps || []).some(
                          (a) => a.appId === app.id
                        );
                        return (
                          <div
                            key={app.id}
                            className="p-3.5 rounded-2xl bg-cyber-950 border border-cyber-800 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-2 bg-cyber-900 border border-cyber-800 rounded-xl text-cyan-400 shrink-0">
                                <Box className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h5 className="text-xs font-bold text-white truncate">{app.name}</h5>
                                <span className="text-[10px] font-mono text-slate-400">v{app.version}</span>
                              </div>
                            </div>
                            {isAlreadyInstalled ? (
                              <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Installed
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  openInstallModal('catalog');
                                }}
                                className="px-2.5 py-1 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs font-mono font-semibold rounded-lg border border-cyan-500/30 flex items-center gap-1 shrink-0 transition-all"
                              >
                                <Download className="w-3 h-3" />
                                Deploy
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}



      {/* TAB CONTENT: Disaster Recovery */}
      {activeTab === 'dr' && (
        <DisasterRecoveryTab cluster={cluster} onRefresh={fetchCluster} isAdmin={canManage} />
      )}

      {/* TAB CONTENT: Effective vCluster 0.36 YAML */}
      {activeTab === 'yaml' && (
        <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 font-mono text-xs animate-in fade-in duration-150">
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-300 font-semibold">Compiled vcluster.yaml ({vclusterVer} Unified Schema)</span>
            <span className="text-slate-500 text-[10px]">Stored in host ConfigMap: {cluster.name}-config</span>
          </div>
          <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-4 text-slate-300 overflow-x-auto whitespace-pre leading-relaxed">
{cluster.compiledConfig || `# vcluster.yaml is being reconciled by vc-operator for ${cluster.name}-config...`}
          </pre>
        </div>
      )}

      {/* Modals */}
      <KubeconfigModal
        cluster={cluster}
        isOpen={activeModal === 'kubeconfig'}
        initialTab={kubeconfigInitialTab}
        onClose={() => setActiveModal(null)}
        onClusterUpdated={fetchCluster}
        isAdmin={canManage}
      />

      {canManage && (
        <>
          <UpgradeModal
            cluster={cluster}
            isOpen={activeModal === 'upgrade'}
            onClose={() => setActiveModal(null)}
            onUpgradeSuccess={(updated) => setCluster(updated)}
          />

          {isAdmin && (
            <DeleteModal
              cluster={cluster}
              isOpen={activeModal === 'delete'}
              onClose={() => setActiveModal(null)}
              onDeleteSuccess={() => {
                window.location.href = '/';
              }}
            />
          )}

          <QuotaModal
            cluster={cluster}
            isOpen={activeModal === 'quota'}
            onClose={() => setActiveModal(null)}
            onUpdateSuccess={(updated) => setCluster(updated)}
          />

          <SleepModal
            cluster={cluster}
            isOpen={activeModal === 'sleep'}
            onClose={() => setActiveModal(null)}
            onSuccess={(updated) => setCluster(updated)}
          />

          <RbacModal
            cluster={cluster}
            isOpen={activeModal === 'rbac'}
            onClose={() => setActiveModal(null)}
            onSuccess={(updated) => setCluster(updated)}
          />

          <ClusterGroupModal
            cluster={cluster}
            isOpen={activeModal === 'group'}
            onClose={() => setActiveModal(null)}
            onSuccess={(updated) => {
              if (updated) {
                setCluster(updated);
              } else {
                fetchCluster();
              }
            }}
          />

          <InstallAppModal
            cluster={cluster}
            isOpen={activeModal === 'install-app'}
            initialTab={installAppTab}
            isAdmin={isAdmin}
            onClose={() => setActiveModal(null)}
            onSuccess={async () => {
              await fetchCluster();
              await fetchCatalog();
            }}
          />

          {activeModal === 'istio' && (
            <IstioModal
              cluster={cluster}
              isOpen={activeModal === 'istio'}
              onClose={() => setActiveModal(null)}
              onSuccess={(updated) => {
                setCluster(updated);
                fetchCluster();
              }}
            />
          )}

          {activeModal === 'gateway-api' && (
            <GatewayAPIModal
              cluster={cluster}
              isOpen={activeModal === 'gateway-api'}
              onClose={() => setActiveModal(null)}
              onSuccess={(updated) => {
                setCluster(updated);
                fetchCluster();
              }}
            />
          )}
        </>
      )}

      {/* View Inspected App Values / Manifests Modal */}
      {inspectedApp && (
        <ModalPortal>
          <div className="fixed inset-0 z-[9999] bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
            <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] my-auto">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Box className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    {inspectedApp.name}
                    {inspectedApp.version && (
                      <span className="text-xs font-mono text-slate-400 font-normal">
                        v{inspectedApp.version}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Active Deployment Specifications on {cluster.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectedApp(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 flex-1 pr-1">
              {inspectedApp.helm && (
                <div>
                  <span className="text-xs font-mono font-bold text-cyan-400 block mb-1">
                    Helm Release Values ({inspectedApp.helm.releaseName})
                  </span>
                  <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre leading-relaxed max-h-60">
                    {inspectedApp.customValues || inspectedApp.helm.values || '# Default chart values'}
                  </pre>
                </div>
              )}

              {inspectedApp.manifests && (
                <div>
                  <span className="text-xs font-mono font-bold text-emerald-400 block mb-1">
                    Kubernetes YAML Manifests
                  </span>
                  <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre leading-relaxed max-h-60">
                    {inspectedApp.manifests}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-cyber-800 flex justify-end">
              <button
                onClick={() => setInspectedApp(null)}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
      )}

      {/* App Rollback Modal */}
      {rollbackTargetApp && cluster && (
        <AppRollbackModal
          clusterName={cluster.name}
          app={rollbackTargetApp}
          isOpen={isRollbackModalOpen && Boolean(rollbackTargetApp)}
          onClose={() => {
            setIsRollbackModalOpen(false);
            setRollbackTargetApp(null);
          }}
          onRollbackComplete={async () => {
            await fetchCluster();
          }}
        />
      )}
    </div>
  );
};
