package controllers

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"github.com/vops/vc-operator/pkg/registry"
)

type AddonsReconciler struct {
	client client.Client
}

func NewAddonsReconciler(client client.Client) *AddonsReconciler {
	return &AddonsReconciler{client: client}
}

func (r *AddonsReconciler) GetVirtualClusterClients(ctx context.Context, vc *v1alpha1.VirtualCluster) (client.Client, dynamic.Interface, error) {
	var cfgBytes []byte

	// 1. Try reading the exported kubeconfig secret
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
		return nil, nil, fmt.Errorf("kubeconfig not found for virtualcluster %s/%s", vc.Namespace, vc.Name)
	}

	restConfig, err := clientcmd.RESTConfigFromKubeConfig(cfgBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("failed creating RESTConfig: %w", err)
	}

	// Route directly via Kubernetes internal cluster service DNS
	clusterDomain := getClusterDomain()
	if os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		restConfig.Host = fmt.Sprintf("https://%s.%s.svc.%s:443", vc.Name, vc.Namespace, clusterDomain)
	} else if len(cfgBytes) > 0 {
		if rawCfg, err := clientcmd.Load(cfgBytes); err == nil {
			for _, c := range rawCfg.Clusters {
				if c.Server != "" {
					restConfig.Host = c.Server
					break
				}
			}
		}
	} else {
		restConfig.Host = fmt.Sprintf("https://%s.%s.svc.%s:443", vc.Name, vc.Namespace, clusterDomain)
	}
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
		restConfig.Timeout = 10 * time.Second
	}

	vScheme := runtime.NewScheme()
	if err := corev1.AddToScheme(vScheme); err != nil {
		return nil, nil, err
	}
	if err := appsv1.AddToScheme(vScheme); err != nil {
		return nil, nil, err
	}
	if err := rbacv1.AddToScheme(vScheme); err != nil {
		return nil, nil, err
	}

	vClient, err := client.New(restConfig, client.Options{Scheme: vScheme})
	if err != nil {
		return nil, nil, fmt.Errorf("failed creating virtual cluster client: %w", err)
	}

	dynClient, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, nil, fmt.Errorf("failed creating dynamic client: %w", err)
	}

	return vClient, dynClient, nil
}

func (r *AddonsReconciler) ReconcileAddons(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	vClient, dynClient, err := r.GetVirtualClusterClients(ctx, vc)
	if err != nil {
		return err
	}

	if vc.Spec.Components.CoreDNS.Enabled {
		if err := r.reconcileCoreDNS(ctx, vc, vClient); err != nil {
			return fmt.Errorf("failed reconciling external CoreDNS: %w", err)
		}
	}

	if vc.Spec.Components.MetricsServer.Enabled {
		if err := r.reconcileMetricsServer(ctx, vc, vClient, dynClient); err != nil {
			return fmt.Errorf("failed reconciling external Metrics-Server: %w", err)
		}
	}

	// 3. Reconcile Pod Readiness Conditions
	// Under vCluster 0.36 syncer on K8s 1.36+ hosts, version skew can leave guest pod
	// conditions (PodReadyToStartContainers / Ready) stuck in False even though containerStatuses are Ready.
	// This ensures virtual Endpoints and APIServices (like metrics.k8s.io) become Ready.
	if err := r.reconcilePodConditions(ctx, vClient); err != nil {
		// Log or silently continue as this is an enhancement loop
	}

	return nil
}

