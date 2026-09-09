import React, { useState } from 'react';
import { Moon, Sun, X, RefreshCw, AlertTriangle, CheckCircle2, Shield, Database, Cpu } from 'lucide-react';
import type { VirtualCluster } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: VirtualCluster) => void;
}

export const SleepModal: React.FC<Props> = ({ cluster, isOpen, onClose, onSuccess }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !cluster) return null;

  const isSleeping = cluster.status.phase === 'Sleeping' || cluster.spec.paused || cluster.spec.lifecycle?.sleep;

  const handleToggleSleep = async () => {
    setLoading(true);
    setError(null);

    const targetSleep = !isSleeping;

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/sleep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sleep: targetSleep,
          namespace: cluster.namespace,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update sleep state');
      }

      onSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto bg-cyber-950/45 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl overflow-hidden p-6 my-auto">
        {/* Glow */}
        <div
          className={`absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent ${
            isSleeping ? 'via-emerald-400' : 'via-indigo-500'
          } to-transparent`}
        ></div>

        {/* Header */}
        <div className="flex justify-between items-start mb-5">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl border ${
                isSleeping
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
              }`}
            >
              {isSleeping ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {isSleeping ? 'Wake Up Virtual Cluster' : 'Put Virtual Cluster to Sleep'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Cluster: <span className="font-mono text-cyan-400">{cluster.name}</span> • Namespace:{' '}
                <span className="font-mono text-slate-300">{cluster.namespace}</span>
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

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Details & Impact Box */}
        <div className="mb-5 p-4 bg-cyber-950/80 border border-cyber-800 rounded-xl space-y-3 text-xs">
          {isSleeping ? (
            <>
              <p className="text-slate-300 leading-relaxed">
                Waking up this cluster will restore the HA etcd quorum, vCluster control plane, and all tenant
                workloads back up to{' '}
                <strong className="text-emerald-400 font-mono">
                  {cluster.spec.highAvailability ? '3 replicas (HA)' : '1 replica'}
                </strong>
                .
              </p>
              <div className="space-y-2 pt-2 border-t border-cyber-800/80 font-mono text-[11px]">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>HA etcd quorum recovered from persistent PVCs</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Tenant workloads and add-ons automatically restored</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>API server endpoint and TLS certificates restored</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-300 leading-relaxed">
                Putting this cluster to sleep scales its control plane, syncer, tenant workloads, and external etcd
                down to <strong className="text-indigo-400 font-mono">0 replicas</strong>, completely freeing host CPU
                and memory while safeguarding all persistent PVC storage.
              </p>
              <div className="space-y-2 pt-2 border-t border-cyber-800/80 font-mono text-[11px]">
                <div className="flex items-center gap-2 text-slate-300">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>Complete namespace compute reduced to 0m CPU, 0Mi RAM & 0 pods</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <Database className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>etcd raft database on PVCs remains 100% persisted on disk</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <Shield className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Instantly wake up on demand with zero data loss</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleToggleSleep}
            disabled={loading}
            className={`px-5 py-2 text-xs font-bold rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50 ${
              isSleeping
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-glow-sm'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white shadow-glow-sm'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {isSleeping ? 'Waking Up...' : 'Entering Sleep...'}
              </>
            ) : isSleeping ? (
              <>
                <Sun className="w-3.5 h-3.5" />
                Wake Up Cluster
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5" />
                Put to Sleep
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
