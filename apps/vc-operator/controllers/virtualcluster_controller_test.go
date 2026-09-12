package controllers

import (
	"context"
	"fmt"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
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

func TestVirtualClusterReconciler_EtcdStorageClass(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-storage-cluster",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:      "test-storage-cluster",
			SizePreset:       v1alpha1.PresetHA,
			HighAvailability: true,
			EtcdStorageClass: "fast-nvme-ssd",
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

	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      "test-storage-cluster",
			Namespace: "default",
		},
	}

	ctx := context.Background()
	// Pass 1: Adds finalizer
	if _, err := reconciler.Reconcile(ctx, req); err != nil {
		t.Fatalf("Reconcile pass 1 failed: %v", err)
	}
	// Pass 2: Creates resources
	if _, err := reconciler.Reconcile(ctx, req); err != nil {
		t.Fatalf("Reconcile pass 2 failed: %v", err)
	}

	etcdSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-storage-cluster-etcd", Namespace: "default"}, etcdSts); err != nil {
		t.Fatalf("Expected etcd StatefulSet to exist: %v", err)
	}

	if len(etcdSts.Spec.VolumeClaimTemplates) == 0 {
		t.Fatalf("Expected VolumeClaimTemplates on etcd StatefulSet")
	}

	pvcSpec := etcdSts.Spec.VolumeClaimTemplates[0].Spec
	if pvcSpec.StorageClassName == nil || *pvcSpec.StorageClassName != "fast-nvme-ssd" {
		t.Errorf("Expected StorageClassName 'fast-nvme-ssd', got: %v", pvcSpec.StorageClassName)
	}
}

func TestVirtualClusterReconciler_FullDeletionCleanup(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	nsName := "tenant-cleanup-test"
	clusterName := "cleanup-cluster"

	now := metav1.Now()
	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:              clusterName,
			Namespace:         nsName,
			Finalizers:        []string{VirtualClusterFinalizer},
			DeletionTimestamp: &now,
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName:       clusterName,
			KubernetesVersion: "v1.31.0",
			VClusterVersion:   "0.36.0",
			SizePreset:        v1alpha1.PresetSmall,
			HighAvailability:  false,
		},
	}

	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: nsName,
		},
	}

	syncedPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("nginx-pod-x-default-x-%s", clusterName),
			Namespace: nsName,
			Labels: map[string]string{
				"vcluster.loft.sh/managed-by": clusterName,
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "nginx", Image: "nginx:alpine"}},
		},
	}

	syncedSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("nginx-svc-x-default-x-%s", clusterName),
			Namespace: nsName,
			Labels: map[string]string{
				"vcluster.loft.sh/managed-by": clusterName,
			},
		},
	}

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("data-%s-0", clusterName),
			Namespace: nsName,
			Labels: map[string]string{
				"vops.gitops.io/cluster": clusterName,
			},
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc, ns, syncedPod, syncedSvc, pvc).
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
			Name:      clusterName,
			Namespace: nsName,
		},
	}

	// Reconcile deletion
	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile deletion failed: %v", err)
	}

	// 1. Verify synced pod was deleted
	checkPod := &corev1.Pod{}
	if err := client.Get(ctx, types.NamespacedName{Name: syncedPod.Name, Namespace: nsName}, checkPod); err == nil {
		t.Errorf("Expected synced pod %s to be deleted, but it still exists", syncedPod.Name)
	}

	// 2. Verify synced service was deleted
	checkSvc := &corev1.Service{}
	if err := client.Get(ctx, types.NamespacedName{Name: syncedSvc.Name, Namespace: nsName}, checkSvc); err == nil {
		t.Errorf("Expected synced service %s to be deleted, but it still exists", syncedSvc.Name)
	}

	// 3. Verify PVC was deleted
	checkPvc := &corev1.PersistentVolumeClaim{}
	if err := client.Get(ctx, types.NamespacedName{Name: pvc.Name, Namespace: nsName}, checkPvc); err == nil {
		t.Errorf("Expected PVC %s to be deleted, but it still exists", pvc.Name)
	}

	// 4. Verify dedicated namespace was deleted
	checkNs := &corev1.Namespace{}
	if err := client.Get(ctx, types.NamespacedName{Name: nsName}, checkNs); err == nil {
		t.Errorf("Expected dedicated namespace %s to be deleted, but it still exists", nsName)
	}
}

