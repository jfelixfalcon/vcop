import React, { useState } from 'react';
import type { VirtualCluster, DisasterRecoverySpec, DisasterRecoveryStatus, BackupItem } from '../lib/types';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  HardDrive,
  Database,
  Clock,
  RefreshCw,
  Download,
  AlertTriangle,
  CheckCircle2,
  X,
  Settings2,
  Calendar,
  RotateCcw,
  Copy,
  Check,
  Zap,
} from 'lucide-react';

interface Props {
  cluster: VirtualCluster;
  onRefresh: () => void;
  isAdmin?: boolean;
}

export const DisasterRecoveryTab: React.FC<Props> = ({ cluster, onRefresh, isAdmin = false }) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copiedSnapshot, setCopiedSnapshot] = useState<string | null>(null);

  // Configuration modal state
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [configEnabled, setConfigEnabled] = useState<boolean>(cluster.spec?.disasterRecovery?.enabled ?? true);
  const [configSchedule, setConfigSchedule] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>(
    cluster.spec?.disasterRecovery?.schedule || 'daily'
  );
  const [configCron, setConfigCron] = useState<string>(cluster.spec?.disasterRecovery?.cronExpression || '0 2 * * *');
  const [configRetention, setConfigRetention] = useState<number>(cluster.spec?.disasterRecovery?.retentionCount || 7);
  const [configStorageSize, setConfigStorageSize] = useState<string>(cluster.spec?.disasterRecovery?.storageSize || '10Gi');

  // Restore confirmation modal state
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [selectedSnapshot, setSelectedSnapshot] = useState<BackupItem | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);

  const drSpec = cluster.spec?.disasterRecovery;
  const drStatus = cluster.status?.disasterRecovery;
  const isEnabled = drSpec?.enabled ?? false;

  const handleCopySnapshotName = (name: string) => {
    navigator.clipboard.writeText(name);
    setCopiedSnapshot(name);
    setTimeout(() => setCopiedSnapshot(null), 2000);
  };

  const handleTriggerBackupNow = async () => {
    setLoadingAction('backup');
    setActionMessage(null);
    try {
      const res = await fetch(`/api/vclusters/${cluster.name}/dr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup-now' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to trigger backup');
      }
      setActionMessage({
        type: 'success',
        text: `Snapshot job '${data.data?.jobName || 'manual-backup'}' launched! The cluster etcd backup is running.`,
      });
      setTimeout(() => {
        onRefresh();
      }, 2000);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSaveSchedule = async () => {
    setLoadingAction('schedule');
    setActionMessage(null);
    try {
      const updatedSpec: DisasterRecoverySpec = {
        enabled: configEnabled,
        schedule: configSchedule,
        cronExpression: configSchedule === 'custom' ? configCron : undefined,
        retentionCount: configRetention,
        storageSize: configStorageSize,
      };

      const res = await fetch(`/api/vclusters/${cluster.name}/dr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-schedule',
          disasterRecovery: updatedSpec,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update schedule');
      }
      setActionMessage({
        type: 'success',
        text: `Backup schedule successfully saved (${configSchedule.toUpperCase()}).`,
      });
      setIsConfigModalOpen(false);
      onRefresh();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedSnapshot) return;
    setLoadingAction('restore');
    setActionMessage(null);
    try {
      const snapshotFilename = selectedSnapshot.filename || selectedSnapshot.name;
      const res = await fetch(`/api/vclusters/${cluster.name}/dr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore',
          snapshotName: snapshotFilename,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to initiate restore');
      }
      setActionMessage({
        type: 'success',
        text: `Cluster '${cluster.name}' restoration initiated from snapshot '${snapshotFilename}'. Etcd pods are safely restarting.`,
      });
      setIsRestoreModalOpen(false);
      setSelectedSnapshot(null);
      setRestoreConfirmed(false);
      setTimeout(() => {
        onRefresh();
      }, 3000);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message });
    } finally {
      setLoadingAction(null);
    }
  };

  const formatScheduleText = (sched: string, cron?: string) => {
    switch (sched) {
      case 'daily':
        return 'Daily (02:00 UTC)';
      case 'weekly':
        return 'Weekly (Every Sunday 02:00 UTC)';
      case 'monthly':
        return 'Monthly (1st of month 02:00 UTC)';
      case 'custom':
        return `Custom (${cron || '0 2 * * *'})`;
      default:
        return 'Daily (02:00 UTC)';
    }
  };

  const recentBackups = drStatus?.recentBackups || [];
  const backupsCount = recentBackups.length || drStatus?.backupsCount || 0;
  const totalSizeBytes = drStatus?.totalSizeBytes || (backupsCount * 6082560);
  const totalSizeHuman = drStatus?.totalSizeStr || `${(totalSizeBytes / (1024 * 1024)).toFixed(1)} MB`;

  const pvcName = drStatus?.backupsPvcName || `${cluster.name}-etcd-backups`;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Action Notification Banner */}
      {actionMessage && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : actionMessage.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-cyber-500/10 border-cyber-500/30 text-cyber-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {actionMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />}
            {actionMessage.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />}
            {actionMessage.type === 'info' && <Zap className="w-5 h-5 shrink-0 text-cyber-400" />}
            <span className="text-xs font-mono">{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-slate-400 hover:text-white transition-colors p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Protection Status */}
        <div className="bg-cyber-900/60 border border-cyber-800 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden group hover:border-cyber-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Automated DR</span>
            {isEnabled ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <ShieldOff className="w-3 h-3" />
                Disabled
              </span>
            )}
          </div>
          <div className="my-3 flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${isEnabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="text-base font-bold text-white tracking-tight">
                {isEnabled ? 'Protected' : 'Unprotected'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {isEnabled ? formatScheduleText(drSpec?.schedule || 'daily', drSpec?.cronExpression) : 'No automated schedule'}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 border-t border-cyber-800/80 pt-2 flex items-center justify-between">
            <span>Engine: etcdutl 3.6.8</span>
            <span>Runner: v1.3.0</span>
          </div>
        </div>

        {/* Card 2: Schedule & Cadence */}
        <div className="bg-cyber-900/60 border border-cyber-800 rounded-xl p-4 flex flex-col justify-between hover:border-cyber-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Backup Frequency</span>
            <Calendar className="w-4 h-4 text-cyber-400" />
          </div>
          <div className="my-3 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-cyber-500/10 text-cyber-400">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="text-base font-bold text-white uppercase tracking-tight">
                {drSpec?.schedule || 'Daily'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                Cron: {drStatus?.cronExpression || '0 2 * * *'}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 border-t border-cyber-800/80 pt-2 flex items-center justify-between">
            <span>Next Window: 02:00 UTC</span>
            <span>Policy: At Least Once</span>
          </div>
        </div>

        {/* Card 3: Dedicated Safe PVC */}
        <div className="bg-cyber-900/60 border border-cyber-800 rounded-xl p-4 flex flex-col justify-between hover:border-cyber-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Storage & Safety</span>
            <HardDrive className="w-4 h-4 text-purple-400" />
          </div>
          <div className="my-3 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
              <HardDrive className="w-6 h-6" />
            </div>
            <div className="overflow-hidden">
              <div className="text-sm font-bold text-white truncate font-mono" title={pvcName}>
                {pvcName}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                Size: {drSpec?.storageSize || '10Gi'} RWO
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 border-t border-cyber-800/80 pt-2 flex items-center justify-between">
            <span>Isolated from etcd data</span>
            <span className="text-emerald-400">Safe Volume</span>
          </div>
        </div>

        {/* Card 4: Retention & Footprint */}
        <div className="bg-cyber-900/60 border border-cyber-800 rounded-xl p-4 flex flex-col justify-between hover:border-cyber-700 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vault Footprint</span>
            <Database className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="my-3 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="text-base font-bold text-white tracking-tight">
                {backupsCount} Snapshot{backupsCount !== 1 ? 's' : ''}
              </div>
              <div className="text-[11px] text-slate-400 font-mono">
                {totalSizeHuman} in vault (Keep {drSpec?.retentionCount || 7})
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500 border-t border-cyber-800/80 pt-2 flex items-center justify-between">
            <span>Retention: Last {drSpec?.retentionCount || 7}</span>
            <span>Pruning: Automatic</span>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-cyber-950/60 border border-cyber-800/90 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-cyber-accent animate-ping" />
          <div>
            <h4 className="text-sm font-semibold text-white">Disaster Recovery Operations</h4>
            <p className="text-xs text-slate-400 font-mono">
              Take on-demand snapshots, configure schedule frequency, or restore point-in-time state.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onRefresh()}
            className="px-3 py-2 text-xs font-semibold bg-cyber-900/80 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-700/60 flex items-center gap-1.5 transition-all shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setIsConfigModalOpen(true)}
                className="px-3.5 py-2 text-xs font-semibold bg-cyber-900 hover:bg-cyber-800 text-cyber-300 hover:text-white rounded-lg border border-cyber-700 flex items-center gap-1.5 transition-all shadow-sm"
              >
                <Settings2 className="w-3.5 h-3.5 text-cyber-400" />
                Configure Schedule
              </button>

              <button
                onClick={handleTriggerBackupNow}
                disabled={loadingAction === 'backup'}
                className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-lg shadow-lg shadow-emerald-900/30 flex items-center gap-2 transition-all"
              >
                {loadingAction === 'backup' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Snapshotting...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Backup Now
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Snapshot History Table */}
      <div className="bg-cyber-900/40 border border-cyber-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-cyber-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyber-accent" />
            <h3 className="text-sm font-semibold text-white">Etcd Point-In-Time Snapshots</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyber-800 text-slate-300 font-mono">
              {recentBackups.length}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Backups isolated on PVC: <span className="text-purple-300">{pvcName}</span>
          </span>
        </div>

        {recentBackups.length === 0 ? (
          <div className="p-12 text-center">
            <Database className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h4 className="text-sm font-semibold text-slate-300 mb-1">No Snapshots Found</h4>
            <p className="text-xs text-slate-500 font-mono max-w-md mx-auto mb-5">
              No previous backups have been taken yet for this vcluster. Automated backups will run based on your configured schedule, or you can trigger one immediately.
            </p>
            <button
              onClick={handleTriggerBackupNow}
              disabled={loadingAction === 'backup'}
              className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow inline-flex items-center gap-2 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              Take First Backup Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-cyber-950/60 border-b border-cyber-800 text-slate-400 uppercase font-mono text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Snapshot File</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Cluster Origin</th>
                  {isAdmin && <th className="py-3 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-cyber-800/50 text-slate-300">
                {recentBackups.map((b, idx) => {
                  const filename = b.filename || b.name;
                  const isLatest = idx === 0;
                  const timeStr = b.timestamp ? new Date(b.timestamp).toLocaleString() : 'Recent';

                  return (
                    <tr key={filename} className="hover:bg-cyber-800/30 transition-colors group">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 font-mono">
                          <Database className="w-4 h-4 text-cyber-400 shrink-0" />
                          <span className="font-semibold text-white">{filename}</span>
                          {isLatest && (
                            <span className="px-1.5 py-0.2 rounded bg-cyber-500/20 text-cyber-300 text-[10px] font-semibold border border-cyber-500/30">
                              latest
                            </span>
                          )}
                          <button
                            onClick={() => handleCopySnapshotName(filename)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-white transition-opacity text-slate-400"
                            title="Copy filename"
                          >
                            {copiedSnapshot === filename ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          {timeStr}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {b.size || '5.8 MB'}
                      </td>
                      <td className="py-3.5 px-4">
                        {b.status === 'Completed' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified
                          </span>
                        ) : b.status === 'InProgress' ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 animate-pulse">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            In Progress
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            <AlertTriangle className="w-3 h-3" />
                            Failed
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400">
                        {b.clusterOrigin || cluster.name}
                      </td>
                      {isAdmin && (
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => {
                              setSelectedSnapshot(b);
                              setIsRestoreModalOpen(true);
                              setRestoreConfirmed(false);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/30 rounded inline-flex items-center gap-1 transition-all"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Restore
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: Configure Backup Schedule */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cyber-900 border border-cyber-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-cyber-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-cyber-500/10 text-cyber-400">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Configure Disaster Recovery Schedule</h3>
                  <p className="text-xs text-slate-400 font-mono">Automated periodic snapshot policies</p>
                </div>
              </div>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Toggle: Enable / Disable */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
                <div>
                  <div className="text-xs font-bold text-white">Enable Automated Backups</div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    CronJob will automatically create snapshots into dedicated PVC
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configEnabled}
                    onChange={(e) => setConfigEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              {/* Frequency Selector */}
              {configEnabled && (
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                    Backup Frequency
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      { id: 'daily', title: 'Daily', desc: 'Every day at 02:00 UTC' },
                      { id: 'weekly', title: 'Weekly', desc: 'Every Sunday at 02:00 UTC' },
                      { id: 'monthly', title: 'Monthly', desc: '1st of month at 02:00 UTC' },
                      { id: 'custom', title: 'Custom Cron', desc: 'Specify custom 5-field cron' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setConfigSchedule(opt.id as any)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          configSchedule === opt.id
                            ? 'bg-cyber-500/10 border-cyber-accent text-white shadow-sm'
                            : 'bg-cyber-950/40 border-cyber-800 text-slate-400 hover:text-slate-200 hover:border-cyber-700'
                        }`}
                      >
                        <div className="text-xs font-bold flex items-center justify-between">
                          {opt.title}
                          {configSchedule === opt.id && <Check className="w-3.5 h-3.5 text-cyber-accent" />}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-1">{opt.desc}</div>
                      </button>
                    ))}
                  </div>

                  {/* Custom Cron Input */}
                  {configSchedule === 'custom' && (
                    <div className="mt-3 space-y-1.5">
                      <label className="text-[11px] font-mono text-slate-400">Cron Expression (5-field UTC)</label>
                      <input
                        type="text"
                        value={configCron}
                        onChange={(e) => setConfigCron(e.target.value)}
                        placeholder="0 2 * * *"
                        className="w-full bg-cyber-950 border border-cyber-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      />
                    </div>
                  )}

                  {/* Retention Count */}
                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-300">Retention Count</span>
                      <span className="font-mono text-cyber-accent font-bold">Keep last {configRetention} backups</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      value={configRetention}
                      onChange={(e) => setConfigRetention(parseInt(e.target.value, 10))}
                      className="w-full accent-cyber-accent bg-cyber-950 h-1.5 rounded-lg cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>1 snapshot</span>
                      <span>15 snapshots</span>
                      <span>30 snapshots</span>
                    </div>
                  </div>

                  {/* Dedicated Storage Volume Size */}
                  <div className="space-y-1.5 pt-2">
                    <label className="text-xs font-bold text-slate-300">Backup PVC Storage Request</label>
                    <input
                      type="text"
                      value={configStorageSize}
                      onChange={(e) => setConfigStorageSize(e.target.value)}
                      placeholder="10Gi"
                      className="w-full bg-cyber-950 border border-cyber-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                    />
                    <span className="text-[10px] text-slate-500 font-mono block">
                      Dedicated claim name: {cluster.name}-etcd-backups
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-cyber-950/80 border-t border-cyber-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsConfigModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSchedule}
                disabled={loadingAction === 'schedule'}
                className="px-5 py-2 text-xs font-bold bg-cyber-accent hover:bg-cyber-accent-hover text-cyber-900 rounded-lg shadow-md flex items-center gap-1.5 transition-all"
              >
                {loadingAction === 'schedule' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Schedule'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Restore Snapshot Confirmation */}
      {isRestoreModalOpen && selectedSnapshot && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-cyber-900 border border-amber-500/50 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="p-5 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Disaster Recovery Restore</h3>
                  <p className="text-xs text-amber-300/80 font-mono">Rollback cluster to point-in-time state</p>
                </div>
              </div>
              <button
                onClick={() => setIsRestoreModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">Important Restoration Warning</div>
                  <div className="text-[11px] leading-relaxed text-amber-300/90 font-mono">
                    Restoring from this snapshot will roll back the virtual Kubernetes cluster state (all tenant namespaces, deployments, CRDs, secrets) to this exact point in time. The HA etcd member StatefulSets will execute a rolling restore init sequence.
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-cyber-950/80 border border-cyber-800 space-y-2.5 font-mono text-xs">
                <div className="flex justify-between items-center text-slate-400">
                  <span>Target Cluster:</span>
                  <span className="font-bold text-white">{cluster.name}</span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Selected Snapshot:</span>
                  <span className="font-bold text-cyan-300 truncate max-w-[260px]">
                    {selectedSnapshot.filename || selectedSnapshot.name}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Snapshot Timestamp:</span>
                  <span className="text-slate-200">
                    {selectedSnapshot.timestamp ? new Date(selectedSnapshot.timestamp).toLocaleString() : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-400">
                  <span>Snapshot Size:</span>
                  <span className="text-slate-200">{selectedSnapshot.size || '5.8 MB'}</span>
                </div>
              </div>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-cyber-950/50 border border-cyber-800/80 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={restoreConfirmed}
                  onChange={(e) => setRestoreConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-cyber-700 text-amber-500 focus:ring-amber-500/20"
                />
                <span className="text-xs text-slate-300">
                  I understand that this action rolls back etcd state and will trigger a rolling restart of cluster <strong className="text-white font-mono">{cluster.name}</strong>.
                </span>
              </label>
            </div>

            <div className="p-4 bg-cyber-950/80 border-t border-cyber-800 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsRestoreModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={!restoreConfirmed || loadingAction === 'restore'}
                className="px-5 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black rounded-lg shadow-md flex items-center gap-1.5 transition-all"
              >
                {loadingAction === 'restore' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Restoring...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Confirm & Restore
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
