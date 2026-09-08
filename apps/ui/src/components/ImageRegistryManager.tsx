import React, { useState, useEffect } from 'react';
import {
  Globe,
  Copy,
  Check,
  Download,
  Terminal,
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  Layers,
  FileText,
  Sparkles,
} from 'lucide-react';
import type { ImageRegistryConfig, ResolvedImageItem } from '../lib/image-registry';

interface Props {
  isAdmin: boolean;
}

export const ImageRegistryManager: React.FC<Props> = ({ isAdmin }) => {
  const [config, setConfig] = useState<ImageRegistryConfig>({
    targetRegistry: '',
    swapFrom: '',
    swapTo: '',
    flatten: true,
    rules: [],
  });
  const [images, setImages] = useState<ResolvedImageItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live tester state
  const [testInput, setTestInput] = useState<string>('harbor.com/loft-sh/vcluster-oss:0.36.0');
  const [testOutput, setTestOutput] = useState<string>('');

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/registry/config');
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch image registry settings');
      }
      setConfig(data.data.config);
      setImages(data.data.images);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // Recalculate test rewrite dynamically
  useEffect(() => {
    if (!testInput.trim()) {
      setTestOutput('');
      return;
    }

    // Call fast test endpoint or client rewrite
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/registry/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'testRewrite',
            image: testInput.trim(),
            targetRegistry: config.targetRegistry,
            swapFrom: config.swapFrom,
            swapTo: config.swapTo,
            flatten: config.flatten,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setTestOutput(data.rewritten);
        }
      } catch {
        // fallback
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [testInput, config.targetRegistry, config.swapFrom, config.swapTo, config.flatten]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/registry/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRegistry: config.targetRegistry,
          swapFrom: config.swapFrom,
          swapTo: config.swapTo,
          flatten: config.flatten,
          rules: config.rules,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save registry configuration');
      }

      setConfig(data.data.config);
      setImages(data.data.images);
      setSuccessMsg('Registry configuration saved and applied to cluster ConfigMap (vcop-image-registry).');
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const downloadFile = (format: 'txt' | 'yaml' | 'json' | 'sync') => {
    window.location.href = `/api/registry/images?format=${format}&download=true`;
  };

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Control Center Configuration Box */}
      <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-cyber-800">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl border bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-glow-sm">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Image Registry & FQDN Swapper
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-cyan-500/10 border-cyan-500/30 text-cyan-400">
                  Air-Gap Relocation
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Configure cluster-wide image FQDN rewrites, registry redirection, and project flattening (e.g. from{' '}
                <code className="text-cyan-300">harbor.com</code> to{' '}
                <code className="text-cyan-300">registry.com/library</code>).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchConfig}
              disabled={loading}
              className="px-3 py-1.5 bg-cyber-950 hover:bg-cyber-850 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-all disabled:opacity-50"
              title="Refresh from cluster ConfigMap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync
            </button>

            {isAdmin && (
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-glow-sm transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save & Apply to Cluster
              </button>
            )}
          </div>
        </div>

        {/* Swap Form Inputs */}
        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <label className="block text-xs font-mono font-semibold text-slate-300 mb-1.5">
              Global Target Registry / Project
            </label>
            <input
              type="text"
              placeholder="e.g. registry.com/library"
              value={config.targetRegistry || ''}
              onChange={(e) => setConfig({ ...config, targetRegistry: e.target.value })}
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <p className="text-[10px] font-mono text-slate-500 mt-1">
              All images will be routed through this registry and project prefix.
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono font-semibold text-slate-300 mb-1.5">
              Swap From (Source FQDN / Prefix)
            </label>
            <input
              type="text"
              placeholder="e.g. harbor.com"
              value={config.swapFrom || ''}
              onChange={(e) => setConfig({ ...config, swapFrom: e.target.value })}
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <p className="text-[10px] font-mono text-slate-500 mt-1">
              Matching source domain or repository prefix to replace.
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono font-semibold text-slate-300 mb-1.5">
              Swap To (Destination Target)
            </label>
            <input
              type="text"
              placeholder="e.g. registry.com/library"
              value={config.swapTo || ''}
              onChange={(e) => setConfig({ ...config, swapTo: e.target.value })}
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 transition-colors"
            />
            <p className="text-[10px] font-mono text-slate-500 mt-1">
              Replacement destination prefix applied to matching images.
            </p>
          </div>

          <div className="md:col-span-3 pt-1 border-t border-cyber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.flatten}
                onChange={(e) => setConfig({ ...config, flatten: e.target.checked })}
                className="w-4 h-4 rounded border-cyber-700 bg-cyber-950 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              <div>
                <span className="text-xs font-mono font-semibold text-slate-200">
                  Flatten Nested Repository Paths (Recommended)
                </span>
                <p className="text-[11px] text-slate-400">
                  Collapses multi-level subdirectories into a single flat project namespace (e.g.{' '}
                  <span className="text-slate-300 font-mono">registry.com/library/vcluster-oss:0.36.0</span> instead of nested namespaces).
                </p>
              </div>
            </label>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] font-mono text-slate-400">Quick presets:</span>
              <button
                type="button"
                onClick={() =>
                  setConfig({
                    ...config,
                    targetRegistry: 'registry.com/library',
                    swapFrom: 'harbor.com',
                    swapTo: 'registry.com/library',
                    flatten: true,
                  })
                }
                className="px-2.5 py-1 bg-cyber-800 hover:bg-cyber-750 text-cyan-300 text-[11px] font-mono rounded-lg border border-cyber-700 transition-colors"
              >
                harbor.com &rarr; registry.com/library
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfig({
                    ...config,
                    targetRegistry: '',
                    swapFrom: '',
                    swapTo: '',
                    flatten: true,
                  })
                }
                className="px-2.5 py-1 bg-cyber-800 hover:bg-cyber-750 text-slate-400 text-[11px] font-mono rounded-lg border border-cyber-700 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Live Sandbox Rewriter Simulator */}
      <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 font-semibold">
          <Sparkles className="w-4 h-4" />
          Live Interactive Image Rewriter Sandbox
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">
              Input Image Reference:
            </label>
            <input
              type="text"
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="e.g. harbor.com/loft-sh/vcluster-oss:0.36.0"
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">
              Effective Rewritten Result:
            </label>
            <div className="flex items-center justify-between gap-2 bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-400 overflow-x-auto min-h-[38px]">
              <span className="truncate">{testOutput || testInput}</span>
              <button
                type="button"
                onClick={() => copyToClipboard(testOutput || testInput, 'test-output')}
                className="p-1 hover:text-white shrink-0"
                title="Copy resolved image"
              >
                {copiedKey === 'test-output' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Manifest Downloads & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-cyber-950 border border-cyber-800 rounded-2xl">
        <div>
          <h3 className="text-xs font-bold font-mono text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            Image Manifests & Air-Gap Tools
          </h3>
          <p className="text-[11px] text-slate-400">
            Export canonical manifests or download the ready-to-run image mirroring script.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => downloadFile('txt')}
            className="px-3 py-1.5 bg-cyber-900 hover:bg-cyber-850 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            vcluster-images.txt
          </button>
          <button
            onClick={() => downloadFile('yaml')}
            className="px-3 py-1.5 bg-cyber-900 hover:bg-cyber-850 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-purple-400" />
            vcluster-images.yaml
          </button>
          <button
            onClick={() => downloadFile('json')}
            className="px-3 py-1.5 bg-cyber-900 hover:bg-cyber-850 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            vcluster-images.json
          </button>
          <button
            onClick={() => downloadFile('sync')}
            className="px-3.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            Download Sync Script (.sh)
          </button>
        </div>
      </div>

      {/* Canonical Images Table */}
      <div className="bg-cyber-900/80 border border-cyber-700/70 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" />
              Canonical Image Manifest ({images.length} Images)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Live mapping of all container images used by virtual cluster control planes and the vCOp platform.
            </p>
          </div>

          <button
            onClick={() => {
              const allImages = images.map((i) => i.resolvedImage).join('\n');
              copyToClipboard(allImages, 'all-images');
            }}
            className="px-3 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-colors"
          >
            {copiedKey === 'all-images' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copied All!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                Copy Image List
              </>
            )}
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-cyber-800">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-cyber-950/80 text-[11px] font-mono uppercase tracking-wider text-slate-400 border-b border-cyber-800">
                <th className="py-3 px-4">Component & Role</th>
                <th className="py-3 px-4">Default Upstream Image</th>
                <th className="py-3 px-4">Effective Rewritten Image</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyber-800/60 text-xs font-mono">
              {images.map((img) => {
                const isRewritten = img.isRewritten;
                return (
                  <tr key={img.component} className="hover:bg-cyber-850/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white flex items-center gap-2">
                        {img.component}
                        <span className="text-[10px] font-normal px-2 py-0.5 rounded-md bg-cyber-800 text-slate-300 border border-cyber-700">
                          {img.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-sans mt-0.5">{img.role}</div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-400">
                      <div className="truncate max-w-xs sm:max-w-sm">{img.defaultImage}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div
                        className={`truncate max-w-xs sm:max-w-sm font-semibold flex items-center gap-1.5 ${
                          isRewritten ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {isRewritten && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />}
                        {img.resolvedImage}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => copyToClipboard(img.resolvedImage, img.component)}
                        className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800 transition-colors inline-flex items-center"
                        title="Copy rewritten image reference"
                      >
                        {copiedKey === img.component ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
