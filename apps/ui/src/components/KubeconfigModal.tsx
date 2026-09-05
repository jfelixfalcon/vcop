import React, { useState, useEffect } from 'react';
import { Terminal, Download, Copy, Check, X, ShieldCheck } from 'lucide-react';
import type { VirtualCluster } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
}

export const KubeconfigModal: React.FC<Props> = ({ cluster, isOpen, onClose }) => {
  const [copiedCli, setCopiedCli] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [rawKubeconfig, setRawKubeconfig] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cluster && isOpen) {
      setLoading(true);
      fetch(`/api/vclusters/${cluster.name}/kubeconfig`)
        .then(res => res.json())
        .then(data => {
          if (data.kubeconfig) setRawKubeconfig(data.kubeconfig);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [cluster, isOpen]);

  if (!isOpen || !cluster) return null;

  const cliSnippet = `vcluster connect ${cluster.name} --namespace ${cluster.namespace}`;
  const kubectlSnippet = `kubectl --kubeconfig=${cluster.name}-kubeconfig.yaml get pods -A`;

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
    window.open(`/api/vclusters/${cluster.name}/kubeconfig?download=true`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700/80 rounded-2xl shadow-2xl p-6 overflow-hidden">
        {/* Glow Accent */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-cyber-accent to-transparent"></div>

        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyber-800 rounded-xl border border-cyber-700 text-cyber-accent">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white tracking-wide">
                Connect to <span className="font-mono text-cyber-accent">{cluster.name}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Standardized admin credentials secured via Kubernetes host Secret
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

        {/* CLI Quick Connect */}
        <div className="mb-6 space-y-2">
          <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyber-accent" />
            Option 1: Connect via vCluster CLI
          </label>
          <div className="relative flex items-center bg-cyber-950/80 border border-cyber-800 rounded-xl px-4 py-3 font-mono text-sm text-slate-200">
            <span className="text-cyber-accent select-none mr-2">$</span>
            <span className="flex-1 overflow-x-auto select-all">{cliSnippet}</span>
            <button
              onClick={() => copyToClipboard(cliSnippet, 'cli')}
              className="ml-3 px-3 py-1 bg-cyber-800 hover:bg-cyber-700 text-slate-200 text-xs rounded-lg border border-cyber-700 flex items-center gap-1.5 transition-colors"
            >
              {copiedCli ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCli ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Option 2: Download or Kubeconfig */}
        <div className="space-y-2 mb-6">
          <div className="flex justify-between items-center">
            <label className="text-xs font-medium text-slate-300">
              Option 2: Direct Kubeconfig File
            </label>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-xs rounded-lg shadow-glow-sm flex items-center gap-1.5 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Download Kubeconfig (.yaml)
            </button>
          </div>

          <div className="relative bg-cyber-950/90 border border-cyber-800 rounded-xl p-3 font-mono text-xs text-slate-300 max-h-48 overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center text-slate-500">Loading credentials...</div>
            ) : (
              <pre className="whitespace-pre-wrap">{rawKubeconfig || '# Kubeconfig generated by vCOp\napiVersion: v1\n...'}</pre>
            )}
            <button
              onClick={() => copyToClipboard(rawKubeconfig, 'raw')}
              className="absolute top-2 right-2 p-1.5 bg-cyber-800 hover:bg-cyber-700 text-slate-300 rounded-md border border-cyber-700"
              title="Copy Kubeconfig"
            >
              {copiedRaw ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Kubectl Run Example */}
        <div className="bg-cyber-850/60 border border-cyber-800 rounded-xl p-3.5 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Run: <span className="text-slate-200">{kubectlSnippet}</span></span>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-200 text-sm font-medium rounded-xl border border-cyber-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
