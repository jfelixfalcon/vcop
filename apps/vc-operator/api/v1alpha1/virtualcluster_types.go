package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// SizePreset defines resource sizing presets for virtual clusters
// +kubebuilder:validation:Enum=normal;ha;small;medium;large;custom
type SizePreset string

const (
	PresetNormal SizePreset = "normal"
	PresetHA     SizePreset = "ha"
	PresetSmall  SizePreset = "small"
	PresetMedium SizePreset = "medium"
	PresetLarge  SizePreset = "large"
	PresetCustom SizePreset = "custom"
)

// ClusterType defines the deployment architecture mode of the cluster
// +kubebuilder:validation:Enum=vcluster;namespaced;host
type ClusterType string

const (
	ClusterTypeVCluster   ClusterType = "vcluster"
	ClusterTypeNamespaced ClusterType = "namespaced"
	ClusterTypeHost       ClusterType = "host" // alias for namespaced
)

// ClusterPhase defines the state lifecycle of the virtual cluster
// +kubebuilder:validation:Enum=Pending;Provisioning;Ready;Upgrading;Degraded;Terminating;Sleeping
type ClusterPhase string

const (
	PhasePending      ClusterPhase = "Pending"
	PhaseProvisioning ClusterPhase = "Provisioning"
	PhaseReady        ClusterPhase = "Ready"
	PhaseUpgrading    ClusterPhase = "Upgrading"
	PhaseDegraded     ClusterPhase = "Degraded"
	PhaseTerminating  ClusterPhase = "Terminating"
	PhaseSleeping     ClusterPhase = "Sleeping"
)

// Condition types for VirtualCluster
const (
	ConditionEtcdReady             = "EtcdReady"
	ConditionControlPlaneReady     = "ControlPlaneReady"
	ConditionAddonsReady           = "AddonsReady"
	ConditionKubeconfigGenerated   = "KubeconfigGenerated"
	ConditionQuotaReady            = "QuotaReady"
	ConditionSleeping              = "Sleeping"
	ConditionRBACReady             = "RBACReady"
	ConditionIstioReady            = "IstioReady"
	ConditionGatewayAPIReady       = "GatewayAPIReady"
	ConditionCertificateReady      = "CertificateReady"
	ConditionCapacityAvailable     = "CapacityAvailable"
	ConditionDisasterRecoveryReady = "DisasterRecoveryReady"
)

// CoreDNSComponent configures CoreDNS add-on inside vCluster
type CoreDNSComponent struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`

	// Version defines the CoreDNS image tag (default: "v1.11.3")
	// +kubebuilder:default="v1.11.3"
	// +optional
	Version string `json:"version,omitempty"`
}

// MetricsServerComponent configures metrics-server add-on inside vCluster
type MetricsServerComponent struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`

	// Version defines the metrics-server image tag (default: "v0.7.2")
	// +kubebuilder:default="v0.7.2"
	// +optional
	Version string `json:"version,omitempty"`
}

// IstioGatewayConfig defines ingress gateway settings
type IstioGatewayConfig struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`
	// ServiceType defines Kubernetes service type for the gateway (ClusterIP, LoadBalancer, NodePort)
	// +kubebuilder:default="ClusterIP"
	// +optional
	ServiceType string `json:"serviceType,omitempty"`
	// Replicas defines the replica count for the ingress gateway (defaults to 3 if highAvailability is true, otherwise 1)
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`
	// Selector defines the pod label selector for the ingress gateway (defaults to istio: ingressgateway)
	// +optional
	Selector map[string]string `json:"selector,omitempty"`
}

// HostRoutingConfig configures host-level Istio ingress routing and API passthrough
type HostRoutingConfig struct {
	// Enabled deploys host DestinationRule, host VirtualService, and vCluster API Passthrough Gateway
	// +kubebuilder:default=false
	Enabled bool `json:"enabled"`

	// DefaultGateway is the host-side gateway reference (e.g. "istio-system/default-gateway")
	// +kubebuilder:default="istio-system/default-gateway"
	// +optional
	DefaultGateway string `json:"defaultGateway,omitempty"`

	// IngressGatewaySelector is the label selector for the host ingress gateway (default: istio: ingressgateway)
	// +optional
	IngressGatewaySelector map[string]string `json:"ingressGatewaySelector,omitempty"`

	// ApiHost is the external hostname for the vCluster Kubernetes API (defaults to "api.<clusterName>.<baseDomain>")
	// +optional
	ApiHost string `json:"apiHost,omitempty"`
}

