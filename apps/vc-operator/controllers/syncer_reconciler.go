package controllers

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

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
	"github.com/vops/vc-operator/pkg/registry"
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
	yamlBytes, err := vcluster.GenerateYAMLWithAnnotations(&vc.Spec, vc.Annotations)
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

	// Reconcile Custom CA Secret if custom CA is provided
	customCaCert := vc.Annotations["vops.gitops.io/custom-ca-cert"]
	if customCaCert == "" {
		customCaCert = vc.Annotations["vops.gitops.io/oidc-ca-cert"]
	}
	if customCaCert == "" && vc.Annotations["vops.gitops.io/oidc-config"] != "" {
		var oidcMap map[string]interface{}
		if err := json.Unmarshal([]byte(vc.Annotations["vops.gitops.io/oidc-config"]), &oidcMap); err == nil {
			if caStr, ok := oidcMap["caCertificate"].(string); ok && caStr != "" {
				customCaCert = caStr
			}
		}
	}
	customCaSecret := vc.Annotations["vops.gitops.io/custom-ca-secret"]
	customCaConfigMap := vc.Annotations["vops.gitops.io/custom-ca-configmap"]

	hasCustomCA := false
	var customCaVolumeSource corev1.VolumeSource

	if customCaCert != "" {
		customCaSec := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("vc-custom-ca-%s", vc.Name),
				Namespace: vc.Namespace,
			},
		}
		_, err = controllerutil.CreateOrUpdate(ctx, r.Client, customCaSec, func() error {
			customCaSec.Labels = labels
			customCaSec.Type = corev1.SecretTypeOpaque
			customCaSec.Data = map[string][]byte{
				"ca.crt":        []byte(customCaCert),
				"ca-bundle.crt": []byte(customCaCert),
			}
			return controllerutil.SetControllerReference(vc, customCaSec, r.Scheme())
		})
		if err != nil {
			return false, "", fmt.Errorf("failed reconciling custom-ca secret: %w", err)
		}
		hasCustomCA = true
		customCaVolumeSource = corev1.VolumeSource{
			Secret: &corev1.SecretVolumeSource{
				SecretName: customCaSec.Name,
			},
		}
	} else if customCaSecret != "" {
		hasCustomCA = true
		customCaVolumeSource = corev1.VolumeSource{
			Secret: &corev1.SecretVolumeSource{
				SecretName: customCaSecret,
			},
		}
	} else if customCaConfigMap != "" {
		hasCustomCA = true
		customCaVolumeSource = corev1.VolumeSource{
			ConfigMap: &corev1.ConfigMapVolumeSource{
				LocalObjectReference: corev1.LocalObjectReference{
					Name: customCaConfigMap,
				},
			},
		}
	} else {
		// Clean up any stale custom-ca secret if CA was removed
		staleSec := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("vc-custom-ca-%s", vc.Name),
				Namespace: vc.Namespace,
			},
		}
		_ = r.Delete(ctx, staleSec)
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
				Resources: []string{"configmaps", "secrets", "services", "pods", "pods/attach", "pods/portforward", "pods/exec", "persistentvolumeclaims", "resourcequotas", "limitranges"},
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

	endpoint := fmt.Sprintf("https://%s.%s.svc.%s:443", svc.Name, vc.Namespace, getClusterDomain())
	if customEp, ok := vc.Annotations["vops.gitops.io/custom-endpoint"]; ok && customEp != "" {
		endpoint = customEp
	}

	// Clean up any legacy deployment if transitioning to statefulset
	legacyDep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-vcluster", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, legacyDep)

	isHA := vc.Spec.HighAvailability
	if vc.Spec.SizePreset == v1alpha1.PresetNormal {
		isHA = false
	} else if vc.Spec.SizePreset == v1alpha1.PresetHA {
		isHA = true
	}

	replicas := int32(1)
	if vc.IsSleeping() {
		replicas = 0
	} else if isHA {
		replicas = 3
	} else if preset.SyncerReplicas > 0 {
		replicas = preset.SyncerReplicas
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

	isExternalEtcd := vc.Spec.HighAvailability || preset.EtcdReplicas > 0

	var volumeClaimTemplates []corev1.PersistentVolumeClaim
	if !isExternalEtcd {
		syncerSc := strings.TrimSpace(vc.Spec.StorageClass)
		if syncerSc == "" {
			syncerSc = strings.TrimSpace(vc.Spec.EtcdStorageClass)
		}
		var syncerScPtr *string
		if syncerSc != "" {
			syncerScPtr = &syncerSc
		}

		// Only single-node embedded SQLite mode requires persistent storage on the syncer itself.
		volumeClaimTemplates = []corev1.PersistentVolumeClaim{
			{
				ObjectMeta: metav1.ObjectMeta{
					Name: "data",
				},
				Spec: corev1.PersistentVolumeClaimSpec{
					AccessModes: []corev1.PersistentVolumeAccessMode{
						corev1.ReadWriteOnce,
					},
					StorageClassName: syncerScPtr,
					Resources: corev1.VolumeResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceStorage: storageQuantity,
						},
					},
				},
			},
		}
	}

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      vc.Name,
			Namespace: vc.Namespace,
			Labels:    labels,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:             &replicas,
			ServiceName:          headlessSvc.Name,
			PodManagementPolicy:  appsv1.ParallelPodManagement,
			VolumeClaimTemplates: volumeClaimTemplates,
			Selector: &metav1.LabelSelector{
				MatchLabels: selectorLabels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: selectorLabels,
					Annotations: func() map[string]string {
						hInput := append([]byte{}, yamlBytes...)
						if hasCustomCA {
							hInput = append(hInput, []byte(customCaCert)...)
							hInput = append(hInput, []byte(customCaSecret)...)
							hInput = append(hInput, []byte(customCaConfigMap)...)
						}
						return map[string]string{
							"vops.gitops.io/config-hash": fmt.Sprintf("%x", sha256.Sum256(hInput)),
						}
					}(),
				},
				Spec: corev1.PodSpec{
					ServiceAccountName:            sa.Name,
					TerminationGracePeriodSeconds: func(i int64) *int64 { return &i }(15),
					InitContainers: []corev1.Container{
						{
							Name:            "kubernetes",
							Image:           registry.GetResolver().RewriteImage(fmt.Sprintf("ghcr.io/loft-sh/kubernetes:%s", k8sVersion), vc),
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
							Image:           registry.GetResolver().RewriteImage(fmt.Sprintf("ghcr.io/loft-sh/vcluster-oss:%s", vclusterVer), vc),
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command: []string{
								"/vcluster",
								"start",
							},
							Env: func() []corev1.EnvVar {
								envs := []corev1.EnvVar{
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
								}
								if hasCustomCA {
									envs = append(envs,
										corev1.EnvVar{
											Name:  "SSL_CERT_DIR",
											Value: "/etc/ssl/certs:/etc/ssl/custom-ca",
										},
										corev1.EnvVar{
											Name:  "NODE_EXTRA_CA_CERTS",
											Value: "/etc/ssl/custom-ca/ca.crt",
										},
									)
								}
								return envs
							}(),
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
							VolumeMounts: func() []corev1.VolumeMount {
								vMounts := []corev1.VolumeMount{
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
								}
								if hasCustomCA {
									vMounts = append(vMounts, corev1.VolumeMount{
										Name:      "custom-ca",
										MountPath: "/etc/ssl/custom-ca",
										ReadOnly:  true,
									})
									if customCaCert != "" {
										vMounts = append(vMounts, corev1.VolumeMount{
											Name:      "custom-ca",
											MountPath: "/etc/ssl/certs/custom-ca.crt",
											SubPath:   "ca.crt",
											ReadOnly:  true,
										})
									}
								}
								return vMounts
							}(),
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
					Volumes: func() []corev1.Volume {
						vols := []corev1.Volume{
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
						}
						if isExternalEtcd {
							vols = append(vols, corev1.Volume{
								Name: "data",
								VolumeSource: corev1.VolumeSource{
									EmptyDir: &corev1.EmptyDirVolumeSource{},
								},
							})
						}
						if hasCustomCA {
							vols = append(vols, corev1.Volume{
								Name:         "custom-ca",
								VolumeSource: customCaVolumeSource,
							})
						}
						return vols
					}(),
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

	// VolumeClaimTemplates is immutable on StatefulSets; if template count changed, delete to recreate
	if len(existingSts.Spec.VolumeClaimTemplates) != len(sts.Spec.VolumeClaimTemplates) {
		if err := r.Delete(ctx, existingSts); err != nil && !errors.IsNotFound(err) {
			return false, endpoint, err
		}
		return false, endpoint, nil
	}

	// If using external etcd and syncer StatefulSet no longer has VolumeClaimTemplates,
	// clean up any legacy syncer PVCs (data-<name>-<idx>) so storage isn't leaked
	if isExternalEtcd && len(existingSts.Spec.VolumeClaimTemplates) == 0 {
		for i := int32(0); i < 10; i++ {
			legacyPVC := &corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{
					Name:      fmt.Sprintf("data-%s-%d", sts.Name, i),
					Namespace: vc.Namespace,
				},
			}
			_ = r.Delete(ctx, legacyPVC)
		}
	}

	needsUpdate := false
	if existingSts.Spec.Replicas == nil || *existingSts.Spec.Replicas != replicas {
		existingSts.Spec.Replicas = &replicas
		needsUpdate = true
	}
	if !reflect.DeepEqual(existingSts.Spec.Template.Spec.InitContainers, sts.Spec.Template.Spec.InitContainers) ||
		!reflect.DeepEqual(existingSts.Spec.Template.Spec.Containers, sts.Spec.Template.Spec.Containers) ||
		!reflect.DeepEqual(existingSts.Spec.Template.Spec.Volumes, sts.Spec.Template.Spec.Volumes) ||
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

	if replicas == 0 {
		return false, endpoint, nil
	}

	quorumThreshold := int32(1)
	if replicas > 1 {
		quorumThreshold = (replicas / 2) + 1
	}
	isReady := existingSts.Status.ReadyReplicas >= quorumThreshold
	return isReady, endpoint, nil
}

// CleanupSyncer removes cluster-scoped resources, syncer workloads, tenant resources, services, secrets, and configmaps on deletion
func (r *SyncerReconciler) CleanupSyncer(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	// 1. ClusterRoleBinding
	crbName := fmt.Sprintf("vops-%s-%s-syncer", vc.Namespace, vc.Name)
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: crbName,
		},
	}
	_ = r.Delete(ctx, crb)

	// 2. Syncer StatefulSet & Deployment
	syncerSts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, syncerSts)

	legacyDep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-vcluster", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, legacyDep)

	// 3. Primary and Headless Services
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      vc.Name,
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, svc)

	headlessSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-headless", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, headlessSvc)

	// 4. Node proxy services & synced services
	svcList := &corev1.ServiceList{}
	if err := r.List(ctx, svcList, client.InNamespace(vc.Namespace)); err == nil {
		for _, s := range svcList.Items {
			if s.Labels["vcluster.loft.sh/belongs-to"] == vc.Name ||
				s.Labels["vcluster.loft.sh/managed-by"] == vc.Name ||
				s.Labels["vops.gitops.io/cluster"] == vc.Spec.ClusterName ||
				s.Labels["release"] == vc.Name ||
				strings.HasPrefix(s.Name, fmt.Sprintf("%s-node-", vc.Name)) ||
				strings.HasSuffix(s.Name, fmt.Sprintf("-x-%s", vc.Name)) {
				_ = r.Delete(ctx, &s)
			}
		}
	}

	// 5. ConfigMaps
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-config", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, cm)

	cmList := &corev1.ConfigMapList{}
	if err := r.List(ctx, cmList, client.InNamespace(vc.Namespace)); err == nil {
		for _, c := range cmList.Items {
			if c.Name == "kube-root-ca.crt" {
				continue
			}
			if c.Labels["vcluster.loft.sh/managed-by"] == vc.Name ||
				c.Labels["vops.gitops.io/cluster"] == vc.Spec.ClusterName ||
				c.Labels["release"] == vc.Name ||
				strings.HasSuffix(c.Name, fmt.Sprintf("-x-%s", vc.Name)) {
				_ = r.Delete(ctx, &c)
			}
		}
	}

	// 6. Secrets
	secNames := []string{
		fmt.Sprintf("vc-config-%s", vc.Name),
		fmt.Sprintf("vc-custom-ca-%s", vc.Name),
		fmt.Sprintf("%s-certs", vc.Name),
		fmt.Sprintf("%s-kubeconfig", vc.Name),
		fmt.Sprintf("vc-%s", vc.Name),
		fmt.Sprintf("vc-vc-%s", vc.Name),
	}
	for _, sn := range secNames {
		s := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      sn,
				Namespace: vc.Namespace,
			},
		}
		_ = r.Delete(ctx, s)
	}

	secList := &corev1.SecretList{}
	if err := r.List(ctx, secList, client.InNamespace(vc.Namespace)); err == nil {
		for _, s := range secList.Items {
			if s.Type == corev1.SecretTypeServiceAccountToken && strings.HasPrefix(s.Name, "default-token-") {
				continue
			}
			if s.Labels["vcluster.loft.sh/managed-by"] == vc.Name ||
				s.Labels["vcluster-name"] == vc.Name ||
				s.Labels["vops.gitops.io/cluster"] == vc.Spec.ClusterName ||
				s.Labels["release"] == vc.Name ||
				strings.HasSuffix(s.Name, fmt.Sprintf("-x-%s", vc.Name)) {
				_ = r.Delete(ctx, &s)
			}
		}
	}

	// 7. ServiceAccounts, Roles, RoleBindings
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, sa)

	workloadSa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-workload-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, workloadSa)

	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, role)

	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vc-%s", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, rb)

	// 8. Delete all guest pods synced to host
	podList := &corev1.PodList{}
	if err := r.List(ctx, podList, client.InNamespace(vc.Namespace)); err == nil {
		grace := int64(0)
		delOpts := &client.DeleteOptions{GracePeriodSeconds: &grace}
		for _, p := range podList.Items {
			if p.Labels["vcluster.loft.sh/managed-by"] == vc.Name ||
				p.Labels["vops.gitops.io/cluster"] == vc.Spec.ClusterName ||
				p.Labels["release"] == vc.Name ||
				p.Labels["app.kubernetes.io/instance"] == vc.Name ||
				strings.HasPrefix(p.Name, fmt.Sprintf("%s-", vc.Name)) ||
				strings.HasSuffix(p.Name, fmt.Sprintf("-x-%s", vc.Name)) {
				if len(p.Finalizers) > 0 {
					p.Finalizers = nil
					_ = r.Update(ctx, &p)
				}
				_ = r.Delete(ctx, &p, delOpts)
			}
		}
	}

	// 9. Synced PVCs
	pvcList := &corev1.PersistentVolumeClaimList{}
	if err := r.List(ctx, pvcList, client.InNamespace(vc.Namespace)); err == nil {
		for _, p := range pvcList.Items {
			if p.Labels["vcluster.loft.sh/managed-by"] == vc.Name ||
				strings.HasSuffix(p.Name, fmt.Sprintf("-x-%s", vc.Name)) {
				if len(p.Finalizers) > 0 {
					p.Finalizers = nil
					_ = r.Update(ctx, &p)
				}
				_ = r.Delete(ctx, &p)
			}
		}
	}

	return nil
}
