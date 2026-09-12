package controllers

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

type KubeconfigReconciler struct {
	client.Client
}

func NewKubeconfigReconciler(c client.Client) *KubeconfigReconciler {
	return &KubeconfigReconciler{Client: c}
}

func (r *KubeconfigReconciler) ReconcileKubeconfig(ctx context.Context, vc *v1alpha1.VirtualCluster, endpoint string) error {
	secretName := fmt.Sprintf("%s-kubeconfig", vc.Name)

	labels := map[string]string{
		"app.kubernetes.io/name":       "vcluster-kubeconfig",
		"app.kubernetes.io/instance":   vc.Name,
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Spec.ClusterName,
	}

	rawKubeconfig := fmt.Sprintf(`apiVersion: v1
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: %s
  name: %s
contexts:
- context:
    cluster: %s
    user: admin
  name: %s
current-context: %s
kind: Config
preferences: {}
users:
- name: admin
  user:
    token: vcluster-admin-token-%s
`, endpoint, vc.Spec.ClusterName, vc.Spec.ClusterName, vc.Spec.ClusterName, vc.Spec.ClusterName, vc.Name)

	certsSec := &corev1.Secret{}
	certsName := fmt.Sprintf("%s-certs", vc.Name)
	if err := r.Get(ctx, types.NamespacedName{Name: certsName, Namespace: vc.Namespace}, certsSec); err == nil {
		if adminConf, ok := certsSec.Data["admin.conf"]; ok && len(adminConf) > 0 {
			rawKubeconfig = string(adminConf)
		}
	}

	// vCluster v0.36+ automatically generates secret "vc-<clusterName>" with "config" and "certificate-authority"
	vcSec := &corev1.Secret{}
	vcSecName := fmt.Sprintf("vc-%s", vc.Name)
	if err := r.Get(ctx, types.NamespacedName{Name: vcSecName, Namespace: vc.Namespace}, vcSec); err == nil {
		if cfg, ok := vcSec.Data["config"]; ok && len(cfg) > 0 {
			rawKubeconfig = string(cfg)
		}
	}

	// Ensure server endpoint in kubeconfig matches target endpoint
	if rawKubeconfig != "" && endpoint != "" {
		lines := strings.Split(rawKubeconfig, "\n")
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "server:") {
				indent := line[:strings.Index(line, "server:")]
				lines[i] = fmt.Sprintf("%sserver: %s", indent, endpoint)
			}
		}
		rawKubeconfig = strings.Join(lines, "\n")
	}

	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: vc.Namespace,
		},
	}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, sec, func() error {
		sec.Labels = labels
		sec.Type = corev1.SecretTypeOpaque
		if sec.Data == nil {
			sec.Data = make(map[string][]byte)
		}
		// If vcluster syncer has already generated real certificate secrets, we keep or update:
		sec.Data["config"] = []byte(rawKubeconfig)
		sec.Data["server"] = []byte(endpoint)
		sec.Data["cluster-name"] = []byte(vc.Spec.ClusterName)
		return controllerutil.SetControllerReference(vc, sec, r.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed reconciling kubeconfig secret: %w", err)
	}

	vc.Status.KubeconfigSecretRef = &corev1.LocalObjectReference{
		Name: secretName,
	}
	return nil
}

