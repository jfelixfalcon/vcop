import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  ShieldCheck,
  UserPlus,
  Mail,
  AlertCircle,
  CheckCircle2,
  Lock,
  Save,
  KeyRound,
} from 'lucide-react';
import type { VirtualCluster } from '../lib/types';
import { ModalPortal } from './ModalPortal';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: VirtualCluster) => void;
}

export const RbacModal: React.FC<Props> = ({ cluster, isOpen, onClose, onSuccess }) => {
  const [owner, setOwner] = useState<string>('');
  const [allowedGroups, setAllowedGroups] = useState<string>('');
  const [allowedEmails, setAllowedEmails] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && cluster) {
      setOwner(cluster.metadata?.owner || '');
      setAllowedGroups((cluster.metadata?.allowedGroups || []).join(', '));
      setAllowedEmails((cluster.metadata?.allowedEmails || []).join(', '));
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen || !cluster) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        owner: owner.trim() || 'Platform User',
        allowedGroups: allowedGroups
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        allowedEmails: allowedEmails
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        namespace: cluster.namespace,
      };

      const res = await fetch(`/api/vclusters/${cluster.name}/rbac`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update RBAC policies');
      }

      onSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update RBAC access delegation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
        <div className="relative w-full max-w-xl bg-cyber-900 border border-cyber-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden my-auto">
        {/* Top Accent Line */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>

        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-2xl">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Manage Access & RBAC Delegation
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Target Cluster:{' '}
                <span className="font-mono text-cyan-400 font-semibold">{cluster.name}</span>{' '}
                <span className="text-slate-500">({cluster.namespace})</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-5 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Primary Owner */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                Cluster Owner (User or Team)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Primary Maintainer</span>
            </label>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="e.g. dev@vops.local or Checkout Platform Team"
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              User or email assigned as the primary cluster owner with view and kubeconfig rights.
            </p>
          </div>

          {/* Authorized Groups */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5 text-purple-400" />
                Authorized Groups (OIDC / SSO)
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Comma-Separated</span>
            </label>
            <input
              type="text"
              value={allowedGroups}
              onChange={(e) => setAllowedGroups(e.target.value)}
              placeholder="e.g. developers, qa-engineers, platform-ops"
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              All authenticated users in these IdP groups can view this cluster and retrieve its kubeconfig.
            </p>
          </div>

          {/* Authorized Emails */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-blue-400" />
                Authorized Individual User Emails
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Comma-Separated</span>
            </label>
            <input
              type="text"
              value={allowedEmails}
              onChange={(e) => setAllowedEmails(e.target.value)}
              placeholder="e.g. dev@vops.local, sarah@company.com, alex@company.com"
              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Specific user emails granted read-only viewing and kubeconfig access.
            </p>
          </div>

          {/* Info Notice Box */}
          <div className="p-3 bg-cyber-950/70 border border-cyber-800 rounded-2xl text-[11px] font-mono text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
              <Lock className="w-3.5 h-3.5" />
              <span>Instant RBAC Policy Enforcement:</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Updates take effect immediately on Kubernetes annotations. Viewers can see this cluster and download credentials, but cannot change quotas, sleep states, or delete the cluster.
            </p>
          </div>

          {/* Form Actions */}
          <div className="pt-3 border-t border-cyber-800 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{submitting ? 'Applying RBAC Changes...' : 'Save Access Delegation'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </ModalPortal>
  );
};
