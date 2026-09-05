import React, { useState } from 'react';
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
} from 'lucide-react';
import type { SizePreset } from '../lib/types';
import { PRESETS } from '../lib/presets';

export const ProvisioningWizard: React.FC = () => {
  const [step, setStep] = useState<number>(1);

  // Form State
  const [clusterName, setClusterName] = useState<string>('');
  const [owner, setOwner] = useState<string>('');
  const [environment, setEnvironment] = useState<'development' | 'staging' | 'production'>('development');
  const [sizePreset, setSizePreset] = useState<SizePreset>('medium');
  const [enableMonitoringAndDNS, setEnableMonitoringAndDNS] = useState<boolean>(true);
  const [autoSleep, setAutoSleep] = useState<boolean>(false);
  const [ttlHours, setTtlHours] = useState<number>(72);

  // Advanced Mode
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [kubernetesVersion, setKubernetesVersion] = useState<string>('v1.31.0');
  const [vclusterVersion, setVclusterVersion] = useState<string>('0.36.0');
  const [customYaml, setCustomYaml] = useState<string>('');

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
    setStep((prev) => Math.min(prev + 1, 3));
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
      const payload = {
        clusterName: clusterName.trim().toLowerCase(),
        preset: sizePreset,
        owner: owner.trim() || 'Internal Developer Platform',
        environment,
        enableMonitoringAndDNS,
        autoSleep,
        ttlHours: autoSleep ? ttlHours : 0,
        kubernetesVersion,
        vclusterVersion,
        customYaml: customYaml.trim() ? customYaml : undefined,
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
${autoSleep ? 'policies:\n  autoSleep:\n    enabled: true' : ''}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Wizard Progress Bar */}
      <div className="bg-cyber-900/80 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm shadow-lg">
        <div className="flex items-center justify-between">
          {[
            { num: 1, label: 'Name & Environment', icon: Server },
            { num: 2, label: 'Size & Resources', icon: Layers },
            { num: 3, label: 'Lifecycle & Policies', icon: Clock },
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
                {idx < 2 && (
                  <div className="flex-1 mx-4 h-[2px] bg-cyber-800 rounded">
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
                    onClick={() => setSizePreset(preset.id)}
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
          </div>
        )}

        {/* STEP 3: Lifecycle Policies & Embedded Add-ons */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Clock className="w-5 h-5 text-cyber-accent" />
                Lifecycle Policies & Platform Add-ons
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Configure auto-sleep to save cloud compute costs and ensure core add-on services.
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
            </div>

            {/* Advanced Toggle (hidden by default) */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-cyber-accent transition-colors"
              >
                <Settings2 className="w-4 h-4" />
                <span>{showAdvanced ? 'Hide Advanced Settings' : 'Show Advanced Configuration (v0.36 vcluster.yaml)'}</span>
              </button>

              {showAdvanced && (
                <div className="mt-4 p-5 bg-cyber-950 border border-cyber-800 rounded-2xl space-y-4 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1">
                        Kubernetes Control Plane Version:
                      </label>
                      <select
                        value={kubernetesVersion}
                        onChange={(e) => setKubernetesVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      >
                        <option value="v1.31.0">v1.31.0 (Latest Default)</option>
                        <option value="v1.30.0">v1.30.0 (LTS)</option>
                        <option value="v1.32.0">v1.32.0 (Preview)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1">
                        vCluster Engine Version:
                      </label>
                      <input
                        type="text"
                        value={vclusterVersion}
                        onChange={(e) => setVclusterVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                      <span>Generated vcluster.yaml Preview:</span>
                      <span className="text-[10px] text-cyber-accent">Adheres to v0.36 unified schema</span>
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
            {step < 3 ? (
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
