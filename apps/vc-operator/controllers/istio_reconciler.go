package controllers

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/dynamic"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"github.com/vops/vc-operator/pkg/registry"
)

var (
	clusterIssuerGVK = schema.GroupVersionKind{
		Group:   "cert-manager.io",
		Version: "v1",
		Kind:    "ClusterIssuer",
	}
	issuerGVK = schema.GroupVersionKind{
		Group:   "cert-manager.io",
		Version: "v1",
		Kind:    "Issuer",
	}
	certificateGVK = schema.GroupVersionKind{
		Group:   "cert-manager.io",
		Version: "v1",
		Kind:    "Certificate",
	}
	gatewayGVR = schema.GroupVersionResource{
		Group:    "networking.istio.io",
		Version:  "v1beta1",
		Resource: "gateways",
	}
	virtualServiceGVR = schema.GroupVersionResource{
		Group:    "networking.istio.io",
		Version:  "v1beta1",
		Resource: "virtualservices",
	}
	crdGVR = schema.GroupVersionResource{
		Group:    "apiextensions.k8s.io",
		Version:  "v1",
		Resource: "customresourcedefinitions",
	}
)

type IstioReconciler struct {
	hostClient client.Client
	addonsRec  *AddonsReconciler
}

func NewIstioReconciler(hostClient client.Client, addonsRec *AddonsReconciler) *IstioReconciler {
	return &IstioReconciler{
		hostClient: hostClient,
		addonsRec:  addonsRec,
	}
}

// ExtractClusterHost resolves the primary FQDN / host to use for the ingress entrypoint
func (r *IstioReconciler) ExtractClusterHost(vc *v1alpha1.VirtualCluster) string {
	if vc.Spec.Components.Istio != nil && len(vc.Spec.Components.Istio.Hosts) > 0 && vc.Spec.Components.Istio.Hosts[0] != "" {
		return vc.Spec.Components.Istio.Hosts[0]
	}

	if customEp, ok := vc.Annotations["vops.gitops.io/custom-endpoint"]; ok && customEp != "" {
		host := customEp
		if u, err := url.Parse(customEp); err == nil && u.Hostname() != "" {
			return u.Hostname()
		}
		host = strings.TrimPrefix(host, "https://")
		host = strings.TrimPrefix(host, "http://")
		if idx := strings.Index(host, ":"); idx != -1 {
			host = host[:idx]
		}
		if idx := strings.Index(host, "/"); idx != -1 {
			host = host[:idx]
		}
		if host != "" {
			return host
		}
	}

	return fmt.Sprintf("%s.local", vc.Name)
}

// ValidateCertManagerIssuer checks if the configured issuer exists on the host cluster.
// If it does not exist, it aborts by returning an error.
func (r *IstioReconciler) ValidateCertManagerIssuer(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	if vc.Spec.Components.Istio == nil || vc.Spec.Components.Istio.CertificateIssuer == "" {
		return nil
	}

	issuerName := strings.TrimSpace(vc.Spec.Components.Istio.CertificateIssuer)
	issuerKind := vc.Spec.Components.Istio.CertificateIssuerKind
	if issuerKind == "" {
		issuerKind = "ClusterIssuer"
	}

	u := &unstructured.Unstructured{}
	var targetNamespace string

	if strings.EqualFold(issuerKind, "ClusterIssuer") {
		u.SetGroupVersionKind(clusterIssuerGVK)
		targetNamespace = ""
	} else {
		u.SetGroupVersionKind(issuerGVK)
		targetNamespace = vc.Namespace
	}

	err := r.hostClient.Get(ctx, types.NamespacedName{
		Name:      issuerName,
		Namespace: targetNamespace,
	}, u)

	if err != nil {
		if apierrors.IsNotFound(err) {
			return fmt.Errorf("cert-manager %s %q does not exist on host cluster (namespace: %q)", issuerKind, issuerName, targetNamespace)
		}
		if meta.IsNoMatchError(err) || strings.Contains(err.Error(), "no matches for kind") {
			return fmt.Errorf("cert-manager CRDs are not installed on the host cluster (%w)", err)
		}
		return fmt.Errorf("failed verifying cert-manager %s %q on host: %w", issuerKind, issuerName, err)
	}

	return nil
}

