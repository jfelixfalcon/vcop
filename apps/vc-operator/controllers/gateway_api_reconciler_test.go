package controllers

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestGatewayAPIReconciler_ExtractClusterHost(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = v1alpha1.AddToScheme(scheme)
	fakeHostClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewGatewayAPIReconciler(fakeHostClient, nil)

	// Case 1: Explicit host in spec
	vc1 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "gw-cluster"},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Hosts: []string{"gateway.test.example.com"},
				},
			},
		},
	}
	if host := r.ExtractClusterHost(vc1); host != "gateway.test.example.com" {
		t.Fatalf("expected gateway.test.example.com, got %s", host)
	}

	// Case 2: Custom endpoint annotation
	vc2 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name: "gw-cluster",
			Annotations: map[string]string{
				"vops.gitops.io/custom-endpoint": "https://custom.gateway.example.com:443",
			},
		},
	}
	if host := r.ExtractClusterHost(vc2); host != "custom.gateway.example.com" {
		t.Fatalf("expected custom.gateway.example.com, got %s", host)
	}

	// Case 3: Default fallback
	vc3 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "gw-dev"},
	}
	if host := r.ExtractClusterHost(vc3); host != "gw-dev.local" {
		t.Fatalf("expected gw-dev.local, got %s", host)
	}
}

func TestGatewayAPIReconciler_ValidateCertManagerIssuer_Missing(t *testing.T) {
	scheme := runtime.NewScheme()
	fakeHostClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewGatewayAPIReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-gw-test",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
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

func TestGatewayAPIReconciler_ValidateCertManagerIssuer_Exists(t *testing.T) {
	scheme := runtime.NewScheme()
	issuerObj := &unstructured.Unstructured{}
	issuerObj.SetGroupVersionKind(clusterIssuerGVK)
	issuerObj.SetName("local-ca-issuer")

	fakeHostClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(issuerObj).
		Build()

	r := NewGatewayAPIReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-gw-test",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled:               true,
					CertificateIssuer:     "local-ca-issuer",
					CertificateIssuerKind: "ClusterIssuer",
				},
			},
		},
	}

	err := r.ValidateCertManagerIssuer(context.Background(), vc)
	if err != nil {
		t.Fatalf("expected valid cert-manager issuer check to succeed, got: %v", err)
	}
}

func TestGatewayAPIReconciler_Replicas_NonHA(t *testing.T) {
	r := NewGatewayAPIReconciler(nil, nil)

	vc := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: false,
			SizePreset:       v1alpha1.PresetNormal,
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled: true,
				},
			},
		},
	}

	if rep := r.GetGatewayProxyReplicas(vc); rep != 1 {
		t.Fatalf("expected 1 gateway proxy replica for non-HA cluster, got %d", rep)
	}
}

func TestGatewayAPIReconciler_Replicas_HA(t *testing.T) {
	r := NewGatewayAPIReconciler(nil, nil)

	vc1 := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: true,
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled: true,
				},
			},
		},
	}
	if rep := r.GetGatewayProxyReplicas(vc1); rep != 3 {
		t.Fatalf("expected 3 gateway proxy replicas for HA cluster, got %d", rep)
	}

	vc2 := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetHA,
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled: true,
				},
			},
		},
	}
	if rep := r.GetGatewayProxyReplicas(vc2); rep != 3 {
		t.Fatalf("expected 3 gateway proxy replicas for PresetHA cluster, got %d", rep)
	}
}

func TestGatewayAPIReconciler_Replicas_ExplicitOverride(t *testing.T) {
	r := NewGatewayAPIReconciler(nil, nil)

	proxyRep := int32(4)
	vc := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: false,
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled:  true,
					Replicas: &proxyRep,
				},
			},
		},
	}

	if rep := r.GetGatewayProxyReplicas(vc); rep != 4 {
		t.Fatalf("expected 4 replicas from explicit override, got %d", rep)
	}
}