func TestVirtualClusterReconciler_NamespacedCluster(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = rbacv1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-namespaced-cluster",
			Namespace: "team-ns",
			Annotations: map[string]string{
				AnnotationOwner:         "dev-lead@company.com",
				AnnotationAllowedEmails: "dev1@company.com,dev2@company.com",
			},
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "test-namespaced-cluster",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
			Namespaces:  []string{"team-ns", "team-ns-db"},
			SizePreset:  v1alpha1.PresetSmall,
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
		RBACReconciler:       NewRBACReconciler(client),
	}

	ctx := context.Background()
	req := ctrl.Request{
		NamespacedName: types.NamespacedName{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}

	// Pass 1: add finalizer
	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile pass 1 failed: %v", err)
	}

	// Pass 2: reconcile namespaced cluster
	_, err = reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile pass 2 failed: %v", err)
	}

	// 1. Verify managed namespaces exist
	for _, nsName := range []string{"team-ns", "team-ns-db"} {
		ns := &corev1.Namespace{}
		if err := client.Get(ctx, types.NamespacedName{Name: nsName}, ns); err != nil {
			t.Errorf("Expected namespace %s to be created: %v", nsName, err)
		}
	}

	// 2. Verify NO syncer or etcd statefulset was created
	syncerSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: vc.Name, Namespace: vc.Namespace}, syncerSts); err == nil {
		t.Errorf("Syncer StatefulSet should NOT be created for namespaced cluster")
	}
	etcdSts := &appsv1.StatefulSet{}
	if err := client.Get(ctx, types.NamespacedName{Name: vc.Name + "-etcd", Namespace: vc.Namespace}, etcdSts); err == nil {
		t.Errorf("etcd StatefulSet should NOT be created for namespaced cluster")
	}

	// 3. Verify ResourceQuota and LimitRange exist in both namespaces
	for _, nsName := range []string{"team-ns", "team-ns-db"} {
		rq := &corev1.ResourceQuota{}
		if err := client.Get(ctx, types.NamespacedName{Name: vc.Name + "-quota", Namespace: nsName}, rq); err != nil {
			t.Errorf("Expected ResourceQuota in namespace %s: %v", nsName, err)
		}
		lr := &corev1.LimitRange{}
		if err := client.Get(ctx, types.NamespacedName{Name: vc.Name + "-limits", Namespace: nsName}, lr); err != nil {
			t.Errorf("Expected LimitRange in namespace %s: %v", nsName, err)
		}
	}

	// 4. Verify ServiceAccount and RoleBinding created
	sa := &corev1.ServiceAccount{}
	if err := client.Get(ctx, types.NamespacedName{Name: vc.Name + "-admin", Namespace: vc.Namespace}, sa); err != nil {
		t.Errorf("Expected admin ServiceAccount to be created: %v", err)
	}

	// 5. Verify Kubeconfig secret was generated
	kubeSec := &corev1.Secret{}
	if err := client.Get(ctx, types.NamespacedName{Name: vc.Name + "-kubeconfig", Namespace: vc.Namespace}, kubeSec); err != nil {
		t.Errorf("Expected kubeconfig secret to be created: %v", err)
	} else if len(kubeSec.Data["config"]) == 0 {
		t.Errorf("Expected kubeconfig data in secret")
	}

	// 6. Verify cluster status
	updatedVC := &v1alpha1.VirtualCluster{}
	if err := client.Get(ctx, req.NamespacedName, updatedVC); err != nil {
		t.Fatalf("Failed to get updated cluster: %v", err)
	}
	if updatedVC.Status.Phase != v1alpha1.PhaseReady {
		t.Errorf("Expected cluster phase Ready, got: %s", updatedVC.Status.Phase)
	}
	if updatedVC.Status.ClusterType != v1alpha1.ClusterTypeNamespaced {
		t.Errorf("Expected cluster type namespaced, got: %s", updatedVC.Status.ClusterType)
	}
}