// ReconcileIstio manages the complete lifecycle of Istio and Cert-Manager TLS inside the virtual cluster
func (r *IstioReconciler) ReconcileIstio(ctx context.Context, vc *v1alpha1.VirtualCluster) (bool, error) {
	if vc.Spec.Components.Istio == nil || !vc.Spec.Components.Istio.Enabled {
		return true, nil
	}

	// 1. Validate Cert-Manager Issuer on Host (ABORT if missing)
	if err := r.ValidateCertManagerIssuer(ctx, vc); err != nil {
		return false, fmt.Errorf("cert-manager issuer validation failed: %w", err)
	}

	// 2. Connect to the Virtual Cluster
	vClient, dynClient, err := r.addonsRec.GetVirtualClusterClients(ctx, vc)
	if err != nil {
		return false, fmt.Errorf("cannot connect to virtual cluster: %w", err)
	}

	// 3. Ensure namespace istio-system exists in the guest cluster
	istioNs := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "istio-system",
			Labels: map[string]string{
				"app.kubernetes.io/part-of": "istio",
			},
		},
	}
	if vc.Spec.Components.Istio.MeshEnabled {
		istioNs.Labels["istio-injection"] = "enabled"
	} else {
		istioNs.Labels["istio-injection"] = "disabled"
	}
	if err := vClient.Create(ctx, istioNs); err != nil && !apierrors.IsAlreadyExists(err) {
		return false, fmt.Errorf("failed creating namespace istio-system: %w", err)
	}

	// 4. Reconcile Host Certificate & Sync TLS Secret to Guest
	tlsSecretName := vc.Spec.Components.Istio.CertSecretName
	if tlsSecretName == "" {
		tlsSecretName = fmt.Sprintf("%s-ingress-tls", vc.Name)
	}
	hostFQDN := r.ExtractClusterHost(vc)

	if vc.Spec.Components.Istio.CertificateIssuer != "" {
		if err := r.reconcileHostCertificate(ctx, vc, tlsSecretName, hostFQDN); err != nil {
			// Log or continue, non-fatal if certificate generation takes time
		}
		// Sync secret from host to guest namespace if present
		_ = r.syncTlsSecretToGuest(ctx, vc, vClient, tlsSecretName)
	}

	// 5. Reconcile istiod Control Plane inside Guest Cluster
	if err := r.reconcileIstiod(ctx, vc, vClient); err != nil {
		return false, fmt.Errorf("failed reconciling istiod: %w", err)
	}

	// 6. Reconcile istio-ingressgateway inside Guest Cluster
	if err := r.reconcileIngressGateway(ctx, vc, vClient); err != nil {
		return false, fmt.Errorf("failed reconciling istio-ingressgateway: %w", err)
	}

	// 7. Ensure Istio Networking CRDs exist inside Guest Cluster
	if err := r.reconcileCRDs(ctx, dynClient); err != nil {
		return false, fmt.Errorf("failed reconciling istio CRDs: %w", err)
	}

	// 8. Reconcile Istio Gateway (HTTP 80 -> HTTPS 443 upgrade, HTTPS 443 TLS)
	if err := r.reconcileGateway(ctx, vc, dynClient, tlsSecretName, hostFQDN); err != nil {
		return false, fmt.Errorf("failed reconciling istio gateway: %w", err)
	}

	// 9. Reconcile Istio VirtualService (Main Application Entrypoint)
	if err := r.reconcileVirtualService(ctx, vc, dynClient, hostFQDN); err != nil {
		return false, fmt.Errorf("failed reconciling istio virtualservice: %w", err)
	}

	return true, nil
}

