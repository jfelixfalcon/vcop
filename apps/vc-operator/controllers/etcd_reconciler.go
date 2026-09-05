package controllers

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
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

type EtcdReconciler struct {
	client.Client
}

func NewEtcdReconciler(c client.Client) *EtcdReconciler {
	return &EtcdReconciler{Client: c}
}

func (r *EtcdReconciler) ReconcileEtcd(ctx context.Context, vc *v1alpha1.VirtualCluster) (bool, error) {
	if !vc.Spec.HighAvailability {
		// Clean up etcd resources if HA is disabled
		sts := &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s-etcd", vc.Name), Namespace: vc.Namespace}}
		_ = r.Delete(ctx, sts)
		svc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s-etcd", vc.Name), Namespace: vc.Namespace}}
		_ = r.Delete(ctx, svc)
		hSvc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s-etcd-headless", vc.Name), Namespace: vc.Namespace}}
		_ = r.Delete(ctx, hSvc)
		return true, nil
	}

	preset := vcluster.GetPresetConfig(vc.Spec.SizePreset, vc.Spec.CustomResources)
	replicas := int32(3)

	labels := map[string]string{
		"app.kubernetes.io/name":       "vcluster-etcd",
		"app.kubernetes.io/instance":   vc.Name,
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Spec.ClusterName,
	}

	// 1. Headless Service for peer communication
	headlessSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-etcd-headless", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, headlessSvc, func() error {
		headlessSvc.Labels = labels
		headlessSvc.Spec = corev1.ServiceSpec{
			ClusterIP:                corev1.ClusterIPNone,
			PublishNotReadyAddresses: true,
			Selector:                 labels,
			Ports: []corev1.ServicePort{
				{
					Name:       "server",
					Port:       2380,
					TargetPort: intstr.FromInt(2380),
				},
				{
					Name:       "client",
					Port:       2379,
					TargetPort: intstr.FromInt(2379),
				},
			},
		}
		return controllerutil.SetControllerReference(vc, headlessSvc, r.Scheme())
	})
	if err != nil {
		return false, fmt.Errorf("failed reconciling etcd headless service: %w", err)
	}

	// 2. Client Service for vCluster syncer
	clientSvc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-etcd", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, clientSvc, func() error {
		clientSvc.Labels = labels
		clientSvc.Spec = corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: labels,
			Ports: []corev1.ServicePort{
				{
					Name:       "client",
					Port:       2379,
					TargetPort: intstr.FromInt(2379),
				},
			},
		}
		return controllerutil.SetControllerReference(vc, clientSvc, r.Scheme())
	})
	if err != nil {
		return false, fmt.Errorf("failed reconciling etcd client service: %w", err)
	}

	// 3. StatefulSet for etcd
	storageQuantity, err := resource.ParseQuantity(preset.StorageSize)
	if err != nil {
		storageQuantity = resource.MustParse("10Gi")
	}

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-etcd", vc.Name),
			Namespace: vc.Namespace,
			Labels:    labels,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:    &replicas,
			ServiceName: headlessSvc.Name,
			Selector: &metav1.LabelSelector{
				MatchLabels: labels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: labels,
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{
							Name:  "etcd",
							Image: "quay.io/coreos/etcd:v3.5.12",
							Command: []string{
								"/usr/local/bin/etcd",
								"--name=$(HOSTNAME)",
								"--data-dir=/var/run/etcd/default.etcd",
								"--listen-client-urls=http://0.0.0.0:2379",
								"--advertise-client-urls=http://$(HOSTNAME)." + headlessSvc.Name + "." + vc.Namespace + ".svc:2379",
								"--listen-peer-urls=http://0.0.0.0:2380",
								"--initial-advertise-peer-urls=http://$(HOSTNAME)." + headlessSvc.Name + "." + vc.Namespace + ".svc:2380",
							},
							Env: []corev1.EnvVar{
								{
									Name: "HOSTNAME",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{
											FieldPath: "metadata.name",
										},
									},
								},
							},
							Ports: []corev1.ContainerPort{
								{Name: "client", ContainerPort: 2379},
								{Name: "peer", ContainerPort: 2380},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "data",
									MountPath: "/var/run/etcd",
								},
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path: "/health",
										Port: intstr.FromInt(2379),
									},
								},
								InitialDelaySeconds: 5,
								PeriodSeconds:       10,
							},
						},
					},
				},
			},
			VolumeClaimTemplates: []corev1.PersistentVolumeClaim{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:   "data",
						Labels: labels,
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
		},
	}

	existingSts := &appsv1.StatefulSet{}
	err = r.Get(ctx, types.NamespacedName{Name: sts.Name, Namespace: sts.Namespace}, existingSts)
	if errors.IsNotFound(err) {
		if err := controllerutil.SetControllerReference(vc, sts, r.Scheme()); err != nil {
			return false, err
		}
		if err := r.Create(ctx, sts); err != nil && !errors.IsAlreadyExists(err) {
			return false, fmt.Errorf("failed creating etcd statefulset: %w", err)
		}
		return false, nil
	} else if err != nil {
		return false, fmt.Errorf("failed fetching etcd statefulset: %w", err)
	}

	// If existing, update mutable replicas if changed
	if *existingSts.Spec.Replicas != replicas {
		existingSts.Spec.Replicas = &replicas
		if err := r.Update(ctx, existingSts); err != nil && !errors.IsConflict(err) {
			return false, fmt.Errorf("failed updating etcd statefulset replicas: %w", err)
		}
	}

	quorumThreshold := (replicas / 2) + 1
	isReady := existingSts.Status.ReadyReplicas >= quorumThreshold
	return isReady, nil
}

// CleanupEtcd deletes etcd resources and PVCs on finalizer deletion
func (r *EtcdReconciler) CleanupEtcd(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-etcd", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	if err := r.Delete(ctx, sts); err != nil && !errors.IsNotFound(err) {
		return err
	}

	pvcList := &corev1.PersistentVolumeClaimList{}
	listOpts := []client.ListOption{
		client.InNamespace(vc.Namespace),
		client.MatchingLabels{"vops.gitops.io/cluster": vc.Spec.ClusterName},
	}
	if err := r.List(ctx, pvcList, listOpts...); err == nil {
		for _, pvc := range pvcList.Items {
			_ = r.Delete(ctx, &pvc)
		}
	}

	return nil
}
