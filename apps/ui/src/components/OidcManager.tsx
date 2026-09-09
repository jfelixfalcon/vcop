import React, { useState, useEffect } from 'react';
import {
  Lock,
  Globe,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  Send,
  Layers,
  Sparkles,
  Server,
  Tag,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileCode,
} from 'lucide-react';
import type { OidcProfile, OidcRegistry } from '../lib/types';

interface ClusterStatItem {
  name: string;
  namespace: string;
  groups: string[];
  oidcEnabled: boolean;
  source: 'global' | 'group' | 'custom';
  inheritedFrom?: string;
  issuerUrl: string;
  clientId: string;
  hasCustomCa?: boolean;
}

interface ClusterStats {
  total: number;
  globalCount: number;
  groupCount: number;
  customCount: number;
  disabledCount: number;
  clusters: ClusterStatItem[];
}

interface Props {
  initialRegistry?: OidcRegistry;
  isAdmin: boolean;
}

export const OidcManager: React.FC<Props> = ({ initialRegistry, isAdmin }) => {
  const [registry, setRegistry] = useState<OidcRegistry | null>(initialRegistry || null);
  const [clusterStats, setClusterStats] = useState<ClusterStats | null>(null);
  const [loading, setLoading] = useState(!initialRegistry);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Global form state
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [globalIssuerUrl, setGlobalIssuerUrl] = useState('');
  const [globalClientId, setGlobalClientId] = useState('{cluster}-client');
  const [globalUsernameClaim, setGlobalUsernameClaim] = useState('email');
  const [globalUsernamePrefix, setGlobalUsernamePrefix] = useState('');
  const [globalGroupsClaim, setGlobalGroupsClaim] = useState('groups');
  const [globalGroupsPrefix, setGlobalGroupsPrefix] = useState('');
  const [globalExtraScopes, setGlobalExtraScopes] = useState('email, profile, groups');
  const [globalCaCert, setGlobalCaCert] = useState('');
  const [globalCaSecret, setGlobalCaSecret] = useState('');
  const [showGlobalCa, setShowGlobalCa] = useState(false);

  // Group Modal State
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroupName, setEditingGroupName] = useState<string>('');
  const [groupProfileName, setGroupProfileName] = useState<string>('');
  const [groupEnabled, setGroupEnabled] = useState(true);
  const [groupIssuerUrl, setGroupIssuerUrl] = useState('');
  const [groupClientId, setGroupClientId] = useState('{cluster}-client');
  const [groupUsernameClaim, setGroupUsernameClaim] = useState('email');
  const [groupUsernamePrefix, setGroupUsernamePrefix] = useState('');
  const [groupGroupsClaim, setGroupGroupsClaim] = useState('groups');
  const [groupGroupsPrefix, setGroupGroupsPrefix] = useState('');
  const [groupExtraScopes, setGroupExtraScopes] = useState('email, profile, groups');
  const [groupCaCert, setGroupCaCert] = useState('');
  const [groupCaSecret, setGroupCaSecret] = useState('');
  const [showGroupCa, setShowGroupCa] = useState(false);

  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    action: () => Promise<void>;
  } | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/oidc');
      const data = await res.json();
      if (data.success) {
        setRegistry(data.data);
        setClusterStats(data.clusterStats);

        // Sync global form
        if (data.data.global) {
          const g = data.data.global;
          setGlobalEnabled(g.enabled);
          setGlobalIssuerUrl(g.issuerUrl || '');
          setGlobalClientId(g.clientId || '{cluster}-client');
          setGlobalUsernameClaim(g.usernameClaim || 'email');
          setGlobalUsernamePrefix(g.usernamePrefix || '');
          setGlobalGroupsClaim(g.groupsClaim || 'groups');
          setGlobalGroupsPrefix(g.groupsPrefix || '');
          setGlobalExtraScopes(
            g.extraScopes && g.extraScopes.length > 0
              ? g.extraScopes.join(', ')
              : 'email, profile, groups'
          );
          setGlobalCaCert(g.caCertificate || '');
          setGlobalCaSecret(g.caSecretName || '');
          if (g.caCertificate || g.caSecretName) setShowGlobalCa(true);
        }
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Failed fetching OIDC registry', error: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveGlobal = async (applyToFleet = false) => {
    setSavingGlobal(true);
    setMessage(null);
    try {
      const scopes = globalExtraScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const profile: Partial<OidcProfile> = {
        enabled: globalEnabled,
        issuerUrl: globalIssuerUrl.trim(),
        clientId: globalClientId.trim(),
        usernameClaim: globalUsernameClaim.trim() || 'email',
        usernamePrefix: globalUsernamePrefix.trim(),
        groupsClaim: globalGroupsClaim.trim() || 'groups',
        groupsPrefix: globalGroupsPrefix.trim(),
        extraScopes: scopes,
        caCertificate: globalCaCert.trim(),
        caSecretName: globalCaSecret.trim(),
        caFile: globalCaCert.trim() ? '/etc/ssl/custom-ca/ca.crt' : '',
      };

      const res = await fetch('/api/admin/oidc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          profile,
          apply: applyToFleet,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed saving global OIDC policy');
      }

      setMessage({ text: data.message || 'Global OIDC policy saved successfully.' });
      await fetchData();
    } catch (err: any) {
      setMessage({ text: err.message, error: true });
    } finally {
      setSavingGlobal(false);
    }
  };

  const openGroupProfileModal = (groupName?: string) => {
    setMessage(null);
    if (groupName && registry?.groups[groupName]) {
      const p = registry.groups[groupName];
      setEditingGroupName(groupName);
      setGroupProfileName(p.name || `${groupName} OIDC Profile`);
      setGroupEnabled(p.enabled);
      setGroupIssuerUrl(p.issuerUrl || '');
      setGroupClientId(p.clientId || '{cluster}-client');
      setGroupUsernameClaim(p.usernameClaim || 'email');
      setGroupUsernamePrefix(p.usernamePrefix || '');
      setGroupGroupsClaim(p.groupsClaim || 'groups');
      setGroupGroupsPrefix(p.groupsPrefix || '');
      setGroupExtraScopes(
        p.extraScopes && p.extraScopes.length > 0 ? p.extraScopes.join(', ') : 'email, profile, groups'
      );
      setGroupCaCert(p.caCertificate || '');
      setGroupCaSecret(p.caSecretName || '');
      setShowGroupCa(Boolean(p.caCertificate || p.caSecretName));
    } else {
      setEditingGroupName(groupName || '');
      setGroupProfileName(groupName ? `${groupName} OIDC Profile` : '');
      setGroupEnabled(true);
      // Pre-fill with global settings as convenient starter template
      setGroupIssuerUrl(globalIssuerUrl);
      setGroupClientId('{cluster}-client');
      setGroupUsernameClaim('email');
      setGroupUsernamePrefix('');
      setGroupGroupsClaim('groups');
      setGroupGroupsPrefix('');
      setGroupExtraScopes('email, profile, groups');
      setGroupCaCert(globalCaCert);
      setGroupCaSecret(globalCaSecret);
      setShowGroupCa(Boolean(globalCaCert || globalCaSecret));
    }
    setIsGroupModalOpen(true);
  };

  const handleSaveGroup = async (applyToGroupClusters = false) => {
    if (!editingGroupName.trim()) {
      setMessage({ text: 'Target cluster group name is required', error: true });
      return;
    }

    setSavingGroup(true);
    setMessage(null);
    try {
      const scopes = groupExtraScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const profile: Partial<OidcProfile> = {
        name: groupProfileName.trim() || `${editingGroupName.trim()} OIDC Profile`,
        enabled: groupEnabled,
        issuerUrl: groupIssuerUrl.trim(),
        clientId: groupClientId.trim(),
        usernameClaim: groupUsernameClaim.trim() || 'email',
        usernamePrefix: groupUsernamePrefix.trim(),
        groupsClaim: groupGroupsClaim.trim() || 'groups',
        groupsPrefix: groupGroupsPrefix.trim(),
        extraScopes: scopes,
        caCertificate: groupCaCert.trim(),
        caSecretName: groupCaSecret.trim(),
        caFile: groupCaCert.trim() ? '/etc/ssl/custom-ca/ca.crt' : '',
      };

      const res = await fetch('/api/admin/oidc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'group',
          groupName: editingGroupName.trim(),
          profile,
          apply: applyToGroupClusters,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed saving group OIDC profile');
      }

      setIsGroupModalOpen(false);
      setMessage({ text: data.message || `Saved OIDC profile for group "${editingGroupName}"` });
      await fetchData();
    } catch (err: any) {
      setMessage({ text: err.message, error: true });
    } finally {
      setSavingGroup(false);
    }
  };

  const handleDeleteGroupProfile = async (groupName: string) => {
    if (!confirm(`Are you sure you want to delete the OIDC profile for group "${groupName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/oidc?groupName=${encodeURIComponent(groupName)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed deleting group OIDC profile');
      }
      setMessage({ text: `Deleted OIDC profile for group "${groupName}"` });
      await fetchData();
    } catch (err: any) {
      setMessage({ text: err.message, error: true });
    }
  };

  const handleApplyToFleetPrompt = () => {
    const affectedCount = clusterStats?.total || 0;
    setConfirmModal({
      isOpen: true,
      title: 'Apply Global OIDC Policy Across Entire Fleet?',
      description: `This will update the Kubernetes control plane configuration for all ${affectedCount} virtual cluster(s) across your fleet. Each virtual cluster will trigger a controlled rolling update with PKCE token verification flags.`,
      action: async () => {
        setApplying(true);
        try {
          const res = await fetch('/api/admin/oidc/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'fleet' }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed applying OIDC to fleet');
          }
          setMessage({ text: data.message || `Synchronized OIDC policy across ${data.updated} clusters!` });
          await fetchData();
        } catch (err: any) {
          setMessage({ text: err.message, error: true });
        } finally {
          setApplying(false);
          setConfirmModal(null);
        }
      },
    });
  };

  const handleApplyToGroupPrompt = (groupName: string) => {
    const groupClusters = clusterStats?.clusters.filter((c) => c.groups.includes(groupName)) || [];
    setConfirmModal({
      isOpen: true,
      title: `Apply OIDC Profile to Group "${groupName}"?`,
      description: `This will sync the OIDC settings to ${groupClusters.length} virtual cluster(s) in group "${groupName}".`,
      action: async () => {
        setApplying(true);
        try {
          const res = await fetch('/api/admin/oidc/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'group', groupName }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed applying OIDC to group');
          }
          setMessage({ text: data.message || `Synchronized OIDC profile to group "${groupName}"!` });
          await fetchData();
        } catch (err: any) {
          setMessage({ text: err.message, error: true });
        } finally {
          setApplying(false);
          setConfirmModal(null);
        }
      },
    });
  };

  // Distinct cluster groups across fleet
  const fleetDistinctGroups = Array.from(
    new Set([
      ...(clusterStats?.clusters.flatMap((c) => c.groups) || []),
      ...Object.keys(registry?.groups || {}),
    ])
  ).filter(Boolean);

  return (
    <div className="space-y-8 animate-in fade-in duration-150">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-cyber-800">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-purple-500/15 border border-purple-500/30 text-purple-400 rounded-2xl shadow-glow-sm">
            <Lock className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">
              OIDC Policies
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3.5 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 hover:text-white rounded-xl text-xs font-mono border border-cyber-700 transition-colors flex items-center gap-1.5"
            title="Refresh OIDC Profiles"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {isAdmin && (
            <button
              onClick={handleApplyToFleetPrompt}
              disabled={applying || !globalEnabled}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              Sync Fleet OIDC
            </button>
          )}
        </div>
      </div>

      {/* Message Alert Banner */}
      {message && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center gap-2.5 ${
            message.error
              ? 'bg-rose-950/30 border-rose-500/30 text-rose-300'
              : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {message.error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Fleet Scope</span>
          <h3 className="text-2xl font-bold font-mono text-white mt-1">
            {clusterStats?.total || 0} <span className="text-xs font-normal text-slate-500">Clusters</span>
          </h3>
          <div className="mt-2 text-xs font-mono text-slate-400 flex items-center gap-2">
            <span className="text-emerald-400 font-semibold">{clusterStats?.globalCount || 0} Global</span>
            <span>•</span>
            <span className="text-purple-400 font-semibold">{clusterStats?.groupCount || 0} Group</span>
          </div>
        </div>

        <div className="bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Global Policy Status</span>
          <div className="mt-1 flex items-center gap-2">
            {globalEnabled ? (
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Enforced Default
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono text-slate-400 bg-cyber-850 border border-cyber-750">
                Disabled / Optional
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] font-mono text-slate-400 truncate" title={globalIssuerUrl || 'None'}>
            Issuer: {globalIssuerUrl ? globalIssuerUrl.replace('https://', '') : 'Not configured'}
          </p>
        </div>

        <div className="bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Group Profiles</span>
          <h3 className="text-2xl font-bold font-mono text-cyan-300 mt-1">
            {Object.keys(registry?.groups || {}).length}{' '}
            <span className="text-xs font-normal text-slate-500">Configured</span>
          </h3>
          <div className="mt-2 text-xs font-mono text-slate-400">
            Across {fleetDistinctGroups.length} distinct cluster group tags
          </div>
        </div>

        <div className="bg-cyber-900/90 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Security Architecture</span>
          <h3 className="text-lg font-bold font-mono text-white mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            RFC 7636 PKCE
          </h3>
          <p className="mt-2 text-[11px] text-slate-400">
            Zero client secrets stored. Browser auth with direct API token validation.
          </p>
        </div>
      </div>

      {/* Main Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT: GLOBAL OIDC POLICY CARD */}
        <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-cyber-800">
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Global Fleet OIDC Policy
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Applied as default to all virtual clusters unless overridden by group or cluster.
                  </p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={globalEnabled}
                  onChange={(e) => setGlobalEnabled(e.target.checked)}
                  disabled={!isAdmin}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                <span className="ml-2.5 text-xs font-bold text-slate-200">
                  {globalEnabled ? 'Active' : 'Disabled'}
                </span>
              </label>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Global Issuer URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={globalIssuerUrl}
                  onChange={(e) => setGlobalIssuerUrl(e.target.value)}
                  placeholder="e.g. https://accounts.google.com or https://auth.company.com/realms/master"
                  disabled={!isAdmin}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  IdP endpoint providing <code className="text-slate-400">/.well-known/openid-configuration</code>.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Client ID Template <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={globalClientId}
                    onChange={(e) => setGlobalClientId(e.target.value)}
                    placeholder="e.g. {cluster}-client or vcluster-global"
                    disabled={!isAdmin}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Use <code className="text-purple-300 font-bold">{'{cluster}'}</code> as wildcard replacement.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Extra Scopes
                  </label>
                  <input
                    type="text"
                    value={globalExtraScopes}
                    onChange={(e) => setGlobalExtraScopes(e.target.value)}
                    placeholder="email, profile, groups"
                    disabled={!isAdmin}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Comma-separated OAuth2 scopes.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Username Claim
                  </label>
                  <input
                    type="text"
                    value={globalUsernameClaim}
                    onChange={(e) => setGlobalUsernameClaim(e.target.value)}
                    placeholder="email"
                    disabled={!isAdmin}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Default: <code className="text-slate-400">email</code></p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Groups Claim
                  </label>
                  <input
                    type="text"
                    value={globalGroupsClaim}
                    onChange={(e) => setGlobalGroupsClaim(e.target.value)}
                    placeholder="groups"
                    disabled={!isAdmin}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Default: <code className="text-slate-400">groups</code></p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Username Prefix (optional)
                  </label>
                  <input
                    type="text"
                    value={globalUsernamePrefix}
                    onChange={(e) => setGlobalUsernamePrefix(e.target.value)}
                    placeholder="e.g. oidc: or leave blank"
                    disabled={!isAdmin}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Groups Prefix (optional)
                  </label>
                  <input
                    type="text"
                    value={globalGroupsPrefix}
                    onChange={(e) => setGlobalGroupsPrefix(e.target.value)}
                    placeholder="e.g. oidc: or leave blank"
                    disabled={!isAdmin}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
              </div>

              {/* Custom CA / TLS Trust Store */}
              <div className="pt-3 border-t border-cyber-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    Custom Root / Intermediate CA Certificate (Internal / Self-Signed)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowGlobalCa(!showGlobalCa)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                  >
                    {showGlobalCa ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showGlobalCa ? 'Hide' : globalCaCert || globalCaSecret ? 'Configured' : 'Configure'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                  Trust internal or enterprise PKI certificates. Automatically mounted to <code className="text-slate-400">/etc/ssl/custom-ca/ca.crt</code> in vCluster pods, passed to <code className="text-slate-400">--oidc-ca-file</code>, and injected into client PKCE kubeconfigs.
                </p>

                {showGlobalCa && (
                  <div className="space-y-3 bg-cyber-950/60 p-3.5 rounded-xl border border-cyber-800 animate-in fade-in duration-100">
                    <div>
                      <label className="block text-[11px] font-mono text-slate-300 mb-1">
                        Raw CA Certificate (PEM format)
                      </label>
                      <textarea
                        rows={4}
                        value={globalCaCert}
                        onChange={(e) => setGlobalCaCert(e.target.value)}
                        disabled={!isAdmin}
                        placeholder="-----BEGIN CERTIFICATE-----&#10;MIID...&#10;-----END CERTIFICATE-----"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400 select-all"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-slate-300 mb-1">
                        Or Reference Existing Kubernetes Secret Name (in cluster namespace)
                      </label>
                      <input
                        type="text"
                        value={globalCaSecret}
                        onChange={(e) => setGlobalCaSecret(e.target.value)}
                        disabled={!isAdmin}
                        placeholder="e.g. corporate-root-ca"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className="pt-5 mt-5 border-t border-cyber-800 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleApplyToFleetPrompt}
                disabled={savingGlobal || !globalEnabled}
                className="px-3 py-2 text-xs font-semibold text-purple-300 hover:text-white bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/30 rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
                Apply to Existing Fleet
              </button>

              <button
                type="button"
                onClick={() => handleSaveGlobal(false)}
                disabled={savingGlobal}
                className="px-5 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                {savingGlobal ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Save Global Policy
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: GROUP-LEVEL OIDC PROFILES */}
        <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-cyber-800">
              <div className="flex items-center gap-2.5">
                <Users className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Group-Level OIDC Profiles
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Assign dedicated Identity Providers or custom claim mappings to sets of cluster groups.
                  </p>
                </div>
              </div>

              {isAdmin && (
                <button
                  onClick={() => openGroupProfileModal()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Group Profile
                </button>
              )}
            </div>

            {/* Profiles List */}
            {Object.keys(registry?.groups || {}).length === 0 ? (
              <div className="p-8 text-center border border-dashed border-cyber-800 rounded-2xl bg-cyber-950/40">
                <Lock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <h4 className="text-xs font-bold text-slate-300">No Group OIDC Profiles Configured</h4>
                <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
                  All cluster groups currently inherit the Global OIDC Policy. Click "Add Group Profile" to configure custom IdP parameters for specific groups like <code>team-fintech</code> or <code>core-infra</code>.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {Object.entries(registry?.groups || {}).map(([gName, profile]) => {
                  const matchingClusters = clusterStats?.clusters.filter((c) => c.groups.includes(gName)) || [];

                  return (
                    <div
                      key={gName}
                      className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-xl hover:border-indigo-500/40 transition-all space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-mono font-bold">
                              <Tag className="w-3 h-3 text-indigo-400" />
                              Group: {gName}
                            </span>
                            {profile.enabled ? (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono">
                                Active
                              </span>
                            ) : (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                                Inactive
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-white mt-1.5">{profile.name}</h4>
                          <p className="text-[11px] font-mono text-slate-400 truncate max-w-md mt-0.5">
                            Issuer: <span className="text-slate-200">{profile.issuerUrl || 'Not configured'}</span>
                          </p>
                        </div>

                        {isAdmin && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openGroupProfileModal(gName)}
                              className="p-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-300 hover:text-white rounded-lg border border-cyber-700 transition-colors"
                              title="Edit Group Profile"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGroupProfile(gName)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                              title="Delete Profile"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="pt-2.5 border-t border-cyber-850 flex items-center justify-between text-xs font-mono text-slate-400">
                        <span>
                          Clusters in group: <strong className="text-white">{matchingClusters.length}</strong>
                        </span>
                        {isAdmin && matchingClusters.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleApplyToGroupPrompt(gName)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold hover:underline flex items-center gap-1"
                          >
                            <Send className="w-3 h-3" />
                            Sync to {matchingClusters.length} cluster(s)
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Group Suggestions */}
          <div className="pt-4 mt-4 border-t border-cyber-800">
            <span className="text-[11px] font-mono text-slate-400 block mb-2">
              Unconfigured Fleet Groups (Click to assign custom OIDC):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {fleetDistinctGroups
                .filter((g) => !registry?.groups[g])
                .map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => openGroupProfileModal(g)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyber-950 hover:bg-cyber-800 text-slate-300 border border-cyber-800 text-xs font-mono transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5 text-cyan-400" />
                    <span>{g}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* FLEET INHERITANCE OVERVIEW TABLE */}
      <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-6 shadow-xl backdrop-blur-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-cyber-800">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              Fleet Virtual Cluster OIDC Inheritance
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Live inspection of effective OIDC identity providers configured across your virtual clusters.
            </p>
          </div>

          <span className="text-xs font-mono text-slate-400">
            Total Fleet: <strong className="text-white">{clusterStats?.total || 0}</strong> clusters
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300 font-mono min-w-[850px]">
            <thead className="bg-cyber-950/80 border-b border-cyber-800 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-4 font-medium">Virtual Cluster</th>
                <th className="py-3 px-4 font-medium">Cluster Groups</th>
                <th className="py-3 px-4 font-medium">OIDC State</th>
                <th className="py-3 px-4 font-medium">TLS / CA Trust</th>
                <th className="py-3 px-4 font-medium">Inheritance Source</th>
                <th className="py-3 px-4 font-medium">Issuer URL</th>
                <th className="py-3 px-4 font-medium">Client ID</th>
                <th className="py-3 px-4 font-medium text-right">Quick Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-800/60">
              {clusterStats?.clusters.map((c) => (
                <tr key={c.name} className="hover:bg-cyber-850/50 transition-colors">
                  <td className="py-3 px-4 font-bold text-white">
                    <a href={`/clusters/${c.name}`} className="hover:text-cyan-400 transition-colors">
                      {c.name}
                    </a>
                    <div className="text-[10px] text-slate-500 font-sans">{c.namespace}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {c.groups.length > 0 ? (
                        c.groups.map((g) => (
                          <span
                            key={g}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyber-800 text-slate-300 text-[10px]"
                          >
                            <Tag className="w-2.5 h-2.5 text-indigo-400" />
                            {g}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-500 italic">—</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {c.oidcEnabled ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Enabled (PKCE)
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">Disabled</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {c.hasCustomCa ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[10px] font-mono font-bold">
                        <ShieldCheck className="w-3 h-3 text-cyan-400" />
                        Custom CA
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">System CAs</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {c.source === 'group' ? (
                      <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px]">
                        Group: {c.inheritedFrom || 'active'}
                      </span>
                    ) : c.source === 'global' ? (
                      <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 text-[10px]">
                        Global Policy
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px]">
                        Custom Cluster
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-300 truncate max-w-xs" title={c.issuerUrl}>
                    {c.issuerUrl || <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-3 px-4 text-cyan-300 truncate max-w-xs" title={c.clientId}>
                    {c.clientId || <span className="text-slate-600">—</span>}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <a
                      href={`/clusters/${c.name}`}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 bg-cyber-800 hover:bg-cyber-700 rounded-lg transition-colors"
                      title="View Cluster Access"
                    >
                      <span>Access</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* GROUP PROFILE EDIT MODAL */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto bg-cyber-950/45 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-cyber-900 border border-cyber-700 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] my-auto">
            <div className="flex items-center justify-between p-5 border-b border-cyber-800 bg-cyber-950/70">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {editingGroupName ? `Group OIDC Profile: ${editingGroupName}` : 'New Group OIDC Profile'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure custom OIDC authentication for clusters tagged with this group.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsGroupModalOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-cyber-800"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Target Cluster Group <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={editingGroupName}
                    onChange={(e) => setEditingGroupName(e.target.value)}
                    placeholder="e.g. team-fintech or core-infra"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Profile Display Name
                  </label>
                  <input
                    type="text"
                    value={groupProfileName}
                    onChange={(e) => setGroupProfileName(e.target.value)}
                    placeholder="e.g. Fintech IdP Okta"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  OIDC Issuer URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={groupIssuerUrl}
                  onChange={(e) => setGroupIssuerUrl(e.target.value)}
                  placeholder="https://dev-company.okta.com/oauth2/default"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Client ID Template
                  </label>
                  <input
                    type="text"
                    value={groupClientId}
                    onChange={(e) => setGroupClientId(e.target.value)}
                    placeholder="{cluster}-client"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Extra Scopes
                  </label>
                  <input
                    type="text"
                    value={groupExtraScopes}
                    onChange={(e) => setGroupExtraScopes(e.target.value)}
                    placeholder="email, profile, groups"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Username Claim
                  </label>
                  <input
                    type="text"
                    value={groupUsernameClaim}
                    onChange={(e) => setGroupUsernameClaim(e.target.value)}
                    placeholder="email"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Groups Claim
                  </label>
                  <input
                    type="text"
                    value={groupGroupsClaim}
                    onChange={(e) => setGroupGroupsClaim(e.target.value)}
                    placeholder="groups"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              {/* Custom CA / TLS Trust Store for Group */}
              <div className="pt-3 border-t border-cyber-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    Custom CA Certificate (Self-Signed / Internal PKI)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowGroupCa(!showGroupCa)}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                  >
                    {showGroupCa ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showGroupCa ? 'Hide' : groupCaCert || groupCaSecret ? 'Configured' : 'Configure'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                  Trust internal endpoints for all virtual clusters belonging to this group.
                </p>

                {showGroupCa && (
                  <div className="space-y-3 bg-cyber-950/60 p-3.5 rounded-xl border border-cyber-800 animate-in fade-in duration-100">
                    <div>
                      <label className="block text-[11px] font-mono text-slate-300 mb-1">
                        Raw CA Certificate (PEM format)
                      </label>
                      <textarea
                        rows={4}
                        value={groupCaCert}
                        onChange={(e) => setGroupCaCert(e.target.value)}
                        placeholder="-----BEGIN CERTIFICATE-----&#10;MIID...&#10;-----END CERTIFICATE-----"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-400 select-all"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-slate-300 mb-1">
                        Or Existing Kubernetes Secret Name
                      </label>
                      <input
                        type="text"
                        value={groupCaSecret}
                        onChange={(e) => setGroupCaSecret(e.target.value)}
                        placeholder="e.g. corp-ca-secret"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-400"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-cyber-800 flex items-center justify-between bg-cyber-950/60">
              <button
                type="button"
                onClick={() => setIsGroupModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveGroup(true)}
                  disabled={savingGroup || !editingGroupName}
                  className="px-3.5 py-2 bg-purple-950/60 hover:bg-purple-900/70 text-purple-300 border border-purple-500/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  Save & Apply to Group
                </button>

                <button
                  type="button"
                  onClick={() => handleSaveGroup(false)}
                  disabled={savingGroup || !editingGroupName}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {savingGroup ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACTION CONFIRMATION MODAL */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto bg-cyber-950/45 backdrop-blur-md animate-in fade-in duration-150">
          <div className="bg-cyber-900 border border-cyber-700 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-5 space-y-4 my-auto">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-purple-500/20 text-purple-400 rounded-xl border border-purple-500/30 shrink-0">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">{confirmModal.title}</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {confirmModal.description}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-cyber-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={applying}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.action}
                disabled={applying}
                className="px-4 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                {applying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Confirm & Sync
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
