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
} from 'lucide-react';
import type { VirtualCluster } from '../lib/types';

interface IstioModalProps {
  cluster: VirtualCluster;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: VirtualCluster) => void;
}

export const IstioModal: React.FC<IstioModalProps> = ({
  cluster,
  isOpen,
  onClose,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const currentIstio = cluster.spec.components?.istio;

  const [enabled, setEnabled] = useState<boolean>(currentIstio?.enabled ?? false);
  const [meshEnabled, setMeshEnabled] = useState<boolean>(currentIstio?.meshEnabled ?? false);
  const [certIssuerKind, setCertIssuerKind] = useState<'ClusterIssuer' | 'Issuer'>(
    (currentIstio?.certificateIssuerKind as any) === 'Issuer' ? 'Issuer' : 'ClusterIssuer'
  );
  const [certIssuer, setCertIssuer] = useState<string>(currentIstio?.certificateIssuer ?? '');
  const [hosts, setHosts] = useState<string>(
    currentIstio?.hosts?.join(', ') || cluster.spec.customEndpoint || `${cluster.name}.example.com`
  );

  const [hostIssuers, setHostIssuers] = useState<{
    installed: boolean;
    clusterIssuers: string[];
    issuers: string[];
    error?: string;
  }>({ installed: false, clusterIssuers: [], issuers: [] });

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cert-manager/issuers')
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setHostIssuers(data);
          if (!certIssuer && data.clusterIssuers?.length > 0) {
            setCertIssuer(data.clusterIssuers[0]);
          }
        }
      })
      .catch((e) => console.warn('Failed loading cert-manager issuers:', e));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const parsedHosts = hosts
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/istio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          meshEnabled,
          certificateIssuer: certIssuer.trim(),
          certificateIssuerKind: certIssuerKind,
          hosts: parsedHosts,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update Istio configuration');
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

  return (
    <div className="fixed inset-0 bg-cyber-950/45 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-cyber-900 border border-cyber-700 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyber-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 text-cyan-400 border border-cyan-500/30 rounded-xl">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Opinionated Istio Ingress & Entrypoint
                <span className="text-[10px] font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800">
                  vCluster Stack
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Configure ingress gateway, HTTP to HTTPS redirection, and Cert-Manager TLS.
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

          {/* Toggle Enable Istio */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">Enable Istio Ingress Gateway</span>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                  Port 80 & 443
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Deploys <code className="text-cyan-300">istiod</code> and <code className="text-cyan-300">istio-ingressgateway</code> with automated port 80 to 443 HTTPS upgrade.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          {enabled && (
            <>
              {/* Toggle Service Mesh */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-cyber-950/60 border border-cyber-800">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">Service Mesh Sidecar Injection</span>
                    <span className="text-[10px] font-mono text-slate-400 bg-cyber-800 px-1.5 py-0.5 rounded">
                      Optional
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Disabled by default (gateway-only mode). When enabled, guest workloads can inject Envoy sidecars for mTLS.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={meshEnabled}
                    onChange={(e) => setMeshEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Host Cert-Manager Issuer Selection */}
              <div className="p-4 rounded-xl bg-cyber-950/60 border border-cyber-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Host Cert-Manager TLS Issuer</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="modalCertIssuerKind"
                        value="ClusterIssuer"
                        checked={certIssuerKind === 'ClusterIssuer'}
                        onChange={() => setCertIssuerKind('ClusterIssuer')}
                        className="text-cyan-500 focus:ring-cyan-500"
                      />
                      ClusterIssuer
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="modalCertIssuerKind"
                        value="Issuer"
                        checked={certIssuerKind === 'Issuer'}
                        onChange={() => setCertIssuerKind('Issuer')}
                        className="text-cyan-500 focus:ring-cyan-500"
                      />
                      Issuer
                    </label>
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    value={certIssuer}
                    onChange={(e) => setCertIssuer(e.target.value)}
                    placeholder="e.g. letsencrypt-prod, vault-issuer, selfsigned-ca"
                    list="modal-discovered-issuers"
                    className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                  <datalist id="modal-discovered-issuers">
                    {(certIssuerKind === 'ClusterIssuer' ? hostIssuers.clusterIssuers : hostIssuers.issuers)?.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>

                {/* Pre-validation Alert Check */}
                {certIssuer.trim() && (
                  <div>
                    {!hostIssuers.installed ? (
                      <div className="p-2.5 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <strong>Cert-Manager Missing:</strong> cert-manager CRDs not detected on host. Operator deployment will abort.
                        </div>
                      </div>
                    ) : !isIssuerValid ? (
                      <div className="p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <strong>Issuer Not Found:</strong> {certIssuerKind} <code className="text-white font-mono">{certIssuer.trim()}</code> was not detected on host. Operator will fail-closed and abort.
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>Verified on host cluster ({certIssuerKind}).</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Ingress Hostnames */}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Ingress Hostnames (Comma-separated FQDNs)
                </label>
                <input
                  type="text"
                  value={hosts}
                  onChange={(e) => setHosts(e.target.value)}
                  placeholder="e.g. apps.example.com, api.example.com"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Bound to Istio Gateway and main-entrypoint VirtualService.
                </p>
              </div>
            </>
          )}

          {/* Footer Buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-cyber-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save & Reconcile
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
