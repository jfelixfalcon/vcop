import React, { useState, useEffect } from 'react';
import { UserCheck, ShieldCheck, Lock, Users } from 'lucide-react';
import { AccessPolicyManager } from './AccessPolicyManager';
import { OidcManager } from './OidcManager';
import type { OidcRegistry } from '../lib/types';

interface Props {
  initialRegistry?: OidcRegistry;
  isAdmin: boolean;
}

export const AccessAndOidcContainer: React.FC<Props> = ({ initialRegistry, isAdmin }) => {
  const [activeTab, setActiveTab] = useState<'access' | 'oidc'>('access');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'oidc') {
        setActiveTab('oidc');
      } else if (params.get('tab') === 'access') {
        setActiveTab('access');
      }
    }
  }, []);

  const switchTab = (tab: 'access' | 'oidc') => {
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
      <div className="flex items-center justify-between border-b border-cyber-800 pb-4">
        <div className="flex items-center gap-2 p-1 rounded-2xl bg-cyber-900/80 border border-cyber-700/80 backdrop-blur-md">
          <button
            type="button"
            onClick={() => switchTab('access')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              activeTab === 'access'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-800/60 border border-transparent'
            }`}
          >
            <UserCheck className={`w-4 h-4 ${activeTab === 'access' ? 'text-amber-400' : 'text-slate-400'}`} />
            <span>Platform Access & Roles (RBAC)</span>
          </button>

          <button
            type="button"
            onClick={() => switchTab('oidc')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer ${
              activeTab === 'oidc'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-800/60 border border-transparent'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 ${activeTab === 'oidc' ? 'text-purple-400' : 'text-slate-400'}`} />
            <span>vCluster OIDC Profiles</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-slate-500">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          <span>Cluster Security & Identity Governance</span>
        </div>
      </div>

      {/* Active Tab Content */}
      {activeTab === 'access' ? (
        <AccessPolicyManager isAdmin={isAdmin} />
      ) : (
        <OidcManager initialRegistry={initialRegistry} isAdmin={isAdmin} />
      )}
    </div>
  );
};