func TestVirtualClusterReconciler_NamespacedSleepAndWake(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = rbacv1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	two := int32(2)
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-app",
			Namespace: "app-ns",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &two,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "test-app"},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "test-app"},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:latest"},
					},
				},
			},
		},
	}

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:       "sleep-cluster",
			Namespace:  "app-ns",
			Finalizers: []string{VirtualClusterFinalizer},
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "sleep-cluster",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
			Paused:      true,
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc, dep).
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
		RBACReconciler:       NewRBACReconciler(client),
	}

	ctx := context.Background()
	req := ctrl.Request{NamespacedName: types.NamespacedName{Name: vc.Name, Namespace: vc.Namespace}}

	// Reconcile in sleep mode
	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile in sleep failed: %v", err)
	}

	checkDep := &appsv1.Deployment{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-app", Namespace: "app-ns"}, checkDep); err != nil {
		t.Fatalf("Failed to fetch deployment: %v", err)
	}
	if checkDep.Spec.Replicas == nil || *checkDep.Spec.Replicas != 0 {
		t.Errorf("Expected deployment replicas 0 during sleep, got: %v", checkDep.Spec.Replicas)
	}

	// Wake up cluster
	_ = client.Get(ctx, req.NamespacedName, vc)
	vc.Spec.Paused = false
	_ = client.Update(ctx, vc)

	_, err = reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile after wake failed: %v", err)
	}

	if err := client.Get(ctx, types.NamespacedName{Name: "test-app", Namespace: "app-ns"}, checkDep); err != nil {
		t.Fatalf("Failed to fetch deployment after wake: %v", err)
	}
	if checkDep.Spec.Replicas == nil || *checkDep.Spec.Replicas != 2 {
		t.Errorf("Expected deployment replicas restored to 2 after wake, got: %v", checkDep.Spec.Replicas)
	}
}

func TestVirtualClusterReconciler_NamespacedDeletion(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = rbacv1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	now := metav1.Now()
	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "del-namespaced",
			Namespace:         "custom-del-ns",
			Finalizers:        []string{VirtualClusterFinalizer},
			DeletionTimestamp: &now,
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "del-namespaced",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
		},
	}

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "del-namespaced-admin",
			Namespace: "custom-del-ns",
		},
	}
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "del-namespaced-kubeconfig",
			Namespace: "custom-del-ns",
		},
	}
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "custom-del-ns",
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc, sa, sec, ns).
		WithStatusSubresource(vc).
		Build()

	logger := zap.New(zap.UseDevMode(true))
	reconciler := &VirtualClusterReconciler{
		Client:               client,
		Log:                  logger,
		Scheme:               scheme,
		KubeconfigReconciler: NewKubeconfigReconciler(client),
		QuotaReconciler:      NewQuotaReconciler(client),
		RBACReconciler:       NewRBACReconciler(client),
	}

	ctx := context.Background()
	req := ctrl.Request{NamespacedName: types.NamespacedName{Name: vc.Name, Namespace: vc.Namespace}}

	_, err := reconciler.Reconcile(ctx, req)
	if err != nil {
		t.Fatalf("Reconcile deletion failed: %v", err)
	}

	// Verify SA was deleted
	checkSa := &corev1.ServiceAccount{}
	if err := client.Get(ctx, types.NamespacedName{Name: "del-namespaced-admin", Namespace: "custom-del-ns"}, checkSa); err == nil {
		t.Errorf("Expected admin SA to be deleted")
	}

	// Verify Kubeconfig secret was deleted
	checkSec := &corev1.Secret{}
	if err := client.Get(ctx, types.NamespacedName{Name: "del-namespaced-kubeconfig", Namespace: "custom-del-ns"}, checkSec); err == nil {
		t.Errorf("Expected kubeconfig secret to be deleted")
	}

	// Verify finalizer was removed
	checkVC := &v1alpha1.VirtualCluster{}
	if err := client.Get(ctx, req.NamespacedName, checkVC); err == nil {
		if len(checkVC.Finalizers) > 0 {
			t.Errorf("Expected finalizers to be cleared, got: %v", checkVC.Finalizers)
		}
	}
}

func TestNamespacedKubeconfigReconciler_MultiNamespace(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = rbacv1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "multi-kube-test",
			Namespace: "ns-primary",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "multi-kube-test",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
			Namespaces:  []string{"ns-primary", "ns-secondary", "ns-tertiary"},
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc).
		WithStatusSubresource(vc).
		Build()

	rec := NewKubeconfigReconciler(client)
	ctx := context.Background()

	err := rec.ReconcileNamespacedKubeconfig(ctx, vc, "https://10.96.0.1:443")
	if err != nil {
		t.Fatalf("ReconcileNamespacedKubeconfig failed: %v", err)
	}

	// Verify SA created
	sa := &corev1.ServiceAccount{}
	if err := client.Get(ctx, types.NamespacedName{Name: "multi-kube-test-admin", Namespace: "ns-primary"}, sa); err != nil {
		t.Errorf("Admin SA not found: %v", err)
	}

	// Verify RoleBindings created in all 3 namespaces
	for _, ns := range []string{"ns-primary", "ns-secondary", "ns-tertiary"} {
		rb := &rbacv1.RoleBinding{}
		if err := client.Get(ctx, types.NamespacedName{Name: "multi-kube-test-sa-admin-binding", Namespace: ns}, rb); err != nil {
			t.Errorf("RoleBinding not found in namespace %s: %v", ns, err)
		} else {
			if rb.RoleRef.Name != "admin" {
				t.Errorf("RoleBinding in %s does not reference admin ClusterRole", ns)
			}
		}
	}

	// Verify Kubeconfig secret
	sec := &corev1.Secret{}
	if err := client.Get(ctx, types.NamespacedName{Name: "multi-kube-test-kubeconfig", Namespace: "ns-primary"}, sec); err != nil {
		t.Fatalf("Kubeconfig secret not found: %v", err)
	}
	if _, ok := sec.Data["config"]; !ok {
		t.Errorf("Kubeconfig secret missing 'config' data key")
	}
}

