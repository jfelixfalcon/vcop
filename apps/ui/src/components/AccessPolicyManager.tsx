import React, { useState, useEffect } from 'react';
import {
  Shield,
  ShieldCheck,
  Users,
  UserCheck,
  Eye,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Play,
  Key,
  Layers,
  HelpCircle,
} from 'lucide-react';
import type { PlatformAccessPolicy, RoleAssignment, UserRole } from '../lib/types';

interface Props {
  isAdmin: boolean;
}

export const AccessPolicyManager: React.FC<Props> = ({ isAdmin }) => {
  const [policy, setPolicy] = useState<PlatformAccessPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // New item inputs for each role
  const [adminNewGroup, setAdminNewGroup] = useState('');
  const [adminNewUser, setAdminNewUser] = useState('');
  const [devNewGroup, setDevNewGroup] = useState('');
  const [devNewUser, setDevNewUser] = useState('');
  const [viewerNewGroup, setViewerNewGroup] = useState('');
  const [viewerNewUser, setViewerNewUser] = useState('');

  // Simulator state
  const [simEmail, setSimEmail] = useState('');
  const [simUsername, setSimUsername] = useState('');
  const [simGroups, setSimGroups] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{
    resolvedRole: UserRole;
    reason: string;
  } | null>(null);

  const fetchPolicy = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/access-policy');
      const data = await res.json();
      if (data.success) {
        setPolicy(data.data);
      } else {
        setMessage({ text: data.error || 'Failed loading access policy', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Error fetching access policy', error: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicy();
  }, []);

  const handleSavePolicy = async () => {
    if (!policy || !isAdmin) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/access-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy }),
      });
      const data = await res.json();
      if (data.success) {
        setPolicy(data.data);
        setMessage({ text: 'Access policy saved successfully to cluster ConfigMap (vcop-access-policy).' });
      } else {
        setMessage({ text: data.error || 'Failed saving access policy', error: true });
      }
    } catch (err: any) {
      setMessage({ text: err.message || 'Error saving access policy', error: true });
    } finally {
      setSaving(false);
    }
  };

  const addTag = (
    role: 'admin' | 'developers' | 'viewers',
    field: 'groups' | 'users',
    value: string,
    clearInput: () => void
  ) => {
    if (!policy) return;
    const clean = value.trim().toLowerCase();
    if (!clean) return;

    const currentList = policy[role][field] || [];
    if (currentList.includes(clean)) {
      clearInput();
      return;
    }

    setPolicy({
      ...policy,
      [role]: {
        ...policy[role],
        [field]: [...currentList, clean],
      },
    });
    clearInput();
  };

  const removeTag = (
    role: 'admin' | 'developers' | 'viewers',
    field: 'groups' | 'users',
    value: string
  ) => {
    if (!policy) return;
    setPolicy({
      ...policy,
      [role]: {
        ...policy[role],
        [field]: policy[role][field].filter((item) => item !== value),
      },
    });
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimulating(true);
    setSimResult(null);
    try {
      const groups = simGroups
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/admin/access-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: simEmail.trim(),
          username: simUsername.trim(),
          groups,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSimResult({
          resolvedRole: data.resolvedRole,
          reason: data.reason,
        });
      }
    } catch (err: any) {
      console.error('Simulation error:', err);
    } finally {
      setSimulating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16 bg-cyber-900/60 rounded-3xl border border-cyber-800">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
          <p className="text-sm font-mono text-slate-400">Loading Platform Access Policy...</p>
        </div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="p-8 bg-rose-500/10 border border-rose-500/30 rounded-3xl text-center">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
        <p className="text-sm font-mono text-rose-300">Could not initialize platform access policy.</p>
        <button
          onClick={fetchPolicy}
          className="mt-4 px-4 py-2 bg-cyber-800 hover:bg-cyber-700 text-white rounded-xl text-xs font-mono"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-cyber-900/90 border border-cyber-700/80 rounded-3xl p-6 backdrop-blur-xl shadow-2xl">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500/20 via-cyan-500/20 to-purple-500/20 border border-cyber-700 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              <UserCheck className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Platform Access Control & Role Mappings
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-semibold">
                  Live UI RBAC
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Grant users and identity provider groups Administrator, Developer, or Viewer access directly without modifying Helm values.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchPolicy}
            className="p-2.5 rounded-xl bg-cyber-800 hover:bg-cyber-700 text-slate-300 hover:text-white border border-cyber-700 transition-colors"
            title="Reload policy from cluster"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={handleSavePolicy}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-[0_0_16px_rgba(245,158,11,0.3)] transition-all disabled:opacity-50 font-mono"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{saving ? 'Saving Policy...' : 'Save Access Policy'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div
          className={`p-4 rounded-2xl border text-xs font-mono flex items-center justify-between animate-in fade-in duration-200 ${
            message.error
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.error ? <AlertCircle className="w-4 h-4 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-slate-400 hover:text-white ml-4"
          >
            &times;
          </button>
        </div>
      )}

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. DEVELOPERS ROLE CARD (Highlighted Focus) */}
        <div className="flex flex-col justify-between bg-cyber-900/90 border border-amber-500/40 hover:border-amber-500/60 rounded-3xl p-6 shadow-[0_0_25px_rgba(245,158,11,0.08)] relative overflow-hidden backdrop-blur-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                    Developers
                  </h3>
                  <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider font-semibold">
                    Workload & Baseline Deployers
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                developers
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-5 leading-relaxed bg-cyber-950/60 p-3 rounded-2xl border border-cyber-800">
              Middle tier persona. Can deploy virtual clusters using <strong>certified baselines</strong>, modify quota and RBAC, deploy App Store packages, and manage lifecycle. <em>Cannot delete clusters or modify system registries.</em>
            </p>

            {/* Developers: Assigned Groups */}
            <div className="space-y-2 mb-5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-amber-400" />
                  Assigned Groups
                </span>
                <span className="text-slate-500 text-[10px]">{policy.developers.groups.length} groups</span>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-cyber-950/80 rounded-xl border border-cyber-800">
                {policy.developers.groups.length === 0 ? (
                  <span className="text-[11px] font-mono text-slate-500 italic p-1">No groups assigned</span>
                ) : (
                  policy.developers.groups.map((grp) => (
                    <span
                      key={grp}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 text-xs font-mono font-medium"
                    >
                      {grp}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeTag('developers', 'groups', grp)}
                          className="hover:text-rose-400 transition-colors ml-0.5"
                          title="Remove group"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="text"
                    value={devNewGroup}
                    onChange={(e) => setDevNewGroup(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag('developers', 'groups', devNewGroup, () => setDevNewGroup(''));
                      }
                    }}
                    placeholder="e.g. developers, engineering, qa"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-cyber-950 border border-cyber-700/80 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => addTag('developers', 'groups', devNewGroup, () => setDevNewGroup(''))}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}
            </div>

            {/* Developers: Assigned Users / Emails */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                  Assigned Users / Emails
                </span>
                <span className="text-slate-500 text-[10px]">{policy.developers.users.length} users</span>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-cyber-950/80 rounded-xl border border-cyber-800">
                {policy.developers.users.length === 0 ? (
                  <span className="text-[11px] font-mono text-slate-500 italic p-1">No individual users assigned</span>
                ) : (
                  policy.developers.users.map((usr) => (
                    <span
                      key={usr}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 text-xs font-mono font-medium"
                    >
                      {usr}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeTag('developers', 'users', usr)}
                          className="hover:text-rose-400 transition-colors ml-0.5"
                          title="Remove user"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="text"
                    value={devNewUser}
                    onChange={(e) => setDevNewUser(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag('developers', 'users', devNewUser, () => setDevNewUser(''));
                      }
                    }}
                    placeholder="e.g. dev@company.com or username"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-cyber-950 border border-cyber-700/80 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => addTag('developers', 'users', devNewUser, () => setDevNewUser(''))}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. ADMINISTRATORS ROLE CARD */}
        <div className="flex flex-col justify-between bg-cyber-900/90 border border-purple-500/30 hover:border-purple-500/50 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl pointer-events-none"></div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                    Administrators
                  </h3>
                  <span className="text-[10px] font-mono text-purple-400 uppercase tracking-wider font-semibold">
                    Full Platform Authority
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                admin
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-5 leading-relaxed bg-cyber-950/60 p-3 rounded-2xl border border-cyber-800">
              Full administrative privileges across all virtual clusters, custom templates, version registries, AI inference gateway, disaster recovery, and <strong>cluster deletion</strong>.
            </p>

            {/* Admin: Assigned Groups */}
            <div className="space-y-2 mb-5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-purple-400" />
                  Assigned Groups
                </span>
                <span className="text-slate-500 text-[10px]">{policy.admin.groups.length} groups</span>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-cyber-950/80 rounded-xl border border-cyber-800">
                {policy.admin.groups.length === 0 ? (
                  <span className="text-[11px] font-mono text-slate-500 italic p-1">No groups assigned</span>
                ) : (
                  policy.admin.groups.map((grp) => (
                    <span
                      key={grp}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/30 text-xs font-mono font-medium"
                    >
                      {grp}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeTag('admin', 'groups', grp)}
                          className="hover:text-rose-400 transition-colors ml-0.5"
                          title="Remove group"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="text"
                    value={adminNewGroup}
                    onChange={(e) => setAdminNewGroup(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag('admin', 'groups', adminNewGroup, () => setAdminNewGroup(''));
                      }
                    }}
                    placeholder="e.g. admins, platform-ops"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-cyber-950 border border-cyber-700/80 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => addTag('admin', 'groups', adminNewGroup, () => setAdminNewGroup(''))}
                    className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-mono font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}
            </div>

            {/* Admin: Assigned Users / Emails */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-purple-400" />
                  Assigned Users / Emails
                </span>
                <span className="text-slate-500 text-[10px]">{policy.admin.users.length} users</span>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-cyber-950/80 rounded-xl border border-cyber-800">
                {policy.admin.users.length === 0 ? (
                  <span className="text-[11px] font-mono text-slate-500 italic p-1">No individual users assigned</span>
                ) : (
                  policy.admin.users.map((usr) => (
                    <span
                      key={usr}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/30 text-xs font-mono font-medium"
                    >
                      {usr}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeTag('admin', 'users', usr)}
                          className="hover:text-rose-400 transition-colors ml-0.5"
                          title="Remove user"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="text"
                    value={adminNewUser}
                    onChange={(e) => setAdminNewUser(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag('admin', 'users', adminNewUser, () => setAdminNewUser(''));
                      }
                    }}
                    placeholder="e.g. admin@company.com"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-cyber-950 border border-cyber-700/80 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => addTag('admin', 'users', adminNewUser, () => setAdminNewUser(''))}
                    className="px-3 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-mono font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3. VIEWERS ROLE CARD */}
        <div className="flex flex-col justify-between bg-cyber-900/90 border border-cyan-500/30 hover:border-cyan-500/50 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur-xl">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none"></div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                    Viewers
                  </h3>
                  <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider font-semibold">
                    Scoped Read-Only Persona
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                viewer
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-5 leading-relaxed bg-cyber-950/60 p-3 rounded-2xl border border-cyber-800">
              Strictly scoped read-only access. <strong>Only sees clusters they are explicitly assigned to</strong> (via owner, allowed-emails, allowed-groups, or team cluster-group). Cannot provision, mutate, or delete resources.
            </p>

            {/* Viewers: Assigned Groups */}
            <div className="space-y-2 mb-5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  Assigned Groups
                </span>
                <span className="text-slate-500 text-[10px]">{policy.viewers.groups.length} groups</span>
              </div>

              <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 bg-cyber-950/80 rounded-xl border border-cyber-800">
                {policy.viewers.groups.length === 0 ? (
                  <span className="text-[11px] font-mono text-slate-500 italic p-1">No groups assigned</span>
                ) : (
                  policy.viewers.groups.map((grp) => (
                    <span
                      key={grp}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-mono font-medium"
                    >
                      {grp}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeTag('viewers', 'groups', grp)}
                          className="hover:text-rose-400 transition-colors ml-0.5"
                          title="Remove group"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))
                )}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="text"
                    value={viewerNewGroup}
                    onChange={(e) => setViewerNewGroup(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag('viewers', 'groups', viewerNewGroup, () => setViewerNewGroup(''));
                      }
                    }}
                    placeholder="e.g. viewers, auditors"
                    className="flex-1 px-3 py-1.5 text-xs font-mono bg-cyber-950 border border-cyber-700/80 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => addTag('viewers', 'groups', viewerNewGroup, () => setViewerNewGroup(''))}
                    className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-mono font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              )}
            </div>

            {/* Viewers: Default Unmatched Policy */}
            <div className="p-3 bg-cyber-950/80 rounded-2xl border border-cyber-800/80 mt-4 space-y-2">
              <span className="text-xs font-mono text-slate-300 font-semibold block">
                Unmatched User Fallback
              </span>
              <p className="text-[11px] text-slate-400">
                Authenticated SSO users without explicit group matches are defaulted to:
              </p>
              {isAdmin ? (
                <select
                  value={policy.defaultRole}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      defaultRole: e.target.value as 'viewer' | 'developers',
                    })
                  }
                  className="w-full px-3 py-1.5 bg-cyber-900 border border-cyber-700 text-white rounded-xl text-xs font-mono focus:outline-none focus:border-cyan-500"
                >
                  <option value="viewer">Viewer (Scoped Read-Only, Recommended)</option>
                  <option value="developers">Developers (Baseline Deployers)</option>
                </select>
              ) : (
                <span className="text-xs font-mono text-cyan-300 font-semibold capitalize">
                  {policy.defaultRole}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Role Resolution Live Simulator */}
      <div className="bg-cyber-900/90 border border-cyber-700/80 rounded-3xl p-6 backdrop-blur-xl shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Play className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white font-mono">
              Live Role Resolution Simulator
            </h3>
            <p className="text-xs text-slate-400">
              Test how an identity provider user or group combination resolves against your active access policy in real-time.
            </p>
          </div>
        </div>

        <form onSubmit={handleSimulate} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">User Email</label>
            <input
              type="text"
              value={simEmail}
              onChange={(e) => setSimEmail(e.target.value)}
              placeholder="e.g. dev-lead@company.com"
              className="w-full px-3 py-2 text-xs font-mono bg-cyber-950 border border-cyber-700 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">Username (Optional)</label>
            <input
              type="text"
              value={simUsername}
              onChange={(e) => setSimUsername(e.target.value)}
              placeholder="e.g. jdoe"
              className="w-full px-3 py-2 text-xs font-mono bg-cyber-950 border border-cyber-700 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">Groups (comma-separated)</label>
            <input
              type="text"
              value={simGroups}
              onChange={(e) => setSimGroups(e.target.value)}
              placeholder="e.g. engineering, platform-devs"
              className="w-full px-3 py-2 text-xs font-mono bg-cyber-950 border border-cyber-700 rounded-xl text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={simulating}
              className="w-full py-2 px-4 rounded-xl bg-cyber-800 hover:bg-cyber-700 text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 text-xs font-mono font-semibold transition-all flex items-center justify-center gap-2"
            >
              {simulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Test Resolution</span>
            </button>
          </div>
        </form>

        {simResult && (
          <div className="mt-4 p-4 rounded-2xl bg-cyber-950/80 border border-cyber-800 flex items-center justify-between gap-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-slate-400">Resolved Persona:</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-mono font-bold uppercase border ${
                  simResult.resolvedRole === 'admin'
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                    : simResult.resolvedRole === 'developers' || simResult.resolvedRole === 'developer'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                }`}
              >
                {simResult.resolvedRole}
              </span>
              <span className="text-xs font-mono text-slate-400">
                Reason: <strong className="text-slate-200">{simResult.reason}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSimResult(null)}
              className="text-slate-500 hover:text-slate-300 text-xs font-mono"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