// IstioComponent configures the opinionated Istio entrypoint and mesh stack
type IstioComponent struct {
	// Enabled deploys Istio (istiod + ingress gateway) as the application entrypoint
	// +kubebuilder:default=false
	Enabled bool `json:"enabled"`

	// Version defines the Istio release version for control plane & ingress (default: "1.24.2")
	// +kubebuilder:default="1.24.2"
	// +optional
	Version string `json:"version,omitempty"`

	// Replicas defines the replica count for istiod control plane (defaults to 3 if highAvailability is true, otherwise 1)
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`

	// MeshEnabled enables service mesh sidecar injection (disabled by default)
	// +kubebuilder:default=false
	// +optional
	MeshEnabled bool `json:"meshEnabled,omitempty"`

	// IngressGateway configuration
	// +optional
	IngressGateway *IstioGatewayConfig `json:"ingressGateway,omitempty"`

	// CertificateIssuer defines the cert-manager Issuer or ClusterIssuer name on the host cluster
	// +optional
	CertificateIssuer string `json:"certificateIssuer,omitempty"`

	// CertificateIssuerKind defines Issuer or ClusterIssuer (default: ClusterIssuer)
	// +kubebuilder:default="ClusterIssuer"
	// +optional
	CertificateIssuerKind string `json:"certificateIssuerKind,omitempty"`

	// Hosts are the external hostnames for the Gateway and default VirtualService (defaults to cluster FQDN)
	// +optional
	Hosts []string `json:"hosts,omitempty"`

	// CertSecretName overrides the TLS secret name (defaults to <clusterName>-ingress-tls)
	// +optional
	CertSecretName string `json:"certSecretName,omitempty"`

	// HostRouting configures host-level Istio routing and vCluster API passthrough
	// +optional
	HostRouting *HostRoutingConfig `json:"hostRouting,omitempty"`
}

// GatewayConfig defines settings for the Kubernetes Gateway API entrypoint proxy
type GatewayConfig struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`
	// ServiceType defines Kubernetes service type for the gateway proxy (ClusterIP, LoadBalancer, NodePort)
	// +kubebuilder:default="ClusterIP"
	// +optional
	ServiceType string `json:"serviceType,omitempty"`
	// Replicas defines the replica count for the gateway proxy (defaults to 3 if highAvailability is true, otherwise 1)
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`
	// Selector defines the pod label selector for the gateway proxy
	// +optional
	Selector map[string]string `json:"selector,omitempty"`
}

// GatewayHostRoutingConfig configures host-level Gateway API ingress routing and API passthrough
type GatewayHostRoutingConfig struct {
	// Enabled deploys host HTTPRoutes and API routing on the host Gateway
	// +kubebuilder:default=false
	Enabled bool `json:"enabled"`

	// DefaultGateway is the host-side gateway reference (e.g. "envoy-gateway-system/eg")
	// +kubebuilder:default="envoy-gateway-system/eg"
	// +optional
	DefaultGateway string `json:"defaultGateway,omitempty"`

	// IngressGatewaySelector is the label selector for host ingress gateway pods
	// +optional
	IngressGatewaySelector map[string]string `json:"ingressGatewaySelector,omitempty"`

	// ApiHost is the external hostname for the vCluster Kubernetes API (defaults to "api.<clusterName>.<baseDomain>")
	// +optional
	ApiHost string `json:"apiHost,omitempty"`
}

// GatewayAPIComponent configures the opinionated Kubernetes Gateway API entrypoint
type GatewayAPIComponent struct {
	// Enabled deploys Gateway API (CRDs, GatewayClass, Gateway, HTTPRoute) as the application entrypoint
	// +kubebuilder:default=false
	Enabled bool `json:"enabled"`

	// Version defines the Gateway API version (default: "v1.2.0")
	// +kubebuilder:default="v1.2.0"
	// +optional
	Version string `json:"version,omitempty"`

	// GatewayClassName defines the GatewayClass to bind (default: "eg")
	// +kubebuilder:default="eg"
	// +optional
	GatewayClassName string `json:"gatewayClassName,omitempty"`

	// Replicas defines the replica count for the gateway proxy (defaults to 3 if highAvailability is true, otherwise 1)
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`

	// GatewayConfig configuration
	// +optional
	GatewayConfig *GatewayConfig `json:"gatewayConfig,omitempty"`

	// CertificateIssuer defines the cert-manager Issuer or ClusterIssuer name on the host cluster
	// +optional
	CertificateIssuer string `json:"certificateIssuer,omitempty"`

	// CertificateIssuerKind defines Issuer or ClusterIssuer (default: ClusterIssuer)
	// +kubebuilder:default="ClusterIssuer"
	// +optional
	CertificateIssuerKind string `json:"certificateIssuerKind,omitempty"`

	// Hosts are the external hostnames for the Gateway and HTTPRoute (defaults to cluster FQDN)
	// +optional
	Hosts []string `json:"hosts,omitempty"`

	// CertSecretName overrides the TLS secret name (defaults to <clusterName>-gateway-tls)
	// +optional
	CertSecretName string `json:"certSecretName,omitempty"`

	// HostRouting configures host-level Gateway API routing and vCluster API passthrough
	// +optional
	HostRouting *GatewayHostRoutingConfig `json:"hostRouting,omitempty"`
}

