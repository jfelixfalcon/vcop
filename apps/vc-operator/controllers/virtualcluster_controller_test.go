package controllers

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
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
			VClusterVersion:   "0.36.0",
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
		AddonsReconciler:     NewAddonsReconciler(client),
		UpgradeManager:       NewUpgradeManager(client),
	}

	ctx := context.Background()
	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}

	// 1. First reconcile pass: adds finalizer
	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile pass 1 returned error: %v", err)
	}

	// 2. Second reconcile pass: creates resources
	res, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile pass 2 returned error: %v", err)
	}
	if res.RequeueAfter == 0 && !res.Requeue {
		t.Logf("Reconcile finished step 2")
	}

	// Verify ConfigMap exists
	cm := &corev1.ConfigMap{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster-config", Namespace: "default"}, cm); err != nil {
		t.Errorf("Expected configmap test-vcluster-config to be created: %v", err)
	}

	// Verify Service exists
	svc := &corev1.Service{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster", Namespace: "default"}, svc); err != nil {
		t.Errorf("Expected service test-vcluster to be created: %v", err)
	}

	// Verify Headless Service exists
	headlessSvc := &corev1.Service{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster-etcd-headless", Namespace: "default"}, headlessSvc); err != nil {
		t.Errorf("Expected headless service test-vcluster-etcd-headless to be created: %v", err)
	}

	// Verify Syncer StatefulSet exists with 3 replicas
	syncerSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster", Namespace: "default"}, syncerSts); err != nil {
		t.Errorf("Expected syncer StatefulSet test-vcluster to be created: %v", err)
	} else if syncerSts.Spec.Replicas == nil || *syncerSts.Spec.Replicas != 3 {
		t.Errorf("Expected syncer StatefulSet to have 3 replicas, got: %v", syncerSts.Spec.Replicas)
	}

	// Verify etcd StatefulSet exists with 3 replicas
	etcdSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-vcluster-etcd", Namespace: "default"}, etcdSts); err != nil {
		t.Errorf("Expected etcd StatefulSet test-vcluster-etcd to be created: %v", err)
	} else if etcdSts.Spec.Replicas == nil || *etcdSts.Spec.Replicas != 3 {
		t.Errorf("Expected etcd StatefulSet to have 3 replicas, got: %v", etcdSts.Spec.Replicas)
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

func TestVirtualClusterReconciler_NonHA(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-dev-small",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       "test-dev-small",
			KubernetesVersion: "v1.31.0",
			VClusterVersion:   "0.36.0",
			SizePreset:        v1alpha1.PresetSmall,
			HighAvailability:  false,
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
		AddonsReconciler:     NewAddonsReconciler(client),
		UpgradeManager:       NewUpgradeManager(client),
	}

	ctx := context.Background()
	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}

	// Step 1: Add finalizer
	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile pass 1 error: %v", err)
	}

	// Step 2: Create resources
	_, err = reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile pass 2 error: %v", err)
	}

	// Verify Syncer StatefulSet has 1 replica
	syncerSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-dev-small", Namespace: "default"}, syncerSts); err != nil {
		t.Fatalf("Failed to fetch syncer sts: %v", err)
	}
	if syncerSts.Spec.Replicas == nil || *syncerSts.Spec.Replicas != 1 {
		t.Errorf("Expected 1 replica for non-HA, got %v", syncerSts.Spec.Replicas)
	}

	// Verify etcd StatefulSet does not exist
	etcdSts := &appsv1.StatefulSet{}
	err = client.Get(ctx, types.NamespacedName{Name: "test-dev-small-etcd", Namespace: "default"}, etcdSts)
	if err == nil {
		t.Errorf("Expected no etcd sts for non-HA, but found one")
	}
}

