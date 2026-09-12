import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Layers,
  Server,
  Globe,
  Database,
  Gauge,
  Package,
  HardDrive,
  Terminal,
  Search,
  Copy,
  Check,
  Lock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Sliders,
  Cpu,
  Zap,
  RefreshCw,
  Users,
  UserCheck,
  Eye,
  Shield,
  Activity,
  BookOpen,
  ArrowUpRight,
  Info,
  Code2,
  Network,
  Radio,
} from 'lucide-react';
import type { UserSession } from '../lib/types';

interface Props {
  currentUser?: UserSession | null;
}

interface RbacRow {
  op: string;
  category: string;
  description: string;
  admin: boolean;
  dev: boolean;
  viewer: boolean;
}

const RBAC_DATA: RbacRow[] = [
  {
    op: 'View Cluster Topology & Status',
    category: 'Telemetry & Observability',
    description: 'Inspect live fleet status, pod inventory, events, resource metrics, and ingress endpoints.',
    admin: true,
    dev: true,
    viewer: true,
  },
  {
    op: 'NetFlow Live Telemetry & Topology Stream',
    category: 'Network Observability',
    description: 'Stream real-time eBPF socket events, inspect packet flow paths, and analyze cross-namespace traffic matrices.',
    admin: true,
    dev: true,
    viewer: true,
  },
  {
    op: 'Execute Active Reachability Probes',
    category: 'Network Observability',
    description: 'Trigger synthetic HTTP/TCP probes from the Operations Center to test workload reachability and latency.',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Download / View Kubeconfig',
    category: 'Access & Connectivity',
    description: 'Download direct guest kubeconfig or copy interactive CLI connection commands.',
    admin: true,
    dev: true,
    viewer: true,
  },
  {
    op: 'Deploy Applications from Catalog',
    category: 'App Store & Catalog',
    description: 'Deploy, configure, and manage Helm-based application stacks (databases, ingress, observability).',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Dynamic Quota & Limit Adjustments',
    category: 'Resource Governance',
    description: 'Dynamically scale CPU/Memory limits, storage quotas, and container LimitRange policies.',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Sleep / Wake Operations',
    category: 'Cost Optimization',
    description: 'Hibernate active cluster compute to 0 replicas to eliminate idle host cluster compute costs.',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Kubernetes Distro Engine Upgrades',
    category: 'Cluster Lifecycle',
    description: 'Perform rolling zero-downtime upgrades of the vCluster syncer engine and guest Kubernetes version.',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Update RBAC & Access Delegation',
    category: 'Identity & Access',
    description: 'Grant or revoke cluster-level permissions for specific enterprise IdP groups and user emails.',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Disaster Recovery Snapshots & Restore',
    category: 'Disaster Recovery',
    description: 'Trigger on-demand etcd snapshots, configure schedules, and perform point-in-time restores.',
    admin: true,
    dev: true,
    viewer: false,
  },
  {
    op: 'Teardown / Delete Virtual Cluster',
    category: 'Destructive Lifecycle',
    description: 'Permanently decommission virtual cluster resources and clean up underlying persistent volumes.',
    admin: true,
    dev: false,
    viewer: false,
  },
  {
    op: 'Manage Registries, Baselines & AI',
    category: 'Platform Administration',
    description: 'Configure corporate OCI registries, cluster baselines, global OIDC policies, and Gemma 3 AI copilot.',
    admin: true,
    dev: false,
    viewer: false,
  },
];

