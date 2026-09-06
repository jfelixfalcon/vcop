import React, { useState, useEffect } from 'react';
import {
  Package,
  Layers,
  Search,
  Plus,
  Trash2,
  Edit3,
  ExternalLink,
  FileCode,
  CheckCircle2,
  AlertCircle,
  X,
  Copy,
  Check,
  Globe,
  Shield,
  Activity,
  Database,
  Box,
  Sliders,
  Terminal,
  Network,
  Tag,
  Info,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import type { AppDefinition, AppGroup, AppCategory, AppStoreCatalog, UserSession } from '../lib/types';

interface Props {
  currentUser?: UserSession | null;
}

const CATEGORIES: AppCategory[] = [
  'Network & Ingress',
  'Observability',
  'Storage & Database',
  'Security & Auth',
  'Developer Tools',
];

function getCategoryIcon(cat: string) {
  switch (cat) {
    case 'Network & Ingress':
      return Network;
    case 'Observability':
      return Activity;
    case 'Storage & Database':
      return Database;
    case 'Security & Auth':
      return Shield;
    case 'Developer Tools':
      return Box;
    default:
      return Package;
  }
}

export const AppStoreView: React.FC<Props> = ({ currentUser }) => {
  const [catalog, setCatalog] = useState<AppStoreCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedGroup, setSelectedGroup] = useState<string>('All');

  // Modal states
  const [activeModal, setActiveModal] = useState<'add-app' | 'edit-app' | 'inspect-app' | 'add-group' | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppDefinition | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add/Edit App Form state
  const [appId, setAppId] = useState('');
  const [appName, setAppName] = useState('');
  const [appDesc, setAppDesc] = useState('');
  const [appCategory, setAppCategory] = useState<AppCategory>('Network & Ingress');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [appGroup, setAppGroup] = useState('');
  const [hasHelm, setHasHelm] = useState(true);
  const [helmRepo, setHelmRepo] = useState('');
  const [helmName, setHelmName] = useState('');
  const [helmRelease, setHelmRelease] = useState('');
  const [helmVersion, setHelmVersion] = useState('');
  const [helmNamespace, setHelmNamespace] = useState('default');
  const [helmValues, setHelmValues] = useState('');
  const [hasManifests, setHasManifests] = useState(false);
  const [manifestsContent, setManifestsContent] = useState('');

  // Add Group Form state
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupAppIds, setGroupAppIds] = useState<string[]>([]);

  const isAdmin = !currentUser || currentUser.role === 'admin';

  const fetchCatalog = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/appstore');
      const data = await res.json();
      if (data.success && data.data) {
        setCatalog(data.data);
      }
    } catch (e) {
      console.error('Failed to fetch App Store catalog:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const openAddAppModal = () => {
    setError(null);
    setSelectedApp(null);
    setAppId('');
    setAppName('');
    setAppDesc('');
    setAppCategory('Network & Ingress');
    setAppVersion('1.0.0');
    setAppGroup('');
    setHasHelm(true);
    setHelmRepo('');
    setHelmName('');
    setHelmRelease('');
    setHelmVersion('');
    setHelmNamespace('default');
    setHelmValues('# Custom Helm Values\n');
    setHasManifests(false);
    setManifestsContent('');
    setActiveModal('add-app');
  };

  const openEditAppModal = (app: AppDefinition) => {
    setError(null);
    setSelectedApp(app);
    setAppId(app.id);
    setAppName(app.name);
    setAppDesc(app.description);
    setAppCategory(app.category);
    setAppVersion(app.version);
    setAppGroup(app.group || '');
    setHasHelm(Boolean(app.helm));
    setHelmRepo(app.helm?.repo || '');
    setHelmName(app.helm?.name || '');
    setHelmRelease(app.helm?.releaseName || '');
    setHelmVersion(app.helm?.version || '');
    setHelmNamespace(app.helm?.namespace || 'default');
    setHelmValues(app.helm?.values || '');
    setHasManifests(Boolean(app.manifests));
    setManifestsContent(app.manifests || '');
    setActiveModal('edit-app');
  };

  const openInspectModal = (app: AppDefinition) => {
    setSelectedApp(app);
    setActiveModal('inspect-app');
  };

  const openAddGroupModal = () => {
    setError(null);
    setGroupId('');
    setGroupName('');
    setGroupDesc('');
    setGroupAppIds([]);
    setActiveModal('add-group');
  };

  const handleSaveApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!appId.trim() || !appName.trim()) {
        throw new Error('Application ID and Name are required');
      }
      if (!hasHelm && !hasManifests) {
        throw new Error('An application pack must include either a Helm Chart or Kubernetes Manifests');
      }

      const payload: AppDefinition = {
        id: appId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        name: appName.trim(),
        description: appDesc.trim(),
        category: appCategory,
        version: appVersion.trim() || '1.0.0',
        group: appGroup || undefined,
        tags: [appCategory.toLowerCase().replace(/[^a-z0-9]/g, '-')],
        helm: hasHelm
          ? {
              repo: helmRepo.trim(),
              name: helmName.trim() || appId.trim(),
              releaseName: helmRelease.trim() || helmName.trim() || appId.trim(),
              version: helmVersion.trim() || undefined,
              namespace: helmNamespace.trim() || 'default',
              values: helmValues,
            }
          : undefined,
        manifests: hasManifests && manifestsContent.trim() ? manifestsContent.trim() : undefined,
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
      setActiveModal(null);
    } catch (err: any) {
      setError(err.message || 'Error saving application');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteApp = async (app: AppDefinition) => {
    if (!confirm(`Are you sure you want to remove ${app.name} from the App Store catalog?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/appstore/apps/${app.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete application');
        return;
      }
      await fetchCatalog();
    } catch (e: any) {
      alert(e.message || 'Failed to delete application');
    }
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!groupId.trim() || !groupName.trim()) {
        throw new Error('Group ID and Name are required');
      }

      const payload: AppGroup = {
        id: groupId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
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
      setActiveModal(null);
    } catch (err: any) {
      setError(err.message || 'Error saving group');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async (group: AppGroup) => {
    if (!confirm(`Are you sure you want to delete the group "${group.name}"? Apps in the group will not be deleted.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/appstore/groups/${group.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete group');
        return;
      }
      await fetchCatalog();
    } catch (e: any) {
      alert(e.message || 'Failed to delete group');
    }
  };

  const apps = catalog?.apps || [];
  const groups = catalog?.groups || [];

  const filteredApps = apps.filter((app) => {
    if (selectedCategory !== 'All' && app.category !== selectedCategory) {
      return false;
    }
    if (selectedGroup !== 'All') {
      const groupObj = groups.find((g) => g.id === selectedGroup);
      if (!groupObj || !groupObj.appIds.includes(app.id)) {
        return false;
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const matchName = app.name.toLowerCase().includes(q);
      const matchDesc = app.description.toLowerCase().includes(q);
      const matchTag = app.tags?.some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchDesc && !matchTag) return false;
    }
    return true;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              DSO Catalog & Registry
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Package className="w-8 h-8 text-cyan-400" />
            DevOps Application Store 
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Curated Helm charts and Kubernetes manifests ready for one-click deployment to any virtual cluster. Group apps into application  or deploy individually.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={openAddGroupModal}
              className="px-3.5 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-200 border border-cyber-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Layers className="w-4 h-4 text-purple-400" />
              <span>+ Create App Group</span>
            </button>
            <button
              onClick={openAddAppModal}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add Application</span>
            </button>
          </div>
        )}
      </div>

      {/* App Groups /  Showcase Bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-mono">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            Curated Application  & Suites
          </h3>
          <span className="text-[10px] font-mono text-slate-500">
            Click a pack to filter catalog
          </span>
        </div>

        {groups.length === 0 ? (
          <div className="p-4 rounded-2xl border border-dashed border-cyber-800 bg-cyber-950/40 text-center">
            <p className="text-xs text-slate-500 font-mono">
              No application  defined yet. Click <span className="text-purple-400 font-semibold">+ Create App Group</span> above to bundle multiple apps into a 1-click deployment suite.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {groups.map((group) => {
              const isSelected = selectedGroup === group.id;
              return (
                <div
                  key={group.id}
                  onClick={() => setSelectedGroup(isSelected ? 'All' : group.id)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all relative overflow-hidden group ${
                    isSelected
                      ? 'bg-purple-950/40 border-purple-500/60 shadow-glow-sm'
                      : 'bg-cyber-900/80 border-cyber-700/60 hover:border-cyber-600 hover:bg-cyber-850'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors">
                          {group.name}
                        </h4>
                        <span className="text-[10px] font-mono text-purple-400/90 font-semibold">
                          {group.appIds.length} Application{group.appIds.length !== 1 ? 's' : ''} Bundled
                        </span>
                      </div>
                    </div>

                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group);
                        }}
                        className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                        title="Delete Group"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 mt-2 line-clamp-2">
                    {group.description}
                  </p>

                  <div className="mt-3 pt-2.5 border-t border-cyber-800 flex flex-wrap gap-1.5 items-center">
                    {group.appIds.map((id) => (
                      <span
                        key={id}
                        className="px-2 py-0.5 bg-cyber-950 rounded border border-cyber-800 font-mono text-[10px] text-slate-300"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-cyber-900/60 p-3.5 rounded-2xl border border-cyber-800">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications, charts, tags..."
            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto w-full md:w-auto">
          {['All', ...CATEGORIES].map((cat) => {
            const isCatActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  isCatActive
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-glow-sm'
                    : 'bg-cyber-950 hover:bg-cyber-800 text-slate-400 hover:text-slate-200 border border-cyber-800'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Filters Summary */}
      {(selectedGroup !== 'All' || selectedCategory !== 'All' || search) && (
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span>Filtering by:</span>
          {selectedGroup !== 'All' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300">
              Pack: {groups.find((g) => g.id === selectedGroup)?.name || selectedGroup}
              <button onClick={() => setSelectedGroup('All')}>
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {selectedCategory !== 'All' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
              Category: {selectedCategory}
              <button onClick={() => setSelectedCategory('All')}>
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setSelectedGroup('All');
              setSelectedCategory('All');
              setSearch('');
            }}
            className="text-[11px] text-cyan-400 hover:underline ml-2"
          >
            Reset All Filters
          </button>
        </div>
      )}

      {/* Applications Grid */}
      {loading ? (
        <div className="py-20 text-center text-slate-500 font-mono text-xs">
          Loading App Store Catalog...
        </div>
      ) : apps.length === 0 ? (
        <div className="py-20 text-center bg-cyber-900/40 rounded-3xl border border-cyber-800 p-8">
          <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">App Store is Clean & Ready</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            No applications have been added to the catalog yet. Click <span className="text-cyan-400 font-semibold">+ Add Application</span> above to publish your first Helm chart or Kubernetes manifests.
          </p>
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="py-20 text-center bg-cyber-900/40 rounded-3xl border border-cyber-800 p-8">
          <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">No Applications Found</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            No applications matched your search or category filter. Try clearing your filters or add a new application.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredApps.map((app) => {
            const CatIcon = getCategoryIcon(app.category);
            const isPack = Boolean(app.helm && app.manifests);
            const hasHelmOnly = Boolean(app.helm && !app.manifests);
            const hasManifestsOnly = Boolean(!app.helm && app.manifests);

            return (
              <div
                key={app.id}
                className="bg-cyber-900/90 border border-cyber-700/70 hover:border-cyan-500/40 rounded-3xl p-5 flex flex-col justify-between transition-all duration-200 shadow-lg hover:shadow-cyan-500/5 group"
              >
                <div>
                  {/* Top Bar */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-2xl bg-cyber-950 border border-cyber-750 text-cyan-400 group-hover:border-cyan-500/30 transition-colors">
                        <CatIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                          {app.name}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-mono font-semibold text-slate-400">
                            v{app.version}
                          </span>
                          <span className="text-slate-600">•</span>
                          <span className="text-[10px] font-mono text-cyan-400">
                            {app.category}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Component Type Badges */}
                    <div className="flex flex-col items-end gap-1">
                      {isPack && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          App Pack (Helm + Manifests)
                        </span>
                      )}
                      {hasHelmOnly && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                          Helm Chart
                        </span>
                      )}
                      {hasManifestsOnly && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Raw Manifests
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-400 leading-relaxed mb-4 line-clamp-2">
                    {app.description}
                  </p>

                  {/* Details Card */}
                  <div className="bg-cyber-950/80 border border-cyber-800 rounded-2xl p-3 font-mono text-[11px] space-y-1.5 mb-4">
                    {app.helm && (
                      <div className="flex justify-between items-center text-slate-400">
                        <span className="text-slate-500 text-[10px]">CHART:</span>
                        <span className="text-cyan-300 font-semibold truncate max-w-[190px]">
                          {app.helm.repo ? `${app.helm.name} (${app.helm.version || 'latest'})` : app.helm.name}
                        </span>
                      </div>
                    )}
                    {app.helm && (
                      <div className="flex justify-between items-center text-slate-400">
                        <span className="text-slate-500 text-[10px]">NAMESPACE:</span>
                        <span className="text-slate-200">{app.helm.namespace || 'default'}</span>
                      </div>
                    )}
                    {app.manifests && (
                      <div className="flex justify-between items-center text-slate-400">
                        <span className="text-slate-500 text-[10px]">MANIFESTS:</span>
                        <span className="text-emerald-400 font-semibold">Configured YAML</span>
                      </div>
                    )}
                    {app.group && (
                      <div className="flex justify-between items-center text-slate-400">
                        <span className="text-slate-500 text-[10px]">GROUP PACK:</span>
                        <span className="text-purple-300">
                          {groups.find((g) => g.id === app.group)?.name || app.group}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-cyber-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => openInspectModal(app)}
                    className="px-3 py-1.5 bg-cyber-800 hover:bg-cyber-750 text-slate-200 border border-cyber-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all"
                  >
                    <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Inspect Config</span>
                  </button>

                  {isAdmin && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEditAppModal(app)}
                        className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-cyber-800 transition-colors"
                        title="Edit App Definition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteApp(app)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition-colors"
                        title="Delete App"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Inspect Config & Values */}
      {activeModal === 'inspect-app' && selectedApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-3xl bg-cyber-900 border border-cyber-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {selectedApp.name}
                    <span className="text-xs font-mono font-normal text-slate-400">
                      v{selectedApp.version}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{selectedApp.description}</p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-5 flex-1 pr-1">
              {/* Helm Details */}
              {selectedApp.helm && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5 font-mono">
                      <FileCode className="w-4 h-4" />
                      Helm Chart Specifications & values.yaml
                    </span>
                    <button
                      onClick={() => handleCopy(selectedApp.helm?.values || '', 'helm')}
                      className="px-2.5 py-1 bg-cyber-950 hover:bg-cyber-800 text-slate-300 text-xs font-mono rounded-lg border border-cyber-800 flex items-center gap-1 transition-colors"
                    >
                      {copiedKey === 'helm' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Values</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-cyber-950 p-3 rounded-xl border border-cyber-800">
                    <div>
                      <span className="text-[10px] text-slate-500 block">CHART NAME</span>
                      <span className="text-white font-bold">{selectedApp.helm.name}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">RELEASE NAME</span>
                      <span className="text-white font-bold">{selectedApp.helm.releaseName}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">TARGET NAMESPACE</span>
                      <span className="text-white font-bold">{selectedApp.helm.namespace || 'default'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">REPOSITORY</span>
                      <span className="text-cyan-300 truncate block">{selectedApp.helm.repo}</span>
                    </div>
                  </div>

                  <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre leading-relaxed max-h-56">
                    {selectedApp.helm.values || '# No custom values configured'}
                  </pre>
                </div>
              )}

              {/* Manifests Details */}
              {selectedApp.manifests && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                      <Layers className="w-4 h-4" />
                      Kubernetes YAML Manifests
                    </span>
                    <button
                      onClick={() => handleCopy(selectedApp.manifests || '', 'manifests')}
                      className="px-2.5 py-1 bg-cyber-950 hover:bg-cyber-800 text-slate-300 text-xs font-mono rounded-lg border border-cyber-800 flex items-center gap-1 transition-colors"
                    >
                      {copiedKey === 'manifests' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Manifests</span>
                        </>
                      )}
                    </button>
                  </div>

                  <pre className="bg-cyber-950 border border-cyber-800 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre leading-relaxed max-h-56">
                    {selectedApp.manifests}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-cyber-800 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Add or Edit Application */}
      {(activeModal === 'add-app' || activeModal === 'edit-app') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl bg-cyber-900 border border-cyber-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {activeModal === 'add-app' ? 'Add Application to Catalog' : `Edit ${appName}`}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Define an application pack consisting of Helm charts, manifests, or both.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveApp} className="overflow-y-auto space-y-4 flex-1 pr-1">
              {/* Basics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Application ID (Slug) *
                  </label>
                  <input
                    type="text"
                    value={appId}
                    onChange={(e) => setAppId(e.target.value)}
                    disabled={activeModal === 'edit-app'}
                    placeholder="e.g. argocd"
                    required
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="e.g. Argo CD Core"
                    required
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Category *
                  </label>
                  <select
                    value={appCategory}
                    onChange={(e) => setAppCategory(e.target.value as AppCategory)}
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Version
                  </label>
                  <input
                    type="text"
                    value={appVersion}
                    onChange={(e) => setAppVersion(e.target.value)}
                    placeholder="e.g. 1.0.0"
                    className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  value={appDesc}
                  onChange={(e) => setAppDesc(e.target.value)}
                  placeholder="Explain what this application or stack provides to tenant workloads..."
                  rows={2}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Assign to Curated Pack / Group
                </label>
                <select
                  value={appGroup}
                  onChange={(e) => setAppGroup(e.target.value)}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  <option value="">(None - Standalone App)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Helm Chart Configuration */}
              <div className="p-4 bg-cyber-950/60 rounded-2xl border border-cyber-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasHelm}
                      onChange={(e) => setHasHelm(e.target.checked)}
                      className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                    />
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <FileCode className="w-4 h-4 text-cyan-400" />
                      Include Helm Chart Deployment
                    </span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-500">vCluster Native Helm</span>
                </div>

                {hasHelm && (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-mono text-slate-400 mb-1">
                          HELM REPO URL *
                        </label>
                        <input
                          type="text"
                          value={helmRepo}
                          onChange={(e) => setHelmRepo(e.target.value)}
                          placeholder="https://charts.bitnami.com/bitnami"
                          required={hasHelm}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-slate-400 mb-1">
                          CHART NAME *
                        </label>
                        <input
                          type="text"
                          value={helmName}
                          onChange={(e) => setHelmName(e.target.value)}
                          placeholder="e.g. redis"
                          required={hasHelm}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-slate-400 mb-1">
                          RELEASE NAME
                        </label>
                        <input
                          type="text"
                          value={helmRelease}
                          onChange={(e) => setHelmRelease(e.target.value)}
                          placeholder="Defaults to chart name"
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-mono text-slate-400 mb-1">
                          TARGET NAMESPACE
                        </label>
                        <input
                          type="text"
                          value={helmNamespace}
                          onChange={(e) => setHelmNamespace(e.target.value)}
                          placeholder="default"
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono text-slate-400 mb-1 flex items-center justify-between">
                        <span>DEFAULT values.yaml (YAML)</span>
                        <span className="text-[10px] text-slate-500 font-normal">Customizable on install</span>
                      </label>
                      <textarea
                        value={helmValues}
                        onChange={(e) => setHelmValues(e.target.value)}
                        rows={6}
                        placeholder="controller:\n  replicaCount: 1\n"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl p-3 text-xs text-cyan-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono leading-relaxed"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Raw Manifests Configuration */}
              <div className="p-4 bg-cyber-950/60 rounded-2xl border border-cyber-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasManifests}
                      onChange={(e) => setHasManifests(e.target.checked)}
                      className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                    />
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      Include Raw Kubernetes Manifests
                    </span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-500">Multi-Document YAML</span>
                </div>

                {hasManifests && (
                  <div className="pt-2">
                    <textarea
                      value={manifestsContent}
                      onChange={(e) => setManifestsContent(e.target.value)}
                      rows={6}
                      placeholder="apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: app\n---\napiVersion: v1\nkind: Service\n..."
                      className="w-full bg-cyber-900 border border-cyber-700 rounded-xl p-3 text-xs text-emerald-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400 font-mono leading-relaxed"
                    />
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-cyber-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={saving}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving...' : activeModal === 'add-app' ? 'Add to Catalog' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Create App Group / Pack */}
      {activeModal === 'add-group' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-cyber-900 border border-cyber-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl overflow-hidden">
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Create Curated App Group</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Bundle multiple applications into an easily deployable pack.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveModal(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-cyber-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSaveGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Group ID (Slug) *
                </label>
                <input
                  type="text"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  placeholder="e.g. security-pack"
                  required
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Group Display Name *
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Cloud Security Suite"
                  required
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  value={groupDesc}
                  onChange={(e) => setGroupDesc(e.target.value)}
                  placeholder="Brief description of this application pack..."
                  rows={2}
                  className="w-full bg-cyber-950 border border-cyber-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">
                  Select Member Applications ({groupAppIds.length} selected)
                </label>
                <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-cyber-950 rounded-xl border border-cyber-800">
                  {apps.map((app) => {
                    const isChecked = groupAppIds.includes(app.id);
                    return (
                      <label
                        key={app.id}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-cyber-900 cursor-pointer text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setGroupAppIds([...groupAppIds, app.id]);
                              } else {
                                setGroupAppIds(groupAppIds.filter((id) => id !== app.id));
                              }
                            }}
                            className="rounded border-cyber-700 bg-cyber-900 text-purple-500 focus:ring-purple-500 w-4 h-4"
                          />
                          <span className="text-white font-medium">{app.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">{app.category}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-cyber-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={saving}
                  className="px-4 py-2 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create App Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