func (r *IstioReconciler) reconcileHostCertificate(ctx context.Context, vc *v1alpha1.VirtualCluster, tlsSecretName, hostFQDN string) error {
	certName := fmt.Sprintf("%s-ingress-cert", vc.Name)
	issuerName := strings.TrimSpace(vc.Spec.Components.Istio.CertificateIssuer)
	issuerKind := vc.Spec.Components.Istio.CertificateIssuerKind
	if issuerKind == "" {
		issuerKind = "ClusterIssuer"
	}

	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(certificateGVK)
	u.SetName(certName)
	u.SetNamespace(vc.Namespace)
	var dnsList []interface{}
	if vc.Spec.Components.Istio != nil && len(vc.Spec.Components.Istio.Hosts) > 0 {
		seen := make(map[string]bool)
		for _, h := range vc.Spec.Components.Istio.Hosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !seen[trimmed] {
				seen[trimmed] = true
				dnsList = append(dnsList, trimmed)
			}
		}
	}
	if len(dnsList) == 0 && hostFQDN != "" {
		dnsList = append(dnsList, hostFQDN)
	}

	u.Object["spec"] = map[string]interface{}{
		"secretName": tlsSecretName,
		"issuerRef": map[string]interface{}{
			"name": issuerName,
			"kind": issuerKind,
		},
		"dnsNames": dnsList,
	}

	existing := &unstructured.Unstructured{}
	existing.SetGroupVersionKind(certificateGVK)
	err := r.hostClient.Get(ctx, types.NamespacedName{Name: certName, Namespace: vc.Namespace}, existing)
	if apierrors.IsNotFound(err) {
		return r.hostClient.Create(ctx, u)
	} else if err == nil {
		existing.Object["spec"] = u.Object["spec"]
		return r.hostClient.Update(ctx, existing)
	}
	return err
}

func (r *IstioReconciler) syncTlsSecretToGuest(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client, tlsSecretName string) error {
	hostSecret := &corev1.Secret{}
	err := r.hostClient.Get(ctx, types.NamespacedName{Name: tlsSecretName, Namespace: vc.Namespace}, hostSecret)
	if err != nil {
		return err
	}

	guestSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      tlsSecretName,
			Namespace: "istio-system",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "vcop-operator",
			},
		},
		Type: hostSecret.Type,
		Data: hostSecret.Data,
	}

	existingGuestSecret := &corev1.Secret{}
	err = vClient.Get(ctx, types.NamespacedName{Name: tlsSecretName, Namespace: "istio-system"}, existingGuestSecret)
	if apierrors.IsNotFound(err) {
		return vClient.Create(ctx, guestSecret)
	} else if err == nil {
		existingGuestSecret.Data = hostSecret.Data
		existingGuestSecret.Type = hostSecret.Type
		return vClient.Update(ctx, existingGuestSecret)
	}
	return err
}