// ComponentsSpec defines embedded add-ons for the virtual cluster
type ComponentsSpec struct {
	// +kubebuilder:default={enabled: true}
	// +optional
	CoreDNS CoreDNSComponent `json:"coreDNS,omitempty"`

	// +kubebuilder:default={enabled: true}
	// +optional
	MetricsServer MetricsServerComponent `json:"metricsServer,omitempty"`

	// Istio configures the opinionated application entrypoint and service mesh stack
	// +optional
	Istio *IstioComponent `json:"istio,omitempty"`

	// GatewayAPI configures the opinionated Kubernetes Gateway API application entrypoint
	// +optional
	GatewayAPI *GatewayAPIComponent `json:"gatewayAPI,omitempty"`
}

// SyncSpec configures resource synchronization from vcluster to host
type SyncSpec struct {
	// +kubebuilder:default=true
	// +optional
	Pods bool `json:"pods,omitempty"`

	// +kubebuilder:default=true
	// +optional
	Services bool `json:"services,omitempty"`

	// +kubebuilder:default=true
	// +optional
	Ingresses bool `json:"ingresses,omitempty"`
}

// LifecyclePolicy configures sleep and auto-teardown behavior
type LifecyclePolicy struct {
	// AutoSleep enables pausing tenant pods when idle
	// +kubebuilder:default=false
	// +optional
	AutoSleep bool `json:"autoSleep,omitempty"`

	// Sleep explicitly puts the virtual cluster into sleep mode
	// +kubebuilder:default=false
	// +optional
	Sleep bool `json:"sleep,omitempty"`

	// TTLHours defines automated deletion TTL in hours (0 = disabled)
	// +kubebuilder:default=0
	// +optional
	TTLHours int32 `json:"ttlHours,omitempty"`
}

// CustomResources defines resource requests and limits when sizePreset is "custom"
type CustomResources struct {
	// CPU request/limit (e.g. "2", "4")
	// +optional
	CPU string `json:"cpu,omitempty"`

	// Memory request/limit (e.g. "4Gi", "8Gi")
	// +optional
	Memory string `json:"memory,omitempty"`

	// Storage size for backing etcd (e.g. "10Gi", "50Gi")
	// +optional
	Storage string `json:"storage,omitempty"`
}

