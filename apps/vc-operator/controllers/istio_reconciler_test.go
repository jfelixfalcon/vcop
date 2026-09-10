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

func TestIstioReconciler_ReconcileHostRouting_Success(t *testing.T) {
	scheme := runtime.NewScheme()
	fakeHostClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewIstioReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-test",
			Namespace: "vc-test-ns",
			UID:       "test-uid-1234",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					Hosts:   []string{"app.example.com"},
					HostRouting: &v1alpha1.HostRoutingConfig{
						Enabled:        true,
						DefaultGateway: "my-gateway/corp-gw",
						IngressGatewaySelector: map[string]string{
							"custom-label": "my-gateway",
						},
						ApiHost: "k8s-api.example.com",
					},
				},
			},
		},
	}

	ctx := context.Background()
	err := r.reconcileHostRouting(ctx, vc, "my-cert-secret", "app.example.com")
	if err != nil {
		t.Fatalf("reconcileHostRouting failed: %v", err)
	}

	// 1. Verify DestinationRule
	dr := &unstructured.Unstructured{}
	dr.SetGroupVersionKind(destinationRuleGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-test-guest-gateway", Namespace: "vc-test-ns"}, dr); err != nil {
		t.Fatalf("failed getting DestinationRule: %v", err)
	}
	expectedDRHost := "istio-ingressgateway-x-istio-system-x-vc-test.vc-test-ns.svc.cluster.local"
	if dr.Object["spec"].(map[string]interface{})["host"] != expectedDRHost {
		t.Fatalf("expected DR host %s, got %v", expectedDRHost, dr.Object["spec"].(map[string]interface{})["host"])
	}
	tp := dr.Object["spec"].(map[string]interface{})["trafficPolicy"].(map[string]interface{})
	httpPolicy := tp["connectionPool"].(map[string]interface{})["http"].(map[string]interface{})
	if httpPolicy["h2UpgradePolicy"] != "DO_NOT_UPGRADE" {
		t.Fatalf("expected h2UpgradePolicy DO_NOT_UPGRADE, got %v", httpPolicy["h2UpgradePolicy"])
	}
	tlsPolicy := tp["tls"].(map[string]interface{})
	if tlsPolicy["mode"] != "MUTUAL" {
		t.Fatalf("expected tls mode MUTUAL, got %v", tlsPolicy["mode"])
	}
	if tlsPolicy["credentialName"] != "my-cert-secret" {
		t.Fatalf("expected credentialName my-cert-secret, got %v", tlsPolicy["credentialName"])
	}

	// 2. Verify Host Application VirtualService
	vsApp := &unstructured.Unstructured{}
	vsApp.SetGroupVersionKind(virtualServiceGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-test-host-entrypoint", Namespace: "vc-test-ns"}, vsApp); err != nil {
		t.Fatalf("failed getting host app VirtualService: %v", err)
	}
	gwList := vsApp.Object["spec"].(map[string]interface{})["gateways"].([]interface{})
	if len(gwList) != 1 || gwList[0] != "my-gateway/corp-gw" {
		t.Fatalf("expected gateway my-gateway/corp-gw, got %v", gwList)
	}
	appRoutes := vsApp.Object["spec"].(map[string]interface{})["http"].([]interface{})
	appRouteDest := appRoutes[0].(map[string]interface{})["route"].([]interface{})[0].(map[string]interface{})["destination"].(map[string]interface{})
	if appRouteDest["host"] != expectedDRHost {
		t.Fatalf("expected app route destination host %s, got %v", expectedDRHost, appRouteDest["host"])
	}
	if appRouteDest["port"].(map[string]interface{})["number"] != int64(443) {
		t.Fatalf("expected app route destination port 443, got %v", appRouteDest["port"])
	}

	// 3. Verify Host API Gateway
	gwApi := &unstructured.Unstructured{}
	gwApi.SetGroupVersionKind(gatewayGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-test-api-gateway", Namespace: "vc-test-ns"}, gwApi); err != nil {
		t.Fatalf("failed getting API Gateway: %v", err)
	}
	sel := gwApi.Object["spec"].(map[string]interface{})["selector"].(map[string]interface{})
	if sel["custom-label"] != "my-gateway" {
		t.Fatalf("expected selector custom-label=my-gateway, got %v", sel)
	}
	servers := gwApi.Object["spec"].(map[string]interface{})["servers"].([]interface{})
	serverTls := servers[0].(map[string]interface{})["tls"].(map[string]interface{})
	if serverTls["mode"] != "PASSTHROUGH" {
		t.Fatalf("expected API Gateway TLS mode PASSTHROUGH, got %v", serverTls["mode"])
	}
	serverPort := servers[0].(map[string]interface{})["port"].(map[string]interface{})
	if serverPort["number"] != int64(443) {
		t.Fatalf("expected API Gateway port 443, got %v", serverPort["number"])
	}

	// 4. Verify Host API VirtualService
	vsApi := &unstructured.Unstructured{}
	vsApi.SetGroupVersionKind(virtualServiceGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-test-api-entrypoint", Namespace: "vc-test-ns"}, vsApi); err != nil {
		t.Fatalf("failed getting API VirtualService: %v", err)
	}
	tlsRoutes := vsApi.Object["spec"].(map[string]interface{})["tls"].([]interface{})
	tlsMatch := tlsRoutes[0].(map[string]interface{})["match"].([]interface{})[0].(map[string]interface{})
	if tlsMatch["port"] != int64(443) {
		t.Fatalf("expected TLS match port 443, got %v", tlsMatch["port"])
	}
	sniHosts := tlsMatch["sniHosts"].([]interface{})
	if len(sniHosts) != 1 || sniHosts[0] != "k8s-api.example.com" {
		t.Fatalf("expected sniHost k8s-api.example.com, got %v", sniHosts)
	}
	destApi := tlsRoutes[0].(map[string]interface{})["route"].([]interface{})[0].(map[string]interface{})["destination"].(map[string]interface{})
	expectedApiSvc := "vc-test.vc-test-ns.svc.cluster.local"
	if destApi["host"] != expectedApiSvc {
		t.Fatalf("expected API route destination %s, got %v", expectedApiSvc, destApi["host"])
	}
	if destApi["port"].(map[string]interface{})["number"] != int64(443) {
		t.Fatalf("expected API route destination port 443, got %v", destApi["port"])
	}
}

