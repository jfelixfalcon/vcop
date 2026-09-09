import React, { useState, useEffect } from 'react';
import {
  Terminal,
  Download,
  Copy,
  Check,
  X,
  ShieldCheck,
  Key,
  Globe,
  Settings,
  Lock,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Layers,
  Sparkles,
  Users,
  Mail,
  Send,
  Tag,
  Code2,
  CheckCircle2,
} from 'lucide-react';
import type { VirtualCluster, OidcConfig, OidcRegistry } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'oidc' | 'admin' | 'endpoint' | 'settings';
  onClusterUpdated?: () => void;
  isAdmin?: boolean;
}

export const KubeconfigModal: React.FC<Props> = ({
  cluster,
  isOpen,
  onClose,
  initialTab,
  onClusterUpdated,
  isAdmin = false,
}) => {
  const [activeTab, setActiveTab] = useState<'oidc' | 'admin' | 'endpoint' | 'settings'>('oidc');
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [copiedRawAdmin, setCopiedRawAdmin] = useState(false);
  const [copiedRawOidc, setCopiedRawOidc] = useState(false);

  // Cached kubeconfigs
  const [adminKubeconfig, setAdminKubeconfig] = useState<string>('');
  const [oidcKubeconfig, setOidcKubeconfig] = useState<string>('');
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [loadingOidc, setLoadingOidc] = useState(false);

  // Endpoint configuration state
  const [customEndpointInput, setCustomEndpointInput] = useState<string>('');
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [endpointMessage, setEndpointMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // OIDC configuration state
  const [oidcProfileMode, setOidcProfileMode] = useState<'global' | 'group' | 'custom'>('custom');
  const [oidcEnabled, setOidcEnabled] = useState<boolean>(false);
  const [oidcIssuerUrl, setOidcIssuerUrl] = useState<string>('');
  const [oidcClientId, setOidcClientId] = useState<string>('');
  const [oidcUsernameClaim, setOidcUsernameClaim] = useState<string>('email');
  const [oidcUsernamePrefix, setOidcUsernamePrefix] = useState<string>('');
  const [oidcGroupsClaim, setOidcGroupsClaim] = useState<string>('groups');
  const [oidcGroupsPrefix, setOidcGroupsPrefix] = useState<string>('');
  const [oidcExtraScopes, setOidcExtraScopes] = useState<string>('email, profile, groups');
  const [savingOidc, setSavingOidc] = useState(false);
  const [oidcMessage, setOidcMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Custom CA State
  const [oidcCaCert, setOidcCaCert] = useState<string>('');
  const [oidcCaSecret, setOidcCaSecret] = useState<string>('');
  const [showCaConfig, setShowCaConfig] = useState<boolean>(false);

  // Fleet OIDC Registry info for inheritance
  const [fleetRegistry, setFleetRegistry] = useState<OidcRegistry | null>(null);

  const clusterGroups =
    cluster?.metadata?.clusterGroups && cluster.metadata.clusterGroups.length > 0
      ? cluster.metadata.clusterGroups
      : cluster?.metadata?.clusterGroup
      ? [cluster.metadata.clusterGroup]
      : [];

  useEffect(() => {
    if (cluster && isOpen) {
      // Default to OIDC if enabled on cluster, otherwise initialTab or admin
      if (initialTab && (isAdmin || (initialTab !== 'endpoint' && initialTab !== 'settings'))) {
        setActiveTab(initialTab);
      } else if (cluster.metadata?.oidc?.enabled) {
        setActiveTab('oidc');
      } else {
        setActiveTab('admin');
      }

      setCustomEndpointInput(cluster.metadata?.customEndpoint || '');

      const currentOidc = cluster.metadata?.oidc;
      const initialSource = cluster.metadata?.oidcInheritance || currentOidc?.source || 'custom';
      setOidcProfileMode(initialSource);

      const existingCaCert = currentOidc?.caCertificate || cluster.metadata?.customCaCert || '';
      const existingCaSecret = currentOidc?.caSecretName || cluster.metadata?.customCaSecret || '';
      setOidcCaCert(existingCaCert);
      setOidcCaSecret(existingCaSecret);
      if (existingCaCert || existingCaSecret) {
        setShowCaConfig(true);
      } else {
        setShowCaConfig(false);
      }

      if (currentOidc) {
        setOidcEnabled(currentOidc.enabled);
        setOidcIssuerUrl(currentOidc.issuerUrl || '');
        setOidcClientId(currentOidc.clientId || '');
        setOidcUsernameClaim(currentOidc.usernameClaim || 'email');
        setOidcUsernamePrefix(currentOidc.usernamePrefix || '');
        setOidcGroupsClaim(currentOidc.groupsClaim || 'groups');
        setOidcGroupsPrefix(currentOidc.groupsPrefix || '');
        setOidcExtraScopes(
          currentOidc.extraScopes && currentOidc.extraScopes.length > 0
            ? currentOidc.extraScopes.join(', ')
            : 'email, profile, groups'
        );
      } else {
        setOidcEnabled(false);
        setOidcIssuerUrl('');
        setOidcClientId(`${cluster.name}-client`);
        setOidcUsernameClaim('email');
        setOidcUsernamePrefix('');
        setOidcGroupsClaim('groups');
        setOidcGroupsPrefix('');
        setOidcExtraScopes('email, profile, groups');
      }

      // Fetch credentials in parallel once per modal open
      fetchCredentials(cluster.name);
      if (isAdmin) {
        fetchFleetRegistry();
      }
    }
  }, [cluster?.name, isOpen, isAdmin]);

  const fetchCredentials = (clusterName: string) => {
    setLoadingAdmin(true);
    fetch(`/api/vclusters/${clusterName}/kubeconfig?type=admin`)
      .then((res) => res.json())
      .then((data) => {
        if (data.kubeconfig) setAdminKubeconfig(data.kubeconfig);
      })
      .catch(console.error)
      .finally(() => setLoadingAdmin(false));

    setLoadingOidc(true);
    fetch(`/api/vclusters/${clusterName}/kubeconfig?type=oidc`)
      .then((res) => res.json())
      .then((data) => {
        if (data.kubeconfig) setOidcKubeconfig(data.kubeconfig);
      })
      .catch(console.error)
      .finally(() => setLoadingOidc(false));
  };

  const fetchFleetRegistry = async () => {
    try {
      const res = await fetch('/api/admin/oidc');
      const data = await res.json();
      if (data.success && data.data) {
        setFleetRegistry(data.data);
      }
    } catch {
      // ignore
    }
  };

  if (!isOpen || !cluster) return null;

  const currentActiveEndpoint =
    cluster.metadata?.customEndpoint ||
    cluster.status.endpoint ||
    `https://${cluster.name}.${cluster.namespace}.svc.cluster.local:443`;
  const isUsingCustomEndpoint = Boolean(cluster.metadata?.customEndpoint);

  const cliSnippet = `vcluster connect ${cluster.name} --namespace ${cluster.namespace}`;
  const envExportSnippet =
    activeTab === 'oidc'
      ? `export KUBECONFIG=~/.kube/${cluster.name}-oidc.yaml`
      : `export KUBECONFIG=~/.kube/${cluster.name}-admin.yaml`;
  const kubectlSnippet =
    activeTab === 'oidc'
      ? `kubectl --kubeconfig=~/.kube/${cluster.name}-oidc.yaml get pods -A`
      : `kubectl --kubeconfig=~/.kube/${cluster.name}-admin.yaml get pods -A`;

  const copyToClipboard = (text: string, type: 'cli' | 'env' | 'admin' | 'oidc') => {
    navigator.clipboard.writeText(text);
    if (type === 'cli') {
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } else if (type === 'env') {
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } else if (type === 'admin') {
      setCopiedRawAdmin(true);
      setTimeout(() => setCopiedRawAdmin(false), 2000);
    } else if (type === 'oidc') {
      setCopiedRawOidc(true);
      setTimeout(() => setCopiedRawOidc(false), 2000);
    }
  };

  const handleDownload = (type: 'admin' | 'oidc') => {
    window.open(`/api/vclusters/${cluster.name}/kubeconfig?download=true&type=${type}`, '_blank');
  };

  const handleSaveEndpoint = async (resetToDefault = false) => {
    setSavingEndpoint(true);
    setEndpointMessage(null);
    try {
      const endpointVal = resetToDefault ? '' : customEndpointInput.trim();
      const res = await fetch(`/api/vclusters/${cluster.name}/endpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: endpointVal }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update endpoint');
      }
      if (resetToDefault) {
        setCustomEndpointInput('');
      }
      setEndpointMessage({
        text: resetToDefault
          ? 'Reset to internal cluster endpoint successfully'
          : `Custom endpoint updated to ${endpointVal}`,
      });
      fetchCredentials(cluster.name);
      if (onClusterUpdated) onClusterUpdated();
    } catch (err: any) {
      setEndpointMessage({ text: err.message || 'Error updating endpoint', error: true });
    } finally {
      setSavingEndpoint(false);
    }
  };

  const applyProfileTemplate = (mode: 'global' | 'group' | 'custom', targetGroup?: string) => {
    setOidcProfileMode(mode);
    if (mode === 'global' && fleetRegistry?.global) {
      const g = fleetRegistry.global;
      setOidcEnabled(g.enabled);
      setOidcIssuerUrl(g.issuerUrl || '');
      setOidcClientId(g.clientId ? g.clientId.replace('{cluster}', cluster.name) : `${cluster.name}-client`);
      setOidcUsernameClaim(g.usernameClaim || 'email');
      setOidcUsernamePrefix(g.usernamePrefix || '');
      setOidcGroupsClaim(g.groupsClaim || 'groups');
      setOidcGroupsPrefix(g.groupsPrefix || '');
      setOidcExtraScopes(g.extraScopes ? g.extraScopes.join(', ') : 'email, profile, groups');
      const gCa = g.caCertificate || '';
      const gSec = g.caSecretName || '';
      setOidcCaCert(gCa);
      setOidcCaSecret(gSec);
      if (gCa || gSec) setShowCaConfig(true);
    } else if (mode === 'group' && fleetRegistry?.groups) {
      const gName = targetGroup || clusterGroups[0];
      const grpProfile = fleetRegistry.groups[gName];
      if (grpProfile) {
        setOidcEnabled(grpProfile.enabled);
        setOidcIssuerUrl(grpProfile.issuerUrl || '');
        setOidcClientId(
          grpProfile.clientId
            ? grpProfile.clientId.replace('{cluster}', cluster.name)
            : `${cluster.name}-client`
        );
        setOidcUsernameClaim(grpProfile.usernameClaim || 'email');
        setOidcUsernamePrefix(grpProfile.usernamePrefix || '');
        setOidcGroupsClaim(grpProfile.groupsClaim || 'groups');
        setOidcGroupsPrefix(grpProfile.groupsPrefix || '');
        setOidcExtraScopes(grpProfile.extraScopes ? grpProfile.extraScopes.join(', ') : 'email, profile, groups');
        const grpCa = grpProfile.caCertificate || '';
        const grpSec = grpProfile.caSecretName || '';
        setOidcCaCert(grpCa);
        setOidcCaSecret(grpSec);
        if (grpCa || grpSec) setShowCaConfig(true);
      }
    }
  };

  const handleSaveOidc = async () => {
    setSavingOidc(true);
    setOidcMessage(null);
    try {
      const scopesArray = oidcExtraScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        enabled: oidcEnabled,
        issuerUrl: oidcIssuerUrl.trim(),
        clientId: oidcClientId.trim(),
        usernameClaim: oidcUsernameClaim.trim() || 'email',
        usernamePrefix: oidcUsernamePrefix.trim(),
        groupsClaim: oidcGroupsClaim.trim() || 'groups',
        groupsPrefix: oidcGroupsPrefix.trim(),
        extraScopes: scopesArray,
        caCertificate: oidcCaCert.trim(),
        caSecretName: oidcCaSecret.trim(),
        caFile: oidcCaCert.trim() ? '/etc/ssl/custom-ca/ca.crt' : '',
        source: oidcProfileMode,
        inheritedFrom:
          oidcProfileMode === 'group'
            ? clusterGroups[0] || 'group'
            : oidcProfileMode === 'global'
            ? 'global'
            : undefined,
      };

      const res = await fetch(`/api/vclusters/${cluster.name}/oidc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update OIDC configuration');
      }
      setOidcMessage({
        text: oidcEnabled
          ? 'OIDC updated successfully! Control plane pod is restarting with PKCE token validation.'
          : 'OIDC disabled on virtual cluster.',
      });
      fetchCredentials(cluster.name);
      if (onClusterUpdated) onClusterUpdated();
    } catch (err: any) {
      setOidcMessage({ text: err.message || 'Error updating OIDC configuration', error: true });
    } finally {
      setSavingOidc(false);
    }
  };

  // Check matching group profile if assigned
  const matchingGroupProfile =
    fleetRegistry?.groups && clusterGroups.find((g) => fleetRegistry.groups[g]?.enabled);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overflow-y-auto bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl bg-cyber-900 border border-cyber-700/80 rounded-2xl shadow-2xl p-5 sm:p-6 overflow-hidden max-h-[92vh] flex flex-col my-auto">
        {/* Glow Accent */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>

        {/* Modal Header */}
        <div className="flex justify-between items-start mb-4 pb-3 border-b border-cyber-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyber-800 rounded-xl border border-cyber-700 text-cyan-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Connect to Virtual Cluster: <span className="font-mono text-cyan-400">{cluster.name}</span>
                </h2>
                {isUsingCustomEndpoint ? (
                  <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono">
                    Custom Endpoint
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-[10px] font-mono">
                    Internal ClusterIP
                  </span>
                )}
                {cluster.metadata?.oidc?.enabled && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono">
                    OIDC PKCE
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1 font-mono truncate max-w-xl">
                API Endpoint: <span className="text-slate-200">{currentActiveEndpoint}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center border-b border-cyber-800 mb-4 gap-1.5 overflow-x-auto pb-1 shrink-0">
          <button
            onClick={() => setActiveTab('oidc')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'oidc'
                ? 'bg-cyber-800 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-purple-400" />
            OIDC Kubeconfig (PKCE)
            {cluster.metadata?.oidc?.enabled && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('admin')}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'admin'
                ? 'bg-cyber-800 text-cyan-400 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            Admin / Breakglass
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('endpoint')}
                className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'endpoint'
                    ? 'bg-cyber-800 text-blue-400 border border-blue-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-blue-400" />
                Endpoint & Routing
                {isUsingCustomEndpoint && <span className="w-2 h-2 rounded-full bg-purple-400"></span>}
              </button>

              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'settings'
                    ? 'bg-cyber-800 text-amber-400 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
                }`}
              >
                <Settings className="w-3.5 h-3.5 text-amber-400" />
                OIDC Provider Setup
              </button>
            </>
          )}
        </div>

        {/* Tab Body (Smooth single scroll container) */}
        <div className="overflow-y-auto pr-1 flex-1 space-y-4">
          {/* ======================================================== */}
          {/* TAB 1: OIDC KUBECONFIG (PKCE)                           */}
          {/* ======================================================== */}
          {activeTab === 'oidc' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* OIDC Banner */}
              {cluster.metadata?.oidc?.enabled ? (
                <div className="bg-gradient-to-r from-purple-950/40 via-purple-900/30 to-cyber-950 border border-purple-500/30 rounded-xl p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/30 shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          PKCE SSO Authentication Active
                        </h4>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono">
                          Zero Secret Storage
                        </span>
                        {(cluster.metadata?.customCaCert || cluster.metadata?.oidc?.caCertificate || cluster.metadata?.customCaSecret || cluster.metadata?.oidc?.caSecretName) && (
                          <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-cyan-400" />
                            Custom CA Embedded
                          </span>
                        )}
                        {cluster.metadata?.oidc?.source && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono">
                            {cluster.metadata.oidc.source === 'group'
                              ? `Inherited: Group ${cluster.metadata.oidc.inheritedFrom || ''}`
                              : cluster.metadata.oidc.source === 'global'
                              ? 'Inherited: Global Policy'
                              : 'Custom Override'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        This kubeconfig executes{' '}
                        <code className="text-purple-300 bg-purple-950/80 px-1 py-0.5 rounded border border-purple-800">
                          kubectl oidc-login
                        </code>{' '}
                        using RFC 7636 Proof Key for Code Exchange. No client secret is stored in this file.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-amber-300">OIDC is not yet enabled on this cluster</h4>
                      <p className="text-xs text-slate-300 mt-0.5">
                        The virtual API server is currently running with direct cert credentials. Enable OIDC below to activate single sign-on with your IdP.
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setActiveTab('settings')}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shrink-0 flex items-center gap-1 shadow-sm"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Setup OIDC
                    </button>
                  )}
                </div>
              )}

              {/* 3-Step Setup Instructions */}
              <div className="bg-cyber-950/80 border border-cyber-800 rounded-xl p-3.5 space-y-2.5">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-purple-400" />
                  <span>How to connect with OIDC:</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-cyber-900/80 p-2.5 rounded-lg border border-cyber-800 space-y-1">
                    <div className="text-slate-400 text-[11px] font-sans font-semibold flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-[10px]">1</span>
                      Install kubelogin plugin:
                    </div>
                    <div className="text-purple-300 text-[11px] select-all bg-cyber-950 p-1.5 rounded">
                      kubectl krew install oidc-login
                    </div>
                    <div className="text-[10px] text-slate-500 font-sans">
                      Or via Homebrew: <code className="text-slate-400">brew install kubelogin</code>
                    </div>
                  </div>

                  <div className="bg-cyber-900/80 p-2.5 rounded-lg border border-cyber-800 space-y-1">
                    <div className="text-slate-400 text-[11px] font-sans font-semibold flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-[10px]">2</span>
                      Set env & authenticate:
                    </div>
                    <div className="text-cyan-300 text-[11px] select-all bg-cyber-950 p-1.5 rounded">
                      {envExportSnippet}
                    </div>
                    <div className="text-[10px] text-slate-500 font-sans">
                      Then run <code className="text-slate-400">kubectl get pods</code> (opens browser for SSO login)
                    </div>
                  </div>
                </div>
              </div>

              {/* OIDC Kubeconfig Preview */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-purple-400" />
                    Generated OIDC Kubeconfig File
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(oidcKubeconfig, 'oidc')}
                      className="px-2.5 py-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-300 text-xs rounded-lg border border-cyber-700 flex items-center gap-1 transition-colors"
                    >
                      {copiedRawOidc ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedRawOidc ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => handleDownload('oidc')}
                      className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-medium text-xs rounded-lg shadow-sm flex items-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Kubeconfig (.yaml)
                    </button>
                  </div>
                </div>

                <div className="relative bg-cyber-950 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 max-h-64 overflow-y-auto">
                  {loadingOidc ? (
                    <div className="py-8 text-center text-slate-500 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                      Generating OIDC credentials...
                    </div>
                  ) : (
                    <pre className="whitespace-pre font-mono leading-relaxed select-all">{oidcKubeconfig}</pre>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: ADMIN / BREAKGLASS KUBECONFIG                    */}
          {/* ======================================================== */}
          {activeTab === 'admin' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* CLI Direct Snippet */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  Direct vCluster CLI Port-Forward Connect
                </label>
                <div className="relative flex items-center bg-cyber-950 border border-cyber-800 rounded-xl px-4 py-2.5 font-mono text-xs text-slate-200">
                  <span className="text-cyan-400 select-none mr-2">$</span>
                  <span className="flex-1 overflow-x-auto select-all">{cliSnippet}</span>
                  <button
                    onClick={() => copyToClipboard(cliSnippet, 'cli')}
                    className="ml-3 px-2.5 py-1 bg-cyber-800 hover:bg-cyber-700 text-slate-200 text-xs rounded-lg border border-cyber-700 flex items-center gap-1 transition-colors"
                  >
                    {copiedCli ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCli ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Direct Admin Kubeconfig Viewer */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-cyan-400" />
                    Admin Kubeconfig File (Direct Breakglass)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(adminKubeconfig, 'admin')}
                      className="px-2.5 py-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-300 text-xs rounded-lg border border-cyber-700 flex items-center gap-1 transition-colors"
                    >
                      {copiedRawAdmin ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedRawAdmin ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      onClick={() => handleDownload('admin')}
                      className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-lg shadow-glow-sm flex items-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Admin Kubeconfig
                    </button>
                  </div>
                </div>

                <div className="relative bg-cyber-950 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 max-h-64 overflow-y-auto">
                  {loadingAdmin ? (
                    <div className="py-8 text-center text-slate-500 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                      Loading credentials...
                    </div>
                  ) : (
                    <pre className="whitespace-pre font-mono leading-relaxed select-all">{adminKubeconfig}</pre>
                  )}
                </div>
              </div>

              {/* Shell Quick-Run helper */}
              <div className="bg-cyber-950/70 border border-cyber-800 rounded-xl p-3 flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="truncate select-all">
                  Run: <span className="text-cyan-300">{kubectlSnippet}</span>
                </span>
                <button
                  onClick={() => copyToClipboard(kubectlSnippet, 'cli')}
                  className="ml-2 text-slate-400 hover:text-white shrink-0"
                  title="Copy command"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: API ENDPOINT & ROUTING                           */}
          {/* ======================================================== */}
          {isAdmin && activeTab === 'endpoint' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="bg-cyber-950/80 border border-cyber-800 rounded-xl p-4 space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  Kubernetes API Endpoint Configuration
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Configure a custom hostname or external URL for accessing this virtual cluster via an Ingress controller, Istio/Envoy VirtualService, or external LoadBalancer.
                  The vCluster proxy will automatically inject this hostname into its TLS Subject Alternative Names (SANs).
                </p>

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      External API Server Endpoint URL
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={customEndpointInput}
                        onChange={(e) => setCustomEndpointInput(e.target.value)}
                        placeholder="e.g. https://vc-dev.example.com:443 or https://ingress.k8s.local:443"
                        className="flex-1 bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                      />
                      <button
                        onClick={() => handleSaveEndpoint(false)}
                        disabled={savingEndpoint}
                        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50 shrink-0"
                      >
                        {savingEndpoint ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Save Endpoint
                      </button>
                    </div>
                  </div>

                  {endpointMessage && (
                    <div
                      className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                        endpointMessage.error
                          ? 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                          : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      {endpointMessage.error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
                      <span>{endpointMessage.text}</span>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-between border-t border-cyber-800/80 text-xs font-mono">
                    <span className="text-slate-400 truncate">
                      Internal service: <span className="text-slate-300">https://{cluster.name}.{cluster.namespace}.svc.cluster.local:443</span>
                    </span>
                    {isUsingCustomEndpoint && (
                      <button
                        onClick={() => handleSaveEndpoint(true)}
                        disabled={savingEndpoint}
                        className="text-xs text-rose-400 hover:text-rose-300 hover:underline transition-colors shrink-0 ml-2"
                      >
                        Reset to Internal
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Informative Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-3">
                  <span className="font-bold text-cyan-400 flex items-center gap-1.5 mb-1">
                    <Layers className="w-3.5 h-3.5" />
                    Automatic TLS SAN Certificate
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Custom endpoints are added to <code className="text-slate-300">controlPlane.proxy.extraSANs</code>. TLS connections will not throw certificate mismatch errors.
                  </p>
                </div>

                <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-3">
                  <span className="font-bold text-purple-400 flex items-center gap-1.5 mb-1">
                    <Globe className="w-3.5 h-3.5" />
                    Dynamic Kubeconfig Server
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Both the Admin and OIDC Kubeconfig outputs embed this endpoint in their <code className="text-slate-300">server:</code> cluster block.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: OIDC PROVIDER SETUP                              */}
          {/* ======================================================== */}
          {isAdmin && activeTab === 'settings' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="bg-cyber-950/80 border border-cyber-800 rounded-xl p-4 space-y-4">
                {/* Profile Mode Selector */}
                <div className="pb-3 border-b border-cyber-800">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    OIDC Configuration Source & Inheritance
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => applyProfileTemplate('global')}
                      className={`p-2.5 rounded-xl border text-left text-xs font-mono transition-all ${
                        oidcProfileMode === 'global'
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-200'
                          : 'bg-cyber-900 border-cyber-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1">
                        <Globe className="w-3 h-3 text-blue-400" />
                        Global Fleet Policy
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 truncate">
                        {fleetRegistry?.global?.enabled ? 'Active Global IdP' : 'Global Default'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => applyProfileTemplate('group')}
                      disabled={!matchingGroupProfile}
                      className={`p-2.5 rounded-xl border text-left text-xs font-mono transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                        oidcProfileMode === 'group'
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
                          : 'bg-cyber-900 border-cyber-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1">
                        <Tag className="w-3 h-3 text-indigo-400" />
                        Group Profile
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 truncate">
                        {matchingGroupProfile ? `Inherit group "${matchingGroupProfile}"` : 'No group profile'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOidcProfileMode('custom')}
                      className={`p-2.5 rounded-xl border text-left text-xs font-mono transition-all ${
                        oidcProfileMode === 'custom'
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-200'
                          : 'bg-cyber-900 border-cyber-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold flex items-center gap-1">
                        <Settings className="w-3 h-3 text-purple-400" />
                        Custom Override
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 truncate">
                        Specific to this cluster
                      </div>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pb-3 border-b border-cyber-800">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Settings className="w-4 h-4 text-purple-400" />
                      OpenID Connect (OIDC) Control Plane Settings
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Configures the virtual Kubernetes API server with OIDC flags for token authentication.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={oidcEnabled}
                      onChange={(e) => setOidcEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    <span className="ml-2.5 text-xs font-bold text-slate-200">
                      {oidcEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>

                {oidcEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
                    <div className="md:col-span-2">
                      <label className="block font-medium text-slate-300 mb-1">
                        OIDC Issuer URL <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={oidcIssuerUrl}
                        onChange={(e) => {
                          setOidcIssuerUrl(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="e.g. https://accounts.google.com or https://keycloak.example.com/realms/master"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        OIDC Client ID <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={oidcClientId}
                        onChange={(e) => {
                          setOidcClientId(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="e.g. vcluster-client"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Extra Scopes (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={oidcExtraScopes}
                        onChange={(e) => {
                          setOidcExtraScopes(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="email, profile, groups"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Username Claim
                      </label>
                      <input
                        type="text"
                        value={oidcUsernameClaim}
                        onChange={(e) => {
                          setOidcUsernameClaim(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="email"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Groups Claim
                      </label>
                      <input
                        type="text"
                        value={oidcGroupsClaim}
                        onChange={(e) => {
                          setOidcGroupsClaim(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="groups"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Username Prefix (optional)
                      </label>
                      <input
                        type="text"
                        value={oidcUsernamePrefix}
                        onChange={(e) => {
                          setOidcUsernamePrefix(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="e.g. oidc: or leave blank"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    <div>
                      <label className="block font-medium text-slate-300 mb-1">
                        Groups Prefix (optional)
                      </label>
                      <input
                        type="text"
                        value={oidcGroupsPrefix}
                        onChange={(e) => {
                          setOidcGroupsPrefix(e.target.value);
                          setOidcProfileMode('custom');
                        }}
                        placeholder="e.g. oidc: or leave blank"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>

                    {/* Custom CA / TLS Trust Store */}
                    <div className="md:col-span-2 pt-3 border-t border-cyber-800">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                          Custom CA Certificate (Self-Signed / Internal PKI)
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowCaConfig(!showCaConfig)}
                          className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                        >
                          {showCaConfig ? 'Hide' : oidcCaCert || oidcCaSecret ? 'Configured' : 'Configure Custom CA'}
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                        Trust self-signed or enterprise PKI certificates. Automatically mounted to <code className="text-slate-400">/etc/ssl/custom-ca/ca.crt</code> in vCluster pods, passed to <code className="text-slate-400">--oidc-ca-file</code>, and injected into client PKCE kubeconfigs.
                      </p>

                      {showCaConfig && (
                        <div className="space-y-3 bg-cyber-900/60 p-3 rounded-xl border border-cyber-800 animate-in fade-in duration-100">
                          <div>
                            <label className="block text-[11px] font-mono text-slate-300 mb-1">
                              Raw CA Certificate (PEM format)
                            </label>
                            <textarea
                              rows={3}
                              value={oidcCaCert}
                              onChange={(e) => {
                                setOidcCaCert(e.target.value);
                                setOidcProfileMode('custom');
                              }}
                              placeholder="-----BEGIN CERTIFICATE-----&#10;MIID...&#10;-----END CERTIFICATE-----"
                              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400 select-all"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-mono text-slate-300 mb-1">
                              Or Reference Existing Kubernetes Secret Name (in {cluster.namespace})
                            </label>
                            <input
                              type="text"
                              value={oidcCaSecret}
                              onChange={(e) => {
                                setOidcCaSecret(e.target.value);
                                setOidcProfileMode('custom');
                              }}
                              placeholder="e.g. corp-ca-secret"
                              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* RBAC notice */}
                <div className="bg-cyber-900 border border-cyber-700/60 rounded-xl p-3 flex items-start gap-2.5 text-xs text-slate-300">
                  <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-semibold text-white">RBAC Integration & Claims Delegation</span>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Claims returned by your IdP map to Authorized User Emails and Authorized Groups configured in the cluster's Access & RBAC settings.
                    </p>
                  </div>
                </div>

                {oidcMessage && (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      oidcMessage.error
                        ? 'bg-rose-950/30 border-rose-500/30 text-rose-300'
                        : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    }`}
                  >
                    {oidcMessage.error ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
                    <span>{oidcMessage.text}</span>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleSaveOidc}
                    disabled={savingOidc}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {savingOidc ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Save OIDC Settings
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-cyber-800 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-200 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