func (r *AddonsReconciler) reconcilePodConditions(ctx context.Context, vClient client.Client) error {
	podList := &corev1.PodList{}
	if err := vClient.List(ctx, podList); err != nil {
		return err
	}

	now := metav1.Now()
	for i := range podList.Items {
		pod := &podList.Items[i]
		if len(pod.Status.ContainerStatuses) == 0 {
			continue
		}

		allReady := true
		for _, cs := range pod.Status.ContainerStatuses {
			if !cs.Ready {
				allReady = false
				break
			}
		}

		if allReady && pod.Status.Phase == corev1.PodRunning {
			needsUpdate := false
			hasReady := false
			hasContainersReady := false
			hasPodReadyToStart := false

			for j := range pod.Status.Conditions {
				cond := &pod.Status.Conditions[j]
				if cond.Type == corev1.PodReady {
					hasReady = true
					if cond.Status != corev1.ConditionTrue {
						cond.Status = corev1.ConditionTrue
						cond.Reason = ""
						cond.Message = ""
						cond.LastTransitionTime = now
						needsUpdate = true
					}
				} else if cond.Type == corev1.ContainersReady {
					hasContainersReady = true
					if cond.Status != corev1.ConditionTrue {
						cond.Status = corev1.ConditionTrue
						cond.Reason = ""
						cond.Message = ""
						cond.LastTransitionTime = now
						needsUpdate = true
					}
				} else if cond.Type == corev1.PodConditionType("PodReadyToStartContainers") {
					hasPodReadyToStart = true
					if cond.Status != corev1.ConditionTrue {
						cond.Status = corev1.ConditionTrue
						cond.Reason = ""
						cond.Message = ""
						cond.LastTransitionTime = now
						needsUpdate = true
					}
				}
			}

			if !hasReady {
				pod.Status.Conditions = append(pod.Status.Conditions, corev1.PodCondition{
					Type:               corev1.PodReady,
					Status:             corev1.ConditionTrue,
					LastTransitionTime: now,
				})
				needsUpdate = true
			}
			if !hasContainersReady {
				pod.Status.Conditions = append(pod.Status.Conditions, corev1.PodCondition{
					Type:               corev1.ContainersReady,
					Status:             corev1.ConditionTrue,
					LastTransitionTime: now,
				})
				needsUpdate = true
			}
			if !hasPodReadyToStart {
				pod.Status.Conditions = append(pod.Status.Conditions, corev1.PodCondition{
					Type:               corev1.PodConditionType("PodReadyToStartContainers"),
					Status:             corev1.ConditionTrue,
					LastTransitionTime: now,
				})
				needsUpdate = true
			}

			if needsUpdate {
				_ = vClient.Status().Update(ctx, pod)
			}
		}
	}
	return nil
}