func TestIstioReconciler_ReconcileHostRouting_Defaults(t *testing.T) {
	scheme := runtime.NewScheme()
	fakeHostClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	r := NewIstioReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-demo",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					HostRouting: &v1alpha1.HostRoutingConfig{
						Enabled: true,
					},
				},
			},
		},
	}

	ctx := context.Background()
	err := r.reconcileHostRouting(ctx, vc, "vc-demo-ingress-tls", "vc-demo.prod.io")
	if err != nil {
		t.Fatalf("reconcileHostRouting with defaults failed: %v", err)
	}

	// Check default gateway
	vsApp := &unstructured.Unstructured{}
	vsApp.SetGroupVersionKind(virtualServiceGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-demo-host-entrypoint", Namespace: "default"}, vsApp); err != nil {
		t.Fatalf("failed getting host app VirtualService: %v", err)
	}
	gwList := vsApp.Object["spec"].(map[string]interface{})["gateways"].([]interface{})
	if len(gwList) != 1 || gwList[0] != "istio-system/default-gateway" {
		t.Fatalf("expected default gateway istio-system/default-gateway, got %v", gwList)
	}

	// Check default ingress gateway selector
	gwApi := &unstructured.Unstructured{}
	gwApi.SetGroupVersionKind(gatewayGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-demo-api-gateway", Namespace: "default"}, gwApi); err != nil {
		t.Fatalf("failed getting API Gateway: %v", err)
	}
	sel := gwApi.Object["spec"].(map[string]interface{})["selector"].(map[string]interface{})
	if sel["istio"] != "ingressgateway" {
		t.Fatalf("expected default selector istio=ingressgateway, got %v", sel)
	}

	// Check default apiHost derived from hostFQDN
	servers := gwApi.Object["spec"].(map[string]interface{})["servers"].([]interface{})
	hosts := servers[0].(map[string]interface{})["hosts"].([]interface{})
	if len(hosts) != 1 || hosts[0] != "api.vc-demo.prod.io" {
		t.Fatalf("expected default api host api.vc-demo.prod.io, got %v", hosts)
	}

	// Check cleanupHostRouting
	if err := r.cleanupHostRouting(ctx, vc); err != nil {
		t.Fatalf("cleanupHostRouting failed: %v", err)
	}
	dr := &unstructured.Unstructured{}
	dr.SetGroupVersionKind(destinationRuleGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-demo-guest-gateway", Namespace: "default"}, dr); err == nil {
		t.Fatalf("expected DestinationRule to be deleted, but still found")
	}
}

