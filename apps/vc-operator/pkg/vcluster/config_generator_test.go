package vcluster

import (
	"strings"
	"testing"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"k8s.io/apimachinery/pkg/runtime"
)

func TestGenerateYAML_DefaultHA(t *testing.T) {
	spec := &v1alpha1.VirtualClusterSpec{
		ClusterName:       "tenant-dev",
		KubernetesVersion: "v1.31.0",
		SizePreset:        v1alpha1.PresetMedium,
		HighAvailability:  true,
		Components: v1alpha1.ComponentsSpec{
			CoreDNS:       v1alpha1.CoreDNSComponent{Enabled: true},
			MetricsServer: v1alpha1.MetricsServerComponent{Enabled: true},
		},
		Sync: v1alpha1.SyncSpec{
			Pods:      true,
			Services:  true,
			Ingresses: true,
		},
	}

	yamlBytes, err := GenerateYAML(spec)
	if err != nil {
		t.Fatalf("GenerateYAML failed: %v", err)
	}

	yamlStr := string(yamlBytes)
	if !strings.Contains(yamlStr, "replicas: 3") {
		t.Errorf("Expected 3 replicas for HA etcd, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "metricsServer") || !strings.Contains(yamlStr, "enabled: true") {
		t.Errorf("Expected metricsServer enabled, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "coreDNS") {
		t.Errorf("Expected coreDNS enabled, got:\n%s", yamlStr)
	}
}

func TestGenerateYAML_RawOverride(t *testing.T) {
	rawJSON := `{"controlPlane":{"coreDNS":{"enabled":false}}}`
	spec := &v1alpha1.VirtualClusterSpec{
		ClusterName:       "tenant-override",
		KubernetesVersion: "v1.31.0",
		SizePreset:        v1alpha1.PresetSmall,
		HighAvailability:  false,
		RawConfig:         &runtime.RawExtension{Raw: []byte(rawJSON)},
	}

	yamlBytes, err := GenerateYAML(spec)
	if err != nil {
		t.Fatalf("GenerateYAML failed: %v", err)
	}

	yamlStr := string(yamlBytes)
	if !strings.Contains(yamlStr, "replicas: 1") {
		t.Errorf("Expected 1 replica for non-HA, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "coreDNS:") || !strings.Contains(yamlStr, "enabled: false") {
		t.Errorf("Expected coreDNS enabled: false from override, got:\n%s", yamlStr)
	}
}
