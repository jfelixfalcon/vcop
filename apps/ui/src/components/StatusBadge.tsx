import React from 'react';
import type { ClusterPhase } from '../lib/types';

interface Props {
  phase: ClusterPhase;
  className?: string;
}

export const StatusBadge: React.FC<Props> = ({ phase, className = '' }) => {
  switch (phase) {
    case 'Ready':
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-glow-emerald ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          Active
        </span>
      );
    case 'Provisioning':
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-glow-amber ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span>
          Syncing
        </span>
      );
    case 'Upgrading':
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30 ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
          Upgrading
        </span>
      );
    case 'Degraded':
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-glow-rose ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
          Degraded
        </span>
      );
    case 'Terminating':
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-slate-500/10 text-slate-400 border border-slate-500/20 ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"></span>
          Draining
        </span>
      );
    case 'Sleeping':
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
          Sleeping
        </span>
      );
    case 'Pending':
    default:
      return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full text-xs font-medium font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 ${className}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
          Pending
        </span>
      );
  }
};