func (r *IstioReconciler) reconcileIstiod(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client) error {
	// 1. ServiceAccount
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istiod",
			Namespace: "istio-system",
		},
	}
	if err := vClient.Create(ctx, sa); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	// 2. ClusterRole & Binding
	cr := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name: "istiod-clusterrole",
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"endpoints", "pods", "services", "namespaces", "nodes", "secrets", "configmaps"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"discovery.k8s.io"},
				Resources: []string{"endpointslices"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"apps"},
				Resources: []string{"deployments", "statefulsets", "replicasets"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"networking.istio.io", "security.istio.io"},
				Resources: []string{"*"},
				Verbs:     []string{"*"},
			},
		},
	}
	if err := vClient.Create(ctx, cr); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: "istiod-clusterrolebinding",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "istiod-clusterrole",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "istiod",
				Namespace: "istio-system",
			},
		},
	}
	if err := vClient.Create(ctx, crb); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	// 3. Deployment
	istioVer := "1.24.2"
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Version != "" {
		istioVer = vc.Spec.Components.Istio.Version
	}
	pilotImage := registry.GetResolver().RewriteImage(fmt.Sprintf("docker.io/istio/pilot:%s", istioVer), vc)

	replicas := r.GetIstiodReplicas(vc)
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istiod",
			Namespace: "istio-system",
			Labels: map[string]string{
				"app":   "istiod",
				"istio": "pilot",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "istiod",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app":   "istiod",
						"istio": "pilot",
					},
				},
				Spec: corev1.PodSpec{
					ServiceAccountName: "istiod",
					Containers: []corev1.Container{
						{
							Name:  "discovery",
							Image: pilotImage,
							Args: []string{
								"discovery",
								"--monitoringAddr=:15014",
								"--domain=cluster.local",
								"--keepaliveMaxServerConnectionAge=30m",
							},
							Ports: []corev1.ContainerPort{
								{ContainerPort: 8080, Protocol: corev1.ProtocolTCP},
								{ContainerPort: 15010, Protocol: corev1.ProtocolTCP},
								{ContainerPort: 15012, Protocol: corev1.ProtocolTCP},
								{ContainerPort: 15014, Protocol: corev1.ProtocolTCP},
							},
							Env: []corev1.EnvVar{
								{Name: "REVISION", Value: "default"},
								{Name: "PILOT_ENABLE_STATUS", Value: "true"},
								{Name: "PILOT_ENABLE_INBOUND_PASSTHROUGH", Value: "1"},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("100m"),
									corev1.ResourceMemory: resource.MustParse("256Mi"),
								},
								Limits: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("1000m"),
									corev1.ResourceMemory: resource.MustParse("1024Mi"),
								},
							},
						},
					},
				},
			},
		},
	}
	existingDep := &appsv1.Deployment{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "istiod", Namespace: "istio-system"}, existingDep); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, dep); err != nil {
			return err
		}
	} else if err == nil {
		updated := false
		if existingDep.Spec.Replicas == nil || *existingDep.Spec.Replicas != replicas {
			existingDep.Spec.Replicas = &replicas
			updated = true
		}
		if len(existingDep.Spec.Template.Spec.Containers) > 0 &&
			existingDep.Spec.Template.Spec.Containers[0].Image != dep.Spec.Template.Spec.Containers[0].Image {
			existingDep.Spec.Template = dep.Spec.Template
			updated = true
		}
		if updated {
			if err := vClient.Update(ctx, existingDep); err != nil {
				return err
			}
		}
	}

	// 4. Service
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istiod",
			Namespace: "istio-system",
			Labels: map[string]string{
				"app":   "istiod",
				"istio": "pilot",
			},
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{
				"app": "istiod",
			},
			Ports: []corev1.ServicePort{
				{Name: "grpc-xds", Port: 15010, TargetPort: intstr.FromInt(15010)},
				{Name: "https-xds", Port: 15012, TargetPort: intstr.FromInt(15012)},
				{Name: "https-dns", Port: 15014, TargetPort: intstr.FromInt(15014)},
			},
		},
	}
	existingSvc := &corev1.Service{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "istiod", Namespace: "istio-system"}, existingSvc); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, svc); err != nil {
			return err
		}
	}

	return nil
}