export const DocsView: React.FC<Props> = ({ currentUser }) => {
  const [activeTab, setActiveTab] = useState<string>('rbac');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedSnippets, setCopiedSnippets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        setActiveTab(hash);
        const element = document.getElementById(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const switchSection = (sectionId: string) => {
    setActiveTab(sectionId);
    window.history.replaceState(null, '', `#${sectionId}`);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippets((prev) => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopiedSnippets((prev) => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const filteredRbac = RBAC_DATA.filter((row) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      row.op.toLowerCase().includes(q) ||
      row.category.toLowerCase().includes(q) ||
      row.description.toLowerCase().includes(q)
    );
  });

  const navItems = [
    { id: 'rbac', label: 'RBAC Matrix', icon: ShieldCheck, badge: 'Matrix' },
    { id: 'architecture', label: 'Architecture', icon: Layers },
    { id: 'lifecycle', label: 'Cluster Lifecycle', icon: Server },
    { id: 'networking', label: 'Networking & Gateways', icon: Globe },
    { id: 'netflow', label: 'NetFlow & Topology', icon: Network, badge: 'eBPF' },
    { id: 'dr', label: 'Disaster Recovery', icon: Database },
    { id: 'capacity', label: 'Capacity Engine', icon: Gauge },
    { id: 'apps', label: 'App Store', icon: Package },
    { id: 'airgap', label: 'Air-Gap & Security', icon: HardDrive },
    { id: 'cli', label: 'CLI & API Quickstart', icon: Terminal },
  ];

  return (
    <div className="space-y-8 pb-16">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-cyber-900/80 border border-cyber-700/80 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-cyan-500/10 via-blue-600/5 to-transparent rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono font-medium">
              <BookOpen className="w-3.5 h-3.5" />
              <span>vCOp Documentation & Reference</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              vCluster Operations Center
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl">
              Enterprise documentation for virtual cluster provisioning, multi-tenant RBAC policies,
              isolated networking, zero-downtime lifecycle management, and air-gapped operations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href="#rbac"
              onClick={() => switchSection('rbac')}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-2 transition-all font-mono"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>View RBAC Matrix</span>
            </a>
            <a
              href="/"
              className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-200 border border-cyber-700 rounded-xl text-xs font-medium font-mono flex items-center gap-2 transition-colors"
            >
              <ArrowUpRight className="w-4 h-4 text-cyan-400" />
              <span>Fleet Dashboard</span>
            </a>
          </div>
        </div>

        {/* Quick Search & Pill Navigation */}
        <div className="mt-8 pt-6 border-t border-cyber-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documentation, roles, operations, or commands..."
              className="w-full pl-10 pr-4 py-2 bg-cyber-950/80 border border-cyber-700/80 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 font-mono"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 lg:pb-0 font-mono text-xs">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => switchSection(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-800/60 border border-transparent'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Grid: Sticky Sidebar + Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sticky Desktop Navigation Rail */}
        <aside className="hidden lg:block lg:col-span-3 space-y-4">
          <div className="sticky top-24 space-y-3 bg-cyber-900/60 border border-cyber-800/80 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider px-2 font-semibold flex items-center justify-between">
              <span>Table of Contents</span>
              <span className="text-[10px] text-cyan-400">10 Topics</span>
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => switchSection(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-mono transition-all text-left cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-500/15 to-blue-500/10 text-cyan-300 border border-cyan-500/30 font-semibold'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-800/40 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="pt-4 mt-4 border-t border-cyber-800/80 px-2 space-y-2">
              <div className="text-[11px] font-mono text-slate-400">Current Session</div>
              <div className="flex items-center justify-between text-xs font-mono bg-cyber-950 p-2 rounded-lg border border-cyber-800">
                <span className="text-slate-300 truncate max-w-[110px]">
                  {currentUser?.username || 'Guest'}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                    currentUser?.role === 'admin'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                      : currentUser?.role === 'developers' || currentUser?.role === 'developer'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  }`}
                >
                  {currentUser?.role || 'Viewer'}
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* Content Stream */}
        <div className="lg:col-span-9 space-y-12 min-w-0">
          {/* SECTION 1: Role-Based Access Control (RBAC) Matrix */}
          <section id="rbac" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 shadow-sm">
                  <ShieldCheck className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                    Role-Based Access Control (RBAC) Matrix
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Enforced multi-tenant personas and operation permission matrix across UI & API boundaries
                  </p>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                Enforced in Middleware & Webhooks
              </span>
            </div>

            {/* Persona Breakdown Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Platform Admin */}
              <div className="bg-cyber-900/90 border border-purple-500/30 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
                    Platform Admin
                  </span>
                  <Shield className="w-4 h-4 text-purple-400" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1">Central Infrastructure Team</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Full unrestricted control across host Kubernetes nodes, operator reconcilers, global sizing tiers, OIDC policies, and cluster destruction.
                </p>
                <div className="text-[11px] font-mono text-slate-300 space-y-1 bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                  <div className="text-purple-300 font-semibold mb-1">Key Privileges:</div>
                  <div>• Permanent cluster teardown</div>
                  <div>• Version & Baseline registry</div>
                  <div>• Host capacity bypass</div>
                  <div>• Global AI Copilot model tuning</div>
                </div>
              </div>

              {/* Developer Persona */}
              <div className="bg-cyber-900/90 border border-amber-500/30 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Developer Persona
                  </span>
                  <UserCheck className="w-4 h-4 text-amber-400" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1">Engineering & Product Teams</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Self-service autonomy to provision virtual clusters, adjust quotas, deploy App Store workloads, trigger backups, and perform engine upgrades.
                </p>
                <div className="text-[11px] font-mono text-slate-300 space-y-1 bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                  <div className="text-amber-300 font-semibold mb-1">Guarded Autonomy:</div>
                  <div>• 1-Click Cluster Provisioning</div>
                  <div>• Sleep / Wake cost saving</div>
                  <div>• DR snapshotting & rollback</div>
                  <div><span className="text-rose-400 font-semibold">✗ Cannot delete clusters</span></div>
                </div>
              </div>

              {/* Viewer Persona */}
              <div className="bg-cyber-900/90 border border-cyan-500/30 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                    Viewer Persona
                  </span>
                  <Eye className="w-4 h-4 text-cyan-400" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1">QA, Security & Stakeholders</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">
                  Read-only visibility into fleet health, real-time workload telemetry, audit logs, and kubeconfig retrieval for debugging and inspection.
                </p>
                <div className="text-[11px] font-mono text-slate-300 space-y-1 bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                  <div className="text-cyan-300 font-semibold mb-1">Observability Only:</div>
                  <div>• Fleet & Pod telemetry</div>
                  <div>• Sparklines & metrics</div>
                  <div>• Kubeconfig inspection</div>
                  <div><span className="text-rose-400 font-semibold">✗ All mutations blocked</span></div>
                </div>
              </div>
            </div>

            {/* The Consolidated RBAC Matrix Table */}
            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono">
                  <Lock className="w-4 h-4 text-cyan-400" />
                  Operation & Persona Entitlement Matrix
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Showing {filteredRbac.length} of {RBAC_DATA.length} operations
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-cyber-800 text-slate-400">
                      <th className="pb-3 font-medium">Action / Operation</th>
                      <th className="pb-3 font-medium hidden md:table-cell">Category</th>
                      <th className="pb-3 font-medium text-purple-400">Platform Admin</th>
                      <th className="pb-3 font-medium text-amber-400">Developer Persona</th>
                      <th className="pb-3 font-medium text-cyan-400">Viewer Persona</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyber-800/40">
                    {filteredRbac.map((row, idx) => (
                      <tr key={idx} className="hover:bg-cyber-800/30 transition-colors">
                        <td className="py-3 font-sans">
                          <div className="font-semibold text-slate-200">{row.op}</div>
                          <div className="text-[11px] text-slate-400 font-normal mt-0.5 max-w-sm">
                            {row.description}
                          </div>
                        </td>
                        <td className="py-3 hidden md:table-cell">
                          <span className="px-2 py-0.5 rounded bg-cyber-950 border border-cyber-800 text-[10px] text-slate-400">
                            {row.category}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Allowed</span>
                          </span>
                        </td>
                        <td className="py-3">
                          {row.dev ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Allowed</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-rose-400 bg-rose-500/10 px-2 py-1 rounded-md border border-rose-500/20">
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Restricted</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          {row.viewer ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/20">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Allowed</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-rose-400 bg-rose-500/10 px-2 py-1 rounded-md border border-rose-500/20">
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Restricted</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Security Enforcement Mechanics Callout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-2">
                <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Cluster Deletion Protection Rule</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Virtual cluster deletion (<code className="text-cyan-300 bg-cyber-900 px-1 py-0.5 rounded">DELETE /api/vclusters/:name</code>) is
                  strictly reserved for Platform Administrators. Developers attempting teardown receive an immediate
                  <code className="text-rose-400 bg-cyber-900 px-1 py-0.5 rounded ml-1">403 Forbidden</code> response and an audit security event is logged.
                </p>
              </div>

              <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-2">
                <div className="flex items-center gap-2 text-purple-400 font-mono text-xs font-bold">
                  <Users className="w-4 h-4" />
                  <span>Enterprise OIDC & GitOps Group Claims</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Enterprise SSO users authenticate via OIDC PKCE. The operator dynamically maps IdP groups to personas using annotations:
                  <code className="text-purple-300 bg-cyber-900 px-1 py-0.5 rounded ml-1">vops.gitops.io/allowed-groups</code> and
                  <code className="text-cyan-300 bg-cyber-900 px-1 py-0.5 rounded ml-1">vops.gitops.io/owner</code>.
                </p>
              </div>
            </div>
          </section>

          {/* SECTION 2: Architecture & Overview */}
          <section id="architecture" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-300 shadow-sm">
                  <Layers className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Architecture & Operator Engine
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    High-performance controller-runtime operator coupled with Astro SSR Operations Center
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                vCOp is an enterprise-grade Virtual Cluster Management Platform and Internal Developer Platform (IDP). It provisions
                and operates multi-tenant virtual clusters using <strong>vCluster OSS v0.36</strong>, high-availability 3-node etcd,
                intra-cluster CoreDNS, isolated metrics-servers, and automatic Istio ingress gateway reconciliation.
              </p>

              {/* Architecture Diagram Code Block */}
              <div className="relative bg-cyber-950 p-4 rounded-xl border border-cyber-800 font-mono text-[11px] text-cyan-300 overflow-x-auto">
                <pre>{`┌────────────────────────────────────────────────────────┐
│               Operations Center UI (Astro SSR)         │
│   - Dark-mode Cybernetic Glassmorphism Aesthetic       │
│   - 1-Click Provisioning Wizard & Fleet Dashboard      │
│   - Instant Kubeconfig & Live Workload Telemetry       │
└───────────────────────────┬────────────────────────────┘
                            │ REST / CRD Mutations
                            ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             Kubernetes Host Cluster (Control Plane)                      │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    vCOp Kubernetes Operator (Controller-Runtime)                   │  │
│  │   - Custom Resource: VirtualCluster (vops.gitops.io/v1alpha1)                      │  │
│  │   - Admission Webhook: Safe Minor Version Upgrades & Schema Validation             │  │
│  │   - Finalizer (vops.gitops.io/finalizer): Graceful Teardown & Retention Cleanup    │  │
│  └──────────────────────────────────────┬─────────────────────────────────────────────┘  │
│                                         │ Reconciles StatefulSets, Deployments, Secrets  │
│                                         ▼                                                │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                   Tenant Virtual Cluster (vCluster OSS v0.36)                      │  │
│  │   - High Availability: 3-Node Dedicated Quorum etcd (Port 2379 / 2380)             │  │
│  │   - Virtual Kubernetes Syncer: Pod, Ingress, Secret & CRD synchronization          │  │
│  │   - Isolated Add-ons: CoreDNS intra-cluster DNS + Metrics-Server for HPA           │  │
│  │   - Ingress Entrypoint: Istio IngressGateway (Port 80 -> 443 TLS Redirect)         │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘`}</pre>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1">
                  <div className="text-cyan-400 font-bold text-xs font-mono">1. Zero External DB</div>
                  <p className="text-[11px] text-slate-400">
                    All state resides inside native Kubernetes CustomResources, ConfigMaps, and Secrets.
                  </p>
                </div>
                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1">
                  <div className="text-purple-400 font-bold text-xs font-mono">2. 3-Node HA etcd</div>
                  <p className="text-[11px] text-slate-400">
                    Dedicated StatefulSet with automated headless peer discovery and quorum health gating.
                  </p>
                </div>
                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1">
                  <div className="text-emerald-400 font-bold text-xs font-mono">3. GitOps Native</div>
                  <p className="text-[11px] text-slate-400">
                    Declarative <code className="text-slate-300 font-mono">VirtualCluster</code> CRs designed for ArgoCD and Flux with zero drift fighting.
                  </p>
                </div>
              </div>

              {/* Dual Cluster Architecture Card */}
              <div className="mt-4 pt-4 border-t border-cyber-800 space-y-3">
                <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs font-bold">
                  <Server className="w-4 h-4" />
                  <span>Dual Deployment Models: Virtual Clusters vs Namespaced Clusters</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  vCOp v1.5 unified multi-tenancy under the generic concept of <strong>Clusters</strong>. Users and platform engineers can choose between two deployment models based on operational complexity and isolation requirements:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-2">
                    <div className="text-cyan-400 font-bold text-xs font-mono flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Virtual Cluster (vCluster)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Spins up an isolated virtual control plane with its own API server, syncer, and dedicated 1- or 3-node HA etcd store. Ideal for multi-version testing, independent CRD lifecycles, and complete control plane isolation.
                    </p>
                    <div className="text-[10px] font-mono text-slate-400 space-y-0.5 pt-1 border-t border-cyber-850">
                      <div>• <strong>Control Plane:</strong> Dedicated K8s API server</div>
                      <div>• <strong>Storage:</strong> Dedicated HA etcd quorum</div>
                      <div>• <strong>Use Case:</strong> Complex apps, cluster-scoped CRDs, multi-version testing</div>
                    </div>
                  </div>

                  <div className="bg-cyber-950 p-4 rounded-xl border border-purple-800/60 space-y-2">
                    <div className="text-purple-400 font-bold text-xs font-mono flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5" />
                      <span>Namespaced Cluster (Host)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Deploys directly into one or more host namespaces with identical governance capabilities: multi-namespace ResourceQuotas, LimitRanges, scoped ServiceAccount Kubeconfig, and workload sleep/wake—with <strong>zero</strong> syncer or etcd overhead.
                    </p>
                    <div className="text-[10px] font-mono text-slate-400 space-y-0.5 pt-1 border-t border-cyber-850">
                      <div>• <strong>Control Plane:</strong> Shared Host Kubernetes API</div>
                      <div>• <strong>Storage:</strong> Host native storage</div>
                      <div>• <strong>Use Case:</strong> Microservices, lightweight apps, cost-optimized multi-tenancy</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 3: Virtual Cluster Lifecycle */}
          <section id="lifecycle" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shadow-sm">
                  <Server className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Cluster Lifecycle & Day-2 Operations
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Provisioning wizard, sleep/wake hibernation, dynamic quotas, and rolling engine upgrades
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs font-bold">
                  <Zap className="w-4 h-4" />
                  <span>Cost-Saving Sleep & Wake Hibernation</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Developers can sleep non-production clusters over nights or weekends. The operator scales workloads to 0 while
                  preserving all disk volumes, CRDs, and configurations. Waking the cluster restores all pods within seconds.
                </p>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 font-mono text-[11px] text-slate-300">
                  <span className="text-slate-500 block mb-1">PATCH API COMMAND</span>
                  <code>curl -X PATCH /api/vclusters/dev-team/sleep</code>
                </div>
              </div>

              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold">
                  <RefreshCw className="w-4 h-4" />
                  <span>Rolling Engine & Distro Upgrades</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Perform zero-downtime rolling upgrades of the Kubernetes API server and vCluster syncer engine.
                  Pre-flight admission webhooks ensure safe minor version transitions and automatically take etcd backup snapshots.
                </p>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 font-mono text-[11px] text-slate-300">
                  <span className="text-slate-500 block mb-1">SUPPORTED DISTROS</span>
                  <span className="text-emerald-300">vCluster OSS v0.36 • K8s v1.30.x, v1.31.x, v1.32.x</span>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 4: Networking & Ingress Gateways */}
          <section id="networking" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shadow-sm">
                  <Globe className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Networking & Ingress: Gateway API & Istio
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Unified host ingress multiplexing with zero /etc/hosts changes, BackendTLSPolicy API routing, and dual-stack entrypoints
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {/* Unified Host Ingress Card */}
              <div className="bg-cyber-900/90 border border-cyan-500/30 rounded-2xl p-6 space-y-5 shadow-lg shadow-cyan-950/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse"></span>
                    <h3 className="text-base font-bold text-white tracking-tight">
                      Unified Host Ingress Architecture (Zero-Friction Dynamic Multiplexer)
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-lg border border-cyan-700/60 self-start sm:self-auto">
                    Host Envoy Gateway @ 172.18.255.200
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  vCOp decouples host-level edge infrastructure from virtual cluster runtime ingress. A dedicated host Envoy Gateway
                  (<code className="text-cyan-300">envoy-gateway-system/eg</code>) on a single LoadBalancer/MetalLB IP terminates edge traffic,
                  dynamically multiplexing both control plane API traffic and application traffic without requiring manual host modifications:
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                  <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center gap-2 text-cyan-400 font-bold">
                      <Zap className="w-4 h-4 text-cyan-400" />
                      <span>Zero /etc/hosts Churn</span>
                    </div>
                    <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                      Developers configure one static IP in <code className="text-slate-300">/etc/hosts</code>:
                      <code className="block mt-1 text-[10px] text-cyan-300 bg-cyber-900 px-2 py-1 rounded border border-cyber-800">
                        172.18.255.200 &lt;name&gt;.local api.&lt;name&gt;.local
                      </code>
                      Switching between Gateway API and Istio requires zero DNS or host changes.
                    </p>
                  </div>

                  <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center gap-2 text-purple-400 font-bold">
                      <Shield className="w-4 h-4 text-purple-400" />
                      <span>BackendTLSPolicy API Routing</span>
                    </div>
                    <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                      API requests to <code className="text-slate-300">api.&lt;name&gt;.local</code> proxy through host Envoy directly to the vCluster syncer (<code className="text-slate-300">svc/&lt;name&gt;:443</code>).
                      A synced CA ConfigMap and BackendTLSPolicy ensure encrypted upstream verification.
                    </p>
                  </div>

                  <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold">
                      <RefreshCw className="w-4 h-4 text-emerald-400" />
                      <span>Dynamic Edge Multiplexing</span>
                    </div>
                    <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                      The host <code className="text-slate-300">HTTPRoute/&lt;name&gt;-route</code> automatically points to either the Gateway API syncer service
                      (<code className="text-slate-300">gateway-proxy-x-gateway-system-x-*</code>) or the Istio syncer service
                      (<code className="text-slate-300">istio-ingressgateway-x-istio-system-x-*</code>).
                    </p>
                  </div>
                </div>

                {/* Architecture Pipeline Callout */}
                <div className="bg-cyber-950/80 border border-cyber-800 p-4 rounded-xl text-xs space-y-2">
                  <span className="font-mono text-slate-300 font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    Edge Redirection & Zero Proxy Loops:
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Edge HTTP port 80 traffic is intercepted at the host level by <code className="text-slate-300">HTTPRoute/&lt;name&gt;-redirect</code>, which returns an immediate HTTP 301 <code className="text-cyan-300">RequestRedirect</code> to HTTPS 443. In-guest ingress proxies (Envoy Gateway-Proxy and Istio Ingressgateway) serve plain HTTP on their internal port 80 behind the decrypted host edge, completely eliminating internal redirect loops.
                  </p>
                </div>
              </div>

              {/* Ingress Provider Cards Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Gateway API Details Card */}
                <div className="bg-cyber-900/90 border border-blue-500/30 rounded-2xl p-6 space-y-4 shadow-lg shadow-blue-950/10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                      Option 1: Kubernetes Gateway API (Envoy Gateway)
                    </h3>
                    <span className="text-[10px] font-mono text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-800">
                      gateway.networking.k8s.io/v1
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Modern cloud-native ingress using official SIG-Network Gateway API CRDs. Powered by in-cluster Envoy Gateway-Proxy with zero sidecar overhead:
                  </p>

                  <div className="space-y-2.5 text-xs font-mono">
                    <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                      <span className="text-blue-400 font-bold block">In-Guest CRDs & GatewayClass</span>
                      <p className="text-slate-400 font-sans text-[11px]">
                        Installs <code className="text-slate-300">GatewayClass/eg</code>, <code className="text-slate-300">Gateway/eg</code>, and <code className="text-slate-300">HTTPRoute/main-entrypoint</code> in <code className="text-slate-300">gateway-system</code>.
                      </p>
                    </div>
                    <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                      <span className="text-cyan-400 font-bold block">HA & Standard Replica Scaling</span>
                      <p className="text-slate-400 font-sans text-[11px]">
                        Provisions <strong>3 Envoy proxy replicas</strong> in HA mode (<code className="text-slate-300">highAvailability: true</code> or <code className="text-slate-300">ha</code> preset); 1 replica in standard mode.
                      </p>
                    </div>
                    <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                      <span className="text-emerald-400 font-bold block">Decoupled Lifecycle Teardown</span>
                      <p className="text-slate-400 font-sans text-[11px]">
                        Disabling Gateway API cleanly tears down guest deployments, services, and CRDs without disrupting the host API server route.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Istio Details Card */}
                <div className="bg-cyber-900/90 border border-cyan-500/30 rounded-2xl p-6 space-y-4 shadow-lg shadow-cyan-950/10">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                      Option 2: Istio Service Mesh & Ingress Gateway
                    </h3>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                      istio.io/v1beta1
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Full-featured service mesh and ingress gateway stack powered by in-cluster <code className="text-cyan-300">istiod</code> and <code className="text-cyan-300">istio-ingressgateway</code>:
                  </p>

                  <div className="space-y-2.5 text-xs font-mono">
                    <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                      <span className="text-cyan-400 font-bold block">Fail-Closed Cert-Manager Validation</span>
                      <p className="text-slate-400 font-sans text-[11px]">
                        Verifies host <code className="text-slate-300">ClusterIssuer</code> exists before provisioning and mirrors certificates to <code className="text-slate-300">istio-system</code>.
                      </p>
                    </div>
                    <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                      <span className="text-purple-400 font-bold block">HA & Standard Replica Scaling</span>
                      <p className="text-slate-400 font-sans text-[11px]">
                        Provisions <strong>3 istiod & 3 ingress gateway replicas</strong> in HA mode; 1 replica each in standard mode.
                      </p>
                    </div>
                    <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 space-y-1">
                      <span className="text-amber-400 font-bold block">Optional Sidecar Service Mesh</span>
                      <p className="text-slate-400 font-sans text-[11px]">
                        Mesh disabled by default (<code className="text-slate-300">meshEnabled: false</code>) for lightweight operation; easily enabled for zero-trust mTLS.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Comparison Table */}
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
                <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  Ingress Stack Feature Comparison
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-cyber-800 text-slate-400 text-[11px]">
                        <th className="pb-2.5 font-semibold">Capability</th>
                        <th className="pb-2.5 font-semibold text-blue-400">Kubernetes Gateway API</th>
                        <th className="pb-2.5 font-semibold text-cyan-400">Istio Service Mesh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyber-800/60 text-slate-300 text-[11px]">
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-white">API Specification</td>
                        <td className="py-2.5 text-blue-300">gateway.networking.k8s.io (SIG-Network)</td>
                        <td className="py-2.5 text-cyan-300">networking.istio.io (Istio Project)</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-white">Memory Footprint</td>
                        <td className="py-2.5 text-emerald-400 font-semibold">Ultra-Light (~60MB RAM)</td>
                        <td className="py-2.5 text-amber-400">Moderate (~350MB RAM)</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-white">In-Guest Control Plane</td>
                        <td className="py-2.5 text-slate-300">None (Host Envoy Gateway managed)</td>
                        <td className="py-2.5 text-slate-300">istiod discovery daemon</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-white">HA Replicas (High Availability)</td>
                        <td className="py-2.5 text-slate-300">3x Envoy Gateway-Proxy</td>
                        <td className="py-2.5 text-slate-300">3x istiod + 3x ingressgateway</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-white">Service Mesh & mTLS Sidecars</td>
                        <td className="py-2.5 text-slate-400">Not supported (Ingress only)</td>
                        <td className="py-2.5 text-emerald-400">Supported (meshEnabled: true)</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-sans font-medium text-white">Recommended For</td>
                        <td className="py-2.5 text-blue-300 font-sans">Standard declarative routing, microservices, low resource usage</td>
                        <td className="py-2.5 text-cyan-300 font-sans">Complex traffic management, zero-trust mTLS, canary rollouts</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Live Verification & CLI Snippets */}
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    Live CLI Verification & Seamless Switching Snippets
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400">Run from host terminal</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Curl API Verification */}
                  <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-purple-400 font-semibold">1. Test VirtualCluster API (via BackendTLSPolicy):</span>
                      <button
                        onClick={() => copyToClipboard('test-api', 'curl -k https://api.vc-dev.local/version')}
                        className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                      >
                        {copiedSnippets['test-api'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        <span>{copiedSnippets['test-api'] ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <code className="text-cyan-300 block bg-cyber-900 p-2 rounded-lg border border-cyber-800 font-mono text-[11px]">
                      curl -k https://api.vc-dev.local/version
                    </code>
                  </div>

                  {/* Curl HTTP Redirect Verification */}
                  <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-emerald-400 font-semibold">2. Test Port 80 HTTP-to-HTTPS 301 Redirect:</span>
                      <button
                        onClick={() => copyToClipboard('test-redirect', 'curl -I http://vc-dev.local/')}
                        className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                      >
                        {copiedSnippets['test-redirect'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        <span>{copiedSnippets['test-redirect'] ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <code className="text-cyan-300 block bg-cyber-900 p-2 rounded-lg border border-cyber-800 font-mono text-[11px]">
                      curl -I http://vc-dev.local/
                    </code>
                  </div>

                  {/* Curl App Root Verification */}
                  <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-cyan-400 font-semibold">3. Test Application Route (HTTPS 443):</span>
                      <button
                        onClick={() => copyToClipboard('test-app', 'curl -k https://vc-dev.local/')}
                        className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                      >
                        {copiedSnippets['test-app'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        <span>{copiedSnippets['test-app'] ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <code className="text-cyan-300 block bg-cyber-900 p-2 rounded-lg border border-cyber-800 font-mono text-[11px]">
                      curl -k https://vc-dev.local/
                    </code>
                  </div>

                  {/* Patch Ingress Switch */}
                  <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-blue-400 font-semibold">4. Toggle Ingress Provider via Kubectl:</span>
                      <button
                        onClick={() => copyToClipboard('toggle-ingress', 'kubectl patch vc vc-dev -n vc-dev --type=\'merge\' -p \'{"spec":{"components":{"gatewayAPI":{"enabled":true},"istio":{"enabled":false}}}}\'')}
                        className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                      >
                        {copiedSnippets['toggle-ingress'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-slate-400" />}
                        <span>{copiedSnippets['toggle-ingress'] ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <code className="text-cyan-300 block bg-cyber-900 p-2 rounded-lg border border-cyber-800 font-mono text-[11px] truncate">
                      kubectl patch vc vc-dev -n vc-dev --type='merge' -p '&#123;"spec":&#123;"components":&#123;"gatewayAPI":&#123;"enabled":true&#125;,"istio":&#123;"enabled":false&#125;&#125;&#125;&#125;'
                    </code>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 5: NetFlow & Endpoint Topology Observability */}
          <section id="netflow" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shadow-sm">
                  <Network className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                    NetFlow & Endpoint Topology Observability
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Real-time eBPF socket tracing, active reachability probes, and interactive multi-tier topology graph
                  </p>
                </div>
              </div>
              <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                Live Telemetry & Probing (/netflow)
              </span>
            </div>

            {/* Overview & Core Engine Card */}
            <div className="bg-cyber-900/90 border border-cyan-500/30 rounded-2xl p-6 space-y-5 shadow-lg shadow-cyan-950/10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-cyan-400 animate-pulse"></span>
                  <h3 className="text-base font-bold text-white tracking-tight">
                    Cluster-Wide eBPF Flow Engine & Topology Graph
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-lg border border-cyan-700/60 self-start sm:self-auto">
                  Engine: eBPF Socket Filter + K8s Endpoint Discovery
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                vCOp NetFlow provides complete Layer 3/4 and Layer 7 network visibility across the host cluster and all virtual clusters.
                It continuously discovers active pods, services, ingresses, and gateway proxies, mapping socket connections into a live interactive topology graph:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>1. Interactive Topology</span>
                  </div>
                  <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                    Visual nodes categorized into Ingress, Workload, Storage, and System tiers with animated particle velocity and zoom controls.
                  </p>
                </div>

                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <Radio className="w-4 h-4 text-emerald-400" />
                    <span>2. Active Probing</span>
                  </div>
                  <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                    Synthetic HTTP and TCP reachability probing directly tests socket latency, TLS handshakes, and route viability between endpoints.
                  </p>
                </div>

                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-purple-400 font-bold">
                    <Zap className="w-4 h-4 text-purple-400" />
                    <span>3. Flow Stream & Verdicts</span>
                  </div>
                  <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                    Real-time flow event stream capturing <code className="text-emerald-300">FORWARDED</code>, <code className="text-rose-400">DROPPED</code>, and <code className="text-amber-300">ERROR</code> packet verdicts.
                  </p>
                </div>

                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <span>4. Traffic Matrix</span>
                  </div>
                  <p className="text-slate-400 font-sans text-[11px] leading-relaxed">
                    Cross-namespace communication matrix highlighting network policy boundaries and inter-tenant traffic isolation.
                  </p>
                </div>
              </div>
            </div>

            {/* Scope & Filtering Capabilities */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  Multi-Dimensional Observability Scopes
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  NetFlow supports granular scoping so platform operators and developers can focus on relevant workloads:
                </p>
                <div className="space-y-2 text-xs font-mono">
                  <div className="bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                    <span className="text-cyan-300 font-bold">🌐 Cluster-Wide (all:all):</span>
                    <span className="text-slate-400 block text-[11px] font-sans mt-0.5">
                      Observes all pods and services across every host namespace, Envoy Gateway, and Istio component.
                    </span>
                  </div>
                  <div className="bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                    <span className="text-purple-300 font-bold">📦 Virtual Cluster (vcluster:&lt;name&gt;):</span>
                    <span className="text-slate-400 block text-[11px] font-sans mt-0.5">
                      Filters to workloads belonging to a specific virtual cluster, tracing syncer proxy hops and intra-vcluster communications.
                    </span>
                  </div>
                  <div className="bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                    <span className="text-emerald-300 font-bold">🏷️ Host Namespace (namespace:&lt;ns&gt;):</span>
                    <span className="text-slate-400 block text-[11px] font-sans mt-0.5">
                      Inspects traffic flows and endpoint health inside a specific host namespace or Namespaced Cluster slice.
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-3">
                <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Radio className="w-4 h-4 text-emerald-400" />
                  Active Reachability Probing Engine
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Unlike passive log aggregators, vCOp actively validates network health on demand:
                </p>
                <div className="space-y-2 text-xs font-mono">
                  <div className="bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                    <span className="text-emerald-300 font-bold">✓ Socket Connectivity:</span>
                    <span className="text-slate-400 block text-[11px] font-sans mt-0.5">
                      Direct TCP SYN/ACK socket verification against target container ports with microsecond latency calculation.
                    </span>
                  </div>
                  <div className="bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                    <span className="text-blue-300 font-bold">✓ HTTP / gRPC Status Probing:</span>
                    <span className="text-slate-400 block text-[11px] font-sans mt-0.5">
                      Sends synthetic health requests to verify HTTP 200/404 responses and TLS certificate validation.
                    </span>
                  </div>
                  <div className="bg-cyber-950 p-2.5 rounded-xl border border-cyber-800">
                    <span className="text-rose-400 font-bold">✓ Drop & Partition Detection:</span>
                    <span className="text-slate-400 block text-[11px] font-sans mt-0.5">
                      Instantly alerts on connection timeouts, network policy blocks, and missing service endpoint slices.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* REST API & CLI Snippets */}
            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  NetFlow REST API & CLI Query Snippets
                </h3>
                <span className="text-[10px] font-mono text-slate-400">Operations Center API</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Query Netflow Telemetry */}
                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold">Query Live NetFlow Topology & Events:</span>
                    <button
                      onClick={() => copyToClipboard('api-netflow', 'curl -s http://localhost:4321/api/netflow?scope=all | jq .summary')}
                      className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                    >
                      {copiedSnippets['api-netflow'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-slate-400" />}
                      <span>{copiedSnippets['api-netflow'] ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <code className="text-cyan-300 block bg-cyber-900 p-2 rounded-lg border border-cyber-800 font-mono text-[11px]">
                    curl -s http://localhost:4321/api/netflow?scope=all | jq .summary
                  </code>
                </div>

                {/* Run Active Reachability Probe */}
                <div className="bg-cyber-950 p-3.5 rounded-xl border border-cyber-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-emerald-400 font-semibold">Trigger Synthetic Reachability Probe:</span>
                    <button
                      onClick={() => copyToClipboard('api-probe', 'curl -X POST http://localhost:4321/api/netflow/probe -H "Content-Type: application/json" -d \'{"clusterKey":"all","endpointId":"vc-dev:nginx-deployment"}\'')}
                      className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300"
                    >
                      {copiedSnippets['api-probe'] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-slate-400" />}
                      <span>{copiedSnippets['api-probe'] ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <code className="text-cyan-300 block bg-cyber-900 p-2 rounded-lg border border-cyber-800 font-mono text-[11px] truncate">
                    curl -X POST http://localhost:4321/api/netflow/probe -H "Content-Type: application/json" -d '&#123;"clusterKey":"all","endpointId":"vc-dev:nginx-deployment"&#125;'
                  </code>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 6: Disaster Recovery */}
          <section id="dr" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 shadow-sm">
                  <Database className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Disaster Recovery (DR) & Backup Engine
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Point-in-time etcd snapshots, isolated backup PVCs, and rolling restore sequencing
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="text-amber-400 font-bold text-xs font-mono">Automated Schedules</div>
                  <p className="text-xs text-slate-400">
                    CronJobs take daily, weekly, or custom scheduled snapshots with automatic retention pruning (default: 7 snapshots).
                  </p>
                </div>
                <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="text-cyan-400 font-bold text-xs font-mono">Dedicated Storage Isolation</div>
                  <p className="text-xs text-slate-400">
                    Snapshots are written to an isolated PVC (<code className="text-slate-300 font-mono">&lt;cluster&gt;-etcd-backups</code>) completely decoupled from active runtime storage.
                  </p>
                </div>
                <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 space-y-1.5">
                  <div className="text-emerald-400 font-bold text-xs font-mono">Point-in-Time Restore</div>
                  <p className="text-xs text-slate-400">
                    An <code className="text-slate-300 font-mono">etcd-restore-init</code> container executes <code className="text-slate-300 font-mono">etcdutl snapshot restore</code> with strict Raft log invariance.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 6: Capacity & Headroom Engine */}
          <section id="capacity" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-300 shadow-sm">
                  <Gauge className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Host Capacity & Overallocation Prevention
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Real-time host node discovery and deterministic admission overallocation guards
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6 space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                vCOp continuously discovers physical node allocatable metrics for CPU cores, RAM, and Ephemeral Storage across all host nodes.
                Admission webhooks calculate cumulative tenant requests and block cluster provisioning or quota expansions if physical headroom would be breached.
              </p>
              <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 flex items-center justify-between gap-4 font-mono text-xs">
                <div>
                  <span className="text-purple-300 font-bold block">Capacity Condition & Events</span>
                  <span className="text-slate-400 text-[11px]">Operator maintains Condition: <code className="text-slate-200">CapacityAvailable</code></span>
                </div>
                <a
                  href="/capacity"
                  className="px-3 py-1.5 rounded-lg bg-cyber-800 hover:bg-cyber-750 text-cyan-400 text-xs font-mono border border-cyber-700"
                >
                  View Capacity Dashboard &rarr;
                </a>
              </div>
            </div>
          </section>

          {/* SECTION 7: App Store */}
          <section id="apps" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shadow-sm">
                  <Package className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    App Store Workload Catalog
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Curated 1-click cloud-native application stacks with multi-tenant isolation
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6 space-y-3">
              <p className="text-xs text-slate-300 leading-relaxed">
                The built-in App Store catalog allows Platform Admins to curate pre-configured Helm charts and applications (databases, message queues,
                monitoring agents, and dev tools). Developers can deploy these stacks into their virtual clusters with a single click.
              </p>
              <div className="flex items-center gap-3">
                <a
                  href="/apps"
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold text-xs font-mono shadow-sm"
                >
                  Browse App Store Catalog &rarr;
                </a>
              </div>
            </div>
          </section>

          {/* SECTION 8: Air-Gap & Security */}
          <section id="airgap" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300 shadow-sm">
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    Air-Gap & Sovereign Deployment
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    100% disconnected architecture, self-hosted fonts/icons, and offline Gemma 3 inference
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                vCOp is designed for strictly isolated, sovereign, and classified environments. External CDN requests and outbound dependencies are eliminated:
              </p>

              <div className="bg-cyber-950 p-4 rounded-xl border border-cyber-800 font-mono text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Single-Command Airgap Packager:</span>
                  <button
                    onClick={() => copyToClipboard('pack', 'make airgap-pack')}
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                  >
                    {copiedSnippets['pack'] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSnippets['pack'] ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <code className="text-cyan-300 block bg-cyber-900 p-2.5 rounded-lg border border-cyber-800">
                  make airgap-pack
                </code>
              </div>
            </div>
          </section>

          {/* SECTION 9: CLI & API Quickstart */}
          <section id="cli" className="scroll-mt-24 space-y-6">
            <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shadow-sm">
                  <Terminal className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">
                    CLI & REST API Reference
                  </h2>
                  <p className="text-xs text-slate-400 font-mono">
                    Quick connection snippets, kubectl context configuration, and automation endpoints
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Kubeconfig snippet */}
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    Connect via vCluster CLI
                  </span>
                  <button
                    onClick={() => copyToClipboard('cli-connect', 'vcluster connect <cluster-name> --namespace vcop-system')}
                    className="flex items-center gap-1 text-xs font-mono text-cyan-400 hover:text-cyan-300"
                  >
                    {copiedSnippets['cli-connect'] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedSnippets['cli-connect'] ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="bg-cyber-950 p-3 rounded-xl border border-cyber-800 font-mono text-xs text-cyan-300">
                  <code>vcluster connect &lt;cluster-name&gt; --namespace vcop-system</code>
                </div>
              </div>

              {/* REST API Endpoints Table */}
              <div className="bg-cyber-900/90 border border-cyber-700/70 rounded-2xl p-5">
                <h3 className="text-xs font-mono font-bold text-white uppercase tracking-wider mb-3">
                  Core REST API Endpoints
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b border-cyber-800 text-slate-400">
                        <th className="pb-2">Method</th>
                        <th className="pb-2">Endpoint</th>
                        <th className="pb-2">Min Role</th>
                        <th className="pb-2">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyber-800/40 text-[11px]">
                      <tr>
                        <td className="py-2 text-emerald-400 font-bold">GET</td>
                        <td className="py-2 text-slate-200">/api/vclusters</td>
                        <td className="py-2 text-cyan-400">Viewer</td>
                        <td className="py-2 text-slate-400">List all virtual clusters in fleet with metrics</td>
                      </tr>
                      <tr>
                        <td className="py-2 text-cyan-400 font-bold">POST</td>
                        <td className="py-2 text-slate-200">/api/vclusters</td>
                        <td className="py-2 text-amber-400">Developer</td>
                        <td className="py-2 text-slate-400">Provision a new tenant virtual cluster</td>
                      </tr>
                      <tr>
                        <td className="py-2 text-purple-400 font-bold">PATCH</td>
                        <td className="py-2 text-slate-200">/api/vclusters/:name/sleep</td>
                        <td className="py-2 text-amber-400">Developer</td>
                        <td className="py-2 text-slate-400">Toggle sleep / wake state for cluster</td>
                      </tr>
                      <tr>
                        <td className="py-2 text-rose-400 font-bold">DELETE</td>
                        <td className="py-2 text-slate-200">/api/vclusters/:name</td>
                        <td className="py-2 text-purple-400 font-bold">Platform Admin</td>
                        <td className="py-2 text-slate-400">Permanently delete virtual cluster and PVCs</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
