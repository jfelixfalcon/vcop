package vcluster

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"gopkg.in/yaml.v3"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

// VClusterConfig matches the official vCluster OSS v0.36 vcluster.yaml schema
type VClusterConfig struct {
	ControlPlane ControlPlaneConfig  `yaml:"controlPlane" json:"controlPlane"`
	Integrations IntegrationsConfig  `yaml:"integrations" json:"integrations"`
	Networking   *NetworkingConfig   `yaml:"networking,omitempty" json:"networking,omitempty"`
	Sync         SyncConfig          `yaml:"sync" json:"sync"`
	PrivateNodes *PrivateNodesConfig `yaml:"privateNodes,omitempty" json:"privateNodes,omitempty"`
	Policies     *PoliciesConfig     `yaml:"policies,omitempty" json:"policies,omitempty"`
}

type NetworkingConfig struct {
	Advanced AdvancedNetworkingConfig `yaml:"advanced" json:"advanced"`
}

type AdvancedNetworkingConfig struct {
	ProxyKubelets ProxyKubeletsConfig `yaml:"proxyKubelets" json:"proxyKubelets"`
}

type ProxyKubeletsConfig struct {
	ByHostname bool `yaml:"byHostname" json:"byHostname"`
	ByIP       bool `yaml:"byIP" json:"byIP"`
}

type PrivateNodesConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type ControlPlaneConfig struct {
	Distro       DistroConfig             `yaml:"distro" json:"distro"`
	BackingStore BackingStoreConfig       `yaml:"backingStore" json:"backingStore"`
	CoreDNS      CoreDNSConfig            `yaml:"coredns" json:"coredns"`
	Proxy        *ProxyConfig             `yaml:"proxy,omitempty" json:"proxy,omitempty"`
	StatefulSet  *ControlPlaneStatefulSet `yaml:"statefulSet,omitempty" json:"statefulSet,omitempty"`
}

type ControlPlaneStatefulSet struct {
	HighAvailability ControlPlaneHA `yaml:"highAvailability" json:"highAvailability"`
}

type ControlPlaneHA struct {
	Replicas      int32 `yaml:"replicas" json:"replicas"`
	LeaseDuration int32 `yaml:"leaseDuration,omitempty" json:"leaseDuration,omitempty"`
	RenewDeadline int32 `yaml:"renewDeadline,omitempty" json:"renewDeadline,omitempty"`
	RetryPeriod   int32 `yaml:"retryPeriod,omitempty" json:"retryPeriod,omitempty"`
}

type ProxyConfig struct {
	BindAddress string   `yaml:"bindAddress" json:"bindAddress"`
	Port        int      `yaml:"port" json:"port"`
	ExtraSANs   []string `yaml:"extraSANs,omitempty" json:"extraSANs,omitempty"`
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
	Enabled   bool     `yaml:"enabled" json:"enabled"`
	ExtraArgs []string `yaml:"extraArgs,omitempty" json:"extraArgs,omitempty"`
}

type BackingStoreConfig struct {
	Etcd     *EtcdConfig     `yaml:"etcd,omitempty" json:"etcd,omitempty"`
	Database *DatabaseConfig `yaml:"database,omitempty" json:"database,omitempty"`
}

type DatabaseConfig struct {
	Embedded DatabaseEmbeddedConfig `yaml:"embedded" json:"embedded"`
}

type DatabaseEmbeddedConfig struct {
	Enabled bool `yaml:"enabled" json:"enabled"`
}

type EtcdConfig struct {
	Deploy EtcdDeployConfig `yaml:"deploy" json:"deploy"`
}

type EtcdDeployConfig struct {
	Enabled     bool                  `yaml:"enabled" json:"enabled"`
	StatefulSet EtcdStatefulSetConfig `yaml:"statefulSet" json:"statefulSet"`
}

type EtcdStatefulSetConfig struct {
	HighAvailability EtcdHAConfig          `yaml:"highAvailability" json:"highAvailability"`
	Persistence      EtcdPersistenceConfig `yaml:"persistence" json:"persistence"`
	Resources        ResourceRequirements  `yaml:"resources,omitempty" json:"resources,omitempty"`
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
	ToHost   SyncToHostConfig    `yaml:"toHost" json:"toHost"`
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
	ResourceQuota *ResourceQuotaVCluster `yaml:"resourceQuota,omitempty" json:"resourceQuota,omitempty"`
	LimitRange    *LimitRangeVCluster    `yaml:"limitRange,omitempty" json:"limitRange,omitempty"`
}

