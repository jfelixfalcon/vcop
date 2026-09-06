import React, { useState, useEffect } from 'react';
import {
  X,
  Package,
  Layers,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Sliders,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  Sparkles,
  Check,
  ExternalLink,
  Shield,
  Activity,
  Database,
  Network,
  Box,
  Terminal,
  ArrowRight,
} from 'lucide-react';
import type {
  VirtualCluster,
  AppStoreCatalog,
  AppDefinition,
  AppGroup,
  InstalledApp,
  AppCategory,
} from '../lib/types';

interface Props {
  cluster: VirtualCluster | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedApps: InstalledApp[]) => void;
  initialTab?: 'catalog' | 'direct' | 'add-app' | 'create-group';
}

const CATEGORIES: AppCategory[] = [
  'Network & Ingress',
  'Observability',
  'Storage & Database',
  'Security & Auth',
  'Developer Tools',
];

export const InstallAppModal: React.FC<Props> = ({
  cluster,
  isOpen,
  onClose,
  onSuccess,
  initialTab = 'catalog',
}) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'direct' | 'add-app' | 'create-group'>(initialTab);
  const [catalog, setCatalog] = useState<AppStoreCatalog | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Catalog Tab State
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [customValuesMap, setCustomValuesMap] = useState<Record<string, string>>({});
  const [expandedValueAppId, setExpandedValueAppId] = useState<string | null>(null);

  // Direct / Custom Deployment Form State
  const [directName, setDirectName] = useState<string>('');
  const [directId, setDirectId] = useState<string>('');
  const [directCategory, setDirectCategory] = useState<AppCategory>('Developer Tools');
  const [directVersion, setDirectVersion] = useState<string>('1.0.0');
  const [directDesc, setDirectDesc] = useState<string>('');
  const [directHasHelm, setDirectHasHelm] = useState<boolean>(true);
  const [directHelmRepo, setDirectHelmRepo] = useState<string>('');
  const [directHelmChart, setDirectHelmChart] = useState<string>('');
  const [directHelmRelease, setDirectHelmRelease] = useState<string>('');
  const [directHelmNamespace, setDirectHelmNamespace] = useState<string>('default');
  const [directHelmValues, setDirectHelmValues] = useState<string>('');
  const [directHasManifests, setDirectHasManifests] = useState<boolean>(false);
  const [directManifests, setDirectManifests] = useState<string>('');
  const [directSaveToStore, setDirectSaveToStore] = useState<boolean>(true);

  // Add App to Store Form State
  const [storeAppId, setStoreAppId] = useState<string>('');
  const [storeAppName, setStoreAppName] = useState<string>('');
  const [storeAppCategory, setStoreAppCategory] = useState<AppCategory>('Developer Tools');
  const [storeAppVersion, setStoreAppVersion] = useState<string>('1.0.0');
  const [storeAppDesc, setStoreAppDesc] = useState<string>('');
  const [storeHasHelm, setStoreHasHelm] = useState<boolean>(true);
  const [storeHelmRepo, setStoreHelmRepo] = useState<string>('');
  const [storeHelmName, setStoreHelmName] = useState<string>('');
  const [storeHelmRelease, setStoreHelmRelease] = useState<string>('');
  const [storeHelmNamespace, setStoreHelmNamespace] = useState<string>('default');
  const [storeHelmValues, setStoreHelmValues] = useState<string>('');
  const [storeHasManifests, setStoreHasManifests] = useState<boolean>(false);
  const [storeManifests, setStoreManifests] = useState<string>('');

  // Create Group Form State
  const [groupName, setGroupName] = useState<string>('');
  const [groupId, setGroupId] = useState<string>('');
  const [groupDesc, setGroupDesc] = useState<string>('');
  const [groupAppIds, setGroupAppIds] = useState<string[]>([]);

  const fetchCatalog = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/appstore');
      const data = await res.json();
      if (data.success && data.data) {
        setCatalog(data.data);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load App Store catalog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setError(null);
      setSelectedAppIds([]);
      setCustomValuesMap({});
      setExpandedValueAppId(null);
      fetchCatalog();
    }
  }, [isOpen, initialTab]);

  if (!isOpen || !cluster) return null;

  const installedAppIds = new Set((cluster.metadata?.installedApps || []).map((a) => a.appId));
  const availableApps = (catalog?.apps || []).filter((app) => !installedAppIds.has(app.id));
  const groups = catalog?.groups || [];

  // Toggle app selection in Catalog tab
  const handleToggleApp = (app: AppDefinition) => {
    if (selectedAppIds.includes(app.id)) {
      setSelectedAppIds(selectedAppIds.filter((id) => id !== app.id));
    } else {
      setSelectedAppIds([...selectedAppIds, app.id]);
      if (app.helm?.values && !customValuesMap[app.id]) {
        setCustomValuesMap((prev) => ({ ...prev, [app.id]: app.helm!.values! }));
      }
    }
  };

  // Select group in Catalog tab
  const handleSelectGroup = (group: AppGroup) => {
    const newSelected = new Set(selectedAppIds);
    for (const id of group.appIds) {
      if (!installedAppIds.has(id)) {
        newSelected.add(id);
        const appObj = catalog?.apps.find((a) => a.id === id);
        if (appObj?.helm?.values && !customValuesMap[id]) {
          setCustomValuesMap((prev) => ({ ...prev, [id]: appObj.helm!.values! }));
        }
      }
    }
    setSelectedAppIds(Array.from(newSelected));
  };

  // Deploy selected Catalog apps
  const handleInstallCatalogApps = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAppIds.length === 0) {
      setError('Please select at least one application to install');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        namespace: cluster.namespace,
        apps: selectedAppIds.map((id) => ({
          appId: id,
          customValues: customValuesMap[id],
        })),
      };

      const res = await fetch(`/api/vclusters/${cluster.name}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to install applications');
      }

      onSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to install applications');
    } finally {
      setSubmitting(false);
    }
  };

  // Deploy direct / custom application on the fly
  const handleDeployDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directName.trim()) {
      setError('Application Name is required');
      return;
    }
    if (!directHasHelm && !directHasManifests) {
      setError('Please provide at least a Helm Chart or Kubernetes Manifests');
      return;
    }

    const calculatedId = (directId.trim() || directName.trim())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    setSubmitting(true);
    setError(null);

    try {
      const appDef: AppDefinition = {
        id: calculatedId,
        name: directName.trim(),
        description: directDesc.trim() || `Custom application deployed to ${cluster.name}`,
        category: directCategory,
        version: directVersion.trim() || '1.0.0',
        tags: ['custom', directCategory.toLowerCase().replace(/[^a-z0-9]/g, '-')],
        helm: directHasHelm && directHelmChart.trim()
          ? {
              repo: directHelmRepo.trim(),
              name: directHelmChart.trim(),
              releaseName: directHelmRelease.trim() || directHelmChart.trim(),
              namespace: directHelmNamespace.trim() || 'default',
              values: directHelmValues,
            }
          : undefined,
        manifests: directHasManifests && directManifests.trim() ? directManifests.trim() : undefined,
      };

      // 1. Save to App Store if checkbox is checked
      if (directSaveToStore) {
        await fetch('/api/appstore/apps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appDef),
        });
      }

      // 2. Deploy directly to the cluster
      const payload = {
        namespace: cluster.namespace,
        apps: [
          {
            appId: appDef.id,
            name: appDef.name,
            version: appDef.version,
            category: appDef.category,
            customValues: appDef.helm?.values,
            helm: appDef.helm,
            manifests: appDef.manifests,
          },
        ],
      };

      const res = await fetch(`/api/vclusters/${cluster.name}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to deploy application to cluster');
      }

      onSuccess(data.data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to deploy custom workload');
    } finally {
      setSubmitting(false);
    }
  };

  // Add App directly to Store Catalog
  const handleSaveAppToStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeAppName.trim()) {
      setError('Application Name is required');
      return;
    }
    if (!storeHasHelm && !storeHasManifests) {
      setError('Please provide at least a Helm Chart or Kubernetes Manifests');
      return;
    }

    const calculatedId = (storeAppId.trim() || storeAppName.trim())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    setSubmitting(true);
    setError(null);

    try {
      const payload: AppDefinition = {
        id: calculatedId,
        name: storeAppName.trim(),
        description: storeAppDesc.trim(),
        category: storeAppCategory,
        version: storeAppVersion.trim() || '1.0.0',
        tags: [storeAppCategory.toLowerCase().replace(/[^a-z0-9]/g, '-')],
        helm: storeHasHelm && storeHelmName.trim()
          ? {
              repo: storeHelmRepo.trim(),
              name: storeHelmName.trim(),
              releaseName: storeHelmRelease.trim() || storeHelmName.trim(),
              namespace: storeHelmNamespace.trim() || 'default',
              values: storeHelmValues,
            }
          : undefined,
        manifests: storeHasManifests && storeManifests.trim() ? storeManifests.trim() : undefined,
      };

      const res = await fetch('/api/appstore/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save application');
      }

      await fetchCatalog();
      setSelectedAppIds([calculatedId]);
      setActiveTab('catalog');
    } catch (err: any) {
      setError(err.message || 'Failed to save application to store');
    } finally {
      setSubmitting(false);
    }
  };

  // Create App Group
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setError('Group Name is required');
      return;
    }

    const calculatedId = (groupId.trim() || groupName.trim())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    setSubmitting(true);
    setError(null);

    try {
      const payload: AppGroup = {
        id: calculatedId,
        name: groupName.trim(),
        description: groupDesc.trim(),
        icon: 'Layers',
        appIds: groupAppIds,
      };

      const res = await fetch('/api/appstore/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save group');
      }

      await fetchCatalog();
      setActiveTab('catalog');
    } catch (err: any) {
      setError(err.message || 'Failed to save group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Deploy Applications 
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Target Cluster: <span className="font-mono text-cyan-400 font-semibold">{cluster.name}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-cyber-800 pb-3 mb-4 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'catalog'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-glow-sm'
                : 'bg-cyber-950 text-slate-400 hover:text-white border border-cyber-800'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>App Store Catalog</span>
            {catalog?.apps?.length ? (
              <span className="text-[10px] bg-cyan-950/80 text-cyan-300 px-1.5 rounded-full ml-0.5">
                {catalog.apps.length}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('direct')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'direct'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-glow-sm'
                : 'bg-cyber-950 text-slate-400 hover:text-white border border-cyber-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Deploy Custom App</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('add-app')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'add-app'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-glow-sm'
                : 'bg-cyber-950 text-slate-400 hover:text-white border border-cyber-800'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Add App to Store</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('create-group')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'create-group'
                ? 'bg-purple-500 text-slate-950 font-bold shadow-glow-sm'
                : 'bg-cyber-950 text-purple-300 hover:text-white border border-cyber-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>+ Create Group</span>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* TAB 1: BROWSE APP STORE CATALOG */}
        {activeTab === 'catalog' && (
          <>
            {loading ? (
              <div className="py-16 text-center text-slate-500 font-mono text-xs">
                Loading available applications from App Store...
              </div>
            ) : (catalog?.apps || []).length === 0 ? (
              <div className="py-8 text-center bg-cyber-950/60 rounded-2xl border border-dashed border-cyber-800 p-6 space-y-4">
                <Package className="w-10 h-10 text-slate-600 mx-auto" />
                <div>
                  <h4 className="text-sm font-bold text-white">App Store is Clean & Empty</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    No applications or  exist yet. Deploy a custom app directly to this cluster, or publish your first app or group right now!
                  </p>
                </div>

                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('direct')}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Terminal className="w-4 h-4" />
                    Deploy Custom App on the Fly
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('add-app')}
                    className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-white font-semibold text-xs rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    + Add App to Store
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('create-group')}
                    className="px-4 py-2 bg-purple-950 hover:bg-purple-900 text-purple-300 font-semibold text-xs rounded-xl border border-purple-800 flex items-center gap-1.5 transition-all"
                  >
                    <Layers className="w-4 h-4" />
                    + Create App Group
                  </button>
                </div>
              </div>
            ) : availableApps.length === 0 ? (
              <div className="py-12 text-center bg-cyber-950/60 rounded-2xl border border-cyber-800 p-6 space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <h4 className="text-sm font-bold text-white">All Store Applications Installed</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  All applications currently in the catalog are deployed to {cluster.name}. You can deploy an additional custom workload anytime.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('direct')}
                    className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm inline-flex items-center gap-1.5"
                  >
                    <Terminal className="w-4 h-4" />
                    Deploy Custom App / Workload
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInstallCatalogApps} className="overflow-y-auto space-y-5 flex-1 pr-1">
                {/* Curated Groups Quick Select */}
                {groups.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-2 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-purple-400" />
                      <span>One-Click Application :</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {groups.map((grp) => {
                        const uninstalledInGroup = grp.appIds.filter((id) => !installedAppIds.has(id));
                        if (uninstalledInGroup.length === 0) return null;

                        const isAllSelected = uninstalledInGroup.every((id) => selectedAppIds.includes(id));

                        return (
                          <div
                            key={grp.id}
                            onClick={() => handleSelectGroup(grp)}
                            className={`p-3 rounded-xl border cursor-pointer transition-all ${
                              isAllSelected
                                ? 'bg-purple-950/40 border-purple-500/60'
                                : 'bg-cyber-950 border-cyber-800 hover:border-cyber-700'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white">{grp.name}</span>
                              <span className="text-[10px] font-mono text-purple-400">
                                {uninstalledInGroup.length} to add
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{grp.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Individual Applications Selection */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-300">
                      Select Applications to Deploy ({selectedAppIds.length} chosen):
                    </label>
                    <button
                      type="button"
                      onClick={() => setActiveTab('add-app')}
                      className="text-[11px] font-mono text-cyan-400 hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Add More Apps
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {availableApps.map((app) => {
                      const isSelected = selectedAppIds.includes(app.id);
                      const isExpanded = expandedValueAppId === app.id;

                      return (
                        <div
                          key={app.id}
                          className={`rounded-2xl border transition-all overflow-hidden ${
                            isSelected
                              ? 'bg-cyber-950 border-cyan-500/60'
                              : 'bg-cyber-950/60 border-cyber-800 hover:border-cyber-700'
                          }`}
                        >
                          <div
                            onClick={() => handleToggleApp(app)}
                            className="p-3.5 flex items-center justify-between cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                              />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-white">{app.name}</span>
                                  <span className="text-[10px] font-mono text-slate-400">v{app.version}</span>
                                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800">
                                    {app.category}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5">{app.description}</p>
                              </div>
                            </div>

                            {app.helm && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isSelected) {
                                    handleToggleApp(app);
                                  }
                                  setExpandedValueAppId(isExpanded ? null : app.id);
                                }}
                                className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyber-900 border border-cyber-800 hover:border-cyan-500/30 transition-colors shrink-0 ml-2"
                              >
                                <Sliders className="w-3 h-3" />
                                <span>{isExpanded ? 'Hide Values' : 'values.yaml'}</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                          </div>

                          {/* values.yaml Editor */}
                          {isExpanded && app.helm && (
                            <div className="p-3.5 bg-cyber-900 border-t border-cyber-800 space-y-2 animate-in fade-in duration-100">
                              <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                                <span className="flex items-center gap-1.5 text-cyan-400">
                                  <FileCode className="w-3.5 h-3.5" />
                                  values.yaml for {app.name}
                                </span>
                                <span className="text-[10px] text-slate-500">YAML Format</span>
                              </div>
                              <textarea
                                value={customValuesMap[app.id] ?? app.helm.values ?? ''}
                                onChange={(e) =>
                                  setCustomValuesMap({ ...customValuesMap, [app.id]: e.target.value })
                                }
                                rows={6}
                                className="w-full bg-cyber-950 border border-cyber-700 rounded-xl p-3 text-xs text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono leading-relaxed"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Submit Actions */}
                <div className="pt-3 border-t border-cyber-800 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || selectedAppIds.length === 0}
                    className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    <span>{submitting ? 'Installing...' : `Deploy ${selectedAppIds.length} App(s)`}</span>
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {/* TAB 2: DEPLOY CUSTOM APPLICATION ON THE FLY */}
        {activeTab === 'direct' && (
          <form onSubmit={handleDeployDirect} className="overflow-y-auto space-y-4 flex-1 pr-1">
            <div className="p-3 bg-cyan-950/30 border border-cyan-500/20 rounded-xl text-xs text-cyan-300">
              Deploy any Helm chart or raw Kubernetes YAML directly to <strong>{cluster.name}</strong>. Optionally save it to the App Store for reuse across other clusters.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Application Name *
                </label>
                <input
                  type="text"
                  value={directName}
                  onChange={(e) => {
                    setDirectName(e.target.value);
                    if (!directId) {
                      setDirectId(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                    }
                  }}
                  placeholder="e.g. RabbitMQ Cluster"
                  required
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Category *
                </label>
                <select
                  value={directCategory}
                  onChange={(e) => setDirectCategory(e.target.value as AppCategory)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  App ID / Slug (Optional)
                </label>
                <input
                  type="text"
                  value={directId}
                  onChange={(e) => setDirectId(e.target.value)}
                  placeholder="auto-generated from name"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Version
                </label>
                <input
                  type="text"
                  value={directVersion}
                  onChange={(e) => setDirectVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            {/* Workload Types Checkboxes */}
            <div className="flex items-center gap-6 p-3 bg-cyber-950 rounded-xl border border-cyber-800">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={directHasHelm}
                  onChange={(e) => setDirectHasHelm(e.target.checked)}
                  className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <span className="font-semibold">Include Helm Chart</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={directHasManifests}
                  onChange={(e) => setDirectHasManifests(e.target.checked)}
                  className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <span className="font-semibold">Include Raw YAML Manifests</span>
              </label>
            </div>

            {/* Helm Section */}
            {directHasHelm && (
              <div className="p-4 bg-cyber-950/80 border border-cyber-800 rounded-2xl space-y-3">
                <span className="text-xs font-mono font-bold text-cyan-400 flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5" />
                  Helm Chart Specification
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Repository URL *</label>
                    <input
                      type="text"
                      value={directHelmRepo}
                      onChange={(e) => setDirectHelmRepo(e.target.value)}
                      placeholder="https://charts.bitnami.com/bitnami"
                      required={directHasHelm}
                      className="w-full bg-cyber-900 border border-cyber-750 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Chart Name *</label>
                    <input
                      type="text"
                      value={directHelmChart}
                      onChange={(e) => setDirectHelmChart(e.target.value)}
                      placeholder="e.g. rabbitmq"
                      required={directHasHelm}
                      className="w-full bg-cyber-900 border border-cyber-750 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Release Name</label>
                    <input
                      type="text"
                      value={directHelmRelease}
                      onChange={(e) => setDirectHelmRelease(e.target.value)}
                      placeholder="defaults to chart name"
                      className="w-full bg-cyber-900 border border-cyber-750 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Target Namespace</label>
                    <input
                      type="text"
                      value={directHelmNamespace}
                      onChange={(e) => setDirectHelmNamespace(e.target.value)}
                      placeholder="default"
                      className="w-full bg-cyber-900 border border-cyber-750 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">values.yaml Configuration</label>
                  <textarea
                    value={directHelmValues}
                    onChange={(e) => setDirectHelmValues(e.target.value)}
                    rows={4}
                    placeholder="# Override Helm values here&#10;replicaCount: 1&#10;resources:&#10;  limits:&#10;    memory: 256Mi"
                    className="w-full bg-cyber-900 border border-cyber-750 rounded-xl p-3 text-xs text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* Manifests Section */}
            {directHasManifests && (
              <div className="p-4 bg-cyber-950/80 border border-cyber-800 rounded-2xl space-y-2">
                <span className="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  Kubernetes YAML Manifests
                </span>
                <textarea
                  value={directManifests}
                  onChange={(e) => setDirectManifests(e.target.value)}
                  rows={5}
                  placeholder="apiVersion: apps/v1&#10;kind: Deployment&#10;metadata:&#10;  name: my-app&#10;spec:&#10;  replicas: 1&#10;..."
                  className="w-full bg-cyber-900 border border-cyber-750 rounded-xl p-3 text-xs text-emerald-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-400 font-mono leading-relaxed"
                />
              </div>
            )}

            {/* Save to Store Checkbox */}
            <div className="p-3 bg-cyber-950 rounded-xl border border-cyber-800">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={directSaveToStore}
                  onChange={(e) => setDirectSaveToStore(e.target.checked)}
                  className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <span className="font-semibold text-white">
                  Also publish to App Store Catalog (reusable across all virtual clusters)
                </span>
              </label>
            </div>

            {/* Submit Actions */}
            <div className="pt-3 border-t border-cyber-800 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('catalog')}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>{submitting ? 'Deploying...' : `Deploy to ${cluster.name}`}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 3: ADD APP TO STORE */}
        {activeTab === 'add-app' && (
          <form onSubmit={handleSaveAppToStore} className="overflow-y-auto space-y-4 flex-1 pr-1">
            <div className="p-3 bg-cyber-950/60 border border-cyber-800 rounded-xl text-xs text-slate-400">
              Publish an application pack into the App Store catalog. Once saved, it can be deployed to any virtual cluster with 1 click.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Application Name *
                </label>
                <input
                  type="text"
                  value={storeAppName}
                  onChange={(e) => {
                    setStoreAppName(e.target.value);
                    if (!storeAppId) {
                      setStoreAppId(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                    }
                  }}
                  placeholder="e.g. NGINX Ingress"
                  required
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Category *
                </label>
                <select
                  value={storeAppCategory}
                  onChange={(e) => setStoreAppCategory(e.target.value as AppCategory)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  App ID / Slug (Optional)
                </label>
                <input
                  type="text"
                  value={storeAppId}
                  onChange={(e) => setStoreAppId(e.target.value)}
                  placeholder="auto-generated from name"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Version
                </label>
                <input
                  type="text"
                  value={storeAppVersion}
                  onChange={(e) => setStoreAppVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Description
              </label>
              <textarea
                value={storeAppDesc}
                onChange={(e) => setStoreAppDesc(e.target.value)}
                rows={2}
                placeholder="Brief summary of the application..."
                className="w-full bg-cyber-950 border border-cyber-700 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* Types Checkboxes */}
            <div className="flex items-center gap-6 p-3 bg-cyber-950 rounded-xl border border-cyber-800">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={storeHasHelm}
                  onChange={(e) => setStoreHasHelm(e.target.checked)}
                  className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <span className="font-semibold">Helm Chart</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={storeHasManifests}
                  onChange={(e) => setStoreHasManifests(e.target.checked)}
                  className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <span className="font-semibold">Kubernetes Manifests</span>
              </label>
            </div>

            {storeHasHelm && (
              <div className="p-4 bg-cyber-950/80 border border-cyber-800 rounded-2xl space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Repository URL *</label>
                    <input
                      type="text"
                      value={storeHelmRepo}
                      onChange={(e) => setStoreHelmRepo(e.target.value)}
                      placeholder="https://kubernetes.github.io/ingress-nginx"
                      required={storeHasHelm}
                      className="w-full bg-cyber-900 border border-cyber-750 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Chart Name *</label>
                    <input
                      type="text"
                      value={storeHelmName}
                      onChange={(e) => setStoreHelmName(e.target.value)}
                      placeholder="ingress-nginx"
                      required={storeHasHelm}
                      className="w-full bg-cyber-900 border border-cyber-750 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">Default values.yaml</label>
                  <textarea
                    value={storeHelmValues}
                    onChange={(e) => setStoreHelmValues(e.target.value)}
                    rows={4}
                    placeholder="# Default values for this chart..."
                    className="w-full bg-cyber-900 border border-cyber-750 rounded-xl p-3 text-xs text-cyan-200 font-mono"
                  />
                </div>
              </div>
            )}

            {storeHasManifests && (
              <div className="p-4 bg-cyber-950/80 border border-cyber-800 rounded-2xl space-y-2">
                <span className="text-xs font-mono font-bold text-emerald-400">Kubernetes Manifests</span>
                <textarea
                  value={storeManifests}
                  onChange={(e) => setStoreManifests(e.target.value)}
                  rows={5}
                  placeholder="apiVersion: v1&#10;kind: Service&#10;..."
                  className="w-full bg-cyber-900 border border-cyber-750 rounded-xl p-3 text-xs text-emerald-200 font-mono"
                />
              </div>
            )}

            <div className="pt-3 border-t border-cyber-800 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('catalog')}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>{submitting ? 'Saving...' : 'Save to App Store'}</span>
              </button>
            </div>
          </form>
        )}

        {/* TAB 4: CREATE APP GROUP */}
        {activeTab === 'create-group' && (
          <form onSubmit={handleSaveGroup} className="overflow-y-auto space-y-4 flex-1 pr-1">
            <div className="p-3 bg-purple-950/30 border border-purple-500/20 rounded-xl text-xs text-purple-300">
              Create an <strong>Application Pack Group</strong> to bundle multiple applications together. Users can deploy all bundled apps in a single click.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Group / Suite Name *
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => {
                    setGroupName(e.target.value);
                    if (!groupId) {
                      setGroupId(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                    }
                  }}
                  placeholder="e.g. Web Platform Suite"
                  required
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Group ID / Slug (Optional)
                </label>
                <input
                  type="text"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  placeholder="auto-generated from name"
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Description
              </label>
              <textarea
                value={groupDesc}
                onChange={(e) => setGroupDesc(e.target.value)}
                rows={2}
                placeholder="Describe what this suite provides..."
                className="w-full bg-cyber-950 border border-cyber-700 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400"
              />
            </div>

            {/* App Selection for this Group */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Select Applications to Include in this Suite ({groupAppIds.length} selected):
              </label>

              {(catalog?.apps || []).length === 0 ? (
                <div className="p-4 bg-cyber-950 rounded-xl border border-cyber-800 text-center text-xs text-slate-500 font-mono">
                  No applications exist in the catalog yet. Click{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('add-app')}
                    className="text-cyan-400 hover:underline"
                  >
                    + Add App to Store
                  </button>{' '}
                  first.
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {catalog?.apps.map((app) => {
                    const isSelected = groupAppIds.includes(app.id);
                    return (
                      <label
                        key={app.id}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-purple-950/40 border-purple-500/60'
                            : 'bg-cyber-950 border-cyber-800 hover:border-cyber-750'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                setGroupAppIds(groupAppIds.filter((id) => id !== app.id));
                              } else {
                                setGroupAppIds([...groupAppIds, app.id]);
                              }
                            }}
                            className="rounded border-cyber-700 bg-cyber-900 text-purple-500 focus:ring-purple-500 w-4 h-4"
                          />
                          <div>
                            <span className="text-xs font-bold text-white">{app.name}</span>
                            <span className="text-[10px] font-mono text-slate-500 ml-2">v{app.version}</span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-purple-400 bg-purple-950 px-2 py-0.5 rounded border border-purple-800">
                          {app.category}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-cyber-800 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('catalog')}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <Layers className="w-4 h-4" />
                <span>{submitting ? 'Creating...' : 'Create Application Suite'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
