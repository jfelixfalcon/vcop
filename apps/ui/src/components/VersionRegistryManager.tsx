import React, { useState, useEffect } from "react";
import {
  Layers,
  Cpu,
  Database,
  Network,
  Activity,
  Shield,
  Plus,
  Trash2,
  Star,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Sliders,
  Sparkles,
  Globe,
  Upload,
  Download,
  AlertOctagon,
  FileCode,
} from "lucide-react";
import type { VersionItem, VersionRegistry, VersionTag, VersionCategory } from "../lib/types";
import { ImageRegistryManager } from "./ImageRegistryManager";

interface Props {
  initialRegistry?: VersionRegistry;
  isAdmin: boolean;
}

interface CategoryConfig {
  id: VersionCategory;
  title: string;
  badge: string;
  description: string;
  placeholder: string;
  labelPlaceholder: string;
  icon: React.ElementType;
  theme: {
    iconBg: string;
    iconBorder: string;
    iconColor: string;
    activeTabBg: string;
    activeTabBorder: string;
    activeTabColor: string;
    defaultBadgeBg: string;
    defaultBadgeBorder: string;
    defaultBadgeText: string;
    defaultCardBorder: string;
    defaultCardBg: string;
    addButtonBg: string;
    addButtonHover: string;
    accentText: string;
  };
  getItems: (registry: VersionRegistry | null) => VersionItem[];
}

