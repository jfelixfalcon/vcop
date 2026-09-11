import React, { useState, useEffect, useRef } from 'react';
import {
  PackageCheck,
  Download,
  Upload,
  ShieldCheck,
  ShieldAlert,
  FileCode,
  Layers,
  Database,
  Server,
  Package,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Key,
  Lock,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Info,
  Terminal,
  Search,
  Sliders,
  Check,
} from 'lucide-react';
import { CycloneDXModal } from './CycloneDXModal';
import type { PreFlightInspectionReport, ImportExecutionReport } from '../lib/airgap-bundle';
import type { CycloneDXBom } from '../lib/cyclonedx';

export const AirgapBundlesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'export' | 'import' | 'sbom' | 'architecture'>('export');

  // Export State
  const [includeApps, setIncludeApps] = useState(true);
  const [includeVCS, setIncludeVCS] = useState(true);
  const [includeOCI, setIncludeOCI] = useState(true);
  const [includeBaselines, setIncludeBaselines] = useState(true);
  const [includeSizing, setIncludeSizing] = useState(true);
  const [includeVersions, setIncludeVersions] = useState(true);
  const [signingSecret, setSigningSecret] = useState('');
  const [sourceInstance, setSourceInstance] = useState('vcop-connected-enclave');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Import State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [verificationKey, setVerificationKey] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [inspectReport, setInspectReport] = useState<PreFlightInspectionReport | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Ingestion Options State
  const [importApps, setImportApps] = useState(true);
  const [importVCS, setImportVCS] = useState(true);
  const [importOCI, setImportOCI] = useState(true);
  const [importBaselines, setImportBaselines] = useState(true);
  const [importSizing, setImportSizing] = useState(true);
  const [importVersions, setImportVersions] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportExecutionReport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Live SBOM State
  const [liveSBOM, setLiveSBOM] = useState<CycloneDXBom | null>(null);
  const [loadingSBOM, setLoadingSBOM] = useState(false);
  const [selectedContainerSBOM, setSelectedContainerSBOM] = useState<CycloneDXBom | null>(null);
  const [isContainerModalOpen, setIsContainerModalOpen] = useState(false);
  const [containerModalTitle, setContainerModalTitle] = useState('');
  const [sbomSearch, setSbomSearch] = useState('');
  const [sbomTypeFilter, setSbomTypeFilter] = useState('all');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Live SBOM for explorer tab
  const fetchLiveSBOM = async () => {
    setLoadingSBOM(true);
    try {
      const res = await fetch('/api/bundles/sbom');
      if (res.ok) {
        const data = await res.json();
        setLiveSBOM(data);
      }
    } catch (err) {
      console.warn('Failed to load live SBOM:', err);
    } finally {
      setLoadingSBOM(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'sbom' && !liveSBOM) {
      fetchLiveSBOM();
    }
  }, [activeTab]);

  // Handle Export
  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);

    try {
      const payload = {
        includeApps,
        includeVCS,
        includeOCI,
        includeBaselines,
        includeSizing,
        includeVersions,
        signingSecret: signingSecret.trim() || undefined,
        sourceInstance: sourceInstance.trim() || 'vcop-connected-enclave',
      };

      const res = await fetch('/api/bundles/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Export failed with HTTP status ${res.status}`);
      }

      const bundleId = res.headers.get('X-VCOp-Bundle-Id') || 'bundle';
      const assetsCount = res.headers.get('X-VCOp-Assets-Count') || 'assets';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vcop-airgap-bundle-${bundleId}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(`Successfully generated and downloaded sovereign airgap bundle (${assetsCount} assets packaged).`);
    } catch (err: any) {
      setExportError(err.message || 'Failed to export airgap bundle');
    } finally {
      setExporting(false);
    }
  };

  // Handle File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadFile(e.target.files[0]);
      setInspectReport(null);
      setInspectError(null);
      setImportResult(null);
    }
  };

  // Handle Pre-Flight Inspection
  const handleInspect = async () => {
    if (!uploadFile) return;
    setInspecting(true);
    setInspectError(null);
    setInspectReport(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('bundle', uploadFile);
      if (verificationKey.trim()) {
        formData.append('verificationKey', verificationKey.trim());
      }

      const res = await fetch('/api/bundles/inspect', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to inspect bundle archive');
      }

      setInspectReport(data.data);
    } catch (err: any) {
      setInspectError(err.message || 'Pre-flight inspection failed');
    } finally {
      setInspecting(false);
    }
  };

  // Handle Ingestion
  const handleImport = async () => {
    if (!uploadFile) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('bundle', uploadFile);
      formData.append('importApps', String(importApps));
      formData.append('importVCS', String(importVCS));
      formData.append('importOCI', String(importOCI));
      formData.append('importBaselines', String(importBaselines));
      formData.append('importSizing', String(importSizing));
      formData.append('importVersions', String(importVersions));
      if (verificationKey.trim()) {
        formData.append('verificationKey', verificationKey.trim());
      }

      const res = await fetch('/api/bundles/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ingestion failed');
      }

      setImportResult(data.data);
    } catch (err: any) {
      setImportError(err.message || 'Failed to complete airgap ingestion');
    } finally {
      setImporting(false);
    }
  };

  // Inspect specific container image SBOM
  const handleOpenContainerSBOM = async (repo: string, tag: string) => {
    try {
      const res = await fetch(`/api/bundles/containers/${repo}/${tag}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedContainerSBOM(data);
        setContainerModalTitle(`Container SBOM: ${repo}:${tag}`);
        setIsContainerModalOpen(true);
      }
    } catch (e) {
      console.warn('Failed to load container SBOM:', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Cyberpunk Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-cyber-950 via-cyber-900 to-cyber-950 border border-cyber-800/80 p-6 sm:p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                Airgap Cross-Domain Transfer
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                NIST SP 800-218 SSDF
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase bg-purple-500/10 border border-purple-500/30 text-purple-300">
                SLSA v1.0 Attested
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase bg-blue-500/10 border border-blue-500/30 text-blue-300">
                CycloneDX 1.5/1.6
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight font-mono">
              Airgap Artifact Bundles & Supply Chain
            </h1>
            <p className="text-sm font-mono text-slate-400 max-w-3xl">
              Export and import sovereign packages containing App Catalogs, GitOps VCS revision trees,
              OCI container images & Helm charts, and platform configurations. Complete with verifiable
              CycloneDX SBOMs and in-toto provenance.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                fetchLiveSBOM();
                setActiveTab('sbom');
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono font-bold text-slate-200 bg-cyber-800 hover:bg-cyber-700 border border-cyber-700 transition-colors shadow-lg"
            >
              <FileCode className="w-4 h-4 text-cyan-400" />
              <span>Live CycloneDX SBOM</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Tab Bar */}
      <div className="border-b border-cyber-800 bg-cyber-950/40 rounded-2xl p-1.5 flex flex-wrap gap-1.5 font-mono text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('export')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activeTab === 'export'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-900/60 border border-transparent'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Export Bundle (Connected &rarr; Airgap)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activeTab === 'import'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-900/60 border border-transparent'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Import Bundle (Airgap Ingestion)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sbom')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activeTab === 'sbom'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-900/60 border border-transparent'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>CycloneDX SBOM Explorer</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('architecture')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all ${
            activeTab === 'architecture'
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-cyber-900/60 border border-transparent'
          }`}
        >
          <Info className="w-4 h-4" />
          <span>Cybersecurity & Standards Reference</span>
        </button>
      </div>

      {/* TAB 1: EXPORT BUNDLE */}
      {activeTab === 'export' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-cyber-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                    <Download className="w-4 h-4 text-cyan-400" />
                    <span>Airgap Bundle Content Selection</span>
                  </h3>
                  <p className="text-xs font-mono text-slate-400 mt-0.5">
                    Select the artifacts and governance controls to include in the sovereign archive.
                  </p>
                </div>
              </div>

              {/* Selection Checkboxes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-cyber-950/80 border border-cyber-800 hover:border-cyber-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={includeApps}
                    onChange={(e) => setIncludeApps(e.target.checked)}
                    className="mt-0.5 rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <div>
                    <span className="font-semibold text-white block">App Store Catalog</span>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      All catalog definitions, groups, and manifest definitions.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-cyber-950/80 border border-cyber-800 hover:border-cyber-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={includeVCS}
                    onChange={(e) => setIncludeVCS(e.target.checked)}
                    className="mt-0.5 rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <div>
                    <span className="font-semibold text-white block">GitOps VCS History</span>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Full revision commit history, authors, unified diffs, and rollback snapshots.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-cyber-950/80 border border-cyber-800 hover:border-cyber-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={includeOCI}
                    onChange={(e) => setIncludeOCI(e.target.checked)}
                    className="mt-0.5 rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <div>
                    <span className="font-semibold text-white block">OCI Registry Artifacts</span>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Container images, Helm charts, config blobs, and content-addressable layer data.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-cyber-950/80 border border-cyber-800 hover:border-cyber-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={includeBaselines}
                    onChange={(e) => setIncludeBaselines(e.target.checked)}
                    className="mt-0.5 rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <div>
                    <span className="font-semibold text-white block">Cluster Baselines & Quotas</span>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Developer, Staging, and Production HA baselines and resource policies.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-cyber-950/80 border border-cyber-800 hover:border-cyber-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={includeSizing}
                    onChange={(e) => setIncludeSizing(e.target.checked)}
                    className="mt-0.5 rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <div>
                    <span className="font-semibold text-white block">Sizing Tiers Presets</span>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Host sizing allocations, CPU, memory, and storage boundaries.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-cyber-950/80 border border-cyber-800 hover:border-cyber-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={includeVersions}
                    onChange={(e) => setIncludeVersions(e.target.checked)}
                    className="mt-0.5 rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <div>
                    <span className="font-semibold text-white block">Version Registry</span>
                    <span className="text-slate-400 text-[11px] block mt-0.5">
                      Kubernetes, vCluster, CoreDNS, etcd, and Istio version compatibility matrix.
                    </span>
                  </div>
                </label>
              </div>

              {/* Provenance & Cryptographic Signing Settings */}
              <div className="space-y-4 pt-4 border-t border-cyber-800">
                <h4 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Provenance & Cryptographic Signing</span>
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">Source Instance Identifier</label>
                    <input
                      type="text"
                      value={sourceInstance}
                      onChange={(e) => setSourceInstance(e.target.value)}
                      className="w-full px-3 py-2 bg-cyber-950 border border-cyber-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Custom Transfer Signing Secret <span className="text-slate-500">(Optional)</span>
                    </label>
                    <input
                      type="password"
                      placeholder="Leave blank for platform default key"
                      value={signingSecret}
                      onChange={(e) => setSigningSecret(e.target.value)}
                      className="w-full px-3 py-2 bg-cyber-950 border border-cyber-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {/* Status Messages */}
              {exportError && (
                <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{exportError}</span>
                </div>
              )}

              {exportSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs font-mono flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{exportSuccess}</span>
                </div>
              )}

              {/* Export Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={exporting}
                  onClick={handleExport}
                  className="w-full py-3 px-4 rounded-xl text-xs font-mono font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:from-cyan-300 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {exporting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Packaging Sovereign Bundle & Calculating Cryptographic Digests...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Generate & Download Airgap Bundle (.tar.gz)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Security Guarantees & Summary */}
          <div className="space-y-6">
            <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Security & Compliance Checklist</span>
              </h3>

              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-start gap-2.5 text-slate-300">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">CycloneDX v1.5 SBOM</strong>
                    <p className="text-[11px] text-slate-400">
                      Standardized inventory of all apps, container images, Helm charts, and libraries.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-slate-300">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">in-toto SLSA v1.0 Provenance</strong>
                    <p className="text-[11px] text-slate-400">
                      Verifiable build statement linking builder, user identity, and timestamp.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-slate-300">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">FIPS-Aligned Hashes</strong>
                    <p className="text-[11px] text-slate-400">
                      Dual SHA-256 and SHA-512 cryptographic digests for every file and blob.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-slate-300">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Data Diode / CDS Compliant</strong>
                    <p className="text-[11px] text-slate-400">
                      Single flat archive format without external network dependencies.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-800/40 text-xs font-mono space-y-2">
              <span className="text-cyan-300 font-bold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Air-Gap Data Transfer Guidance
              </span>
              <p className="text-slate-400 text-[11px]">
                Once downloaded, this file can be transferred through optical media, secure USB, or cross-domain data diodes.
                The receiving vCOp instance verifies signatures and hashes before any data is ingested.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: IMPORT BUNDLE */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* File Upload Zone */}
          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-6">
            <div className="border-b border-cyber-800 pb-4">
              <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <Upload className="w-4 h-4 text-cyan-400" />
                <span>Airgap Bundle Ingestion & Pre-Flight Verification</span>
              </h3>
              <p className="text-xs font-mono text-slate-400 mt-0.5">
                Upload a `.tar.gz` bundle file. vCOp will run cryptographic integrity checks, parse the CycloneDX SBOM,
                and inspect all assets before making changes.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-cyber-700 hover:border-cyan-500 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-cyber-950/60"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".tar.gz,.tgz,.bundle"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <PackageCheck className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
                  <span className="text-xs font-mono font-bold text-white block">
                    {uploadFile ? uploadFile.name : 'Click to select Airgap Bundle archive (.tar.gz)'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 block mt-1">
                    {uploadFile ? `${(uploadFile.size / 1024 / 1024).toFixed(2)} MB` : 'Drag and drop or browse file'}
                  </span>
                </div>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Transfer Verification Secret <span className="text-slate-500">(Optional)</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Enter secret if custom key was used"
                    value={verificationKey}
                    onChange={(e) => setVerificationKey(e.target.value)}
                    className="w-full px-3 py-2 bg-cyber-950 border border-cyber-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={!uploadFile || inspecting}
                  onClick={handleInspect}
                  className="w-full py-2.5 px-4 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {inspecting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Verifying Cryptographic Digests...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Analyze & Verify Pre-Flight Inspection</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {inspectError && (
              <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{inspectError}</span>
              </div>
            )}
          </div>

          {/* Pre-Flight Inspection Report */}
          {inspectReport && (
            <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-6 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-cyber-800 pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-xl border ${
                      inspectReport.signature.verified
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    }`}
                  >
                    {inspectReport.signature.verified ? (
                      <ShieldCheck className="w-5 h-5" />
                    ) : (
                      <ShieldAlert className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-mono">
                      Pre-Flight Inspection: Bundle {inspectReport.bundleId}
                    </h3>
                    <p className="text-xs font-mono text-slate-400">
                      Source: <span className="text-cyan-300">{inspectReport.sourceInstance}</span> • Exporter:{' '}
                      <span className="text-slate-300">{inspectReport.exporter}</span> • Exported:{' '}
                      {new Date(inspectReport.exportedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase border ${
                      inspectReport.signature.verified
                        ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                        : 'bg-amber-950 border-amber-800 text-amber-300'
                    }`}
                  >
                    {inspectReport.signature.verified ? 'Signature Valid' : 'Signature Unverified'}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold uppercase border ${
                      inspectReport.checksumsPassed
                        ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                        : 'bg-rose-950 border-rose-800 text-rose-300'
                    }`}
                  >
                    {inspectReport.checksumsPassed ? '100% SHA-256 Passed' : 'Checksum Mismatch'}
                  </span>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                <div className="p-3.5 rounded-xl bg-cyber-950/70 border border-cyber-800">
                  <span className="text-slate-400 block text-[11px]">Total Assets</span>
                  <span className="text-lg font-bold text-white block mt-1">{inspectReport.assetsCount} items</span>
                  <span className="text-slate-500 text-[10px]">
                    {(inspectReport.totalSizeBytes / 1024 / 1024).toFixed(2)} MB uncompressed
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-cyber-950/70 border border-cyber-800">
                  <span className="text-slate-400 block text-[11px]">App Store Catalog</span>
                  <span className="text-lg font-bold text-indigo-400 block mt-1">
                    {inspectReport.catalog.appsCount} Apps
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    {inspectReport.catalog.vcsCommitsCount} VCS commits included
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-cyber-950/70 border border-cyber-800">
                  <span className="text-slate-400 block text-[11px]">OCI Registry Artifacts</span>
                  <span className="text-lg font-bold text-cyan-400 block mt-1">
                    {inspectReport.oci.artifactsCount} Artifacts
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    {inspectReport.oci.repositoriesCount} repositories
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-cyber-950/70 border border-cyber-800">
                  <span className="text-slate-400 block text-[11px]">CycloneDX SBOM</span>
                  <span className="text-lg font-bold text-emerald-400 block mt-1">
                    {inspectReport.cycloneDXSummary.totalComponents} Components
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    v{inspectReport.cycloneDXSummary.specVersion} ECMA-424 compliant
                  </span>
                </div>
              </div>

              {/* Ingestion Selectors */}
              <div className="space-y-3 pt-4 border-t border-cyber-800">
                <h4 className="text-xs font-bold font-mono text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Choose Components to Ingest into Airgap Cluster</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importApps}
                      onChange={(e) => setImportApps(e.target.checked)}
                      className="rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                    />
                    <span>Catalog Apps ({inspectReport.catalog.appsCount})</span>
                  </label>

                  <label className="flex items-center gap-2 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importVCS}
                      onChange={(e) => setImportVCS(e.target.checked)}
                      className="rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                    />
                    <span>GitOps VCS Trees ({inspectReport.catalog.vcsCommitsCount})</span>
                  </label>

                  <label className="flex items-center gap-2 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importOCI}
                      onChange={(e) => setImportOCI(e.target.checked)}
                      className="rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                    />
                    <span>OCI Artifacts & Blobs ({inspectReport.oci.artifactsCount})</span>
                  </label>

                  <label className="flex items-center gap-2 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importBaselines}
                      onChange={(e) => setImportBaselines(e.target.checked)}
                      className="rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                    />
                    <span>Cluster Baselines ({inspectReport.configurations.baselinesCount})</span>
                  </label>

                  <label className="flex items-center gap-2 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importSizing}
                      onChange={(e) => setImportSizing(e.target.checked)}
                      className="rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                    />
                    <span>Sizing Tiers ({inspectReport.configurations.sizingTiersCount})</span>
                  </label>

                  <label className="flex items-center gap-2 p-3 rounded-xl bg-cyber-950 border border-cyber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importVersions}
                      onChange={(e) => setImportVersions(e.target.checked)}
                      className="rounded border-cyber-700 text-cyan-500 focus:ring-cyan-500/30"
                    />
                    <span>Version Registry</span>
                  </label>
                </div>
              </div>

              {/* Commit Ingestion Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={importing}
                  onClick={handleImport}
                  className="w-full py-3 px-4 rounded-xl text-xs font-mono font-bold text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {importing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Replaying OCI Blobs & Ingesting Catalog into Airgap Cluster...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Commit & Ingest Bundle into Airgap Cluster</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Ingestion Execution Report */}
          {importResult && (
            <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-4 font-mono text-xs animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-cyber-800 pb-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Ingestion Completed Successfully ({importResult.durationMs}ms)</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] bg-cyber-950 border border-cyber-800 text-slate-400">
                  Bundle ID: {importResult.bundleId}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-cyber-950 border border-cyber-800">
                  <span className="text-slate-500 block text-[10px]">Apps Ingested:</span>
                  <span className="text-white font-bold">{importResult.ingested.apps}</span>
                </div>
                <div className="p-3 rounded-xl bg-cyber-950 border border-cyber-800">
                  <span className="text-slate-500 block text-[10px]">VCS Commits Restored:</span>
                  <span className="text-white font-bold">{importResult.ingested.vcsCommits}</span>
                </div>
                <div className="p-3 rounded-xl bg-cyber-950 border border-cyber-800">
                  <span className="text-slate-500 block text-[10px]">OCI Blobs Replayed:</span>
                  <span className="text-white font-bold">{importResult.ingested.ociBlobs}</span>
                </div>
                <div className="p-3 rounded-xl bg-cyber-950 border border-cyber-800">
                  <span className="text-slate-500 block text-[10px]">OCI Manifests Created:</span>
                  <span className="text-white font-bold">{importResult.ingested.ociManifests}</span>
                </div>
              </div>

              {/* Execution Log Stream */}
              <div className="space-y-1">
                <span className="text-slate-400 text-[11px] block font-semibold">Audit Execution Stream:</span>
                <div className="p-3 rounded-xl bg-cyber-950 border border-cyber-800 text-[11px] text-slate-300 max-h-48 overflow-y-auto space-y-1">
                  {importResult.logs.map((line, idx) => (
                    <div key={idx} className="font-mono">{line}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CYCLONEDX SBOM EXPLORER */}
      {activeTab === 'sbom' && (
        <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cyber-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Live System CycloneDX 1.5/1.6 SBOM Explorer</span>
              </h3>
              <p className="text-xs font-mono text-slate-400 mt-0.5">
                Real-time Software Bill of Materials detailing every application, container image, and platform component.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchLiveSBOM}
                disabled={loadingSBOM}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono text-slate-300 hover:text-white bg-cyber-800 hover:bg-cyber-700 border border-cyber-700 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSBOM ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <a
                href="/api/bundles/sbom?download=true"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 transition-all shadow-md shadow-cyan-500/20"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Live SBOM (JSON)</span>
              </a>
            </div>
          </div>

          {loadingSBOM ? (
            <div className="py-16 text-center text-slate-400 font-mono text-xs flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
              <span>Generating comprehensive CycloneDX SBOM graph...</span>
            </div>
          ) : liveSBOM ? (
            <div className="space-y-4">
              {/* Search and Filters */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto text-xs font-mono">
                  {['all', 'container', 'application', 'configuration'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSbomTypeFilter(type)}
                      className={`px-3 py-1 rounded-lg uppercase text-[10px] font-bold transition-colors ${
                        sbomTypeFilter === type
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-cyber-950 text-slate-400 hover:text-white border border-cyber-800'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  placeholder="Filter components, purls, hashes..."
                  value={sbomSearch}
                  onChange={(e) => setSbomSearch(e.target.value)}
                  className="w-full sm:w-64 px-3 py-1.5 bg-cyber-950 border border-cyber-800 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Components Table */}
              <div className="border border-cyber-800 rounded-xl overflow-hidden bg-cyber-950/60 font-mono text-xs">
                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-cyber-950 text-[10px] font-bold uppercase text-slate-400 border-b border-cyber-800">
                  <span className="col-span-3">Type & Name</span>
                  <span className="col-span-2">Version</span>
                  <span className="col-span-4">Package URL (PURL)</span>
                  <span className="col-span-3 text-right">Actions</span>
                </div>

                <div className="divide-y divide-cyber-900 max-h-[55vh] overflow-y-auto">
                  {(liveSBOM.components || [])
                    .filter((c) => {
                      if (sbomTypeFilter !== 'all' && c.type !== sbomTypeFilter) return false;
                      if (sbomSearch) {
                        const q = sbomSearch.toLowerCase();
                        return (
                          c.name.toLowerCase().includes(q) ||
                          (c.purl || '').toLowerCase().includes(q) ||
                          (c.version || '').toLowerCase().includes(q)
                        );
                      }
                      return true;
                    })
                    .map((c, idx) => (
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

                        <div className="col-span-3 flex items-center justify-end gap-2">
                          {c.type === 'container' ? (
                            <button
                              type="button"
                              onClick={() => handleOpenContainerSBOM(c.name, c.version)}
                              className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-cyan-950 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 transition-colors"
                            >
                              Inspect Container SBOM
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500">Standard Asset</span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Click &quot;Refresh&quot; to inspect the live CycloneDX SBOM.
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CYBERSECURITY STANDARDS & ARCHITECTURE */}
      {activeTab === 'architecture' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono text-xs">
          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>NIST SP 800-218 (SSDF) Compliance</span>
            </h3>
            <p className="text-slate-400 leading-relaxed">
              vCOp enforces the NIST Secure Software Development Framework (SSDF) across every exported asset.
              Every file, layer, and manifest is cryptographically bound into <code className="text-cyan-300">bundle-manifest.json</code>{' '}
              with strict SHA-256 and SHA-512 hashes.
            </p>
            <div className="p-3.5 rounded-xl bg-cyber-950 border border-cyber-800 space-y-1.5 text-[11px] text-slate-300">
              <span className="font-bold text-white block">Key Security Protections:</span>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>Zero Zip-Slip Vulnerability: Canonical path resolution bounds checking on extraction.</li>
                <li>Decompression Bomb Defense: Strict uncompressed limits and file count thresholds.</li>
                <li>Digital Signatures: HMAC-SHA256 non-repudiation over manifest digests.</li>
              </ul>
            </div>
          </div>

          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <FileCode className="w-4 h-4 text-purple-400" />
              <span>in-toto & SLSA v1.0 Provenance Attestation</span>
            </h3>
            <p className="text-slate-400 leading-relaxed">
              Airgap bundles package an in-toto provenance statement conforming to the SLSA v1.0 standard.
              This guarantees sovereign proof of origin:
            </p>
            <div className="p-3.5 rounded-xl bg-cyber-950 border border-cyber-800 space-y-1.5 text-[11px] text-slate-300">
              <span className="font-bold text-white block">SLSA Attestation Metadata:</span>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li><code className="text-purple-300">builder.id</code>: Verified in-cluster vCOp instance.</li>
                <li><code className="text-purple-300">subject.digest</code>: Cryptographic hash of the bundle manifest.</li>
                <li><code className="text-purple-300">runDetails.invocationId</code>: Globally unique transfer run UUID.</li>
              </ul>
            </div>
          </div>

          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-400" />
              <span>OCI Distribution Spec v1.1 Replication</span>
            </h3>
            <p className="text-slate-400 leading-relaxed">
              The internal OCI engine stores container images, Helm charts, and custom artifacts in Content-Addressable
              Storage (CAS). Blobs are deduplicated across all repositories, minimizing cross-domain transfer payloads.
            </p>
          </div>

          <div className="bg-cyber-900/60 border border-cyber-800 rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-400" />
              <span>Cross-Domain & Data Diode Readiness</span>
            </h3>
            <p className="text-slate-400 leading-relaxed">
              vCOp bundles are designed for strict unidirectional data diodes and optical transfer media.
              The single-file archive format requires zero interactive callbacks or external DNS/HTTP lookups.
            </p>
          </div>
        </div>
      )}

      {/* Container CycloneDX SBOM Modal */}
      <CycloneDXModal
        isOpen={isContainerModalOpen}
        onClose={() => setIsContainerModalOpen(false)}
        sbom={selectedContainerSBOM}
        title={containerModalTitle}
        isContainer={true}
      />
    </div>
  );
};
