package controllers

import (
	"context"
	"testing"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestComputeCronSchedule(t *testing.T) {
	tests := []struct {
		schedule   string
		custom     string
		expected   string
	}{
		{"daily", "", "0 2 * * *"},
		{"DAILY", "", "0 2 * * *"},
		{"weekly", "", "0 2 * * 0"},
		{"monthly", "", "0 2 1 * *"},
		{"custom", "0 4 * * *", "0 4 * * *"},
		{"custom", "", "0 2 * * *"},
		{"unknown", "", "0 2 * * *"},
	}

	for _, tt := range tests {
		got := ComputeCronSchedule(tt.schedule, tt.custom)
		if got != tt.expected {
			t.Errorf("ComputeCronSchedule(%q, %q) = %q, want %q", tt.schedule, tt.custom, got, tt.expected)
		}
	}
}

func TestDisasterRecoveryReconciler(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = v1alpha1.AddToScheme(scheme)
	_ = corev1.AddToScheme(scheme)
	_ = batchv1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-dr-cluster",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "test-dr-cluster",
			DisasterRecovery: &v1alpha1.DisasterRecoverySpec{
				Enabled:        true,
				Schedule:       "weekly",
				RetentionCount: 5,
				StorageSize:    "15Gi",
			},
		},
	}

	client := fake.NewClientBuilder().WithScheme(scheme).WithObjects(vc).Build()
	reconciler := NewDisasterRecoveryReconciler(client)

	ctx := context.TODO()
	if err := reconciler.ReconcileDisasterRecovery(ctx, vc); err != nil {
		t.Fatalf("ReconcileDisasterRecovery failed: %v", err)
	}

	// 1. Verify PVC was created
	pvc := &corev1.PersistentVolumeClaim{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-dr-cluster-etcd-backups", Namespace: "default"}, pvc); err != nil {
		t.Errorf("Expected backup PVC to be created: %v", err)
	} else {
		req := pvc.Spec.Resources.Requests[corev1.ResourceStorage]
		if req.String() != "15Gi" {
			t.Errorf("Expected PVC storage request to be 15Gi, got %s", req.String())
		}
	}

	// 2. Verify CronJob was created
	cronJob := &batchv1.CronJob{}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-dr-cluster-etcd-backup", Namespace: "default"}, cronJob); err != nil {
		t.Errorf("Expected backup CronJob to be created: %v", err)
	} else {
		if cronJob.Spec.Schedule != "0 2 * * 0" {
			t.Errorf("Expected schedule 0 2 * * 0, got %s", cronJob.Spec.Schedule)
		}
	}

	// 3. Verify status
	if vc.Status.DisasterRecovery == nil {
		t.Fatalf("Expected DisasterRecovery status to be populated")
	}
	if !vc.Status.DisasterRecovery.Enabled {
		t.Errorf("Expected DisasterRecovery status to be enabled")
	}
	if vc.Status.DisasterRecovery.Schedule != "weekly" {
		t.Errorf("Expected status schedule weekly, got %s", vc.Status.DisasterRecovery.Schedule)
	}

	// 4. Test disabling Disaster Recovery
	vc.Spec.DisasterRecovery.Enabled = false
	if err := reconciler.ReconcileDisasterRecovery(ctx, vc); err != nil {
		t.Fatalf("ReconcileDisasterRecovery failed on disable: %v", err)
	}
	if err := client.Get(ctx, types.NamespacedName{Name: "test-dr-cluster-etcd-backup", Namespace: "default"}, cronJob); err == nil {
		t.Errorf("Expected CronJob to be deleted when disabled")
	}
}
