package controllers

import (
	"context"
	"testing"

	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestRBACReconciler_BuildSubjects(t *testing.T) {
	reconciler := NewRBACReconciler(nil)

	t.Run("Extracts owner, allowed emails, and allowed groups", func(t *testing.T) {
		vc := &v1alpha1.VirtualCluster{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-vc",
				Namespace: "default",
				Annotations: map[string]string{
					AnnotationOwner:         "dev@vops.local",
					AnnotationAllowedEmails: "dso@local, alice@company.com, dso@local",
					AnnotationAllowedGroups: "developers, platform-ops, developers",
				},
			},
		}

		subjects := reconciler.BuildSubjects(vc)
		if len(subjects) != 5 {
			t.Fatalf("Expected 5 unique subjects (1 owner, 2 emails, 2 groups), got %d: %+v", len(subjects), subjects)
		}

		// Verify User: dev@vops.local
		foundDev := false
		foundDso := false
		foundAlice := false
		foundDevelopers := false
		foundPlatformOps := false

		for _, s := range subjects {
			if s.Kind == rbacv1.UserKind && s.Name == "dev@vops.local" {
				foundDev = true
			}
			if s.Kind == rbacv1.UserKind && s.Name == "dso@local" {
				foundDso = true
			}
			if s.Kind == rbacv1.UserKind && s.Name == "alice@company.com" {
				foundAlice = true
			}
			if s.Kind == rbacv1.GroupKind && s.Name == "developers" {
				foundDevelopers = true
			}
			if s.Kind == rbacv1.GroupKind && s.Name == "platform-ops" {
				foundPlatformOps = true
			}
		}

		if !foundDev || !foundDso || !foundAlice || !foundDevelopers || !foundPlatformOps {
			t.Errorf("Missing expected subjects: dev=%v, dso=%v, alice=%v, developers=%v, platform-ops=%v", foundDev, foundDso, foundAlice, foundDevelopers, foundPlatformOps)
		}
	})

	t.Run("Ignores dummy Platform User owner", func(t *testing.T) {
		vc := &v1alpha1.VirtualCluster{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-vc",
				Namespace: "default",
				Annotations: map[string]string{
					AnnotationOwner:         "Platform User",
					AnnotationAllowedEmails: "dso@local",
				},
			},
		}

		subjects := reconciler.BuildSubjects(vc)
		if len(subjects) != 1 {
			t.Fatalf("Expected 1 subject, got %d: %+v", len(subjects), subjects)
		}
		if subjects[0].Name != "dso@local" {
			t.Errorf("Expected subject dso@local, got %s", subjects[0].Name)
		}
	})

	t.Run("Handles empty annotations", func(t *testing.T) {
		vc := &v1alpha1.VirtualCluster{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "test-vc",
				Namespace: "default",
			},
		}

		subjects := reconciler.BuildSubjects(vc)
		if len(subjects) != 0 {
			t.Fatalf("Expected 0 subjects, got %d: %+v", len(subjects), subjects)
		}
	})
}

func TestRBACReconciler_ReconcileGuestRBACWithClient(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(scheme)
	_ = rbacv1.AddToScheme(scheme)

	fakeVClient := fake.NewClientBuilder().WithScheme(scheme).Build()
	reconciler := NewRBACReconciler(fakeVClient)
	ctx := context.Background()

	vc := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-cluster",
			Namespace: "default",
			Annotations: map[string]string{
				AnnotationOwner:         "dev@vops.local",
				AnnotationAllowedEmails: "dso@local",
				AnnotationAllowedGroups: "developers",
			},
		},
	}

	// 1. Reconcile creates ClusterRoleBinding
	err := reconciler.ReconcileGuestRBACWithClient(ctx, vc, fakeVClient)
	if err != nil {
		t.Fatalf("ReconcileGuestRBACWithClient failed: %v", err)
	}

	binding := &rbacv1.ClusterRoleBinding{}
	if err := fakeVClient.Get(ctx, types.NamespacedName{Name: DefaultGuestAdminBindingName}, binding); err != nil {
		t.Fatalf("Failed to fetch clusterrolebinding: %v", err)
	}

	if binding.RoleRef.Name != "cluster-admin" {
		t.Errorf("Expected roleRef cluster-admin, got %s", binding.RoleRef.Name)
	}

	if len(binding.Subjects) != 3 {
		t.Fatalf("Expected 3 subjects, got %d", len(binding.Subjects))
	}

	// 2. Remove all annotations -> binding should be deleted
	vc.Annotations = map[string]string{}
	err = reconciler.ReconcileGuestRBACWithClient(ctx, vc, fakeVClient)
	if err != nil {
		t.Fatalf("Reconcile after clearing annotations failed: %v", err)
	}

	err = fakeVClient.Get(ctx, types.NamespacedName{Name: DefaultGuestAdminBindingName}, binding)
	if err == nil {
		t.Errorf("Expected clusterrolebinding to be deleted when subjects are empty, but it still exists")
	}
}
