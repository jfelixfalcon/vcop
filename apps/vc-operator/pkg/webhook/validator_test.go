package webhook

import (
	"context"
	"testing"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"github.com/vops/vc-operator/pkg/capacity"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
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

func TestValidator_ValidateCapacity(t *testing.T) {
	ctx := context.Background()
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "worker-1"},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("16"),
				corev1.ResourceMemory:           resource.MustParse("32Gi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
		},
	}

	client := fake.NewClientBuilder().WithScheme(scheme).WithObjects(node).Build()
	v := NewVirtualClusterValidator(client)

	// Fits within 16 CPU:
	fitVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "fit-vc", Namespace: "default"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "fit-vc",
			SizePreset:  v1alpha1.PresetMedium, // 4 CPU, 8Gi RAM
		},
	}
	if err := v.ValidateCreate(ctx, fitVC); err != nil {
		t.Fatalf("Expected fitVC to be accepted, got: %v", err)
	}

	// Exceeds 16 CPU (Preset large is 8 CPU, but asking 20 CPU custom):
	hugeVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "huge-vc", Namespace: "default"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "huge-vc",
			CustomResources: &v1alpha1.CustomResources{
				CPU:    "20",
				Memory: "10Gi",
			},
		},
	}
	if err := v.ValidateCreate(ctx, hugeVC); err == nil {
		t.Fatalf("Expected hugeVC to be rejected for exceeding host CPU, but succeeded")
	}

	// Bypass annotation allows creation despite overallocation
	bypassVC := hugeVC.DeepCopy()
	bypassVC.Annotations = map[string]string{capacity.IgnoreCapacityAnnotation: "true"}
	if err := v.ValidateCreate(ctx, bypassVC); err != nil {
		t.Fatalf("Expected bypassVC to succeed, got: %v", err)
	}
}

func TestValidator_ClusterType(t *testing.T) {
	v := NewVirtualClusterValidator()
	ctx := context.Background()

	// Valid namespaced cluster
	namespaced := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "ns-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "ns-cluster",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
			Namespaces:  []string{"team-a", "team-b"},
		},
	}
	if err := v.ValidateCreate(ctx, namespaced); err != nil {
		t.Fatalf("Expected namespaced cluster to be valid, got: %v", err)
	}

	// Valid host cluster (alias)
	hostCluster := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "host-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "host-cluster",
			ClusterType: v1alpha1.ClusterTypeHost,
		},
	}
	if err := v.ValidateCreate(ctx, hostCluster); err != nil {
		t.Fatalf("Expected host cluster to be valid, got: %v", err)
	}

	// Invalid cluster type
	invalidType := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "invalid-type"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "invalid-type",
			ClusterType: "unsupported-mode",
		},
	}
	if err := v.ValidateCreate(ctx, invalidType); err == nil {
		t.Fatalf("Expected error for invalid clusterType, got nil")
	}

	// Prohibited clusterType change on update
	oldVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "vc-to-ns"},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "vc-to-ns",
			ClusterType: v1alpha1.ClusterTypeVCluster,
		},
	}
	newVC := oldVC.DeepCopy()
	newVC.Spec.ClusterType = v1alpha1.ClusterTypeNamespaced
	if err := v.ValidateUpdate(ctx, oldVC, newVC); err == nil {
		t.Fatalf("Expected error when attempting to change clusterType on existing cluster, got nil")
	}
}
