package controllers

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
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
		vclusterVer = "0.37.0"
	}

	labels := map[string]string{
		"app.kubernetes.io/name":       "vcluster",
		"app.kubernetes.io/instance":   vc.Name,
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Spec.ClusterName,
	}

	// 1. Generate and reconcile ConfigMap for vcluster.yaml
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

	// 2. Reconcile Service for API server access
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-service", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, svc, func() error {
		svc.Labels = labels
		svc.Spec = corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: labels,
			Ports: []corev1.ServicePort{
				{
					Name:       "https",
					Port:       443,
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

	endpoint := fmt.Sprintf("https://%s.%s.svc.cluster.local:443", svc.Name, vc.Namespace)

	// 3. Reconcile Deployment for vCluster syncer
	replicas := int32(1)
	if vc.Spec.HighAvailability {
		replicas = 2
	}

	cpuReq, _ := resource.ParseQuantity(preset.CPURequest)
	cpuLim, _ := resource.ParseQuantity(preset.CPULimit)
	memReq, _ := resource.ParseQuantity(preset.MemoryRequest)
	memLim, _ := resource.ParseQuantity(preset.MemoryLimit)

	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-vcluster", vc.Name),
			Namespace: vc.Namespace,
		},
	}

	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, dep, func() error {
		dep.Labels = labels
		dep.Spec.Replicas = &replicas
		dep.Spec.Selector = &metav1.LabelSelector{
			MatchLabels: labels,
		}
		dep.Spec.Template = corev1.PodTemplateSpec{
			ObjectMeta: metav1.ObjectMeta{
				Labels: labels,
			},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name:  "syncer",
						Image: fmt.Sprintf("loftsh/vcluster:%s", vclusterVer),
						Args: []string{
							"start",
							"--config=/etc/vcluster/vcluster.yaml",
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
								Name:      "config",
								MountPath: "/etc/vcluster",
								ReadOnly:  true,
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
							InitialDelaySeconds: 5,
							PeriodSeconds:       10,
						},
						LivenessProbe: &corev1.Probe{
							ProbeHandler: corev1.ProbeHandler{
								HTTPGet: &corev1.HTTPGetAction{
									Path:   "/livez",
									Port:   intstr.FromInt(8443),
									Scheme: corev1.URISchemeHTTPS,
								},
							},
							InitialDelaySeconds: 15,
							PeriodSeconds:       20,
						},
					},
				},
				Volumes: []corev1.Volume{
					{
						Name: "config",
						VolumeSource: corev1.VolumeSource{
							ConfigMap: &corev1.ConfigMapVolumeSource{
								LocalObjectReference: corev1.LocalObjectReference{
									Name: cm.Name,
								},
							},
						},
					},
				},
			},
		}
		return controllerutil.SetControllerReference(vc, dep, r.Scheme())
	})
	if err != nil {
		return false, endpoint, fmt.Errorf("failed reconciling syncer deployment: %w", err)
	}

	actualDep := &appsv1.Deployment{}
	if err := r.Get(ctx, types.NamespacedName{Name: dep.Name, Namespace: dep.Namespace}, actualDep); err != nil {
		return false, endpoint, err
	}

	isReady := actualDep.Status.ReadyReplicas > 0
	return isReady, endpoint, nil
}
