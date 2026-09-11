import React, { useState, useEffect } from 'react';
import {
  GitCommit,
  GitBranch,
  History,
  RotateCcw,
  CheckCircle2,
  Shield,
  ShieldCheck,
  FileCode,
  Layers,
  Clock,
  User,
  ArrowRight,
  AlertCircle,
  Copy,
  Check,
  X,
  RefreshCw,
  SlidersVertical,
} from 'lucide-react';
import type { AppDefinition, AppRevisionSnapshot, DiffLine } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  app: AppDefinition | null;
  isOpen: boolean;
  onClose: () => void;
  onRollbackSuccess: () => void;
  isAdmin: boolean;
}

export const AppVCSModal: React.FC<Props> = ({
  app,
  isOpen,
  onClose,
  onRollbackSuccess,
  isAdmin,
}) => {
  const [revisions, setRevisions] = useState<AppRevisionSnapshot[]>([]);
  const [selectedRev, setSelectedRev] = useState<AppRevisionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'manifest-diff' | 'values-diff' | 'snapshot' | 'summary'>('manifest-diff');
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [valuesDiffLines, setValuesDiffLines] = useState<DiffLine[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);

  const fetchRevisions = async () => {
    if (!app) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/appstore/vcs/apps/${app.id}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const revs = data.data.revisions || [];
        setRevisions(revs);
        if (revs.length > 0 && !selectedRev) {
          setSelectedRev(revs[0]);
        }
      }
    } catch (err: any) {
      console.error('Failed to load revisions:', err);
      setError('Failed to load version history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && app) {
      fetchRevisions();
    }
  }, [isOpen, app?.id]);

  // Compute text diff when selected revision changes
  useEffect(() => {
    if (!selectedRev || !app) return;

    // Diff selected rev against current app definition
    computeDiff(selectedRev.manifests || '', app.manifests || '').then(setDiffLines);
    computeDiff(selectedRev.helm?.values || '', app.helm?.values || '').then(setValuesDiffLines);
  }, [selectedRev, app]);

  const computeDiff = async (oldText: string, newText: string): Promise<DiffLine[]> => {
    try {
      const res = await fetch('/api/appstore/vcs/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldText, newText }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        return data.data.diff || [];
      }
    } catch {}
    return [];
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRollback = async () => {
    if (!selectedRev) return;
    setRollingBack(true);
    setError(null);
    try {
      const res = await fetch(`/api/appstore/vcs/apps/${app.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback',
          revisionId: selectedRev.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to rollback application');
      }

      setSuccessMessage(`Application ${app.name} rolled back to revision #${selectedRev.revisionNumber} (v${selectedRev.version})!`);
      setConfirmRollback(false);
      await fetchRevisions();
      onRollbackSuccess();
    } catch (err: any) {
      setError(err.message || 'Rollback failed');
    } finally {
      setRollingBack(false);
    }
  };

  const handleToggleWorking = async () => {
    if (!selectedRev) return;
    setTagging(true);
    try {
      const isWorking = !selectedRev.isWorkingVersion;
      const res = await fetch(`/api/appstore/vcs/apps/${app.id}`, {
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

  if (!isOpen || !app) return null;

  const isCurrentActive = selectedRev && (
    selectedRev.version === app.version &&
    selectedRev.manifests === app.manifests &&
    selectedRev.helm?.values === app.helm?.values &&
    selectedRev.helm?.version === app.helm?.version
  );

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/80 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
        <div className="bg-cyber-950 border border-cyber-700/90 rounded-3xl w-full max-w-6xl h-[90vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden relative text-slate-100">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <History className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">{app.name}</h2>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyber-800 border border-cyber-700 text-slate-300">
                    Active: v{app.version}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                    GitOps Version Control
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Track full revision snapshots, inspect visual line diffs, and fallback to known working configurations.
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
            {/* Left Column: Revision Timeline */}
            <div className="w-full md:w-80 border-r border-cyber-800 bg-cyber-900/40 flex flex-col shrink-0 overflow-hidden">
              <div className="p-3.5 border-b border-cyber-800 flex items-center justify-between bg-cyber-900/60">
                <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-300">
                  <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                  <span>Revision History ({revisions.length})</span>
                </div>
                <button
                  onClick={fetchRevisions}
                  disabled={loading}
                  className="p-1 text-slate-400 hover:text-white rounded transition-colors"
                  title="Refresh revisions"
                >
                  <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading && revisions.length === 0 ? (
                  <div className="py-12 text-center text-xs font-mono text-slate-500">
                    Loading revisions...
                  </div>
                ) : revisions.length === 0 ? (
                  <div className="py-12 text-center text-xs font-mono text-slate-500 p-4">
                    No historical commits recorded yet. Edits will automatically create immutable snapshots.
                  </div>
                ) : (
                  revisions.map((rev) => {
                    const isSelected = selectedRev?.id === rev.id;
                    const isCurrent = rev.version === app.version && rev.revisionNumber === revisions[0]?.revisionNumber;

                    return (
                      <div
                        key={rev.id}
                        onClick={() => {
                          setSelectedRev(rev);
                          setConfirmRollback(false);
                        }}
                        className={`p-3 rounded-2xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                            : 'bg-cyber-900/80 border-cyber-800 hover:border-cyber-700 hover:bg-cyber-850'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono font-bold text-white">
                              #{rev.revisionNumber}
                            </span>
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-cyber-950 text-cyan-300 border border-cyber-800">
                              v{rev.version}
                            </span>
                            {rev.isWorkingVersion && (
                              <span className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" title="Known Working Release">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                <span>Working</span>
                              </span>
                            )}
                          </div>

                          <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                            rev.changeType === 'rollback'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : rev.changeType === 'create'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-cyber-800 text-slate-400'
                          }`}>
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

            {/* Right Column: Selected Revision Inspector & Diff View */}
            <div className="flex-1 flex flex-col bg-cyber-950 overflow-hidden">
              {selectedRev ? (
                <>
                  {/* Top Bar for Selected Revision */}
                  <div className="p-4 border-b border-cyber-800 bg-cyber-900/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white font-mono">
                          Revision #{selectedRev.revisionNumber}
                        </span>
                        <span className="text-xs font-mono text-cyan-300 font-semibold px-2 py-0.5 rounded-md bg-cyber-950 border border-cyber-800">
                          v{selectedRev.version}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          Commit: <code className="text-slate-300">{selectedRev.id}</code>
                        </span>
                        {isCurrentActive && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                            Current Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 font-mono mt-1">
                        &ldquo;{selectedRev.commitMessage}&rdquo;
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Toggle working version */}
                      <button
                        onClick={handleToggleWorking}
                        disabled={tagging}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold flex items-center gap-1.5 transition-all ${
                          selectedRev.isWorkingVersion
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-cyber-900 text-slate-400 border-cyber-750 hover:text-slate-200'
                        }`}
                        title="Mark or unmark as known working configuration"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        <span>{selectedRev.isWorkingVersion ? 'Known Good' : 'Mark Working'}</span>
                      </button>

                      {/* Rollback button */}
                      {isAdmin && (
                        <>
                          {!confirmRollback ? (
                            <button
                              onClick={() => setConfirmRollback(true)}
                              disabled={isCurrentActive}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm ${
                                isCurrentActive
                                  ? 'bg-cyber-900 text-slate-600 border border-cyber-800 cursor-not-allowed'
                                  : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40'
                              }`}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Rollback</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5 bg-amber-950/80 p-1 rounded-xl border border-amber-500/50 animate-in fade-in">
                              <span className="text-[11px] font-mono text-amber-300 px-2">
                                Restore v{selectedRev.version}?
                              </span>
                              <button
                                onClick={handleRollback}
                                disabled={rollingBack}
                                className="px-2.5 py-1 bg-amber-500 text-slate-950 font-bold text-xs rounded-lg hover:bg-amber-400 transition-all font-mono"
                              >
                                {rollingBack ? 'Rolling back...' : 'Confirm'}
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

                  {/* Tabs Bar */}
                  <div className="px-4 border-b border-cyber-800 bg-cyber-900/30 flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setActiveTab('manifest-diff')}
                      className={`px-3 py-2 text-xs font-mono font-semibold border-b-2 transition-all ${
                        activeTab === 'manifest-diff'
                          ? 'text-cyan-400 border-cyan-400'
                          : 'text-slate-400 border-transparent hover:text-slate-200'
                      }`}
                    >
                      Manifest Diff
                    </button>
                    <button
                      onClick={() => setActiveTab('values-diff')}
                      className={`px-3 py-2 text-xs font-mono font-semibold border-b-2 transition-all ${
                        activeTab === 'values-diff'
                          ? 'text-cyan-400 border-cyan-400'
                          : 'text-slate-400 border-transparent hover:text-slate-200'
                      }`}
                    >
                      Helm Values Diff
                    </button>
                    <button
                      onClick={() => setActiveTab('snapshot')}
                      className={`px-3 py-2 text-xs font-mono font-semibold border-b-2 transition-all ${
                        activeTab === 'snapshot'
                          ? 'text-cyan-400 border-cyan-400'
                          : 'text-slate-400 border-transparent hover:text-slate-200'
                      }`}
                    >
                      Snapshot Configuration
                    </button>
                    <button
                      onClick={() => setActiveTab('summary')}
                      className={`px-3 py-2 text-xs font-mono font-semibold border-b-2 transition-all ${
                        activeTab === 'summary'
                          ? 'text-cyan-400 border-cyan-400'
                          : 'text-slate-400 border-transparent hover:text-slate-200'
                      }`}
                    >
                      Change Details
                    </button>
                  </div>

                  {/* Tab Body */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {/* TAB: Manifest Diff */}
                    {activeTab === 'manifest-diff' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                          <span className="flex items-center gap-2">
                            <span>Visual Line Diff:</span>
                            <span className="text-rose-400 font-bold">(-) This Revision</span>
                            <span className="text-slate-600">&rarr;</span>
                            <span className="text-emerald-400 font-bold">(+) Current Active</span>
                          </span>
                          {selectedRev.manifests && (
                            <button
                              onClick={() => handleCopy(selectedRev.manifests || '', 'rev-manifest')}
                              className="px-2 py-1 bg-cyber-900 hover:bg-cyber-850 rounded border border-cyber-800 text-[10px] flex items-center gap-1 text-slate-300"
                            >
                              {copiedKey === 'rev-manifest' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>Copy Manifest</span>
                            </button>
                          )}
                        </div>

                        {diffLines.length === 0 ? (
                          <div className="py-12 text-center rounded-2xl bg-cyber-900/30 border border-cyber-800 text-xs font-mono text-slate-500">
                            No manifest differences between this revision and the current active configuration.
                          </div>
                        ) : (
                          <div className="bg-cyber-950 border border-cyber-850 rounded-2xl p-3 font-mono text-[11px] overflow-x-auto leading-relaxed divide-y divide-cyber-900">
                            {diffLines.map((line, idx) => (
                              <div
                                key={idx}
                                className={`flex items-start py-0.5 px-2 rounded ${
                                  line.type === 'added'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : line.type === 'removed'
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'text-slate-400'
                                }`}
                              >
                                <span className="w-8 select-none text-[10px] text-slate-600 text-right pr-2">
                                  {line.oldLineNumber || ''}
                                </span>
                                <span className="w-8 select-none text-[10px] text-slate-600 text-right pr-2">
                                  {line.newLineNumber || ''}
                                </span>
                                <span className="w-4 select-none font-bold">
                                  {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                                </span>
                                <span className="whitespace-pre flex-1">{line.line || ' '}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB: Values Diff */}
                    {activeTab === 'values-diff' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                          <span className="flex items-center gap-2">
                            <span>Helm Values Diff:</span>
                            <span className="text-rose-400 font-bold">(-) This Revision</span>
                            <span className="text-slate-600">&rarr;</span>
                            <span className="text-emerald-400 font-bold">(+) Current Active</span>
                          </span>
                        </div>

                        {valuesDiffLines.length === 0 ? (
                          <div className="py-12 text-center rounded-2xl bg-cyber-900/30 border border-cyber-800 text-xs font-mono text-slate-500">
                            No Helm custom values difference between this revision and current active configuration.
                          </div>
                        ) : (
                          <div className="bg-cyber-950 border border-cyber-850 rounded-2xl p-3 font-mono text-[11px] overflow-x-auto leading-relaxed divide-y divide-cyber-900">
                            {valuesDiffLines.map((line, idx) => (
                              <div
                                key={idx}
                                className={`flex items-start py-0.5 px-2 rounded ${
                                  line.type === 'added'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : line.type === 'removed'
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'text-slate-400'
                                }`}
                              >
                                <span className="w-8 select-none text-[10px] text-slate-600 text-right pr-2">
                                  {line.oldLineNumber || ''}
                                </span>
                                <span className="w-8 select-none text-[10px] text-slate-600 text-right pr-2">
                                  {line.newLineNumber || ''}
                                </span>
                                <span className="w-4 select-none font-bold">
                                  {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                                </span>
                                <span className="whitespace-pre flex-1">{line.line || ' '}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB: Full Snapshot */}
                    {activeTab === 'snapshot' && (
                      <div className="space-y-4">
                        {selectedRev.helm && (
                          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-4">
                            <h4 className="text-xs font-bold font-mono text-cyan-400 mb-2 uppercase tracking-wider">
                              Helm Chart Specification
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                              <div>
                                <span className="text-slate-500 block text-[10px]">CHART NAME</span>
                                <span className="text-white font-semibold">{selectedRev.helm.name}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px]">REPOSITORY</span>
                                <span className="text-white truncate block">{selectedRev.helm.repo || 'Embedded'}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px]">CHART VERSION</span>
                                <span className="text-white font-semibold">{selectedRev.helm.version || 'latest'}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block text-[10px]">RELEASE NAME</span>
                                <span className="text-white">{selectedRev.helm.releaseName}</span>
                              </div>
                            </div>

                            {selectedRev.helm.values && (
                              <div className="mt-3">
                                <span className="text-slate-500 block text-[10px] font-mono mb-1">VALUES.YAML</span>
                                <pre className="p-3 bg-cyber-950 rounded-xl border border-cyber-850 text-slate-300 font-mono text-[11px] overflow-x-auto max-h-48">
                                  {selectedRev.helm.values}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}

                        {selectedRev.manifests && (
                          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-bold font-mono text-emerald-400 uppercase tracking-wider">
                                Kubernetes Raw Manifests
                              </h4>
                              <button
                                onClick={() => handleCopy(selectedRev.manifests || '', 'snapshot-raw')}
                                className="px-2 py-1 bg-cyber-950 rounded border border-cyber-800 text-[10px] font-mono text-slate-300 flex items-center gap-1 hover:text-white"
                              >
                                {copiedKey === 'snapshot-raw' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                <span>Copy</span>
                              </button>
                            </div>
                            <pre className="p-3 bg-cyber-950 rounded-xl border border-cyber-850 text-slate-300 font-mono text-[11px] overflow-x-auto max-h-72">
                              {selectedRev.manifests}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB: Change Summary */}
                    {activeTab === 'summary' && (
                      <div className="space-y-4">
                        <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-4 space-y-3">
                          <h4 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
                            Revision Metadata
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                            <div>
                              <span className="text-slate-500 block text-[10px]">AUTHOR</span>
                              <span className="text-slate-200">{selectedRev.author}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[10px]">COMMITTED AT</span>
                              <span className="text-slate-200">{new Date(selectedRev.timestamp).toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block text-[10px]">CHANGE TYPE</span>
                              <span className="text-cyan-400 font-bold capitalize">{selectedRev.changeType}</span>
                            </div>
                          </div>

                          {selectedRev.diffSummary?.fieldChanges && selectedRev.diffSummary.fieldChanges.length > 0 && (
                            <div className="pt-3 border-t border-cyber-800">
                              <span className="text-slate-500 block text-[10px] font-mono mb-2">FIELD MODIFICATIONS:</span>
                              <ul className="space-y-1">
                                {selectedRev.diffSummary.fieldChanges.map((change, i) => (
                                  <li key={i} className="text-xs font-mono text-slate-300 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                                    <span>{change}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs font-mono text-slate-500">
                  Select a revision from the timeline to inspect changes and rollback options.
                </div>
              )}
            </div>
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Version control guarantees fallback to known working configurations</span>
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
