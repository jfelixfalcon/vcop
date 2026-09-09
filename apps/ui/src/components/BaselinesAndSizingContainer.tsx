import React, { useState, useEffect } from 'react';
import { Sliders, Layers, Sparkles, Server } from 'lucide-react';
import { ClusterBaselinesManager } from './ClusterBaselinesManager';
import { SizingTiersManager } from './SizingTiersManager';
import type { ClusterBaseline, PresetDetails } from '../lib/types';

interface Props {
  initialBaselines: ClusterBaseline[];
  initialSizingTiers: PresetDetails[];
  isAdmin: boolean;
}

export const BaselinesAndSizingContainer: React.FC<Props> = ({
  initialBaselines,
  initialSizingTiers,
  isAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<'baselines' | 'sizing'>('baselines');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'sizing') {
        setActiveTab('sizing');
      } else if (params.get('tab') === 'baselines') {
        setActiveTab('baselines');
      }
    }
  }, []);

  const switchTab = (tab: 'baselines' | 'sizing') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <div className="space-y-6">
      {/* Primary Tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyber-800 pb-4">
        <div className="flex items-center gap-2 p-1 rounded-2xl bg-cyber-900/80 border border-cyber-700/80 backdrop-blur-md">
          <button
            type="button"
            onClick={() => switchTab('baselines')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              activeTab === 'baselines'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-800/60 border border-transparent'
            }`}
          >
            <Sliders className={`w-4 h-4 ${activeTab === 'baselines' ? 'text-cyan-400' : 'text-slate-400'}`} />
            <span>Cluster Baselines (Blueprints)</span>
            <span className="px-1.5 py-0.5 rounded-full bg-cyber-950 text-[10px] border border-cyber-800 text-slate-400">
              {initialBaselines.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('sizing')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              activeTab === 'sizing'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-800/60 border border-transparent'
            }`}
          >
            <Layers className={`w-4 h-4 ${activeTab === 'sizing' ? 'text-purple-400' : 'text-slate-400'}`} />
            <span>Sizing Tiers (Compute & HA)</span>
            <span className="px-1.5 py-0.5 rounded-full bg-cyber-950 text-[10px] border border-cyber-800 text-slate-400">
              {initialSizingTiers.length}
            </span>
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-500">
          <Server className="w-3.5 h-3.5 text-slate-400" />
          <span>Governance & Standard Architecture Blueprints</span>
        </div>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'baselines' ? (
        <ClusterBaselinesManager
          initialBaselines={initialBaselines}
          initialSizingTiers={initialSizingTiers}
          isAdmin={isAdmin}
        />
      ) : (
        <SizingTiersManager
          initialTiers={initialSizingTiers}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
};
