import React, { useState, useEffect } from 'react';
import {
  Key,
  Globe,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Sliders,
  ShieldCheck,
  X,
  Cpu,
  Sparkles,
} from 'lucide-react';
import type { AISettingsPublic, AIConnectionTestResult } from '../lib/types';

export interface AISettingsPanelProps {
  onSaved?: (settings: AISettingsPublic) => void;
  onClose?: () => void;
  compact?: boolean;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

const MODEL_PRESETS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o3-mini',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-3.3-70b-instruct',
  'custom-model',
];

export function AISettingsPanel({ onSaved, onClose, compact = false }: AISettingsPanelProps) {
  const [config, setConfig] = useState<AISettingsPublic | null>(null);
  const [loading, setLoading] = useState(true);

  // Form State
  const [localModelEnabled, setLocalModelEnabled] = useState(true);
  const [remoteEndpoint, setRemoteEndpoint] = useState(DEFAULT_ENDPOINT);
  const [remoteModel, setRemoteModel] = useState(DEFAULT_MODEL);
  const [remoteApiKey, setRemoteApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Status & Feedback
  const [testingRemote, setTestingRemote] = useState(false);
  const [testingLocal, setTestingLocal] = useState(false);
  const [testResult, setTestResult] = useState<AIConnectionTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      if (res.ok) {
        const data: AISettingsPublic = await res.json();
        setConfig(data);
        setLocalModelEnabled(data.localModelEnabled);
        setRemoteEndpoint(data.remoteEndpoint || DEFAULT_ENDPOINT);
        setRemoteModel(data.remoteModel || DEFAULT_MODEL);
      }
    } catch (err: any) {
      setErrorMessage(`Failed to load AI settings: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestRemote = async () => {
    setTestingRemote(true);
    setTestResult(null);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: remoteEndpoint,
          model: remoteModel,
          apiKey: remoteApiKey,
          testLocal: false,
        }),
      });

      const data: AIConnectionTestResult = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: `Network error reaching test endpoint: ${err.message}`,
        error: err.message,
      });
    } finally {
      setTestingRemote(false);
    }
  };

  const handleTestLocal = async () => {
    setTestingLocal(true);
    setTestResult(null);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testLocal: true,
        }),
      });

      const data: AIConnectionTestResult = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: `Local inference service unreachable: ${err.message}`,
        error: err.message,
      });
    } finally {
      setTestingLocal(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setErrorMessage(null);

    try {
      const payload: any = {
        localModelEnabled,
        provider: 'custom',
        remoteEndpoint: remoteEndpoint.trim(),
        remoteModel: remoteModel.trim(),
      };

      if (remoteApiKey !== '') {
        payload.remoteApiKey = remoteApiKey.trim();
      }

      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const resData = await res.json();
      setConfig(resData.settings);
      setRemoteApiKey(''); // Clear dirty local input
      setSaveSuccess(true);
      if (onSaved) {
        onSaved(resData.settings);
      }
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      setErrorMessage(`Failed to save AI configuration: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
        <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
        <span className="text-xs font-mono text-slate-400">Loading AI Engine Configuration...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-5 text-slate-200 ${compact ? 'text-xs' : 'text-sm'}`}>
      {/* Header bar if onClose is provided */}
      {onClose && (
        <div className="flex items-center justify-between pb-3 border-b border-cyber-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white font-mono">AI Model & API Gateway</h3>
              <p className="text-[11px] text-slate-400 font-mono">
                Toggle bundled Gemma 3 or configure a remote OpenAI-compatible API
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white bg-cyber-900 hover:bg-cyber-800 rounded-lg transition-colors"
            title="Back to chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error & Success Alerts */}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in duration-200">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 font-mono">{errorMessage}</div>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="flex-1 font-mono font-medium">
            AI configuration saved to cluster ConfigMap successfully!
          </div>
        </div>
      )}

      {/* Section 1: Local Gemma 3 Toggle Switch */}
      <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 space-y-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <label className="text-xs font-bold text-white font-mono cursor-pointer" htmlFor="local-model-toggle">
                Bundle Local Gemma 3 Model
              </label>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider ${
                  localModelEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {localModelEnabled ? 'Active (Local GPU)' : 'Disabled'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              When disabled, the cluster avoids using host hardware/GPU for local inference. Requests are routed directly to your remote OpenAI-compatible API below.
            </p>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            id="local-model-toggle"
            role="switch"
            aria-checked={localModelEnabled}
            onClick={() => setLocalModelEnabled(!localModelEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500/40 ${
              localModelEnabled ? 'bg-cyan-500' : 'bg-cyber-800'
            }`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                localModelEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Section 2: Remote OpenAI-Compatible API Gateway */}
      <div className="p-4 rounded-2xl bg-cyber-900/40 border border-cyber-800 space-y-4">
        <div className="flex items-center justify-between border-b border-cyber-800/80 pb-2">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white font-mono">
              Remote OpenAI-Compatible API Configuration
            </span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded-full">
            Standard OpenAI-API
          </span>
        </div>

        {/* API Base URL */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 font-mono">
              API Base URL / Endpoint
            </label>
            <span className="text-[10px] text-slate-500 font-mono">Default: {DEFAULT_ENDPOINT}</span>
          </div>
          <input
            type="text"
            value={remoteEndpoint}
            onChange={(e) => setRemoteEndpoint(e.target.value)}
            placeholder="https://api.openai.com/v1 (or http://vllm-service:8000/v1)"
            className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 text-xs font-mono text-white placeholder-slate-500 transition-colors"
          />
          <p className="text-[10px] text-slate-500 font-mono">
            Compatible with OpenAI, Azure OpenAI, vLLM, Ollama, OpenRouter, Groq, or enterprise sovereign gateways.
          </p>
        </div>

        {/* Model Identifier */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 font-mono">
              Model Name / Identifier
            </label>
            <span className="text-[10px] text-slate-500 font-mono">e.g. gpt-4o-mini</span>
          </div>
          <input
            type="text"
            value={remoteModel}
            onChange={(e) => setRemoteModel(e.target.value)}
            placeholder={DEFAULT_MODEL}
            className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 text-xs font-mono text-white placeholder-slate-500 transition-colors"
          />

          {/* Quick Preset Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[10px] text-slate-500 font-mono">Suggestions:</span>
            {MODEL_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRemoteModel(m)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-colors ${
                  remoteModel === m
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                    : 'bg-cyber-950 hover:bg-cyber-800 text-slate-400 hover:text-slate-200 border-cyber-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 font-mono flex items-center gap-1">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              <span>API Key</span>
              <span className="text-[10px] text-slate-500 font-normal">(Optional for internal proxies)</span>
            </label>
            {config?.hasApiKey && (
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Key Stored: {config.maskedApiKey}
              </span>
            )}
          </div>

          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={remoteApiKey}
              onChange={(e) => setRemoteApiKey(e.target.value)}
              placeholder={
                config?.hasApiKey
                  ? '•••••••••••••••• (Leave blank to keep existing key, or type new key)'
                  : 'sk-... or Bearer Token'
              }
              className="w-full px-3 py-2 pr-10 rounded-xl bg-cyber-950 border border-cyber-700/80 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 text-xs font-mono text-white placeholder-slate-500 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200 transition-colors"
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            Stored in Kubernetes ConfigMap <code className="text-cyan-400">vcop-ai-config</code> in <code className="text-cyan-400">vcop-system</code>.
          </p>
        </div>
      </div>

      {/* Connection Test Result Banner */}
      {testResult && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-mono animate-in fade-in duration-150 ${
            testResult.ok
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400" />
            )}
            <span>{testResult.ok ? 'Connection Verified' : 'Connection Failed'}</span>
            {testResult.latencyMs !== undefined && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-cyber-900 text-slate-300">
                {testResult.latencyMs}ms
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">{testResult.message}</p>
        </div>
      )}

      {/* Action Buttons: Test Connection & Save */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-cyber-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={testingRemote}
            onClick={handleTestRemote}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyber-900 hover:bg-cyber-800 border border-cyber-700 hover:border-slate-500 text-xs font-mono font-medium text-slate-200 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${testingRemote ? 'animate-spin' : ''}`} />
            <span>{testingRemote ? 'Testing...' : 'Test Remote API'}</span>
          </button>

          {localModelEnabled && (
            <button
              type="button"
              disabled={testingLocal}
              onClick={handleTestLocal}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyber-900/60 hover:bg-cyber-800 border border-cyber-800 text-xs font-mono text-slate-400 hover:text-slate-200 transition-all disabled:opacity-50"
              title="Test local Gemma 3 model on cluster"
            >
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>Test Local Model</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl bg-cyber-900 hover:bg-cyber-800 text-xs font-mono text-slate-300 hover:text-white transition-colors"
            >
              Return to Chat
            </button>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-mono font-bold shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] transition-all disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
