import React, { useState, useEffect } from 'react';
import {
  Globe,
  Shield,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  ExternalLink,
  Layers,
  Network,
  Zap,
} from 'lucide-react';
import type { VirtualCluster } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface GatewayAPIModalProps {
  cluster: VirtualCluster;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: VirtualCluster) => void;
}

export const GatewayAPIModal: React.FC<GatewayAPIModalProps> = ({
  cluster,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const currentGW = cluster?.spec?.components?.gatewayAPI;

  const [enabled, setEnabled] = useState<boolean>(currentGW?.enabled ?? false);
  const [gatewayClassName, setGatewayClassName] = useState<string>(currentGW?.gatewayClassName || 'eg');
  const [certIssuerKind, setCertIssuerKind] = useState<'ClusterIssuer' | 'Issuer'>(
    (currentGW?.certificateIssuerKind as any) === 'Issuer' ? 'Issuer' : 'ClusterIssuer'
  );
  const [certIssuer, setCertIssuer] = useState<string>(currentGW?.certificateIssuer ?? '');
  const [hosts, setHosts] = useState<string>(
    currentGW?.hosts?.join(', ') || cluster?.spec?.customEndpoint || (cluster?.name ? `${cluster.name}.example.com` : '')
  );

  // Host Ingress Routing
  const [enableHostRouting, setEnableHostRouting] = useState<boolean>(
    currentGW?.hostRouting?.enabled ?? true
  );
  const [hostDefaultGateway, setHostDefaultGateway] = useState<string>(
    currentGW?.hostRouting?.defaultGateway || 'envoy-gateway-system/eg'
  );
  const [hostApiHost, setHostApiHost] = useState<string>(
    currentGW?.hostRouting?.apiHost || ''
  );

  const [hostIssuers, setHostIssuers] = useState<{
    installed: boolean;
    clusterIssuers: string[];
    issuers: string[];
    error?: string;
  }>({ installed: false, clusterIssuers: [], issuers: [] });

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronize state from props whenever modal opens or cluster updates
  useEffect(() => {
    if (!isOpen || !cluster) return;
    const current = cluster.spec?.components?.gatewayAPI;
    setEnabled(current?.enabled ?? false);
    setGatewayClassName(current?.gatewayClassName || 'eg');
    setCertIssuerKind(
      (current?.certificateIssuerKind as any) === 'Issuer' ? 'Issuer' : 'ClusterIssuer'
    );
    setCertIssuer(current?.certificateIssuer ?? '');
    setHosts(
      current?.hosts?.join(', ') || cluster.spec?.customEndpoint || `${cluster.name}.example.com`
    );
    setEnableHostRouting(current?.hostRouting?.enabled ?? true);
    setHostDefaultGateway(
      current?.hostRouting?.defaultGateway || 'envoy-gateway-system/eg'
    );
    setHostApiHost(current?.hostRouting?.apiHost || '');
    setError(null);
  }, [isOpen, cluster]);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/cert-manager/issuers')
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setHostIssuers(data);
          if (data.clusterIssuers && data.clusterIssuers.length > 0) {
            setCertIssuer((prev) => {
              if (!prev || !data.clusterIssuers.includes(prev)) {
                return data.clusterIssuers[0];
              }
              return prev;
            });
          }
        }
      })
      .catch((e) => console.warn('Failed loading cert-manager issuers:', e));
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cluster) return;
    setLoading(true);
    setError(null);

    const parsedHosts = hosts
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/gateway-api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          gatewayClassName: gatewayClassName.trim() || 'eg',
          certificateIssuer: certIssuer.trim(),
          certificateIssuerKind: certIssuerKind,
          hosts: parsedHosts,
          version: cluster.spec?.components?.gatewayAPI?.version,
          hostRouting: enableHostRouting
            ? {
                enabled: true,
                defaultGateway: hostDefaultGateway.trim() || 'envoy-gateway-system/eg',
                apiHost: hostApiHost.trim() || undefined,
              }
            : { enabled: false },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update Gateway API configuration');
      }

      onSuccess(data.cluster);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isIssuerValid =
    hostIssuers.installed &&
    (certIssuerKind === 'ClusterIssuer'
      ? hostIssuers.clusterIssuers.includes(certIssuer.trim())
      : hostIssuers.issuers.includes(certIssuer.trim()));

  if (!isOpen || !cluster) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
        <div className="bg-cyber-900 border border-cyber-700 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 my-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-gradient-to-br from-emerald-500/20 to-cyan-600/20 text-emerald-400 border border-emerald-500/30 rounded-xl">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  Kubernetes Gateway API Entrypoint
                  <span className="text-[10px] font-mono uppercase bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded border border-emerald-800">
                    Gateway API
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Configure Gateway, HTTPRoute 301 redirects, and Cert-Manager TLS integration.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-cyber-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content Form */}
          <form onSubmit={handleSave} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Master Toggle */}
            <div className="flex items-center justify-between p-4 bg-cyber-950 border border-cyber-800 rounded-xl">
              <div>
                <span className="text-sm font-bold text-white block">Enable Gateway API Entrypoint</span>
                <span className="text-xs text-slate-400">
                  Reconciles Gateway API CRDs, Gateway, HTTPRoute, and entrypoint proxy inside the virtual cluster.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>

            {enabled && (
              <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                {/* HA Notice */}
                {cluster.spec?.highAvailability && (
                  <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center gap-2">
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>High Availability Active: Gateway proxy provisioned with 3 replicas.</span>
                  </div>
                )}

                {/* GatewayClass & FQDN */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                      GatewayClass Name
                    </label>
                    <input
                      type="text"
                      value={gatewayClassName}
                      onChange={(e) => setGatewayClassName(e.target.value)}
                      placeholder="eg"
                      className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Default Envoy Gateway class is "eg".</p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                      Entrypoint Host FQDN
                    </label>
                    <input
                      type="text"
                      value={hosts}
                      onChange={(e) => setHosts(e.target.value)}
                      placeholder="e.g. vc-dev.local, *.vc-dev.local"
                      className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">Comma-separated domain hostnames.</p>
                  </div>
                </div>

                {/* Cert-Manager Host Issuer Configuration */}
                <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Host Cert-Manager TLS Issuer</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="radio"
                          name="gwCertIssuerKind"
                          value="ClusterIssuer"
                          checked={certIssuerKind === 'ClusterIssuer'}
                          onChange={() => setCertIssuerKind('ClusterIssuer')}
                          className="text-emerald-500 focus:ring-emerald-500"
                        />
                        ClusterIssuer
                      </label>
                      <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="radio"
                          name="gwCertIssuerKind"
                          value="Issuer"
                          checked={certIssuerKind === 'Issuer'}
                          onChange={() => setCertIssuerKind('Issuer')}
                          className="text-emerald-500 focus:ring-emerald-500"
                        />
                        Issuer (Namespace)
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                      Certificate Issuer Name
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={certIssuer}
                        onChange={(e) => setCertIssuer(e.target.value)}
                        placeholder="e.g. local-ca-issuer, letsencrypt-prod"
                        list="discovered-gw-issuers-list"
                        className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                      />
                      <datalist id="discovered-gw-issuers-list">
                        {(certIssuerKind === 'ClusterIssuer' ? hostIssuers.clusterIssuers : hostIssuers.issuers)?.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  {certIssuer.trim() && (
                    <div>
                      {isIssuerValid ? (
                        <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>Valid {certIssuerKind} <strong className="font-mono text-white">{certIssuer.trim()}</strong> verified on host.</span>
                        </div>
                      ) : (
                        <div className="p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <span>Issuer <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono text-white">{certIssuer.trim()}</code> was not detected on the host cluster.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Host Routing Toggle */}
                <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Network className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-bold text-slate-200">Host Gateway API Ingress & API Routing</span>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800">
                          Host Integration
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Deploys host HTTPRoutes to route external HTTP 80 and HTTPS 443 traffic directly to this virtual cluster.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={enableHostRouting}
                        onChange={(e) => setEnableHostRouting(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>

                  {enableHostRouting && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-cyber-800/80">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Default Host Gateway
                        </label>
                        <input
                          type="text"
                          value={hostDefaultGateway}
                          onChange={(e) => setHostDefaultGateway(e.target.value)}
                          placeholder="envoy-gateway-system/eg"
                          className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Host gateway reference (namespace/name).</p>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          vCluster API Hostname
                        </label>
                        <input
                          type="text"
                          value={hostApiHost}
                          onChange={(e) => setHostApiHost(e.target.value)}
                          placeholder={cluster.name ? `api.${cluster.name}.local` : 'api.cluster.local'}
                          className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">External hostname for vCluster K8s API.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-cyber-800">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-semibold rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-glow-sm"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Gateway API Settings</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
};
