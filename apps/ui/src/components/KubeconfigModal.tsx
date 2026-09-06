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
} from 'lucide-react';
import type { VirtualCluster, OidcConfig } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'admin' | 'oidc' | 'endpoint' | 'settings';
  onClusterUpdated?: () => void;
}

export const KubeconfigModal: React.FC<Props> = ({
  cluster,
  isOpen,
  onClose,
  initialTab = 'admin',
  onClusterUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'admin' | 'oidc' | 'endpoint' | 'settings'>(initialTab);
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [rawKubeconfig, setRawKubeconfig] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Endpoint configuration state
  const [customEndpointInput, setCustomEndpointInput] = useState<string>('');
  const [savingEndpoint, setSavingEndpoint] = useState(false);
  const [endpointMessage, setEndpointMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // OIDC configuration state
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

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (cluster && isOpen) {
      setCustomEndpointInput(cluster.metadata?.customEndpoint || '');

      const currentOidc = cluster.metadata?.oidc;
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

      fetchKubeconfig(activeTab === 'oidc' ? 'oidc' : 'admin');
    }
  }, [cluster, isOpen, activeTab]);

  const fetchKubeconfig = (type: 'admin' | 'oidc') => {
    if (!cluster) return;
    setLoading(true);
    fetch(`/api/vclusters/${cluster.name}/kubeconfig?type=${type}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.kubeconfig) setRawKubeconfig(data.kubeconfig);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  if (!isOpen || !cluster) return null;

  const currentActiveEndpoint =
    cluster.metadata?.customEndpoint ||
    cluster.status.endpoint ||
    `https://${cluster.name}.${cluster.namespace}.svc.cluster.local:443`;
  const isUsingCustomEndpoint = Boolean(cluster.metadata?.customEndpoint);

  const cliSnippet = `vcluster connect ${cluster.name} --namespace ${cluster.namespace}`;
  const kubectlSnippet =
    activeTab === 'oidc'
      ? `kubectl --kubeconfig=${cluster.name}-oidc-kubeconfig.yaml get pods -A`
      : `kubectl --kubeconfig=${cluster.name}-kubeconfig.yaml get pods -A`;

  const copyToClipboard = (text: string, type: 'cli' | 'raw') => {
    navigator.clipboard.writeText(text);
    if (type === 'cli') {
      setCopiedCli(true);
      setTimeout(() => setCopiedCli(false), 2000);
    } else {
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    }
  };

  const handleDownload = () => {
    const typeParam = activeTab === 'oidc' ? '&type=oidc' : '&type=admin';
    window.open(`/api/vclusters/${cluster.name}/kubeconfig?download=true${typeParam}`, '_blank');
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
      fetchKubeconfig(activeTab === 'oidc' ? 'oidc' : 'admin');
      if (onClusterUpdated) onClusterUpdated();
    } catch (err: any) {
      setEndpointMessage({ text: err.message || 'Error updating endpoint', error: true });
    } finally {
      setSavingEndpoint(false);
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
          ? 'OIDC configured successfully! vCluster control plane is updating.'
          : 'OIDC disabled on virtual cluster.',
      });
      fetchKubeconfig('oidc');
      if (onClusterUpdated) onClusterUpdated();
    } catch (err: any) {
      setOidcMessage({ text: err.message || 'Error updating OIDC configuration', error: true });
    } finally {
      setSavingOidc(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl bg-cyber-900 border border-cyber-700/80 rounded-2xl shadow-2xl p-6 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Glow Accent */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>

        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyber-800 rounded-xl border border-cyber-700 text-cyan-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white tracking-wide">
                  Access & Kubeconfig: <span className="font-mono text-cyan-400">{cluster.name}</span>
                </h2>
                {isUsingCustomEndpoint ? (
                  <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px] font-mono">
                    Custom Ingress/VS
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 text-[10px] font-mono">
                    Internal ClusterIP
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xl font-mono">
                API Endpoint: <span className="text-slate-300">{currentActiveEndpoint}</span>
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
        <div className="flex items-center border-b border-cyber-800 mb-5 gap-2 overflow-x-auto pb-1 shrink-0">
          <button
            onClick={() => setActiveTab('admin')}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'admin'
                ? 'bg-cyber-800 text-cyan-400 border border-cyber-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            Admin / Breakglass
          </button>

          <button
            onClick={() => setActiveTab('oidc')}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'oidc'
                ? 'bg-cyber-800 text-cyan-400 border border-cyber-700 shadow-sm'
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
            onClick={() => setActiveTab('endpoint')}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'endpoint'
                ? 'bg-cyber-800 text-cyan-400 border border-cyber-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            API Endpoint & Routing
            {isUsingCustomEndpoint && <span className="w-2 h-2 rounded-full bg-purple-400"></span>}
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-cyber-800 text-cyan-400 border border-cyber-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-850'
            }`}
          >
            <Settings className="w-3.5 h-3.5 text-amber-400" />
            OIDC Provider Setup
          </button>
        </div>

        {/* Tab Contents (Scrollable) */}
        <div className="overflow-y-auto pr-1 flex-1 space-y-5">
          {/* TAB 1: ADMIN KUBECONFIG */}
          {activeTab === 'admin' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* Option 1: CLI Connect */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  Direct vCluster CLI Port-Forward
                </label>
                <div className="relative flex items-center bg-cyber-950/80 border border-cyber-800 rounded-xl px-4 py-2.5 font-mono text-xs text-slate-200">
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

              {/* Option 2: Direct Admin Kubeconfig */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-cyan-400" />
                    Admin Kubeconfig File (Direct Credentials)
                  </label>
                  <button
                    onClick={handleDownload}
                    className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-xs rounded-lg shadow-glow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Kubeconfig (.yaml)
                  </button>
                </div>

                <div className="relative bg-cyber-950/90 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 max-h-56 overflow-y-auto">
                  {loading ? (
                    <div className="py-8 text-center text-slate-500 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                      Loading credentials...
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap leading-relaxed">{rawKubeconfig}</pre>
                  )}
                  <button
                    onClick={() => copyToClipboard(rawKubeconfig, 'raw')}
                    className="absolute top-2.5 right-2.5 p-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-300 rounded-md border border-cyber-700 shadow-sm"
                    title="Copy Kubeconfig"
                  >
                    {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Kubectl Run Example */}
              <div className="bg-cyber-950/60 border border-cyber-800 rounded-xl p-3 flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="truncate">
                  Run: <span className="text-cyan-300">{kubectlSnippet}</span>
                </span>
                <button
                  onClick={() => copyToClipboard(kubectlSnippet, 'cli')}
                  className="ml-2 text-slate-400 hover:text-white"
                  title="Copy command"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: OIDC KUBECONFIG (PKCE) */}
          {activeTab === 'oidc' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* OIDC Banner / Status */}
              {cluster.metadata?.oidc?.enabled ? (
                <div className="bg-gradient-to-r from-purple-950/40 via-purple-900/30 to-cyber-950 border border-purple-500/30 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/30 shrink-0">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          PKCE OIDC Authentication Active
                        </h4>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono">
                          Zero Secret Storage
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        This kubeconfig executes{' '}
                        <code className="text-purple-300 bg-purple-950/80 px-1 py-0.5 rounded border border-purple-800">
                          kubectl oidc-login
                        </code>{' '}
                        using RFC 7636 Proof Key for Code Exchange (PKCE). No client secrets are stored in this file.
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400">
                        <span>Issuer: <strong className="text-slate-200">{cluster.metadata.oidc.issuerUrl}</strong></span>
                        <span>Client ID: <strong className="text-slate-200">{cluster.metadata.oidc.clientId}</strong></span>
                        <span>User Claim: <strong className="text-cyan-400">{cluster.metadata.oidc.usernameClaim || 'email'}</strong></span>
                        <span>Groups Claim: <strong className="text-purple-400">{cluster.metadata.oidc.groupsClaim || 'groups'}</strong></span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-xs font-bold text-amber-300">OIDC is not yet enabled on this cluster</h4>
                    <p className="text-xs text-slate-300 mt-1">
                      The kubeconfig below shows the generated PKCE configuration. To activate OIDC token verification on the virtual API server, enable and configure your OIDC identity provider.
                    </p>
                    <button
                      onClick={() => setActiveTab('settings')}
                      className="mt-3 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      Configure OIDC Identity Provider
                    </button>
                  </div>
                </div>
              )}

              {/* OIDC Kubeconfig Viewer */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-purple-400" />
                    OIDC (PKCE) Kubeconfig File
                  </label>
                  <button
                    onClick={handleDownload}
                    className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-medium text-xs rounded-lg shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download OIDC Kubeconfig (.yaml)
                  </button>
                </div>

                <div className="relative bg-cyber-950/90 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 max-h-56 overflow-y-auto">
                  {loading ? (
                    <div className="py-8 text-center text-slate-500 flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                      Generating OIDC credentials...
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap leading-relaxed">{rawKubeconfig}</pre>
                  )}
                  <button
                    onClick={() => copyToClipboard(rawKubeconfig, 'raw')}
                    className="absolute top-2.5 right-2.5 p-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-300 rounded-md border border-cyber-700 shadow-sm"
                    title="Copy Kubeconfig"
                  >
                    {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Kubelogin Instructions */}
              <div className="bg-cyber-950/80 border border-cyber-800 rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-purple-400" />
                  How to authenticate with this kubeconfig:
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1 bg-cyber-900/60 p-2.5 rounded-lg border border-cyber-800">
                  <div className="text-slate-500 select-none"># 1. Ensure kubelogin plugin is installed</div>
                  <div className="text-purple-300">kubectl krew install oidc-login</div>
                  <div className="text-slate-500 select-none pt-1"># 2. Run kubectl command (browser will open for PKCE login)</div>
                  <div className="text-cyan-300">{kubectlSnippet}</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ENDPOINT & ROUTING SETTINGS */}
          {activeTab === 'endpoint' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="bg-cyber-950/80 border border-cyber-800 rounded-xl p-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  Kubernetes API Endpoint Configuration
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Override the default internal ClusterIP endpoint if accessing this virtual cluster via an Ingress controller, Istio/Envoy VirtualService, or external LoadBalancer.
                  The vCluster control plane will automatically add this hostname/IP to its TLS Subject Alternative Names (SANs).
                </p>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      External API Server Endpoint URL
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={customEndpointInput}
                        onChange={(e) => setCustomEndpointInput(e.target.value)}
                        placeholder="e.g. https://vc-dev.example.com or https://ingress.k8s.local:443"
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
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Must start with <code className="text-slate-400">https://</code> or <code className="text-slate-400">http://</code>.
                    </p>
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

                  <div className="pt-2 flex items-center justify-between border-t border-cyber-800/80">
                    <div className="text-[11px] text-slate-400 font-mono">
                      Default internal endpoint: <span className="text-slate-300">https://{cluster.name}.{cluster.namespace}.svc.cluster.local:443</span>
                    </div>
                    {isUsingCustomEndpoint && (
                      <button
                        onClick={() => handleSaveEndpoint(true)}
                        disabled={savingEndpoint}
                        className="text-xs text-rose-400 hover:text-rose-300 hover:underline transition-colors"
                      >
                        Reset to Internal Service
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-3 text-xs">
                  <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1 text-cyan-400">
                    <Layers className="w-3.5 h-3.5" />
                    Automatic TLS SAN Certificate
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    When you save a custom endpoint, the hostname is injected into <code className="text-slate-300">controlPlane.proxy.extraSANs</code> so TLS connections will not throw certificate mismatch warnings.
                  </p>
                </div>

                <div className="bg-cyber-950 border border-cyber-800 rounded-xl p-3 text-xs">
                  <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1 text-purple-400">
                    <Globe className="w-3.5 h-3.5" />
                    Kubeconfig Dynamic Server
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Both the Admin and OIDC Kubeconfig outputs will immediately embed this custom endpoint as their <code className="text-slate-300">server:</code> URL.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: OIDC PROVIDER SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="bg-cyber-950/80 border border-cyber-800 rounded-xl p-4 space-y-4">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        OIDC Issuer URL <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={oidcIssuerUrl}
                        onChange={(e) => setOidcIssuerUrl(e.target.value)}
                        placeholder="e.g. https://accounts.google.com or https://keycloak.example.com/realms/master"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        The URL of the OpenID provider which hosts <code className="text-slate-400">/.well-known/openid-configuration</code>.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        OIDC Client ID <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={oidcClientId}
                        onChange={(e) => setOidcClientId(e.target.value)}
                        placeholder="e.g. vcluster-client"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Audience claim configured on the IdP client.</p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Extra Scopes (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={oidcExtraScopes}
                        onChange={(e) => setOidcExtraScopes(e.target.value)}
                        placeholder="email, profile, groups"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Requested during PKCE interactive login.</p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Username Claim (Email Claim)
                      </label>
                      <input
                        type="text"
                        value={oidcUsernameClaim}
                        onChange={(e) => setOidcUsernameClaim(e.target.value)}
                        placeholder="email"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        JWT claim to use as user identity (default: <code className="text-slate-400">email</code>).
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Username Prefix (optional)
                      </label>
                      <input
                        type="text"
                        value={oidcUsernamePrefix}
                        onChange={(e) => setOidcUsernamePrefix(e.target.value)}
                        placeholder="e.g. oidc: or leave blank"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Prefix prepended to user claim value.</p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Groups Claim
                      </label>
                      <input
                        type="text"
                        value={oidcGroupsClaim}
                        onChange={(e) => setOidcGroupsClaim(e.target.value)}
                        placeholder="groups"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        JWT claim to use for user group memberships (default: <code className="text-slate-400">groups</code>).
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Groups Prefix (optional)
                      </label>
                      <input
                        type="text"
                        value={oidcGroupsPrefix}
                        onChange={(e) => setOidcGroupsPrefix(e.target.value)}
                        placeholder="e.g. oidc: or leave blank"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Prefix prepended to group names.</p>
                    </div>
                  </div>
                )}

                {/* RBAC Integration Info */}
                <div className="bg-cyber-900 border border-cyber-700/60 rounded-xl p-3 flex items-start gap-3 text-xs text-slate-300">
                  <ShieldCheck className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-semibold text-white">RBAC Integration & Claims Authorization</span>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Claims returned by your IdP will be matched against the cluster's{' '}
                      <strong className="text-slate-300">Authorized User Emails</strong> and{' '}
                      <strong className="text-slate-300">Authorized Groups</strong> configured in the{' '}
                      <em className="text-cyan-400 not-italic">Cluster Access & RBAC</em> tab.
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
        <div className="mt-5 pt-3 border-t border-cyber-800 flex justify-end shrink-0">
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
