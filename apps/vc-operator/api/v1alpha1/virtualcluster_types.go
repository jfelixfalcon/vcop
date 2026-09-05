package v1alpha1

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

// SizePreset defines resource sizing presets for virtual clusters
// +kubebuilder:validation:Enum=small;medium;large;custom
type SizePreset string

const (
	PresetSmall  SizePreset = "small"
	PresetMedium SizePreset = "medium"
	PresetLarge  SizePreset = "large"
	PresetCustom SizePreset = "custom"
)

// ClusterPhase defines the state lifecycle of the virtual cluster
// +kubebuilder:validation:Enum=Pending;Provisioning;Ready;Upgrading;Degraded;Terminating
type ClusterPhase string

const (
	PhasePending      ClusterPhase = "Pending"
	PhaseProvisioning ClusterPhase = "Provisioning"
	PhaseReady        ClusterPhase = "Ready"
	PhaseUpgrading    ClusterPhase = "Upgrading"
	PhaseDegraded     ClusterPhase = "Degraded"
	PhaseTerminating  ClusterPhase = "Terminating"
)

// Condition types for VirtualCluster
const (
	ConditionEtcdReady           = "EtcdReady"
	ConditionControlPlaneReady   = "ControlPlaneReady"
	ConditionAddonsReady         = "AddonsReady"
	ConditionKubeconfigGenerated = "KubeconfigGenerated"
)

// CoreDNSComponent configures CoreDNS add-on inside vCluster
type CoreDNSComponent struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`
}

// MetricsServerComponent configures metrics-server add-on inside vCluster
type MetricsServerComponent struct {
	// +kubebuilder:default=true
	Enabled bool `json:"enabled"`
}

// ComponentsSpec defines embedded add-ons for the virtual cluster
type ComponentsSpec struct {
	// +kubebuilder:default={enabled: true}
	// +optional
	CoreDNS CoreDNSComponent `json:"coreDNS,omitempty"`

	// +kubebuilder:default={enabled: true}
	// +optional
	MetricsServer MetricsServerComponent `json:"metricsServer,omitempty"`
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

// VirtualClusterSpec defines the desired state of VirtualCluster
type VirtualClusterSpec struct {
	// ClusterName is the tenant-facing identifier
	// +kubebuilder:validation:Required
	// +kubebuilder:validation:MinLength=1
	// +kubebuilder:validation:MaxLength=63
	// +kubebuilder:validation:Pattern="^[a-z0-9]([-a-z0-9]*[a-z0-9])?$"
	ClusterName string `json:"clusterName"`

	// VClusterVersion defines the target vCluster OSS engine version (0.37.x)
	// +kubebuilder:default="0.37.0"
	// +optional
	VClusterVersion string `json:"vclusterVersion,omitempty"`

	// KubernetesVersion defines the virtual control plane Kubernetes version
	// +kubebuilder:default="v1.31.0"
	// +optional
	KubernetesVersion string `json:"kubernetesVersion,omitempty"`

	// SizePreset sets predefined sizing tiers for compute & storage
	// +kubebuilder:default="medium"
	// +optional
	SizePreset SizePreset `json:"sizePreset,omitempty"`

	// CustomResources specifies custom compute allocations when sizePreset is "custom"
	// +optional
	CustomResources *CustomResources `json:"customResources,omitempty"`

	// HighAvailability enables 3-replica HA etcd and control-plane redundancy
	// +kubebuilder:default=true
	// +optional
	HighAvailability bool `json:"highAvailability,omitempty"`

	// Components controls internal add-ons (CoreDNS, Metrics Server)
	// +optional
	Components ComponentsSpec `json:"components,omitempty"`

	// Sync controls resource synchronization boundaries
	// +optional
	Sync SyncSpec `json:"sync,omitempty"`

	// Lifecycle configures idle sleep and TTL cleanup
	// +optional
	Lifecycle LifecyclePolicy `json:"lifecycle,omitempty"`

	// RawConfig provides direct passthrough overrides into the vCluster 0.37 vcluster.yaml schema
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

	// ObservedGeneration is the most recent generation observed by the controller
	// +optional
	ObservedGeneration int64 `json:"observedGeneration,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Cluster Name",type=string,JSONPath=`.spec.clusterName`
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