func TestNamespacedQuotaReconciler_MultiNamespace(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "multi-quota-test",
			Namespace: "ns-one",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "multi-quota-test",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
			Namespaces:  []string{"ns-one", "ns-two"},
			SizePreset:  v1alpha1.PresetLarge,
			Policies: &v1alpha1.PoliciesSpec{
				ResourceQuota: &v1alpha1.ResourceQuotaPolicy{
					Enabled: true,
					Pods:    "50",
				},
				LimitRange: &v1alpha1.LimitRangePolicy{
					Enabled:           true,
					DefaultRequestCPU: "100m",
				},
			},
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc).
		WithStatusSubresource(vc).
		Build()

	rec := NewQuotaReconciler(client)
	ctx := context.Background()

	err := rec.ReconcileQuota(ctx, vc)
	if err != nil {
		t.Fatalf("QuotaReconciler.ReconcileQuota failed: %v", err)
	}

	// Check ResourceQuota & LimitRange in both namespaces
	for _, ns := range []string{"ns-one", "ns-two"} {
		rq := &corev1.ResourceQuota{}
		if err := client.Get(ctx, types.NamespacedName{Name: "multi-quota-test-quota", Namespace: ns}, rq); err != nil {
			t.Errorf("ResourceQuota not found in namespace %s: %v", ns, err)
		} else {
			if pods, ok := rq.Spec.Hard[corev1.ResourcePods]; !ok || pods.String() != "50" {
				t.Errorf("Expected pods 50 in %s, got %v", ns, pods)
			}
		}

		lr := &corev1.LimitRange{}
		if err := client.Get(ctx, types.NamespacedName{Name: "multi-quota-test-limits", Namespace: ns}, lr); err != nil {
			t.Errorf("LimitRange not found in namespace %s: %v", ns, err)
		}
	}
}

func TestNamespacedRBACReconciler_MultiNamespace(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = rbacv1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "multi-rbac-test",
			Namespace: "ns-a",
			Annotations: map[string]string{
				"vops.gitops.io/owner":          "lead-dev@corp.local",
				"vops.gitops.io/allowed-groups": "backend-team,platform-team",
				"vops.gitops.io/allowed-emails": "qa-lead@corp.local",
			},
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "multi-rbac-test",
			ClusterType: v1alpha1.ClusterTypeNamespaced,
			Namespaces:  []string{"ns-a", "ns-b"},
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc).
		WithStatusSubresource(vc).
		Build()

	rec := NewRBACReconciler(client)
	ctx := context.Background()

	err := rec.ReconcileNamespacedRBAC(ctx, vc)
	if err != nil {
		t.Fatalf("RBACReconciler.ReconcileNamespacedRBAC failed: %v", err)
	}

	// Verify vcop-oidc-admins binding in both namespaces
	for _, ns := range []string{"ns-a", "ns-b"} {
		rb := &rbacv1.RoleBinding{}
		if err := client.Get(ctx, types.NamespacedName{Name: DefaultGuestAdminBindingName, Namespace: ns}, rb); err != nil {
			t.Errorf("RoleBinding %s not found in namespace %s: %v", DefaultGuestAdminBindingName, ns, err)
		} else {
			if rb.RoleRef.Name != "admin" {
				t.Errorf("Expected roleRef admin, got %s", rb.RoleRef.Name)
			}
			if len(rb.Subjects) != 4 { // 1 owner + 2 groups + 1 email
				t.Errorf("Expected 4 subjects in %s, got %d", ns, len(rb.Subjects))
			}
		}
	}
}