// ResourceQuotaPolicy defines limits and requests ceiling for tenant workloads
type ResourceQuotaPolicy struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`

	// RequestsCPU sets total CPU requests quota (e.g. "2", "4000m")
	// +optional
	RequestsCPU string `json:"requestsCPU,omitempty"`

	// RequestsMemory sets total memory requests quota (e.g. "4Gi", "8Gi")
	// +optional
	RequestsMemory string `json:"requestsMemory,omitempty"`

	// RequestsStorage sets total storage requests quota (e.g. "20Gi", "100Gi")
	// +optional
	RequestsStorage string `json:"requestsStorage,omitempty"`

	// LimitsCPU sets total CPU limits quota (e.g. "4", "8000m")
	// +optional
	LimitsCPU string `json:"limitsCPU,omitempty"`

	// LimitsMemory sets total memory limits quota (e.g. "8Gi", "16Gi")
	// +optional
	LimitsMemory string `json:"limitsMemory,omitempty"`

	// Pods sets maximum allowed pod count (e.g. "20")
	// +optional
	Pods string `json:"pods,omitempty"`

	// Services sets maximum allowed services count (e.g. "20")
	// +optional
	Services string `json:"services,omitempty"`

	// ServicesNodePorts sets maximum allowed NodePort services (e.g. "0")
	// +optional
	ServicesNodePorts string `json:"servicesNodePorts,omitempty"`

	// ServicesLoadBalancers sets maximum allowed LoadBalancer services (e.g. "2")
	// +optional
	ServicesLoadBalancers string `json:"servicesLoadBalancers,omitempty"`

	// ConfigMaps sets maximum allowed ConfigMaps (e.g. "50")
	// +optional
	ConfigMaps string `json:"configMaps,omitempty"`

	// Secrets sets maximum allowed Secrets (e.g. "50")
	// +optional
	Secrets string `json:"secrets,omitempty"`

	// PersistentVolumeClaims sets maximum allowed PVCs (e.g. "10")
	// +optional
	PersistentVolumeClaims string `json:"persistentVolumeClaims,omitempty"`
}

// LimitRangePolicy defines container-level default and boundary guardrails
type LimitRangePolicy struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`

	// DefaultCPU sets default container CPU limit (e.g. "1", "500m")
	// +optional
	DefaultCPU string `json:"defaultCPU,omitempty"`

	// DefaultMemory sets default container memory limit (e.g. "512Mi", "1Gi")
	// +optional
	DefaultMemory string `json:"defaultMemory,omitempty"`

	// DefaultRequestCPU sets default container CPU request (e.g. "100m")
	// +optional
	DefaultRequestCPU string `json:"defaultRequestCPU,omitempty"`

	// DefaultRequestMemory sets default container memory request (e.g. "128Mi")
	// +optional
	DefaultRequestMemory string `json:"defaultRequestMemory,omitempty"`

	// MaxCPU sets maximum allowed container CPU limit (e.g. "4")
	// +optional
	MaxCPU string `json:"maxCPU,omitempty"`

	// MaxMemory sets maximum allowed container memory limit (e.g. "8Gi")
	// +optional
	MaxMemory string `json:"maxMemory,omitempty"`

	// MinCPU sets minimum required container CPU request (e.g. "10m")
	// +optional
	MinCPU string `json:"minCPU,omitempty"`

	// MinMemory sets minimum required container memory request (e.g. "32Mi")
	// +optional
	MinMemory string `json:"minMemory,omitempty"`
}

// PoliciesSpec defines governance policies including resource quotas and limits
type PoliciesSpec struct {
	// ResourceQuota governs aggregate resource consumption for the virtual cluster
	// +optional
	ResourceQuota *ResourceQuotaPolicy `json:"resourceQuota,omitempty"`

	// LimitRange governs per-container resource defaults and limits
	// +optional
	LimitRange *LimitRangePolicy `json:"limitRange,omitempty"`
}

// DisasterRecoverySchedule defines preset backup intervals
type DisasterRecoverySchedule string

const (
	ScheduleDaily    DisasterRecoverySchedule = "daily"
	ScheduleWeekly   DisasterRecoverySchedule = "weekly"
	ScheduleMonthly  DisasterRecoverySchedule = "monthly"
	ScheduleCustom   DisasterRecoverySchedule = "custom"
	ScheduleDisabled DisasterRecoverySchedule = "disabled"
)

