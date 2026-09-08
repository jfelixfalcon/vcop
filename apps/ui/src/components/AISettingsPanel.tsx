import React, { useState, useEffect } from 'react';
import {
  Bot,
  Sparkles,
  Key,
  Globe,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Server,
  Sliders,
  ShieldCheck,
  Zap,
  X,
  Cpu,
} from 'lucide-react';
import type { AIProviderType, AISettingsPublic, AIConnectionTestResult } from '../lib/types';

export interface AISettingsPanelProps {
  onSaved?: (settings: AISettingsPublic) => void;
  onClose?: () => void;
  compact?: boolean;
}

interface ProviderPresetItem {
  id: AIProviderType;
  name: string;
  badge: string;
  defaultEndpoint: string;
  defaultModel: string;
  suggestions: string[];
  placeholder: string;
  keyUrl?: string;
  requiresKey: boolean;
  desc: string;
}

const PROVIDERS: ProviderPresetItem[] = [
  {
    id: 'local',
    name: 'Local Gemma 3',
    badge: 'Offline / GPU',
    defaultEndpoint: 'http://vcop-ai.vcop-system.svc:8080',
    defaultModel: 'Gemma 3 1B IT (Q4_K_M)',
    suggestions: ['Gemma 3 1B IT (Q4_K_M)'],
    placeholder: 'None required (cluster internal)',
    requiresKey: false,
    desc: 'Self-hosted Gemma 3 model bundled inside the Kubernetes cluster.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'GPT-4o / Mini',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestions: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gpt-4-turbo'],
    placeholder: 'sk-proj-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
    desc: 'OpenAI cloud API for GPT-4o, GPT-4o Mini, and next-generation reasoning models.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badge: 'Claude 3.5',
    defaultEndpoint: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    suggestions: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    placeholder: 'sk-ant-api03-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true,
    desc: 'Anthropic Messages API for Claude 3.5 Sonnet and Haiku.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Gemini 1.5 / 2.0',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-1.5-flash',
    suggestions: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
    placeholder: 'AIzaSy...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    requiresKey: true,
    desc: 'Google Gemini high-speed multimodal models with massive context windows.',
  },
  {
    id: 'groq',
    name: 'Groq Cloud',
    badge: 'Llama 3.3 Ultra-Fast',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestions: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    placeholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
    requiresKey: true,
    desc: 'LPU-accelerated low latency inference for open source architectures.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: 'Unified Gateway',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    suggestions: ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-flash-1.5', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat'],
    placeholder: 'sk-or-v1-...',
    keyUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
    desc: 'Unified multi-provider API gateway providing access to hundreds of open & commercial models.',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-API',
    badge: 'vLLM / Ollama / Sovereign',
    defaultEndpoint: 'http://my-llm-service:8000/v1',
    defaultModel: 'custom-model',
    suggestions: ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3', 'qwen2.5-7b-instruct'],
    placeholder: 'Bearer token or API key (optional)',
    requiresKey: false,
    desc: 'Connect to self-hosted vLLM, Ollama, TGI, or internal sovereign enterprise proxies.',
  },
];