const CATEGORIES: CategoryConfig[] = [
  {
    id: "k8s",
    title: "Kubernetes Control Plane",
    badge: "API Server",
    description: "Defines the Kubernetes API server and guest cluster distribution version.",
    placeholder: "e.g. v1.33.0 or v1.32.2",
    labelPlaceholder: "e.g. v1.33.0 (Next-Gen)",
    icon: Cpu,
    theme: {
      iconBg: "bg-cyan-500/10",
      iconBorder: "border-cyan-500/30",
      iconColor: "text-cyan-400",
      activeTabBg: "bg-cyan-500/20",
      activeTabBorder: "border-cyan-500/40",
      activeTabColor: "text-cyan-300",
      defaultBadgeBg: "bg-cyan-500/20",
      defaultBadgeBorder: "border-cyan-500/40",
      defaultBadgeText: "text-cyan-300",
      defaultCardBorder: "border-cyan-500/50",
      defaultCardBg: "bg-cyan-950/20",
      addButtonBg: "bg-cyan-500",
      addButtonHover: "hover:bg-cyan-400",
      accentText: "text-cyan-400",
    },
    getItems: (r) => r?.kubernetesVersions || [],
  },
  {
    id: "vcluster",
    title: "vCluster Syncer Engine",
    badge: "Syncer Core",
    description: "Syncer container versions and virtual cluster engine releases supported across the fleet.",
    placeholder: "e.g. 0.37.0 or 0.36.1",
    labelPlaceholder: "e.g. 0.37.0 (Fast Syncer)",
    icon: Layers,
    theme: {
      iconBg: "bg-purple-500/10",
      iconBorder: "border-purple-500/30",
      iconColor: "text-purple-400",
      activeTabBg: "bg-purple-500/20",
      activeTabBorder: "border-purple-500/40",
      activeTabColor: "text-purple-300",
      defaultBadgeBg: "bg-purple-500/20",
      defaultBadgeBorder: "border-purple-500/40",
      defaultBadgeText: "text-purple-300",
      defaultCardBorder: "border-purple-500/50",
      defaultCardBg: "bg-purple-950/20",
      addButtonBg: "bg-purple-600",
      addButtonHover: "hover:bg-purple-500",
      accentText: "text-purple-400",
    },
    getItems: (r) => r?.vclusterVersions || [],
  },
  {
    id: "etcd",
    title: "etcd Backing Store",
    badge: "Stateful Storage",
    description: "Dedicated etcd statefulset backing store image tag used for virtual cluster state persistence.",
    placeholder: "e.g. 3.6.8-0",
    labelPlaceholder: "e.g. 3.6.8-0 (High Throughput)",
    icon: Database,
    theme: {
      iconBg: "bg-amber-500/10",
      iconBorder: "border-amber-500/30",
      iconColor: "text-amber-400",
      activeTabBg: "bg-amber-500/20",
      activeTabBorder: "border-amber-500/40",
      activeTabColor: "text-amber-300",
      defaultBadgeBg: "bg-amber-500/20",
      defaultBadgeBorder: "border-amber-500/40",
      defaultBadgeText: "text-amber-300",
      defaultCardBorder: "border-amber-500/50",
      defaultCardBg: "bg-amber-950/20",
      addButtonBg: "bg-amber-600",
      addButtonHover: "hover:bg-amber-500",
      accentText: "text-amber-400",
    },
    getItems: (r) => r?.etcdVersions || [],
  },
  {
    id: "coredns",
    title: "CoreDNS Resolver",
    badge: "Cluster DNS",
    description: "Internal guest cluster DNS service container image tag and core resolver.",
    placeholder: "e.g. v1.11.3 or v1.12.0",
    labelPlaceholder: "e.g. v1.11.3 (Recommended)",
    icon: Network,
    theme: {
      iconBg: "bg-emerald-500/10",
      iconBorder: "border-emerald-500/30",
      iconColor: "text-emerald-400",
      activeTabBg: "bg-emerald-500/20",
      activeTabBorder: "border-emerald-500/40",
      activeTabColor: "text-emerald-300",
      defaultBadgeBg: "bg-emerald-500/20",
      defaultBadgeBorder: "border-emerald-500/40",
      defaultBadgeText: "text-emerald-300",
      defaultCardBorder: "border-emerald-500/50",
      defaultCardBg: "bg-emerald-950/20",
      addButtonBg: "bg-emerald-600",
      addButtonHover: "hover:bg-emerald-500",
      accentText: "text-emerald-400",
    },
    getItems: (r) => r?.coreDNSVersions || [],
  },
  {
    id: "metricsServer",
    title: "Metrics-Server",
    badge: "Telemetry & HPA",
    description: "In-cluster resource metrics pipeline for autoscaling (HPA) and dashboard telemetry.",
    placeholder: "e.g. v0.7.2 or v0.7.1",
    labelPlaceholder: "e.g. v0.7.2 (Recommended)",
    icon: Activity,
    theme: {
      iconBg: "bg-blue-500/10",
      iconBorder: "border-blue-500/30",
      iconColor: "text-blue-400",
      activeTabBg: "bg-blue-500/20",
      activeTabBorder: "border-blue-500/40",
      activeTabColor: "text-blue-300",
      defaultBadgeBg: "bg-blue-500/20",
      defaultBadgeBorder: "border-blue-500/40",
      defaultBadgeText: "text-blue-300",
      defaultCardBorder: "border-blue-500/50",
      defaultCardBg: "bg-blue-950/20",
      addButtonBg: "bg-blue-600",
      addButtonHover: "hover:bg-blue-500",
      accentText: "text-blue-400",
    },
    getItems: (r) => r?.metricsServerVersions || [],
  },
  {
    id: "istio",
    title: "Istio Service Mesh & Gateway",
    badge: "Ingress & Mesh",
    description: "Istio control plane (istiod) and default ingress gateway proxy versions.",
    placeholder: "e.g. 1.24.2 or 1.25.0",
    labelPlaceholder: "e.g. 1.24.2 (Production)",
    icon: Shield,
    theme: {
      iconBg: "bg-indigo-500/10",
      iconBorder: "border-indigo-500/30",
      iconColor: "text-indigo-400",
      activeTabBg: "bg-indigo-500/20",
      activeTabBorder: "border-indigo-500/40",
      activeTabColor: "text-indigo-300",
      defaultBadgeBg: "bg-indigo-500/20",
      defaultBadgeBorder: "border-indigo-500/40",
      defaultBadgeText: "text-indigo-300",
      defaultCardBorder: "border-indigo-500/50",
      defaultCardBg: "bg-indigo-950/20",
      addButtonBg: "bg-indigo-600",
      addButtonHover: "hover:bg-indigo-500",
      accentText: "text-indigo-400",
    },
    getItems: (r) => r?.istioVersions || [],
  },
];

function getCategoryImagePattern(registry: VersionRegistry | null, catId: VersionCategory): string {
  if (!registry?.imagePatterns) return "";
  return (registry.imagePatterns as any)[catId] || "";
}

