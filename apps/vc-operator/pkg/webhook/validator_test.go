package webhook

import (
	"context"
	"testing"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
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
			VClusterVersion:   "0.36.0",
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
			VClusterVersion:   "0.36.0",
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

func TestValidator_ValidateCreate_IstioCertManager(t *testing.T) {
	ctx := context.Background()

	// 1. Invalid issuer kind
	vOffline := NewVirtualClusterValidator()
	invalidKindVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "test-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "test-cluster",
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled:               true,
					CertificateIssuer:     "my-issuer",
					CertificateIssuerKind: "UnknownKind",
				},
			},
		},
	}
	if err := vOffline.ValidateCreate(ctx, invalidKindVC); err == nil {
		t.Fatal("expected error on unsupported CertificateIssuerKind, got nil")
	}

	// 2. Issuer missing on host cluster
	scheme := runtime.NewScheme()
	fakeClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	vOnline := NewVirtualClusterValidator(fakeClient)

	missingIssuerVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "test-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "test-cluster",
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled:               true,
					CertificateIssuer:     "non-existent-issuer",
					CertificateIssuerKind: "ClusterIssuer",
				},
			},
		},
	}
	if err := vOnline.ValidateCreate(ctx, missingIssuerVC); err == nil {
		t.Fatal("expected error when cert-manager issuer does not exist on host cluster, got nil")
	}

	// 3. Issuer exists on host cluster
	issuerObj := &unstructured.Unstructured{}
	issuerObj.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "cert-manager.io",
		Version: "v1",
		Kind:    "ClusterIssuer",
	})
	issuerObj.SetName("letsencrypt-prod")

	fakeClientWithIssuer := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(issuerObj).
		Build()
	vOnlineValid := NewVirtualClusterValidator(fakeClientWithIssuer)

	validIssuerVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "test-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "test-cluster",
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled:               true,
					CertificateIssuer:     "letsencrypt-prod",
					CertificateIssuerKind: "ClusterIssuer",
				},
			},
		},
	}
	if err := vOnlineValid.ValidateCreate(ctx, validIssuerVC); err != nil {
		t.Fatalf("expected valid issuer to pass, got: %v", err)
	}
}
