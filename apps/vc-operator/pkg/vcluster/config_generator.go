package vcluster

import (
	"encoding/json"
	"fmt"

	"gopkg.in/yaml.v3"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

// VClusterConfig matches the official vCluster OSS v0.37 vcluster.yaml schema
type VClusterConfig struct {
	ControlPlane ControlPlaneConfig  `yaml:"controlPlane" json:"controlPlane"`
	Integrations IntegrationsConfig  `yaml:"integrations" json:"integrations"`
	Sync         SyncConfig          `yaml:"sync" json:"sync"`
	PrivateNodes *PrivateNodesConfig `yaml:"privateNodes,omitempty" json:"privateNodes,omitempty"`
	Policies     *PoliciesConfig     `yaml:"policies,omitempty" json:"policies,omitempty"`
}

type PrivateNodesConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type ControlPlaneConfig struct {
	Distro       DistroConfig       `yaml:"distro" json:"distro"`
	BackingStore BackingStoreConfig `yaml:"backingStore" json:"backingStore"`
	CoreDNS      CoreDNSConfig      `yaml:"coreDNS" json:"coreDNS"`
	Proxy        *ProxyConfig       `yaml:"proxy,omitempty" json:"proxy,omitempty"`
}

type ProxyConfig struct {
	BindAddress string `yaml:"bindAddress" json:"bindAddress"`
	Port        int    `yaml:"port" json:"port"`
}

type DistroConfig struct {
	K8s K8sDistro `yaml:"k8s" json:"k8s"`
}

type K8sDistro struct {
	Enabled           bool             `yaml:"enabled" json:"enabled"`
	Version           string           `yaml:"version" json:"version"`
	APIServer         *ComponentConfig `yaml:"apiServer,omitempty" json:"apiServer,omitempty"`
	ControllerManager *ComponentConfig `yaml:"controllerManager,omitempty" json:"controllerManager,omitempty"`
}

type ComponentConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type BackingStoreConfig struct {
	Etcd EtcdConfig `yaml:"etcd" json:"etcd"`
}

type EtcdConfig struct {
	Deploy EtcdDeployConfig `yaml:"deploy" json:"deploy"`
}

type EtcdDeployConfig struct {
	StatefulSet EtcdStatefulSetConfig `yaml:"statefulSet" json:"statefulSet"`
}

type EtcdStatefulSetConfig struct {
	HighAvailability EtcdHAConfig         `yaml:"highAvailability" json:"highAvailability"`
	Persistence      EtcdPersistenceConfig `yaml:"persistence" json:"persistence"`
	Resources        ResourceRequirements `yaml:"resources,omitempty" json:"resources,omitempty"`
}

type EtcdHAConfig struct {
	Replicas int32 `yaml:"replicas" json:"replicas"`
}

type EtcdPersistenceConfig struct {
	VolumeClaim VolumeClaimConfig `yaml:"volumeClaim" json:"volumeClaim"`
}

type VolumeClaimConfig struct {
	Size string `yaml:"size" json:"size"`
}

type ResourceRequirements struct {
	Requests ResourceList `yaml:"requests,omitempty" json:"requests,omitempty"`
	Limits   ResourceList `yaml:"limits,omitempty" json:"limits,omitempty"`
}

type ResourceList struct {
	CPU    string `yaml:"cpu,omitempty" json:"cpu,omitempty"`
	Memory string `yaml:"memory,omitempty" json:"memory,omitempty"`
}

type CoreDNSConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type IntegrationsConfig struct {
	MetricsServer MetricsServerConfig `yaml:"metricsServer" json:"metricsServer"`
}

type MetricsServerConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type SyncConfig struct {
	ToHost   SyncToHostConfig `yaml:"toHost" json:"toHost"`
	FromHost *SyncFromHostConfig `yaml:"fromHost,omitempty" json:"fromHost,omitempty"`
}

type SyncToHostConfig struct {
	Pods                   SyncResourceConfig `yaml:"pods" json:"pods"`
	Services               SyncResourceConfig `yaml:"services" json:"services"`
	Endpoints              SyncResourceConfig `yaml:"endpoints" json:"endpoints"`
	EndpointSlices         SyncResourceConfig `yaml:"endpointSlices" json:"endpointSlices"`
	PersistentVolumeClaims SyncResourceConfig `yaml:"persistentVolumeClaims" json:"persistentVolumeClaims"`
	ConfigMaps             SyncResourceConfig `yaml:"configMaps" json:"configMaps"`
	Secrets                SyncResourceConfig `yaml:"secrets" json:"secrets"`
	Ingresses              SyncResourceConfig `yaml:"ingresses" json:"ingresses"`
}

type SyncFromHostConfig struct {
	Nodes SyncResourceConfig `yaml:"nodes,omitempty" json:"nodes,omitempty"`
}

type SyncResourceConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type PoliciesConfig struct {
	AutoSleep *AutoSleepConfig `yaml:"autoSleep,omitempty" json:"autoSleep,omitempty"`
}

type AutoSleepConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

// GenerateVClusterConfig builds the v0.37 vcluster.yaml structure from a VirtualCluster spec
func GenerateVClusterConfig(spec *v1alpha1.VirtualClusterSpec) (*VClusterConfig, error) {
	preset := GetPresetConfig(spec.SizePreset, spec.CustomResources)

	k8sVersion := spec.KubernetesVersion
	if k8sVersion == "" {
		k8sVersion = "v1.31.0"
	}

	replicas := int32(1)
	if spec.HighAvailability {
		replicas = 3
	}

	cfg := &VClusterConfig{
		ControlPlane: ControlPlaneConfig{
			Distro: DistroConfig{
				K8s: K8sDistro{
					Enabled: true,
					Version: k8sVersion,
					APIServer: &ComponentConfig{
						Enabled: true,
					},
					ControllerManager: &ComponentConfig{
						Enabled: true,
					},
				},
			},
			BackingStore: BackingStoreConfig{
				Etcd: EtcdConfig{
					Deploy: EtcdDeployConfig{
						StatefulSet: EtcdStatefulSetConfig{
							HighAvailability: EtcdHAConfig{
								Replicas: replicas,
							},
							Persistence: EtcdPersistenceConfig{
								VolumeClaim: VolumeClaimConfig{
									Size: preset.StorageSize,
								},
							},
							Resources: ResourceRequirements{
								Requests: ResourceList{
									CPU:    preset.CPURequest,
									Memory: preset.MemoryRequest,
								},
								Limits: ResourceList{
									CPU:    preset.CPULimit,
									Memory: preset.MemoryLimit,
								},
							},
						},
					},
				},
			},
			CoreDNS: CoreDNSConfig{
				Enabled: spec.Components.CoreDNS.Enabled,
			},
			Proxy: &ProxyConfig{
				BindAddress: "0.0.0.0",
				Port:        8443,
			},
		},
		Integrations: IntegrationsConfig{
			MetricsServer: MetricsServerConfig{
				Enabled: spec.Components.MetricsServer.Enabled,
			},
		},
		PrivateNodes: &PrivateNodesConfig{
			Enabled: false,
		},
		Sync: SyncConfig{
			ToHost: SyncToHostConfig{
				Pods: SyncResourceConfig{
					Enabled: spec.Sync.Pods,
				},
				Services: SyncResourceConfig{
					Enabled: spec.Sync.Services,
				},
				Endpoints: SyncResourceConfig{
					Enabled: true,
				},
				EndpointSlices: SyncResourceConfig{
					Enabled: true,
				},
				PersistentVolumeClaims: SyncResourceConfig{
					Enabled: true,
				},
				ConfigMaps: SyncResourceConfig{
					Enabled: true,
				},
				Secrets: SyncResourceConfig{
					Enabled: true,
				},
				Ingresses: SyncResourceConfig{
					Enabled: spec.Sync.Ingresses,
				},
			},
		},
	}

	return cfg, nil
}

// GenerateYAML produces the final vcluster.yaml string, applying rawConfig/helmValues overrides if present
func GenerateYAML(spec *v1alpha1.VirtualClusterSpec) ([]byte, error) {
	cfg, err := GenerateVClusterConfig(spec)
	if err != nil {
		return nil, fmt.Errorf("failed generating base config: %w", err)
	}

	baseBytes, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed marshaling base config: %w", err)
	}

	var baseMap map[string]interface{}
	if err := yaml.Unmarshal(baseBytes, &baseMap); err != nil {
		return nil, fmt.Errorf("failed unmarshaling base yaml: %w", err)
	}

	// Apply RawConfig overrides if provided
	if spec.RawConfig != nil && len(spec.RawConfig.Raw) > 0 {
		var overrideMap map[string]interface{}
		if err := json.Unmarshal(spec.RawConfig.Raw, &overrideMap); err == nil {
			mergeMaps(baseMap, overrideMap)
		} else if err := yaml.Unmarshal(spec.RawConfig.Raw, &overrideMap); err == nil {
			mergeMaps(baseMap, overrideMap)
		}
	}

	// Apply HelmValues overrides if provided
	if spec.HelmValues != nil && len(spec.HelmValues.Raw) > 0 {
		var helmMap map[string]interface{}
		if err := json.Unmarshal(spec.HelmValues.Raw, &helmMap); err == nil {
			mergeMaps(baseMap, helmMap)
		} else if err := yaml.Unmarshal(spec.HelmValues.Raw, &helmMap); err == nil {
			mergeMaps(baseMap, helmMap)
		}
	}

	return yaml.Marshal(baseMap)
}

func mergeMaps(dest, src map[string]interface{}) {
	for k, v := range src {
		if srcMap, ok := v.(map[string]interface{}); ok {
			if destMap, ok := dest[k].(map[string]interface{}); ok {
				mergeMaps(destMap, srcMap)
				continue
			}
		}
		dest[k] = v
	}
}