export const VersionRegistryManager: React.FC<Props> = ({ initialRegistry, isAdmin }) => {
  const [registry, setRegistry] = useState<VersionRegistry | null>(initialRegistry || null);
  const [loading, setLoading] = useState<boolean>(!initialRegistry);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [mainTab, setMainTab] = useState<"versions" | "images">("versions");

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (window.location.hash === "#images" || window.location.search.includes("tab=images")) {
        setMainTab("images");
      }
    }
  }, []);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalType, setModalType] = useState<VersionCategory>("k8s");
  const [versionInput, setVersionInput] = useState<string>("");
  const [labelInput, setLabelInput] = useState<string>("");
  const [imageInput, setImageInput] = useState<string>("");
  const [tagInput, setTagInput] = useState<VersionTag>("stable");
  const [notesInput, setNotesInput] = useState<string>("");
  const [isDefaultInput, setIsDefaultInput] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Edit Container Image Pattern State
  const [patternModalType, setPatternModalType] = useState<VersionCategory | null>(null);
  const [patternInput, setPatternInput] = useState<string>("");
  const [savingPattern, setSavingPattern] = useState<boolean>(false);

  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ type: VersionCategory; version: string } | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Import Manifest State
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importManifestText, setImportManifestText] = useState<string>("");
  const [importing, setImporting] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Clear Registry State
  const [isClearModalOpen, setIsClearModalOpen] = useState<boolean>(false);
  const [clearing, setClearing] = useState<boolean>(false);

  const openEditPatternModal = (catId: VersionCategory) => {
    setPatternModalType(catId);
    setPatternInput(getCategoryImagePattern(registry, catId));
    setError(null);
  };

  const handleSavePattern = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patternModalType) return;
    setSavingPattern(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setImagePattern",
          type: patternModalType,
          pattern: patternInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update container image pattern");
      }
      setRegistry(data.data);
      setPatternModalType(null);
      const catMeta = CATEGORIES.find((c) => c.id === patternModalType);
      setSuccessMsg(`Container image pattern updated for ${catMeta?.title || patternModalType}.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || "Failed to update container image pattern");
    } finally {
      setSavingPattern(false);
    }
  };

  const handleExportYaml = async () => {
    try {
      const res = await fetch("/api/admin/versions/import");
      if (!res.ok) throw new Error("Failed to export version registry");
      const yamlBlob = await res.blob();
      const url = window.URL.createObjectURL(yamlBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "version-registry.yaml";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setSuccessMsg("Version registry manifest exported as YAML!");
    } catch (err: any) {
      setError(err.message || "Failed to export version registry");
    }
  };

  const handleImportManifest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importManifestText.trim()) {
      setImportError("Please provide YAML or JSON manifest content");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/admin/versions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: importManifestText }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to import version registry");
      }
      setRegistry(data.data);
      setIsImportModalOpen(false);
      setImportManifestText("");
      setSuccessMsg("Version registry manifest imported successfully!");
    } catch (err: any) {
      setImportError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setImportManifestText(content);
        setImportError(null);
      }
    };
    reader.onerror = () => {
      setImportError("Failed to read file");
    };
    reader.readAsText(file);
  };

  const handleClearRegistry = async () => {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/versions/clear", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to clear version registry");
      }
      setRegistry(data.data);
      setIsClearModalOpen(false);
      setSuccessMsg("Version registry cleared. Virtual cluster provisioning is disabled until core versions are imported.");
    } catch (err: any) {
      setError(err.message || "Failed to clear version registry");
    } finally {
      setClearing(false);
    }
  };

  const fetchRegistry = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/versions");
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch version registry");
      }
      setRegistry(data.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialRegistry) {
      fetchRegistry();
    }
  }, []);

  const openAddModal = (type: VersionCategory) => {
    setModalType(type);
    setVersionInput("");
    setLabelInput("");
    setImageInput("");
    setTagInput("stable");
    setNotesInput("");
    setIsDefaultInput(false);
    setIsModalOpen(true);
    setError(null);
    setSuccessMsg(null);
  };

  const handleSaveVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionInput.trim()) {
      setError("Version identifier is required (e.g. v1.33.0 or 3.6.8-0)");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        action: "add",
        type: modalType,
        item: {
          version: versionInput.trim(),
          label: labelInput.trim() || versionInput.trim(),
          tag: isDefaultInput ? "default" : tagInput,
          isDefault: isDefaultInput,
          notes: notesInput.trim(),
          image: imageInput.trim() || undefined,
        },
      };

      const res = await fetch("/api/admin/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save version");
      }

      setRegistry(data.data);
      setIsModalOpen(false);
      const catMeta = CATEGORIES.find((c) => c.id === modalType);
      setSuccessMsg(`Version ${versionInput.trim()} registered successfully in ${catMeta?.title || modalType}.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (type: VersionCategory, version: string) => {
    try {
      setError(null);
      const res = await fetch("/api/admin/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setDefault",
          type,
          version,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to set default version");
      }

      setRegistry(data.data);
      const catMeta = CATEGORIES.find((c) => c.id === type);
      setSuccessMsg(`Set ${version} as the active default for ${catMeta?.title || type}.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/versions?type=${deleteTarget.type}&version=${encodeURIComponent(deleteTarget.version)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete version");
      }

      setRegistry(data.data);
      const deletedVer = deleteTarget.version;
      setDeleteTarget(null);
      setSuccessMsg(`Version ${deletedVer} removed from registry.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const getTagBadge = (tag?: VersionTag, isDefault?: boolean, customBadgeClass?: string) => {
    if (isDefault || tag === "default") {
      return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${customBadgeClass || "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"}`}>
          <Star className="w-3 h-3 fill-current" />
          Default
        </span>
      );
    }
    switch (tag) {
      case "lts":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
            LTS
          </span>
        );
      case "preview":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Preview
          </span>
        );
      case "deprecated":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
            Deprecated
          </span>
        );
      case "stable":
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Stable
          </span>
        );
    }
  };

  const activeCategoryMeta = CATEGORIES.find((c) => c.id === modalType) || CATEGORIES[0];
  const displayedCategories = activeTab === "all" ? CATEGORIES : CATEGORIES.filter((c) => c.id === activeTab);

  const missingCore: string[] = [];
  if (registry) {
    if (!registry.kubernetesVersions || registry.kubernetesVersions.length === 0) {
      missingCore.push("Kubernetes Control Plane");
    }
    if (!registry.vclusterVersions || registry.vclusterVersions.length === 0) {
      missingCore.push("vCluster Syncer Engine");
    }
    if (!registry.etcdVersions || registry.etcdVersions.length === 0) {
      missingCore.push("etcd Backing Store");
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-cyber-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400 shadow-glow-sm">
              {mainTab === "images" ? <Globe className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {mainTab === "images" ? "Container Image Registry & Swapper" : "Version Registry"}
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* View Switcher */}
          <div className="flex items-center gap-1.5 p-1 bg-cyber-950 border border-cyber-800 rounded-xl text-xs font-mono">
            <button
              onClick={() => {
                setMainTab("versions");
                if (typeof window !== "undefined") window.location.hash = "#versions";
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                mainTab === "versions"
                  ? "bg-cyber-800 text-white font-semibold border border-cyber-700 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Component Versions
            </button>
            <button
              onClick={() => {
                setMainTab("images");
                if (typeof window !== "undefined") window.location.hash = "#images";
              }}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                mainTab === "images"
                  ? "bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              Images & Air-Gap Registry
            </button>
          </div>

          {mainTab === "versions" && (
            <button
              onClick={handleExportYaml}
              className="px-3 py-1.5 bg-cyber-900 hover:bg-cyber-850 text-slate-300 hover:text-white text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-all shadow-sm"
              title="Export Version Registry as YAML"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              Export YAML
            </button>
          )}

          {mainTab === "versions" && isAdmin && (
            <>
              <button
                onClick={() => {
                  setImportManifestText("");
                  setImportError(null);
                  setIsImportModalOpen(true);
                }}
                className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-xs font-mono rounded-xl flex items-center gap-1.5 transition-all shadow-sm"
                title="Import Version Registry or Platform YAML/JSON manifest"
              >
                <Upload className="w-3.5 h-3.5 text-purple-400" />
                Import Manifest
              </button>

              <button
                onClick={() => setIsClearModalOpen(true)}
                className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/30 text-xs font-mono rounded-xl flex items-center gap-1.5 transition-all"
                title="Clear all versions from registry"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                Clear
              </button>

              <button
                onClick={() => openAddModal("k8s")}
                className="px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-glow-sm transition-all flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Register Version
              </button>
            </>
          )}
          {mainTab === "versions" && (
            <button
              onClick={fetchRegistry}
              disabled={loading}
              className="px-3 py-1.5 bg-cyber-900 hover:bg-cyber-850 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 flex items-center gap-2 transition-all disabled:opacity-50"
              title="Reload from Kubernetes ConfigMap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Sync
            </button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 text-xs flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Missing Core Component Alert */}
      {!loading && mainTab === "versions" && missingCore.length > 0 && (
        <div className="p-4 bg-rose-950/40 border border-rose-500/40 rounded-2xl text-rose-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in shadow-lg shadow-rose-950/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0 mt-0.5">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold font-mono text-rose-200">
                Core Components Missing — Virtual Cluster Provisioning Blocked
              </h4>
              <p className="text-[11px] text-rose-300/80 mt-0.5 font-mono">
                No versions registered for: <strong className="text-white">{missingCore.join(", ")}</strong>.
                Users cannot deploy virtual clusters until versions are imported or registered.
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => {
                setImportManifestText("");
                setImportError(null);
                setIsImportModalOpen(true);
              }}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs font-mono rounded-xl shadow-lg flex items-center gap-2 shrink-0 transition-all"
            >
              <Upload className="w-4 h-4" />
              Quick Import Manifest
            </button>
          )}
        </div>
      )}

      {mainTab === "images" ? (
        <ImageRegistryManager isAdmin={isAdmin} />
      ) : (
        <>
          {/* Quick Component Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const items = cat.getItems(registry);
          const defaultItem = items.find((v) => v.isDefault) || items[0];
          const isSelected = activeTab === cat.id;

          return (
            <div
              key={cat.id}
              onClick={() => setActiveTab(isSelected ? "all" : cat.id)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? `${cat.theme.activeTabBg} ${cat.theme.activeTabBorder} shadow-glow-sm`
                  : "bg-cyber-900/60 border-cyber-800/80 hover:border-cyber-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className={`p-1.5 rounded-lg border ${cat.theme.iconBg} ${cat.theme.iconBorder} ${cat.theme.iconColor}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {items.length} ver
                </span>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 truncate">
                  {cat.title}
                </div>
                <div className="text-sm font-mono font-bold text-white truncate mt-0.5">
                  {defaultItem?.version || "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-cyber-950 border border-cyber-800 rounded-xl text-xs font-mono">
        <button
          onClick={() => setActiveTab("all")}
          className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
            activeTab === "all"
              ? "bg-cyber-800 text-white font-semibold border border-cyber-700 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          All Components ({CATEGORIES.reduce((acc, c) => acc + c.getItems(registry).length, 0)})
        </button>
        {CATEGORIES.map((cat) => {
          const count = cat.getItems(registry).length;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveTab(cat.id)}
              className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === cat.id
                  ? `${cat.theme.activeTabBg} ${cat.theme.activeTabColor} font-semibold border ${cat.theme.activeTabBorder}`
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>{cat.title}</span>
              <span className="text-[10px] opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Category Sections */}
      <div className="space-y-8">
        {displayedCategories.map((cat) => {
          const Icon = cat.icon;
          const items = cat.getItems(registry);

          return (
            <div
              key={cat.id}
              className="bg-cyber-900/80 border border-cyber-700/70 rounded-2xl p-6 shadow-xl space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-cyber-800">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl border ${cat.theme.iconBg} ${cat.theme.iconBorder} ${cat.theme.iconColor}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      {cat.title}
                      <span className={`text-[10px] font-mono font-normal px-2 py-0.5 rounded-full border ${cat.theme.iconBg} ${cat.theme.iconBorder} ${cat.theme.iconColor}`}>
                        {cat.badge}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {cat.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] font-mono">
                      <span className="text-slate-500">Container Image Pattern:</span>
                      {getCategoryImagePattern(registry, cat.id) ? (
                        <code className="text-cyan-300 bg-cyber-950/80 px-2 py-0.5 rounded border border-cyber-750">
                          {getCategoryImagePattern(registry, cat.id)}
                        </code>
                      ) : (
                        <span className="text-amber-400/90 italic font-sans text-xs">
                          Not configured (import from manifest)
                        </span>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => openEditPatternModal(cat.id)}
                          className="text-cyan-400 hover:text-cyan-300 font-sans text-[11px] underline ml-1 cursor-pointer transition-colors"
                        >
                          Edit Pattern
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {isAdmin && (
                  <button
                    onClick={() => openAddModal(cat.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-slate-950 font-semibold text-xs font-mono rounded-xl shadow-glow-sm transition-all shrink-0 ${cat.theme.addButtonBg} ${cat.theme.addButtonHover}`}
                  >
                    <Plus className="w-4 h-4" />
                    Add {cat.title.split(" ")[0]} Version
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="p-8 rounded-xl border border-dashed border-cyber-800 bg-cyber-950/40 text-center space-y-3">
                  <div className="w-10 h-10 mx-auto rounded-xl bg-cyber-800/80 border border-cyber-700 flex items-center justify-center text-slate-500">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-slate-300">No versions registered</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      No release versions currently registered for {cat.title}.
                    </p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center justify-center gap-3 pt-2">
                      <button
                        onClick={() => openAddModal(cat.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-slate-950 font-bold text-xs font-mono rounded-lg transition-all ${cat.theme.addButtonBg} ${cat.theme.addButtonHover}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Register Version
                      </button>
                      <button
                        onClick={() => {
                          setImportManifestText("");
                          setImportError(null);
                          setIsImportModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-lg border border-cyber-700 transition-all"
                      >
                        <Upload className="w-3.5 h-3.5 text-purple-400" />
                        Import Manifest
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((item) => (
                    <div
                      key={item.version}
                      className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                        item.isDefault
                          ? `${cat.theme.defaultCardBg} ${cat.theme.defaultCardBorder} shadow-glow-sm`
                          : "bg-cyber-850/80 border-cyber-800 hover:border-cyber-700"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-sm font-mono font-bold text-white flex items-center gap-1.5">
                            {item.version}
                          </span>
                          {getTagBadge(
                            item.tag,
                            item.isDefault,
                            `${cat.theme.defaultBadgeBg} ${cat.theme.defaultBadgeText} ${cat.theme.defaultBadgeBorder}`
                          )}
                        </div>

                        <div className="text-xs font-semibold text-slate-300 mb-1">
                          {item.label || item.version}
                        </div>

                        {item.notes && (
                          <p className="text-[11px] text-slate-400 font-mono line-clamp-2 mt-1">
                            {item.notes}
                          </p>
                        )}

                        {item.image && (
                          <div className="mt-2 text-[10px] font-mono text-cyan-400/90 truncate bg-cyber-950/70 px-2 py-0.5 rounded border border-cyber-800">
                            <span className="text-slate-500 mr-1">Image:</span>
                            <span title={item.image}>{item.image}</span>
                          </div>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="mt-4 pt-3 border-t border-cyber-800/80 flex items-center justify-between gap-2">
                          {!item.isDefault ? (
                            <button
                              type="button"
                              onClick={() => handleSetDefault(cat.id, item.version)}
                              className={`text-[11px] font-mono ${cat.theme.accentText} hover:brightness-125 flex items-center gap-1 transition-colors`}
                            >
                              <Star className="w-3.5 h-3.5" />
                              Set Default
                            </button>
                          ) : (
                            <span className={`text-[11px] font-mono ${cat.theme.accentText} flex items-center gap-1`}>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active Default
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ type: cat.id, version: item.version })}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                            title="Remove version from registry"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  )}

      {/* MODAL: Add Version */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-cyan-400" />
                  Add Component Version
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Register a supported release tag for automated deployment and rolling upgrades.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVersion} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Target Component <span className="text-rose-400">*</span>
                </label>
                <select
                  value={modalType}
                  onChange={(e) => setModalType(e.target.value as VersionCategory)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.badge})
                    </option>
                  ))}
                </select>
                <p className="text-[10px] font-mono text-slate-500 mt-1">
                  Container Image Pattern:{" "}
                  {getCategoryImagePattern(registry, modalType) ? (
                    <code className="text-cyan-300">{getCategoryImagePattern(registry, modalType)}</code>
                  ) : (
                    <span className="text-amber-400 italic font-sans">None configured (manifest import recommended)</span>
                  )}
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Version Identifier <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={activeCategoryMeta.placeholder}
                  value={versionInput}
                  onChange={(e) => setVersionInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Container Image Override <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder={
                    getCategoryImagePattern(registry, modalType)
                      ? getCategoryImagePattern(registry, modalType).replace("<tag>", versionInput.trim() || "tag")
                      : "e.g. custom-registry.io/component:tag"
                  }
                  value={imageInput}
                  onChange={(e) => setImageInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
                <p className="text-[10px] font-mono text-slate-500 mt-1">
                  Leave empty to inherit pattern: <code className="text-slate-400">{getCategoryImagePattern(registry, modalType) || "(not configured)"}</code>
                </p>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Display Label
                </label>
                <input
                  type="text"
                  placeholder={activeCategoryMeta.labelPlaceholder}
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Release Channel / Classification
                </label>
                <select
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value as VersionTag)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="stable">Stable</option>
                  <option value="lts">Long-Term Support (LTS)</option>
                  <option value="preview">Preview / Experimental</option>
                  <option value="deprecated">Deprecated</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Description / Release Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional details, compatibility guidance, or notable features..."
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefaultInput}
                    onChange={(e) => setIsDefaultInput(e.target.checked)}
                    className="w-4 h-4 rounded border-cyber-700 bg-cyber-950 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300">
                    Set as active default version for newly provisioned clusters
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-cyber-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-glow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Register Version
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Confirm Delete */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-cyber-900 border border-cyber-700 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-rose-500/10 rounded-xl border border-rose-500/30 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Remove Version?</h3>
                <p className="text-xs text-slate-400">This will remove the version from future creation & upgrade selectors.</p>
              </div>
            </div>

            <p className="text-xs font-mono text-slate-300 bg-cyber-950 p-3 rounded-xl border border-cyber-800 mb-5">
              Removing: <span className="font-bold text-white">{deleteTarget.version}</span> (
              {CATEGORIES.find((c) => c.id === deleteTarget.type)?.title || deleteTarget.type})
            </p>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Import Manifest */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700 rounded-3xl shadow-2xl p-6 sm:p-7 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-cyber-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/30 text-purple-400">
                  <Upload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Import Version Registry Manifest
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Upload or paste a YAML / JSON manifest or platform configuration file.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {importError && (
              <div className="mt-4 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{importError}</span>
              </div>
            )}

            <form onSubmit={handleImportManifest} className="mt-4 flex-1 flex flex-col space-y-4 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-mono text-slate-300 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-purple-400" />
                  Manifest Content (YAML / JSON)
                </label>
                <div className="flex items-center gap-2">
                  <label className="px-2.5 py-1 bg-cyber-800 hover:bg-cyber-750 text-slate-300 hover:text-white text-[11px] font-mono rounded-lg border border-cyber-700 cursor-pointer transition-colors flex items-center gap-1.5">
                    <Upload className="w-3 h-3 text-cyan-400" />
                    <span>Upload File</span>
                    <input
                      type="file"
                      accept=".yaml,.yml,.json"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setImportManifestText(`# VCOP Platform Version Registry Manifest
versionRegistry:
  # Container Image Patterns (Never hardcoded; can point to private registries/air-gap)
  imagePatterns:
    k8s: "registry.k8s.io/kube-apiserver:<tag>"
    vcluster: "ghcr.io/loft-sh/vcluster:<tag>"
    etcd: "registry.k8s.io/etcd:<tag>"
    coredns: "registry.k8s.io/coredns/coredns:<tag>"
    metricsServer: "registry.k8s.io/metrics-server/metrics-server:<tag>"
    istio: "docker.io/istio/pilot:<tag>"

  kubernetesVersions:
    - version: "v1.31.0"
      label: "v1.31.0 (Latest Default)"
      tag: "stable"
      isDefault: true
      notes: "Default Kubernetes GA release"
    - version: "v1.30.4"
      label: "v1.30.4 (Enterprise LTS)"
      tag: "lts"
      isDefault: false
      notes: "Hardened enterprise LTS release"
  vclusterVersions:
    - version: "0.36.0"
      label: "0.36.0 (Recommended Core)"
      tag: "stable"
      isDefault: true
      notes: "High performance syncer core"
    - version: "0.35.2"
      label: "0.35.2 (Previous Stable)"
      tag: "lts"
      isDefault: false
  etcdVersions:
    - version: "3.6.8-0"
      label: "3.6.8-0 (Production SSD)"
      tag: "stable"
      isDefault: true
      notes: "High throughput key-value backing store"
    - version: "3.5.15-0"
      label: "3.5.15-0 (Long-Term Stable)"
      tag: "lts"
      isDefault: false
  coreDNSVersions:
    - version: "v1.11.3"
      label: "v1.11.3 (Default DNS)"
      tag: "stable"
      isDefault: true
  metricsServerVersions:
    - version: "v0.7.2"
      label: "v0.7.2 (Default HPA Telemetry)"
      tag: "stable"
      isDefault: true
  istioVersions:
    - version: "1.24.2"
      label: "1.24.2 (Production Gateway)"
      tag: "stable"
      isDefault: true
`);
                      setImportError(null);
                    }}
                    className="px-2.5 py-1 bg-cyber-800 hover:bg-cyber-750 text-cyan-400 text-[11px] font-mono rounded-lg border border-cyber-700 transition-colors"
                  >
                    Load Default Template
                  </button>
                </div>
              </div>

              <textarea
                value={importManifestText}
                onChange={(e) => setImportManifestText(e.target.value)}
                placeholder="Paste platform-manifest.yaml, Kubernetes ConfigMap, or versions JSON/YAML here..."
                rows={12}
                className="w-full flex-1 bg-cyber-950 border border-cyber-700 rounded-xl p-3 text-xs font-mono text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500 font-mono resize-none leading-relaxed"
                required
              />

              <div className="flex items-center justify-between pt-3 border-t border-cyber-800">
                <p className="text-[11px] font-mono text-slate-500">
                  Supports unified <code className="text-slate-400">platform-manifest.yaml</code>, ConfigMaps, or version lists.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(false)}
                    className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={importing || !importManifestText.trim()}
                    className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs font-mono rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>Import Manifest</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Clear All Versions Confirmation */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-cyber-900 border border-rose-500/40 rounded-3xl shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-rose-500/20 rounded-xl border border-rose-500/30 text-rose-400">
                <AlertOctagon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Clear Entire Version Registry?</h3>
                <p className="text-xs text-rose-300/80">High-Impact Platform Action</p>
              </div>
            </div>

            <p className="text-xs font-mono text-slate-300 bg-cyber-950 p-4 rounded-xl border border-cyber-800 mb-5 leading-relaxed">
              This action will purge all registered versions across Kubernetes, vCluster, etcd, CoreDNS, Metrics-Server, and Istio.
              <br /><br />
              <strong className="text-rose-400">Warning:</strong> Virtual cluster provisioning will be immediately blocked across the platform until an administrator imports a new platform manifest.
            </p>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsClearModalOpen(false)}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearRegistry}
                disabled={clearing}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {clearing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Yes, Clear All Versions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Configure Container Image Pattern */}
      {patternModalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-cyber-900 border border-cyber-700 rounded-3xl shadow-2xl p-6 sm:p-7">
            <div className="flex items-center justify-between pb-4 border-b border-cyber-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30 text-cyan-400">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Container Image Pattern
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure container image pattern for {CATEGORIES.find((c) => c.id === patternModalType)?.title}.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPatternModalType(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePattern} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Target Component
                </label>
                <div className="text-xs font-mono text-cyan-300 bg-cyber-950 border border-cyber-800 px-3 py-2 rounded-xl">
                  {CATEGORIES.find((c) => c.id === patternModalType)?.title} ({CATEGORIES.find((c) => c.id === patternModalType)?.badge})
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">
                  Container Image Pattern
                </label>
                <input
                  type="text"
                  placeholder="e.g. registry.k8s.io/kube-apiserver:<tag> or harbor.corp.internal/vcluster:<tag>"
                  value={patternInput}
                  onChange={(e) => setPatternInput(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
                />
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  Use <code className="text-cyan-300 bg-cyber-800 px-1 py-0.5 rounded">&lt;tag&gt;</code> as a placeholder for the version identifier. This pattern allows air-gapped or private registry redirects without hardcoded paths.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-cyber-800">
                <button
                  type="button"
                  onClick={() => setPatternModalType(null)}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-mono rounded-xl border border-cyber-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPattern}
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono rounded-xl shadow-glow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {savingPattern ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Save Pattern</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