export function AISettingsPanel({ onSaved, onClose, compact = false }: AISettingsPanelProps) {
  const [config, setConfig] = useState<AISettingsPublic | null>(null);
  const [loading, setLoading] = useState(true);

  // Form State
  const [localModelEnabled, setLocalModelEnabled] = useState(true);
  const [provider, setProvider] = useState<AIProviderType>('local');
  const [remoteEndpoint, setRemoteEndpoint] = useState('');
  const [remoteModel, setRemoteModel] = useState('');
  const [remoteApiKey, setRemoteApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Status & Feedback
  const [testing, setTesting] = useState(false);
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
        setProvider(data.provider);
        setRemoteEndpoint(data.remoteEndpoint);
        setRemoteModel(data.remoteModel);
      }
    } catch (err: any) {
      setErrorMessage(`Failed to load AI settings: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderSelect = (p: AIProviderType) => {
    setProvider(p);
    setTestResult(null);
    setErrorMessage(null);

    const preset = PROVIDERS.find((item) => item.id === p);
    if (preset) {
      // If switching away from local, or changing remote provider, auto-populate if currently empty or default
      if (p !== 'local') {
        if (!remoteEndpoint || PROVIDERS.some((x) => x.defaultEndpoint === remoteEndpoint)) {
          setRemoteEndpoint(preset.defaultEndpoint);
        }
        if (!remoteModel || PROVIDERS.some((x) => x.defaultModel === remoteModel)) {
          setRemoteModel(preset.defaultModel);
        }
      }
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          endpoint: remoteEndpoint,
          model: remoteModel,
          apiKey: remoteApiKey,
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
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setErrorMessage(null);

    try {
      const payload: any = {
        localModelEnabled,
        provider,
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

  const activePreset = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];

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
                Switch between bundled Gemma 3 or external cloud APIs
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

      {/* Error & Success Toasts */}
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
            AI configuration saved and applied to cluster successfully!
          </div>
        </div>
      )}

      {/* Section 1: Local Model Toggle Switch */}
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
                {localModelEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              When disabled, the UI will not use the local cluster-hosted Gemma 3 model. Prompts are routed directly to your configured remote model APIs (or deterministic synthesis).
            </p>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            id="local-model-toggle"
            role="switch"
            aria-checked={localModelEnabled}
            onClick={() => {
              const next = !localModelEnabled;
              setLocalModelEnabled(next);
              // If user disables local model and was on local provider, suggest switching to remote
              if (!next && provider === 'local') {
                setProvider('openai');
                handleProviderSelect('openai');
              }
            }}
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

      {/* Section 2: Active Provider Selection */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-300 font-mono flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            Model Provider Architecture
          </span>
          <span className="text-[10px] text-slate-500 font-normal">Select engine for cluster analysis</span>
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PROVIDERS.map((item) => {
            const isSelected = provider === item.id;
            const isDisabled = item.id === 'local' && !localModelEnabled;

            return (
              <button
                key={item.id}
                type="button"
                disabled={isDisabled}
                onClick={() => handleProviderSelect(item.id)}
                className={`p-2.5 rounded-xl text-left border transition-all duration-150 relative flex flex-col justify-between ${
                  isSelected
                    ? 'bg-gradient-to-br from-cyan-950/70 to-blue-950/70 border-cyan-500/70 text-white shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                    : isDisabled
                    ? 'bg-cyber-950/40 border-cyber-900 text-slate-600 opacity-40 cursor-not-allowed'
                    : 'bg-cyber-900/60 border-cyber-800/80 hover:border-cyber-700 text-slate-300 hover:text-white'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-bold truncate">{item.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0 ml-1" />}
                </div>
                <span className="text-[10px] font-mono text-slate-400 truncate block">
                  {item.badge}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-400 font-mono mt-1">
          {activePreset.desc}
        </p>
      </div>

      {/* Section 3: Remote Model API Configuration (shown when not local) */}
      {provider !== 'local' && (
        <div className="p-4 rounded-2xl bg-cyber-900/40 border border-cyber-800 space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-cyber-800/80 pb-2">
            <span className="text-xs font-bold text-white font-mono flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              {activePreset.name} API Credentials & Parameters
            </span>
            {activePreset.keyUrl && (
              <a
                href={activePreset.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
              >
                <span>Get API Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300 font-mono">
                API Key {activePreset.requiresKey ? <span className="text-rose-400">*</span> : <span className="text-slate-500">(Optional)</span>}
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
                    : activePreset.placeholder
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
              Persisted securely in Kubernetes ConfigMap <code className="text-cyan-400">vcop-ai-config</code> in namespace <code className="text-cyan-400">vcop-system</code>.
            </p>
          </div>

          {/* Remote Endpoint URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 font-mono">
              API Base URL / Endpoint
            </label>
            <input
              type="text"
              value={remoteEndpoint}
              onChange={(e) => setRemoteEndpoint(e.target.value)}
              placeholder={activePreset.defaultEndpoint}
              className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 text-xs font-mono text-white placeholder-slate-500 transition-colors"
            />
          </div>

          {/* Model Name */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300 font-mono">
                Model Name / Identifier
              </label>
              <span className="text-[10px] text-slate-500 font-mono">e.g. {activePreset.defaultModel}</span>
            </div>
            <input
              type="text"
              value={remoteModel}
              onChange={(e) => setRemoteModel(e.target.value)}
              placeholder={activePreset.defaultModel}
              className="w-full px-3 py-2 rounded-xl bg-cyber-950 border border-cyber-700/80 focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/40 text-xs font-mono text-white placeholder-slate-500 transition-colors"
            />

            {/* Suggestions Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] text-slate-500 font-mono">Presets:</span>
              {activePreset.suggestions.map((m) => (
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
        </div>
      )}

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
            <span>{testResult.ok ? 'Connection Successful' : 'Connection Failed'}</span>
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
        <button
          type="button"
          disabled={testing}
          onClick={handleTestConnection}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyber-900 hover:bg-cyber-800 border border-cyber-700 hover:border-slate-500 text-xs font-mono font-medium text-slate-200 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${testing ? 'animate-spin' : ''}`} />
          <span>{testing ? 'Testing...' : 'Test Connection'}</span>
        </button>

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