// ReconcileNamespacedKubeconfig creates a scoped ServiceAccount, RoleBinding, and kubeconfig secret for a namespaced cluster
func (r *KubeconfigReconciler) ReconcileNamespacedKubeconfig(ctx context.Context, vc *v1alpha1.VirtualCluster, endpoint string) error {
	secretName := fmt.Sprintf("%s-kubeconfig", vc.Name)
	saName := fmt.Sprintf("%s-admin", vc.Name)
	primaryNs := vc.Namespace
	if primaryNs == "" {
		primaryNs = "default"
	}

	labels := map[string]string{
		"app.kubernetes.io/name":       "namespaced-kubeconfig",
		"app.kubernetes.io/instance":   vc.Name,
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Spec.ClusterName,
	}

	// 1. Ensure ServiceAccount exists in the primary namespace
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      saName,
			Namespace: primaryNs,
		},
	}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, sa, func() error {
		sa.Labels = labels
		return controllerutil.SetControllerReference(vc, sa, r.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed creating admin ServiceAccount: %w", err)
	}

	// 2. Ensure RoleBinding granting 'admin' in each managed namespace
	targetNamespaces := vc.GetNamespaces()
	for _, ns := range targetNamespaces {
		rb := &rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("%s-sa-admin-binding", vc.Name),
				Namespace: ns,
			},
		}
		_, err := controllerutil.CreateOrUpdate(ctx, r.Client, rb, func() error {
			rb.Labels = labels
			rb.RoleRef = rbacv1.RoleRef{
				APIGroup: rbacv1.GroupName,
				Kind:     "ClusterRole",
				Name:     "admin",
			}
			rb.Subjects = []rbacv1.Subject{
				{
					Kind:      rbacv1.ServiceAccountKind,
					Name:      saName,
					Namespace: primaryNs,
				},
			}
			if ns == primaryNs {
				return controllerutil.SetControllerReference(vc, rb, r.Scheme())
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("failed creating RoleBinding in namespace %s: %w", ns, err)
		}
	}

	// 3. Ensure a Secret of type ServiceAccountToken exists so we have a persistent token
	tokenSecName := fmt.Sprintf("%s-admin-token", vc.Name)
	tokenSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      tokenSecName,
			Namespace: primaryNs,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, tokenSec, func() error {
		tokenSec.Labels = labels
		tokenSec.Type = corev1.SecretTypeServiceAccountToken
		if tokenSec.Annotations == nil {
			tokenSec.Annotations = make(map[string]string)
		}
		tokenSec.Annotations[corev1.ServiceAccountNameKey] = saName
		return controllerutil.SetControllerReference(vc, tokenSec, r.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed creating token secret: %w", err)
	}

	// 4. Extract token and CA certificate
	token := string(tokenSec.Data["token"])
	caData := string(tokenSec.Data["ca.crt"])
	if token == "" {
		token = fmt.Sprintf("namespaced-token-%s", vc.Name)
	}

	if endpoint == "" {
		endpoint = "https://kubernetes.default.svc:443"
	}

	// 5. Build Kubeconfig
	caConfig := "    insecure-skip-tls-verify: true\n"
	if caData != "" {
		caConfig = fmt.Sprintf("    certificate-authority-data: %s\n", base64.StdEncoding.EncodeToString([]byte(caData)))
	}

	rawKubeconfig := fmt.Sprintf(`apiVersion: v1
clusters:
- cluster:
%s    server: %s
  name: %s
contexts:
- context:
    cluster: %s
    namespace: %s
    user: %s
  name: %s
current-context: %s
kind: Config
preferences: {}
users:
- name: %s
  user:
    token: %s
`, caConfig, endpoint, vc.Spec.ClusterName, vc.Spec.ClusterName, primaryNs, saName, vc.Spec.ClusterName, vc.Spec.ClusterName, saName, token)

	// 6. Write to Secret <clusterName>-kubeconfig
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      secretName,
			Namespace: primaryNs,
		},
	}

	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, sec, func() error {
		sec.Labels = labels
		sec.Type = corev1.SecretTypeOpaque
		if sec.Data == nil {
			sec.Data = make(map[string][]byte)
		}
		sec.Data["config"] = []byte(rawKubeconfig)
		sec.Data["server"] = []byte(endpoint)
		sec.Data["cluster-name"] = []byte(vc.Spec.ClusterName)
		return controllerutil.SetControllerReference(vc, sec, r.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed reconciling namespaced kubeconfig secret: %w", err)
	}

	vc.Status.KubeconfigSecretRef = &corev1.LocalObjectReference{
		Name: secretName,
	}
	return nil
}