func (r *AddonsReconciler) reconcileCoreDNS(ctx context.Context, vc *v1alpha1.VirtualCluster, c client.Client) error {
	// 1. ServiceAccount
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "coredns",
			Namespace: "kube-system",
		},
	}
	if err := c.Create(ctx, sa); err != nil && !errors.IsAlreadyExists(err) {
		return err
	}

	// 2. ClusterRole
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name: "system:coredns",
			Labels: map[string]string{
				"kubernetes.io/bootstrapping": "rbac-defaults",
			},
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"endpoints", "services", "pods", "namespaces"},
				Verbs:     []string{"list", "watch"},
			},
			{
				APIGroups: []string{"discovery.k8s.io"},
				Resources: []string{"endpointslices"},
				Verbs:     []string{"list", "watch"},
			},
		},
	}
	existingCR := &rbacv1.ClusterRole{}
	if err := c.Get(ctx, types.NamespacedName{Name: cr.Name}, existingCR); errors.IsNotFound(err) {
		if err := c.Create(ctx, cr); err != nil {
			return err
		}
	} else if err == nil {
		existingCR.Rules = cr.Rules
		if err := c.Update(ctx, existingCR); err != nil && !errors.IsConflict(err) {
			return err
		}
	}

	// 3. ClusterRoleBinding
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: "system:coredns",
			Labels: map[string]string{
				"kubernetes.io/bootstrapping": "rbac-defaults",
			},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "system:coredns",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "coredns",
				Namespace: "kube-system",
			},
		},
	}
	existingCRB := &rbacv1.ClusterRoleBinding{}
	if err := c.Get(ctx, types.NamespacedName{Name: crb.Name}, existingCRB); errors.IsNotFound(err) {
		if err := c.Create(ctx, crb); err != nil {
			return err
		}
	}

	// 4. ConfigMap
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "coredns",
			Namespace: "kube-system",
		},
		Data: map[string]string{
			"Corefile": `.:1053 {
    errors
    health {
       lameduck 5s
    }
    ready
    rewrite name regex (.*)\.nodes\.vcluster\.com kubernetes.default.svc.cluster.local
    kubernetes cluster.local in-addr.arpa ip6.arpa {
       pods insecure
       fallthrough in-addr.arpa ip6.arpa
       ttl 30
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    reload
    loadbalance
}
`,
		},
	}
	existingCM := &corev1.ConfigMap{}
	if err := c.Get(ctx, types.NamespacedName{Name: cm.Name, Namespace: cm.Namespace}, existingCM); errors.IsNotFound(err) {
		if err := c.Create(ctx, cm); err != nil {
			return err
		}
	} else if err == nil {
		if existingCM.Data == nil || existingCM.Data["Corefile"] != cm.Data["Corefile"] {
			existingCM.Data = cm.Data
			if err := c.Update(ctx, existingCM); err != nil && !errors.IsConflict(err) {
				return err
			}
		}
	}

	// 5. Service
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "kube-dns",
			Namespace: "kube-system",
			Labels: map[string]string{
				"k8s-app":                       "kube-dns",
				"kubernetes.io/cluster-service": "true",
				"kubernetes.io/name":            "CoreDNS",
			},
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{
				"k8s-app": "kube-dns",
			},
			ClusterIP: "10.96.0.10",
			Ports: []corev1.ServicePort{
				{
					Name:       "dns",
					Port:       53,
					Protocol:   corev1.ProtocolUDP,
					TargetPort: intstr.FromInt(1053),
				},
				{
					Name:       "dns-tcp",
					Port:       53,
					Protocol:   corev1.ProtocolTCP,
					TargetPort: intstr.FromInt(1053),
				},
				{
					Name:       "metrics",
					Port:       9153,
					Protocol:   corev1.ProtocolTCP,
					TargetPort: intstr.FromInt(9153),
				},
			},
		},
	}
	existingSvc := &corev1.Service{}
	if err := c.Get(ctx, types.NamespacedName{Name: svc.Name, Namespace: svc.Namespace}, existingSvc); errors.IsNotFound(err) {
		if err := c.Create(ctx, svc); err != nil {
			// If 10.96.0.10 cannot be allocated statically, try without static ClusterIP
			svc.Spec.ClusterIP = ""
			if err := c.Create(ctx, svc); err != nil && !errors.IsAlreadyExists(err) {
				return err
			}
		}
	} else if err == nil {
		needsUpdate := false
		if !reflect.DeepEqual(existingSvc.Spec.Selector, svc.Spec.Selector) {
			existingSvc.Spec.Selector = svc.Spec.Selector
			needsUpdate = true
		}
		if !reflect.DeepEqual(existingSvc.Spec.Ports, svc.Spec.Ports) {
			existingSvc.Spec.Ports = svc.Spec.Ports
			needsUpdate = true
		}
		if needsUpdate {
			_ = c.Update(ctx, existingSvc)
		}
	}

	// 6. Deployment
	// CoreDNS: 3 replicas for HA tier, 1 replica for Normal tier
	isHA := vc.Spec.HighAvailability
	if vc.Spec.SizePreset == v1alpha1.PresetNormal {
		isHA = false
	} else if vc.Spec.SizePreset == v1alpha1.PresetHA {
		isHA = true
	}
	replicas := int32(1)
	if isHA {
		replicas = 3
	}

	dnsVer := vc.Spec.Components.CoreDNS.Version
	if dnsVer == "" {
		dnsVer = "v1.11.3"
	}
	dnsImage := registry.GetResolver().RewriteImage(fmt.Sprintf("registry.k8s.io/coredns/coredns:%s", dnsVer), vc)

	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "coredns",
			Namespace: "kube-system",
			Labels: map[string]string{
				"k8s-app": "kube-dns",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"k8s-app": "kube-dns",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"k8s-app": "kube-dns",
					},
				},
				Spec: corev1.PodSpec{
					DNSPolicy:          corev1.DNSDefault,
					ServiceAccountName: "coredns",
					Containers: []corev1.Container{
						{
							Name:            "coredns",
							Image:           dnsImage,
							ImagePullPolicy: corev1.PullIfNotPresent,
							Args:            []string{"-conf", "/etc/coredns/Corefile"},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "config-volume",
									MountPath: "/etc/coredns",
									ReadOnly:  true,
								},
							},
							Ports: []corev1.ContainerPort{
								{
									Name:          "dns",
									ContainerPort: 1053,
									Protocol:      corev1.ProtocolUDP,
								},
								{
									Name:          "dns-tcp",
									ContainerPort: 1053,
									Protocol:      corev1.ProtocolTCP,
								},
								{
									Name:          "metrics",
									ContainerPort: 9153,
									Protocol:      corev1.ProtocolTCP,
								},
							},
							SecurityContext: &corev1.SecurityContext{
								AllowPrivilegeEscalation: ptrBool(false),
								Capabilities: &corev1.Capabilities{
									Add:  []corev1.Capability{"NET_BIND_SERVICE"},
									Drop: []corev1.Capability{"ALL"},
								},
								ReadOnlyRootFilesystem: ptrBool(true),
							},
							LivenessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/health",
										Port:   intstr.FromInt(8080),
										Scheme: corev1.URISchemeHTTP,
									},
								},
								InitialDelaySeconds: 60,
								TimeoutSeconds:      5,
								SuccessThreshold:    1,
								FailureThreshold:    5,
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/ready",
										Port:   intstr.FromInt(8181),
										Scheme: corev1.URISchemeHTTP,
									},
								},
								TimeoutSeconds:   2,
								SuccessThreshold: 1,
								FailureThreshold: 3,
							},
							Resources: corev1.ResourceRequirements{
								Limits: corev1.ResourceList{
									corev1.ResourceMemory: resource.MustParse("256Mi"),
								},
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("100m"),
									corev1.ResourceMemory: resource.MustParse("70Mi"),
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "config-volume",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{
										Name: "coredns",
									},
									Items: []corev1.KeyToPath{
										{
											Key:  "Corefile",
											Path: "Corefile",
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	existingDep := &appsv1.Deployment{}
	if err := c.Get(ctx, types.NamespacedName{Name: dep.Name, Namespace: dep.Namespace}, existingDep); errors.IsNotFound(err) {
		return c.Create(ctx, dep)
	} else if err == nil {
		if existingDep.Spec.Selector != nil && !reflect.DeepEqual(existingDep.Spec.Selector.MatchLabels, dep.Spec.Selector.MatchLabels) {
			if err := c.Delete(ctx, existingDep); err != nil && !errors.IsNotFound(err) {
				return err
			}
			return c.Create(ctx, dep)
		}
		needsUpdate := false
		if existingDep.Spec.Replicas == nil || *existingDep.Spec.Replicas != replicas {
			existingDep.Spec.Replicas = &replicas
			needsUpdate = true
		}
		if existingDep.Spec.Template.Spec.DNSPolicy != dep.Spec.Template.Spec.DNSPolicy ||
			existingDep.Spec.Template.Spec.Containers[0].Image != dep.Spec.Template.Spec.Containers[0].Image ||
			!reflect.DeepEqual(existingDep.Spec.Template.Spec.Containers[0].Resources, dep.Spec.Template.Spec.Containers[0].Resources) ||
			!reflect.DeepEqual(existingDep.Spec.Template.Spec.Containers[0].Ports, dep.Spec.Template.Spec.Containers[0].Ports) ||
			!reflect.DeepEqual(existingDep.Spec.Template.Spec.Containers[0].Args, dep.Spec.Template.Spec.Containers[0].Args) {
			existingDep.Spec.Template = dep.Spec.Template
			needsUpdate = true
		}
		if needsUpdate {
			return c.Update(ctx, existingDep)
		}
	}
	return nil
}

func (r *AddonsReconciler) reconcileMetricsServer(ctx context.Context, vc *v1alpha1.VirtualCluster, c client.Client, dynClient dynamic.Interface) error {
	// 1. ServiceAccount
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "metrics-server",
			Namespace: "kube-system",
			Labels: map[string]string{
				"k8s-app": "metrics-server",
			},
		},
	}
	if err := c.Create(ctx, sa); err != nil && !errors.IsAlreadyExists(err) {
		return err
	}

	// 2. ClusterRole system:aggregated-metrics-reader
	crAgg := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name: "system:aggregated-metrics-reader",
			Labels: map[string]string{
				"rbac.authorization.k8s.io/aggregate-to-admin": "true",
				"rbac.authorization.k8s.io/aggregate-to-edit":  "true",
				"rbac.authorization.k8s.io/aggregate-to-view":  "true",
			},
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{"metrics.k8s.io"},
				Resources: []string{"pods", "nodes"},
				Verbs:     []string{"get", "list", "watch"},
			},
		},
	}
	existingCRAgg := &rbacv1.ClusterRole{}
	if err := c.Get(ctx, types.NamespacedName{Name: crAgg.Name}, existingCRAgg); errors.IsNotFound(err) {
		if err := c.Create(ctx, crAgg); err != nil {
			return err
		}
	}

	// 3. ClusterRole system:metrics-server
	crMS := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:   "system:metrics-server",
			Labels: map[string]string{"k8s-app": "metrics-server"},
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"nodes/metrics"},
				Verbs:     []string{"get"},
			},
			{
				APIGroups: []string{""},
				Resources: []string{"pods", "nodes"},
				Verbs:     []string{"get", "list", "watch"},
			},
		},
	}
	existingCRMS := &rbacv1.ClusterRole{}
	if err := c.Get(ctx, types.NamespacedName{Name: crMS.Name}, existingCRMS); errors.IsNotFound(err) {
		if err := c.Create(ctx, crMS); err != nil {
			return err
		}
	} else if err == nil {
		existingCRMS.Rules = crMS.Rules
		if err := c.Update(ctx, existingCRMS); err != nil && !errors.IsConflict(err) {
			return err
		}
	}

	// 4. ClusterRoleBinding system:metrics-server
	crbMS := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:   "system:metrics-server",
			Labels: map[string]string{"k8s-app": "metrics-server"},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "system:metrics-server",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "metrics-server",
				Namespace: "kube-system",
			},
		},
	}
	existingCRBMS := &rbacv1.ClusterRoleBinding{}
	if err := c.Get(ctx, types.NamespacedName{Name: crbMS.Name}, existingCRBMS); errors.IsNotFound(err) {
		if err := c.Create(ctx, crbMS); err != nil {
			return err
		}
	}

	// 5. ClusterRoleBinding metrics-server:system:auth-delegator
	crbAuth := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:   "metrics-server:system:auth-delegator",
			Labels: map[string]string{"k8s-app": "metrics-server"},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "system:auth-delegator",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "metrics-server",
				Namespace: "kube-system",
			},
		},
	}
	existingCRBAuth := &rbacv1.ClusterRoleBinding{}
	if err := c.Get(ctx, types.NamespacedName{Name: crbAuth.Name}, existingCRBAuth); errors.IsNotFound(err) {
		if err := c.Create(ctx, crbAuth); err != nil {
			return err
		}
	}

	// 6. RoleBinding metrics-server-auth-reader
	rbAuth := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "metrics-server-auth-reader",
			Namespace: "kube-system",
			Labels:    map[string]string{"k8s-app": "metrics-server"},
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     "extension-apiserver-authentication-reader",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "metrics-server",
				Namespace: "kube-system",
			},
		},
	}
	existingRBAuth := &rbacv1.RoleBinding{}
	if err := c.Get(ctx, types.NamespacedName{Name: rbAuth.Name, Namespace: rbAuth.Namespace}, existingRBAuth); errors.IsNotFound(err) {
		if err := c.Create(ctx, rbAuth); err != nil {
			return err
		}
	}

	// 7. Service
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "metrics-server",
			Namespace: "kube-system",
			Labels:    map[string]string{"k8s-app": "metrics-server"},
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{"k8s-app": "metrics-server"},
			Ports: []corev1.ServicePort{
				{
					Name:       "https",
					Port:       443,
					Protocol:   corev1.ProtocolTCP,
					TargetPort: intstr.FromString("https"),
				},
			},
		},
	}
	existingSvc := &corev1.Service{}
	if err := c.Get(ctx, types.NamespacedName{Name: svc.Name, Namespace: svc.Namespace}, existingSvc); errors.IsNotFound(err) {
		if err := c.Create(ctx, svc); err != nil && !errors.IsAlreadyExists(err) {
			return err
		}
	}

	// 8. Deployment
	msVer := vc.Spec.Components.MetricsServer.Version
	if msVer == "" {
		msVer = "v0.7.2"
	}
	msImage := registry.GetResolver().RewriteImage(fmt.Sprintf("registry.k8s.io/metrics-server/metrics-server:%s", msVer), vc)

	replicas := int32(1)
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "metrics-server",
			Namespace: "kube-system",
			Labels:    map[string]string{"k8s-app": "metrics-server"},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"k8s-app": "metrics-server",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"k8s-app": "metrics-server",
					},
				},
				Spec: corev1.PodSpec{
					ServiceAccountName: "metrics-server",
					Containers: []corev1.Container{
						{
							Name:            "metrics-server",
							Image:           msImage,
							ImagePullPolicy: corev1.PullIfNotPresent,
							Args: []string{
								"--cert-dir=/tmp",
								"--secure-port=10250",
								"--kubelet-preferred-address-types=Hostname,InternalIP,ExternalIP",
								"--kubelet-use-node-status-port",
								"--metric-resolution=15s",
								"--kubelet-insecure-tls",
							},
							Ports: []corev1.ContainerPort{
								{
									Name:          "https",
									ContainerPort: 10250,
									Protocol:      corev1.ProtocolTCP,
								},
							},
							LivenessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/livez",
										Port:   intstr.FromString("https"),
										Scheme: corev1.URISchemeHTTPS,
									},
								},
								InitialDelaySeconds: 0,
								PeriodSeconds:       10,
								FailureThreshold:    3,
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path:   "/readyz",
										Port:   intstr.FromString("https"),
										Scheme: corev1.URISchemeHTTPS,
									},
								},
								InitialDelaySeconds: 20,
								PeriodSeconds:       10,
								FailureThreshold:    3,
							},
							SecurityContext: &corev1.SecurityContext{
								AllowPrivilegeEscalation: ptrBool(false),
								ReadOnlyRootFilesystem:   ptrBool(true),
								RunAsNonRoot:             ptrBool(true),
								RunAsUser:                ptrInt64(1000),
								Capabilities: &corev1.Capabilities{
									Drop: []corev1.Capability{"ALL"},
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "tmp-dir",
									MountPath: "/tmp",
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "tmp-dir",
							VolumeSource: corev1.VolumeSource{
								EmptyDir: &corev1.EmptyDirVolumeSource{},
							},
						},
					},
				},
			},
		},
	}

	existingDep := &appsv1.Deployment{}
	if err := c.Get(ctx, types.NamespacedName{Name: dep.Name, Namespace: dep.Namespace}, existingDep); errors.IsNotFound(err) {
		if err := c.Create(ctx, dep); err != nil {
			return err
		}
	} else if err == nil {
		if !reflect.DeepEqual(existingDep.Spec.Template.Spec.Containers[0].Args, dep.Spec.Template.Spec.Containers[0].Args) ||
			existingDep.Spec.Template.Spec.Containers[0].Image != dep.Spec.Template.Spec.Containers[0].Image {
			existingDep.Spec.Template = dep.Spec.Template
			_ = c.Update(ctx, existingDep)
		}
	}

	// 9. APIService v1beta1.metrics.k8s.io via Dynamic client
	gvr := schema.GroupVersionResource{
		Group:    "apiregistration.k8s.io",
		Version:  "v1",
		Resource: "apiservices",
	}
	apiService := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apiregistration.k8s.io/v1",
			"kind":       "APIService",
			"metadata": map[string]interface{}{
				"name": "v1beta1.metrics.k8s.io",
				"labels": map[string]interface{}{
					"k8s-app": "metrics-server",
				},
			},
			"spec": map[string]interface{}{
				"service": map[string]interface{}{
					"name":      "metrics-server",
					"namespace": "kube-system",
					"port":      int64(443),
				},
				"group":                 "metrics.k8s.io",
				"version":               "v1beta1",
				"insecureSkipTLSVerify": true,
				"groupPriorityMinimum":  int64(100),
				"versionPriority":       int64(100),
			},
		},
	}

	_, err := dynClient.Resource(gvr).Get(ctx, "v1beta1.metrics.k8s.io", metav1.GetOptions{})
	if errors.IsNotFound(err) {
		_, err = dynClient.Resource(gvr).Create(ctx, apiService, metav1.CreateOptions{})
		if err != nil && !errors.IsAlreadyExists(err) {
			return err
		}
	}

	return nil
}

func ptrBool(b bool) *bool {
	return &b
}

func ptrInt64(i int64) *int64 {
	return &i
}