func (r *IstioReconciler) reconcileIngressGateway(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client) error {
	// 1. ServiceAccount
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway",
			Namespace: "istio-system",
		},
	}
	if err := vClient.Create(ctx, sa); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	// 2. Secret read Role for SDS
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway-sds",
			Namespace: "istio-system",
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"secrets"},
				Verbs:     []string{"get", "watch", "list"},
			},
		},
	}
	if err := vClient.Create(ctx, role); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway-sds",
			Namespace: "istio-system",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     "istio-ingressgateway-sds",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "istio-ingressgateway",
				Namespace: "istio-system",
			},
		},
	}
	if err := vClient.Create(ctx, rb); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	// 3. Deployment
	istioVer := "1.24.2"
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Version != "" {
		istioVer = vc.Spec.Components.Istio.Version
	}
	proxyImage := registry.GetResolver().RewriteImage(fmt.Sprintf("docker.io/istio/proxyv2:%s", istioVer), vc)

	replicas := r.GetIngressGatewayReplicas(vc)
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway",
			Namespace: "istio-system",
			Labels: map[string]string{
				"app":   "istio-ingressgateway",
				"istio": "ingressgateway",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app":   "istio-ingressgateway",
					"istio": "ingressgateway",
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app":                     "istio-ingressgateway",
						"istio":                   "ingressgateway",
						"sidecar.istio.io/inject": "false",
					},
				},
				Spec: corev1.PodSpec{
					ServiceAccountName: "istio-ingressgateway",
					Containers: []corev1.Container{
						{
							Name:  "istio-proxy",
							Image: proxyImage,
							Args: []string{
								"proxy",
								"router",
								"--domain",
								"istio-system.svc.cluster.local",
								"--proxyLogLevel=warning",
								"--log_output_level=default:info",
							},
							Ports: []corev1.ContainerPort{
								{Name: "status-port", ContainerPort: 15021, Protocol: corev1.ProtocolTCP},
								{Name: "http2", ContainerPort: 8080, Protocol: corev1.ProtocolTCP},
								{Name: "https", ContainerPort: 8443, Protocol: corev1.ProtocolTCP},
							},
							Env: []corev1.EnvVar{
								{Name: "JWT_POLICY", Value: "third-party-jwt"},
								{Name: "PILOT_CERT_PROVIDER", Value: "none"},
								{Name: "PROXY_CONFIG", Value: "discoveryAddress: istiod.istio-system.svc:15010\ncontrolPlaneAuthPolicy: NONE\n"},
								{
									Name: "POD_NAME",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.name"},
									},
								},
								{
									Name: "POD_NAMESPACE",
									ValueFrom: &corev1.EnvVarSource{
										FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.namespace"},
									},
								},
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("100m"),
									corev1.ResourceMemory: resource.MustParse("128Mi"),
								},
								Limits: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("1000m"),
									corev1.ResourceMemory: resource.MustParse("512Mi"),
								},
							},
						},
					},
				},
			},
		},
	}
	existingDep := &appsv1.Deployment{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "istio-ingressgateway", Namespace: "istio-system"}, existingDep); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, dep); err != nil {
			return err
		}
	} else if err == nil {
		updated := false
		if existingDep.Spec.Replicas == nil || *existingDep.Spec.Replicas != replicas {
			existingDep.Spec.Replicas = &replicas
			updated = true
		}
		if len(existingDep.Spec.Template.Spec.Containers) > 0 &&
			existingDep.Spec.Template.Spec.Containers[0].Image != dep.Spec.Template.Spec.Containers[0].Image {
			existingDep.Spec.Template = dep.Spec.Template
			updated = true
		}
		if updated {
			if err := vClient.Update(ctx, existingDep); err != nil {
				return err
			}
		}
	}

	// 4. Service (type ClusterIP by default)
	svcType := corev1.ServiceTypeClusterIP
	if vc.Spec.Components.Istio.IngressGateway != nil && vc.Spec.Components.Istio.IngressGateway.ServiceType != "" {
		svcType = corev1.ServiceType(vc.Spec.Components.Istio.IngressGateway.ServiceType)
	}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway",
			Namespace: "istio-system",
			Labels: map[string]string{
				"app":   "istio-ingressgateway",
				"istio": "ingressgateway",
			},
		},
		Spec: corev1.ServiceSpec{
			Type: svcType,
			Selector: map[string]string{
				"app":   "istio-ingressgateway",
				"istio": "ingressgateway",
			},
			Ports: []corev1.ServicePort{
				{Name: "status-port", Port: 15021, TargetPort: intstr.FromInt(15021)},
				{Name: "http2", Port: 80, TargetPort: intstr.FromInt(8080)},
				{Name: "https", Port: 443, TargetPort: intstr.FromInt(8443)},
			},
		},
	}
	existingSvc := &corev1.Service{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "istio-ingressgateway", Namespace: "istio-system"}, existingSvc); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, svc); err != nil {
			return err
		}
	} else if err == nil {
		// Update service type and ports if they differ
		if existingSvc.Spec.Type != svcType || !portsEqual(existingSvc.Spec.Ports, svc.Spec.Ports) {
			existingSvc.Spec.Type = svcType
			existingSvc.Spec.Ports = svc.Spec.Ports
			if err := vClient.Update(ctx, existingSvc); err != nil {
				return err
			}
		}
	} else {
		return err
	}

	return nil
}

