package controllers

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestQuotaReconciler_Reconcile(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = v1alpha1.AddToScheme(scheme)
	_ = corev1.AddToScheme(scheme)

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-quota-vc",
			Namespace: "default",
		},
		Spec: v1alpha1.VirtualClusterSpec{
			ClusterName: "test-quota-vc",
			SizePreset:  v1alpha1.PresetLarge,
			Policies: &v1alpha1.PoliciesSpec{
				ResourceQuota: &v1alpha1.ResourceQuotaPolicy{
					Enabled:         true,
					RequestsCPU:     "12",
					RequestsMemory:  "32Gi",
					RequestsStorage: "100Gi",
					LimitsCPU:       "24",
					LimitsMemory:    "64Gi",
					Pods:            "80",
					Services:        "40",
				},
				LimitRange: &v1alpha1.LimitRangePolicy{
					Enabled:           true,
					DefaultCPU:        "2",
					DefaultMemory:     "2Gi",
					DefaultRequestCPU: "200m",
				},
			},
		},
	}

	client := fake.NewClientBuilder().
		WithScheme(scheme).
		WithObjects(vc).
		Build()

	reconciler := NewQuotaReconciler(client)
	err := reconciler.ReconcileQuota(context.Background(), vc)
	if err != nil {
		t.Fatalf("ReconcileQuota failed: %v", err)
	}

	// Verify host ResourceQuota was created
	rq := &corev1.ResourceQuota{}
	err = client.Get(context.Background(), types.NamespacedName{Name: "test-quota-vc-quota", Namespace: "default"}, rq)
	if err != nil {
		t.Fatalf("Host ResourceQuota not found: %v", err)
	}

	cpuReq := rq.Spec.Hard[corev1.ResourceRequestsCPU]
	if cpuReq.String() != "12" {
		t.Errorf("Expected requests.cpu to be 12, got %s", cpuReq.String())
	}
	pods := rq.Spec.Hard[corev1.ResourcePods]
	if pods.String() != "80" {
		t.Errorf("Expected pods to be 80, got %s", pods.String())
	}

	// Verify host LimitRange was created
	lr := &corev1.LimitRange{}
	err = client.Get(context.Background(), types.NamespacedName{Name: "test-quota-vc-limits", Namespace: "default"}, lr)
	if err != nil {
		t.Fatalf("Host LimitRange not found: %v", err)
	}
	if len(lr.Spec.Limits) == 0 {
		t.Fatalf("Expected LimitRange to have at least one limit item")
	}
	defCPU := lr.Spec.Limits[0].Default[corev1.ResourceCPU]
	if defCPU.String() != "2" {
		t.Errorf("Expected default CPU limit to be 2, got %s", defCPU.String())
	}
}
