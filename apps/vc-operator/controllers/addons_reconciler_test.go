package controllers

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestAddonsReconciler_CoreDNS_HA(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-ha",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: true,
			Components: v1alpha1.ComponentsSpec{
				CoreDNS:       v1alpha1.CoreDNSComponent{Enabled: true},
				MetricsServer: v1alpha1.MetricsServerComponent{Enabled: true},
			},
		},
	}

	fakeVClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	reconciler := NewAddonsReconciler(fakeVClient)

	ctx := context.Background()
	if err := reconciler.reconcileCoreDNS(ctx, vc, fakeVClient); err != nil {
		t.Fatalf("reconcileCoreDNS failed: %v", err)
	}

	// Verify CoreDNS Deployment has 3 replicas for HA
	dep := &appsv1.Deployment{}
	if err := fakeVClient.Get(ctx, types.NamespacedName{Name: "coredns", Namespace: "kube-system"}, dep); err != nil {
		t.Fatalf("Failed to fetch coredns deployment: %v", err)
	}
	if dep.Spec.Replicas == nil || *dep.Spec.Replicas != 3 {
		t.Errorf("Expected 3 replicas for HA CoreDNS, got %v", dep.Spec.Replicas)
	}

	// Verify Service kube-dns
	svc := &corev1.Service{}
	if err := fakeVClient.Get(ctx, types.NamespacedName{Name: "kube-dns", Namespace: "kube-system"}, svc); err != nil {
		t.Fatalf("Failed to fetch kube-dns service: %v", err)
	}
	if svc.Spec.ClusterIP != "10.96.0.10" {
		t.Errorf("Expected ClusterIP 10.96.0.10, got %s", svc.Spec.ClusterIP)
	}

	// Verify ConfigMap coredns
	cm := &corev1.ConfigMap{}
	if err := fakeVClient.Get(ctx, types.NamespacedName{Name: "coredns", Namespace: "kube-system"}, cm); err != nil {
		t.Fatalf("Failed to fetch coredns configmap: %v", err)
	}
	if _, ok := cm.Data["Corefile"]; !ok {
		t.Errorf("Expected Corefile in ConfigMap")
	}

	// Verify RBAC
	cr := &rbacv1.ClusterRole{}
	if err := fakeVClient.Get(ctx, types.NamespacedName{Name: "system:coredns"}, cr); err != nil {
		t.Fatalf("Failed to fetch system:coredns ClusterRole: %v", err)
	}
}

func TestAddonsReconciler_CoreDNS_NonHA(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-nonha",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			HighAvailability: false,
			Components: v1alpha1.ComponentsSpec{
				CoreDNS: v1alpha1.CoreDNSComponent{Enabled: true},
			},
		},
	}

	fakeVClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	reconciler := NewAddonsReconciler(fakeVClient)

	ctx := context.Background()
	if err := reconciler.reconcileCoreDNS(ctx, vc, fakeVClient); err != nil {
		t.Fatalf("reconcileCoreDNS failed: %v", err)
	}

	// Verify CoreDNS Deployment has 1 replica for Non-HA
	dep := &appsv1.Deployment{}
	if err := fakeVClient.Get(ctx, types.NamespacedName{Name: "coredns", Namespace: "kube-system"}, dep); err != nil {
		t.Fatalf("Failed to fetch coredns deployment: %v", err)
	}
	if dep.Spec.Replicas == nil || *dep.Spec.Replicas != 1 {
		t.Errorf("Expected 1 replica for Non-HA CoreDNS, got %v", dep.Spec.Replicas)
	}
}
