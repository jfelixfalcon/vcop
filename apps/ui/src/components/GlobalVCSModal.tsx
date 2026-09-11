import React, { useState, useEffect } from 'react';
import {
  GitCommit,
  GitBranch,
  History,
  Search,
  X,
  RefreshCw,
  User,
  Clock,
  Package,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import type { GlobalVCSCommit } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectEntity?: (type: 'app' | 'group', id: string) => void;
}

export const GlobalVCSModal: React.FC<Props> = ({ isOpen, onClose, onSelectEntity }) => {
  const [commits, setCommits] = useState<GlobalVCSCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'app' | 'group'>('all');

  const fetchCommits = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/appstore/vcs');
      const data = await res.json();
      if (res.ok && data.success) {
        setCommits(data.data.globalCommits || []);
      }
    } catch (err) {
      console.error('Failed to fetch VCS commits:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCommits();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredCommits = commits.filter((c) => {
    if (filterType !== 'all' && c.entityType !== filterType) return false;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const matchName = c.entityName?.toLowerCase().includes(q);
      const matchMsg = c.commitMessage?.toLowerCase().includes(q);
      const matchAuthor = c.author?.toLowerCase().includes(q);
      const matchSha = c.id?.toLowerCase().includes(q);
      if (!matchName && !matchMsg && !matchAuthor && !matchSha) return false;
    }
    return true;
  });

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/80 backdrop-blur-md overflow-hidden animate-in fade-in duration-150">
        <div className="bg-cyber-950 border border-cyber-700/90 rounded-3xl w-full max-w-5xl h-[85vh] max-h-[850px] flex flex-col shadow-2xl overflow-hidden relative text-slate-100">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 text-cyan-400">
                <GitBranch className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white">Platform GitOps Commit Log</h2>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                    Single Pane of Glass VCS
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Complete immutable changelog of manifest and version revisions across all applications and packs.
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

          {/* Search and Filters */}
          <div className="p-4 border-b border-cyber-800 bg-cyber-900/40 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search commit messages, authors, SHAs..."
                className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl pl-9 pr-3.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex items-center bg-cyber-950 p-1 rounded-xl border border-cyber-800 text-xs font-mono">
                {(['all', 'app', 'group'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-3 py-1 rounded-lg capitalize transition-all ${
                      filterType === type
                        ? 'bg-cyber-800 text-white font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {type === 'all' ? 'All Changes' : type === 'app' ? 'Applications' : 'Packs / Groups'}
                  </button>
                ))}
              </div>

              <button
                onClick={fetchCommits}
                disabled={loading}
                className="p-2 bg-cyber-900 hover:bg-cyber-850 text-slate-300 border border-cyber-800 rounded-xl text-xs transition-colors"
                title="Refresh log"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Commit Stream List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {loading && commits.length === 0 ? (
              <div className="py-20 text-center text-xs font-mono text-slate-500">
                Loading GitOps commit stream...
              </div>
            ) : filteredCommits.length === 0 ? (
              <div className="py-20 text-center rounded-3xl bg-cyber-900/30 border border-cyber-800 text-xs font-mono text-slate-500 p-8">
                No matching version commits found.
              </div>
            ) : (
              filteredCommits.map((commit) => {
                const isApp = commit.entityType === 'app';

                return (
                  <div
                    key={commit.id}
                    className="p-4 bg-cyber-900/80 hover:bg-cyber-850 border border-cyber-800/80 hover:border-cyan-500/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all group"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                        isApp
                          ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                          : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                      }`}>
                        {isApp ? <Package className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-white font-mono group-hover:text-cyan-300 transition-colors">
                            {commit.entityName}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyber-950 text-slate-300 border border-cyber-850">
                            v{commit.version}
                          </span>
                          <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
                            commit.changeType === 'rollback'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : commit.changeType === 'create'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-cyber-950 text-slate-400 border border-cyber-800'
                          }`}>
                            {commit.changeType}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 mt-1 font-sans">
                          {commit.commitMessage}
                        </p>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] font-mono text-slate-500">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            <span>{commit.author}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(commit.timestamp).toLocaleString()}</span>
                          </span>
                          <span>
                            Commit: <code className="text-slate-400">{commit.id}</code>
                          </span>
                        </div>
                      </div>
                    </div>

                    {onSelectEntity && (
                      <button
                        onClick={() => {
                          onSelectEntity(commit.entityType as 'app' | 'group', commit.entityId);
                          onClose();
                        }}
                        className="self-end sm:self-center px-3 py-1.5 bg-cyber-950 hover:bg-cyber-800 text-cyan-400 border border-cyber-800 text-xs font-mono font-semibold rounded-xl flex items-center gap-1.5 transition-all shrink-0"
                      >
                        <span>Inspect</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-cyber-800 bg-cyber-900/80 flex items-center justify-between shrink-0 text-xs font-mono text-slate-400">
            <span>Showing {filteredCommits.length} recorded commits in local GitOps history</span>
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
