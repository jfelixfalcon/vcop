package controllers

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestVirtualClusterReconciler_Reconcile(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-vcluster",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       "test-vcluster",
			KubernetesVersion: "v1.31.0",
			VClusterVersion:   "0.37.0",
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
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc).
		WithStatusSubresource(vc).
		Build()

	logger := zap.New(zap.UseDevMode(true))

	reconciler := &VirtualClusterReconciler{
		Client:               client,
		Log:                  logger,
		Scheme:               scheme,
		EtcdReconciler:       NewEtcdReconciler(client),
		SyncerReconciler:     NewSyncerReconciler(client),
		KubeconfigReconciler: NewKubeconfigReconciler(client),
		UpgradeManager:       NewUpgradeManager(client),
	}

	ctx := context.Background()
	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}

	// 1. First reconcile pass: adds finalizer & creates etcd/syncer/configmap/service
	res, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile returned error: %v", err)
	}
	if res.RequeueAfter == 0 && !res.Requeue {
		t.Logf("Reconcile finished step 1")
	}

	// Verify ConfigMap exists
	cm := &corev1.ConfigMap{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster-config", Namespace: "default"}, cm); err != nil {
		t.Errorf("Expected configmap test-vcluster-config to be created: %v", err)
	}

	// Verify Service exists
	svc := &corev1.Service{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster-service", Namespace: "default"}, svc); err != nil {
		t.Errorf("Expected service test-vcluster-service to be created: %v", err)
	}

	// Verify Headless Service exists
	headlessSvc := &corev1.Service{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster-etcd-headless", Namespace: "default"}, headlessSvc); err != nil {
		t.Errorf("Expected headless service test-vcluster-etcd-headless to be created: %v", err)
	}

	// Check finalizer added
	updatedVC := &v1alpha1.VirtualCluster{}
	if err := client.Get(ctx, req.NamespacedName, updatedVC); err != nil {
		t.Fatalf("Failed to get updated VC: %v", err)
	}
	if len(updatedVC.Finalizers) == 0 || updatedVC.Finalizers[0] != VirtualClusterFinalizer {
		t.Errorf("Expected finalizer %s on VirtualCluster, got: %v", VirtualClusterFinalizer, updatedVC.Finalizers)
	}
}
