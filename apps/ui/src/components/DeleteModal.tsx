import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, X, Loader2 } from 'lucide-react';
import type { VirtualCluster } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleteSuccess: (clusterName: string) => void;
}

export const DeleteModal: React.FC<Props> = ({ cluster, isOpen, onClose, onDeleteSuccess }) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmInput('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen || !cluster) return null;

  const isConfirmed = confirmInput.trim() === cluster.name;

  const handleDelete = async () => {
    if (!isConfirmed) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete cluster');
      }

      onDeleteSuccess(cluster.name);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto bg-black/75 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-cyber-900 border border-rose-500/40 rounded-2xl shadow-2xl p-6 overflow-hidden my-auto">
        {/* Top Accent */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500 to-transparent"></div>

        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 rounded-xl border border-rose-500/20 text-rose-400">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Delete Virtual Cluster
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Graceful teardown via <span className="font-mono text-slate-300">vops.gitops.io/finalizer</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mb-4 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            Warning: This action cannot be undone.
          </p>
          This will drain tenant pods, remove the HA etcd backing store and persistent volume claims, and delete the host kubeconfig secret.
        </div>

        <div className="mb-5 space-y-2">
          <label className="block text-xs font-medium text-slate-300">
            Please type <span className="font-mono text-rose-400 font-bold select-all">{cluster.name}</span> to confirm:
          </label>
          <input
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={cluster.name}
            className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-4 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500 transition-colors"
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-sm font-medium rounded-xl border border-cyber-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isConfirmed || deleting}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-xl shadow-glow-rose flex items-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Draining & Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Confirm Deletion
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