// DisasterRecoverySpec defines etcd backup and disaster recovery configuration
type DisasterRecoverySpec struct {
	// Enabled toggles automated backups for the backing store
	// +kubebuilder:default=true
	// +optional
	Enabled bool `json:"enabled,omitempty"`

	// Schedule defines backup frequency: daily, weekly, monthly, custom, or disabled
	// +kubebuilder:default="daily"
	// +optional
	Schedule string `json:"schedule,omitempty"`

	// CronExpression defines custom cron schedule (e.g. "0 2 * * *")
	// +optional
	CronExpression string `json:"cronExpression,omitempty"`

	// RetentionCount defines how many backups to keep before pruning (default: 7)
	// +kubebuilder:default=7
	// +optional
	RetentionCount int `json:"retentionCount,omitempty"`

	// StorageSize defines the PVC storage size allocated for backups (default: "10Gi")
	// +kubebuilder:default="10Gi"
	// +optional
	StorageSize string `json:"storageSize,omitempty"`

	// InitialBackupRestore specifies a snapshot identifier to seed etcd on provisioning
	// +optional
	InitialBackupRestore string `json:"initialBackupRestore,omitempty"`

	// StorageClass defines the StorageClass for backup PVCs (defaults to cluster default)
	// +optional
	StorageClass string `json:"storageClass,omitempty"`

	// RestoreSnapshotName specifies an existing snapshot to restore onto this cluster
	// +optional
	RestoreSnapshotName string `json:"restoreSnapshotName,omitempty"`
}

// BackupItem represents a recorded etcd snapshot
type BackupItem struct {
	Name          string      `json:"name"`
	Filename      string      `json:"filename"`
	Timestamp     metav1.Time `json:"timestamp"`
	Size          string      `json:"size"`
	SizeBytes     int64       `json:"sizeBytes"`
	Status        string      `json:"status"` // Completed, Failed, InProgress
	ClusterOrigin string      `json:"clusterOrigin"`
	EtcdVersion   string      `json:"etcdVersion,omitempty"`
}

// DisasterRecoveryStatus reflects the observed backup and restore state
type DisasterRecoveryStatus struct {
	Enabled        bool         `json:"enabled"`
	Schedule       string       `json:"schedule,omitempty"`
	CronExpression string       `json:"cronExpression,omitempty"`
	LastBackupTime *metav1.Time `json:"lastBackupTime,omitempty"`
	NextBackupTime *metav1.Time `json:"nextBackupTime,omitempty"`
	BackupsCount   int          `json:"backupsCount"`
	TotalSizeBytes int64        `json:"totalSizeBytes"`
	TotalSizeStr   string       `json:"totalSizeStr,omitempty"`
	BackupsPvcName string       `json:"backupsPvcName,omitempty"`
	RecentBackups  []BackupItem `json:"recentBackups,omitempty"`
}

// QuotaStatus tracks observed hard limits and current resource usage
type QuotaStatus struct {
	Hard map[string]string `json:"hard,omitempty"`
	Used map[string]string `json:"used,omitempty"`
}

// ImageRewriteRule specifies a single source-to-target registry swap rule
type ImageRewriteRule struct {
	// From defines the source registry or image prefix (e.g. "harbor.com" or "docker.io/library")
	From string `json:"from"`

	// To defines the replacement target registry prefix (e.g. "registry.com/library")
	To string `json:"to"`
}