func (r *IstioReconciler) reconcileGateway(ctx context.Context, vc *v1alpha1.VirtualCluster, dyn dynamic.Interface, tlsSecretName, hostFQDN string) error {
	gw := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "networking.istio.io/v1beta1",
			"kind":       "Gateway",
			"metadata": map[string]interface{}{
				"name":      "default-gateway",
				"namespace": "istio-system",
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			"spec": map[string]interface{}{
				"selector": map[string]interface{}{
					"app":   "istio-ingressgateway",
					"istio": "ingressgateway",
				},
				"servers": []interface{}{
					// Port 80 HTTP with automatic Upgrade/Redirect to 443 HTTPS
					map[string]interface{}{
						"port": map[string]interface{}{
							"number":   int64(80),
							"name":     "http",
							"protocol": "HTTP",
						},
						"hosts": []interface{}{hostFQDN, "*"},
						"tls": map[string]interface{}{
							"httpsRedirect": true,
						},
					},
					// Port 443 HTTPS using Cert-Manager TLS Secret
					map[string]interface{}{
						"port": map[string]interface{}{
							"number":   int64(443),
							"name":     "https",
							"protocol": "HTTPS",
						},
						"hosts": []interface{}{hostFQDN, "*"},
						"tls": map[string]interface{}{
							"mode":           "SIMPLE",
							"credentialName": tlsSecretName,
						},
					},
				},
			},
		},
	}

	_, err := dyn.Resource(gatewayGVR).Namespace("istio-system").Create(ctx, gw, metav1.CreateOptions{})
	if err != nil && !apierrors.IsAlreadyExists(err) {
		// Try update if already exists
		if apierrors.IsAlreadyExists(err) {
			existing, getErr := dyn.Resource(gatewayGVR).Namespace("istio-system").Get(ctx, "default-gateway", metav1.GetOptions{})
			if getErr == nil {
				existing.Object["spec"] = gw.Object["spec"]
				_, _ = dyn.Resource(gatewayGVR).Namespace("istio-system").Update(ctx, existing, metav1.UpdateOptions{})
			}
		} else {
			return err
		}
	}

	return nil
}

func (r *IstioReconciler) reconcileVirtualService(ctx context.Context, vc *v1alpha1.VirtualCluster, dyn dynamic.Interface, hostFQDN string) error {
	var vsHosts []interface{}
	if vc.Spec.Components.Istio != nil && len(vc.Spec.Components.Istio.Hosts) > 0 {
		seen := make(map[string]bool)
		for _, h := range vc.Spec.Components.Istio.Hosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !seen[trimmed] {
				seen[trimmed] = true
				vsHosts = append(vsHosts, trimmed)
			}
		}
	}
	if len(vsHosts) == 0 && hostFQDN != "" {
		vsHosts = append(vsHosts, hostFQDN)
	}

	vs := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "networking.istio.io/v1beta1",
			"kind":       "VirtualService",
			"metadata": map[string]interface{}{
				"name":      "main-entrypoint",
				"namespace": "istio-system",
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			"spec": map[string]interface{}{
				"hosts": vsHosts,
				"gateways": []interface{}{
					"istio-system/default-gateway",
				},
				"http": []interface{}{
					map[string]interface{}{
						"name": "default-entrypoint-route",
						"match": []interface{}{
							map[string]interface{}{
								"uri": map[string]interface{}{
									"prefix": "/",
								},
							},
						},
						"directResponse": map[string]interface{}{
							"status": int64(200),
							"body": map[string]interface{}{
								"string": "vCOp Platform: Virtual Cluster Application Entrypoint is Healthy and Ready.\n",
							},
						},
					},
				},
			},
		},
	}

	_, err := dyn.Resource(virtualServiceGVR).Namespace("istio-system").Create(ctx, vs, metav1.CreateOptions{})
	if err != nil && !apierrors.IsAlreadyExists(err) {
		if apierrors.IsAlreadyExists(err) {
			existing, getErr := dyn.Resource(virtualServiceGVR).Namespace("istio-system").Get(ctx, "main-entrypoint", metav1.GetOptions{})
			if getErr == nil {
				existing.Object["spec"] = vs.Object["spec"]
				_, _ = dyn.Resource(virtualServiceGVR).Namespace("istio-system").Update(ctx, existing, metav1.UpdateOptions{})
			}
		} else {
			return err
		}
	}

	return nil
}

