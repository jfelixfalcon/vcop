import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  History,
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  Package,
  RefreshCw,
  Clock,
  User,
  ArrowRight,
} from 'lucide-react';
import type { InstalledApp, AppRevisionSnapshot, DiffLine } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  clusterName: string;
  app: InstalledApp;
  isOpen: boolean;
  onClose: () => void;
  onRollbackComplete: () => void;
}

export const AppRollbackModal: React.FC<Props> = ({
  clusterName,
  app,
  isOpen,
  onClose,
  onRollbackComplete,
}) => {
  const [revisions, setRevisions] = useState<AppRevisionSnapshot[]>([]);
  const [selectedRev, setSelectedRev] = useState<AppRevisionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<string>('');

  const fetchRevisions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/appstore/vcs/apps/${app.appId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const revs = data.data.revisions || [];
        setRevisions(revs);
        // Default to the first known working version or the latest
        const working = revs.find((r: AppRevisionSnapshot) => r.isWorkingVersion && r.version !== app.version);
        if (working) {
          setSelectedRev(working);
          setCustomValues(working.helm?.values || '');
        } else if (revs.length > 0) {
          setSelectedRev(revs[0]);
          setCustomValues(revs[0].helm?.values || '');
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch app revisions:', err);
      setError('Failed to fetch revisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRevisions();
    }
  }, [isOpen, app.appId]);

  const handleRollback = async () => {
    if (!selectedRev) return;
    setRollingBack(true);
    setError(null);
    try {
      const res = await fetch(`/api/vclusters/${clusterName}/apps/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: app.appId,
          revisionId: selectedRev.id,
          version: selectedRev.version,
          customValues: customValues || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to rollback application in cluster');
      }

      onRollbackComplete();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Rollback failed');
    } finally {
      setRollingBack(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/80 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
        <div className="bg-cyber-950 border border-cyber-700/90 rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative text-slate-100">
          {/* Header */}
          <div className="px-6 py-4 border-b border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">Rollback {app.name}</h2>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyber-800 text-slate-300 border border-cyber-700">
                    Current: v{app.version || 'installed'}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                    Cluster: {clusterName}
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Select a known working configuration from the version control history to redeploy to this cluster.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="mx-6 mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-mono text-rose-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} className="p-1 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <label className="block text-xs font-mono font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                Select Target Release / Known Working Version:
              </label>

              {loading ? (
                <div className="py-10 text-center text-xs font-mono text-slate-500">
                  Loading catalog revisions...
                </div>
              ) : revisions.length === 0 ? (
                <div className="p-4 bg-cyber-900/40 rounded-2xl border border-cyber-800 text-xs font-mono text-slate-400 text-center">
                  No catalog revisions recorded for this application yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1">
                  {revisions.map((rev) => {
                    const isSelected = selectedRev?.id === rev.id;
                    const isInstalledVersion = rev.version === app.version;

                    return (
                      <div
                        key={rev.id}
                        onClick={() => {
                          setSelectedRev(rev);
                          setCustomValues(rev.helm?.values || '');
                        }}
                        className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-amber-950/40 border-amber-500/70 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
                            : 'bg-cyber-900/80 border-cyber-800 hover:border-cyber-750'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-bold text-white">
                              #{rev.revisionNumber}
                            </span>
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyber-950 text-cyan-300 border border-cyber-800">
                              v{rev.version}
                            </span>
                            {rev.isWorkingVersion && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                <span>Known Good</span>
                              </span>
                            )}
                          </div>

                          {isInstalledVersion && (
                            <span className="text-[9px] font-mono text-slate-500 bg-cyber-950 px-1.5 py-0.5 rounded">
                              Current
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-300 line-clamp-2 mt-1">
                          {rev.commitMessage}
                        </p>

                        <div className="mt-2 text-[10px] font-mono text-slate-500 flex items-center justify-between">
                          <span>{rev.author}</span>
                          <span>{new Date(rev.timestamp).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedRev && (
              <div className="p-4 bg-cyber-900/60 border border-cyber-800 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                    Selected Version Snapshot Configuration
                  </h4>
                  <span className="text-xs font-mono text-amber-400 font-bold">
                    Target: v{selectedRev.version} (Rev #{selectedRev.revisionNumber})
                  </span>
                </div>

                {selectedRev.helm && (
                  <div className="text-xs font-mono text-slate-300 space-y-1">
                    <div>
                      <span className="text-slate-500">Chart: </span>
                      <span className="text-white">{selectedRev.helm.name} ({selectedRev.helm.version || 'latest'})</span>
                    </div>
                    {selectedRev.helm.repo && (
                      <div>
                        <span className="text-slate-500">Repository: </span>
                        <span className="text-slate-300">{selectedRev.helm.repo}</span>
                      </div>
                    )}
                  </div>
                )}

                {selectedRev.helm?.values && (
                  <div>
                    <label className="block text-[10px] font-mono text-slate-400 mb-1">
                      CUSTOM HELM VALUES (EDITABLE BEFORE ROLLBACK):
                    </label>
                    <textarea
                      value={customValues}
                      onChange={(e) => setCustomValues(e.target.value)}
                      rows={5}
                      className="w-full bg-cyber-950 border border-cyber-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                )}

                {selectedRev.manifests && (
                  <div className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Raw Kubernetes manifests included in this snapshot will be applied</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 rounded-xl text-xs font-mono transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={handleRollback}
              disabled={rollingBack || !selectedRev}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-glow-sm flex items-center gap-1.5 font-mono"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${rollingBack ? 'animate-spin' : ''}`} />
              <span>{rollingBack ? 'Rolling back in Cluster...' : `Rollback to v${selectedRev?.version || ''}`}</span>
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
