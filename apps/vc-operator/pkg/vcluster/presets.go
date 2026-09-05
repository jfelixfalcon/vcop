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
			Description:    "Sandbox - 2 vCPU / 4GB RAM (Ideal for dev testing and ephemeral pull requests)",
		}
	case v1alpha1.PresetLarge:
		return PresetConfig{
			CPURequest:     "2000m",
			CPULimit:       "8000m",
			MemoryRequest:  "4Gi",
			MemoryLimit:    "16Gi",
			StorageSize:    "25Gi",
			DefaultHA:      true,
			SyncerReplicas: 3,
			EtcdReplicas:   3,
			Description:    "Production HA - 8 vCPU / 16GB RAM (3-Node Quorum etcd, multi-zone resiliency)",
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
	case v1alpha1.PresetMedium:
		fallthrough
	default:
		return PresetConfig{
			CPURequest:     "1000m",
			CPULimit:       "4000m",
			MemoryRequest:  "2Gi",
			MemoryLimit:    "8Gi",
			StorageSize:    "10Gi",
			DefaultHA:      true,
			SyncerReplicas: 3,
			EtcdReplicas:   3,
			Description:    "Standard - 4 vCPU / 8GB RAM (Balanced for QA and staging workloads)",
		}
	}
}