func (r *IstioReconciler) reconcileCRDs(ctx context.Context, dyn dynamic.Interface) error {
	crds := []struct {
		name     string
		kind     string
		plural   string
		singular string
		short    string
	}{
		{
			name:     "gateways.networking.istio.io",
			kind:     "Gateway",
			plural:   "gateways",
			singular: "gateway",
			short:    "gw",
		},
		{
			name:     "virtualservices.networking.istio.io",
			kind:     "VirtualService",
			plural:   "virtualservices",
			singular: "virtualservice",
			short:    "vs",
		},
		{
			name:     "destinationrules.networking.istio.io",
			kind:     "DestinationRule",
			plural:   "destinationrules",
			singular: "destinationrule",
			short:    "dr",
		},
	}

	for _, c := range crds {
		crd := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "apiextensions.k8s.io/v1",
				"kind":       "CustomResourceDefinition",
				"metadata": map[string]interface{}{
					"name": c.name,
					"labels": map[string]interface{}{
						"app.kubernetes.io/part-of": "istio",
					},
				},
				"spec": map[string]interface{}{
					"group": "networking.istio.io",
					"names": map[string]interface{}{
						"kind":       c.kind,
						"listKind":   c.kind + "List",
						"plural":     c.plural,
						"singular":   c.singular,
						"shortNames": []interface{}{c.short},
					},
					"scope": "Namespaced",
					"versions": []interface{}{
						map[string]interface{}{
							"name":    "v1beta1",
							"served":  true,
							"storage": true,
							"schema": map[string]interface{}{
								"openAPIV3Schema": map[string]interface{}{
									"type":                                "object",
									"x-kubernetes-preserve-unknown-fields": true,
								},
							},
						},
						map[string]interface{}{
							"name":    "v1alpha3",
							"served":  true,
							"storage": false,
							"schema": map[string]interface{}{
								"openAPIV3Schema": map[string]interface{}{
									"type":                                "object",
									"x-kubernetes-preserve-unknown-fields": true,
								},
							},
						},
					},
				},
			},
		}

		_, err := dyn.Resource(crdGVR).Create(ctx, crd, metav1.CreateOptions{})
		if err != nil && !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("failed creating CRD %s: %w", c.name, err)
		}
	}
	return nil
}

// portsEqual compares two ServicePort slices for equality by name, port, and targetPort.
func portsEqual(a, b []corev1.ServicePort) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Name != b[i].Name || a[i].Port != b[i].Port || a[i].TargetPort != b[i].TargetPort {
			return false
		}
	}
	return true
}

// GetIstiodReplicas computes the replica count for the istiod control plane.
// If HighAvailability is true (or SizePreset is PresetHA), it returns 3 replicas; otherwise 1 replica.
// Explicit Replicas setting in Spec overrides this.
func (r *IstioReconciler) GetIstiodReplicas(vc *v1alpha1.VirtualCluster) int32 {
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Replicas != nil {
		return *vc.Spec.Components.Istio.Replicas
	}
	isHA := vc.Spec.HighAvailability
	if vc.Spec.SizePreset == v1alpha1.PresetNormal {
		isHA = false
	} else if vc.Spec.SizePreset == v1alpha1.PresetHA {
		isHA = true
	}
	if isHA {
		return 3
	}
	return 1
}

// GetIngressGatewayReplicas computes the replica count for the Istio ingress gateway.
// If HighAvailability is true (or SizePreset is PresetHA), it returns 3 replicas; otherwise 1 replica.
// Explicit Replicas setting in Spec overrides this.
func (r *IstioReconciler) GetIngressGatewayReplicas(vc *v1alpha1.VirtualCluster) int32 {
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.IngressGateway != nil && vc.Spec.Components.Istio.IngressGateway.Replicas != nil {
		return *vc.Spec.Components.Istio.IngressGateway.Replicas
	}
	isHA := vc.Spec.HighAvailability
	if vc.Spec.SizePreset == v1alpha1.PresetNormal {
		isHA = false
	} else if vc.Spec.SizePreset == v1alpha1.PresetHA {
		isHA = true
	}
	if isHA {
		return 3
	}
	return 1
}
