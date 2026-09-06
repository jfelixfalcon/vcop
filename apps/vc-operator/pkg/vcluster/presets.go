package vcluster

import (
	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

// PresetConfig defines the hardware/storage defaults for a size preset
type PresetConfig struct {
	CPURequest     string
	CPULimit       string
	MemoryRequest  string
	MemoryLimit    string
	StorageSize    string
	DefaultHA      bool
	SyncerReplicas int32
	EtcdReplicas   int32
	Description    string
}

// GetPresetConfig returns preset configuration for the requested tier
func GetPresetConfig(preset v1alpha1.SizePreset, custom *v1alpha1.CustomResources) PresetConfig {
	switch preset {
	case v1alpha1.PresetHA, v1alpha1.PresetLarge, v1alpha1.PresetMedium:
		return PresetConfig{
			CPURequest:     "1000m",
			CPULimit:       "6000m",
			MemoryRequest:  "2Gi",
			MemoryLimit:    "12Gi",
			StorageSize:    "25Gi",
			DefaultHA:      true,
			SyncerReplicas: 3,
			EtcdReplicas:   3,
			Description:    "High Availability - 3x etcd quorum, 3x vCluster control plane, 3x CoreDNS",
		}
	case v1alpha1.PresetCustom:
		cpu := "2000m"
		mem := "4Gi"
		storage := "10Gi"
		if custom != nil {
			if custom.CPU != "" {
				cpu = custom.CPU
			}
			if custom.Memory != "" {
				mem = custom.Memory
			}
			if custom.Storage != "" {
				storage = custom.Storage
			}
		}
		return PresetConfig{
			CPURequest:     "500m",
			CPULimit:       cpu,
			MemoryRequest:  "1Gi",
			MemoryLimit:    mem,
			StorageSize:    storage,
			DefaultHA:      true,
			SyncerReplicas: 3,
			EtcdReplicas:   3,
			Description:    "Custom Tier - User defined allocations",
		}
	case v1alpha1.PresetSmall:
		return PresetConfig{
			CPURequest:     "500m",
			CPULimit:       "2000m",
			MemoryRequest:  "1Gi",
			MemoryLimit:    "4Gi",
			StorageSize:    "5Gi",
			DefaultHA:      false,
			SyncerReplicas: 1,
			EtcdReplicas:   0,
			Description:    "Sandbox - 1x vCluster control plane (embedded sqlite)",
		}
	case v1alpha1.PresetNormal:
		fallthrough
	default:
		return PresetConfig{
			CPURequest:     "500m",
			CPULimit:       "2000m",
			MemoryRequest:  "1Gi",
			MemoryLimit:    "4Gi",
			StorageSize:    "10Gi",
			DefaultHA:      false,
			SyncerReplicas: 1,
			EtcdReplicas:   1,
			Description:    "Normal - 1x etcd, 1x vCluster control plane, 1x CoreDNS",
		}
	}
}