type ResourceQuotaVCluster struct {
	Enabled bool              `yaml:"enabled" json:"enabled"`
	Quota   map[string]string `yaml:"quota,omitempty" json:"quota,omitempty"`
}

type LimitRangeVCluster struct {
	Enabled        bool              `yaml:"enabled" json:"enabled"`
	Default        map[string]string `yaml:"default,omitempty" json:"default,omitempty"`
	DefaultRequest map[string]string `yaml:"defaultRequest,omitempty" json:"defaultRequest,omitempty"`
	Max            map[string]string `yaml:"max,omitempty" json:"max,omitempty"`
	Min            map[string]string `yaml:"min,omitempty" json:"min,omitempty"`
}

// GenerateVClusterConfig builds the v0.36 vcluster.yaml structure from a VirtualCluster spec
func GenerateVClusterConfig(spec *v1alpha1.VirtualClusterSpec) (*VClusterConfig, error) {
	preset := GetPresetConfig(spec.SizePreset, spec.CustomResources)

	k8sVersion := spec.KubernetesVersion
	if k8sVersion == "" {
		k8sVersion = "v1.31.0"
	}

	isHA := spec.HighAvailability || (preset.DefaultHA && spec.SizePreset != v1alpha1.PresetSmall)
	replicas := int32(1)
	if isHA {
		replicas = preset.SyncerReplicas
		if replicas == 0 {
			replicas = 3
		}
	}

	var backingStore BackingStoreConfig
	if isHA {
		etcdReplicas := preset.EtcdReplicas
		if etcdReplicas == 0 {
			etcdReplicas = 3
		}
		backingStore = BackingStoreConfig{
			Etcd: &EtcdConfig{
				Deploy: EtcdDeployConfig{
					Enabled: true,
					StatefulSet: EtcdStatefulSetConfig{
						HighAvailability: EtcdHAConfig{
							Replicas: etcdReplicas,
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
		}
	} else {
		backingStore = BackingStoreConfig{
			Database: &DatabaseConfig{
				Embedded: DatabaseEmbeddedConfig{
					Enabled: true,
				},
			},
		}
	}

	cfg := &VClusterConfig{
		ControlPlane: ControlPlaneConfig{
			StatefulSet: &ControlPlaneStatefulSet{
				HighAvailability: ControlPlaneHA{
					Replicas:      replicas,
					LeaseDuration: 60,
					RenewDeadline: 40,
					RetryPeriod:   15,
				},
			},
			Distro: DistroConfig{
				K8s: K8sDistro{
					Enabled: true,
					Version: k8sVersion,
					APIServer: &ComponentConfig{
						Enabled: true,
						ExtraArgs: []string{
							"--api-audiences=https://kubernetes.default.svc.cluster.local,https://kubernetes.default.svc.,https://kubernetes.default.svc,https://kubernetes.default",
						},
					},
					ControllerManager: &ComponentConfig{
						Enabled: true,
					},
				},
			},
			BackingStore: backingStore,
			CoreDNS: CoreDNSConfig{
				Enabled: false,
			},
			Proxy: &ProxyConfig{
				BindAddress: "0.0.0.0",
				Port:        8443,
			},
		},
		Integrations: IntegrationsConfig{
			MetricsServer: MetricsServerConfig{
				Enabled: false,
			},
		},
		Networking: &NetworkingConfig{
			Advanced: AdvancedNetworkingConfig{
				ProxyKubelets: ProxyKubeletsConfig{
					ByHostname: true,
					ByIP:       true,
				},
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
			FromHost: &SyncFromHostConfig{
				Nodes: SyncResourceConfig{
					Enabled: true,
				},
			},
		},
	}

	// Populate Governance Policies (ResourceQuota, LimitRange)
	policies := &PoliciesConfig{}

	quotaMap := make(map[string]string)
	if spec.Policies != nil && spec.Policies.ResourceQuota != nil && spec.Policies.ResourceQuota.Enabled {
		rq := spec.Policies.ResourceQuota
		if rq.RequestsCPU != "" {
			quotaMap["requests.cpu"] = rq.RequestsCPU
		}
		if rq.RequestsMemory != "" {
			quotaMap["requests.memory"] = rq.RequestsMemory
		}
		if rq.RequestsStorage != "" {
			quotaMap["requests.storage"] = rq.RequestsStorage
		}
		if rq.LimitsCPU != "" {
			quotaMap["limits.cpu"] = rq.LimitsCPU
		}
		if rq.LimitsMemory != "" {
			quotaMap["limits.memory"] = rq.LimitsMemory
		}
		if rq.Pods != "" {
			quotaMap["count/pods"] = rq.Pods
		}
		if rq.Services != "" {
			quotaMap["services"] = rq.Services
		}
		if rq.ServicesNodePorts != "" {
			quotaMap["services.nodeports"] = rq.ServicesNodePorts
		}
		if rq.ServicesLoadBalancers != "" {
			quotaMap["services.loadbalancers"] = rq.ServicesLoadBalancers
		}
		if rq.ConfigMaps != "" {
			quotaMap["configmaps"] = rq.ConfigMaps
		}
		if rq.Secrets != "" {
			quotaMap["secrets"] = rq.Secrets
		}
		if rq.PersistentVolumeClaims != "" {
			quotaMap["persistentvolumeclaims"] = rq.PersistentVolumeClaims
		}
	} else if spec.Policies == nil || spec.Policies.ResourceQuota == nil {
		switch spec.SizePreset {
		case v1alpha1.PresetSmall:
			quotaMap["requests.cpu"] = "1"
			quotaMap["requests.memory"] = "2Gi"
			quotaMap["requests.storage"] = "10Gi"
			quotaMap["limits.cpu"] = "2"
			quotaMap["limits.memory"] = "4Gi"
			quotaMap["count/pods"] = "10"
			quotaMap["services"] = "10"
			quotaMap["persistentvolumeclaims"] = "5"
		case v1alpha1.PresetLarge:
			quotaMap["requests.cpu"] = "8"
			quotaMap["requests.memory"] = "16Gi"
			quotaMap["requests.storage"] = "50Gi"
			quotaMap["limits.cpu"] = "16"
			quotaMap["limits.memory"] = "32Gi"
			quotaMap["count/pods"] = "50"
			quotaMap["services"] = "50"
			quotaMap["persistentvolumeclaims"] = "25"
		default:
			quotaMap["requests.cpu"] = "4"
			quotaMap["requests.memory"] = "8Gi"
			quotaMap["requests.storage"] = "25Gi"
			quotaMap["limits.cpu"] = "8"
			quotaMap["limits.memory"] = "16Gi"
			quotaMap["count/pods"] = "25"
			quotaMap["services"] = "25"
			quotaMap["persistentvolumeclaims"] = "10"
		}
	}

	if len(quotaMap) > 0 {
		policies.ResourceQuota = &ResourceQuotaVCluster{
			Enabled: true,
			Quota:   quotaMap,
		}
	}

	if spec.Policies != nil && spec.Policies.LimitRange != nil && spec.Policies.LimitRange.Enabled {
		lr := spec.Policies.LimitRange
		lrConfig := &LimitRangeVCluster{Enabled: true}
		if lr.DefaultCPU != "" || lr.DefaultMemory != "" {
			lrConfig.Default = make(map[string]string)
			if lr.DefaultCPU != "" {
				lrConfig.Default["cpu"] = lr.DefaultCPU
			}
			if lr.DefaultMemory != "" {
				lrConfig.Default["memory"] = lr.DefaultMemory
			}
		}
		if lr.DefaultRequestCPU != "" || lr.DefaultRequestMemory != "" {
			lrConfig.DefaultRequest = make(map[string]string)
			if lr.DefaultRequestCPU != "" {
				lrConfig.DefaultRequest["cpu"] = lr.DefaultRequestCPU
			}
			if lr.DefaultRequestMemory != "" {
				lrConfig.DefaultRequest["memory"] = lr.DefaultRequestMemory
			}
		}
		if lr.MaxCPU != "" || lr.MaxMemory != "" {
			lrConfig.Max = make(map[string]string)
			if lr.MaxCPU != "" {
				lrConfig.Max["cpu"] = lr.MaxCPU
			}
			if lr.MaxMemory != "" {
				lrConfig.Max["memory"] = lr.MaxMemory
			}
		}
		if lr.MinCPU != "" || lr.MinMemory != "" {
			lrConfig.Min = make(map[string]string)
			if lr.MinCPU != "" {
				lrConfig.Min["cpu"] = lr.MinCPU
			}
			if lr.MinMemory != "" {
				lrConfig.Min["memory"] = lr.MinMemory
			}
		}
		policies.LimitRange = lrConfig
	} else if spec.Policies == nil || spec.Policies.LimitRange == nil {
		policies.LimitRange = &LimitRangeVCluster{
			Enabled: true,
			Default: map[string]string{
				"cpu":    "1",
				"memory": "1Gi",
			},
			DefaultRequest: map[string]string{
				"cpu":    "100m",
				"memory": "128Mi",
			},
		}
	}

	cfg.Policies = policies

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
		if (k == "extraArgs" || k == "extraSANs") && dest[k] != nil {
			if destSlice, ok1 := dest[k].([]interface{}); ok1 {
				if srcSlice, ok2 := v.([]interface{}); ok2 {
					merged := append([]interface{}{}, destSlice...)
					for _, item := range srcSlice {
						itemStr := fmt.Sprintf("%v", item)
						found := false
						prefix := itemStr
						if idx := strings.Index(itemStr, "="); idx != -1 {
							prefix = itemStr[:idx+1]
						}
						for mIdx, existing := range merged {
							existingStr := fmt.Sprintf("%v", existing)
							if k == "extraArgs" && strings.HasPrefix(existingStr, prefix) {
								merged[mIdx] = item
								found = true
								break
							} else if k == "extraSANs" && existingStr == itemStr {
								found = true
								break
							}
						}
						if !found {
							merged = append(merged, item)
						}
					}
					dest[k] = merged
					continue
				}
			}
		}
		dest[k] = v
	}
}

// GenerateYAMLWithAnnotations produces the final vcluster.yaml string, incorporating RawConfig, HelmValues, and OIDC / Endpoint annotations
func GenerateYAMLWithAnnotations(spec *v1alpha1.VirtualClusterSpec, annotations map[string]string) ([]byte, error) {
	yamlBytes, err := GenerateYAML(spec)
	if err != nil {
		return nil, err
	}

	if len(annotations) == 0 {
		return yamlBytes, nil
	}

	var configMap map[string]interface{}
	if err := yaml.Unmarshal(yamlBytes, &configMap); err != nil {
		return yamlBytes, nil
	}

	// 1. Custom Endpoint -> Add SAN to controlPlane.proxy.extraSANs
	customEp := annotations["vops.gitops.io/custom-endpoint"]
	if customEp != "" {
		host := customEp
		if u, err := url.Parse(customEp); err == nil && u.Hostname() != "" {
			host = u.Hostname()
		} else {
			host = strings.TrimPrefix(host, "https://")
			host = strings.TrimPrefix(host, "http://")
			if idx := strings.Index(host, ":"); idx != -1 {
				host = host[:idx]
			}
			if idx := strings.Index(host, "/"); idx != -1 {
				host = host[:idx]
			}
		}

		if host != "" {
			cp, ok := configMap["controlPlane"].(map[string]interface{})
			if !ok {
				cp = make(map[string]interface{})
				configMap["controlPlane"] = cp
			}
			proxy, ok := cp["proxy"].(map[string]interface{})
			if !ok {
				proxy = make(map[string]interface{})
				cp["proxy"] = proxy
			}
			var sans []interface{}
			if existingSans, ok := proxy["extraSANs"].([]interface{}); ok {
				sans = existingSans
			}
			exists := false
			for _, s := range sans {
				if fmt.Sprintf("%v", s) == host {
					exists = true
					break
				}
			}
			if !exists {
				proxy["extraSANs"] = append(sans, host)
			}
		}
	}

	// 2. OIDC Configuration -> Add kube-apiserver extraArgs
	type OIDCAnnotation struct {
		Enabled         bool   `json:"enabled"`
		IssuerURL       string `json:"issuerUrl"`
		ClientID        string `json:"clientId"`
		UsernameClaim   string `json:"usernameClaim"`
		UsernamePrefix  string `json:"usernamePrefix"`
		GroupsClaim     string `json:"groupsClaim"`
		GroupsPrefix    string `json:"groupsPrefix"`
		CAFile          string `json:"caFile"`
		CACertificate   string `json:"caCertificate"`
		CASecretName    string `json:"caSecretName"`
		CAConfigMapName string `json:"caConfigMapName"`
	}

	var oidcCfg OIDCAnnotation
	if rawOIDC, ok := annotations["vops.gitops.io/oidc-config"]; ok && rawOIDC != "" {
		_ = json.Unmarshal([]byte(rawOIDC), &oidcCfg)
	} else if issuer, ok := annotations["vops.gitops.io/oidc-issuer-url"]; ok && issuer != "" {
		oidcCfg = OIDCAnnotation{
			Enabled:        true,
			IssuerURL:      issuer,
			ClientID:       annotations["vops.gitops.io/oidc-client-id"],
			UsernameClaim:  annotations["vops.gitops.io/oidc-username-claim"],
			UsernamePrefix: annotations["vops.gitops.io/oidc-username-prefix"],
			GroupsClaim:    annotations["vops.gitops.io/oidc-groups-claim"],
			GroupsPrefix:   annotations["vops.gitops.io/oidc-groups-prefix"],
			CAFile:         annotations["vops.gitops.io/oidc-ca-file"],
		}
	}

	// Auto-detect custom CA and default caFile if not explicitly configured
	hasCustomCA := oidcCfg.CACertificate != "" || oidcCfg.CASecretName != "" || oidcCfg.CAConfigMapName != "" ||
		annotations["vops.gitops.io/custom-ca-cert"] != "" || annotations["vops.gitops.io/oidc-ca-cert"] != "" ||
		annotations["vops.gitops.io/custom-ca-secret"] != "" || annotations["vops.gitops.io/custom-ca-configmap"] != ""
	if oidcCfg.CAFile == "" && hasCustomCA {
		oidcCfg.CAFile = "/etc/ssl/custom-ca/ca.crt"
	}

	if oidcCfg.Enabled && oidcCfg.IssuerURL != "" && oidcCfg.ClientID != "" {
		if oidcCfg.UsernameClaim == "" {
			oidcCfg.UsernameClaim = "email"
		}
		if oidcCfg.GroupsClaim == "" {
			oidcCfg.GroupsClaim = "groups"
		}

		cp, ok := configMap["controlPlane"].(map[string]interface{})
		if !ok {
			cp = make(map[string]interface{})
			configMap["controlPlane"] = cp
		}
		distro, ok := cp["distro"].(map[string]interface{})
		if !ok {
			distro = make(map[string]interface{})
			cp["distro"] = distro
		}
		k8s, ok := distro["k8s"].(map[string]interface{})
		if !ok {
			k8s = make(map[string]interface{})
			distro["k8s"] = k8s
		}
		apiServer, ok := k8s["apiServer"].(map[string]interface{})
		if !ok {
			apiServer = make(map[string]interface{})
			k8s["apiServer"] = apiServer
		}

		var args []interface{}
		if existingArgs, ok := apiServer["extraArgs"].([]interface{}); ok {
			args = existingArgs
		}

		oidcArgs := []string{
			fmt.Sprintf("--oidc-issuer-url=%s", oidcCfg.IssuerURL),
			fmt.Sprintf("--oidc-client-id=%s", oidcCfg.ClientID),
			fmt.Sprintf("--oidc-username-claim=%s", oidcCfg.UsernameClaim),
			fmt.Sprintf("--oidc-groups-claim=%s", oidcCfg.GroupsClaim),
		}
		if oidcCfg.UsernamePrefix != "" {
			oidcArgs = append(oidcArgs, fmt.Sprintf("--oidc-username-prefix=%s", oidcCfg.UsernamePrefix))
		}
		if oidcCfg.GroupsPrefix != "" {
			oidcArgs = append(oidcArgs, fmt.Sprintf("--oidc-groups-prefix=%s", oidcCfg.GroupsPrefix))
		}
		if oidcCfg.CAFile != "" {
			oidcArgs = append(oidcArgs, fmt.Sprintf("--oidc-ca-file=%s", oidcCfg.CAFile))
		}

		for _, oArg := range oidcArgs {
			prefix := oArg[:strings.Index(oArg, "=")+1]
			found := false
			for aIdx, existing := range args {
				if strings.HasPrefix(fmt.Sprintf("%v", existing), prefix) {
					args[aIdx] = oArg
					found = true
					break
				}
			}
			if !found {
				args = append(args, oArg)
			}
		}
		apiServer["extraArgs"] = args
	}

	return yaml.Marshal(configMap)
}
