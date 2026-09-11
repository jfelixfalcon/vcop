package controllers

import (
	"context"
	"fmt"
	"net/url"
	"os"
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
	gatewayGVK = schema.GroupVersionKind{
		Group:   "networking.istio.io",
		Version: "v1beta1",
		Kind:    "Gateway",
	}
	virtualServiceGVK = schema.GroupVersionKind{
		Group:   "networking.istio.io",
		Version: "v1beta1",
		Kind:    "VirtualService",
	}
	destinationRuleGVK = schema.GroupVersionKind{
		Group:   "networking.istio.io",
		Version: "v1beta1",
		Kind:    "DestinationRule",
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
	destinationRuleGVR = schema.GroupVersionResource{
		Group:    "networking.istio.io",
		Version:  "v1beta1",
		Resource: "destinationrules",
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
	if vc.Spec.Components.Istio != nil && len(vc.Spec.Components.Istio.Hosts) > 0 {
		for _, h := range vc.Spec.Components.Istio.Hosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !strings.HasPrefix(trimmed, "*.") {
				return trimmed
			}
		}
		if vc.Spec.Components.Istio.Hosts[0] != "" {
			return strings.TrimPrefix(strings.TrimSpace(vc.Spec.Components.Istio.Hosts[0]), "*.")
		}
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
		_ = r.CleanupAllIstio(ctx, vc)
		return true, nil
	}

	// 1. Validate Cert-Manager Issuer on Host (Non-fatal warning if missing, allows ingress/host routing to proceed)
	issuerValid := true
	if err := r.ValidateCertManagerIssuer(ctx, vc); err != nil {
		issuerValid = false
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

	if issuerValid && vc.Spec.Components.Istio.CertificateIssuer != "" {
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

	// 10. Reconcile Host-level Routing (DestinationRule, host VirtualService, and vCluster API Passthrough Gateway)
	if vc.Spec.Components.Istio.HostRouting != nil && vc.Spec.Components.Istio.HostRouting.Enabled {
		if err := r.reconcileHostRouting(ctx, vc, tlsSecretName, hostFQDN); err != nil {
			return false, fmt.Errorf("failed reconciling host routing: %w", err)
		}
	} else {
		_ = r.cleanupHostRouting(ctx, vc)
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
		if err := vClient.Create(ctx, guestSecret); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
		return nil
	} else if err == nil {
		existingGuestSecret.Data = hostSecret.Data
		existingGuestSecret.Type = hostSecret.Type
		if err := vClient.Update(ctx, existingGuestSecret); err != nil && !apierrors.IsConflict(err) {
			return err
		}
		return nil
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
				Resources: []string{"endpoints", "pods", "services", "namespaces", "nodes"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{""},
				Resources: []string{"secrets", "configmaps"},
				Verbs:     []string{"get", "list", "watch", "create", "update", "patch", "delete"},
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
			{
				APIGroups: []string{"coordination.k8s.io"},
				Resources: []string{"leases"},
				Verbs:     []string{"get", "list", "watch", "create", "update", "patch", "delete"},
			},
			{
				APIGroups: []string{"apiextensions.k8s.io"},
				Resources: []string{"customresourcedefinitions"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"networking.k8s.io"},
				Resources: []string{"ingressclasses", "ingresses"},
				Verbs:     []string{"get", "list", "watch"},
			},
			{
				APIGroups: []string{"gateway.networking.k8s.io"},
				Resources: []string{"*"},
				Verbs:     []string{"*"},
			},
			{
				APIGroups: []string{"authentication.k8s.io"},
				Resources: []string{"tokenreviews"},
				Verbs:     []string{"create"},
			},
			{
				APIGroups: []string{"authorization.k8s.io"},
				Resources: []string{"subjectaccessreviews"},
				Verbs:     []string{"create"},
			},
			{
				APIGroups: []string{"admissionregistration.k8s.io"},
				Resources: []string{"mutatingwebhookconfigurations", "validatingwebhookconfigurations"},
				Verbs:     []string{"get", "list", "watch", "update"},
			},
		},
	}
	existingCR := &rbacv1.ClusterRole{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: cr.Name}, existingCR); err == nil {
		existingCR.Rules = cr.Rules
		if err := vClient.Update(ctx, existingCR); err != nil && !apierrors.IsConflict(err) {
			return err
		}
	} else if apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, cr); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else {
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
								fmt.Sprintf("--domain=%s", getClusterDomain()),
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
								{Name: "PILOT_ENABLE_GATEWAY_API", Value: "false"},
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
		if err := vClient.Create(ctx, dep); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
		updated := false
		if existingDep.Spec.Replicas == nil || *existingDep.Spec.Replicas != replicas {
			existingDep.Spec.Replicas = &replicas
			updated = true
		}
		existingDep.Spec.Template = dep.Spec.Template
		updated = true
		if updated {
			if err := vClient.Update(ctx, existingDep); err != nil && !apierrors.IsConflict(err) {
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
		if err := vClient.Create(ctx, svc); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
		if !portsEqual(existingSvc.Spec.Ports, svc.Spec.Ports) {
			existingSvc.Labels = svc.Labels
			existingSvc.Spec.Selector = svc.Spec.Selector
			existingSvc.Spec.Ports = svc.Spec.Ports
			if err := vClient.Update(ctx, existingSvc); err != nil && !apierrors.IsConflict(err) {
				return err
			}
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
	gwLabels := map[string]string{
		"app":   "istio-ingressgateway",
		"istio": "ingressgateway",
	}
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.IngressGateway != nil && len(vc.Spec.Components.Istio.IngressGateway.Selector) > 0 {
		gwLabels = make(map[string]string)
		for k, v := range vc.Spec.Components.Istio.IngressGateway.Selector {
			gwLabels[k] = v
		}
	}

	podTemplateLabels := map[string]string{
		"sidecar.istio.io/inject": "false",
	}
	for k, v := range gwLabels {
		podTemplateLabels[k] = v
	}

	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "istio-ingressgateway",
			Namespace: "istio-system",
			Labels:    gwLabels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: gwLabels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: podTemplateLabels,
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
								fmt.Sprintf("istio-system.svc.%s", getClusterDomain()),
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
								{Name: "PILOT_CERT_PROVIDER", Value: "istiod"},
								{Name: "CA_ADDR", Value: "istiod.istio-system.svc:15012"},
								{Name: "PROXY_CONFIG", Value: "discoveryAddress: istiod.istio-system.svc:15012\n"},
								{Name: "ISTIO_META_CLUSTER_ID", Value: "Kubernetes"},
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
							VolumeMounts: []corev1.VolumeMount{
								{Name: "istio-token", MountPath: "/var/run/secrets/tokens"},
								{Name: "istio-ca-root-cert", MountPath: "/var/run/secrets/istio"},
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
					Volumes: []corev1.Volume{
						{
							Name: "istio-token",
							VolumeSource: corev1.VolumeSource{
								Projected: &corev1.ProjectedVolumeSource{
									Sources: []corev1.VolumeProjection{
										{
											ServiceAccountToken: &corev1.ServiceAccountTokenProjection{
												Audience:          "istio-ca",
												ExpirationSeconds: func(i int64) *int64 { return &i }(43200),
												Path:              "istio-token",
											},
										},
									},
								},
							},
						},
						{
							Name: "istio-ca-root-cert",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{
										Name: "istio-ca-root-cert",
									},
									Optional: ptrBool(true),
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
		if err := vClient.Create(ctx, dep); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
		updated := false
		if existingDep.Spec.Replicas == nil || *existingDep.Spec.Replicas != replicas {
			existingDep.Spec.Replicas = &replicas
			updated = true
		}
		existingDep.Spec.Template = dep.Spec.Template
		updated = true
		if updated {
			if err := vClient.Update(ctx, existingDep); err != nil && !apierrors.IsConflict(err) {
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
			Labels:    gwLabels,
		},
		Spec: corev1.ServiceSpec{
			Type:     svcType,
			Selector: gwLabels,
			Ports: []corev1.ServicePort{
				{Name: "status-port", Port: 15021, TargetPort: intstr.FromInt(15021)},
				{Name: "http2", Port: 80, TargetPort: intstr.FromInt(8080)},
				{Name: "https", Port: 443, TargetPort: intstr.FromInt(8443)},
			},
		},
	}
	existingSvc := &corev1.Service{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "istio-ingressgateway", Namespace: "istio-system"}, existingSvc); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, svc); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
		// Update service type, selector, and ports if they differ
		if existingSvc.Spec.Type != svcType || !portsEqual(existingSvc.Spec.Ports, svc.Spec.Ports) {
			existingSvc.Spec.Type = svcType
			existingSvc.Spec.Selector = svc.Spec.Selector
			existingSvc.Spec.Ports = svc.Spec.Ports
			if err := vClient.Update(ctx, existingSvc); err != nil && !apierrors.IsConflict(err) {
				return err
			}
		}
	} else {
		return err
	}

	return nil
}

func (r *IstioReconciler) reconcileGateway(ctx context.Context, vc *v1alpha1.VirtualCluster, dyn dynamic.Interface, tlsSecretName, hostFQDN string) error {
	gwSelector := map[string]interface{}{
		"app":   "istio-ingressgateway",
		"istio": "ingressgateway",
	}
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.IngressGateway != nil && len(vc.Spec.Components.Istio.IngressGateway.Selector) > 0 {
		gwSelector = make(map[string]interface{})
		for k, v := range vc.Spec.Components.Istio.IngressGateway.Selector {
			gwSelector[k] = v
		}
	}

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
				"selector": gwSelector,
				"servers": []interface{}{
					// Port 80 HTTP
					map[string]interface{}{
						"port": map[string]interface{}{
							"number":   int64(80),
							"name":     "http",
							"protocol": "HTTP",
						},
						"hosts": []interface{}{hostFQDN, "*"},
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
	if err != nil {
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
	if err != nil {
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
							"name":    "v1",
							"served":  true,
							"storage": true,
							"schema": map[string]interface{}{
								"openAPIV3Schema": map[string]interface{}{
									"type":                                 "object",
									"x-kubernetes-preserve-unknown-fields": true,
								},
							},
						},
						map[string]interface{}{
							"name":    "v1beta1",
							"served":  true,
							"storage": false,
							"schema": map[string]interface{}{
								"openAPIV3Schema": map[string]interface{}{
									"type":                                 "object",
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
									"type":                                 "object",
									"x-kubernetes-preserve-unknown-fields": true,
								},
							},
						},
					},
				},
			},
		}

		existingCRD, err := dyn.Resource(crdGVR).Get(ctx, c.name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			_, err = dyn.Resource(crdGVR).Create(ctx, crd, metav1.CreateOptions{})
			if err != nil && !apierrors.IsAlreadyExists(err) {
				return fmt.Errorf("failed creating CRD %s: %w", c.name, err)
			}
		} else if err == nil {
			crd.SetResourceVersion(existingCRD.GetResourceVersion())
			_, err = dyn.Resource(crdGVR).Update(ctx, crd, metav1.UpdateOptions{})
			if err != nil && !apierrors.IsConflict(err) {
				return fmt.Errorf("failed updating CRD %s: %w", c.name, err)
			}
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

// getClusterDomain resolves the cluster domain from CLUSTER_DOMAIN env or /etc/resolv.conf, defaulting to cluster.local
func getClusterDomain() string {
	if d := os.Getenv("CLUSTER_DOMAIN"); d != "" {
		return d
	}
	if data, err := os.ReadFile("/etc/resolv.conf"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "search ") {
				for _, field := range strings.Fields(line[7:]) {
					if strings.HasPrefix(field, "svc.") {
						return strings.TrimPrefix(field, "svc.")
					}
				}
			}
		}
	}
	return "cluster.local"
}

// resolveHostIngressSelector returns the label selector for host ingress gateway pods.
// If not explicitly provided, it auto-detects from candidate namespaces on the host cluster.
func (r *IstioReconciler) resolveHostIngressSelector(ctx context.Context, configured map[string]string) map[string]interface{} {
	if len(configured) > 0 {
		res := make(map[string]interface{})
		for k, v := range configured {
			res[k] = v
		}
		return res
	}

	// Auto-detect from host cluster: look for running ingress gateway pods in standard namespaces
	candidateNamespaces := []string{"istio-system", "istio-ingress", "ingress"}
	candidateSelectors := []map[string]string{
		{"istio": "ingressgateway"},
		{"app": "istio-ingressgateway"},
		{"app.kubernetes.io/name": "istio-ingressgateway"},
		{"app": "istio-ingress"},
	}

	for _, ns := range candidateNamespaces {
		for _, sel := range candidateSelectors {
			podList := &corev1.PodList{}
			if err := r.hostClient.List(ctx, podList, client.InNamespace(ns), client.MatchingLabels(sel)); err == nil && len(podList.Items) > 0 {
				res := make(map[string]interface{})
				for k, v := range sel {
					res[k] = v
				}
				return res
			}
		}
	}

	// Cluster-wide fallback across all namespaces
	for _, sel := range candidateSelectors {
		podList := &corev1.PodList{}
		if err := r.hostClient.List(ctx, podList, client.MatchingLabels(sel)); err == nil && len(podList.Items) > 0 {
			res := make(map[string]interface{})
			for k, v := range sel {
				res[k] = v
			}
			return res
		}
	}

	return map[string]interface{}{
		"istio": "ingressgateway",
	}
}

// resolveHostDefaultGateway detects or validates the host default gateway for routing application traffic.
// If the configured gateway is empty or default, and does not exist, it auto-detects any existing host Gateway.
func (r *IstioReconciler) resolveHostDefaultGateway(ctx context.Context, configured string) string {
	defaultGw := strings.TrimSpace(configured)
	if defaultGw != "" && defaultGw != "istio-system/default-gateway" {
		return defaultGw
	}

	gwList := &unstructured.UnstructuredList{}
	gwList.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "networking.istio.io",
		Version: "v1beta1",
		Kind:    "GatewayList",
	})
	if err := r.hostClient.List(ctx, gwList); err == nil && len(gwList.Items) > 0 {
		var candidate string
		for _, item := range gwList.Items {
			// Skip per-cluster API passthrough gateways created by vcop
			if strings.HasSuffix(item.GetName(), "-api-gateway") {
				continue
			}
			fullName := fmt.Sprintf("%s/%s", item.GetNamespace(), item.GetName())
			if fullName == "istio-system/default-gateway" {
				return fullName
			}
			if candidate == "" {
				candidate = fullName
			}
		}
		if candidate != "" {
			return candidate
		}
	}

	if defaultGw != "" {
		return defaultGw
	}
	return "istio-system/default-gateway"
}

// reconcileHostRouting deploys the host-level DestinationRule, host VirtualService, and vCluster API Passthrough Gateway
func (r *IstioReconciler) reconcileHostRouting(ctx context.Context, vc *v1alpha1.VirtualCluster, tlsSecretName, hostFQDN string) error {
	hostRouting := vc.Spec.Components.Istio.HostRouting
	if hostRouting == nil || !hostRouting.Enabled {
		return nil
	}

	var ownerRefs []metav1.OwnerReference
	if vc.UID != "" {
		apiVersion := vc.APIVersion
		if apiVersion == "" {
			apiVersion = "vops.gitops.io/v1alpha1"
		}
		kind := vc.Kind
		if kind == "" {
			kind = "VirtualCluster"
		}
		ownerRefs = []metav1.OwnerReference{
			{
				APIVersion:         apiVersion,
				Kind:               kind,
				Name:               vc.Name,
				UID:                vc.UID,
				BlockOwnerDeletion: ptrBool(true),
				Controller:         ptrBool(true),
			},
		}
	}

	clusterDomain := getClusterDomain()

	// Look up the actual host service created for the guest ingressgateway (e.g. istio-ingressgateway-x-istio-system-x-vc-dev)
	svcList := &corev1.ServiceList{}
	var hostSvcName string
	if err := r.hostClient.List(ctx, svcList, client.InNamespace(vc.Namespace), client.MatchingLabels{
		"vcluster.loft.sh/managed-by": vc.Name,
		"vcluster.loft.sh/namespace":  "istio-system",
		"app":                         "istio-ingressgateway",
	}); err == nil && len(svcList.Items) > 0 {
		hostSvcName = svcList.Items[0].Name
	} else {
		hostSvcName = fmt.Sprintf("istio-ingressgateway-x-istio-system-x-%s", vc.Name)
	}
	targetHost := fmt.Sprintf("%s.%s.svc.%s", hostSvcName, vc.Namespace, clusterDomain)

	// 1. Host DestinationRule
	tlsPolicy := map[string]interface{}{}
	if tlsSecretName != "" {
		tlsPolicy["mode"] = "MUTUAL"
		tlsPolicy["credentialName"] = tlsSecretName
	} else {
		tlsPolicy["mode"] = "SIMPLE"
		tlsPolicy["insecureSkipVerify"] = true
	}
	sniHost := hostFQDN
	if strings.HasPrefix(sniHost, "*.") {
		sniHost = strings.TrimPrefix(sniHost, "*.")
	}
	if sniHost != "" {
		tlsPolicy["sni"] = sniHost
	}

	dr := &unstructured.Unstructured{}
	dr.SetGroupVersionKind(destinationRuleGVK)
	dr.SetName(fmt.Sprintf("%s-guest-gateway", vc.Name))
	dr.SetNamespace(vc.Namespace)
	dr.SetLabels(map[string]string{
		"app.kubernetes.io/managed-by":  "vcop-operator",
		"app.kubernetes.io/part-of":     "istio",
		"vcop.gitops.io/virtualcluster": vc.Name,
	})
	if len(ownerRefs) > 0 {
		dr.SetOwnerReferences(ownerRefs)
	}
	dr.Object["spec"] = map[string]interface{}{
		"host": targetHost,
		"trafficPolicy": map[string]interface{}{
			"connectionPool": map[string]interface{}{
				"http": map[string]interface{}{
					"h2UpgradePolicy": "DO_NOT_UPGRADE",
				},
			},
			"tls": tlsPolicy,
		},
	}
	if err := r.createOrUpdateHostResource(ctx, dr); err != nil {
		return fmt.Errorf("failed reconciling host DestinationRule %s: %w", dr.GetName(), err)
	}

	// 2. Resolve Ingress Gateway Selector
	gwSelector := r.resolveHostIngressSelector(ctx, hostRouting.IngressGatewaySelector)

	// 3. Resolve Application Hosts
	var appHosts []interface{}
	if vc.Spec.Components.Istio != nil && len(vc.Spec.Components.Istio.Hosts) > 0 {
		seen := make(map[string]bool)
		for _, h := range vc.Spec.Components.Istio.Hosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !seen[trimmed] {
				seen[trimmed] = true
				appHosts = append(appHosts, trimmed)
			}
		}
	}
	if len(appHosts) == 0 && hostFQDN != "" {
		appHosts = append(appHosts, hostFQDN)
	}

	// 4. Host Application Gateway Resolution
	defaultGw := r.resolveHostDefaultGateway(ctx, hostRouting.DefaultGateway)

	// 5. Host Application VirtualService
	vsApp := &unstructured.Unstructured{}
	vsApp.SetGroupVersionKind(virtualServiceGVK)
	vsApp.SetName(fmt.Sprintf("%s-host-entrypoint", vc.Name))
	vsApp.SetNamespace(vc.Namespace)
	vsApp.SetLabels(map[string]string{
		"app.kubernetes.io/managed-by":  "vcop-operator",
		"app.kubernetes.io/part-of":     "istio",
		"vcop.gitops.io/virtualcluster": vc.Name,
	})
	if len(ownerRefs) > 0 {
		vsApp.SetOwnerReferences(ownerRefs)
	}
	vsApp.Object["spec"] = map[string]interface{}{
		"gateways": []interface{}{defaultGw},
		"hosts":    appHosts,
		"http": []interface{}{
			map[string]interface{}{
				"name": "guest-gateway-route",
				"match": []interface{}{
					map[string]interface{}{
						"uri": map[string]interface{}{
							"prefix": "/",
						},
					},
				},
				"route": []interface{}{
					map[string]interface{}{
						"destination": map[string]interface{}{
							"host": targetHost,
							"port": map[string]interface{}{
								"number": int64(443),
							},
						},
					},
				},
			},
		},
	}
	if err := r.createOrUpdateHostResource(ctx, vsApp); err != nil {
		return fmt.Errorf("failed reconciling host app VirtualService %s: %w", vsApp.GetName(), err)
	}

	// 6. Host vCluster API Gateway (TLS Mode: PASSTHROUGH on port 443)
	apiHost := strings.TrimSpace(hostRouting.ApiHost)
	if apiHost == "" {
		if hostFQDN != "" {
			apiHost = fmt.Sprintf("api.%s", hostFQDN)
		} else {
			apiHost = fmt.Sprintf("api.%s.local", vc.Name)
		}
	}

	apiGwName := fmt.Sprintf("%s-api-gateway", vc.Name)
	gwApi := &unstructured.Unstructured{}
	gwApi.SetGroupVersionKind(gatewayGVK)
	gwApi.SetName(apiGwName)
	gwApi.SetNamespace(vc.Namespace)
	gwApi.SetLabels(map[string]string{
		"app.kubernetes.io/managed-by":  "vcop-operator",
		"app.kubernetes.io/part-of":     "istio",
		"vcop.gitops.io/virtualcluster": vc.Name,
	})
	if len(ownerRefs) > 0 {
		gwApi.SetOwnerReferences(ownerRefs)
	}
	gwApi.Object["spec"] = map[string]interface{}{
		"selector": gwSelector,
		"servers": []interface{}{
			map[string]interface{}{
				"port": map[string]interface{}{
					"number":   int64(443),
					"name":     "https-api",
					"protocol": "TLS",
				},
				"hosts": []interface{}{apiHost},
				"tls": map[string]interface{}{
					"mode": "PASSTHROUGH",
				},
			},
		},
	}
	if err := r.createOrUpdateHostResource(ctx, gwApi); err != nil {
		return fmt.Errorf("failed reconciling host API Gateway %s: %w", gwApi.GetName(), err)
	}

	// 7. Host vCluster API VirtualService (TLS match sniHosts routing to vCluster API Service)
	apiSvcHost := fmt.Sprintf("%s.%s.svc.%s", vc.Name, vc.Namespace, clusterDomain)
	vsApi := &unstructured.Unstructured{}
	vsApi.SetGroupVersionKind(virtualServiceGVK)
	vsApi.SetName(fmt.Sprintf("%s-api-entrypoint", vc.Name))
	vsApi.SetNamespace(vc.Namespace)
	vsApi.SetLabels(map[string]string{
		"app.kubernetes.io/managed-by":  "vcop-operator",
		"app.kubernetes.io/part-of":     "istio",
		"vcop.gitops.io/virtualcluster": vc.Name,
	})
	if len(ownerRefs) > 0 {
		vsApi.SetOwnerReferences(ownerRefs)
	}
	vsApi.Object["spec"] = map[string]interface{}{
		"gateways": []interface{}{apiGwName},
		"hosts":    []interface{}{apiHost},
		"tls": []interface{}{
			map[string]interface{}{
				"match": []interface{}{
					map[string]interface{}{
						"port":     int64(443),
						"sniHosts": []interface{}{apiHost},
					},
				},
				"route": []interface{}{
					map[string]interface{}{
						"destination": map[string]interface{}{
							"host": apiSvcHost,
							"port": map[string]interface{}{
								"number": int64(443),
							},
						},
					},
				},
			},
		},
	}
	if err := r.createOrUpdateHostResource(ctx, vsApi); err != nil {
		return fmt.Errorf("failed reconciling host API VirtualService %s: %w", vsApi.GetName(), err)
	}

	return nil
}

func (r *IstioReconciler) createOrUpdateHostResource(ctx context.Context, obj *unstructured.Unstructured) error {
	existing := &unstructured.Unstructured{}
	existing.SetGroupVersionKind(obj.GroupVersionKind())
	err := r.hostClient.Get(ctx, types.NamespacedName{
		Name:      obj.GetName(),
		Namespace: obj.GetNamespace(),
	}, existing)

	if apierrors.IsNotFound(err) {
		if err := r.hostClient.Create(ctx, obj); err != nil {
			if apierrors.IsAlreadyExists(err) {
				if getErr := r.hostClient.Get(ctx, types.NamespacedName{
					Name:      obj.GetName(),
					Namespace: obj.GetNamespace(),
				}, existing); getErr == nil {
					existing.SetLabels(obj.GetLabels())
					if len(obj.GetOwnerReferences()) > 0 {
						existing.SetOwnerReferences(obj.GetOwnerReferences())
					}
					existing.Object["spec"] = obj.Object["spec"]
					return r.hostClient.Update(ctx, existing)
				}
			}
			return err
		}
		return nil
	} else if err == nil {
		existing.SetLabels(obj.GetLabels())
		if len(obj.GetOwnerReferences()) > 0 {
			existing.SetOwnerReferences(obj.GetOwnerReferences())
		}
		existing.Object["spec"] = obj.Object["spec"]
		return r.hostClient.Update(ctx, existing)
	}
	return err
}

func (r *IstioReconciler) cleanupHostRouting(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	resources := []struct {
		gvk  schema.GroupVersionKind
		name string
		ns   string
	}{
		{destinationRuleGVK, fmt.Sprintf("%s-guest-gateway", vc.Name), vc.Namespace},
		{virtualServiceGVK, fmt.Sprintf("%s-host-entrypoint", vc.Name), vc.Namespace},
		{gatewayGVK, fmt.Sprintf("%s-api-gateway", vc.Name), vc.Namespace},
		{gatewayGVK, fmt.Sprintf("%s-api-gateway", vc.Name), "istio-system"},
		{virtualServiceGVK, fmt.Sprintf("%s-api-entrypoint", vc.Name), vc.Namespace},
		{virtualServiceGVK, fmt.Sprintf("%s-api-entrypoint", vc.Name), "istio-system"},
	}

	for _, res := range resources {
		u := &unstructured.Unstructured{}
		u.SetGroupVersionKind(res.gvk)
		u.SetName(res.name)
		u.SetNamespace(res.ns)
		err := r.hostClient.Delete(ctx, u)
		if err != nil && !apierrors.IsNotFound(err) && !meta.IsNoMatchError(err) {
			// ignore not found or missing CRD
		}
	}
	return nil
}

// CleanupAllIstio cleans up all host routing resources, cert-manager certificates, TLS secrets, and in-guest Istio resources
func (r *IstioReconciler) CleanupAllIstio(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	_ = r.cleanupHostRouting(ctx, vc)

	// Clean up cert-manager Certificate on host
	certGVK := schema.GroupVersionKind{
		Group:   "cert-manager.io",
		Version: "v1",
		Kind:    "Certificate",
	}
	certU := &unstructured.Unstructured{}
	certU.SetGroupVersionKind(certGVK)
	certU.SetName(fmt.Sprintf("%s-ingress-cert", vc.Name))
	certU.SetNamespace(vc.Namespace)
	_ = r.hostClient.Delete(ctx, certU)

	// Clean up TLS secret on host
	tlsSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-tls", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.hostClient.Delete(ctx, tlsSec)

	// Clean up in-guest Istio components if cluster is reachable
	if r.addonsRec != nil {
		vClient, dynClient, err := r.addonsRec.GetVirtualClusterClients(ctx, vc)
		if err == nil && vClient != nil {
			_ = r.cleanupGuestIstioResources(ctx, vc, vClient, dynClient)
		}
	}

	return nil
}

func (r *IstioReconciler) cleanupGuestIstioResources(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client, dynClient dynamic.Interface) error {
	// 1. Delete in-guest Deployments immediately with background propagation so pods terminate
	depNames := []string{"istio-ingressgateway", "istiod"}
	for _, name := range depNames {
		dep := &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name:      name,
				Namespace: "istio-system",
			},
		}
		_ = vClient.Delete(ctx, dep, client.PropagationPolicy(metav1.DeletePropagationBackground))
	}

	// 2. Delete in-guest Services
	svcNames := []string{"istio-ingressgateway", "istiod"}
	for _, name := range svcNames {
		svc := &corev1.Service{
			ObjectMeta: metav1.ObjectMeta{
				Name:      name,
				Namespace: "istio-system",
			},
		}
		_ = vClient.Delete(ctx, svc)
	}

	// 3. Delete in-guest Gateways & VirtualServices
	if dynClient != nil {
		_ = dynClient.Resource(gatewayGVR).Namespace("istio-system").Delete(ctx, "default-gateway", metav1.DeleteOptions{})
		_ = dynClient.Resource(virtualServiceGVR).Namespace("istio-system").Delete(ctx, "main-entrypoint", metav1.DeleteOptions{})
	}

	// 4. Delete cluster-scoped RBAC
	_ = vClient.Delete(ctx, &rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "istiod-clusterrolebinding"}})
	_ = vClient.Delete(ctx, &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "istiod-clusterrole"}})

	// 5. Delete guest namespace istio-system
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "istio-system",
		},
	}
	_ = vClient.Delete(ctx, ns, client.PropagationPolicy(metav1.DeletePropagationBackground))

	return nil
}
