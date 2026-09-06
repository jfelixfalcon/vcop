import React, { useState, useEffect } from 'react';
import {
  Server,
  Layers,
  Clock,
  Shield,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Settings2,
  Sparkles,
  Check,
  AlertCircle,
  FileCode,
  Zap,
  Sliders,
  Cpu,
  Database,
  HardDrive,
  Package,
  Box,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  Tag,
} from 'lucide-react';
import type { SizePreset, AppStoreCatalog, AppDefinition, AppGroup, VersionRegistry } from '../lib/types';
import { PRESETS } from '../lib/presets';

export const ProvisioningWizard: React.FC = () => {
  const [step, setStep] = useState<number>(1);

  // Form State
  const [clusterName, setClusterName] = useState<string>('');
  const [owner, setOwner] = useState<string>('');
  const [allowedGroups, setAllowedGroups] = useState<string>('');
  const [allowedEmails, setAllowedEmails] = useState<string>('');
  const [clusterGroup, setClusterGroup] = useState<string>('');
  const [fleetGroups, setFleetGroups] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<'development' | 'staging' | 'production'>('development');
  const [sizePreset, setSizePreset] = useState<SizePreset>('medium');
  const [enableMonitoringAndDNS, setEnableMonitoringAndDNS] = useState<boolean>(true);
  const [autoSleep, setAutoSleep] = useState<boolean>(false);
  const [ttlHours, setTtlHours] = useState<number>(72);

  // Dynamic Resource Quotas & Policies
  const [showQuotaOverrides, setShowQuotaOverrides] = useState<boolean>(false);
  const [requestsCPU, setRequestsCPU] = useState<string>('4');
  const [limitsCPU, setLimitsCPU] = useState<string>('8');
  const [requestsMemory, setRequestsMemory] = useState<string>('8Gi');
  const [limitsMemory, setLimitsMemory] = useState<string>('16Gi');
  const [requestsStorage, setRequestsStorage] = useState<string>('25Gi');
  const [pods, setPods] = useState<string>('25');
  const [services, setServices] = useState<string>('25');
  const [persistentVolumeClaims, setPersistentVolumeClaims] = useState<string>('10');
  const [defaultRequestCPU, setDefaultRequestCPU] = useState<string>('100m');
  const [defaultRequestMemory, setDefaultRequestMemory] = useState<string>('128Mi');
  const [defaultCPU, setDefaultCPU] = useState<string>('500m');
  const [defaultMemory, setDefaultMemory] = useState<string>('512Mi');

  // Advanced Mode
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [versionRegistry, setVersionRegistry] = useState<VersionRegistry | null>(null);
  const [kubernetesVersion, setKubernetesVersion] = useState<string>('');
  const [vclusterVersion, setVclusterVersion] = useState<string>('');
  const [customYaml, setCustomYaml] = useState<string>('');

  // App Store  State
  const [catalog, setCatalog] = useState<AppStoreCatalog | null>(null);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [customValuesMap, setCustomValuesMap] = useState<Record<string, string>>({});
  const [expandedValueAppId, setExpandedValueAppId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/appstore')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setCatalog(data.data);
        }
      })
      .catch((e) => console.warn('Failed loading catalog in wizard:', e));

    fetch('/api/vclusters/groups')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setFleetGroups(data.data.map((g: any) => g.name));
        }
      })
      .catch((e) => console.warn('Failed loading cluster groups in wizard:', e));

    fetch('/api/admin/versions')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          const reg: VersionRegistry = data.data;
          setVersionRegistry(reg);
          const defaultK8s = reg.kubernetesVersions.find((v) => v.isDefault)?.version || reg.kubernetesVersions[0]?.version || 'v1.31.0';
          const defaultEngine = reg.vclusterVersions.find((v) => v.isDefault)?.version || reg.vclusterVersions[0]?.version || '0.36.0';
          setKubernetesVersion((prev) => prev || defaultK8s);
          setVclusterVersion((prev) => prev || defaultEngine);
        }
      })
      .catch((e) => console.warn('Failed loading versions in wizard:', e));
  }, []);

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectPreset = (preset: SizePreset) => {
    setSizePreset(preset);
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
        setDefaultRequestCPU('50m');
        setDefaultRequestMemory('64Mi');
        setDefaultCPU('250m');
        setDefaultMemory('256Mi');
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
        setDefaultRequestCPU('200m');
        setDefaultRequestMemory('256Mi');
        setDefaultCPU('1');
        setDefaultMemory('1Gi');
        break;
      default:
        setRequestsCPU('4');
        setLimitsCPU('8');
        setRequestsMemory('8Gi');
        setLimitsMemory('16Gi');
        setRequestsStorage('25Gi');
        setPods('25');
        setServices('25');
        setPersistentVolumeClaims('10');
        setDefaultRequestCPU('100m');
        setDefaultRequestMemory('128Mi');
        setDefaultCPU('500m');
        setDefaultMemory('512Mi');
        break;
    }
  };

  const selectedPresetDetails = PRESETS.find((p) => p.id === sizePreset) || PRESETS[1];

  const handleNext = () => {
    if (step === 1) {
      if (!clusterName.trim()) {
        setError('Please provide a valid cluster name');
        return;
      }
      const nameRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
      if (!nameRegex.test(clusterName.trim())) {
        setError('Cluster name must contain only lowercase letters, numbers, and hyphens (e.g. dev-cluster)');
        return;
      }
    }
    setError(null);
    setStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrev = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload: any = {
        clusterName: clusterName.trim().toLowerCase(),
        preset: sizePreset,
        owner: owner.trim() || 'Internal Developer Platform',
        allowedGroups: allowedGroups.split(',').map((s) => s.trim()).filter(Boolean),
        allowedEmails: allowedEmails.split(',').map((s) => s.trim()).filter(Boolean),
        clusterGroup: clusterGroup.trim() || undefined,
        clusterGroups: clusterGroup.trim() ? [clusterGroup.trim()] : undefined,
        environment,
        enableMonitoringAndDNS,
        autoSleep,
        ttlHours: autoSleep ? ttlHours : 0,
        kubernetesVersion,
        vclusterVersion,
        customYaml: customYaml.trim() ? customYaml : undefined,
        installedApps: selectedAppIds.map((id) => ({
          appId: id,
          customValues: customValuesMap[id],
        })),
        policies: {
          resourceQuota: {
            enabled: true,
            requestsCPU: requestsCPU.trim(),
            limitsCPU: limitsCPU.trim(),
            requestsMemory: requestsMemory.trim(),
            limitsMemory: limitsMemory.trim(),
            requestsStorage: requestsStorage.trim(),
            pods: pods.trim(),
            services: services.trim(),
            persistentVolumeClaims: persistentVolumeClaims.trim(),
          },
          limitRange: {
            enabled: true,
            defaultRequestCPU: defaultRequestCPU.trim(),
            defaultRequestMemory: defaultRequestMemory.trim(),
            defaultCPU: defaultCPU.trim(),
            defaultMemory: defaultMemory.trim(),
          },
        },
      };

      const res = await fetch('/api/vclusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to provision cluster');
      }

      // Redirect to fleet dashboard
      window.location.href = `/clusters/${payload.clusterName}`;
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  // Live YAML preview
  const previewYaml = `controlPlane:
  distro:
    k8s:
      enabled: true
      version: "${kubernetesVersion}"
  backingStore:
    etcd:
      deploy:
        enabled: true
        statefulSet:
          highAvailability:
            replicas: ${sizePreset === 'small' ? 1 : 3}
          persistence:
            volumeClaim:
              size: "${selectedPresetDetails.storage.split(' ')[0]}Gi"
  coreDNS:
    enabled: false # Reconciled externally as standalone cluster addon
integrations:
  metricsServer:
    enabled: false # Reconciled externally as standalone cluster addon
sync:
  toHost:
    pods:
      enabled: true
    services:
      enabled: true
    ingresses:
      enabled: true
  fromHost:
    nodes:
      enabled: true
policies:
  resourceQuota:
    enabled: true
    quota:
      requests.cpu: "${requestsCPU}"
      limits.cpu: "${limitsCPU}"
      requests.memory: "${requestsMemory}"
      limits.memory: "${limitsMemory}"
      requests.storage: "${requestsStorage}"
      count/pods: "${pods}"
      services: "${services}"
      persistentvolumeclaims: "${persistentVolumeClaims}"
  limitRange:
    enabled: true
    default:
      cpu: "${defaultCPU}"
      memory: "${defaultMemory}"
    defaultRequest:
      cpu: "${defaultRequestCPU}"
      memory: "${defaultRequestMemory}"${autoSleep ? '\n  autoSleep:\n    enabled: true' : ''}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Wizard Progress Bar */}
      <div className="bg-cyber-900/80 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm shadow-lg">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: 'Name & Identity', icon: Server },
            { num: 2, label: 'Size & Policies', icon: Layers },
            { num: 3, label: 'App Store ', icon: Package },
            { num: 4, label: 'Lifecycle & Launch', icon: Clock },
          ].map((item, idx) => {
            const Icon = item.icon;
            const isCompleted = step > item.num;
            const isCurrent = step === item.num;

            return (
              <React.Fragment key={item.num}>
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono text-xs font-bold transition-all ${
                      isCurrent
                        ? 'bg-cyber-accent text-slate-950 shadow-glow-sm'
                        : isCompleted
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-cyber-800 text-slate-500 border border-cyber-700'
                    }`}
                  >
                    {isCompleted ? <Check className="w-4 h-4" /> : item.num}
                  </div>
                  <div className="hidden sm:block">
                    <p className={`text-xs font-medium ${isCurrent ? 'text-white font-semibold' : 'text-slate-400'}`}>
                      {item.label}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono">Step 0{item.num}</p>
                  </div>
                </div>
                {idx < 3 && (
                  <div className="flex-1 mx-3 h-[2px] bg-cyber-800 rounded">
                    <div
                      className={`h-full transition-all duration-300 ${
                        step > idx + 1 ? 'bg-cyber-accent w-full' : 'w-0'
                      }`}
                    ></div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main Wizard Form Container */}
      <div className="relative bg-cyber-900/90 border border-cyber-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md overflow-hidden">
        {/* Glow Accent */}
        <div className="absolute top-0 left-1/3 right-1/3 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Cluster Identity */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-cyber-accent" />
                Cluster Identity & Purpose
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Name your isolated virtual Kubernetes environment and specify team ownership.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Cluster Identifier <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clusterName}
                    onChange={(e) => setClusterName(e.target.value.toLowerCase())}
                    placeholder="e.g. checkout-service-test"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-3 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent transition-colors"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                  Kubernetes DNS-1123 format: lowercase alphanumeric, hyphens allowed.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Team or Owner
                  </label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="e.g. Core Commerce Team"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Environment Tier
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['development', 'staging', 'production'] as const).map((env) => (
                      <button
                        key={env}
                        type="button"
                        onClick={() => setEnvironment(env)}
                        className={`py-2 px-3 rounded-xl text-xs font-medium capitalize border transition-all ${
                          environment === env
                            ? 'bg-cyber-accent/15 text-cyber-accent border-cyber-accent/40 font-semibold shadow-glow-sm'
                            : 'bg-cyber-850 text-slate-400 border-cyber-800 hover:text-white'
                        }`}
                      >
                        {env}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* RBAC Access Delegation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-cyber-850">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Authorized Groups (RBAC)
                  </label>
                  <input
                    type="text"
                    value={allowedGroups}
                    onChange={(e) => setAllowedGroups(e.target.value)}
                    placeholder="e.g. developers, data-platform"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Comma-separated groups with read + kubeconfig access</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Authorized User Emails (RBAC)
                  </label>
                  <input
                    type="text"
                    value={allowedEmails}
                    onChange={(e) => setAllowedEmails(e.target.value)}
                    placeholder="e.g. dev@vops.local, user@company.com"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Comma-separated user emails with read + kubeconfig access</p>
                </div>
              </div>

              {/* Cluster Grouping */}
              <div className="pt-2 border-t border-cyber-850">
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
                    Cluster Group (Fleet Organization)
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Optional</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clusterGroup}
                    onChange={(e) => setClusterGroup(e.target.value)}
                    placeholder="e.g. backend-services, fintech, ai-agents"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Organize clusters into logical groupings for fleet management and search filtering.
                </p>
                {fleetGroups.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-[10px] text-slate-400 font-mono">Existing groups:</span>
                    {fleetGroups.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setClusterGroup(g)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                          clusterGroup === g
                            ? 'bg-cyan-500 text-slate-950 font-bold'
                            : 'bg-cyber-800 text-cyan-400 hover:bg-cyber-750 border border-cyber-700'
                        }`}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Sizing Tiers */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Layers className="w-5 h-5 text-cyber-accent" />
                Select Hardware & Topology Tier
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Zero Kubernetes complexity: pick the capacity tier tailored to your workflow.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PRESETS.filter((p) => p.id !== 'custom').map((preset) => {
                const isSelected = sizePreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`cursor-pointer relative flex flex-col justify-between p-5 rounded-2xl border transition-all duration-200 ${
                      isSelected
                        ? 'bg-cyber-800/80 border-cyber-accent shadow-glow-md'
                        : 'bg-cyber-850/50 border-cyber-800 hover:border-cyber-700 hover:bg-cyber-850'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 bg-cyber-accent text-slate-950 text-[10px] font-bold font-mono rounded-full uppercase">
                        Selected
                      </div>
                    )}
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-base font-bold text-white">{preset.name}</h4>
                        <span className="text-[10px] font-mono text-slate-400 bg-cyber-950 px-2 py-0.5 rounded border border-cyber-800">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>

                    <div className="space-y-2 pt-4 border-t border-cyber-800/80 font-mono text-xs">
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Compute:</span>
                        <span className="font-semibold">{preset.cpu}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Memory:</span>
                        <span className="font-semibold">{preset.memory}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Storage:</span>
                        <span className="font-semibold">{preset.storage}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">HA Quorum:</span>
                        <span className={preset.ha ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                          {preset.ha ? '3-Node HA etcd' : 'Single Node'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Collapsible Quota & Policy Tuning */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowQuotaOverrides(!showQuotaOverrides)}
                className="flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-cyber-accent transition-colors"
              >
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>
                  {showQuotaOverrides
                    ? 'Hide Dynamic Quota Customization'
                    : 'Customize Resource Quotas & LimitRange (Optional)'}
                </span>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20 font-mono">
                  {requestsCPU} CPU / {requestsMemory} RAM / {requestsStorage}
                </span>
              </button>

              {showQuotaOverrides && (
                <div className="mt-4 p-5 bg-cyber-950 border border-cyber-800 rounded-2xl space-y-5 animate-in fade-in duration-150">
                  <div>
                    <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider mb-1 flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                      Tenant ResourceQuota Bounds
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Tailor the compute, memory, storage limits and max objects for this virtual cluster.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Requests CPU:</label>
                      <input
                        type="text"
                        value={requestsCPU}
                        onChange={(e) => setRequestsCPU(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Limits CPU:</label>
                      <input
                        type="text"
                        value={limitsCPU}
                        onChange={(e) => setLimitsCPU(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Requests Storage:</label>
                      <input
                        type="text"
                        value={requestsStorage}
                        onChange={(e) => setRequestsStorage(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Requests Memory:</label>
                      <input
                        type="text"
                        value={requestsMemory}
                        onChange={(e) => setRequestsMemory(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Limits Memory:</label>
                      <input
                        type="text"
                        value={limitsMemory}
                        onChange={(e) => setLimitsMemory(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max Pods:</label>
                      <input
                        type="text"
                        value={pods}
                        onChange={(e) => setPods(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max Services:</label>
                      <input
                        type="text"
                        value={services}
                        onChange={(e) => setServices(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max PVCs:</label>
                      <input
                        type="text"
                        value={persistentVolumeClaims}
                        onChange={(e) => setPersistentVolumeClaims(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-cyber-800">
                    <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider mb-1 flex items-center gap-2">
                      <Sliders className="w-3.5 h-3.5 text-purple-400" />
                      Container LimitRange Defaults
                    </h4>
                    <p className="text-[11px] text-slate-400 mb-3">
                      Defaults injected into tenant containers that omit resources.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Req CPU:</label>
                        <input
                          type="text"
                          value={defaultRequestCPU}
                          onChange={(e) => setDefaultRequestCPU(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Req Mem:</label>
                        <input
                          type="text"
                          value={defaultRequestMemory}
                          onChange={(e) => setDefaultRequestMemory(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Limit CPU:</label>
                        <input
                          type="text"
                          value={defaultCPU}
                          onChange={(e) => setDefaultCPU(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Limit Mem:</label>
                        <input
                          type="text"
                          value={defaultMemory}
                          onChange={(e) => setDefaultMemory(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: App Store & Application  */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Package className="w-5 h-5 text-cyan-400" />
                  App Store & Addon 
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Pre-install curated Helm releases, ingress controllers, databases, or microservice manifests into your virtual cluster.
                </p>
              </div>
              <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-3 py-1 rounded-xl border border-cyan-800/80 self-start sm:self-auto">
                {selectedAppIds.length} Application{selectedAppIds.length !== 1 ? 's' : ''} Selected
              </span>
            </div>

            {/* Curated  Quick Selector */}
            {catalog?.groups && catalog.groups.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span>Curated Application  (1-Click Select)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {catalog.groups.map((group) => {
                    const allSelected = group.appIds.length > 0 && group.appIds.every((id) => selectedAppIds.includes(id));
                    return (
                      <div
                        key={group.id}
                        onClick={() => {
                          if (allSelected) {
                            setSelectedAppIds(selectedAppIds.filter((id) => !group.appIds.includes(id)));
                          } else {
                            const newSet = new Set([...selectedAppIds, ...group.appIds]);
                            setSelectedAppIds(Array.from(newSet));
                            for (const id of group.appIds) {
                              const appObj = catalog.apps.find((a) => a.id === id);
                              if (appObj?.helm?.values && !customValuesMap[id]) {
                                setCustomValuesMap((prev) => ({ ...prev, [id]: appObj.helm!.values! }));
                              }
                            }
                          }
                        }}
                        className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                          allSelected
                            ? 'bg-purple-950/40 border-purple-500/60 shadow-glow-sm'
                            : 'bg-cyber-950 border-cyber-800 hover:border-cyber-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-white">{group.name}</h4>
                          <span
                            className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold ${
                              allSelected ? 'bg-purple-500 text-white' : 'border border-cyber-700'
                            }`}
                          >
                            {allSelected && <Check className="w-3 h-3" />}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{group.description}</p>
                        <div className="mt-2 text-[10px] font-mono text-purple-400">
                          {group.appIds.length} apps: {group.appIds.join(', ')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Individual Applications Grid */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                <Package className="w-3.5 h-3.5 text-cyan-400" />
                <span>Available Applications & Microservices</span>
              </label>

              <div className="space-y-3">
                {(!catalog?.apps || catalog.apps.length === 0) ? (
                  <div className="p-8 text-center bg-cyber-950/60 rounded-2xl border border-dashed border-cyber-800">
                    <Package className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-slate-300">App Store is Clean & Empty</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      No applications have been added to the catalog yet. You can continue to the next step and deploy applications post-launch once published.
                    </p>
                  </div>
                ) : (
                  (catalog?.apps || []).map((app) => {
                    const isSelected = selectedAppIds.includes(app.id);
                    const isExpanded = expandedValueAppId === app.id;

                    return (
                      <div
                        key={app.id}
                        className={`rounded-2xl border transition-all overflow-hidden ${
                          isSelected
                            ? 'bg-cyber-950 border-cyan-500/60'
                            : 'bg-cyber-950/60 border-cyber-800 hover:border-cyber-700'
                        }`}
                      >
                        <div
                          onClick={() => {
                            if (isSelected) {
                              setSelectedAppIds(selectedAppIds.filter((id) => id !== app.id));
                            } else {
                              setSelectedAppIds([...selectedAppIds, app.id]);
                              if (app.helm?.values && !customValuesMap[app.id]) {
                                setCustomValuesMap((prev) => ({ ...prev, [app.id]: app.helm!.values! }));
                              }
                            }
                          }}
                          className="p-3.5 flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                isSelected
                                  ? 'bg-cyan-500 border-cyan-500 text-slate-950'
                                  : 'border-cyber-700 bg-cyber-900'
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white">{app.name}</span>
                                <span className="text-[10px] font-mono text-slate-500">v{app.version}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyber-900 border border-cyber-800 text-cyan-400 font-mono">
                                  {app.category}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">{app.description}</p>
                            </div>
                          </div>

                          {app.helm && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isSelected) {
                                  setSelectedAppIds([...selectedAppIds, app.id]);
                                  if (app.helm?.values && !customValuesMap[app.id]) {
                                    setCustomValuesMap((prev) => ({ ...prev, [app.id]: app.helm!.values! }));
                                  }
                                }
                                setExpandedValueAppId(isExpanded ? null : app.id);
                              }}
                              className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyber-900 border border-cyber-800 hover:border-cyan-500/30 transition-colors shrink-0 ml-2"
                            >
                              <Sliders className="w-3 h-3" />
                              <span>{isExpanded ? 'Hide Values' : 'Customize values.yaml'}</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          )}
                        </div>

                        {/* Expandable values.yaml Editor */}
                        {isExpanded && app.helm && (
                          <div className="p-3.5 bg-cyber-900 border-t border-cyber-800 space-y-2 animate-in fade-in duration-100">
                            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                              <span className="flex items-center gap-1.5 text-cyan-400">
                                <FileCode className="w-3.5 h-3.5" />
                                values.yaml for {app.name}
                              </span>
                              <span className="text-[10px] text-slate-500">YAML Format</span>
                            </div>
                            <textarea
                              value={customValuesMap[app.id] ?? app.helm.values ?? ''}
                              onChange={(e) =>
                                setCustomValuesMap({ ...customValuesMap, [app.id]: e.target.value })
                              }
                              rows={6}
                              className="w-full bg-cyber-950 border border-cyber-700 rounded-xl p-3 text-xs text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono leading-relaxed"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Lifecycle Policies & Launch */}
        {step === 4 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Clock className="w-5 h-5 text-cyber-accent" />
                Lifecycle Policies & Platform Add-ons
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Configure auto-sleep to save cloud compute costs, review scheduled apps, and launch.
              </p>
            </div>

            <div className="space-y-4">
              {/* Addons Box */}
              <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-3">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enableMonitoringAndDNS}
                    onChange={(e) => setEnableMonitoringAndDNS(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded text-cyber-accent bg-cyber-900 border-cyber-700 focus:ring-0 focus:ring-offset-0"
                  />
                  <div>
                    <span className="text-sm font-semibold text-white flex items-center gap-2">
                      Enable External CoreDNS & External Metrics-Server Add-ons (Recommended)
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Provisions external standalone CoreDNS for cluster service discovery and external standalone Metrics-Server so <code className="text-cyan-400 font-mono">kubectl top</code> and HPAs function automatically without proprietary/embedded features.
                    </p>
                  </div>
                </label>
              </div>

              {/* Auto Sleep Policy */}
              <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-3">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoSleep}
                    onChange={(e) => setAutoSleep(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded text-cyber-accent bg-cyber-900 border-cyber-700 focus:ring-0 focus:ring-offset-0"
                  />
                  <div>
                    <span className="text-sm font-semibold text-white">
                      Auto-Sleep when Idle (Cost Optimization)
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Automatically suspends tenant workloads when no ingress traffic is observed for 30 minutes. Instantly wakes on incoming request.
                    </p>
                  </div>
                </label>

                {autoSleep && (
                  <div className="pt-3 border-t border-cyber-800/80 flex items-center gap-3">
                    <span className="text-xs text-slate-400">Teardown TTL (Hours):</span>
                    <input
                      type="number"
                      value={ttlHours}
                      onChange={(e) => setTtlHours(parseInt(e.target.value) || 0)}
                      min={0}
                      className="w-24 bg-cyber-900 border border-cyber-700 rounded-lg px-3 py-1 font-mono text-xs text-white focus:outline-none focus:border-cyber-accent"
                    />
                    <span className="text-[11px] text-slate-500 font-mono">(0 = no auto-delete)</span>
                  </div>
                )}
              </div>

              {/* Selected Applications Review */}
              <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Pre-configured Apps  ({selectedAppIds.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="text-[11px] font-mono text-cyan-400 hover:underline"
                  >
                    Edit Apps
                  </button>
                </div>

                {selectedAppIds.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No apps selected for initial installation (can be installed later from the App Store).</p>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedAppIds.map((appId) => {
                      const app = availableApps.find((a) => a.id === appId);
                      return (
                        <div
                          key={appId}
                          className="px-2.5 py-1 bg-cyber-900 border border-cyan-500/30 rounded-lg text-xs font-mono text-cyan-300 flex items-center gap-1.5"
                        >
                          <Package className="w-3 h-3 text-cyan-400" />
                          <span>{app ? app.name : appId}</span>
                          {customValuesMap[appId] && (
                            <span className="text-[10px] bg-cyan-950 text-cyan-400 px-1 py-0.5 rounded border border-cyan-800">
                              custom values
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Advanced Toggle (hidden by default) */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-cyber-accent transition-colors"
              >
                <Settings2 className="w-4 h-4" />
                <span>{showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Configuration (vcluster.yaml)'}</span>
              </button>

              {showAdvanced && (
                <div className="mt-4 p-5 bg-cyber-950 border border-cyber-800 rounded-2xl space-y-4 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                        <span>Kubernetes Control Plane:</span>
                        <a href="/admin/versions" className="text-[10px] text-cyan-400 hover:underline">Manage Registry</a>
                      </label>
                      <select
                        value={kubernetesVersion}
                        onChange={(e) => setKubernetesVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      >
                        {versionRegistry?.kubernetesVersions.map((v) => (
                          <option key={v.version} value={v.version}>
                            {v.label || v.version} {v.isDefault ? '★ (Default)' : ''}
                          </option>
                        ))}
                        {kubernetesVersion && !versionRegistry?.kubernetesVersions.some(v => v.version === kubernetesVersion) && (
                          <option value={kubernetesVersion}>{kubernetesVersion}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                        <span>vCluster Engine Version:</span>
                        <a href="/admin/versions" className="text-[10px] text-purple-400 hover:underline">Manage Registry</a>
                      </label>
                      <div className="flex gap-2">
                        <select
                          value={vclusterVersion}
                          onChange={(e) => setVclusterVersion(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                        >
                          {versionRegistry?.vclusterVersions.map((v) => (
                            <option key={v.version} value={v.version}>
                              {v.label || `vCluster ${v.version}`} {v.isDefault ? '★ (Default)' : ''}
                            </option>
                          ))}
                          {vclusterVersion && !versionRegistry?.vclusterVersions.some(v => v.version === vclusterVersion) && (
                            <option value={vclusterVersion}>{vclusterVersion}</option>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                      <span>Generated vcluster.yaml Preview:</span>
                      <span className="text-[10px] text-cyber-accent">Dynamic Declarative Engine Spec</span>
                    </label>
                    <pre className="bg-cyber-900 border border-cyber-800 rounded-xl p-3 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto">
                      {previewYaml}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Wizard Navigation Footer */}
        <div className="mt-8 pt-5 border-t border-cyber-800 flex items-center justify-between">
          <div>
            {step > 1 ? (
              <button
                type="button"
                onClick={handlePrev}
                disabled={submitting}
                className="px-4 py-2.5 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Step
              </button>
            ) : (
              <a
                href="/"
                className="px-4 py-2.5 bg-cyber-800 hover:bg-cyber-750 text-slate-400 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Cancel
              </a>
            )}
          </div>

          <div>
            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 bg-cyber-accent hover:bg-cyan-300 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
              >
                Next Step
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-md flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Zap className="w-4 h-4 animate-spin" />
                    Provisioning Cluster...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Deploy Virtual Cluster
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
