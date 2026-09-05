package webhook

import (
	"context"
	"testing"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
)

func TestValidator_ValidateCreate(t *testing.T) {
	v := NewVirtualClusterValidator()
	ctx := context.Background()

	// Valid cluster
	valid := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "test-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       "test-cluster",
			KubernetesVersion: "v1.31.0",
			VClusterVersion:   "0.37.0",
		},
	}
	if err := v.ValidateCreate(ctx, valid); err != nil {
		t.Fatalf("Expected valid, got error: %v", err)
	}

	// Invalid cluster name
	invalidName := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "bad_name"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "Bad_Name_With_Caps",
		},
	}
	if err := v.ValidateCreate(ctx, invalidName); err == nil {
		t.Fatalf("Expected error for invalid cluster name, got nil")
	}

	// Invalid raw YAML
	invalidRaw := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "bad-yaml"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "bad-yaml",
			RawConfig:   &runtime.RawExtension{Raw: []byte("controlPlane: [unclosed bracket")},
		},
	}
	if err := v.ValidateCreate(ctx, invalidRaw); err == nil {
		t.Fatalf("Expected error for invalid raw YAML, got nil")
	}
}

func TestValidator_ValidateUpdate_DowngradesAndJumps(t *testing.T) {
	v := NewVirtualClusterValidator()
	ctx := context.Background()

	oldVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "test-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       "test-cluster",
			KubernetesVersion: "v1.30.0",
			VClusterVersion:   "0.37.0",
		},
	}

	// Prohibited downgrade
	downgradeVC := oldVC.DeepCopy()
	downgradeVC.Spec.KubernetesVersion = "v1.29.0"
	if err := v.ValidateUpdate(ctx, oldVC, downgradeVC); err == nil {
		t.Fatalf("Expected error on Kubernetes downgrade, got nil")
	}

	// Prohibited multi-minor jump (v1.30 to v1.32 skips v1.31)
	skipMinorVC := oldVC.DeepCopy()
	skipMinorVC.Spec.KubernetesVersion = "v1.32.0"
	if err := v.ValidateUpdate(ctx, oldVC, skipMinorVC); err == nil {
		t.Fatalf("Expected error on multi-minor version jump, got nil")
	}

	// Valid single-minor upgrade (v1.30 to v1.31)
	validUpgradeVC := oldVC.DeepCopy()
	validUpgradeVC.Spec.KubernetesVersion = "v1.31.0"
	if err := v.ValidateUpdate(ctx, oldVC, validUpgradeVC); err != nil {
		t.Fatalf("Expected valid upgrade v1.30 to v1.31, got error: %v", err)
	}

	// Prohibited cluster name change
	changedNameVC := oldVC.DeepCopy()
	changedNameVC.Spec.ClusterName = "different-name"
	if err := v.ValidateUpdate(ctx, oldVC, changedNameVC); err == nil {
		t.Fatalf("Expected error on clusterName modification, got nil")
	}
}
