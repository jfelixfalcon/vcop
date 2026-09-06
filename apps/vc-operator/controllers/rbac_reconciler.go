package controllers

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

const (
	AnnotationOwner         = "vops.gitops.io/owner"
	AnnotationAllowedEmails = "vops.gitops.io/allowed-emails"
	AnnotationAllowedGroups = "vops.gitops.io/allowed-groups"

	DefaultGuestAdminBindingName = "vcop-oidc-admins"
	ClusterAdminRole             = "cluster-admin"
)

type RBACReconciler struct {
	client client.Client
}

func NewRBACReconciler(client client.Client) *RBACReconciler {
	return &RBACReconciler{client: client}
}

// GetVirtualClusterClient builds a controller-runtime client targeting the guest virtual cluster API server
func (r *RBACReconciler) GetVirtualClusterClient(ctx context.Context, vc *v1alpha1.VirtualCluster) (client.Client, error) {
	var cfgBytes []byte

	// 1. Try reading exported kubeconfig secret
	secName := fmt.Sprintf("%s-kubeconfig", vc.Name)
	sec := &corev1.Secret{}
	if err := r.client.Get(ctx, types.NamespacedName{Name: secName, Namespace: vc.Namespace}, sec); err == nil {
		if val, ok := sec.Data["config"]; ok && len(val) > 0 {
			cfgBytes = val
		}
	}

	// 2. Fallback to vCluster internal secret vc-<vc.Name>
	if len(cfgBytes) == 0 {
		vcSecName := fmt.Sprintf("vc-%s", vc.Name)
		vcSec := &corev1.Secret{}
		if err := r.client.Get(ctx, types.NamespacedName{Name: vcSecName, Namespace: vc.Namespace}, vcSec); err == nil {
			if val, ok := vcSec.Data["config"]; ok && len(val) > 0 {
				cfgBytes = val
			}
		}
	}

	if len(cfgBytes) == 0 {
		return nil, fmt.Errorf("kubeconfig not found for virtualcluster %s/%s", vc.Namespace, vc.Name)
	}

	restConfig, err := clientcmd.RESTConfigFromKubeConfig(cfgBytes)
	if err != nil {
		return nil, fmt.Errorf("failed creating RESTConfig: %w", err)
	}

	// Route directly via Kubernetes internal cluster service DNS
	restConfig.Host = fmt.Sprintf("https://%s.%s.svc:443", vc.Name, vc.Namespace)
	restConfig.Insecure = true
	restConfig.CAData = nil
	restConfig.CAFile = ""
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining > 0 {
			restConfig.Timeout = remaining
		} else {
			restConfig.Timeout = 2 * time.Second
		}
	} else {
		restConfig.Timeout = 5 * time.Second
	}

	vScheme := runtime.NewScheme()
	if err := corev1.AddToScheme(vScheme); err != nil {
		return nil, err
	}
	if err := rbacv1.AddToScheme(vScheme); err != nil {
		return nil, err
	}

	return client.New(restConfig, client.Options{Scheme: vScheme})
}

// BuildSubjects parses owner, allowed emails, and allowed groups annotations into rbacv1.Subject items
func (r *RBACReconciler) BuildSubjects(vc *v1alpha1.VirtualCluster) []rbacv1.Subject {
	var subjects []rbacv1.Subject
	seen := make(map[string]bool)

	// 1. Owner
	if vc.Annotations != nil {
		if owner := strings.TrimSpace(vc.Annotations[AnnotationOwner]); owner != "" {
			if !strings.EqualFold(owner, "Platform User") && !strings.EqualFold(owner, "platform-user") {
				key := "User:" + owner
				if !seen[key] {
					seen[key] = true
					subjects = append(subjects, rbacv1.Subject{
						Kind:     rbacv1.UserKind,
						APIGroup: rbacv1.GroupName,
						Name:     owner,
					})
				}
			}
		}

		// 2. Allowed Emails
		if emailsStr := strings.TrimSpace(vc.Annotations[AnnotationAllowedEmails]); emailsStr != "" {
			for _, email := range strings.Split(emailsStr, ",") {
				email = strings.TrimSpace(email)
				if email == "" {
					continue
				}
				key := "User:" + email
				if !seen[key] {
					seen[key] = true
					subjects = append(subjects, rbacv1.Subject{
						Kind:     rbacv1.UserKind,
						APIGroup: rbacv1.GroupName,
						Name:     email,
					})
				}
			}
		}

		// 3. Allowed Groups
		if groupsStr := strings.TrimSpace(vc.Annotations[AnnotationAllowedGroups]); groupsStr != "" {
			for _, group := range strings.Split(groupsStr, ",") {
				group = strings.TrimSpace(group)
				if group == "" {
					continue
				}
				key := "Group:" + group
				if !seen[key] {
					seen[key] = true
					subjects = append(subjects, rbacv1.Subject{
						Kind:     rbacv1.GroupKind,
						APIGroup: rbacv1.GroupName,
						Name:     group,
					})
				}
			}
		}
	}

	return subjects
}

// ReconcileGuestRBAC connects to the guest cluster and reconciles ClusterRoleBindings
func (r *RBACReconciler) ReconcileGuestRBAC(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	vClient, err := r.GetVirtualClusterClient(ctx, vc)
	if err != nil {
		return err
	}
	return r.ReconcileGuestRBACWithClient(ctx, vc, vClient)
}

// ReconcileGuestRBACWithClient reconciles the vcop-oidc-admins ClusterRoleBinding using the provided client
func (r *RBACReconciler) ReconcileGuestRBACWithClient(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client) error {
	subjects := r.BuildSubjects(vc)

	binding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: DefaultGuestAdminBindingName,
		},
	}

	if len(subjects) == 0 {
		// Clean up existing binding if no delegates configured
		err := vClient.Get(ctx, types.NamespacedName{Name: DefaultGuestAdminBindingName}, binding)
		if err == nil {
			if delErr := vClient.Delete(ctx, binding); delErr != nil && !apierrors.IsNotFound(delErr) {
				return delErr
			}
		}
		return nil
	}

	_, err := controllerutil.CreateOrUpdate(ctx, vClient, binding, func() error {
		if binding.Labels == nil {
			binding.Labels = make(map[string]string)
		}
		binding.Labels["app.kubernetes.io/managed-by"] = "vc-operator"
		binding.Labels["vops.gitops.io/cluster"] = vc.Name

		binding.RoleRef = rbacv1.RoleRef{
			APIGroup: rbacv1.GroupName,
			Kind:     "ClusterRole",
			Name:     ClusterAdminRole,
		}
		binding.Subjects = subjects
		return nil
	})

	return err
}
