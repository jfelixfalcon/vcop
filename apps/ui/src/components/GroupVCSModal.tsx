import React, { useState, useEffect } from 'react';
import {
  Layers,
  History,
  RotateCcw,
  CheckCircle2,
  Shield,
  ShieldCheck,
  User,
  Clock,
  X,
  AlertCircle,
  RefreshCw,
  Box,
  ArrowRight,
  Package,
} from 'lucide-react';
import type { AppGroup, GroupRevisionSnapshot, AppDefinition } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  group: AppGroup | null;
  catalogApps: AppDefinition[];
  isOpen: boolean;
  onClose: () => void;
  onRollbackSuccess: () => void;
  isAdmin: boolean;
}

export const GroupVCSModal: React.FC<Props> = ({
  group,
  catalogApps,
  isOpen,
  onClose,
  onRollbackSuccess,
  isAdmin,
}) => {
  const [revisions, setRevisions] = useState<GroupRevisionSnapshot[]>([]);
  const [selectedRev, setSelectedRev] = useState<GroupRevisionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);

  const fetchRevisions = async () => {
    if (!group) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/appstore/vcs/groups/${group.id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const revs = data.data.revisions || [];
        setRevisions(revs);
        if (revs.length > 0 && !selectedRev) {
          setSelectedRev(revs[0]);
        }
      }
    } catch (err: any) {
      console.error('Failed to load group revisions:', err);
      setError('Failed to load group version history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && group) {
      fetchRevisions();
    }
  }, [isOpen, group?.id]);

  const handleRollback = async () => {
    if (!selectedRev) return;
    setRollingBack(true);
    setError(null);
    try {
      const res = await fetch(`/api/appstore/vcs/groups/${group.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback',
          revisionId: selectedRev.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to rollback group');
      }

      setSuccessMessage(`Group ${group.name} rolled back to revision #${selectedRev.revisionNumber} (v${selectedRev.version})!`);
      setConfirmRollback(false);
      await fetchRevisions();
      onRollbackSuccess();
    } catch (err: any) {
      setError(err.message || 'Group rollback failed');
    } finally {
      setRollingBack(false);
    }
  };

  const handleToggleWorking = async () => {
    if (!selectedRev) return;
    setTagging(true);
    try {
      const isWorking = !selectedRev.isWorkingVersion;
      const res = await fetch(`/api/appstore/vcs/groups/${group.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'tag-working',
          revisionId: selectedRev.id,
          isWorking,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSelectedRev({ ...selectedRev, isWorkingVersion: isWorking });
        await fetchRevisions();
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update working tag');
    } finally {
      setTagging(false);
    }
  };

  if (!isOpen || !group) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/80 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
        <div className="bg-cyber-950 border border-cyber-700/90 rounded-3xl w-full max-w-5xl h-[85vh] max-h-[850px] flex flex-col shadow-2xl overflow-hidden relative text-slate-100">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">{group.name}</h2>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyber-800 border border-cyber-700 text-purple-300">
                    Active: v{group.version || '1.0.0'}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-800">
                    Group Version Control & Matrix
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Track group bundle releases, monitor individual application versions within the group, and revert configurations.
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

          {/* Feedback alerts */}
          {error && (
            <div className="mx-6 mt-3 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-mono text-rose-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
              <button onClick={() => setError(null)} className="p-1 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {successMessage && (
            <div className="mx-6 mt-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-mono text-emerald-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{successMessage}</span>
              </div>
              <button onClick={() => setSuccessMessage(null)} className="p-1 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main Dual-Column Content */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* Left Column: Group Revisions Timeline */}
            <div className="w-full md:w-80 border-r border-cyber-800 bg-cyber-900/40 flex flex-col shrink-0 overflow-hidden">
              <div className="p-3.5 border-b border-cyber-800 flex items-center justify-between bg-cyber-900/60">
                <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-300">
                  <History className="w-3.5 h-3.5 text-purple-400" />
                  <span>Group Releases ({revisions.length})</span>
                </div>
                <button
                  onClick={fetchRevisions}
                  disabled={loading}
                  className="p-1 text-slate-400 hover:text-white rounded transition-colors"
                  title="Refresh group history"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading && revisions.length === 0 ? (
                  <div className="py-12 text-center text-xs font-mono text-slate-500">
                    Loading group releases...
                  </div>
                ) : revisions.length === 0 ? (
                  <div className="py-12 text-center text-xs font-mono text-slate-500 p-4">
                    No historical group versions recorded yet.
                  </div>
                ) : (
                  revisions.map((rev) => {
                    const isSelected = selectedRev?.id === rev.id;

                    return (
                      <div
                        key={rev.id}
                        onClick={() => {
                          setSelectedRev(rev);
                          setConfirmRollback(false);
                        }}
                        className={`p-3 rounded-2xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-purple-950/40 border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                            : 'bg-cyber-900/80 border-cyber-800 hover:border-cyber-700 hover:bg-cyber-850'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-bold text-white">
                              #{rev.revisionNumber}
                            </span>
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-cyber-950 text-purple-300 border border-cyber-800">
                              v{rev.version}
                            </span>
                            {rev.isWorkingVersion && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                <span>Working</span>
                              </span>
                            )}
                          </div>

                          <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-cyber-800 text-slate-400">
                            {rev.changeType}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-300 font-sans line-clamp-2 leading-snug">
                          {rev.commitMessage}
                        </p>

                        <div className="mt-2 pt-2 border-t border-cyber-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                          <div className="flex items-center gap-1 truncate max-w-[140px]">
                            <User className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{rev.author}</span>
                          </div>
                          <span>{new Date(rev.timestamp).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: App Version Matrix & Diff Inspector */}
            <div className="flex-1 flex flex-col bg-cyber-950 overflow-hidden">
              {selectedRev ? (
                <>
                  {/* Top Bar for Selected Group Revision */}
                  <div className="p-4 border-b border-cyber-800 bg-cyber-900/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white font-mono">
                          Group Release #{selectedRev.revisionNumber}
                        </span>
                        <span className="text-xs font-mono text-purple-300 font-semibold px-2 py-0.5 rounded-md bg-cyber-950 border border-cyber-800">
                          v{selectedRev.version}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          Commit: <code className="text-slate-300">{selectedRev.id}</code>
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-mono mt-1">
                        &ldquo;{selectedRev.commitMessage}&rdquo;
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleToggleWorking}
                        disabled={tagging}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold flex items-center gap-1.5 transition-all ${
                          selectedRev.isWorkingVersion
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-cyber-900 text-slate-400 border-cyber-750 hover:text-slate-200'
                        }`}
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>{selectedRev.isWorkingVersion ? 'Known Good' : 'Mark Working'}</span>
                      </button>

                      {isAdmin && (
                        <>
                          {!confirmRollback ? (
                            <button
                              onClick={() => setConfirmRollback(true)}
                              className="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Rollback Group</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5 bg-amber-950/80 p-1 rounded-xl border border-amber-500/50 animate-in fade-in">
                              <span className="text-[11px] font-mono text-amber-300 px-2">
                                Restore group v{selectedRev.version}?
                              </span>
                              <button
                                onClick={handleRollback}
                                disabled={rollingBack}
                                className="px-2.5 py-1 bg-amber-500 text-slate-950 font-bold text-xs rounded-lg hover:bg-amber-400 transition-all font-mono"
                              >
                                {rollingBack ? 'Reverting...' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setConfirmRollback(false)}
                                className="p-1 text-slate-400 hover:text-white rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Body: Matrix of Bundled Apps and Versions */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Matrix Diffs Summary if applicable */}
                    {selectedRev.diffSummary && (
                      <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-4 space-y-2">
                        <h4 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">
                          Matrix Version Diffs
                        </h4>

                        {selectedRev.diffSummary.appsVersionChanged && selectedRev.diffSummary.appsVersionChanged.length > 0 && (
                          <div className="space-y-1">
                            {selectedRev.diffSummary.appsVersionChanged.map((c, i) => (
                              <div key={i} className="text-xs font-mono text-slate-300 flex items-center gap-2">
                                <span className="text-purple-400 font-bold">{c.appId}:</span>
                                <span className="text-rose-400 line-through">v{c.from}</span>
                                <span>&rarr;</span>
                                <span className="text-emerald-400 font-bold">v{c.to}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {selectedRev.diffSummary.appsAdded && selectedRev.diffSummary.appsAdded.length > 0 && (
                          <div className="text-xs font-mono text-emerald-400">
                            + Added Apps: {selectedRev.diffSummary.appsAdded.join(', ')}
                          </div>
                        )}

                        {selectedRev.diffSummary.appsRemoved && selectedRev.diffSummary.appsRemoved.length > 0 && (
                          <div className="text-xs font-mono text-rose-400">
                            - Removed Apps: {selectedRev.diffSummary.appsRemoved.join(', ')}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Matrix of Bundled Applications */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold font-mono text-white flex items-center justify-between">
                        <span>Pinned Applications in Group Version ({selectedRev.apps.length})</span>
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {selectedRev.apps.map((item) => {
                          const catalogApp = catalogApps.find((a) => a.id === item.appId);

                          return (
                            <div
                              key={item.appId}
                              className="p-3 bg-cyber-900/70 border border-cyber-800 rounded-2xl flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="p-2 rounded-xl bg-cyber-950 border border-cyber-750 text-cyan-400 shrink-0">
                                  <Box className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-white truncate">
                                    {catalogApp?.name || item.appId}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400 truncate">
                                    ID: <code className="text-slate-300">{item.appId}</code>
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0">
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                  v{item.version || catalogApp?.version || 'latest'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs font-mono text-slate-500">
                  Select a group release from the timeline to inspect bundled applications and rollback.
                </div>
              )}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Full matrix version tracking ensures reproducible group rollbacks</span>
            </div>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-200 rounded-xl transition-colors font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
