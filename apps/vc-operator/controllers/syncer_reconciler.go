package controllers

import (
	"context"
	"fmt"
	"reflect"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"github.com/vops/vc-operator/pkg/vcluster"
)

type SyncerReconciler struct {
	client.Client
}

func NewSyncerReconciler(c client.Client) *SyncerReconciler {
	return &SyncerReconciler{Client: c}
}

func (r *SyncerReconciler) ReconcileSyncer(ctx context.Context, vc *v1alpha1.VirtualCluster) (bool, string, error) {
	preset := vcluster.GetPresetConfig(vc.Spec.SizePreset, vc.Spec.CustomResources)

	vclusterVer := vc.Spec.VClusterVersion
	if vclusterVer == "" {
		vclusterVer = "0.36.0"
	}

	labels := map[string]string{
		"app":                          "vcluster",
		"release":                      vc.Name,
		"app.kubernetes.io/name":       "vcluster",
		"app.kubernetes.io/instance":   vc.Name,
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Spec.ClusterName,
	}

	// 1. Generate and reconcile ConfigMap and Secret for vcluster.yaml
	yamlBytes, err := vcluster.GenerateYAML(&vc.Spec)
	if err != nil {
		return false, "", fmt.Errorf("failed generating vcluster.yaml: %w", err)
	}

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-config", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, cm, func() error {
		cm.Labels = labels
		cm.Data = map[string]string{
			"vcluster.yaml": string(yamlBytes),
		}
		return controllerutil.SetControllerReference(vc, cm, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling vcluster configmap: %w", err)
	}

	// Reconcile vc-config secret required by vcluster v0.36+
	vcConfigSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-config-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, vcConfigSec, func() error {
		vcConfigSec.Labels = labels
		vcConfigSec.Type = corev1.SecretTypeOpaque
		vcConfigSec.Data = map[string][]byte{
			"config.yaml": yamlBytes,
		}
		return controllerutil.SetControllerReference(vc, vcConfigSec, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling vcluster secret: %w", err)
	}

	// Reconcile ServiceAccount for syncer
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, sa, func() error {
		sa.Labels = labels
		return controllerutil.SetControllerReference(vc, sa, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling vcluster serviceaccount: %w", err)
	}

	// Reconcile ServiceAccount for synced workloads
	workloadSa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-workload-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, workloadSa, func() error {
		workloadSa.Labels = labels
		return controllerutil.SetControllerReference(vc, workloadSa, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling workload serviceaccount: %w", err)
	}

	// Reconcile Role for namespaced workloads
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, role, func() error {
		role.Labels = labels
		role.Rules = []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"configmaps", "secrets", "services", "pods", "pods/attach", "pods/portforward", "pods/exec", "persistentvolumeclaims"},
				Verbs:     []string{"create", "delete", "patch", "update", "get", "list", "watch"},
			},
			{
				APIGroups: []string{""},
				Resources: []string{"pods/status", "pods/ephemeralcontainers", "pods/resize"},
				Verbs:     []string{"patch", "update"},
			},
			{
				APIGroups: []string{"apps"},
				Resources: []string{"statefulsets", "replicasets", "deployments"},
				Verbs:     []string{"get", "list", "watch", "patch", "update"},
			},
			{
				APIGroups: []string{""},
				Resources: []string{"endpoints", "pods/log", "events"},
				Verbs:     []string{"create", "delete", "patch", "update", "get", "list", "watch"},
			},
			{
				APIGroups: []string{"discovery.k8s.io"},
				Resources: []string{"endpointslices"},
				Verbs:     []string{"create", "list", "get", "delete", "patch", "update", "watch"},
			},
		}
		return controllerutil.SetControllerReference(vc, role, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling syncer role: %w", err)
	}

	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, rb, func() error {
		rb.Labels = labels
		rb.RoleRef = rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     role.Name,
		}
		rb.Subjects = []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      sa.Name,
				Namespace: vc.Namespace,
			},
			{
				Kind:      "ServiceAccount",
				Name:      workloadSa.Name,
				Namespace: vc.Namespace,
			},
		}
		return controllerutil.SetControllerReference(vc, rb, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling syncer rolebinding: %w", err)
	}

	// Reconcile ClusterRoleBinding granting syncer permission to sync cluster-wide resources
	crbName := fmt.Sprintf("vops-%s-%s-syncer", vc.Namespace, vc.Name)
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: crbName,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, crb, func() error {
		crb.Labels = labels
		crb.RoleRef = rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "cluster-admin",
		}
		crb.Subjects = []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      sa.Name,
				Namespace: vc.Namespace,
			},
		}
		return nil
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling syncer clusterrolebinding: %w", err)
	}

	// 2. Reconcile Primary Service for API server access (ports 443 & 10250)
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}
	svcLabels := make(map[string]string)
	for k, v := range labels {
		svcLabels[k] = v
	}
	svcLabels["vcluster.loft.sh/service"] = "true"

	selectorLabels := map[string]string{
		"app":     "vcluster",
		"release": vc.Name,
	}

	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, svc, func() error {
		svc.Labels = svcLabels
		svc.Spec = corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: selectorLabels,
			Ports: []corev1.ServicePort{
				{
					Name:       "https",
					Port:       443,
					TargetPort: intstr.FromInt(8443),
					Protocol:   corev1.ProtocolTCP,
				},
				{
					Name:       "kubelet",
					Port:       10250,
					TargetPort: intstr.FromInt(8443),
					Protocol:   corev1.ProtocolTCP,
				},
			},
		}
		return controllerutil.SetControllerReference(vc, svc, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling vcluster service: %w", err)
	}

	headlessSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-headless", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, headlessSvc, func() error {
		headlessSvc.Labels = labels
		headlessSvc.Spec = corev1.ServiceSpec{
			ClusterIP:                corev1.ClusterIPNone,
			PublishNotReadyAddresses: true,
			Selector:                 selectorLabels,
			Ports: []corev1.ServicePort{
				{
					Name:       "https",
					Port:       443,
					TargetPort: intstr.FromInt(8443),
					Protocol:   corev1.ProtocolTCP,
				},
			},
		}
		return controllerutil.SetControllerReference(vc, headlessSvc, r.Scheme())
	})
	if err != nil {
		return false, "", fmt.Errorf("failed reconciling vcluster headless service: %w", err)
	}

	endpoint := fmt.Sprintf("https://%s.%s.svc.cluster.local:443", svc.Name, vc.Namespace)

	// Clean up any legacy deployment if transitioning to statefulset
	legacyDep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-vcluster", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, legacyDep)

	replicas := int32(1)
	if vc.Spec.HighAvailability || (preset.DefaultHA && vc.Spec.SizePreset != v1alpha1.PresetSmall) {
		replicas = preset.SyncerReplicas
		if replicas == 0 {
			replicas = 3
		}
	}

	storageQuantity, err := resource.ParseQuantity(preset.StorageSize)
	if err != nil {
		storageQuantity = resource.MustParse("5Gi")
	}

	cpuReq, _ := resource.ParseQuantity(preset.CPURequest)
	cpuLim, _ := resource.ParseQuantity(preset.CPULimit)
	memReq, _ := resource.ParseQuantity(preset.MemoryRequest)
	memLim, _ := resource.ParseQuantity(preset.MemoryLimit)

	k8sVersion := vc.Spec.KubernetesVersion
	if k8sVersion == "" {
		k8sVersion = "v1.31.0"
	}

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      vc.Name,
			Namespace: vc.Namespace,
			Labels:    labels,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:            &replicas,
			ServiceName:         headlessSvc.Name,
			PodManagementPolicy: appsv1.ParallelPodManagement,
			VolumeClaimTemplates: []corev1.PersistentVolumeClaim{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name: "data",
					},
					Spec: corev1.PersistentVolumeClaimSpec{
						AccessModes: []corev1.PersistentVolumeAccessMode{
							corev1.ReadWriteOnce,
						},
						Resources: corev1.VolumeResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceStorage: storageQuantity,
							},
						},
					},
				},
			},
			Selector: &metav1.LabelSelector{
				MatchLabels: selectorLabels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: selectorLabels,
				},
				Spec: corev1.PodSpec{
					ServiceAccountName:            sa.Name,
					TerminationGracePeriodSeconds: func(i int64) *int64 { return &i }(15),
					InitContainers: []corev1.Container{
						{
							Name:            "kubernetes",
							Image:           fmt.Sprintf("ghcr.io/loft-sh/kubernetes:%s", k8sVersion),
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command:         []string{"cp"},
							Args:            []string{"-r", "/kubernetes/.", "/binaries/"},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "binaries",
									MountPath: "/binaries",
								},
							},
						},
					},
					Containers: []corev1.Container{
						{
							Name:            "syncer",
							Image:           fmt.Sprintf("ghcr.io/loft-sh/vcluster-oss:%s", vclusterVer),
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command: []string{
								"/vcluster",
								"start",
							},
							Env: []corev1.EnvVar{
								{
									Name:  "VCLUSTER_NAME",
									Value: vc.Name,
								},
								{
									Name:  "LOFT_LOG_ENCODING",
									Value: "console",
								},
								{
									Name: "POD_NAME",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{
											FieldPath: "metadata.name",
										},
									},
								},
								{
									Name: "POD_IP",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{
											FieldPath: "status.podIP",
										},
									},
								},
								{
									Name: "NODE_NAME",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{
											FieldPath: "spec.nodeName",
										},
									},
								},
								{
									Name: "NODE_IP",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{
											FieldPath: "status.hostIP",
										},
									},
								},
							},
							Ports: []corev1.ContainerPort{
								{
									Name:          "https",
									ContainerPort: 8443,
									Protocol:      corev1.ProtocolTCP,
								},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    cpuReq,
									corev1.ResourceMemory: memReq,
								},
								Limits: corev1.ResourceList{
									corev1.ResourceCPU:    cpuLim,
									corev1.ResourceMemory: memLim,
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "data",
									MountPath: "/data",
								},
								{
									Name:      "binaries",
									MountPath: "/binaries",
								},
								{
									Name:      "certs",
									MountPath: "/pki",
								},
								{
									Name:      "helm-cache",
									MountPath: "/.cache/helm",
								},
								{
									Name:      "vcluster-config",
									MountPath: "/var/lib/vcluster",
								},
								{
									Name:      "tmp",
									MountPath: "/tmp",
								},
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/readyz",
										Port:   intstr.FromInt(8443),
										Scheme: corev1.URISchemeHTTPS,
									},
								},
								PeriodSeconds:    2,
								TimeoutSeconds:   3,
								FailureThreshold: 60,
							},
							LivenessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/healthz",
										Port:   intstr.FromInt(8443),
										Scheme: corev1.URISchemeHTTPS,
									},
								},
								InitialDelaySeconds: 60,
								PeriodSeconds:       5,
								TimeoutSeconds:      3,
								FailureThreshold:    30,
							},
							StartupProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/readyz",
										Port:   intstr.FromInt(8443),
										Scheme: corev1.URISchemeHTTPS,
									},
								},
								PeriodSeconds:    3,
								TimeoutSeconds:   3,
								FailureThreshold: 100,
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "binaries",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{},
							},
						},
						{
							Name: "certs",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{},
							},
						},
						{
							Name: "helm-cache",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{},
							},
						},
						{
							Name: "vcluster-config",
							VolumeSource: corev1.VolumeSource{
								Secret: &corev1.SecretVolumeSource{
									SecretName: vcConfigSec.Name,
								},
							},
						},
						{
							Name: "tmp",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{},
							},
						},
					},
				},
			},
		},
	}

	existingSts := &appsv1.StatefulSet{}
	err = r.Get(ctx, types.NamespacedName{Name: sts.Name, Namespace: sts.Namespace}, existingSts)
	if errors.IsNotFound(err) {
		if err := controllerutil.SetControllerReference(vc, sts, r.Scheme()); err != nil {
			return false, endpoint, err
		}
		if err := r.Create(ctx, sts); err != nil && !errors.IsAlreadyExists(err) {
			return false, endpoint, fmt.Errorf("failed creating syncer statefulset: %w", err)
		}
		return false, endpoint, nil
	} else if err != nil {
		return false, endpoint, err
	}

	needsUpdate := false
	if existingSts.Spec.Replicas == nil || *existingSts.Spec.Replicas != replicas {
		existingSts.Spec.Replicas = &replicas
		needsUpdate = true
	}
	if !reflect.DeepEqual(existingSts.Spec.Template.Spec.InitContainers, sts.Spec.Template.Spec.InitContainers) ||
		!reflect.DeepEqual(existingSts.Spec.Template.Spec.Containers, sts.Spec.Template.Spec.Containers) ||
		existingSts.Spec.Template.Spec.ServiceAccountName != sts.Spec.Template.Spec.ServiceAccountName {
		existingSts.Spec.Template = sts.Spec.Template
		needsUpdate = true
	}
	if needsUpdate {
		if err := r.Update(ctx, existingSts); err != nil && !errors.IsConflict(err) {
			_ = r.Delete(ctx, existingSts)
			return false, endpoint, nil
		}
	}

	quorumThreshold := int32(1)
	if replicas > 1 {
		quorumThreshold = (replicas / 2) + 1
	}
	isReady := existingSts.Status.ReadyReplicas >= quorumThreshold
	return isReady, endpoint, nil
}

// CleanupSyncer removes cluster-scoped resources like ClusterRoleBinding on deletion
func (r *SyncerReconciler) CleanupSyncer(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	crbName := fmt.Sprintf("vops-%s-%s-syncer", vc.Namespace, vc.Name)
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: crbName,
		},
	}
	if err := r.Delete(ctx, crb); err != nil && !errors.IsNotFound(err) {
		return err
	}
	return nil
}
