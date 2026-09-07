package controllers

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestIstioReconciler_ExtractClusterHost(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = v1alpha1.AddToScheme(scheme)
	fakeHostClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewIstioReconciler(fakeHostClient, nil)

	// Case 1: Explicit host in spec
	vc1 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "my-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Hosts: []string{"apps.test.example.com"},
				},
			},
		},
	}
	if host := r.ExtractClusterHost(vc1); host != "apps.test.example.com" {
		t.Fatalf("expected apps.test.example.com, got %s", host)
	}

	// Case 2: Custom endpoint annotation
	vc2 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-cluster",
			Annotations: map[string]string{
				"vops.gitops.io/custom-endpoint": "https://gateway.example.com:443",
			},
		},
	}
	if host := r.ExtractClusterHost(vc2); host != "gateway.example.com" {
		t.Fatalf("expected gateway.example.com, got %s", host)
	}

	// Case 3: Default fallback
	vc3 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "dev-cluster"},
	}
	if host := r.ExtractClusterHost(vc3); host != "dev-cluster.local" {
		t.Fatalf("expected dev-cluster.local, got %s", host)
	}
}

func TestIstioReconciler_ValidateCertManagerIssuer_Missing(t *testing.T) {
	scheme := runtime.NewScheme()
	fakeHostClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewIstioReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-test",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled:               true,
					CertificateIssuer:     "non-existent-issuer",
					CertificateIssuerKind: "ClusterIssuer",
				},
			},
		},
	}

	err := r.ValidateCertManagerIssuer(context.Background(), vc)
	if err == nil {
		t.Fatal("expected error when cert-manager issuer does not exist on host, but got nil")
	}
}

func TestIstioReconciler_ValidateCertManagerIssuer_Exists(t *testing.T) {
	scheme := runtime.NewScheme()
	issuerObj := &unstructured.Unstructured{}
	issuerObj.SetGroupVersionKind(clusterIssuerGVK)
	issuerObj.SetName("letsencrypt-prod")

	fakeHostClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(issuerObj).
		Build()

	r := NewIstioReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-test",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled:               true,
					CertificateIssuer:     "letsencrypt-prod",
					CertificateIssuerKind: "ClusterIssuer",
				},
			},
		},
	}

	err := r.ValidateCertManagerIssuer(context.Background(), vc)
	if err != nil {
		t.Fatalf("expected issuer validation to pass, but got: %v", err)
	}
}
