package controllers

import (
	"context"
	"fmt"
	"reflect"
	"strings"

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
	preset := vcluster.GetPresetConfig(vc.Spec.SizePreset, vc.Spec.CustomResources)
	if preset.EtcdReplicas == 0 && !vc.Spec.HighAvailability {
		// Clean up etcd resources if etcd is disabled
		sts := &appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s-etcd", vc.Name), Namespace: vc.Namespace}}
		_ = r.Delete(ctx, sts)
		svc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s-etcd", vc.Name), Namespace: vc.Namespace}}
		_ = r.Delete(ctx, svc)
		hSvc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("%s-etcd-headless", vc.Name), Namespace: vc.Namespace}}
		_ = r.Delete(ctx, hSvc)
		return true, nil
	}

	isHA := vc.Spec.HighAvailability
	if vc.Spec.SizePreset == v1alpha1.PresetNormal {
		isHA = false
	} else if vc.Spec.SizePreset == v1alpha1.PresetHA {
		isHA = true
	}

	replicas := preset.EtcdReplicas
	if isHA {
		replicas = 3
	} else if replicas == 0 {
		replicas = 1
	}
	if vc.IsSleeping() {
		replicas = 0
	}

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
					Name:       "etcd",
					Port:       2379,
					TargetPort: intstr.FromInt(2379),
					Protocol:   corev1.ProtocolTCP,
				},
				{
					Name:       "peer",
					Port:       2380,
					TargetPort: intstr.FromInt(2380),
					Protocol:   corev1.ProtocolTCP,
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
					Name:       "etcd",
					Port:       2379,
					TargetPort: intstr.FromInt(2379),
					Protocol:   corev1.ProtocolTCP,
				},
				{
					Name:       "peer",
					Port:       2380,
					TargetPort: intstr.FromInt(2380),
					Protocol:   corev1.ProtocolTCP,
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

	clusterMembers := preset.EtcdReplicas
	if isHA {
		clusterMembers = 3
	} else if clusterMembers == 0 {
		clusterMembers = 1
	}
	initialCluster := make([]string, clusterMembers)
	for i := int32(0); i < clusterMembers; i++ {
		memberPod := fmt.Sprintf("%s-etcd-%d", vc.Name, i)
		initialCluster[i] = fmt.Sprintf("%s=https://%s.%s.%s:2380", memberPod, memberPod, headlessSvc.Name, vc.Namespace)
	}
	initialClusterStr := strings.Join(initialCluster, ",")

	etcdVer := vc.Spec.EtcdVersion
	if etcdVer == "" {
		etcdVer = "3.6.8-0"
	}
	etcdImage := fmt.Sprintf("registry.k8s.io/etcd:%s", etcdVer)

	sts := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-etcd", vc.Name),
			Namespace: vc.Namespace,
			Labels:    labels,
		},
		Spec: appsv1.StatefulSetSpec{
			Replicas:            &replicas,
			ServiceName:         headlessSvc.Name,
			PodManagementPolicy: appsv1.ParallelPodManagement,
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
							Name:            "etcd",
							Image:           etcdImage,
							ImagePullPolicy: corev1.PullIfNotPresent,
							Command: []string{
								"etcd",
								"--cert-file=/run/config/pki/etcd-server.crt",
								"--client-cert-auth=true",
								"--data-dir=/var/lib/etcd",
								fmt.Sprintf("--advertise-client-urls=https://$(NAME).%s.%s:2379", headlessSvc.Name, vc.Namespace),
								fmt.Sprintf("--initial-advertise-peer-urls=https://$(NAME).%s.%s:2380", headlessSvc.Name, vc.Namespace),
								fmt.Sprintf("--initial-cluster=%s", initialClusterStr),
								fmt.Sprintf("--initial-cluster-token=%s", vc.Name),
								"--initial-cluster-state=new",
								"--listen-client-urls=https://0.0.0.0:2379",
								"--listen-metrics-urls=http://0.0.0.0:2381",
								"--listen-peer-urls=https://0.0.0.0:2380",
								"--key-file=/run/config/pki/etcd-server.key",
								"--name=$(NAME)",
								"--peer-cert-file=/run/config/pki/etcd-peer.crt",
								"--peer-client-cert-auth=true",
								"--peer-key-file=/run/config/pki/etcd-peer.key",
								"--peer-trusted-ca-file=/run/config/pki/etcd-ca.crt",
								"--snapshot-count=10000",
								"--trusted-ca-file=/run/config/pki/etcd-ca.crt",
							},
							Env: []corev1.EnvVar{
								{
									Name: "NAME",
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
								{Name: "metrics", ContainerPort: 2381},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "data",
									MountPath: "/var/lib/etcd",
								},
								{
									Name:      "certs",
									MountPath: "/run/config/pki",
									ReadOnly:  true,
								},
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/readyz",
										Port:   intstr.FromInt(2381),
										Scheme: corev1.URISchemeHTTP,
									},
								},
								InitialDelaySeconds: 10,
								PeriodSeconds:       10,
								TimeoutSeconds:      15,
								SuccessThreshold:    1,
								FailureThreshold:    8,
							},
							LivenessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/livez",
										Port:   intstr.FromInt(2381),
										Scheme: corev1.URISchemeHTTP,
									},
								},
								InitialDelaySeconds: 10,
								PeriodSeconds:       10,
								TimeoutSeconds:      15,
								SuccessThreshold:    1,
								FailureThreshold:    8,
							},
							StartupProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/readyz",
										Port:   intstr.FromInt(2381),
										Scheme: corev1.URISchemeHTTP,
									},
								},
								InitialDelaySeconds: 10,
								PeriodSeconds:       10,
								TimeoutSeconds:      15,
								SuccessThreshold:    1,
								FailureThreshold:    24,
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "certs",
							VolumeSource: corev1.VolumeSource{
								Secret: &corev1.SecretVolumeSource{
									SecretName: fmt.Sprintf("%s-certs", vc.Name),
								},
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

	// If existing, update mutable fields if changed
	if existingSts.Spec.PodManagementPolicy != appsv1.ParallelPodManagement {
		_ = r.Delete(ctx, existingSts)
		return false, nil
	}
	needsUpdate := false
	if existingSts.Spec.Replicas == nil || *existingSts.Spec.Replicas != replicas {
		existingSts.Spec.Replicas = &replicas
		needsUpdate = true
	}
	if !reflect.DeepEqual(existingSts.Spec.Template.Spec.Containers, sts.Spec.Template.Spec.Containers) ||
		!reflect.DeepEqual(existingSts.Spec.Template.Spec.Volumes, sts.Spec.Template.Spec.Volumes) {
		existingSts.Spec.Template = sts.Spec.Template
		needsUpdate = true
	}
	if needsUpdate {
		if err := r.Update(ctx, existingSts); err != nil && !errors.IsConflict(err) {
			return false, fmt.Errorf("failed updating etcd statefulset: %w", err)
		}
	}

	if replicas == 0 {
		return false, nil
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
