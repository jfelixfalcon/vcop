import React, { useState, useEffect } from 'react';
import {
  X,
  FolderPlus,
  FolderGit2,
  Tag,
  Check,
  AlertCircle,
  Plus,
  Trash2,
  Layers,
  Server,
  Edit2,
  Lock,
} from 'lucide-react';
import type { VirtualCluster, ClusterGroupInfo } from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated?: VirtualCluster) => void;
  allClusters?: VirtualCluster[];
}

export const ClusterGroupModal: React.FC<Props> = ({
  cluster,
  isOpen,
  onClose,
  onSuccess,
  allClusters = [],
}) => {
  const [activeGroups, setActiveGroups] = useState<string[]>([]);
  const [newGroupInput, setNewGroupInput] = useState('');
  const [fleetGroups, setFleetGroups] = useState<ClusterGroupInfo[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fleet management mode (when cluster === null)
  const [selectedFleetGroup, setSelectedFleetGroup] = useState<string | null>(null);
  const [groupClusterMembers, setGroupClusterMembers] = useState<string[]>([]);

  const fetchFleetGroups = async () => {
    try {
      const res = await fetch('/api/vclusters/groups');
      const data = await res.json();
      if (data.success && data.data) {
        setFleetGroups(data.data);
      }
    } catch {
      // Fallback from allClusters
      if (allClusters.length > 0) {
        const map: Record<string, string[]> = {};
        for (const c of allClusters) {
          const grps = c.metadata?.clusterGroups || (c.metadata?.clusterGroup ? [c.metadata.clusterGroup] : []);
          for (const g of grps) {
            const trimmed = g.trim();
            if (!trimmed) continue;
            if (!map[trimmed]) map[trimmed] = [];
            map[trimmed].push(c.name);
          }
        }
        setFleetGroups(
          Object.entries(map).map(([name, clusters]) => ({
            name,
            clusterCount: clusters.length,
            clusters,
          }))
        );
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setNewGroupInput('');
      fetchFleetGroups();

      if (cluster) {
        const current = cluster.metadata?.clusterGroups || (cluster.metadata?.clusterGroup ? [cluster.metadata.clusterGroup] : []);
        setActiveGroups([...current]);
      } else {
        setSelectedFleetGroup(null);
        setGroupClusterMembers([]);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddGroup = (groupToAdd: string) => {
    const trimmed = groupToAdd.trim();
    if (!trimmed) return;
    if (!activeGroups.includes(trimmed)) {
      setActiveGroups([...activeGroups, trimmed]);
    }
    setNewGroupInput('');
  };

  const handleRemoveGroup = (groupToRemove: string) => {
    setActiveGroups(activeGroups.filter((g) => g !== groupToRemove));
  };

  const handleSaveClusterGroups = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cluster) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clusterGroups: activeGroups,
          namespace: cluster.namespace,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update cluster groups');
      }

      onSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save cluster groups');
    } finally {
      setSubmitting(false);
    }
  };

  // Fleet Mode handlers
  const handleSelectFleetGroup = (groupName: string) => {
    setSelectedFleetGroup(groupName);
    const existing = fleetGroups.find((g) => g.name === groupName);
    setGroupClusterMembers(existing ? [...existing.clusters] : []);
  };

  const handleToggleClusterMembership = (clusterName: string) => {
    if (groupClusterMembers.includes(clusterName)) {
      setGroupClusterMembers(groupClusterMembers.filter((name) => name !== clusterName));
    } else {
      setGroupClusterMembers([...groupClusterMembers, clusterName]);
    }
  };

  const handleSaveFleetGroup = async () => {
    if (!selectedFleetGroup) return;
    setSubmitting(true);
    setError(null);

    try {
      // Find clusters to add and clusters to remove
      const oldGroup = fleetGroups.find((g) => g.name === selectedFleetGroup);
      const oldMembers = oldGroup ? oldGroup.clusters : [];

      const toAdd = groupClusterMembers.filter((name) => !oldMembers.includes(name));
      const toRemove = oldMembers.filter((name) => !groupClusterMembers.includes(name));

      for (const name of toAdd) {
        const c = allClusters.find((item) => item.name === name);
        if (c) {
          const cur = c.metadata?.clusterGroups || (c.metadata?.clusterGroup ? [c.metadata.clusterGroup] : []);
          if (!cur.includes(selectedFleetGroup)) {
            await fetch(`/api/vclusters/${name}/groups`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clusterGroups: [...cur, selectedFleetGroup],
                namespace: c.namespace,
              }),
            });
          }
        }
      }

      for (const name of toRemove) {
        const c = allClusters.find((item) => item.name === name);
        if (c) {
          const cur = c.metadata?.clusterGroups || (c.metadata?.clusterGroup ? [c.metadata.clusterGroup] : []);
          const updated = cur.filter((g) => g !== selectedFleetGroup);
          await fetch(`/api/vclusters/${name}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clusterGroups: updated,
              namespace: c.namespace,
            }),
          });
        }
      }

      await fetchFleetGroups();
      onSuccess();
      setSelectedFleetGroup(null);
    } catch (err: any) {
      setError(err.message || 'Failed saving fleet cluster group');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteFleetGroup = async (groupName: string) => {
    if (!confirm(`Are you sure you want to remove grouping "${groupName}" from all clusters?`)) return;
    setSubmitting(true);
    setError(null);

    try {
      await fetch('/api/vclusters/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName,
          action: 'delete-group',
        }),
      });

      await fetchFleetGroups();
      onSuccess();
      if (selectedFleetGroup === groupName) {
        setSelectedFleetGroup(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed deleting group');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateNewFleetGroup = () => {
    const trimmed = newGroupInput.trim();
    if (!trimmed) return;
    setSelectedFleetGroup(trimmed);
    setGroupClusterMembers([]);
    setNewGroupInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-cyber-900 border border-cyber-700/80 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-cyber-800 bg-cyber-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/15 text-indigo-400 rounded-xl border border-indigo-500/20">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {cluster ? `Manage Groupings: ${cluster.name}` : 'Fleet Cluster Groupings'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {cluster
                  ? 'Assign or update cluster groups to organize, filter, and govern fleets.'
                  : 'Create, edit, or delete logical group classifications across all vclusters.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-cyber-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="m-5 mb-0 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 space-y-5 overflow-y-auto">
          {cluster ? (
            /* SINGLE CLUSTER GROUP MANAGEMENT */
            <form onSubmit={handleSaveClusterGroups} className="space-y-5">
              {/* Active Groups Chips */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Assigned Groups
                </label>
                {activeGroups.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-cyber-800 bg-cyber-950/40 text-center text-xs text-slate-500 font-mono">
                    No groupings assigned to this virtual cluster yet. Add one below.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 p-3 bg-cyber-950/80 border border-cyber-800 rounded-xl">
                    {activeGroups.map((grp) => (
                      <span
                        key={grp}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-mono font-medium rounded-lg"
                      >
                        <Tag className="w-3 h-3 text-indigo-400" />
                        {grp}
                        <button
                          type="button"
                          onClick={() => handleRemoveGroup(grp)}
                          className="hover:text-white hover:bg-indigo-500/20 rounded p-0.5 transition-colors"
                          title={`Remove ${grp}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Add / Create Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Add or Create Grouping
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGroupInput}
                    onChange={(e) => setNewGroupInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddGroup(newGroupInput);
                      }
                    }}
                    placeholder="e.g. fintech, core-infra, team-beta..."
                    className="flex-1 bg-cyber-950 border border-cyber-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddGroup(newGroupInput)}
                    disabled={!newGroupInput.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shrink-0 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </div>

              {/* Existing Fleet Groups suggestions */}
              {fleetGroups.length > 0 && (
                <div>
                  <span className="text-[11px] font-mono text-slate-400 block mb-2">
                    Available Fleet Groups (Click to assign):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {fleetGroups.map((g) => {
                      const isAssigned = activeGroups.includes(g.name);
                      return (
                        <button
                          key={g.name}
                          type="button"
                          onClick={() => (isAssigned ? handleRemoveGroup(g.name) : handleAddGroup(g.name))}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-all flex items-center gap-1.5 ${
                            isAssigned
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm'
                              : 'bg-cyber-850 hover:bg-cyber-800 text-slate-400 hover:text-slate-200 border-cyber-750'
                          }`}
                        >
                          <Tag className="w-3 h-3 text-indigo-400" />
                          <span>{g.name}</span>
                          {isAssigned ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <span className="text-[10px] text-slate-500">({g.clusterCount})</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-3 border-t border-cyber-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-slate-950 font-semibold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Groupings'}
                </button>
              </div>
            </form>
          ) : (
            /* FLEET-WIDE GROUP MANAGEMENT */
            <div className="space-y-5">
              {/* Create New Grouping Bar */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Create New Fleet Grouping
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGroupInput}
                    onChange={(e) => setNewGroupInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateNewFleetGroup();
                      }
                    }}
                    placeholder="Enter new group name (e.g. machine-learning, payments)..."
                    className="flex-1 bg-cyber-950 border border-cyber-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-400 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewFleetGroup}
                    disabled={!newGroupInput.trim()}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors shrink-0 shadow-sm"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    Create Group
                  </button>
                </div>
              </div>

              {/* Group List */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Existing Groupings ({fleetGroups.length})
                </label>
                {fleetGroups.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-cyber-800 bg-cyber-950/40 text-center text-xs text-slate-500 font-mono">
                    No groupings exist yet across your virtual cluster fleet. Create your first group above!
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fleetGroups.map((g) => {
                      const isSelected = selectedFleetGroup === g.name;
                      return (
                        <div
                          key={g.name}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                            isSelected
                              ? 'bg-indigo-950/40 border-indigo-500/50 shadow-sm'
                              : 'bg-cyber-950/60 border-cyber-800 hover:border-cyber-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                              <FolderGit2 className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-bold font-mono text-white flex items-center gap-2">
                                {g.name}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyber-800 text-slate-300 font-normal">
                                  {g.clusterCount} {g.clusterCount === 1 ? 'cluster' : 'clusters'}
                                </span>
                              </h4>
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {g.clusters.length > 0 ? g.clusters.join(', ') : 'No clusters assigned'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSelectFleetGroup(g.name)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1 ${
                                isSelected
                                  ? 'bg-indigo-600 text-white border-indigo-500'
                                  : 'bg-cyber-800 text-slate-300 border-cyber-700 hover:text-white'
                              }`}
                            >
                              <Edit2 className="w-3 h-3" />
                              Edit Members
                            </button>
                            <a
                              href="/admin/oidc"
                              className="px-2 py-1 text-xs font-medium rounded-lg border border-purple-500/30 text-purple-300 bg-purple-950/30 hover:bg-purple-900/40 transition-colors flex items-center gap-1"
                              title={`Configure OIDC policy for group ${g.name}`}
                            >
                              <Lock className="w-3 h-3 text-purple-400" />
                              OIDC
                            </a>
                            <button
                              type="button"
                              onClick={() => handleDeleteFleetGroup(g.name)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                              title={`Delete ${g.name} group`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Group Membership Editor Drawer */}
              {selectedFleetGroup && (
                <div className="p-4 bg-cyber-950/90 border border-indigo-500/40 rounded-xl space-y-3 animate-in fade-in duration-150">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-indigo-400" />
                      Select Clusters for Group: <span className="text-indigo-300 font-mono">{selectedFleetGroup}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      {groupClusterMembers.length} selected
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {allClusters.map((c) => {
                      const isSelected = groupClusterMembers.includes(c.name);
                      return (
                        <button
                          key={c.name}
                          type="button"
                          onClick={() => handleToggleClusterMembership(c.name)}
                          className={`p-2.5 rounded-xl border text-left text-xs font-mono transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-indigo-500/15 border-indigo-500/40 text-white'
                              : 'bg-cyber-900 border-cyber-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Server className="w-3.5 h-3.5 text-cyber-accent shrink-0" />
                            <span className="truncate">{c.name}</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-cyber-800">
                    <button
                      type="button"
                      onClick={() => setSelectedFleetGroup(null)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
                    >
                      Done
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleSaveFleetGroup}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50"
                    >
                      {submitting ? 'Applying...' : 'Apply Membership'}
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-cyber-800 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-700 text-slate-200 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