func TestVirtualClusterReconciler_SleepAndWake(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-sleep-cluster",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       "test-sleep-cluster",
			KubernetesVersion: "v1.31.0",
			VClusterVersion:   "0.36.0",
			SizePreset:        v1alpha1.PresetMedium,
			HighAvailability:  true,
			Paused:            false,
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
		AddonsReconciler:     NewAddonsReconciler(client),
		UpgradeManager:       NewUpgradeManager(client),
		QuotaReconciler:      NewQuotaReconciler(client),
	}

	ctx := context.Background()
	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}

	// 1. Initial creation
	_, _ = reconciler.Reconcile(ctx, req)
	_, _ = reconciler.Reconcile(ctx, req)

	// Verify syncer replicas is 3
	syncerSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-sleep-cluster", Namespace: "default"}, syncerSts); err != nil {
		t.Fatalf("Failed to fetch syncer sts: %v", err)
	}
	if syncerSts.Spec.Replicas == nil || *syncerSts.Spec.Replicas != 3 {
		t.Fatalf("Expected 3 replicas initially for HA syncer, got %v", syncerSts.Spec.Replicas)
	}

	// Verify etcd replicas is 3
	etcdSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-sleep-cluster-etcd", Namespace: "default"}, etcdSts); err != nil {
		t.Fatalf("Failed to fetch etcd sts: %v", err)
	}
	if etcdSts.Spec.Replicas == nil || *etcdSts.Spec.Replicas != 3 {
		t.Fatalf("Expected 3 replicas initially for HA etcd, got %v", etcdSts.Spec.Replicas)
	}

	// Add a synced host pod to verify it gets cleaned up during sleep
	syncedPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "nginx-test-pod",
			Namespace: "default",
			Labels: map[string]string{
				"vcluster.loft.sh/managed-by": vc.Name,
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "nginx", Image: "nginx:alpine"},
			},
		},
	}
	if err := client.Create(ctx, syncedPod); err != nil {
		t.Fatalf("Failed creating test synced pod: %v", err)
	}

	// 2. Put to Sleep
	_ = client.Get(ctx, req.NamespacedName, vc)
	vc.Spec.Paused = true
	_ = client.Update(ctx, vc)

	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile while sleeping failed: %v", err)
	}

	// Verify syncer StatefulSet scaled to 0
	if err := client.Get(ctx, types.NamespacedName{Name: "test-sleep-cluster", Namespace: "default"}, syncerSts); err != nil {
		t.Fatalf("Failed to fetch syncer sts after sleep: %v", err)
	}
	if syncerSts.Spec.Replicas == nil || *syncerSts.Spec.Replicas != 0 {
		t.Fatalf("Expected 0 replicas when sleeping for syncer, got %v", syncerSts.Spec.Replicas)
	}

	// Verify etcd StatefulSet scaled to 0
	if err := client.Get(ctx, types.NamespacedName{Name: "test-sleep-cluster-etcd", Namespace: "default"}, etcdSts); err != nil {
		t.Fatalf("Failed to fetch etcd sts after sleep: %v", err)
	}
	if etcdSts.Spec.Replicas == nil || *etcdSts.Spec.Replicas != 0 {
		t.Fatalf("Expected 0 replicas when sleeping for etcd, got %v", etcdSts.Spec.Replicas)
	}

	// Verify synced host pod was deleted
	err = client.Get(ctx, types.NamespacedName{Name: "nginx-test-pod", Namespace: "default"}, syncedPod)
	if err == nil {
		t.Errorf("Expected synced pod to be deleted during sleep, but it was found")
	}

	// Verify status phase is Sleeping
	_ = client.Get(ctx, req.NamespacedName, vc)
	if vc.Status.Phase != v1alpha1.PhaseSleeping {
		t.Errorf("Expected PhaseSleeping, got %v", vc.Status.Phase)
	}

	// 3. Wake Up
	vc.Spec.Paused = false
	_ = client.Update(ctx, vc)

	_, err = reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile while waking up failed: %v", err)
	}

	// Verify etcd StatefulSet scaled back to 3
	if err := client.Get(ctx, types.NamespacedName{Name: "test-sleep-cluster-etcd", Namespace: "default"}, etcdSts); err != nil {
		t.Fatalf("Failed to fetch etcd sts after wake: %v", err)
	}
	if etcdSts.Spec.Replicas == nil || *etcdSts.Spec.Replicas != 3 {
		t.Errorf("Expected 3 replicas for etcd after waking up, got %v", etcdSts.Spec.Replicas)
	}

	// Simulate etcd ready replicas for syncer rollout in fake client
	etcdSts.Status.ReadyReplicas = 3
	_ = client.Status().Update(ctx, etcdSts)

	_, err = reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile after etcd ready failed: %v", err)
	}

	// Verify syncer StatefulSet scaled back to 3
	if err := client.Get(ctx, types.NamespacedName{Name: "test-sleep-cluster", Namespace: "default"}, syncerSts); err != nil {
		t.Fatalf("Failed to fetch syncer sts after wake: %v", err)
	}
	if syncerSts.Spec.Replicas == nil || *syncerSts.Spec.Replicas != 3 {
		t.Errorf("Expected 3 replicas for syncer after waking up, got %v", syncerSts.Spec.Replicas)
	}
}

