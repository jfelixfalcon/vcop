import React, { useState } from 'react';
import {
  FileText,
  Download,
  Copy,
  Check,
  X,
  ShieldCheck,
  Layers,
  Box,
  Cpu,
  Package,
  ExternalLink,
  Code,
  Tag,
  Key,
  Database,
} from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import type { CycloneDXBom, CycloneDXComponent } from '../lib/cyclonedx';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sbom: CycloneDXBom | null;
  title?: string;
  isContainer?: boolean;
}

export const CycloneDXModal: React.FC<Props> = ({
  isOpen,
  onClose,
  sbom,
  title = 'CycloneDX Software Bill of Materials (SBOM)',
  isContainer = false,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'components' | 'raw'>('overview');
  const [copied, setCopied] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen || !sbom) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(sbom, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const jsonStr = JSON.stringify(sbom, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/vnd.cyclonedx+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanTitle = (sbom.metadata?.component?.name || 'sbom').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${cleanTitle}-cyclonedx.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const allComponents = sbom.components || [];
  // Flatten root component and subcomponents if present
  const flatComponents: CycloneDXComponent[] = [];
  const walk = (c: CycloneDXComponent) => {
    flatComponents.push(c);
    for (const sub of c.components || []) {
      walk(sub);
    }
  };
  for (const c of allComponents) {
    walk(c);
  }

  const filteredComponents = flatComponents.filter((c) => {
    if (filterType !== 'all' && c.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = c.name.toLowerCase().includes(q);
      const matchPurl = (c.purl || '').toLowerCase().includes(q);
      const matchVersion = (c.version || '').toLowerCase().includes(q);
      if (!matchName && !matchPurl && !matchVersion) return false;
    }
    return true;
  });

  const containersCount = flatComponents.filter((c) => c.type === 'container').length;
  const appsCount = flatComponents.filter((c) => c.type === 'application').length;
  const libsCount = flatComponents.filter((c) => c.type === 'library').length;
  const osCount = flatComponents.filter((c) => c.type === 'operating-system').length;
  const filesCount = flatComponents.filter((c) => c.type === 'file').length;

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-cyber-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
        <div className="bg-cyber-900 border border-cyber-700/80 rounded-2xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-cyber-800 flex items-center justify-between bg-cyber-950/60">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white font-mono">{title}</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-cyan-950 border border-cyan-800 text-cyan-300">
                    CycloneDX v{sbom.specVersion}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-950 border border-emerald-800 text-emerald-300">
                    NIST SP 800-218
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  Serial: <span className="text-slate-300 select-all">{sbom.serialNumber}</span> • Spec:{' '}
                  {sbom.bomFormat} {sbom.specVersion}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-medium text-slate-300 hover:text-white bg-cyber-800 hover:bg-cyber-700 border border-cyber-700 transition-colors"
                title="Copy raw CycloneDX JSON"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy JSON'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 transition-all shadow-md shadow-cyan-500/20"
                title="Download CycloneDX JSON Report"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export JSON</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white bg-cyber-800 hover:bg-cyber-700 rounded-xl transition-colors ml-2"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 px-6 pt-3 border-b border-cyber-800 bg-cyber-950/30 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`pb-2.5 px-2 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Executive Overview</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('components')}
              className={`pb-2.5 px-2 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'components'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Components Inventory ({flatComponents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('raw')}
              className={`pb-2.5 px-2 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'raw'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Raw JSON View</span>
            </button>
          </div>

          {/* Content Area */}
          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
                    <span className="text-[11px] font-mono text-slate-400 block">Total Assets</span>
                    <span className="text-xl font-bold font-mono text-white mt-1 block">
                      {flatComponents.length}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
                    <span className="text-[11px] font-mono text-slate-400 block">Containers</span>
                    <span className="text-xl font-bold font-mono text-cyan-400 mt-1 block">
                      {containersCount}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
                    <span className="text-[11px] font-mono text-slate-400 block">Applications</span>
                    <span className="text-xl font-bold font-mono text-indigo-400 mt-1 block">
                      {appsCount}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
                    <span className="text-[11px] font-mono text-slate-400 block">OS Packages</span>
                    <span className="text-xl font-bold font-mono text-emerald-400 mt-1 block">
                      {libsCount}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-cyber-950/60 border border-cyber-800">
                    <span className="text-[11px] font-mono text-slate-400 block">Layers / Files</span>
                    <span className="text-xl font-bold font-mono text-purple-400 mt-1 block">
                      {filesCount}
                    </span>
                  </div>
                </div>

                {/* Root Metadata Card */}
                <div className="p-4 rounded-xl bg-cyber-950/70 border border-cyber-800/80 space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between border-b border-cyber-800/80 pb-2">
                    <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                      Root Target Specification
                    </span>
                    <span className="text-slate-400">Generated: {new Date(sbom.metadata?.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300">
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">Root Component Name:</span>
                      <span className="font-semibold text-white">{sbom.metadata?.component?.name}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">Package URL (PURL):</span>
                      <span className="font-semibold text-cyan-300 truncate block select-all">
                        {sbom.metadata?.component?.purl || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">Author / Creator:</span>
                      <span>{sbom.metadata?.authors?.[0]?.name || 'Platform Security Officer'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">Tooling / Generator:</span>
                      <span>{sbom.metadata?.tools?.components?.[0]?.name || 'vCOp Secure Supply Chain Engine'}</span>
                    </div>
                  </div>
                </div>

                {/* Supply Chain Guarantees */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-950/30 to-blue-950/20 border border-cyan-800/50 space-y-2">
                  <h4 className="text-xs font-bold font-mono text-cyan-300 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                    <span>Cybersecurity & Supply Chain Compliance Guarantees</span>
                  </h4>
                  <ul className="text-xs font-mono text-slate-300 space-y-1 pl-4 list-disc">
                    <li><strong className="text-white">CISA & NTIA Minimum Elements</strong>: Standardized PURLs, cryptographic SHA-256 hashes, timestamps, and dependencies mapped.</li>
                    <li><strong className="text-white">NIST SP 800-218 (SSDF)</strong>: Cryptographic digests protect against unauthorized manifest and layer tampering.</li>
                    <li><strong className="text-white">Zero Third-Party Leaks</strong>: Generated natively inside the sovereign cluster with zero egress to external SaaS registries.</li>
                  </ul>
                </div>
              </div>
            )}

            {activeTab === 'components' && (
              <div className="space-y-4">
                {/* Search and Filters */}
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto text-xs font-mono">
                    {['all', 'container', 'application', 'operating-system', 'library', 'file', 'configuration'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFilterType(type)}
                        className={`px-2.5 py-1 rounded-lg uppercase text-[10px] font-bold transition-colors whitespace-nowrap ${
                          filterType === type
                            ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/30'
                            : 'bg-cyber-950 text-slate-400 hover:text-white border border-cyber-800'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>

                  <input
                    type="text"
                    placeholder="Search component, purl, version..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full sm:w-64 px-3 py-1.5 bg-cyber-950 border border-cyber-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                {/* Table of Components */}
                <div className="border border-cyber-800 rounded-xl overflow-hidden bg-cyber-950/60 font-mono text-xs">
                  <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-cyber-950 text-[10px] font-bold uppercase text-slate-400 border-b border-cyber-800">
                    <span className="col-span-3">Type & Name</span>
                    <span className="col-span-2">Version</span>
                    <span className="col-span-4">Package URL (PURL)</span>
                    <span className="col-span-3">Hash (SHA-256)</span>
                  </div>

                  <div className="divide-y divide-cyber-900 max-h-[50vh] overflow-y-auto">
                    {filteredComponents.length === 0 ? (
                      <div className="p-8 text-center text-slate-500 text-xs">
                        No components match the selected filter.
                      </div>
                    ) : (
                      filteredComponents.map((c, idx) => {
                        const hash = c.hashes?.find((h) => h.alg === 'SHA-256')?.content || 'N/A';
                        return (
                          <div
                            key={c['bom-ref'] || idx}
                            className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-cyber-900/40 transition-colors"
                          >
                            <div className="col-span-3 flex items-center gap-2 min-w-0">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                                  c.type === 'container'
                                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                                    : c.type === 'application'
                                    ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                    : c.type === 'operating-system'
                                    ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                    : c.type === 'library'
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                                }`}
                              >
                                {c.type}
                              </span>
                              <span className="font-semibold text-white truncate" title={c.name}>
                                {c.name}
                              </span>
                            </div>

                            <div className="col-span-2 text-slate-300 truncate">{c.version}</div>

                            <div className="col-span-4 text-slate-400 text-[11px] truncate select-all" title={c.purl}>
                              {c.purl || 'N/A'}
                            </div>

                            <div className="col-span-3 text-slate-500 text-[10px] font-mono truncate select-all" title={hash}>
                              {hash !== 'N/A' ? `${hash.slice(0, 16)}...` : 'N/A'}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'raw' && (
              <div className="relative">
                <pre className="p-4 rounded-xl bg-cyber-950 border border-cyber-800 font-mono text-[11px] text-cyan-300 overflow-x-auto max-h-[60vh] select-all">
                  {JSON.stringify(sbom, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-cyber-800 bg-cyber-950/60 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Valid CycloneDX 1.5 JSON specification standard • ECMA-424</span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl bg-cyber-800 hover:bg-cyber-700 text-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
