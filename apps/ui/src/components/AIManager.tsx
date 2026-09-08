import React, { useState, useEffect } from 'react';
import {
  Bot,
  Sparkles,
  Cpu,
  Zap,
  ShieldCheck,
  Server,
  Activity,
  Globe,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { AISettingsPanel } from './AISettingsPanel';
import type { AISettingsPublic } from '../lib/types';

interface AIManagerProps {
  isAdmin?: boolean;
}

export function AIManager({ isAdmin = true }: AIManagerProps) {
  const [status, setStatus] = useState<{
    online: boolean;
    model: string;
    hardware: string;
    url: string;
    provider?: string;
    localModelEnabled?: boolean;
  }>({
    online: true,
    model: 'Gemma 3 1B IT (Q4_K_M)',
    hardware: 'Detecting...',
    url: '',
  });
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/ai/status');
      if (res.ok) {
        const data = await res.json();
        if (data?.ai) {
          setStatus({
            online: data.ai.online,
            model: data.ai.model || 'Gemma 3 1B (Q4)',
            hardware: data.ai.hardware || 'Host Hardware',
            url: data.ai.url || '',
            provider: data.ai.provider || 'local',
            localModelEnabled: data.ai.localModelEnabled ?? true,
          });
        }
      }
    } catch {}
    finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-2xl bg-cyber-950/80 border border-cyber-800/80 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
            <Bot className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight font-mono">
                AI Engine & Remote OpenAI Gateway
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold uppercase tracking-wider ${
                  status.online
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {status.online ? 'Active / Online' : 'Standby / Disabled'}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-1">
              Configure cluster intelligence: toggle bundled offline Gemma 3 or connect to a custom OpenAI-compatible API.
            </p>
          </div>
        </div>

        <button
          onClick={fetchStatus}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyber-900 hover:bg-cyber-800 border border-cyber-700/80 text-xs font-mono text-slate-300 hover:text-white transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* Telemetry Snapshot Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Active Model */}
        <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Active Inference Model</span>
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-sm font-bold text-white font-mono truncate" title={status.model}>
            {status.model}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Mode: <span className="text-cyan-300">{status.localModelEnabled ? 'Local Cluster Engine' : 'Custom OpenAI API'}</span>
          </div>
        </div>

        {/* Card 2: Hardware Acceleration / Provider */}
        <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Execution Runtime</span>
            <Cpu className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-sm font-bold text-white font-mono truncate" title={status.hardware}>
            {status.hardware}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Local Engine: <span className={status.localModelEnabled ? 'text-emerald-400' : 'text-amber-400'}>
              {status.localModelEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Card 3: Storage & Security */}
        <div className="p-4 rounded-2xl bg-cyber-900/60 border border-cyber-800/80 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Config Storage</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-sm font-bold text-white font-mono truncate">
            ConfigMap / vcop-system
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Resource: <code className="text-cyan-400 text-[10px]">vcop-ai-config</code>
          </div>
        </div>
      </div>

      {/* Main Settings Panel */}
      <div className="p-6 rounded-2xl bg-cyber-950/90 border border-cyber-800/80 shadow-2xl backdrop-blur-xl">
        <AISettingsPanel
          onSaved={(newCfg) => {
            fetchStatus();
          }}
        />
      </div>
    </div>
  );
}
