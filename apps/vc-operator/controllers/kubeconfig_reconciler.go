package controllers

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
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
			rawKubeconfig = strings.ReplaceAll(string(cfg), "https://localhost:8443", endpoint)
		}
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
