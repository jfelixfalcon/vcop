import React, { useState, useEffect } from 'react';
import {
  Server,
  Layers,
  Clock,
  Shield,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Settings2,
  Sparkles,
  Check,
  AlertCircle,
  FileCode,
  Zap,
  Sliders,
  Cpu,
  Database,
  HardDrive,
  Package,
  Box,
  ChevronDown,
  ChevronUp,
  FolderGit2,
  Tag,
  Globe,
  AlertOctagon,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  History,
  ExternalLink,
  Network,
  RefreshCw,
} from 'lucide-react';
import type { SizePreset, PresetDetails, AppStoreCatalog, AppDefinition, AppGroup, VersionRegistry, ClusterCapacityData, BackupItem, ClusterBaseline, StorageClassInfo } from '../lib/types';
import { PRESETS } from '../lib/presets';
import { computeClusterFqdn, parseSelector, formatSelector } from '../lib/baseline-utils';
import { parseCpuMillis, parseMemoryBytes, formatCpuMillis, formatMemoryBytes } from '../lib/metrics-utils';

interface ProvisioningWizardProps {
  user?: {
    username: string;
    email?: string;
    role: string;
  } | null;
}

export const ProvisioningWizard: React.FC<ProvisioningWizardProps> = ({ user }) => {
  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developers' || user?.role === 'developer';
  const [step, setStep] = useState<number>(1);

  // Cluster Baseline & Sizing State
  const [presets, setPresets] = useState<PresetDetails[]>(PRESETS);
  const [baselines, setBaselines] = useState<ClusterBaseline[]>([]);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('dev-sandbox');
  const [selectedBaseline, setSelectedBaseline] = useState<ClusterBaseline | null>(null);

  // Form State
  const [clusterName, setClusterName] = useState<string>('');
  const [owner, setOwner] = useState<string>(user?.email || user?.username || '');
  const [allowedGroups, setAllowedGroups] = useState<string>('');
  const [allowedEmails, setAllowedEmails] = useState<string>('');
  const [clusterGroup, setClusterGroup] = useState<string>('');
  const [fleetGroups, setFleetGroups] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<'development' | 'staging' | 'production'>('development');
  const [sizePreset, setSizePreset] = useState<SizePreset>('normal');
  const [enableMonitoringAndDNS, setEnableMonitoringAndDNS] = useState<boolean>(true);
  const [autoSleep, setAutoSleep] = useState<boolean>(false);
  const [ttlHours, setTtlHours] = useState<number>(72);
  const [storageClasses, setStorageClasses] = useState<StorageClassInfo[]>([]);
  const [etcdStorageClass, setEtcdStorageClass] = useState<string>('');
  const [storageClass, setStorageClass] = useState<string>('');

  // Cluster Architecture State ('vcluster' | 'namespaced')
  const [clusterType, setClusterType] = useState<'vcluster' | 'namespaced'>('vcluster');
  const [namespacesInput, setNamespacesInput] = useState<string>('');

  // Dynamic Resource Quotas & Policies
  const [showQuotaOverrides, setShowQuotaOverrides] = useState<boolean>(false);
  const [requestsCPU, setRequestsCPU] = useState<string>('4');
  const [limitsCPU, setLimitsCPU] = useState<string>('8');
  const [requestsMemory, setRequestsMemory] = useState<string>('8Gi');
  const [limitsMemory, setLimitsMemory] = useState<string>('16Gi');
  const [requestsStorage, setRequestsStorage] = useState<string>('25Gi');
  const [pods, setPods] = useState<string>('25');
  const [services, setServices] = useState<string>('25');
  const [persistentVolumeClaims, setPersistentVolumeClaims] = useState<string>('10');
  const [servicesLoadBalancers, setServicesLoadBalancers] = useState<string>('2');
  const [servicesNodePorts, setServicesNodePorts] = useState<string>('0');
  const [configMaps, setConfigMaps] = useState<string>('50');
  const [secrets, setSecrets] = useState<string>('50');
  const [defaultRequestCPU, setDefaultRequestCPU] = useState<string>('100m');
  const [defaultRequestMemory, setDefaultRequestMemory] = useState<string>('128Mi');
  const [defaultCPU, setDefaultCPU] = useState<string>('500m');
  const [defaultMemory, setDefaultMemory] = useState<string>('512Mi');
  const [maxCPU, setMaxCPU] = useState<string>('4');
  const [maxMemory, setMaxMemory] = useState<string>('8Gi');
  const [minCPU, setMinCPU] = useState<string>('10m');
  const [minMemory, setMinMemory] = useState<string>('32Mi');

  // Advanced Mode
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [versionRegistry, setVersionRegistry] = useState<VersionRegistry | null>(null);
  const [loadingVersions, setLoadingVersions] = useState<boolean>(true);
  const [kubernetesVersion, setKubernetesVersion] = useState<string>('');
  const [vclusterVersion, setVclusterVersion] = useState<string>('');
  const [etcdVersion, setEtcdVersion] = useState<string>('');
  const [coreDNSVersion, setCoreDNSVersion] = useState<string>('');
  const [metricsServerVersion, setMetricsServerVersion] = useState<string>('');
  const [istioVersion, setIstioVersion] = useState<string>('');
  const [customYaml, setCustomYaml] = useState<string>('');
  const [customCaCert, setCustomCaCert] = useState<string>('');
  const [customCaSecret, setCustomCaSecret] = useState<string>('');

  // App Store  State
  const [catalog, setCatalog] = useState<AppStoreCatalog | null>(null);
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>([]);
  const [customValuesMap, setCustomValuesMap] = useState<Record<string, string>>({});
  const [expandedValueAppId, setExpandedValueAppId] = useState<string | null>(null);

  // Ingress Provider Selection: 'istio' | 'gateway-api' | 'none'
  const [ingressProvider, setIngressProvider] = useState<'istio' | 'gateway-api' | 'none'>('istio');
  const enableIstio = ingressProvider === 'istio';
  const enableGatewayAPI = ingressProvider === 'gateway-api';

  const [enableMesh, setEnableMesh] = useState<boolean>(false);
  const [certIssuerKind, setCertIssuerKind] = useState<'ClusterIssuer' | 'Issuer'>('ClusterIssuer');
  const [certIssuer, setCertIssuer] = useState<string>('');
  const [gatewayHost, setGatewayHost] = useState<string>('');
  const [hostCertIssuers, setHostCertIssuers] = useState<{
    installed: boolean;
    clusterIssuers: string[];
    issuers: string[];
    error?: string;
  }>({ installed: false, clusterIssuers: [], issuers: [] });

  // Host Ingress Routing (Istio: DestinationRule + Host VirtualService + API Passthrough Gateway)
  const [enableHostRouting, setEnableHostRouting] = useState<boolean>(false);
  const [hostDefaultGateway, setHostDefaultGateway] = useState<string>('istio-system/default-gateway');
  const [hostGatewaySelector, setHostGatewaySelector] = useState<string>('istio: ingressgateway');
  const [hostApiHost, setHostApiHost] = useState<string>('');

  // Kubernetes Gateway API State
  const [gatewayClassName, setGatewayClassName] = useState<string>('eg');
  const [gatewayDefaultName, setGatewayDefaultName] = useState<string>('default-gateway');
  const [gatewayReplicas, setGatewayReplicas] = useState<number>(1);
  const [gatewayHostRoutingEnabled, setGatewayHostRoutingEnabled] = useState<boolean>(true);
  const [gatewayHostName, setGatewayHostName] = useState<string>('eg');
  const [gatewayHostNamespace, setGatewayHostNamespace] = useState<string>('envoy-gateway-system');
  const [gatewayApiHost, setGatewayApiHost] = useState<string>('');

  const [clusterCapacity, setClusterCapacity] = useState<ClusterCapacityData | null>(null);
  const [ignoreCapacityCheck, setIgnoreCapacityCheck] = useState<boolean>(false);

  // Disaster Recovery & Restore on Provisioning
  const [deploymentMode, setDeploymentMode] = useState<'clean' | 'restore'>('clean');
  const [availableBackups, setAvailableBackups] = useState<BackupItem[]>([]);
  const [loadingBackups, setLoadingBackups] = useState<boolean>(false);
  const [selectedRestoreSnapshot, setSelectedRestoreSnapshot] = useState<string>('');
  const [enableBackup, setEnableBackup] = useState<boolean>(true);
  const [backupSchedule, setBackupSchedule] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [backupRetention, setBackupRetention] = useState<number>(7);

  useEffect(() => {
    if (deploymentMode === 'restore') {
      setLoadingBackups(true);
      fetch('/api/backups')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.data)) {
            setAvailableBackups(data.data);
            if (data.data.length > 0 && !selectedRestoreSnapshot) {
              setSelectedRestoreSnapshot(data.data[0].filename || data.data[0].name);
            }
          }
        })
        .catch((e) => console.warn('Failed loading backups in wizard:', e))
        .finally(() => setLoadingBackups(false));
    }
  }, [deploymentMode]);

  useEffect(() => {
    fetch('/api/cluster/capacity')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.capacity) {
          setClusterCapacity(data.capacity);
        }
      })
      .catch((e) => console.warn('Failed loading capacity in wizard:', e));

    fetch('/api/cert-manager/issuers')
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setHostCertIssuers(data);
          if (data.clusterIssuers && data.clusterIssuers.length > 0) {
            setCertIssuer((prev) => prev || data.clusterIssuers[0]);
          }
        }
      })
      .catch((e) => console.warn('Failed loading cert-manager issuers in wizard:', e));

    fetch('/api/appstore')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setCatalog(data.data);
        }
      })
      .catch((e) => console.warn('Failed loading catalog in wizard:', e));

    fetch('/api/vclusters/groups')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setFleetGroups(data.data.map((g: any) => g.name));
        }
      })
      .catch((e) => console.warn('Failed loading cluster groups in wizard:', e));

    fetch('/api/admin/versions')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          const reg: VersionRegistry = data.data;
          setVersionRegistry(reg);
          const defaultK8s = reg.kubernetesVersions.find((v) => v.isDefault)?.version || reg.kubernetesVersions[0]?.version || '';
          const defaultEngine = reg.vclusterVersions.find((v) => v.isDefault)?.version || reg.vclusterVersions[0]?.version || '';
          const defaultEtcd = reg.etcdVersions?.find((v) => v.isDefault)?.version || reg.etcdVersions?.[0]?.version || '';
          const defaultCoreDNS = reg.coreDNSVersions?.find((v) => v.isDefault)?.version || reg.coreDNSVersions?.[0]?.version || '';
          const defaultMetrics = reg.metricsServerVersions?.find((v) => v.isDefault)?.version || reg.metricsServerVersions?.[0]?.version || '';
          const defaultIstio = reg.istioVersions?.find((v) => v.isDefault)?.version || reg.istioVersions?.[0]?.version || '';
          setKubernetesVersion((prev) => prev || defaultK8s);
          setVclusterVersion((prev) => prev || defaultEngine);
          setEtcdVersion((prev) => prev || defaultEtcd);
          setCoreDNSVersion((prev) => prev || defaultCoreDNS);
          setMetricsServerVersion((prev) => prev || defaultMetrics);
          setIstioVersion((prev) => prev || defaultIstio);
        }
      })
      .catch((e) => console.warn('Failed loading versions in wizard:', e))
      .finally(() => setLoadingVersions(false));

    fetch('/api/admin/baselines')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          const list: ClusterBaseline[] = data.data;
          setBaselines(list);
          const def = list.find((b) => b.isDefault) || list[0];
          applyBaseline(def);
        }
      })
    fetch('/api/presets')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.presets) && data.presets.length > 0) {
          setPresets(data.presets);
        }
      })
      .catch((e) => console.warn('Failed loading sizing presets in wizard:', e));

    fetch('/api/cluster/storage-classes')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setStorageClasses(data.data);
        }
      })
      .catch((e) => console.warn('Failed loading storage classes in wizard:', e));
  }, []);

  const applyBaseline = (b: ClusterBaseline) => {
    setSelectedBaselineId(b.id);
    setSelectedBaseline(b);
    setSizePreset(b.preset);
    setEnvironment(b.environment);
    if (b.kubernetesVersion) setKubernetesVersion(b.kubernetesVersion);
    if (b.vclusterVersion) setVclusterVersion(b.vclusterVersion);
    setAutoSleep(b.autoSleep);
    setEnableMonitoringAndDNS(b.enableMonitoringAndDNS);
    setEtcdStorageClass(b.etcdStorageClass || '');
    setStorageClass(b.storageClass || '');
    if (b.gatewayAPI && b.gatewayAPI.enabled) {
      setIngressProvider('gateway-api');
      if (b.gatewayAPI.gatewayClassName) setGatewayClassName(b.gatewayAPI.gatewayClassName);
      if (b.gatewayAPI.certificateIssuer) setCertIssuer(b.gatewayAPI.certificateIssuer);
      if (b.gatewayAPI.certificateIssuerKind) setCertIssuerKind(b.gatewayAPI.certificateIssuerKind);
      if (b.gatewayAPI.gatewayConfig?.defaultGateway) setGatewayDefaultName(b.gatewayAPI.gatewayConfig.defaultGateway);
      if (b.gatewayAPI.gatewayConfig?.replicas) setGatewayReplicas(b.gatewayAPI.gatewayConfig.replicas);
      if (b.gatewayAPI.hostRouting) {
        setGatewayHostRoutingEnabled(b.gatewayAPI.hostRouting.enabled);
        if (b.gatewayAPI.hostRouting.gatewayName) setGatewayHostName(b.gatewayAPI.hostRouting.gatewayName);
        if (b.gatewayAPI.hostRouting.gatewayNamespace) setGatewayHostNamespace(b.gatewayAPI.hostRouting.gatewayNamespace);
        if (b.gatewayAPI.hostRouting.apiHost) setGatewayApiHost(b.gatewayAPI.hostRouting.apiHost);
      }
    } else if (b.istio) {
      setIngressProvider(b.istio.enabled ? 'istio' : 'none');
      setEnableMesh(b.istio.meshEnabled ?? false);
      if (b.istio.certificateIssuer) setCertIssuer(b.istio.certificateIssuer);
      if (b.istio.certificateIssuerKind) setCertIssuerKind(b.istio.certificateIssuerKind);
      if (b.istio.hostRouting) {
        setEnableHostRouting(b.istio.hostRouting.enabled);
        if (b.istio.hostRouting.defaultGateway) setHostDefaultGateway(b.istio.hostRouting.defaultGateway);
        if (b.istio.hostRouting.ingressGatewaySelector) setHostGatewaySelector(formatSelector(b.istio.hostRouting.ingressGatewaySelector));
        if (b.istio.hostRouting.apiHost) setHostApiHost(b.istio.hostRouting.apiHost);
      } else {
        setEnableHostRouting(false);
      }
    } else {
      setIngressProvider('none');
    }
    if (b.disasterRecovery) {
      setEnableBackup(b.disasterRecovery.enabled);
      setBackupSchedule((b.disasterRecovery.schedule as any) || 'daily');
      setBackupRetention(b.disasterRecovery.retentionCount || 7);
    }
    if (b.policies?.resourceQuota) {
      const q = b.policies.resourceQuota;
      if (q.requestsCPU) setRequestsCPU(q.requestsCPU);
      if (q.limitsCPU) setLimitsCPU(q.limitsCPU);
      if (q.requestsMemory) setRequestsMemory(q.requestsMemory);
      if (q.limitsMemory) setLimitsMemory(q.limitsMemory);
      if (q.requestsStorage) setRequestsStorage(q.requestsStorage);
      if (q.pods) setPods(q.pods);
      if (q.services) setServices(q.services);
      if (q.persistentVolumeClaims) setPersistentVolumeClaims(q.persistentVolumeClaims);
      if (q.servicesLoadBalancers) setServicesLoadBalancers(q.servicesLoadBalancers);
      if (q.servicesNodePorts) setServicesNodePorts(q.servicesNodePorts);
      if (q.configMaps) setConfigMaps(q.configMaps);
      if (q.secrets) setSecrets(q.secrets);
    }
    if (b.policies?.limitRange) {
      const lr = b.policies.limitRange;
      if (lr.defaultRequestCPU) setDefaultRequestCPU(lr.defaultRequestCPU);
      if (lr.defaultRequestMemory) setDefaultRequestMemory(lr.defaultRequestMemory);
      if (lr.defaultCPU) setDefaultCPU(lr.defaultCPU);
      if (lr.defaultMemory) setDefaultMemory(lr.defaultMemory);
      if (lr.maxCPU) setMaxCPU(lr.maxCPU);
      if (lr.maxMemory) setMaxMemory(lr.maxMemory);
      if (lr.minCPU) setMinCPU(lr.minCPU);
      if (lr.minMemory) setMinMemory(lr.minMemory);
    }
    const fqdn = computeClusterFqdn(clusterName, b.baseDomain);
    setGatewayHost(fqdn.wildcard);
  };

  const handleClusterNameChange = (val: string) => {
    const cleaned = val.toLowerCase();
    setClusterName(cleaned);
    const domain = selectedBaseline?.baseDomain || 'test.example.com';
    const fqdn = computeClusterFqdn(cleaned, domain);
    setGatewayHost(fqdn.wildcard);
  };

  const missingCoreComponents: string[] = [];
  if (versionRegistry && clusterType !== 'namespaced') {
    if (!versionRegistry.kubernetesVersions || versionRegistry.kubernetesVersions.length === 0) {
      missingCoreComponents.push('Kubernetes Control Plane');
    }
    if (!versionRegistry.vclusterVersions || versionRegistry.vclusterVersions.length === 0) {
      missingCoreComponents.push('vCluster Engine');
    }
    if (!versionRegistry.etcdVersions || versionRegistry.etcdVersions.length === 0) {
      missingCoreComponents.push('etcd Backing Store');
    }
  }

  const handleQuickLaunch = async () => {
    if (clusterType !== 'namespaced' && missingCoreComponents.length > 0) {
      setError(`Cannot provision virtual cluster: Core component versions are missing in registry (${missingCoreComponents.join(', ')}). Platform administrators must import or register core component versions first.`);
      return;
    }
    if (!clusterName.trim()) {
      setError('Please enter a Cluster Identifier before deploying.');
      return;
    }
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    await handleSubmit(fakeEvent);
  };

  const checkCapacityOvercommit = () => {
    if (!clusterCapacity) return { isOverallocated: false, errors: [] as string[], reqCpuMillis: 0, reqMemBytes: 0, reqStorageBytes: 0 };
    const reqCpuMillis = parseCpuMillis(requestsCPU);
    const reqMemBytes = parseMemoryBytes(requestsMemory);
    const reqStorageBytes = parseMemoryBytes(requestsStorage);

    const errors: string[] = [];
    if (reqCpuMillis > clusterCapacity.availableCpuMillis) {
      errors.push(
        `Requested CPU (${requestsCPU}) exceeds cluster available headroom (${clusterCapacity.availableCpuStr} remaining of ${clusterCapacity.allocatableCpuStr} total)`
      );
    }
    if (reqMemBytes > clusterCapacity.availableMemoryBytes) {
      errors.push(
        `Requested Memory (${requestsMemory}) exceeds cluster available headroom (${clusterCapacity.availableMemoryStr} remaining of ${clusterCapacity.allocatableMemoryStr} total)`
      );
    }
    if (reqStorageBytes > clusterCapacity.availableStorageBytes) {
      errors.push(
        `Requested Storage (${requestsStorage}) exceeds storage capacity (${clusterCapacity.availableStorageStr} remaining of ${clusterCapacity.allocatableStorageStr} total)`
      );
    }

    return {
      isOverallocated: errors.length > 0,
      errors,
      reqCpuMillis,
      reqMemBytes,
      reqStorageBytes,
    };
  };

  // Submission State
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectPreset = (preset: SizePreset) => {
    setSizePreset(preset);
    const target = presets.find((p) => p.id === preset);
    if (target) {
      if (target.requestsCPU) setRequestsCPU(target.requestsCPU);
      if (target.limitsCPU) setLimitsCPU(target.limitsCPU);
      if (target.requestsMemory) setRequestsMemory(target.requestsMemory);
      if (target.limitsMemory) setLimitsMemory(target.limitsMemory);
      if (target.requestsStorage) setRequestsStorage(target.requestsStorage);
      if (target.pods) setPods(target.pods);
      if (target.services) setServices(target.services);
      if (target.persistentVolumeClaims) setPersistentVolumeClaims(target.persistentVolumeClaims);
      return;
    }
    switch (preset) {
      case 'normal':
      case 'small':
        setRequestsCPU('1');
        setLimitsCPU('2');
        setRequestsMemory('2Gi');
        setLimitsMemory('4Gi');
        setRequestsStorage('10Gi');
        setPods('10');
        setServices('10');
        setPersistentVolumeClaims('5');
        setDefaultRequestCPU('50m');
        setDefaultRequestMemory('64Mi');
        setDefaultCPU('250m');
        setDefaultMemory('256Mi');
        break;
      case 'ha':
      case 'large':
      case 'medium':
      default:
        setRequestsCPU('4');
        setLimitsCPU('8');
        setRequestsMemory('8Gi');
        setLimitsMemory('16Gi');
        setRequestsStorage('25Gi');
        setPods('25');
        setServices('25');
        setPersistentVolumeClaims('10');
        setDefaultRequestCPU('100m');
        setDefaultRequestMemory('128Mi');
        setDefaultCPU('500m');
        setDefaultMemory('512Mi');
        break;
    }
  };

  const selectedPresetDetails = presets.find((p) => p.id === sizePreset) || presets[0] || PRESETS[0];

  const handleNext = () => {
    if (step === 1) {
      if (!clusterName.trim()) {
        setError('Please provide a valid cluster name');
        return;
      }
      const nameRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
      if (!nameRegex.test(clusterName.trim())) {
        setError('Cluster name must contain only lowercase letters, numbers, and hyphens (e.g. dev-cluster)');
        return;
      }
    }
    if (step === 2) {
      const overcommit = checkCapacityOvercommit();
      if (overcommit.isOverallocated && !ignoreCapacityCheck) {
        setError(`Capacity check failed: ${overcommit.errors[0]}. Reduce requested quotas or enable Administrator Overcommit Bypass.`);
        return;
      }
    }
    if (isDeveloper) {
      handleQuickLaunch();
      return;
    }
    setError(null);
    setStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrev = () => {
    setError(null);
    setStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clusterType !== 'namespaced' && missingCoreComponents.length > 0) {
      setError(`Cannot provision virtual cluster: Core component versions are missing in registry (${missingCoreComponents.join(', ')}). Platform administrators must import or register core component versions first.`);
      return;
    }
    const overcommit = checkCapacityOvercommit();
    if (overcommit.isOverallocated && !ignoreCapacityCheck) {
      setError(`Cannot deploy: ${overcommit.errors[0]}. Reduce requested quotas or enable Administrator Overcommit Bypass.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const domain = selectedBaseline?.baseDomain || 'test.example.com';
      const fqdn = computeClusterFqdn(clusterName, domain);
      const hostsList = gatewayHost.trim()
        ? (gatewayHost.trim() === fqdn.wildcard ? fqdn.hosts : [gatewayHost.trim()])
        : fqdn.hosts;

      const parsedNamespaces = namespacesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: any = {
        clusterName: clusterName.trim().toLowerCase(),
        clusterType,
        ...(parsedNamespaces.length > 0 ? { namespaces: parsedNamespaces } : {}),
        baselineId: selectedBaselineId || (selectedBaseline ? selectedBaseline.id : 'dev-sandbox'),
        preset: sizePreset,
        owner: owner.trim() || 'Internal Developer Platform',
        allowedGroups: allowedGroups.split(',').map((s) => s.trim()).filter(Boolean),
        allowedEmails: allowedEmails.split(',').map((s) => s.trim()).filter(Boolean),
        clusterGroup: clusterGroup.trim() || undefined,
        clusterGroups: clusterGroup.trim() ? [clusterGroup.trim()] : undefined,
        environment,
        enableMonitoringAndDNS,
        autoSleep,
        ttlHours: autoSleep ? ttlHours : 0,
        kubernetesVersion,
        ...(clusterType !== 'namespaced' ? { vclusterVersion } : {}),
        ...(clusterType !== 'namespaced' && etcdVersion ? { etcdVersion } : {}),
        storageClass: storageClass.trim() || undefined,
        ...(clusterType !== 'namespaced' && etcdStorageClass.trim() ? { etcdStorageClass: etcdStorageClass.trim() } : {}),
        coreDNSVersion: coreDNSVersion || undefined,
        metricsServerVersion: metricsServerVersion || undefined,
        istioVersion: istioVersion || undefined,
        customYaml: customYaml.trim() ? customYaml : undefined,
        customCaCert: customCaCert.trim() || undefined,
        customCaSecret: customCaSecret.trim() || undefined,
        ...(clusterType !== 'namespaced'
          ? {
              disasterRecovery: {
                enabled: enableBackup,
                schedule: backupSchedule,
                retentionCount: backupRetention,
                storageSize: '10Gi',
                initialBackupRestore: deploymentMode === 'restore' ? (selectedRestoreSnapshot.trim() || undefined) : undefined,
              },
              initialBackupRestore: deploymentMode === 'restore' ? (selectedRestoreSnapshot.trim() || undefined) : undefined,
            }
          : { disasterRecovery: { enabled: false } }),
        customEndpoint: `https://${fqdn.primary}`,
        istio: enableIstio
          ? {
              enabled: true,
              meshEnabled: enableMesh,
              certificateIssuer: certIssuer.trim() || undefined,
              certificateIssuerKind: certIssuerKind,
              hosts: hostsList,
              version: istioVersion || undefined,
              hostRouting: enableHostRouting
                ? {
                    enabled: true,
                    defaultGateway: hostDefaultGateway.trim() || 'istio-system/default-gateway',
                    ingressGatewaySelector: parseSelector(hostGatewaySelector),
                    apiHost: hostApiHost.trim() || undefined,
                  }
                : { enabled: false },
            }
          : { enabled: false },
        gatewayAPI: enableGatewayAPI
          ? {
              enabled: true,
              gatewayClassName: gatewayClassName.trim() || 'eg',
              hosts: hostsList,
              certificateIssuer: certIssuer.trim() || undefined,
              certificateIssuerKind: certIssuerKind,
              gatewayConfig: {
                enabled: true,
                replicas: sizePreset === 'ha' || sizePreset === 'large' ? 3 : (gatewayReplicas || 1),
              },
              hostRouting: gatewayHostRoutingEnabled
                ? {
                    enabled: true,
                    defaultGateway: `${gatewayHostNamespace.trim() || 'envoy-gateway-system'}/${gatewayHostName.trim() || 'eg'}`,
                    apiHost: gatewayApiHost.trim() || undefined,
                  }
                : { enabled: false },
            }
          : { enabled: false },
        installedApps: selectedAppIds.map((id) => ({
          appId: id,
          customValues: customValuesMap[id],
        })),
        policies: {
          resourceQuota: {
            enabled: true,
            requestsCPU: requestsCPU.trim(),
            limitsCPU: limitsCPU.trim(),
            requestsMemory: requestsMemory.trim(),
            limitsMemory: limitsMemory.trim(),
            requestsStorage: requestsStorage.trim(),
            pods: pods.trim(),
            services: services.trim(),
            persistentVolumeClaims: persistentVolumeClaims.trim(),
            servicesLoadBalancers: servicesLoadBalancers.trim(),
            servicesNodePorts: servicesNodePorts.trim(),
            configMaps: configMaps.trim(),
            secrets: secrets.trim(),
          },
          limitRange: {
            enabled: true,
            defaultRequestCPU: defaultRequestCPU.trim(),
            defaultRequestMemory: defaultRequestMemory.trim(),
            defaultCPU: defaultCPU.trim(),
            defaultMemory: defaultMemory.trim(),
            maxCPU: maxCPU.trim(),
            maxMemory: maxMemory.trim(),
            minCPU: minCPU.trim(),
            minMemory: minMemory.trim(),
          },
        },
        ignoreCapacityCheck,
      };

      const res = await fetch('/api/vclusters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to provision cluster');
      }

      // Redirect to fleet dashboard
      window.location.href = `/clusters/${payload.clusterName}`;
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  // Live YAML preview
  const previewYaml = clusterType === 'namespaced' ? `apiVersion: vops.gitops.io/v1alpha1
kind: VirtualCluster
metadata:
  name: "${clusterName.trim().toLowerCase() || 'my-cluster'}"
  namespace: "${(namespacesInput.split(',')[0] || clusterName || 'my-cluster').trim().toLowerCase()}"
spec:
  clusterType: namespaced
  namespaces:
${(namespacesInput.trim() ? namespacesInput.split(',').map(s => s.trim()).filter(Boolean) : [clusterName.trim().toLowerCase() || 'my-cluster']).map(n => `    - "${n}"`).join('\n')}
  sizePreset: "${sizePreset}"
  policies:
    resourceQuota:
      enabled: true
      requestsCPU: "${requestsCPU}"
      limitsCPU: "${limitsCPU}"
      requestsMemory: "${requestsMemory}"
      limitsMemory: "${limitsMemory}"
      requestsStorage: "${requestsStorage}"
      pods: "${pods}"
      services: "${services}"
    limitRange:
      enabled: true
      defaultRequestCPU: "${defaultRequestCPU}"
      defaultRequestMemory: "${defaultRequestMemory}"
      defaultCPU: "${defaultCPU}"
      defaultMemory: "${defaultMemory}"${autoSleep ? '\n  lifecycle:\n    autoSleep: true' : ''}` : `controlPlane:
  distro:
    k8s:
      enabled: true
      version: "${kubernetesVersion}"
  backingStore:
    etcd:
      deploy:
        enabled: true
        statefulSet:
          highAvailability:
            replicas: ${sizePreset === 'normal' || sizePreset === 'small' ? 1 : 3}
          persistence:
            volumeClaim:
              size: "${selectedPresetDetails.storage.split(' ')[0]}Gi"${etcdStorageClass ? `\n              storageClass: "${etcdStorageClass}"` : ''}
  coreDNS:
    enabled: false # Reconciled externally as standalone cluster addon
integrations:
  metricsServer:
    enabled: false # Reconciled externally as standalone cluster addon
sync:
  toHost:
    pods:
      enabled: true
    services:
      enabled: true
    ingresses:
      enabled: true
  fromHost:
    nodes:
      enabled: true
policies:
  resourceQuota:
    enabled: true
    quota:
      requests.cpu: "${requestsCPU}"
      limits.cpu: "${limitsCPU}"
      requests.memory: "${requestsMemory}"
      limits.memory: "${limitsMemory}"
      requests.storage: "${requestsStorage}"
      count/pods: "${pods}"
      services: "${services}"
      persistentvolumeclaims: "${persistentVolumeClaims}"
  limitRange:
    enabled: true
    default:
      cpu: "${defaultCPU}"
      memory: "${defaultMemory}"
    defaultRequest:
      cpu: "${defaultRequestCPU}"
      memory: "${defaultRequestMemory}"${autoSleep ? '\n  autoSleep:\n    enabled: true' : ''}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Wizard Progress Bar / Developer Persona Banner */}
      {isDeveloper ? (
        <div className="bg-gradient-to-r from-amber-500/10 via-cyber-900 to-cyber-950 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                Developer Self-Service Baseline Provisioning
                <span className="text-[10px] font-mono text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/40 uppercase font-semibold">
                  Zero-Mistake Mode
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                Select an approved cluster baseline below, enter your cluster name, and deploy with 1 click. Low-level engine customizations are locked to guarantee stability.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-cyber-900/80 border border-cyber-700/60 rounded-2xl p-4 backdrop-blur-sm shadow-lg">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: 'Name & Identity', icon: Server },
              { num: 2, label: 'Size & Policies', icon: Layers },
              { num: 3, label: 'App Store ', icon: Package },
              { num: 4, label: 'Lifecycle & Launch', icon: Clock },
            ].map((item, idx) => {
              const Icon = item.icon;
              const isCompleted = step > item.num;
              const isCurrent = step === item.num;

              return (
                <React.Fragment key={item.num}>
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono text-xs font-bold transition-all ${
                        isCurrent
                          ? 'bg-cyber-accent text-slate-950 shadow-glow-sm'
                          : isCompleted
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-cyber-800 text-slate-500 border border-cyber-700'
                      }`}
                    >
                      {isCompleted ? <Check className="w-4 h-4" /> : item.num}
                    </div>
                    <div className="hidden sm:block">
                      <p className={`text-xs font-medium ${isCurrent ? 'text-white font-semibold' : 'text-slate-400'}`}>
                        {item.label}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono">Step 0{item.num}</p>
                    </div>
                  </div>
                  {idx < 3 && (
                    <div className="flex-1 mx-3 h-[2px] bg-cyber-800 rounded">
                      <div
                        className={`h-full transition-all duration-300 ${
                          step > idx + 1 ? 'bg-cyber-accent w-full' : 'w-0'
                        }`}
                      ></div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Missing Core Component Versions Warning Banner */}
      {!loadingVersions && missingCoreComponents.length > 0 && (
        <div className="p-5 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-rose-300 flex items-start gap-4 shadow-xl shadow-rose-950/30 animate-in fade-in">
          <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 shrink-0 mt-0.5">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div className="space-y-2 flex-1">
            <h4 className="text-sm font-bold text-rose-200 font-mono flex items-center gap-2">
              Virtual Cluster Provisioning Disabled: Core Component Versions Missing
            </h4>
            <p className="text-xs text-rose-300/90 leading-relaxed">
              Virtual clusters cannot be created because required core components have no registered versions in the Version Registry:
              <span className="font-semibold text-white ml-1 underline decoration-rose-500 underline-offset-2">{missingCoreComponents.join(', ')}</span>.
            </p>
            <div className="pt-1 text-xs flex flex-wrap items-center gap-3">
              {isAdmin ? (
                <a
                  href="/admin/versions"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 font-mono font-semibold transition-colors shadow-sm"
                >
                  <span>Open Version Registry to Import Manifest</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </a>
              ) : (
                <span className="text-rose-300/80 font-mono italic">
                  ⚠️ Platform Administrator action required: Please contact an administrator to import the platform manifest.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Wizard Form Container */}
      <div className="relative bg-cyber-900/90 border border-cyber-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md overflow-hidden">
        {/* Glow Accent */}
        <div className="absolute top-0 left-1/3 right-1/3 h-[1px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent"></div>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-400 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: Cluster Identity */}
        {step === 1 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-cyber-accent" />
                Cluster Identity & Baseline
              </h3>
            </div>

            {/* 1. CLUSTER ARCHITECTURE SELECTION (FIRST & PROMINENT) */}
            <div className="p-4 bg-cyber-950/90 border border-cyber-700/80 rounded-2xl space-y-3 shadow-lg shadow-cyan-950/10">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                    <Server className="w-4 h-4 text-cyan-400" />
                    <span>1. Cluster Architecture (Deployment Model)</span>
                  </label>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Select whether to deploy an isolated Virtual Cluster or a lightweight Host Namespaced Cluster.
                  </p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyber-900 border border-cyber-750 text-cyan-300 font-semibold">
                  Dual-Model Architecture
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setClusterType('vcluster')}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                    clusterType === 'vcluster'
                      ? 'bg-cyan-500/10 border-cyan-400 text-white shadow-sm ring-1 ring-cyan-500/30'
                      : 'bg-cyber-900/60 border-cyber-800 text-slate-400 hover:text-slate-200 hover:border-cyber-700'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${clusterType === 'vcluster' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>Virtual Cluster (vCluster)</span>
                      {clusterType === 'vcluster' && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5 leading-relaxed">
                      Dedicated virtual control plane, isolated API server, and private HA etcd store
                    </p>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-cyan-300">
                      <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800">Full API Isolation</span>
                      <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800">Dedicated CRDs</span>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setClusterType('namespaced');
                    setDeploymentMode('clean');
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                    clusterType === 'namespaced'
                      ? 'bg-purple-500/10 border-purple-400 text-white shadow-sm ring-1 ring-purple-500/30'
                      : 'bg-cyber-900/60 border-cyber-800 text-slate-400 hover:text-slate-200 hover:border-cyber-700'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${clusterType === 'namespaced' ? 'bg-purple-500/20 text-purple-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Server className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>Namespaced Cluster (Host)</span>
                      {clusterType === 'namespaced' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5 leading-relaxed">
                      Direct host cluster namespace(s) with resource quotas, limit ranges, and zero overhead
                    </p>
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono text-purple-300">
                      <span className="px-1.5 py-0.5 rounded bg-purple-950 border border-purple-800">Zero Overhead</span>
                      <span className="px-1.5 py-0.5 rounded bg-purple-950 border border-purple-800">Host Direct</span>
                    </div>
                  </div>
                </button>
              </div>

              {clusterType === 'namespaced' && (
                <div className="mt-3 p-3.5 bg-purple-950/20 border border-purple-500/30 rounded-xl space-y-2 animate-in fade-in">
                  <label className="block text-xs font-medium text-purple-200 font-mono">
                    Target Host Namespaces (Optional)
                  </label>
                  <input
                    type="text"
                    value={namespacesInput}
                    onChange={(e) => setNamespacesInput(e.target.value)}
                    placeholder="e.g. team-frontend, team-backend (defaults to cluster name if blank)"
                    className="w-full bg-cyber-950 border border-purple-500/40 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-[10px] text-slate-400 font-mono">
                    Quotas, LimitRanges, and scoped Kubeconfigs will be enforced across all specified host namespaces.
                  </p>
                </div>
              )}
            </div>

            {/* 2. PREDEFINED CLUSTER BASELINES */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    <span>2. Choose Predefined Cluster Baseline</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Predefined configuration with zero-touch wildcard Ingress. Select a baseline to deploy with 1 click.
                  </p>
                </div>
                {isAdmin && (
                  <a
                    href="/admin/baselines"
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1 hover:underline"
                  >
                    <span>Manage Baselines</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {baselines.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {baselines.map((b) => {
                    const isSelected = selectedBaselineId === b.id;
                    const fqdnPreview = computeClusterFqdn(clusterName || 'cluster', b.baseDomain);

                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => applyBaseline(b)}
                        className={`p-3.5 rounded-2xl border text-left transition-all relative flex flex-col justify-between ${
                          isSelected
                            ? 'bg-cyan-500/10 border-cyan-500 text-white shadow-md shadow-cyan-500/10 ring-1 ring-cyan-500/50'
                            : 'bg-cyber-950/60 border-cyber-800 hover:border-cyber-700 hover:bg-cyber-900/60 text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5 font-mono">
                              {b.name}
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                          </div>

                          <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2.5">
                            {b.description}
                          </p>
                        </div>

                        <div className="space-y-1 pt-2 border-t border-cyber-800/80 text-[10px] font-mono">
                          <div className="flex items-center justify-between text-slate-400">
                            <span>Tier:</span>
                            <span className="text-slate-200 uppercase font-semibold">{b.preset}</span>
                          </div>
                          <div className="flex items-center justify-between text-slate-400">
                            <span>etcd Drive:</span>
                            <span className="text-amber-300 font-semibold truncate max-w-[130px]" title={b.etcdStorageClass || 'Cluster Default'}>
                              {b.etcdStorageClass || 'Default'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-slate-400">
                            <span>Ingress:</span>
                            <span className="text-emerald-400 font-semibold">{fqdnPreview.wildcard}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 bg-cyber-950/60 rounded-xl border border-cyber-800 text-xs font-mono text-slate-400">
                  Loading predefined baselines...
                </div>
              )}
            </div>

            {/* Deployment Mode: Clean Instance vs Restore from DR Backup (vCluster only) */}
            {clusterType === 'vcluster' && (
              <div className="p-4 bg-cyber-950/70 border border-cyber-850 rounded-2xl space-y-3">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Deployment Mode
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDeploymentMode('clean')}
                    className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                      deploymentMode === 'clean'
                        ? 'bg-cyber-500/10 border-cyber-accent text-white shadow-sm'
                        : 'bg-cyber-900/60 border-cyber-800 text-slate-400 hover:text-slate-200 hover:border-cyber-700'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${deploymentMode === 'clean' ? 'bg-cyber-accent/20 text-cyber-accent' : 'bg-slate-800 text-slate-400'}`}>
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center justify-between">
                        Clean Instance
                        {deploymentMode === 'clean' && <Check className="w-3.5 h-3.5 text-cyber-accent" />}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Deploy a brand-new vcluster with fresh etcd state
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeploymentMode('restore')}
                    className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                      deploymentMode === 'restore'
                        ? 'bg-amber-500/10 border-amber-500 text-white shadow-sm'
                        : 'bg-cyber-900/60 border-cyber-800 text-slate-400 hover:text-slate-200 hover:border-cyber-700'
                    }`}
                  >
                    <div className={`p-2 rounded-lg ${deploymentMode === 'restore' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                      <RotateCcw className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center justify-between">
                        Restore from Backup
                        {deploymentMode === 'restore' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Seed cluster state from verified disaster recovery snapshot
                      </p>
                    </div>
                  </button>
                </div>

                {deploymentMode === 'restore' && (
                  <div className="mt-3 p-3.5 bg-cyber-900/80 border border-amber-500/30 rounded-xl space-y-2.5 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5 font-mono">
                        <RotateCcw className="w-3.5 h-3.5" />
                        Select Snapshot to Restore
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {loadingBackups ? 'Querying fleet backups...' : `${availableBackups.length} snapshots available`}
                      </span>
                    </div>

                    {availableBackups.length > 0 ? (
                      <div className="space-y-2">
                        <select
                          value={selectedRestoreSnapshot}
                          onChange={(e) => setSelectedRestoreSnapshot(e.target.value)}
                          className="w-full bg-cyber-950 border border-cyber-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                        >
                          {availableBackups.map((b) => (
                            <option key={b.filename || b.name} value={b.filename || b.name}>
                              {b.filename || b.name} — ({b.clusterOrigin}, {b.size || '5.8 MB'}, {new Date(b.timestamp).toLocaleDateString()})
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-slate-400 font-mono">
                          The new cluster will initialize its etcd backing store from this snapshot before serving API requests.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={selectedRestoreSnapshot}
                          onChange={(e) => setSelectedRestoreSnapshot(e.target.value)}
                          placeholder="e.g. vc-dev-snapshot-latest.db or specific-snapshot.db"
                          className="w-full bg-cyber-950 border border-cyber-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                        />
                        <p className="text-[10px] text-slate-400 font-mono">
                          Specify snapshot file name to restore from shared DR storage.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Cluster Identifier <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clusterName}
                    onChange={(e) => handleClusterNameChange(e.target.value)}
                    placeholder="e.g. checkout-service-test"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-3 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent transition-colors"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 font-mono">
                  Kubernetes DNS-1123 format: lowercase alphanumeric, hyphens allowed.
                </p>

                {/* Automated Wildcard Ingress Preview Banner */}
                <div className="mt-3 p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2.5 text-slate-200">
                    <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <span className="text-slate-400">Preconfigured Ingress: </span>
                      <span className="text-emerald-400 font-bold">
                        *.{clusterName.trim() || 'vcluster-name'}.{selectedBaseline?.baseDomain || 'test.example.com'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-cyan-300/90 bg-cyan-900/60 px-2 py-0.5 rounded-full border border-cyan-500/30">
                    Zero-Touch Ingress
                  </span>
                </div>

                {/* 1-Click Deploy Callout for Non-Technical Users */}
                <div className="mt-3 p-4 rounded-2xl bg-gradient-to-r from-cyber-900 via-cyber-900 to-cyber-950 border border-cyber-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-white font-mono flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>Ready to Deploy from Baseline</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Selected: <strong className="text-cyan-300">{selectedBaseline?.name || 'Developer Sandbox'}</strong> ({sizePreset.toUpperCase()} Tier • etcd Drive: <strong className="text-amber-300">{etcdStorageClass || 'Default'}</strong>). No further technical steps required.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      disabled={submitting || missingCoreComponents.length > 0}
                      onClick={handleQuickLaunch}
                      title={missingCoreComponents.length > 0 ? `Disabled: Missing core component versions (${missingCoreComponents.join(', ')})` : '1-Click Deploy from Baseline'}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs font-mono shadow-lg shadow-cyan-500/25 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                    >
                      {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 stroke-[2.5]" />}
                      <span>1-Click Deploy</span>
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="px-3.5 py-2.5 rounded-xl bg-cyber-950 hover:bg-cyber-800 border border-cyber-700 text-xs font-mono text-slate-300 hover:text-white transition-colors"
                        title="Customize underlying compute, storage, apps, and Istio settings"
                      >
                        <span>Customize →</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Team or Owner
                  </label>
                  <input
                    type="text"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    placeholder="e.g. Core Commerce Team"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Environment Tier
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['development', 'staging', 'production'] as const).map((env) => (
                      <button
                        key={env}
                        type="button"
                        onClick={() => setEnvironment(env)}
                        className={`py-2 px-3 rounded-xl text-xs font-medium capitalize border transition-all ${
                          environment === env
                            ? 'bg-cyber-accent/15 text-cyber-accent border-cyber-accent/40 font-semibold shadow-glow-sm'
                            : 'bg-cyber-850 text-slate-400 border-cyber-800 hover:text-white'
                        }`}
                      >
                        {env}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* RBAC Access Delegation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-cyber-850">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Authorized Groups (RBAC)
                  </label>
                  <input
                    type="text"
                    value={allowedGroups}
                    onChange={(e) => setAllowedGroups(e.target.value)}
                    placeholder="e.g. developers, data-platform"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Comma-separated groups with read + kubeconfig access</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Authorized User Emails (RBAC)
                  </label>
                  <input
                    type="text"
                    value={allowedEmails}
                    onChange={(e) => setAllowedEmails(e.target.value)}
                    placeholder="e.g. dev@vops.local, user@company.com"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Comma-separated user emails with read + kubeconfig access</p>
                </div>
              </div>

              {/* Cluster Grouping */}
              <div className="pt-2 border-t border-cyber-850">
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-cyan-400" />
                    Cluster Group (Fleet Organization)
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Optional</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={clusterGroup}
                    onChange={(e) => setClusterGroup(e.target.value)}
                    placeholder="e.g. backend-services, fintech, ai-agents"
                    className="w-full bg-cyber-950/80 border border-cyber-700 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-cyber-accent font-mono transition-colors"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Organize clusters into logical groupings for fleet management and search filtering.
                </p>
                {fleetGroups.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-[10px] text-slate-400 font-mono">Existing groups:</span>
                    {fleetGroups.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setClusterGroup(g)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                          clusterGroup === g
                            ? 'bg-cyan-500 text-slate-950 font-bold'
                            : 'bg-cyber-800 text-cyan-400 hover:bg-cyber-750 border border-cyber-700'
                        }`}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Sizing Tiers */}
        {step === 2 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Layers className="w-5 h-5 text-cyber-accent" />
                Resource Tier & Sizing
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {presets.filter((p) => p.id !== 'custom').map((preset) => {
                const isSelected = sizePreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`cursor-pointer relative flex flex-col justify-between p-5 rounded-2xl border transition-all duration-200 ${
                      isSelected
                        ? 'bg-cyber-800/80 border-cyber-accent shadow-glow-md'
                        : 'bg-cyber-850/50 border-cyber-800 hover:border-cyber-700 hover:bg-cyber-850'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 bg-cyber-accent text-slate-950 text-[10px] font-bold font-mono rounded-full uppercase">
                        Selected
                      </div>
                    )}
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-base font-bold text-white">{preset.name}</h4>
                        <span className="text-[10px] font-mono text-slate-400 bg-cyber-950 px-2 py-0.5 rounded border border-cyber-800">
                          {preset.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>

                    <div className="space-y-2 pt-4 border-t border-cyber-800/80 font-mono text-xs">
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Compute:</span>
                        <span className="font-semibold">{preset.cpu}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Memory:</span>
                        <span className="font-semibold">{preset.memory}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Storage:</span>
                        <span className="font-semibold">{preset.storage}</span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span className="text-slate-500">Topology:</span>
                        <span className={preset.ha ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>
                          {preset.ha ? '3x etcd / 3x vcluster / 3x coredns' : '1x etcd / 1x vcluster / 1x coredns'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Host Headroom & Overallocation Meter */}
            {clusterCapacity && (() => {
              const overcommit = checkCapacityOvercommit();
              const reqCpu = parseCpuMillis(requestsCPU);
              const reqMem = parseMemoryBytes(requestsMemory);

              const cpuPctOfAvail = clusterCapacity.availableCpuMillis > 0
                ? Math.round((reqCpu / clusterCapacity.availableCpuMillis) * 100)
                : 100;
              const memPctOfAvail = clusterCapacity.availableMemoryBytes > 0
                ? Math.round((reqMem / clusterCapacity.availableMemoryBytes) * 100)
                : 100;

              return (
                <div className={`p-4 rounded-2xl border transition-all ${
                  overcommit.isOverallocated && !ignoreCapacityCheck
                    ? 'bg-rose-950/40 border-rose-500/50 shadow-glow-rose'
                    : 'bg-cyber-900/60 border-cyber-700/70'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                      {overcommit.isOverallocated && !ignoreCapacityCheck ? (
                        <AlertOctagon className="w-5 h-5 text-rose-400 animate-pulse" />
                      ) : (
                        <ShieldCheck className="w-5 h-5 text-emerald-400" />
                      )}
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase text-white flex items-center gap-2">
                          Host Cluster Headroom Impact
                          {overcommit.isOverallocated ? (
                            <span className={`text-[10px] px-2 py-0.2 rounded border ${
                              ignoreCapacityCheck
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            }`}>
                              {ignoreCapacityCheck ? 'Overcommit Override Active' : 'Overcommit Blocked'}
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              Fits Headroom
                            </span>
                          )}
                        </h4>
                        <span className="text-[11px] text-slate-400 block font-mono">
                          Available: {clusterCapacity.availableCpuStr} CPU • {clusterCapacity.availableMemoryStr} RAM • {clusterCapacity.availableStorageStr} Storage
                        </span>
                      </div>
                    </div>

                    <div className="text-xs font-mono text-slate-300 flex items-center gap-3">
                      <span>Demand: <strong className="text-white">{requestsCPU} CPU</strong> ({cpuPctOfAvail}%)</span>
                      <span>•</span>
                      <span><strong className="text-white">{requestsMemory} RAM</strong> ({memPctOfAvail}%)</span>
                    </div>
                  </div>

                  {overcommit.isOverallocated ? (
                    <div className="space-y-3 pt-2 border-t border-rose-800/40">
                      <div className="text-xs text-rose-300 space-y-1">
                        {overcommit.errors.map((err, i) => (
                          <div key={i} className="flex items-start gap-1.5 font-mono text-[11px]">
                            <span className="text-rose-400">✕</span>
                            <span>{err}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between pt-2 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                          <input
                            type="checkbox"
                            checked={ignoreCapacityCheck}
                            onChange={(e) => setIgnoreCapacityCheck(e.target.checked)}
                            className="rounded border-cyber-700 bg-cyber-900 text-cyan-500 focus:ring-0"
                          />
                          <span className="font-mono text-[11px] text-amber-300">
                            Administrator Override: Force overcommit (bypasses capacity check)
                          </span>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-cyber-800/80 text-[11px] font-mono text-slate-400 flex items-center justify-between">
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        Guaranteed capacity available on host cluster nodes.
                      </span>
                      <span>Host: {clusterCapacity.allocatableCpuStr} / {clusterCapacity.allocatableMemoryStr} total</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* etcd Database Storage Engine & StorageClass (vCluster only) */}
            {clusterType === 'vcluster' ? (
              <div className="p-5 bg-cyber-950/80 border border-amber-500/30 rounded-2xl space-y-4 shadow-lg shadow-amber-950/10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-cyber-800/80">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                        etcd Database Storage Engine
                        <span className="text-[10px] font-mono text-amber-400/90 uppercase font-semibold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                          High-IOPS Drive
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Dedicated backing volume for cluster state database
                      </p>
                    </div>
                  </div>
                  {etcdStorageClass ? (
                    <span className="text-xs font-mono text-amber-300 bg-amber-950/60 px-2.5 py-1 rounded-lg border border-amber-500/40 self-start sm:self-auto flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5" />
                      {etcdStorageClass}
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-slate-400 bg-cyber-900 px-2.5 py-1 rounded-lg border border-cyber-800 self-start sm:self-auto">
                      Default Host StorageClass
                    </span>
                  )}
                </div>

                <div className="p-3 bg-amber-950/20 border border-amber-500/20 rounded-xl flex items-start gap-2.5 text-xs text-amber-200/90 font-mono leading-relaxed">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-amber-300">Fast Disk / SSD Required: </strong>
                    etcd is a consensus state database that depends heavily on sequential write-ahead log (WAL) fsync speed. Selecting an SSD or NVMe-backed StorageClass avoids leader election timeouts and cluster latency spikes.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-200 font-mono flex items-center justify-between">
                      <span>Host StorageClass</span>
                      <span className="text-[10px] text-slate-400">Autodetected ({storageClasses.length})</span>
                    </label>
                    <select
                      value={etcdStorageClass}
                      onChange={(e) => setEtcdStorageClass(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-900 border border-amber-500/40 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                    >
                      <option value="">Cluster Default StorageClass</option>
                      {storageClasses.map((sc) => (
                        <option key={sc.name} value={sc.name}>
                          {sc.name} {sc.isDefault ? '(Default)' : ''} — {sc.provisioner}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-200 font-mono">
                      Custom StorageClass Override
                    </label>
                    <input
                      type="text"
                      value={etcdStorageClass}
                      onChange={(e) => setEtcdStorageClass(e.target.value)}
                      placeholder="e.g. fast-nvme, local-ssd, gp3-fast"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-cyber-900 border border-cyber-700 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-cyber-950/70 border border-purple-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/30">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                      Host-Native Namespaces
                      <span className="text-[10px] font-mono text-purple-400 uppercase font-semibold bg-purple-950/60 px-2 py-0.5 rounded border border-purple-500/30">
                        Zero Overhead
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-400 font-mono">
                      No private etcd database or virtual syncer needed. Workloads deploy directly onto the host Kubernetes cluster.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded-lg border border-purple-500/40 self-start sm:self-auto">
                  Host Direct
                </span>
              </div>
            )}

            {/* Collapsible Quota & Policy Tuning */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowQuotaOverrides(!showQuotaOverrides)}
                className="flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-cyber-accent transition-colors"
              >
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>
                  {showQuotaOverrides
                    ? 'Hide Dynamic Quota Customization'
                    : 'Customize Resource Quotas & LimitRange (Optional)'}
                </span>
                <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20 font-mono">
                  {requestsCPU} CPU / {requestsMemory} RAM / {requestsStorage}
                </span>
              </button>

              {showQuotaOverrides && (
                <div className="mt-4 p-5 bg-cyber-950 border border-cyber-800 rounded-2xl space-y-5 animate-in fade-in duration-150">
                  <div>
                    <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                      Resource Quota Bounds
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Requests CPU:</label>
                      <input
                        type="text"
                        value={requestsCPU}
                        onChange={(e) => setRequestsCPU(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Limits CPU:</label>
                      <input
                        type="text"
                        value={limitsCPU}
                        onChange={(e) => setLimitsCPU(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Requests Storage:</label>
                      <input
                        type="text"
                        value={requestsStorage}
                        onChange={(e) => setRequestsStorage(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Requests Memory:</label>
                      <input
                        type="text"
                        value={requestsMemory}
                        onChange={(e) => setRequestsMemory(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Limits Memory:</label>
                      <input
                        type="text"
                        value={limitsMemory}
                        onChange={(e) => setLimitsMemory(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max Pods:</label>
                      <input
                        type="text"
                        value={pods}
                        onChange={(e) => setPods(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max Services:</label>
                      <input
                        type="text"
                        value={services}
                        onChange={(e) => setServices(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max PVCs:</label>
                      <input
                        type="text"
                        value={persistentVolumeClaims}
                        onChange={(e) => setPersistentVolumeClaims(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">LoadBalancer Svc:</label>
                      <input
                        type="text"
                        value={servicesLoadBalancers}
                        onChange={(e) => setServicesLoadBalancers(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">NodePort Svc:</label>
                      <input
                        type="text"
                        value={servicesNodePorts}
                        onChange={(e) => setServicesNodePorts(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max ConfigMaps:</label>
                      <input
                        type="text"
                        value={configMaps}
                        onChange={(e) => setConfigMaps(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 text-[11px]">Max Secrets:</label>
                      <input
                        type="text"
                        value={secrets}
                        onChange={(e) => setSecrets(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-cyber-800">
                    <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Sliders className="w-3.5 h-3.5 text-purple-400" />
                      LimitRange Defaults
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Req CPU:</label>
                        <input
                          type="text"
                          value={defaultRequestCPU}
                          onChange={(e) => setDefaultRequestCPU(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Req Mem:</label>
                        <input
                          type="text"
                          value={defaultRequestMemory}
                          onChange={(e) => setDefaultRequestMemory(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Limit CPU:</label>
                        <input
                          type="text"
                          value={defaultCPU}
                          onChange={(e) => setDefaultCPU(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Default Limit Mem:</label>
                        <input
                          type="text"
                          value={defaultMemory}
                          onChange={(e) => setDefaultMemory(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Max CPU:</label>
                        <input
                          type="text"
                          value={maxCPU}
                          onChange={(e) => setMaxCPU(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Max Memory:</label>
                        <input
                          type="text"
                          value={maxMemory}
                          onChange={(e) => setMaxMemory(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Min CPU:</label>
                        <input
                          type="text"
                          value={minCPU}
                          onChange={(e) => setMinCPU(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 text-[11px]">Min Memory:</label>
                        <input
                          type="text"
                          value={minMemory}
                          onChange={(e) => setMinMemory(e.target.value)}
                          className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-400"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 3: App Store & Application  */}
        {step === 3 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Package className="w-5 h-5 text-cyan-400" />
                  App Store & Addons
                </h3>
              </div>
              <span className="text-xs font-mono text-cyan-400 bg-cyan-950/60 px-3 py-1 rounded-xl border border-cyan-800/80 self-start sm:self-auto">
                {selectedAppIds.length} Application{selectedAppIds.length !== 1 ? 's' : ''} Selected
              </span>
            </div>

            {/* OPINIONATED CORE APP ENTRYPOINT: GATEWAYS & ROUTING */}
            <div className="bg-cyber-950/80 border border-cyan-500/30 rounded-2xl p-5 shadow-glow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-cyber-850">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-400 rounded-xl shrink-0">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white">Ingress & Edge Routing Entrypoint</h4>
                      <span className="text-[10px] font-mono uppercase bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800 font-bold">
                        Opinionated Stack
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Select how incoming HTTP/HTTPS traffic enters your virtual cluster.
                    </p>
                  </div>
                </div>
              </div>

              {/* Provider Selection Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setIngressProvider('gateway-api')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    ingressProvider === 'gateway-api'
                      ? 'bg-blue-950/40 border-blue-500/60 shadow-glow-sm ring-1 ring-blue-500/50'
                      : 'bg-cyber-900/50 border-cyber-800 hover:border-cyber-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${ingressProvider === 'gateway-api' ? 'bg-blue-400' : 'bg-slate-500'}`} />
                      Gateway API
                    </span>
                    <span className="text-[9px] font-mono uppercase bg-blue-950 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800">
                      Standard
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Kubernetes Gateway API with Envoy proxy, HTTPRoute redirects, and host Envoy integration.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIngressProvider('istio')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    ingressProvider === 'istio'
                      ? 'bg-cyan-950/40 border-cyan-500/60 shadow-glow-sm ring-1 ring-cyan-500/50'
                      : 'bg-cyber-900/50 border-cyber-800 hover:border-cyber-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${ingressProvider === 'istio' ? 'bg-cyan-400' : 'bg-slate-500'}`} />
                      Istio Mesh & Gateway
                    </span>
                    <span className="text-[9px] font-mono uppercase bg-cyan-950 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800">
                      Mesh
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Dedicated istiod control plane and ingress gateway (ports 80/443) with optional sidecar mTLS.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIngressProvider('none')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    ingressProvider === 'none'
                      ? 'bg-slate-900/60 border-slate-600 shadow-glow-sm ring-1 ring-slate-500/50'
                      : 'bg-cyber-900/50 border-cyber-800 hover:border-cyber-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${ingressProvider === 'none' ? 'bg-slate-400' : 'bg-slate-600'}`} />
                      Direct Syncer Only
                    </span>
                    <span className="text-[9px] font-mono uppercase bg-cyber-950 text-slate-400 px-1.5 py-0.5 rounded border border-cyber-800">
                      None
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    No ingress controller deployed. Reach services via standard vCluster service synchronization.
                  </p>
                </button>
              </div>

              {/* Provider Config: Kubernetes Gateway API */}
              {ingressProvider === 'gateway-api' && (
                <div className="space-y-4 pt-1">
                  {/* HA Gateway Notice */}
                  {(sizePreset === 'ha' || sizePreset === 'large') && (
                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-300 text-xs font-mono">
                      <Zap className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>
                        <strong className="text-white">High Availability Mode:</strong> Gateway API will automatically provision <strong className="text-blue-200">3 Envoy proxy replicas</strong> for multi-replica resilience.
                      </span>
                    </div>
                  )}

                  {/* Cert-Manager Host Issuer Configuration */}
                  <div className="p-3.5 rounded-xl bg-cyber-900/60 border border-cyber-800 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-blue-400" />
                        <span>Host Cert-Manager Issuer & TLS Certificate</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="certIssuerKind"
                            value="ClusterIssuer"
                            checked={certIssuerKind === 'ClusterIssuer'}
                            onChange={() => setCertIssuerKind('ClusterIssuer')}
                            className="text-blue-500 focus:ring-blue-500"
                          />
                          ClusterIssuer
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="certIssuerKind"
                            value="Issuer"
                            checked={certIssuerKind === 'Issuer'}
                            onChange={() => setCertIssuerKind('Issuer')}
                            className="text-blue-500 focus:ring-blue-500"
                          />
                          Issuer (Namespace)
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Certificate Issuer Name
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={certIssuer}
                            onChange={(e) => setCertIssuer(e.target.value)}
                            placeholder="e.g. letsencrypt-prod, vault-issuer, selfsigned-ca"
                            list="discovered-issuers-list"
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                          />
                          <datalist id="discovered-issuers-list">
                            {(certIssuerKind === 'ClusterIssuer' ? hostCertIssuers.clusterIssuers : hostCertIssuers.issuers)?.map((name) => (
                              <option key={name} value={name} />
                            ))}
                          </datalist>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Entrypoint Host FQDN
                        </label>
                        <input
                          type="text"
                          value={gatewayHost}
                          onChange={(e) => setGatewayHost(e.target.value)}
                          placeholder={clusterName ? `${clusterName.trim().toLowerCase()}.example.com` : 'e.g. vc-dev.example.com'}
                          className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                        />
                      </div>
                    </div>

                    {/* Pre-Creation Alert Check */}
                    {certIssuer.trim() && (
                      <div>
                        {!hostCertIssuers.installed ? (
                          <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold text-rose-200">Host Cert-Manager Missing:</strong> Cert-manager CRDs are not detected on the host cluster. Deployment will abort with an error unless a valid cert-manager issuer is present.
                            </div>
                          </div>
                        ) : certIssuerKind === 'ClusterIssuer' && !hostCertIssuers.clusterIssuers.includes(certIssuer.trim()) ? (
                          <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-start gap-2.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold text-amber-200">Issuer Not Found on Host:</strong> ClusterIssuer <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono text-white">{certIssuer.trim()}</code> was not detected in the host cluster.
                            </div>
                          </div>
                        ) : certIssuerKind === 'Issuer' && !hostCertIssuers.issuers.includes(certIssuer.trim()) ? (
                          <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-start gap-2.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold text-amber-200">Issuer Not Found:</strong> Namespaced Issuer <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono text-white">{certIssuer.trim()}</code> was not detected.
                            </div>
                          </div>
                        ) : (
                          <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in duration-150">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>Valid {certIssuerKind} <strong className="font-mono text-white">{certIssuer.trim()}</strong> verified on host cluster.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Gateway API Specs */}
                  <div className="p-3.5 rounded-xl bg-cyber-900/60 border border-cyber-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-xs font-bold text-slate-200">In-Guest Gateway API Specifications</span>
                      </div>
                      <span className="text-[10px] font-mono text-blue-400 bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-800">
                        gateway.networking.k8s.io/v1
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          GatewayClass Name
                        </label>
                        <input
                          type="text"
                          value={gatewayClassName}
                          onChange={(e) => setGatewayClassName(e.target.value)}
                          placeholder="eg"
                          className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">In-cluster GatewayClass controller reference.</p>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Guest Gateway Name
                        </label>
                        <input
                          type="text"
                          value={gatewayDefaultName}
                          onChange={(e) => setGatewayDefaultName(e.target.value)}
                          placeholder="default-gateway"
                          className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Default Gateway resource in tenant namespace.</p>
                      </div>
                    </div>
                  </div>

                  {/* Host-Level Gateway API Routing */}
                  <div className="p-3.5 rounded-xl bg-cyber-900/60 border border-cyber-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Network className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-xs font-bold text-slate-200">Host Envoy Gateway Routing</span>
                          <span className="text-[10px] font-mono text-blue-400 bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-800">
                            Host Integration
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Creates host-level HTTPRoutes pointing directly to the synced guest gateway service.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={gatewayHostRoutingEnabled}
                          onChange={(e) => setGatewayHostRoutingEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {gatewayHostRoutingEnabled && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-cyber-800/80 animate-in fade-in duration-150">
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                            Host Gateway Name
                          </label>
                          <input
                            type="text"
                            value={gatewayHostName}
                            onChange={(e) => setGatewayHostName(e.target.value)}
                            placeholder="eg"
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Host Envoy Gateway name.</p>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                            Host Gateway Namespace
                          </label>
                          <input
                            type="text"
                            value={gatewayHostNamespace}
                            onChange={(e) => setGatewayHostNamespace(e.target.value)}
                            placeholder="envoy-gateway-system"
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Host Gateway namespace.</p>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                            vCluster API Hostname
                          </label>
                          <input
                            type="text"
                            value={gatewayApiHost}
                            onChange={(e) => setGatewayApiHost(e.target.value)}
                            placeholder={clusterName ? `api.${clusterName.trim().toLowerCase()}.example.com` : 'api.cluster.example.com'}
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Optional host routing for API server.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Provider Config: Istio */}
              {ingressProvider === 'istio' && (
                <div className="space-y-4 pt-1">
                  {/* HA Istio Notice */}
                  {(sizePreset === 'ha' || sizePreset === 'large') && (
                    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs font-mono">
                      <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span>
                        <strong className="text-white">High Availability Mode:</strong> Istio will automatically provision <strong className="text-cyan-200">3 istiod control plane replicas</strong> and <strong className="text-cyan-200">3 ingress gateway replicas</strong> for multi-replica resilience.
                      </span>
                    </div>
                  )}

                  {/* Service Mesh Toggle */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-cyber-900/60 border border-cyber-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-200">Service Mesh Sidecar Injection</span>
                        <span className="text-[10px] font-mono text-slate-400 bg-cyber-800 px-1.5 py-0.5 rounded">
                          Optional
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Disabled by default. When enabled, workloads can receive automatic Envoy sidecar proxies for mTLS.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={enableMesh}
                        onChange={(e) => setEnableMesh(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                  </div>

                  {/* Cert-Manager Host Issuer Configuration */}
                  <div className="p-3.5 rounded-xl bg-cyber-900/60 border border-cyber-800 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Host Cert-Manager Issuer & TLS Certificate</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="certIssuerKind"
                            value="ClusterIssuer"
                            checked={certIssuerKind === 'ClusterIssuer'}
                            onChange={() => setCertIssuerKind('ClusterIssuer')}
                            className="text-cyan-500 focus:ring-cyan-500"
                          />
                          ClusterIssuer
                        </label>
                        <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="certIssuerKind"
                            value="Issuer"
                            checked={certIssuerKind === 'Issuer'}
                            onChange={() => setCertIssuerKind('Issuer')}
                            className="text-cyan-500 focus:ring-cyan-500"
                          />
                          Issuer (Namespace)
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Certificate Issuer Name
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={certIssuer}
                            onChange={(e) => setCertIssuer(e.target.value)}
                            placeholder="e.g. letsencrypt-prod, vault-issuer, selfsigned-ca"
                            list="discovered-issuers-list"
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                          />
                          <datalist id="discovered-issuers-list">
                            {(certIssuerKind === 'ClusterIssuer' ? hostCertIssuers.clusterIssuers : hostCertIssuers.issuers)?.map((name) => (
                              <option key={name} value={name} />
                            ))}
                          </datalist>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                          Entrypoint Host FQDN
                        </label>
                        <input
                          type="text"
                          value={gatewayHost}
                          onChange={(e) => setGatewayHost(e.target.value)}
                          placeholder={clusterName ? `${clusterName.trim().toLowerCase()}.example.com` : 'e.g. vc-dev.example.com'}
                          className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                        />
                      </div>
                    </div>

                    {/* Pre-Creation Alert Check */}
                    {certIssuer.trim() && (
                      <div>
                        {!hostCertIssuers.installed ? (
                          <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold text-rose-200">Host Cert-Manager Missing:</strong> Cert-manager CRDs are not detected on the host cluster. Deployment will abort with an error unless a valid cert-manager issuer is present.
                            </div>
                          </div>
                        ) : certIssuerKind === 'ClusterIssuer' && !hostCertIssuers.clusterIssuers.includes(certIssuer.trim()) ? (
                          <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-start gap-2.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold text-amber-200">Issuer Not Found on Host:</strong> ClusterIssuer <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono text-white">{certIssuer.trim()}</code> was not detected in the host cluster. Deployment will fail-closed and abort unless this issuer is created.
                            </div>
                          </div>
                        ) : certIssuerKind === 'Issuer' && !hostCertIssuers.issuers.includes(certIssuer.trim()) ? (
                          <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-xl text-xs text-amber-300 flex items-start gap-2.5 animate-in fade-in duration-150">
                            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold text-amber-200">Issuer Not Found:</strong> Namespaced Issuer <code className="bg-amber-900/60 px-1 py-0.5 rounded font-mono text-white">{certIssuer.trim()}</code> was not detected. Deployment will abort unless this issuer exists.
                            </div>
                          </div>
                        ) : (
                          <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-in fade-in duration-150">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>Valid {certIssuerKind} <strong className="font-mono text-white">{certIssuer.trim()}</strong> verified on host cluster.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Host-Level Ingress Routing & API Passthrough */}
                  <div className="p-3.5 rounded-xl bg-cyber-900/60 border border-cyber-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Network className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="text-xs font-bold text-slate-200">Host Istio Ingress & API Passthrough</span>
                          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800">
                            Host Integration
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Deploys a host DestinationRule (<code className="text-cyan-300">MUTUAL TLS</code>, <code className="text-cyan-300">DO_NOT_UPGRADE</code>), application VirtualService, and a TLS Passthrough Gateway on Port 443 for the vCluster API.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={enableHostRouting}
                          onChange={(e) => setEnableHostRouting(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-cyber-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-cyber-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
                      </label>
                    </div>

                    {enableHostRouting && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-cyber-800/80 animate-in fade-in duration-150">
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                            Default Host Gateway
                          </label>
                          <input
                            type="text"
                            value={hostDefaultGateway}
                            onChange={(e) => setHostDefaultGateway(e.target.value)}
                            placeholder="istio-system/default-gateway"
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Host gateway for app traffic.</p>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                            Ingress Gateway Selector
                          </label>
                          <input
                            type="text"
                            value={hostGatewaySelector}
                            onChange={(e) => setHostGatewaySelector(e.target.value)}
                            placeholder="istio: ingressgateway"
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">Pod label for host ingress gateway.</p>
                        </div>

                        <div>
                          <label className="block text-[10px] font-mono uppercase text-slate-400 mb-1">
                            vCluster API Hostname
                          </label>
                          <input
                            type="text"
                            value={hostApiHost}
                            onChange={(e) => setHostApiHost(e.target.value)}
                            placeholder={clusterName ? `api.${clusterName.trim().toLowerCase()}.example.com` : 'api.cluster.example.com'}
                            className="w-full bg-cyber-950 border border-cyber-700/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none font-mono"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">SNI host for TLS passthrough to API.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Provider Config: None */}
              {ingressProvider === 'none' && (
                <div className="p-4 rounded-xl bg-cyber-900/40 border border-cyber-800 text-xs text-slate-400">
                  <p>
                    Workloads will be accessible via standard internal cluster service networking. You can enable Istio or Gateway API at any time later via the Cluster Settings.
                  </p>
                </div>
              )}
            </div>

            {/* Curated  Quick Selector */}
            {catalog?.groups && catalog.groups.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span>Curated Application  (1-Click Select)</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {catalog.groups.map((group) => {
                    const allSelected = group.appIds.length > 0 && group.appIds.every((id) => selectedAppIds.includes(id));
                    return (
                      <div
                        key={group.id}
                        onClick={() => {
                          if (allSelected) {
                            setSelectedAppIds(selectedAppIds.filter((id) => !group.appIds.includes(id)));
                          } else {
                            const newSet = new Set([...selectedAppIds, ...group.appIds]);
                            setSelectedAppIds(Array.from(newSet));
                            for (const id of group.appIds) {
                              const appObj = catalog.apps.find((a) => a.id === id);
                              if (appObj?.helm?.values && !customValuesMap[id]) {
                                setCustomValuesMap((prev) => ({ ...prev, [id]: appObj.helm!.values! }));
                              }
                            }
                          }
                        }}
                        className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                          allSelected
                            ? 'bg-purple-950/40 border-purple-500/60 shadow-glow-sm'
                            : 'bg-cyber-950 border-cyber-800 hover:border-cyber-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-white">{group.name}</h4>
                          <span
                            className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold ${
                              allSelected ? 'bg-purple-500 text-white' : 'border border-cyber-700'
                            }`}
                          >
                            {allSelected && <Check className="w-3 h-3" />}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{group.description}</p>
                        <div className="mt-2 text-[10px] font-mono text-purple-400">
                          {group.appIds.length} apps: {group.appIds.join(', ')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Individual Applications Grid */}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5 uppercase font-mono tracking-wider">
                <Package className="w-3.5 h-3.5 text-cyan-400" />
                <span>Available Applications & Microservices</span>
              </label>

              <div className="space-y-3">
                {(!catalog?.apps || catalog.apps.length === 0) ? (
                  <div className="p-8 text-center bg-cyber-950/60 rounded-2xl border border-dashed border-cyber-800">
                    <Package className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-slate-300">App Store is Clean & Empty</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                      No applications have been added to the catalog yet. You can continue to the next step and deploy applications post-launch once published.
                    </p>
                  </div>
                ) : (
                  (catalog?.apps || []).map((app) => {
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
                          onClick={() => {
                            if (isSelected) {
                              setSelectedAppIds(selectedAppIds.filter((id) => id !== app.id));
                            } else {
                              setSelectedAppIds([...selectedAppIds, app.id]);
                              if (app.helm?.values && !customValuesMap[app.id]) {
                                setCustomValuesMap((prev) => ({ ...prev, [app.id]: app.helm!.values! }));
                              }
                            }
                          }}
                          className="p-3.5 flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                isSelected
                                  ? 'bg-cyan-500 border-cyan-500 text-slate-950'
                                  : 'border-cyber-700 bg-cyber-900'
                              }`}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white">{app.name}</span>
                                <span className="text-[10px] font-mono text-slate-500">v{app.version}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyber-900 border border-cyber-800 text-cyan-400 font-mono">
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
                                  setSelectedAppIds([...selectedAppIds, app.id]);
                                  if (app.helm?.values && !customValuesMap[app.id]) {
                                    setCustomValuesMap((prev) => ({ ...prev, [app.id]: app.helm!.values! }));
                                  }
                                }
                                setExpandedValueAppId(isExpanded ? null : app.id);
                              }}
                              className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyber-900 border border-cyber-800 hover:border-cyan-500/30 transition-colors shrink-0 ml-2"
                            >
                              <Sliders className="w-3 h-3" />
                              <span>{isExpanded ? 'Hide Values' : 'Customize values.yaml'}</span>
                              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          )}
                        </div>

                        {/* Expandable values.yaml Editor */}
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
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Lifecycle Policies & Launch */}
        {step === 4 && (
          <div className="space-y-6 animate-in fade-in duration-200">
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2.5">
                <Clock className="w-5 h-5 text-cyber-accent" />
                Lifecycle Policies
              </h3>
            </div>

            <div className="space-y-4">


              {/* Auto Sleep Policy */}
              <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-3">
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoSleep}
                    onChange={(e) => setAutoSleep(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded text-cyber-accent bg-cyber-900 border-cyber-700 focus:ring-0 focus:ring-offset-0"
                  />
                  <div>
                    <span className="text-sm font-semibold text-white">
                      Auto-Sleep when Idle (Cost Optimization)
                    </span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Automatically suspends tenant workloads when no ingress traffic is observed for 30 minutes. Instantly wakes on incoming request.
                    </p>
                  </div>
                </label>

                {autoSleep && (
                  <div className="pt-3 border-t border-cyber-800/80 flex items-center gap-3">
                    <span className="text-xs text-slate-400">Teardown TTL (Hours):</span>
                    <input
                      type="number"
                      value={ttlHours}
                      onChange={(e) => setTtlHours(parseInt(e.target.value) || 0)}
                      min={0}
                      className="w-24 bg-cyber-900 border border-cyber-700 rounded-lg px-3 py-1 font-mono text-xs text-white focus:outline-none focus:border-cyber-accent"
                    />
                    <span className="text-[11px] text-slate-500 font-mono">(0 = no auto-delete)</span>
                  </div>
                )}
              </div>

              {/* Selected Applications Review */}
              <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Pre-configured Apps  ({selectedAppIds.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="text-[11px] font-mono text-cyan-400 hover:underline"
                  >
                    Edit Apps
                  </button>
                </div>

                {selectedAppIds.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No apps selected for initial installation (can be installed later from the App Store).</p>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedAppIds.map((appId) => {
                      const app = (catalog?.apps || []).find((a) => a.id === appId);
                      return (
                        <div
                          key={appId}
                          className="px-2.5 py-1 bg-cyber-900 border border-cyan-500/30 rounded-lg text-xs font-mono text-cyan-300 flex items-center gap-1.5"
                        >
                          <Package className="w-3 h-3 text-cyan-400" />
                          <span>{app ? app.name : appId}</span>
                          {customValuesMap[appId] && (
                            <span className="text-[10px] bg-cyan-950 text-cyan-400 px-1 py-0.5 rounded border border-cyan-800">
                              custom values
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Opinionated Core Stack Review */}
              <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    Opinionated Core Stack & Ingress Entrypoint
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="text-[11px] font-mono text-cyan-400 hover:underline"
                  >
                    Configure
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                  <div className="p-2.5 rounded-xl bg-cyber-900 border border-cyber-800">
                    <span className="text-[10px] text-slate-500 uppercase font-mono block">Ingress Provider</span>
                    <span className={`font-semibold ${
                      ingressProvider === 'gateway-api' ? 'text-blue-400' :
                      ingressProvider === 'istio' ? 'text-cyan-400' : 'text-slate-500'
                    }`}>
                      {ingressProvider === 'gateway-api' ? 'Gateway API' :
                       ingressProvider === 'istio' ? 'Istio Gateway' : 'None (Syncer)'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-cyber-900 border border-cyber-800">
                    <span className="text-[10px] text-slate-500 uppercase font-mono block">
                      {ingressProvider === 'gateway-api' ? 'Gateway Class' : 'Service Mesh'}
                    </span>
                    <span className={`font-semibold ${
                      ingressProvider === 'gateway-api' ? 'text-blue-300 font-mono' :
                      enableMesh ? 'text-purple-400' : 'text-slate-500'
                    }`}>
                      {ingressProvider === 'gateway-api' ? (gatewayClassName || 'eg') :
                       (enableMesh ? 'Sidecars Active' : 'Disabled (Gateway only)')}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-cyber-900 border border-cyber-800">
                    <span className="text-[10px] text-slate-500 uppercase font-mono block">Cert-Manager TLS</span>
                    <span className="font-semibold text-white font-mono truncate block">
                      {certIssuer ? `${certIssuer} (${certIssuerKind})` : 'Self-Signed / None'}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-cyber-900 border border-cyber-800">
                    <span className="text-[10px] text-slate-500 uppercase font-mono block">Entrypoint Host</span>
                    <span className="font-semibold text-cyan-300 font-mono truncate block">
                      {gatewayHost || (clusterName ? `${clusterName.trim().toLowerCase()}.example.com` : 'auto')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Disaster Recovery & Automated Backups (vCluster only) */}
              {clusterType === 'vcluster' ? (
                <div className="p-4 bg-cyber-950/70 border border-cyber-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Disaster Recovery & Backup Protection
                    </span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableBackup}
                        onChange={(e) => setEnableBackup(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>

                  {enableBackup ? (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'daily', label: 'Daily (02:00 UTC)' },
                          { id: 'weekly', label: 'Weekly (Sunday)' },
                          { id: 'monthly', label: 'Monthly (1st)' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setBackupSchedule(item.id as any)}
                            className={`py-2 px-2.5 rounded-xl text-xs font-mono border text-center transition-all ${
                              backupSchedule === item.id
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 font-semibold'
                                : 'bg-cyber-900 border-cyber-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400 pt-1 border-t border-cyber-850">
                        <span>Safe PVC: <strong className="text-purple-300">{clusterName ? `${clusterName.trim().toLowerCase()}-etcd-backups` : 'cluster-etcd-backups'} (10Gi)</strong></span>
                        <span>Retention: <strong className="text-cyan-300">Keep {backupRetention} snapshots</strong></span>
                        {deploymentMode === 'restore' && selectedRestoreSnapshot && (
                          <span className="w-full text-amber-300 bg-amber-500/10 border border-amber-500/30 p-1.5 rounded-lg">
                            Initial Restore: <strong className="font-mono">{selectedRestoreSnapshot}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Automated backups disabled. Cluster will run without scheduled snapshots.</p>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-cyber-950/70 border border-purple-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/30">
                      <Server className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-mono font-semibold text-white">Disaster Recovery (Host Managed)</span>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Host namespaced clusters run natively on the host cluster without an isolated etcd store. Backups and volume snapshots are managed at the host cluster level.
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/30 self-start sm:self-auto">
                    Native Host
                  </span>
                </div>
              )}
            </div>

            {/* Advanced Toggle (hidden by default) */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-mono text-slate-400 hover:text-cyber-accent transition-colors"
              >
                <Settings2 className="w-4 h-4" />
                <span>{showAdvanced ? 'Hide Advanced Settings' : clusterType === 'namespaced' ? 'Show Advanced Configuration (Manifest & Addons)' : 'Show Advanced Configuration (vcluster.yaml)'}</span>
              </button>

              {showAdvanced && (
                <div className="mt-4 p-5 bg-cyber-950 border border-cyber-800 rounded-2xl space-y-4 animate-in fade-in duration-150">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                        <span>Kubernetes Control Plane:</span>
                        <a href="/admin/versions" className="text-[10px] text-cyan-400 hover:underline">Manage Registry</a>
                      </label>
                      <select
                        value={kubernetesVersion}
                        onChange={(e) => setKubernetesVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      >
                        {versionRegistry?.kubernetesVersions.map((v) => (
                          <option key={v.version} value={v.version}>
                            {v.label || v.version} {v.isDefault ? '★ (Default)' : ''}
                          </option>
                        ))}
                        {kubernetesVersion && !versionRegistry?.kubernetesVersions.some(v => v.version === kubernetesVersion) && (
                          <option value={kubernetesVersion}>{kubernetesVersion}</option>
                        )}
                      </select>
                    </div>

                    {clusterType === 'vcluster' && (
                      <>
                        <div>
                          <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                            <span>vCluster Engine Version:</span>
                            <a href="/admin/versions" className="text-[10px] text-purple-400 hover:underline">Manage Registry</a>
                          </label>
                          <div className="flex gap-2">
                            <select
                              value={vclusterVersion}
                              onChange={(e) => setVclusterVersion(e.target.value)}
                              className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                            >
                              {versionRegistry?.vclusterVersions.map((v) => (
                                <option key={v.version} value={v.version}>
                                  {v.label || `vCluster ${v.version}`} {v.isDefault ? '★ (Default)' : ''}
                                </option>
                              ))}
                              {vclusterVersion && !versionRegistry?.vclusterVersions.some(v => v.version === vclusterVersion) && (
                                <option value={vclusterVersion}>{vclusterVersion}</option>
                              )}
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                            <span>etcd Backing Store:</span>
                            <a href="/admin/versions" className="text-[10px] text-amber-400 hover:underline">Manage Registry</a>
                          </label>
                          <select
                            value={etcdVersion}
                            onChange={(e) => setEtcdVersion(e.target.value)}
                            className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                          >
                            {versionRegistry?.etcdVersions?.map((v) => (
                              <option key={v.version} value={v.version}>
                                {v.label || `etcd ${v.version}`} {v.isDefault ? '★ (Default)' : ''}
                              </option>
                            ))}
                            {etcdVersion && !versionRegistry?.etcdVersions?.some(v => v.version === etcdVersion) && (
                              <option value={etcdVersion}>{etcdVersion}</option>
                            )}
                          </select>
                        </div>
                      </>
                    )}

                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                        <span>CoreDNS Resolver:</span>
                        <a href="/admin/versions" className="text-[10px] text-emerald-400 hover:underline">Manage Registry</a>
                      </label>
                      <select
                        value={coreDNSVersion}
                        onChange={(e) => setCoreDNSVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      >
                        {versionRegistry?.coreDNSVersions?.map((v) => (
                          <option key={v.version} value={v.version}>
                            {v.label || `CoreDNS ${v.version}`} {v.isDefault ? '★ (Default)' : ''}
                          </option>
                        ))}
                        {coreDNSVersion && !versionRegistry?.coreDNSVersions?.some(v => v.version === coreDNSVersion) && (
                          <option value={coreDNSVersion}>{coreDNSVersion}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                        <span>Metrics-Server:</span>
                        <a href="/admin/versions" className="text-[10px] text-blue-400 hover:underline">Manage Registry</a>
                      </label>
                      <select
                        value={metricsServerVersion}
                        onChange={(e) => setMetricsServerVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      >
                        {versionRegistry?.metricsServerVersions?.map((v) => (
                          <option key={v.version} value={v.version}>
                            {v.label || `Metrics ${v.version}`} {v.isDefault ? '★ (Default)' : ''}
                          </option>
                        ))}
                        {metricsServerVersion && !versionRegistry?.metricsServerVersions?.some(v => v.version === metricsServerVersion) && (
                          <option value={metricsServerVersion}>{metricsServerVersion}</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                        <span>Istio Mesh & Gateway:</span>
                        <a href="/admin/versions" className="text-[10px] text-indigo-400 hover:underline">Manage Registry</a>
                      </label>
                      <select
                        value={istioVersion}
                        onChange={(e) => setIstioVersion(e.target.value)}
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-cyber-accent"
                      >
                        {versionRegistry?.istioVersions?.map((v) => (
                          <option key={v.version} value={v.version}>
                            {v.label || `Istio ${v.version}`} {v.isDefault ? '★ (Default)' : ''}
                          </option>
                        ))}
                        {istioVersion && !versionRegistry?.istioVersions?.some(v => v.version === istioVersion) && (
                          <option value={istioVersion}>{istioVersion}</option>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Custom CA / Internal PKI Certificates */}
                  <div className="pt-3 border-t border-cyber-800">
                    <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-cyan-400" />
                        Custom CA Certificate (Self-Signed / Internal PKI):
                      </span>
                      <span className="text-[10px] text-slate-500">Optional</span>
                    </label>
                    <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                      PEM certificate mounted into the vCluster pods at <code className="text-slate-400">/etc/ssl/custom-ca/ca.crt</code> and trusted by internal kube-apiserver for OIDC and webhook endpoints.
                    </p>
                    <textarea
                      rows={3}
                      value={customCaCert}
                      onChange={(e) => setCustomCaCert(e.target.value)}
                      placeholder="-----BEGIN CERTIFICATE-----&#10;MIID...&#10;-----END CERTIFICATE-----"
                      className="w-full bg-cyber-900 border border-cyber-700 rounded-xl p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400 select-all"
                    />
                    <div className="mt-2">
                      <label className="block text-[11px] font-mono text-slate-400 mb-1">
                        Or Existing Kubernetes Secret Name:
                      </label>
                      <input
                        type="text"
                        value={customCaSecret}
                        onChange={(e) => setCustomCaSecret(e.target.value)}
                        placeholder="e.g. corporate-root-ca"
                        className="w-full bg-cyber-900 border border-cyber-700 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1 flex items-center justify-between">
                      <span>Generated vcluster.yaml Preview:</span>
                      <span className="text-[10px] text-cyber-accent">Dynamic Declarative Engine Spec</span>
                    </label>
                    <pre className="bg-cyber-900 border border-cyber-800 rounded-xl p-3 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto">
                      {previewYaml}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Wizard Navigation Footer */}
        <div className="mt-8 pt-5 border-t border-cyber-800 flex items-center justify-between">
          <div>
            {step > 1 ? (
              <button
                type="button"
                onClick={handlePrev}
                disabled={submitting}
                className="px-4 py-2.5 bg-cyber-800 hover:bg-cyber-750 text-slate-300 text-xs font-medium rounded-xl border border-cyber-700 flex items-center gap-1.5 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Step
              </button>
            ) : (
              <a
                href="/"
                className="px-4 py-2.5 bg-cyber-800 hover:bg-cyber-750 text-slate-400 text-xs font-medium rounded-xl border border-cyber-700 transition-colors"
              >
                Cancel
              </a>
            )}
          </div>

          <div>
            {isDeveloper ? (
              <button
                type="button"
                onClick={handleQuickLaunch}
                disabled={submitting || missingCoreComponents.length > 0}
                title={missingCoreComponents.length > 0 ? `Disabled: Missing core component versions (${missingCoreComponents.join(', ')})` : 'Deploy Cluster from Baseline'}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-md flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              >
                {submitting ? (
                  <>
                    <Zap className="w-4 h-4 animate-spin" />
                    Deploying from Baseline...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 stroke-[2.5]" />
                    Deploy Cluster from Baseline
                  </>
                )}
              </button>
            ) : step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-6 py-2.5 bg-cyber-accent hover:bg-cyan-300 text-slate-950 font-bold text-xs rounded-xl shadow-glow-sm flex items-center gap-1.5 transition-all"
              >
                Next Step
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || missingCoreComponents.length > 0}
                title={missingCoreComponents.length > 0 ? `Disabled: Missing core component versions (${missingCoreComponents.join(', ')})` : clusterType === 'namespaced' ? 'Deploy Namespaced Cluster' : 'Deploy Virtual Cluster'}
                className="px-6 py-2.5 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-bold text-xs rounded-xl shadow-glow-md flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Zap className="w-4 h-4 animate-spin" />
                    Provisioning Cluster...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    {clusterType === 'namespaced' ? 'Deploy Namespaced Cluster' : 'Deploy Virtual Cluster'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
