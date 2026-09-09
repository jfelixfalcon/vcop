import React, { useState, useEffect } from 'react';
import {
  Gauge,
  Sliders,
  X,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Sparkles,
  AlertOctagon,
  ShieldCheck,
} from 'lucide-react';
import type { VirtualCluster, PoliciesSpec, ClusterCapacityData } from '../lib/types';
import { parseCpuMillis, parseMemoryBytes, formatCpuMillis, formatMemoryBytes } from '../lib/metrics-utils';
import { ModalPortal } from './ModalPortal';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateSuccess: (updated: VirtualCluster) => void;
}

export const QuotaModal: React.FC<Props> = ({ cluster, isOpen, onClose, onUpdateSuccess }) => {
  // Active section tab
  const [activeTab, setActiveTab] = useState<'compute' | 'counts' | 'limits'>('compute');

  // ResourceQuota state
  const [rqEnabled, setRqEnabled] = useState<boolean>(true);
  const [requestsCPU, setRequestsCPU] = useState<string>('4');
  const [limitsCPU, setLimitsCPU] = useState<string>('8');
  const [requestsMemory, setRequestsMemory] = useState<string>('8Gi');
  const [limitsMemory, setLimitsMemory] = useState<string>('16Gi');
  const [requestsStorage, setRequestsStorage] = useState<string>('25Gi');
  const [pods, setPods] = useState<string>('25');
  const [services, setServices] = useState<string>('25');
  const [persistentVolumeClaims, setPersistentVolumeClaims] = useState<string>('10');
  const [servicesLoadBalancers, setServicesLoadBalancers] = useState<string>('2');
  const [servicesNodePorts, setServicesNodePorts] = useState<string>('0');
  const [configMaps, setConfigMaps] = useState<string>('50');
  const [secrets, setSecrets] = useState<string>('50');

  // LimitRange state
  const [lrEnabled, setLrEnabled] = useState<boolean>(true);
  const [defaultRequestCPU, setDefaultRequestCPU] = useState<string>('100m');
  const [defaultRequestMemory, setDefaultRequestMemory] = useState<string>('128Mi');
  const [defaultCPU, setDefaultCPU] = useState<string>('500m');
  const [defaultMemory, setDefaultMemory] = useState<string>('512Mi');
  const [maxCPU, setMaxCPU] = useState<string>('4');
  const [maxMemory, setMaxMemory] = useState<string>('8Gi');
  const [minCPU, setMinCPU] = useState<string>('10m');
  const [minMemory, setMinMemory] = useState<string>('32Mi');

  // Submission state
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [clusterCapacity, setClusterCapacity] = useState<ClusterCapacityData | null>(null);
  const [ignoreCapacityCheck, setIgnoreCapacityCheck] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/cluster/capacity')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.capacity) {
          setClusterCapacity(data.capacity);
        }
      })
      .catch((e) => console.warn('Failed loading capacity in QuotaModal:', e));
  }, [isOpen]);

  const checkQuotaOvercommit = () => {
    if (!clusterCapacity || !cluster) return { isOverallocated: false, errors: [] as string[] };
    const currentReqCpu = parseCpuMillis(cluster.spec.policies?.resourceQuota?.requestsCPU || cluster.status.quota?.hard?.['requests.cpu'] || '4');
    const currentReqMem = parseMemoryBytes(cluster.spec.policies?.resourceQuota?.requestsMemory || cluster.status.quota?.hard?.['requests.memory'] || '8Gi');
    const currentReqStorage = parseMemoryBytes(cluster.spec.policies?.resourceQuota?.requestsStorage || cluster.status.quota?.hard?.['requests.storage'] || '25Gi');

    const newReqCpu = parseCpuMillis(requestsCPU);
    const newReqMem = parseMemoryBytes(requestsMemory);
    const newReqStorage = parseMemoryBytes(requestsStorage);

    const deltaCpu = newReqCpu - currentReqCpu;
    const deltaMem = newReqMem - currentReqMem;
    const deltaStorage = newReqStorage - currentReqStorage;

    const errors: string[] = [];
    if (deltaCpu > 0 && deltaCpu > clusterCapacity.availableCpuMillis) {
      errors.push(
        `CPU increase (+${formatCpuMillis(deltaCpu)}) exceeds available cluster headroom (${clusterCapacity.availableCpuStr} remaining)`
      );
    }
    if (deltaMem > 0 && deltaMem > clusterCapacity.availableMemoryBytes) {
      errors.push(
        `Memory increase (+${formatMemoryBytes(deltaMem)}) exceeds available cluster headroom (${clusterCapacity.availableMemoryStr} remaining)`
      );
    }
    if (deltaStorage > 0 && deltaStorage > clusterCapacity.availableStorageBytes) {
      errors.push(
        `Storage increase (+${formatMemoryBytes(deltaStorage)}) exceeds available cluster headroom (${clusterCapacity.availableStorageStr} remaining)`
      );
    }

    return {
      isOverallocated: errors.length > 0,
      errors,
      deltaCpu,
      deltaMem,
      deltaStorage,
    };
  };

  // Initialize from existing cluster spec or status
  useEffect(() => {
    if (!isOpen || !cluster) return;

    const rq = cluster.spec.policies?.resourceQuota;
    const lr = cluster.spec.policies?.limitRange;
    const hard = cluster.status.quota?.hard;

    if (rq) {
      setRqEnabled(rq.enabled ?? true);
      setRequestsCPU(rq.requestsCPU || hard?.['requests.cpu'] || '4');
      setLimitsCPU(rq.limitsCPU || hard?.['limits.cpu'] || '8');
      setRequestsMemory(rq.requestsMemory || hard?.['requests.memory'] || '8Gi');
      setLimitsMemory(rq.limitsMemory || hard?.['limits.memory'] || '16Gi');
      setRequestsStorage(rq.requestsStorage || hard?.['requests.storage'] || '25Gi');
      setPods(rq.pods || hard?.['pods'] || hard?.['count/pods'] || '25');
      setServices(rq.services || hard?.['services'] || '25');
      setPersistentVolumeClaims(rq.persistentVolumeClaims || hard?.['persistentvolumeclaims'] || '10');
      setServicesLoadBalancers(rq.servicesLoadBalancers || hard?.['services.loadbalancers'] || '2');
      setServicesNodePorts(rq.servicesNodePorts || hard?.['services.nodeports'] || '0');
      setConfigMaps(rq.configMaps || hard?.['configmaps'] || '50');
      setSecrets(rq.secrets || hard?.['secrets'] || '50');
    } else if (hard) {
      setRequestsCPU(hard['requests.cpu'] || '4');
      setLimitsCPU(hard['limits.cpu'] || '8');
      setRequestsMemory(hard['requests.memory'] || '8Gi');
      setLimitsMemory(hard['limits.memory'] || '16Gi');
      setRequestsStorage(hard['requests.storage'] || '25Gi');
      setPods(hard['pods'] || hard['count/pods'] || '25');
      setServices(hard['services'] || '25');
      setPersistentVolumeClaims(hard['persistentvolumeclaims'] || '10');
      setServicesLoadBalancers(hard['services.loadbalancers'] || '2');
      setServicesNodePorts(hard['services.nodeports'] || '0');
      setConfigMaps(hard['configmaps'] || '50');
      setSecrets(hard['secrets'] || '50');
    }

    if (lr) {
      setLrEnabled(lr.enabled ?? true);
      if (lr.defaultRequestCPU) setDefaultRequestCPU(lr.defaultRequestCPU);
      if (lr.defaultRequestMemory) setDefaultRequestMemory(lr.defaultRequestMemory);
      if (lr.defaultCPU) setDefaultCPU(lr.defaultCPU);
      if (lr.defaultMemory) setDefaultMemory(lr.defaultMemory);
      if (lr.maxCPU) setMaxCPU(lr.maxCPU);
      if (lr.maxMemory) setMaxMemory(lr.maxMemory);
      if (lr.minCPU) setMinCPU(lr.minCPU);
      if (lr.minMemory) setMinMemory(lr.minMemory);
    }
  }, [isOpen]);

  const loadPreset = (preset: 'small' | 'medium' | 'large') => {
    switch (preset) {
      case 'small':
        setRequestsCPU('1');
        setLimitsCPU('2');
        setRequestsMemory('2Gi');
        setLimitsMemory('4Gi');
        setRequestsStorage('10Gi');
        setPods('10');
        setServices('10');
        setPersistentVolumeClaims('5');
        setServicesLoadBalancers('1');
        setServicesNodePorts('0');
        setConfigMaps('25');
        setSecrets('25');
        setDefaultRequestCPU('50m');
        setDefaultRequestMemory('64Mi');
        setDefaultCPU('250m');
        setDefaultMemory('256Mi');
        setMaxCPU('1');
        setMaxMemory('2Gi');
        break;
      case 'medium':
        setRequestsCPU('4');
        setLimitsCPU('8');
        setRequestsMemory('8Gi');
        setLimitsMemory('16Gi');
        setRequestsStorage('25Gi');
        setPods('25');
        setServices('25');
        setPersistentVolumeClaims('10');
        setServicesLoadBalancers('2');
        setServicesNodePorts('0');
        setConfigMaps('50');
        setSecrets('50');
        setDefaultRequestCPU('100m');
        setDefaultRequestMemory('128Mi');
        setDefaultCPU('500m');
        setDefaultMemory('512Mi');
        setMaxCPU('4');
        setMaxMemory('8Gi');
        break;
      case 'large':
        setRequestsCPU('8');
        setLimitsCPU('16');
        setRequestsMemory('16Gi');
        setLimitsMemory('32Gi');
        setRequestsStorage('50Gi');
        setPods('50');
        setServices('50');
        setPersistentVolumeClaims('25');
        setServicesLoadBalancers('5');
        setServicesNodePorts('2');
        setConfigMaps('100');
        setSecrets('100');
        setDefaultRequestCPU('200m');
        setDefaultRequestMemory('256Mi');
        setDefaultCPU('1');
        setDefaultMemory('1Gi');
        setMaxCPU('8');
        setMaxMemory('16Gi');
        break;
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const policies: PoliciesSpec = {
      ...cluster.spec.policies,
      resourceQuota: {
        enabled: rqEnabled,
        requestsCPU: requestsCPU.trim(),
        limitsCPU: limitsCPU.trim(),
        requestsMemory: requestsMemory.trim(),
        limitsMemory: limitsMemory.trim(),
        requestsStorage: requestsStorage.trim(),
        pods: pods.trim(),
        services: services.trim(),
        persistentVolumeClaims: persistentVolumeClaims.trim(),
        servicesLoadBalancers: servicesLoadBalancers.trim(),
        servicesNodePorts: servicesNodePorts.trim(),
        configMaps: configMaps.trim(),
        secrets: secrets.trim(),
      },
      limitRange: {
        enabled: lrEnabled,
        defaultRequestCPU: defaultRequestCPU.trim(),
        defaultRequestMemory: defaultRequestMemory.trim(),
        defaultCPU: defaultCPU.trim(),
        defaultMemory: defaultMemory.trim(),
        maxCPU: maxCPU.trim(),
        maxMemory: maxMemory.trim(),
        minCPU: minCPU.trim(),
        minMemory: minMemory.trim(),
      },
    };

    const overcommit = checkQuotaOvercommit();
    if (overcommit.isOverallocated && !ignoreCapacityCheck) {
      setError(`Cannot save quota: ${overcommit.errors[0]}. Reduce requested values or enable Administrator Override.`);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/vclusters/${cluster.name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policies,
          namespace: cluster.namespace,
          ignoreCapacityCheck,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update quota policies');
      }

      onUpdateSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !cluster) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-cyber-950/80 backdrop-blur-md animate-in fade-in duration-150">
        <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] my-auto">
        {/* Top Glow */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[1px] bg-gradient-to-r from-transparent via-cyan-500 to-transparent"></div>

        {/* Modal Header */}
        <div className="flex justify-between items-start p-6 pb-4 border-b border-cyber-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Adjust Quotas & Policies: <span className="font-mono text-cyan-400">{cluster.name}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Dynamic resource bounds and container limit ranges enforced by vc-operator
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

        {/* Quick Presets Bar */}
        <div className="px-6 py-2.5 bg-cyber-950/80 border-b border-cyber-800 flex items-center justify-between text-xs">
          <span className="text-slate-400 font-mono text-[11px] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            Load Standard Preset:
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadPreset('small')}
              className="px-2.5 py-1 bg-cyber-850 hover:bg-cyber-800 text-slate-300 hover:text-white rounded-lg border border-cyber-750 font-mono text-[11px] transition-colors"
            >
              Small (1C/2G)
            </button>
            <button
              type="button"
              onClick={() => loadPreset('medium')}
              className="px-2.5 py-1 bg-cyber-850 hover:bg-cyber-800 text-cyan-300 hover:text-white rounded-lg border border-cyan-500/30 font-mono text-[11px] transition-colors"
            >
              Medium (4C/8G)
            </button>
            <button
              type="button"
              onClick={() => loadPreset('large')}
              className="px-2.5 py-1 bg-cyber-850 hover:bg-cyber-800 text-purple-300 hover:text-white rounded-lg border border-purple-500/30 font-mono text-[11px] transition-colors"
            >
              Large (8C/16G)
            </button>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex px-6 border-b border-cyber-800 gap-4 pt-3 bg-cyber-900/50">
          {[
            { id: 'compute', label: 'Compute & Storage', icon: Cpu },
            { id: 'counts', label: 'Object Counts', icon: Layers },
            { id: 'limits', label: 'Container LimitRange', icon: Gauge },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-2.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all ${
                  isActive
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Form Body (Scrollable) */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: Compute & Storage */}
          {activeTab === 'compute' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Headroom & Capacity Telemetry */}
              {clusterCapacity && (() => {
                const overcommit = checkQuotaOvercommit();
                return (
                  <div className={`p-3 rounded-xl border text-xs font-mono transition-all ${
                    overcommit.isOverallocated && !ignoreCapacityCheck
                      ? 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                      : 'bg-cyber-950/70 border-cyber-800 text-slate-400'
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {overcommit.isOverallocated && !ignoreCapacityCheck ? (
                          <AlertOctagon className="w-4 h-4 text-rose-400 animate-pulse" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        )}
                        <span className="text-white font-semibold">
                          Host Headroom: {clusterCapacity.availableCpuStr} CPU • {clusterCapacity.availableMemoryStr} RAM • {clusterCapacity.availableStorageStr} Storage
                        </span>
                      </div>
                      {overcommit.isOverallocated && (
                        <span className={`text-[10px] px-2 py-0.2 rounded border ${
                          ignoreCapacityCheck
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                        }`}>
                          {ignoreCapacityCheck ? 'Override Active' : 'Headroom Exceeded'}
                        </span>
                      )}
                    </div>
                    {overcommit.isOverallocated && (
                      <div className="mt-2 pt-2 border-t border-rose-800/40 space-y-1 text-[11px]">
                        {overcommit.errors.map((err, i) => (
                          <div key={i} className="text-rose-300">• {err}</div>
                        ))}
                        <label className="flex items-center gap-2 pt-1 text-slate-300 hover:text-white cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ignoreCapacityCheck}
                            onChange={(e) => setIgnoreCapacityCheck(e.target.checked)}
                            className="rounded border-cyber-700 bg-cyber-900 text-cyan-500"
                          />
                          <span className="text-amber-300 text-[10px]">
                            Administrator Override: Force overcommit beyond host allocatable capacity
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex items-center justify-between pb-2 border-b border-cyber-800">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-white">
                  <input
                    type="checkbox"
                    checked={rqEnabled}
                    onChange={(e) => setRqEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 bg-cyber-950 border-cyber-700"
                  />
                  Enforce ResourceQuota on Virtual Cluster
                </label>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                  Dual Host & In-Cluster
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    CPU Requests Limit:
                  </label>
                  <input
                    type="text"
                    value={requestsCPU}
                    onChange={(e) => setRequestsCPU(e.target.value)}
                    placeholder="e.g. 4, 4000m"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Total guaranteed tenant CPU cores</p>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    CPU Max Limits:
                  </label>
                  <input
                    type="text"
                    value={limitsCPU}
                    onChange={(e) => setLimitsCPU(e.target.value)}
                    placeholder="e.g. 8, 8000m"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Maximum burst CPU limit</p>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Memory Requests Limit:
                  </label>
                  <input
                    type="text"
                    value={requestsMemory}
                    onChange={(e) => setRequestsMemory(e.target.value)}
                    placeholder="e.g. 8Gi, 16Gi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Guaranteed RAM allocatable to workloads</p>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Memory Max Limits:
                  </label>
                  <input
                    type="text"
                    value={limitsMemory}
                    onChange={(e) => setLimitsMemory(e.target.value)}
                    placeholder="e.g. 16Gi, 32Gi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Burst memory cap before OOM killer</p>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Storage Requests Limit:
                  </label>
                  <input
                    type="text"
                    value={requestsStorage}
                    onChange={(e) => setRequestsStorage(e.target.value)}
                    placeholder="e.g. 25Gi, 100Gi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Cumulative persistent volume storage capacity for tenant PVCs
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Object Counts */}
          {activeTab === 'counts' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <p className="text-xs text-slate-400">
                Cap the maximum number of Kubernetes objects tenant workloads can create inside this cluster.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Max Pods:</label>
                  <input
                    type="text"
                    value={pods}
                    onChange={(e) => setPods(e.target.value)}
                    placeholder="25"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Max Services:</label>
                  <input
                    type="text"
                    value={services}
                    onChange={(e) => setServices(e.target.value)}
                    placeholder="25"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Persistent Volume Claims (PVCs):
                  </label>
                  <input
                    type="text"
                    value={persistentVolumeClaims}
                    onChange={(e) => setPersistentVolumeClaims(e.target.value)}
                    placeholder="10"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    LoadBalancer Services:
                  </label>
                  <input
                    type="text"
                    value={servicesLoadBalancers}
                    onChange={(e) => setServicesLoadBalancers(e.target.value)}
                    placeholder="2"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    NodePort Services:
                  </label>
                  <input
                    type="text"
                    value={servicesNodePorts}
                    onChange={(e) => setServicesNodePorts(e.target.value)}
                    placeholder="0"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Max ConfigMaps:</label>
                  <input
                    type="text"
                    value={configMaps}
                    onChange={(e) => setConfigMaps(e.target.value)}
                    placeholder="50"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-mono text-slate-300 mb-1">Max Secrets:</label>
                  <input
                    type="text"
                    value={secrets}
                    onChange={(e) => setSecrets(e.target.value)}
                    placeholder="50"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Container LimitRange */}
          {activeTab === 'limits' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between pb-2 border-b border-cyber-800">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-white">
                  <input
                    type="checkbox"
                    checked={lrEnabled}
                    onChange={(e) => setLrEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 bg-cyber-950 border-cyber-700"
                  />
                  Enforce LimitRange Defaults on Containers
                </label>
                <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
                  Auto-injected into tenant pods
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Container Default Request CPU:
                  </label>
                  <input
                    type="text"
                    value={defaultRequestCPU}
                    onChange={(e) => setDefaultRequestCPU(e.target.value)}
                    placeholder="100m"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Container Default Request Memory:
                  </label>
                  <input
                    type="text"
                    value={defaultRequestMemory}
                    onChange={(e) => setDefaultRequestMemory(e.target.value)}
                    placeholder="128Mi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Container Default Limit CPU:
                  </label>
                  <input
                    type="text"
                    value={defaultCPU}
                    onChange={(e) => setDefaultCPU(e.target.value)}
                    placeholder="500m"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Container Default Limit Memory:
                  </label>
                  <input
                    type="text"
                    value={defaultMemory}
                    onChange={(e) => setDefaultMemory(e.target.value)}
                    placeholder="512Mi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Container Max CPU:</label>
                  <input
                    type="text"
                    value={maxCPU}
                    onChange={(e) => setMaxCPU(e.target.value)}
                    placeholder="4"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Container Max Memory:</label>
                  <input
                    type="text"
                    value={maxMemory}
                    onChange={(e) => setMaxMemory(e.target.value)}
                    placeholder="8Gi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Container Min CPU:</label>
                  <input
                    type="text"
                    value={minCPU}
                    onChange={(e) => setMinCPU(e.target.value)}
                    placeholder="10m"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Container Min Memory:</label>
                  <input
                    type="text"
                    value={minMemory}
                    onChange={(e) => setMinMemory(e.target.value)}
                    placeholder="32Mi"
                    className="w-full bg-cyber-950 border border-cyber-750 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex justify-between items-center pt-4 border-t border-cyber-800">
            <span className="text-[11px] font-mono text-slate-500">
              Changes trigger immediate host and tenant policy reconciliation
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Applying Policies...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Apply Dynamic Quota
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </ModalPortal>
  );
};
