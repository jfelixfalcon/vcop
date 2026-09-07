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

func TestIstioReconciler_Replicas_NonHA(t *testing.T) {
	r := NewIstioReconciler(nil, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "vc-non-ha"},
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: false,
			SizePreset:       v1alpha1.PresetNormal,
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					IngressGateway: &v1alpha1.IstioGatewayConfig{
						Enabled: true,
					},
				},
			},
		},
	}

	if rep := r.GetIstiodReplicas(vc); rep != 1 {
		t.Fatalf("expected 1 istiod replica for non-HA cluster, got %d", rep)
	}
	if rep := r.GetIngressGatewayReplicas(vc); rep != 1 {
		t.Fatalf("expected 1 ingress gateway replica for non-HA cluster, got %d", rep)
	}
}

func TestIstioReconciler_Replicas_HA(t *testing.T) {
	r := NewIstioReconciler(nil, nil)

	// Case 1: HighAvailability = true
	vc1 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "vc-ha-flag"},
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: true,
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					IngressGateway: &v1alpha1.IstioGatewayConfig{
						Enabled: true,
					},
				},
			},
		},
	}

	if rep := r.GetIstiodReplicas(vc1); rep != 3 {
		t.Fatalf("expected 3 istiod replicas for HA cluster, got %d", rep)
	}
	if rep := r.GetIngressGatewayReplicas(vc1); rep != 3 {
		t.Fatalf("expected 3 ingress gateway replicas for HA cluster, got %d", rep)
	}

	// Case 2: SizePreset = ha
	vc2 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "vc-ha-preset"},
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetHA,
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					IngressGateway: &v1alpha1.IstioGatewayConfig{
						Enabled: true,
					},
				},
			},
		},
	}

	if rep := r.GetIstiodReplicas(vc2); rep != 3 {
		t.Fatalf("expected 3 istiod replicas for PresetHA cluster, got %d", rep)
	}
	if rep := r.GetIngressGatewayReplicas(vc2); rep != 3 {
		t.Fatalf("expected 3 ingress gateway replicas for PresetHA cluster, got %d", rep)
	}
}

func TestIstioReconciler_Replicas_ExplicitOverride(t *testing.T) {
	r := NewIstioReconciler(nil, nil)

	istiodRep := int32(5)
	gwRep := int32(4)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "vc-custom-replicas"},
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: true, // HA would default to 3, but explicit override should take precedence
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled:  true,
					Replicas: &istiodRep,
					IngressGateway: &v1alpha1.IstioGatewayConfig{
						Enabled:  true,
						Replicas: &gwRep,
					},
				},
			},
		},
	}

	if rep := r.GetIstiodReplicas(vc); rep != 5 {
		t.Fatalf("expected 5 istiod replicas from explicit override, got %d", rep)
	}
	if rep := r.GetIngressGatewayReplicas(vc); rep != 4 {
		t.Fatalf("expected 4 ingress gateway replicas from explicit override, got %d", rep)
	}
}