func TestVirtualClusterReconciler_CustomCA(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-ca-cluster",
			Namespace: "default",
			Annotations: map[string]string{
				"vops.gitops.io/custom-ca-cert": "-----BEGIN CERTIFICATE-----\nMIIB_TEST_CA_DATA\n-----END CERTIFICATE-----",
			},
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       "test-ca-cluster",
			KubernetesVersion: "v1.31.0",
			VClusterVersion:   "0.36.0",
			SizePreset:        v1alpha1.PresetSmall,
			HighAvailability:  false,
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
		AddonsReconciler:     NewAddonsReconciler(client),
		UpgradeManager:       NewUpgradeManager(client),
	}

	ctx := context.Background()
	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}

	// 1. First pass adds finalizer
	_, _ = reconciler.Reconcile(ctx, req)
	// 2. Second pass creates resources
	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile returned error: %v", err)
	}

	// Verify custom CA Secret was created
	sec := &corev1.Secret{}
	if err := client.Get(ctx, types.NamespacedName{Name: "vc-custom-ca-test-ca-cluster", Namespace: "default"}, sec); err != nil {
		t.Fatalf("Expected Secret vc-custom-ca-test-ca-cluster to exist: %v", err)
	}
	if string(sec.Data["ca.crt"]) != "-----BEGIN CERTIFICATE-----\nMIIB_TEST_CA_DATA\n-----END CERTIFICATE-----" {
		t.Errorf("Unexpected ca.crt content: %s", string(sec.Data["ca.crt"]))
	}

	// Verify StatefulSet mounts custom CA
	sts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-ca-cluster", Namespace: "default"}, sts); err != nil {
		t.Fatalf("Expected StatefulSet test-ca-cluster to exist: %v", err)
	}

	hasCAVolume := false
	for _, v := range sts.Spec.Template.Spec.Volumes {
		if v.Name == "custom-ca" && v.Secret != nil && v.Secret.SecretName == "vc-custom-ca-test-ca-cluster" {
			hasCAVolume = true
			break
		}
	}
	if !hasCAVolume {
		t.Errorf("Expected custom-ca volume in StatefulSet volumes")
	}

	syncerContainer := sts.Spec.Template.Spec.Containers[0]
	hasCAMount := false
	for _, m := range syncerContainer.VolumeMounts {
		if m.Name == "custom-ca" && m.MountPath == "/etc/ssl/custom-ca" {
			hasCAMount = true
			break
		}
	}
	if !hasCAMount {
		t.Errorf("Expected /etc/ssl/custom-ca volume mount in syncer container")
	}

	hasSSLDirEnv := false
	for _, e := range syncerContainer.Env {
		if e.Name == "SSL_CERT_DIR" && e.Value == "/etc/ssl/certs:/etc/ssl/custom-ca" {
			hasSSLDirEnv = true
			break
		}
	}
	if !hasSSLDirEnv {
		t.Errorf("Expected SSL_CERT_DIR env var in syncer container")
	}
}