// VirtualClusterSpec defines the desired state of VirtualCluster
type VirtualClusterSpec struct {
	// ClusterName is the tenant-facing identifier
	// +kubebuilder:validation:Required
	// +kubebuilder:validation:MinLength=1
	// +kubebuilder:validation:MaxLength=63
	// +kubebuilder:validation:Pattern="^[a-z0-9]([-a-z0-9]*[a-z0-9])?$"
	ClusterName string `json:"clusterName"`

	// ClusterType defines whether this cluster is a virtual cluster (vcluster) or a host namespaced environment (namespaced/host)
	// +kubebuilder:default="vcluster"
	// +kubebuilder:validation:Enum=vcluster;namespaced;host
	// +optional
	ClusterType ClusterType `json:"clusterType,omitempty"`

	// Namespaces defines the managed host namespaces when clusterType is "namespaced".
	// If omitted or empty, defaults to the VirtualCluster's namespace.
	// +optional
	Namespaces []string `json:"namespaces,omitempty"`

	// VClusterVersion defines the target vCluster OSS engine version (0.36.x)
	// +kubebuilder:default="0.36.0"
	// +optional
	VClusterVersion string `json:"vclusterVersion,omitempty"`

	// KubernetesVersion defines the virtual control plane Kubernetes version
	// +kubebuilder:default="v1.31.0"
	// +optional
	KubernetesVersion string `json:"kubernetesVersion,omitempty"`

	// EtcdVersion defines the backing store etcd image tag (default: "3.6.8-0")
	// +kubebuilder:default="3.6.8-0"
	// +optional
	EtcdVersion string `json:"etcdVersion,omitempty"`

	// ImageRegistry overrides default container image registry/repository prefix (e.g. "registry.com/library")
	// +optional
	ImageRegistry string `json:"imageRegistry,omitempty"`

	// ImageRewriteRules defines specific source-to-target registry swap mappings
	// +optional
	ImageRewriteRules []ImageRewriteRule `json:"imageRewriteRules,omitempty"`

	// SizePreset sets predefined sizing tiers for compute & storage
	// +kubebuilder:default="medium"
	// +optional
	SizePreset SizePreset `json:"sizePreset,omitempty"`

	// StorageClass defines the cluster default StorageClass for persistent volumes (defaults to cluster default StorageClass)
	// +optional
	StorageClass string `json:"storageClass,omitempty"`

	// EtcdStorageClass explicitly defines the StorageClass for etcd database volumes (e.g. fast drive SSD/NVMe)
	// +optional
	EtcdStorageClass string `json:"etcdStorageClass,omitempty"`

	// CustomResources specifies custom compute allocations when sizePreset is "custom"
	// +optional
	CustomResources *CustomResources `json:"customResources,omitempty"`

	// HighAvailability enables 3-replica HA etcd, 3-replica control-plane redundancy, and 3-replica Istio (3 istiod control plane & 3 ingress gateways)
	// +kubebuilder:default=true
	// +optional
	HighAvailability bool `json:"highAvailability,omitempty"`

	// Paused explicitly puts the virtual cluster to sleep, scaling down control plane workloads
	// +kubebuilder:default=false
	// +optional
	Paused bool `json:"paused,omitempty"`

	// Components controls internal add-ons (CoreDNS, Metrics Server)
	// +optional
	Components ComponentsSpec `json:"components,omitempty"`

	// Sync controls resource synchronization boundaries
	// +optional
	Sync SyncSpec `json:"sync,omitempty"`

	// Lifecycle configures idle sleep and TTL cleanup
	// +optional
	Lifecycle LifecyclePolicy `json:"lifecycle,omitempty"`

	// Policies controls governance policies (ResourceQuota, LimitRange)
	// +optional
	Policies *PoliciesSpec `json:"policies,omitempty"`

	// DisasterRecovery controls automated etcd backups and recovery
	// +optional
	DisasterRecovery *DisasterRecoverySpec `json:"disasterRecovery,omitempty"`

	// RawConfig provides direct passthrough overrides into the vCluster 0.36 vcluster.yaml schema
	// +optional
	RawConfig *runtime.RawExtension `json:"rawConfig,omitempty"`

	// HelmValues is an alias/alternative passthrough for values
	// +optional
	HelmValues *runtime.RawExtension `json:"helmValues,omitempty"`
}

// ClusterMetrics summarizes resource utilization within the virtual cluster
type ClusterMetrics struct {
	// ActiveNodeCount is the number of nodes visible in the virtual cluster
	// +optional
	ActiveNodeCount int32 `json:"activeNodeCount,omitempty"`

	// PodCount is the number of active pods in tenant workloads
	// +optional
	PodCount int32 `json:"podCount,omitempty"`

	// MemoryUsage represents tenant memory consumption (e.g. "1.2Gi")
	// +optional
	MemoryUsage string `json:"memoryUsage,omitempty"`

	// CPUUsage represents tenant CPU consumption (e.g. "450m")
	// +optional
	CPUUsage string `json:"cpuUsage,omitempty"`
}

