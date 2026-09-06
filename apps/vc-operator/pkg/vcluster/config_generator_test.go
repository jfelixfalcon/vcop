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
	if !strings.Contains(yamlStr, "coredns:") || !strings.Contains(yamlStr, "enabled: false") {
		t.Errorf("Expected built-in coredns disabled in favor of external, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "metricsServer:") {
		t.Errorf("Expected metricsServer section, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "deploy:") {
		t.Errorf("Expected etcd deploy in HA, got:\n%s", yamlStr)
	}
}

func TestGenerateYAML_RawOverride(t *testing.T) {
	rawJSON := `{"controlPlane":{"coredns":{"enabled":false}}}`
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
	if !strings.Contains(yamlStr, "coredns:") || !strings.Contains(yamlStr, "enabled: false") {
		t.Errorf("Expected coredns enabled: false from override, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "database:") || !strings.Contains(yamlStr, "embedded:") {
		t.Errorf("Expected embedded database for non-HA, got:\n%s", yamlStr)
	}
}

func TestGenerateYAMLWithAnnotations(t *testing.T) {
	spec := &v1alpha1.VirtualClusterSpec{
		ClusterName:       "tenant-oidc",
		KubernetesVersion: "v1.31.0",
		SizePreset:        v1alpha1.PresetMedium,
	}

	annotations := map[string]string{
		"vops.gitops.io/custom-endpoint": "https://api.vcluster.example.com:443",
		"vops.gitops.io/oidc-config":     `{"enabled":true,"issuerUrl":"https://accounts.google.com","clientId":"vcluster-client","usernameClaim":"email","groupsClaim":"groups"}`,
	}

	yamlBytes, err := GenerateYAMLWithAnnotations(spec, annotations)
	if err != nil {
		t.Fatalf("GenerateYAMLWithAnnotations failed: %v", err)
	}

	yamlStr := string(yamlBytes)
	if !strings.Contains(yamlStr, "api.vcluster.example.com") {
		t.Errorf("Expected custom endpoint SAN 'api.vcluster.example.com' in yaml, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "--oidc-issuer-url=https://accounts.google.com") {
		t.Errorf("Expected --oidc-issuer-url in yaml, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "--oidc-client-id=vcluster-client") {
		t.Errorf("Expected --oidc-client-id in yaml, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "--oidc-username-claim=email") {
		t.Errorf("Expected --oidc-username-claim=email in yaml, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "--oidc-groups-claim=groups") {
		t.Errorf("Expected --oidc-groups-claim=groups in yaml, got:\n%s", yamlStr)
	}
	if !strings.Contains(yamlStr, "--api-audiences=") {
		t.Errorf("Expected --api-audiences preserved in yaml, got:\n%s", yamlStr)
	}
}