func TestIstioReconciler_AutoDetection_And_Fallback(t *testing.T) {
	ctx := context.Background()
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	// Pre-create an external host gateway in istio-ingress
	externalGw := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "networking.istio.io/v1beta1",
			"kind":       "Gateway",
			"metadata": map[string]interface{}{
				"name":      "external-gateway",
				"namespace": "istio-ingress",
			},
		},
	}
	// Pre-create host ingress gateway pod with app=istio-ingressgateway in istio-ingress
	hostIngressPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway-7489-abc",
			Namespace: "istio-ingress",
			Labels: map[string]string{
				"app": "istio-ingressgateway",
			},
		},
	}
	// Pre-create the synced guest ingressgateway service on the host
	guestSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway-x-istio-system-x-vc-auto",
			Namespace: "tenant-ns",
			Labels: map[string]string{
				"vcluster.loft.sh/managed-by": "vc-auto",
				"vcluster.loft.sh/namespace":  "istio-system",
				"app":                         "istio-ingressgateway",
			},
		},
		Spec: corev1.ServiceSpec{
			Ports: []corev1.ServicePort{
				{Port: 443, Name: "https"},
			},
		},
	}

	fakeHostClient := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(hostIngressPod, guestSvc, externalGw).
		Build()

	r := NewIstioReconciler(fakeHostClient, nil)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vc-auto",
			Namespace: "tenant-ns",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			Components: v1alpha1.ComponentsSpec{
				Istio: &v1alpha1.IstioComponent{
					Enabled: true,
					HostRouting: &v1alpha1.HostRoutingConfig{
						Enabled: true,
						// DefaultGateway left empty to trigger auto-detection
						// IngressGatewaySelector left empty to trigger auto-detection
					},
				},
			},
		},
	}

	// Reconcile with tlsSecretName empty to verify SIMPLE mode
	err := r.reconcileHostRouting(ctx, vc, "", "auto.example.com")
	if err != nil {
		t.Fatalf("reconcileHostRouting failed: %v", err)
	}

	// 1. Verify DestinationRule uses SIMPLE mode with sni
	dr := &unstructured.Unstructured{}
	dr.SetGroupVersionKind(destinationRuleGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-auto-guest-gateway", Namespace: "tenant-ns"}, dr); err != nil {
		t.Fatalf("failed getting DestinationRule: %v", err)
	}
	tp := dr.Object["spec"].(map[string]interface{})["trafficPolicy"].(map[string]interface{})
	tlsPolicy := tp["tls"].(map[string]interface{})
	if tlsPolicy["mode"] != "SIMPLE" {
		t.Fatalf("expected tls mode SIMPLE, got %v", tlsPolicy["mode"])
	}
	if tlsPolicy["sni"] != "auto.example.com" {
		t.Fatalf("expected sni auto.example.com, got %v", tlsPolicy["sni"])
	}
	if tlsPolicy["insecureSkipVerify"] != true {
		t.Fatalf("expected insecureSkipVerify true, got %v", tlsPolicy["insecureSkipVerify"])
	}

	// 2. Verify host app VirtualService resolved auto-detected external-gateway
	vsApp := &unstructured.Unstructured{}
	vsApp.SetGroupVersionKind(virtualServiceGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-auto-host-entrypoint", Namespace: "tenant-ns"}, vsApp); err != nil {
		t.Fatalf("failed getting host app VirtualService: %v", err)
	}
	gwList := vsApp.Object["spec"].(map[string]interface{})["gateways"].([]interface{})
	if len(gwList) != 1 || gwList[0] != "istio-ingress/external-gateway" {
		t.Fatalf("expected auto-detected gateway istio-ingress/external-gateway, got %v", gwList)
	}

	// 3. Verify API Gateway resolved auto-detected ingress selector app=istio-ingressgateway
	gwApi := &unstructured.Unstructured{}
	gwApi.SetGroupVersionKind(gatewayGVK)
	if err := fakeHostClient.Get(ctx, types.NamespacedName{Name: "vc-auto-api-gateway", Namespace: "tenant-ns"}, gwApi); err != nil {
		t.Fatalf("failed getting API Gateway: %v", err)
	}
	sel := gwApi.Object["spec"].(map[string]interface{})["selector"].(map[string]interface{})
	if sel["app"] != "istio-ingressgateway" {
		t.Fatalf("expected auto-detected selector app=istio-ingressgateway, got %v", sel)
	}
}