// VirtualClusterStatus defines the observed state of VirtualCluster
type VirtualClusterStatus struct {
	// Phase is the current lifecycle state of the virtual cluster
	// +kubebuilder:default="Pending"
	// +optional
	Phase ClusterPhase `json:"phase,omitempty"`

	// Conditions represents detailed lifecycle observations
	// +optional
	Conditions []metav1.Condition `json:"conditions,omitempty"`

	// VirtualK8sVersion reflects the actual running virtual Kubernetes API version
	// +optional
	VirtualK8sVersion string `json:"virtualK8sVersion,omitempty"`

	// VClusterVersion reflects the running vCluster engine version
	// +optional
	VClusterVersion string `json:"vclusterVersion,omitempty"`

	// Endpoint is the accessible internal or external API server URL
	// +optional
	Endpoint string `json:"endpoint,omitempty"`

	// KubeconfigSecretRef points to the host Secret storing the generated admin kubeconfig
	// +optional
	KubeconfigSecretRef *corev1.LocalObjectReference `json:"kubeconfigSecretRef,omitempty"`

	// Metrics holds node, pod, and compute statistics
	// +optional
	Metrics ClusterMetrics `json:"metrics,omitempty"`

	// Quota reflects active resource quota allocations and usage
	// +optional
	Quota *QuotaStatus `json:"quota,omitempty"`

	// ComponentVersions reflects the active versions of core infrastructure and add-ons
	// +optional
	ComponentVersions *ComponentVersionsStatus `json:"componentVersions,omitempty"`

	// DisasterRecovery reflects the observed backup and restore state
	// +optional
	DisasterRecovery *DisasterRecoveryStatus `json:"disasterRecovery,omitempty"`

	// ClusterType reflects the active deployment architecture of the cluster
	// +optional
	ClusterType ClusterType `json:"clusterType,omitempty"`

	// ObservedGeneration is the most recent generation observed by the controller
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

// ComponentVersionsStatus tracks observed versions of core virtual cluster components
type ComponentVersionsStatus struct {
	// Etcd reflects the active etcd version
	// +optional
	Etcd string `json:"etcd,omitempty"`

	// CoreDNS reflects the active CoreDNS add-on version
	// +optional
	CoreDNS string `json:"coreDNS,omitempty"`

	// MetricsServer reflects the active Metrics-Server add-on version
	// +optional
	MetricsServer string `json:"metricsServer,omitempty"`

	// Istio reflects the active Istio ingress & mesh version
	// +optional
	Istio string `json:"istio,omitempty"`

	// GatewayAPI reflects the active Gateway API entrypoint version
	// +optional
	GatewayAPI string `json:"gatewayAPI,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Cluster Name",type=string,JSONPath=`.spec.clusterName`
// +kubebuilder:printcolumn:name="Type",type=string,JSONPath=`.spec.clusterType`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
// +kubebuilder:printcolumn:name="vCluster Ver",type=string,JSONPath=`.status.vclusterVersion`
// +kubebuilder:printcolumn:name="K8s Ver",type=string,JSONPath=`.status.virtualK8sVersion`
// +kubebuilder:printcolumn:name="Preset",type=string,JSONPath=`.spec.sizePreset`
// +kubebuilder:printcolumn:name="HA",type=boolean,JSONPath=`.spec.highAvailability`
// +kubebuilder:printcolumn:name="Age",type="date",JSONPath=`.metadata.creationTimestamp`

// VirtualCluster is the Schema for the virtualclusters API
type VirtualCluster struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   VirtualClusterSpec   `json:"spec,omitempty"`
	Status VirtualClusterStatus `json:"status,omitempty"`
}

// IsSleeping returns true if the virtual cluster is paused or in sleep mode
func (vc *VirtualCluster) IsSleeping() bool {
	return vc.Spec.Paused || vc.Spec.Lifecycle.Sleep
}

// IsNamespaced returns true if the cluster is a host namespaced environment
func (vc *VirtualCluster) IsNamespaced() bool {
	return vc.Spec.ClusterType == ClusterTypeNamespaced || vc.Spec.ClusterType == ClusterTypeHost
}

// GetNamespaces returns the list of namespaces managed by this cluster
func (vc *VirtualCluster) GetNamespaces() []string {
	if len(vc.Spec.Namespaces) > 0 {
		return vc.Spec.Namespaces
	}
	if vc.Namespace != "" {
		return []string{vc.Namespace}
	}
	return []string{vc.Spec.ClusterName}
}

// +kubebuilder:object:root=true

// VirtualClusterList contains a list of VirtualCluster
type VirtualClusterList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []VirtualCluster `json:"items"`
}

func init() {
	SchemeBuilder.Register(&VirtualCluster{}, &VirtualClusterList{})
}