func TestGatewayAPIReconciler_ReconcileHostRouting_Success(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)

	syncedSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy-x-gateway-system-x-vc-test",
			Namespace: "vc-test-ns",
			Labels: map[string]string{
				"vcluster.loft.sh/managed-by": "vc-test",
				"vcluster.loft.sh/namespace":  "gateway-system",
			},
		},
	}

	fakeHostClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(syncedSvc).
		Build()

	r := NewGatewayAPIReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-test",
			Namespace: "vc-test-ns",
			UID:       "12345-gw-test-uid",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled: true,
					Hosts:   []string{"app.vc-test.local"},
					HostRouting: &v1alpha1.GatewayHostRoutingConfig{
						Enabled:        true,
						DefaultGateway: "envoy-gateway-system/eg",
						ApiHost:        "api.vc-test.local",
					},
				},
			},
		},
	}

	err := r.reconcileHostRouting(context.Background(), vc, "app.vc-test.local")
	if err != nil {
		t.Fatalf("expected reconcileHostRouting to succeed, got: %v", err)
	}

	// Verify redirect HTTPRoute was created
	redirectRoute := &unstructured.Unstructured{}
	redirectRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
	err = fakeHostClient.Get(context.Background(), types.NamespacedName{
		Name:      "vc-test-redirect",
		Namespace: "vc-test-ns",
	}, redirectRoute)
	if err != nil {
		t.Fatalf("expected vc-test-redirect HTTPRoute to be created: %v", err)
	}

	// Verify HTTPS app HTTPRoute was created
	appRoute := &unstructured.Unstructured{}
	appRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
	err = fakeHostClient.Get(context.Background(), types.NamespacedName{
		Name:      "vc-test-route",
		Namespace: "vc-test-ns",
	}, appRoute)
	if err != nil {
		t.Fatalf("expected vc-test-route HTTPRoute to be created: %v", err)
	}

	// Verify API HTTPRoute was created
	apiRoute := &unstructured.Unstructured{}
	apiRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
	err = fakeHostClient.Get(context.Background(), types.NamespacedName{
		Name:      "vc-test-api-route",
		Namespace: "vc-test-ns",
	}, apiRoute)
	if err != nil {
		t.Fatalf("expected vc-test-api-route HTTPRoute to be created: %v", err)
	}
}

func TestGatewayAPIReconciler_CleanupAllGatewayAPI(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)

	hostSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cleanup-cluster-gateway-tls",
			Namespace: "cleanup-ns",
		},
	}

	fakeHostClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(hostSec).
		Build()

	r := NewGatewayAPIReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cleanup-cluster",
			Namespace: "cleanup-ns",
		},
	}

	err := r.CleanupAllGatewayAPI(context.Background(), vc)
	if err != nil {
		t.Fatalf("expected CleanupAllGatewayAPI to succeed, got: %v", err)
	}

	// Verify secret was cleaned up
	secCheck := &corev1.Secret{}
	err = fakeHostClient.Get(context.Background(), types.NamespacedName{
		Name:      "cleanup-cluster-gateway-tls",
		Namespace: "cleanup-ns",
	}, secCheck)
	if err == nil {
		t.Fatal("expected gateway tls secret to be deleted, but still exists")
	}
}

func TestGatewayAPIReconciler_UnifiedHostRouting_IstioActive(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)

	istioSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway-x-istio-system-x-vc-test",
			Namespace: "vc-test-ns",
			Labels: map[string]string{
				"vcluster.loft.sh/managed-by": "vc-test",
				"vcluster.loft.sh/namespace":  "istio-system",
				"app":                         "istio-ingressgateway",
			},
		},
	}

	fakeHostClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(istioSvc).
		Build()

	r := NewGatewayAPIReconciler(fakeHostClient, nil)

	// VirtualCluster with Gateway API disabled, but Istio enabled with host routing
	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-test",
			Namespace: "vc-test-ns",
			UID:       "12345-gw-test-uid",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				GatewayAPI: &v1alpha1.GatewayAPIComponent{
					Enabled: false,
				},
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					Hosts:   []string{"vc-test.local"},
					HostRouting: &v1alpha1.HostRoutingConfig{
						Enabled: true,
						ApiHost: "api.vc-test.local",
					},
				},
			},
		},
	}

	err := r.ReconcileUnifiedHostRouting(context.Background(), vc)
	if err != nil {
		t.Fatalf("expected ReconcileUnifiedHostRouting to succeed, got: %v", err)
	}

	// Verify vc-test-route HTTPRoute points to Istio ingressgateway backend
	appRoute := &unstructured.Unstructured{}
	appRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
	err = fakeHostClient.Get(context.Background(), types.NamespacedName{
		Name:      "vc-test-route",
		Namespace: "vc-test-ns",
	}, appRoute)
	if err != nil {
		t.Fatalf("expected vc-test-route HTTPRoute to be created: %v", err)
	}

	rules := appRoute.Object["spec"].(map[string]interface{})["rules"].([]interface{})
	backendRefs := rules[0].(map[string]interface{})["backendRefs"].([]interface{})
	targetName := backendRefs[0].(map[string]interface{})["name"].(string)
	if targetName != "istio-ingressgateway-x-istio-system-x-vc-test" {
		t.Fatalf("expected target backend istio-ingressgateway-x-istio-system-x-vc-test, got: %s", targetName)
	}

	// Verify API route is also active
	apiRoute := &unstructured.Unstructured{}
	apiRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
	err = fakeHostClient.Get(context.Background(), types.NamespacedName{
		Name:      "vc-test-api-route",
		Namespace: "vc-test-ns",
	}, apiRoute)
	if err != nil {
		t.Fatalf("expected vc-test-api-route HTTPRoute to be created: %v", err)
	}
}
