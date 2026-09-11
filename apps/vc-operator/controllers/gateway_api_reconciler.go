package controllers

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
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
	gwApiGatewayClassGVK = schema.GroupVersionKind{
		Group:   "gateway.networking.k8s.io",
		Version: "v1",
		Kind:    "GatewayClass",
	}
	gwApiGatewayClassGVR = schema.GroupVersionResource{
		Group:    "gateway.networking.k8s.io",
		Version:  "v1",
		Resource: "gatewayclasses",
	}
	gwApiGatewayGVK = schema.GroupVersionKind{
		Group:   "gateway.networking.k8s.io",
		Version: "v1",
		Kind:    "Gateway",
	}
	gwApiGatewayGVR = schema.GroupVersionResource{
		Group:    "gateway.networking.k8s.io",
		Version:  "v1",
		Resource: "gateways",
	}
	gwApiHTTPRouteGVK = schema.GroupVersionKind{
		Group:   "gateway.networking.k8s.io",
		Version: "v1",
		Kind:    "HTTPRoute",
	}
	gwApiHTTPRouteGVR = schema.GroupVersionResource{
		Group:    "gateway.networking.k8s.io",
		Version:  "v1",
		Resource: "httproutes",
	}
	gwApiBackendTLSPolicyGVK = schema.GroupVersionKind{
		Group:   "gateway.networking.k8s.io",
		Version: "v1",
		Kind:    "BackendTLSPolicy",
	}
	gwApiBackendTLSPolicyGVR = schema.GroupVersionResource{
		Group:    "gateway.networking.k8s.io",
		Version:  "v1",
		Resource: "backendtlspolicies",
	}
)

type GatewayAPIReconciler struct {
	hostClient client.Client
	addonsRec  *AddonsReconciler
}

func NewGatewayAPIReconciler(hostClient client.Client, addonsRec *AddonsReconciler) *GatewayAPIReconciler {
	return &GatewayAPIReconciler{
		hostClient: hostClient,
		addonsRec:  addonsRec,
	}
}

// ExtractClusterHost resolves primary FQDN / host to use for the entrypoint
func (r *GatewayAPIReconciler) ExtractClusterHost(vc *v1alpha1.VirtualCluster) string {
	if vc.Spec.Components.GatewayAPI != nil && len(vc.Spec.Components.GatewayAPI.Hosts) > 0 {
		for _, h := range vc.Spec.Components.GatewayAPI.Hosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !strings.HasPrefix(trimmed, "*.") {
				return trimmed
			}
		}
		if vc.Spec.Components.GatewayAPI.Hosts[0] != "" {
			return strings.TrimPrefix(strings.TrimSpace(vc.Spec.Components.GatewayAPI.Hosts[0]), "*.")
		}
	}
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
func (r *GatewayAPIReconciler) ValidateCertManagerIssuer(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	if vc.Spec.Components.GatewayAPI == nil || vc.Spec.Components.GatewayAPI.CertificateIssuer == "" {
		return nil
	}

	issuerName := strings.TrimSpace(vc.Spec.Components.GatewayAPI.CertificateIssuer)
	issuerKind := vc.Spec.Components.GatewayAPI.CertificateIssuerKind
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

// GetGatewayProxyReplicas computes replica count for the gateway proxy.
func (r *GatewayAPIReconciler) GetGatewayProxyReplicas(vc *v1alpha1.VirtualCluster) int32 {
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.Replicas != nil {
		return *vc.Spec.Components.GatewayAPI.Replicas
	}
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.GatewayConfig != nil && vc.Spec.Components.GatewayAPI.GatewayConfig.Replicas != nil {
		return *vc.Spec.Components.GatewayAPI.GatewayConfig.Replicas
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

// ReconcileGatewayAPI manages the full lifecycle of Kubernetes Gateway API inside the virtual cluster
func (r *GatewayAPIReconciler) ReconcileGatewayAPI(ctx context.Context, vc *v1alpha1.VirtualCluster) (bool, error) {
	if vc.Spec.Components.GatewayAPI == nil || !vc.Spec.Components.GatewayAPI.Enabled {
		_ = r.CleanupGuestGatewayAPI(ctx, vc)
		return true, nil
	}

	// 1. Validate Cert-Manager Issuer on Host (non-fatal warning if missing)
	issuerValid := true
	if err := r.ValidateCertManagerIssuer(ctx, vc); err != nil {
		issuerValid = false
	}

	// 2. Connect to the Virtual Cluster
	vClient, dynClient, err := r.addonsRec.GetVirtualClusterClients(ctx, vc)
	if err != nil {
		return false, fmt.Errorf("cannot connect to virtual cluster: %w", err)
	}

	// 3. Ensure namespace gateway-system exists in guest cluster
	gwNs := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "gateway-system",
			Labels: map[string]string{
				"app.kubernetes.io/part-of": "gateway-api",
			},
		},
	}
	if err := vClient.Create(ctx, gwNs); err != nil && !apierrors.IsAlreadyExists(err) {
		return false, fmt.Errorf("failed creating namespace gateway-system: %w", err)
	}

	// 4. Reconcile Host Certificate & Sync TLS Secret to Guest
	tlsSecretName := vc.Spec.Components.GatewayAPI.CertSecretName
	if tlsSecretName == "" {
		tlsSecretName = fmt.Sprintf("%s-gateway-tls", vc.Name)
	}
	hostFQDN := r.ExtractClusterHost(vc)

	if issuerValid && vc.Spec.Components.GatewayAPI.CertificateIssuer != "" {
		if err := r.reconcileHostCertificate(ctx, vc, tlsSecretName, hostFQDN); err != nil {
			// Non-fatal if cert issuance is in progress
		}
	}
	_ = r.reconcileGuestTlsSecret(ctx, vc, vClient, tlsSecretName, hostFQDN)

	// 5. Ensure Gateway API CRDs exist inside Guest Cluster
	if err := r.reconcileCRDs(ctx, dynClient); err != nil {
		return false, fmt.Errorf("failed reconciling Gateway API CRDs: %w", err)
	}

	// 6. Reconcile GatewayClass inside Guest Cluster
	gatewayClassName := vc.Spec.Components.GatewayAPI.GatewayClassName
	if gatewayClassName == "" {
		gatewayClassName = "eg"
	}
	if err := r.reconcileGatewayClass(ctx, dynClient, gatewayClassName); err != nil {
		return false, fmt.Errorf("failed reconciling GatewayClass %s: %w", gatewayClassName, err)
	}

	// 7. Reconcile gateway-proxy inside Guest Cluster (Envoy proxy entrypoint)
	if err := r.reconcileGatewayProxy(ctx, vc, vClient); err != nil {
		return false, fmt.Errorf("failed reconciling gateway-proxy: %w", err)
	}

	// 8. Reconcile Guest Gateway (HTTP 80 -> HTTPS 443 upgrade, HTTPS 443 TLS)
	if err := r.reconcileGuestGateway(ctx, vc, dynClient, gatewayClassName, tlsSecretName, hostFQDN); err != nil {
		return false, fmt.Errorf("failed reconciling guest gateway: %w", err)
	}

	// 9. Reconcile Guest HTTPRoute (Main Application Entrypoint)
	if err := r.reconcileGuestHTTPRoute(ctx, vc, dynClient, hostFQDN); err != nil {
		return false, fmt.Errorf("failed reconciling guest HTTPRoute: %w", err)
	}

	// 10. Reconcile Host-level Routing (Unified Host Ingress for Gateway API & Istio)
	if err := r.ReconcileUnifiedHostRouting(ctx, vc); err != nil {
		return false, fmt.Errorf("failed reconciling unified host routing: %w", err)
	}

	return true, nil
}

func (r *GatewayAPIReconciler) reconcileHostCertificate(ctx context.Context, vc *v1alpha1.VirtualCluster, tlsSecretName, hostFQDN string) error {
	certName := fmt.Sprintf("%s-gateway-cert", vc.Name)
	issuerName := strings.TrimSpace(vc.Spec.Components.GatewayAPI.CertificateIssuer)
	issuerKind := vc.Spec.Components.GatewayAPI.CertificateIssuerKind
	if issuerKind == "" {
		issuerKind = "ClusterIssuer"
	}

	u := &unstructured.Unstructured{}
	u.SetGroupVersionKind(certificateGVK)
	u.SetName(certName)
	u.SetNamespace(vc.Namespace)

	var dnsList []interface{}
	if vc.Spec.Components.GatewayAPI != nil && len(vc.Spec.Components.GatewayAPI.Hosts) > 0 {
		seen := make(map[string]bool)
		for _, h := range vc.Spec.Components.GatewayAPI.Hosts {
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
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.HostRouting != nil {
		apiHost := strings.TrimSpace(vc.Spec.Components.GatewayAPI.HostRouting.ApiHost)
		if apiHost != "" {
			dnsList = append(dnsList, apiHost)
		}
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

func (r *GatewayAPIReconciler) reconcileGuestTlsSecret(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client, tlsSecretName, hostFQDN string) error {
	hostSecret := &corev1.Secret{}
	err := r.hostClient.Get(ctx, types.NamespacedName{Name: tlsSecretName, Namespace: vc.Namespace}, hostSecret)
	if err == nil && len(hostSecret.Data["tls.crt"]) > 0 && len(hostSecret.Data["tls.key"]) > 0 {
		guestSecret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      tlsSecretName,
				Namespace: "gateway-system",
				Labels: map[string]string{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			Type: hostSecret.Type,
			Data: hostSecret.Data,
		}
		existingGuestSecret := &corev1.Secret{}
		getErr := vClient.Get(ctx, types.NamespacedName{Name: tlsSecretName, Namespace: "gateway-system"}, existingGuestSecret)
		if apierrors.IsNotFound(getErr) {
			return vClient.Create(ctx, guestSecret)
		} else if getErr == nil {
			existingGuestSecret.Data = hostSecret.Data
			existingGuestSecret.Type = hostSecret.Type
			return vClient.Update(ctx, existingGuestSecret)
		}
		return getErr
	}

	// If host secret is not ready yet, bootstrap a self-signed fallback in guest cluster
	existingGuestSecret := &corev1.Secret{}
	getErr := vClient.Get(ctx, types.NamespacedName{Name: tlsSecretName, Namespace: "gateway-system"}, existingGuestSecret)
	if apierrors.IsNotFound(getErr) {
		certPEM, keyPEM, genErr := generateSelfSignedCert(hostFQDN)
		if genErr != nil {
			return genErr
		}
		guestSecret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      tlsSecretName,
				Namespace: "gateway-system",
				Labels: map[string]string{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			Type: corev1.SecretTypeTLS,
			Data: map[string][]byte{
				corev1.TLSCertKey:       certPEM,
				corev1.TLSPrivateKeyKey: keyPEM,
			},
		}
		return vClient.Create(ctx, guestSecret)
	}
	return nil
}

func generateSelfSignedCert(commonName string) ([]byte, []byte, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	notBefore := time.Now()
	notAfter := notBefore.Add(365 * 24 * time.Hour)
	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, err
	}
	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   commonName,
			Organization: []string{"vCOp Virtual Cluster Gateway"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{commonName, "*.local", "localhost"},
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return nil, nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return nil, nil, err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
	return certPEM, keyPEM, nil
}

func (r *GatewayAPIReconciler) reconcileCRDs(ctx context.Context, dyn dynamic.Interface) error {
	crds := []struct {
		name     string
		kind     string
		plural   string
		singular string
		short    string
		scope    string
	}{
		{
			name:     "gatewayclasses.gateway.networking.k8s.io",
			kind:     "GatewayClass",
			plural:   "gatewayclasses",
			singular: "gatewayclass",
			short:    "gc",
			scope:    "Cluster",
		},
		{
			name:     "gateways.gateway.networking.k8s.io",
			kind:     "Gateway",
			plural:   "gateways",
			singular: "gateway",
			short:    "gtw",
			scope:    "Namespaced",
		},
		{
			name:     "httproutes.gateway.networking.k8s.io",
			kind:     "HTTPRoute",
			plural:   "httproutes",
			singular: "httproute",
			short:    "hr",
			scope:    "Namespaced",
		},
		{
			name:     "referencegrants.gateway.networking.k8s.io",
			kind:     "ReferenceGrant",
			plural:   "referencegrants",
			singular: "referencegrant",
			short:    "refgrant",
			scope:    "Namespaced",
		},
		{
			name:     "tlsroutes.gateway.networking.k8s.io",
			kind:     "TLSRoute",
			plural:   "tlsroutes",
			singular: "tlsroute",
			short:    "tlsroute",
			scope:    "Namespaced",
		},
		{
			name:     "tcproutes.gateway.networking.k8s.io",
			kind:     "TCPRoute",
			plural:   "tcproutes",
			singular: "tcproute",
			short:    "tcproute",
			scope:    "Namespaced",
		},
		{
			name:     "grpcroutes.gateway.networking.k8s.io",
			kind:     "GRPCRoute",
			plural:   "grpcroutes",
			singular: "grpcroute",
			short:    "grpcroute",
			scope:    "Namespaced",
		},
	}

	for _, c := range crds {
		crd := &unstructured.Unstructured{
			Object: map[string]interface{}{
				"apiVersion": "apiextensions.k8s.io/v1",
				"kind":       "CustomResourceDefinition",
				"metadata": map[string]interface{}{
					"name": c.name,
					"annotations": map[string]interface{}{
						"api-approved.kubernetes.io": "https://github.com/kubernetes-sigs/gateway-api/pull/4530",
					},
					"labels": map[string]interface{}{
						"app.kubernetes.io/part-of": "gateway-api",
					},
				},
				"spec": map[string]interface{}{
					"group": "gateway.networking.k8s.io",
					"names": map[string]interface{}{
						"kind":       c.kind,
						"listKind":   c.kind + "List",
						"plural":     c.plural,
						"singular":   c.singular,
						"shortNames": []interface{}{c.short},
					},
					"scope": c.scope,
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
					},
				},
			},
		}

		existingCRD, err := dyn.Resource(crdGVR).Get(ctx, c.name, metav1.GetOptions{})
		if apierrors.IsNotFound(err) {
			_, err = dyn.Resource(crdGVR).Create(ctx, crd, metav1.CreateOptions{})
			if err != nil && !apierrors.IsAlreadyExists(err) {
				return fmt.Errorf("failed creating Gateway API CRD %s: %w", c.name, err)
			}
		} else if err == nil {
			crd.SetResourceVersion(existingCRD.GetResourceVersion())
			_, err = dyn.Resource(crdGVR).Update(ctx, crd, metav1.UpdateOptions{})
			if err != nil && !apierrors.IsConflict(err) {
				return fmt.Errorf("failed updating Gateway API CRD %s: %w", c.name, err)
			}
		}
	}
	return nil
}

func (r *GatewayAPIReconciler) reconcileGatewayClass(ctx context.Context, dyn dynamic.Interface, className string) error {
	gc := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "gateway.networking.k8s.io/v1",
			"kind":       "GatewayClass",
			"metadata": map[string]interface{}{
				"name": className,
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			"spec": map[string]interface{}{
				"controllerName": "gateway.envoyproxy.io/gatewayclass-controller",
			},
		},
	}

	_, err := dyn.Resource(gwApiGatewayClassGVR).Create(ctx, gc, metav1.CreateOptions{})
	if err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}
	return nil
}

func (r *GatewayAPIReconciler) reconcileGatewayProxy(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client) error {
	// 1. Envoy Bootstrap ConfigMap
	envoyYaml := `admin:
  address:
    socket_address:
      address: 127.0.0.1
      port_value: 19001
static_resources:
  listeners:
  - name: listener_http
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 8080
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: ingress_http
          route_config:
            name: http_route
            virtual_hosts:
            - name: http_vhost
              domains: ["*"]
              routes:
              - match:
                  prefix: "/healthz"
                direct_response:
                  status: 200
                  body:
                    inline_string: "OK\n"
              - match:
                  prefix: "/"
                direct_response:
                  status: 200
                  body:
                    inline_string: "vCOp Platform: Virtual Cluster Application Entrypoint (Gateway API) is Healthy and Ready.\n"
          http_filters:
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  - name: listener_https
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 8443
    filter_chains:
    - transport_socket:
        name: envoy.transport_sockets.tls
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
          common_tls_context:
            tls_certificates:
            - certificate_chain:
                filename: /certs/tls.crt
              private_key:
                filename: /certs/tls.key
      filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: ingress_https
          route_config:
            name: https_route
            virtual_hosts:
            - name: https_vhost
              domains: ["*"]
              routes:
              - match:
                  prefix: "/healthz"
                direct_response:
                  status: 200
                  body:
                    inline_string: "OK\n"
              - match:
                  prefix: "/"
                direct_response:
                  status: 200
                  body:
                    inline_string: "vCOp Platform: Virtual Cluster Application Entrypoint (Gateway API) is Healthy and Ready.\n"
          http_filters:
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
`

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy-config",
			Namespace: "gateway-system",
		},
		Data: map[string]string{
			"envoy.yaml": envoyYaml,
		},
	}
	existingCm := &corev1.ConfigMap{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "gateway-proxy-config", Namespace: "gateway-system"}, existingCm); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, cm); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
		if existingCm.Data["envoy.yaml"] != envoyYaml {
			existingCm.Data["envoy.yaml"] = envoyYaml
			_ = vClient.Update(ctx, existingCm)
		}
	}

	// 2. ServiceAccount
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy",
			Namespace: "gateway-system",
		},
	}
	if err := vClient.Create(ctx, sa); err != nil && !apierrors.IsAlreadyExists(err) {
		return err
	}

	// 3. Deployment
	envoyVer := "distroless-v1.39.1"
	if vc.Spec.Components.GatewayAPI != nil && strings.HasPrefix(vc.Spec.Components.GatewayAPI.Version, "distroless-") {
		envoyVer = vc.Spec.Components.GatewayAPI.Version
	}
	proxyImage := registry.GetResolver().RewriteImage(fmt.Sprintf("docker.io/envoyproxy/envoy:%s", envoyVer), vc)
	replicas := r.GetGatewayProxyReplicas(vc)

	tlsSecretName := vc.Spec.Components.GatewayAPI.CertSecretName
	if tlsSecretName == "" {
		tlsSecretName = fmt.Sprintf("%s-gateway-tls", vc.Name)
	}

	gwLabels := map[string]string{
		"app":                         "gateway-proxy",
		"app.kubernetes.io/name":      "gateway-proxy",
		"app.kubernetes.io/component": "gateway",
	}

	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy",
			Namespace: "gateway-system",
			Labels:    gwLabels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: gwLabels,
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: gwLabels,
				},
				Spec: corev1.PodSpec{
					ServiceAccountName: "gateway-proxy",
					Containers: []corev1.Container{
						{
							Name:  "envoy",
							Image: proxyImage,
							Command: []string{
								"envoy",
								"-c",
								"/etc/envoy/envoy.yaml",
								"--log-level",
								"warning",
							},
							Ports: []corev1.ContainerPort{
								{Name: "http", ContainerPort: 8080, Protocol: corev1.ProtocolTCP},
								{Name: "https", ContainerPort: 8443, Protocol: corev1.ProtocolTCP},
								{Name: "admin", ContainerPort: 19001, Protocol: corev1.ProtocolTCP},
							},
							ReadinessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path: "/healthz",
										Port: intstr.FromInt(8080),
									},
								},
								InitialDelaySeconds: 2,
								PeriodSeconds:       5,
							},
							LivenessProbe: &corev1.Probe{
								ProbeHandler: corev1.ProbeHandler{
									HTTPGet: &corev1.HTTPGetAction{
										Path: "/healthz",
										Port: intstr.FromInt(8080),
									},
								},
								InitialDelaySeconds: 5,
								PeriodSeconds:       10,
							},
							Resources: corev1.ResourceRequirements{
								Requests: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("20m"),
									corev1.ResourceMemory: resource.MustParse("64Mi"),
								},
								Limits: corev1.ResourceList{
									corev1.ResourceCPU:    resource.MustParse("250m"),
									corev1.ResourceMemory: resource.MustParse("256Mi"),
								},
							},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:      "envoy-config",
									MountPath: "/etc/envoy",
									ReadOnly:  true,
								},
								{
									Name:      "certs",
									MountPath: "/certs",
									ReadOnly:  true,
								},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "envoy-config",
							VolumeSource: corev1.VolumeSource{
								ConfigMap: &corev1.ConfigMapVolumeSource{
									LocalObjectReference: corev1.LocalObjectReference{
										Name: "gateway-proxy-config",
									},
								},
							},
						},
						{
							Name: "certs",
							VolumeSource: corev1.VolumeSource{
								Secret: &corev1.SecretVolumeSource{
									SecretName: tlsSecretName,
								},
							},
						},
					},
				},
			},
		},
	}

	existingDep := &appsv1.Deployment{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "gateway-proxy", Namespace: "gateway-system"}, existingDep); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, dep); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
		updated := false
		if existingDep.Spec.Replicas == nil || *existingDep.Spec.Replicas != replicas {
			existingDep.Spec.Replicas = &replicas
			updated = true
		}
		if len(existingDep.Spec.Template.Spec.Containers) > 0 {
			cExisting := existingDep.Spec.Template.Spec.Containers[0]
			cNew := dep.Spec.Template.Spec.Containers[0]
			if cExisting.Image != cNew.Image || !cExisting.Resources.Limits.Cpu().Equal(*cNew.Resources.Limits.Cpu()) {
				existingDep.Spec.Template = dep.Spec.Template
				updated = true
			}
		}
		if updated {
			if err := vClient.Update(ctx, existingDep); err != nil && !apierrors.IsConflict(err) {
				return err
			}
		}
	}

	// 4. Service (synced to host)
	svcType := corev1.ServiceTypeClusterIP
	if vc.Spec.Components.GatewayAPI.GatewayConfig != nil && vc.Spec.Components.GatewayAPI.GatewayConfig.ServiceType != "" {
		svcType = corev1.ServiceType(vc.Spec.Components.GatewayAPI.GatewayConfig.ServiceType)
	}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy",
			Namespace: "gateway-system",
			Labels:    gwLabels,
		},
		Spec: corev1.ServiceSpec{
			Type:     svcType,
			Selector: gwLabels,
			Ports: []corev1.ServicePort{
				{Name: "http", Port: 80, TargetPort: intstr.FromInt(8080)},
				{Name: "https", Port: 443, TargetPort: intstr.FromInt(8443)},
			},
		},
	}
	existingSvc := &corev1.Service{}
	if err := vClient.Get(ctx, types.NamespacedName{Name: "gateway-proxy", Namespace: "gateway-system"}, existingSvc); apierrors.IsNotFound(err) {
		if err := vClient.Create(ctx, svc); err != nil && !apierrors.IsAlreadyExists(err) {
			return err
		}
	} else if err == nil {
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

func (r *GatewayAPIReconciler) reconcileGuestGateway(ctx context.Context, vc *v1alpha1.VirtualCluster, dyn dynamic.Interface, gatewayClassName, tlsSecretName, hostFQDN string) error {
	gw := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "gateway.networking.k8s.io/v1",
			"kind":       "Gateway",
			"metadata": map[string]interface{}{
				"name":      "default-gateway",
				"namespace": "gateway-system",
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			"spec": map[string]interface{}{
				"gatewayClassName": gatewayClassName,
				"listeners": []interface{}{
					map[string]interface{}{
						"name":     "http",
						"port":     int64(80),
						"protocol": "HTTP",
						"allowedRoutes": map[string]interface{}{
							"namespaces": map[string]interface{}{
								"from": "All",
							},
						},
					},
					map[string]interface{}{
						"name":     "https",
						"port":     int64(443),
						"protocol": "HTTPS",
						"tls": map[string]interface{}{
							"mode": "Terminate",
							"certificateRefs": []interface{}{
								map[string]interface{}{
									"name": tlsSecretName,
								},
							},
						},
						"allowedRoutes": map[string]interface{}{
							"namespaces": map[string]interface{}{
								"from": "All",
							},
						},
					},
				},
			},
		},
	}

	_, err := dyn.Resource(gwApiGatewayGVR).Namespace("gateway-system").Create(ctx, gw, metav1.CreateOptions{})
	if err != nil {
		if apierrors.IsAlreadyExists(err) {
			existing, getErr := dyn.Resource(gwApiGatewayGVR).Namespace("gateway-system").Get(ctx, "default-gateway", metav1.GetOptions{})
			if getErr == nil {
				existing.Object["spec"] = gw.Object["spec"]
				_, _ = dyn.Resource(gwApiGatewayGVR).Namespace("gateway-system").Update(ctx, existing, metav1.UpdateOptions{})
			}
		} else {
			return err
		}
	}
	return nil
}

func (r *GatewayAPIReconciler) reconcileGuestHTTPRoute(ctx context.Context, vc *v1alpha1.VirtualCluster, dyn dynamic.Interface, hostFQDN string) error {
	var hostList []interface{}
	if vc.Spec.Components.GatewayAPI != nil && len(vc.Spec.Components.GatewayAPI.Hosts) > 0 {
		seen := make(map[string]bool)
		for _, h := range vc.Spec.Components.GatewayAPI.Hosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !seen[trimmed] {
				seen[trimmed] = true
				hostList = append(hostList, trimmed)
			}
		}
	}
	if len(hostList) == 0 && hostFQDN != "" {
		hostList = append(hostList, hostFQDN)
	}

	route := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "gateway.networking.k8s.io/v1",
			"kind":       "HTTPRoute",
			"metadata": map[string]interface{}{
				"name":      "main-entrypoint",
				"namespace": "gateway-system",
				"labels": map[string]interface{}{
					"app.kubernetes.io/managed-by": "vcop-operator",
				},
			},
			"spec": map[string]interface{}{
				"parentRefs": []interface{}{
					map[string]interface{}{
						"name":        "default-gateway",
						"sectionName": "https",
					},
				},
				"hostnames": hostList,
				"rules": []interface{}{
					map[string]interface{}{
						"matches": []interface{}{
							map[string]interface{}{
								"path": map[string]interface{}{
									"type":  "PathPrefix",
									"value": "/",
								},
							},
						},
						"backendRefs": []interface{}{
							map[string]interface{}{
								"name": "gateway-proxy",
								"port": int64(80),
							},
						},
					},
				},
			},
		},
	}

	_, err := dyn.Resource(gwApiHTTPRouteGVR).Namespace("gateway-system").Create(ctx, route, metav1.CreateOptions{})
	if err != nil {
		if apierrors.IsAlreadyExists(err) {
			existing, getErr := dyn.Resource(gwApiHTTPRouteGVR).Namespace("gateway-system").Get(ctx, "main-entrypoint", metav1.GetOptions{})
			if getErr == nil {
				existing.Object["spec"] = route.Object["spec"]
				_, _ = dyn.Resource(gwApiHTTPRouteGVR).Namespace("gateway-system").Update(ctx, existing, metav1.UpdateOptions{})
			}
		} else {
			return err
		}
	}
	return nil
}

// resolveHostDefaultGateway splits namespace and name for the host gateway, auto-detecting if empty.
func (r *GatewayAPIReconciler) resolveHostDefaultGateway(ctx context.Context, configured string) (string, string) {
	trimmed := strings.TrimSpace(configured)
	if trimmed != "" && !strings.HasPrefix(trimmed, "istio-system") {
		var gwNs, gwName string
		if parts := strings.Split(trimmed, "/"); len(parts) == 2 {
			gwNs, gwName = parts[0], parts[1]
		} else {
			gwNs, gwName = "envoy-gateway-system", trimmed
		}
		gw := &unstructured.Unstructured{}
		gw.SetGroupVersionKind(schema.GroupVersionKind{
			Group:   "gateway.networking.k8s.io",
			Version: "v1",
			Kind:    "Gateway",
		})
		if err := r.hostClient.Get(ctx, types.NamespacedName{Namespace: gwNs, Name: gwName}, gw); err == nil {
			return gwNs, gwName
		}
	}

	// Auto-detect any running Gateway in envoy-gateway-system or host cluster
	gwList := &unstructured.UnstructuredList{}
	gwList.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "gateway.networking.k8s.io",
		Version: "v1",
		Kind:    "GatewayList",
	})
	if err := r.hostClient.List(ctx, gwList); err == nil && len(gwList.Items) > 0 {
		for _, item := range gwList.Items {
			if item.GetNamespace() == "envoy-gateway-system" && item.GetName() == "eg" {
				return item.GetNamespace(), item.GetName()
			}
		}
		for _, item := range gwList.Items {
			if item.GetNamespace() == "envoy-gateway-system" {
				return item.GetNamespace(), item.GetName()
			}
		}
		return gwList.Items[0].GetNamespace(), gwList.Items[0].GetName()
	}

	return "envoy-gateway-system", "eg"
}

// ReconcileUnifiedHostRouting dynamically routes host ingress traffic to whichever
// guest entrypoint (Gateway API or Istio) is currently enabled in the virtual cluster,
// while keeping the vCluster API route (api.<cluster>.local) always active.
func (r *GatewayAPIReconciler) ReconcileUnifiedHostRouting(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	isHostRoutingEnabled := false
	var configuredGw, configuredApiHost string

	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.HostRouting != nil && vc.Spec.Components.GatewayAPI.HostRouting.Enabled {
		isHostRoutingEnabled = true
		configuredGw = vc.Spec.Components.GatewayAPI.HostRouting.DefaultGateway
		configuredApiHost = vc.Spec.Components.GatewayAPI.HostRouting.ApiHost
	}
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.HostRouting != nil && vc.Spec.Components.Istio.HostRouting.Enabled {
		isHostRoutingEnabled = true
		if configuredGw == "" {
			configuredGw = vc.Spec.Components.Istio.HostRouting.DefaultGateway
		}
		if configuredApiHost == "" {
			configuredApiHost = vc.Spec.Components.Istio.HostRouting.ApiHost
		}
	}

	if !isHostRoutingEnabled {
		_ = r.cleanupHostRouting(ctx, vc)
		return nil
	}

	hostFQDN := r.ExtractClusterHost(vc)
	return r.reconcileHostRoutingWithConfig(ctx, vc, hostFQDN, configuredGw, configuredApiHost)
}

func (r *GatewayAPIReconciler) reconcileHostRouting(ctx context.Context, vc *v1alpha1.VirtualCluster, hostFQDN string) error {
	var configuredGw, configuredApiHost string
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.HostRouting != nil {
		configuredGw = vc.Spec.Components.GatewayAPI.HostRouting.DefaultGateway
		configuredApiHost = vc.Spec.Components.GatewayAPI.HostRouting.ApiHost
	} else if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.HostRouting != nil {
		configuredGw = vc.Spec.Components.Istio.HostRouting.DefaultGateway
		configuredApiHost = vc.Spec.Components.Istio.HostRouting.ApiHost
	}
	return r.reconcileHostRoutingWithConfig(ctx, vc, hostFQDN, configuredGw, configuredApiHost)
}

func (r *GatewayAPIReconciler) reconcileHostRoutingWithConfig(ctx context.Context, vc *v1alpha1.VirtualCluster, hostFQDN, configuredGw, configuredApiHost string) error {

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

	gwNs, gwName := r.resolveHostDefaultGateway(ctx, configuredGw)

	// Resolve target service synced from guest cluster (supports both Gateway API and Istio)
	var targetHostSvcName string
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.Enabled {
		svcList := &corev1.ServiceList{}
		if err := r.hostClient.List(ctx, svcList, client.InNamespace(vc.Namespace), client.MatchingLabels{
			"vcluster.loft.sh/managed-by": vc.Name,
			"vcluster.loft.sh/namespace":  "gateway-system",
		}); err == nil && len(svcList.Items) > 0 {
			targetHostSvcName = svcList.Items[0].Name
		} else {
			targetHostSvcName = fmt.Sprintf("gateway-proxy-x-gateway-system-x-%s", vc.Name)
		}
	} else if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Enabled {
		svcList := &corev1.ServiceList{}
		if err := r.hostClient.List(ctx, svcList, client.InNamespace(vc.Namespace), client.MatchingLabels{
			"vcluster.loft.sh/managed-by": vc.Name,
			"vcluster.loft.sh/namespace":  "istio-system",
			"app":                         "istio-ingressgateway",
		}); err == nil && len(svcList.Items) > 0 {
			targetHostSvcName = svcList.Items[0].Name
		} else {
			targetHostSvcName = fmt.Sprintf("istio-ingressgateway-x-istio-system-x-%s", vc.Name)
		}
	}

	if targetHostSvcName != "" {
		// Resolve application hosts
		var appHosts []interface{}
		seen := make(map[string]bool)
		var rawHosts []string
		if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.Enabled && len(vc.Spec.Components.GatewayAPI.Hosts) > 0 {
			rawHosts = vc.Spec.Components.GatewayAPI.Hosts
		} else if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Enabled && len(vc.Spec.Components.Istio.Hosts) > 0 {
			rawHosts = vc.Spec.Components.Istio.Hosts
		}
		for _, h := range rawHosts {
			trimmed := strings.TrimSpace(h)
			if trimmed != "" && !seen[trimmed] {
				seen[trimmed] = true
				appHosts = append(appHosts, trimmed)
			}
		}
		if len(appHosts) == 0 && hostFQDN != "" {
			appHosts = append(appHosts, hostFQDN)
		}

		// 1. Host HTTP 80 -> HTTPS 443 Redirect HTTPRoute
		redirectRoute := &unstructured.Unstructured{}
		redirectRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
		redirectRoute.SetName(fmt.Sprintf("%s-redirect", vc.Name))
		redirectRoute.SetNamespace(vc.Namespace)
		redirectRoute.SetLabels(map[string]string{
			"app.kubernetes.io/managed-by":  "vcop-operator",
			"app.kubernetes.io/part-of":     "gateway-api",
			"vcop.gitops.io/virtualcluster": vc.Name,
		})
		if len(ownerRefs) > 0 {
			redirectRoute.SetOwnerReferences(ownerRefs)
		}
		redirectRoute.Object["spec"] = map[string]interface{}{
			"parentRefs": []interface{}{
				map[string]interface{}{
					"name":        gwName,
					"namespace":   gwNs,
					"sectionName": "http",
				},
			},
			"hostnames": appHosts,
			"rules": []interface{}{
				map[string]interface{}{
					"filters": []interface{}{
						map[string]interface{}{
							"type": "RequestRedirect",
							"requestRedirect": map[string]interface{}{
								"scheme":     "https",
								"statusCode": int64(301),
							},
						},
					},
				},
			},
		}
		if err := r.createOrUpdateHostResource(ctx, redirectRoute); err != nil {
			return fmt.Errorf("failed reconciling host redirect HTTPRoute: %w", err)
		}

		// 2. Host HTTPS 443 Application HTTPRoute
		appRoute := &unstructured.Unstructured{}
		appRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
		appRoute.SetName(fmt.Sprintf("%s-route", vc.Name))
		appRoute.SetNamespace(vc.Namespace)
		appRoute.SetLabels(map[string]string{
			"app.kubernetes.io/managed-by":  "vcop-operator",
			"app.kubernetes.io/part-of":     "gateway-api",
			"vcop.gitops.io/virtualcluster": vc.Name,
		})
		if len(ownerRefs) > 0 {
			appRoute.SetOwnerReferences(ownerRefs)
		}
		appRoute.Object["spec"] = map[string]interface{}{
			"parentRefs": []interface{}{
				map[string]interface{}{
					"name":        gwName,
					"namespace":   gwNs,
					"sectionName": "https",
				},
			},
			"hostnames": appHosts,
			"rules": []interface{}{
				map[string]interface{}{
					"matches": []interface{}{
						map[string]interface{}{
							"path": map[string]interface{}{
								"type":  "PathPrefix",
								"value": "/",
							},
						},
					},
					"backendRefs": []interface{}{
						map[string]interface{}{
							"name": targetHostSvcName,
							"port": int64(80),
						},
					},
				},
			},
		}
		if err := r.createOrUpdateHostResource(ctx, appRoute); err != nil {
			return fmt.Errorf("failed reconciling host app HTTPRoute: %w", err)
		}
	} else {
		_ = r.cleanupAppRoutes(ctx, vc)
	}

	// 3. Optional Host vCluster API Routing (via HTTPRoute)
	apiHost := strings.TrimSpace(configuredApiHost)
	if apiHost == "" {
		if hostFQDN != "" {
			apiHost = fmt.Sprintf("api.%s", hostFQDN)
		} else {
			apiHost = fmt.Sprintf("api.%s.local", vc.Name)
		}
	}

	if apiHost != "" {
		apiRoute := &unstructured.Unstructured{}
		apiRoute.SetGroupVersionKind(gwApiHTTPRouteGVK)
		apiRoute.SetName(fmt.Sprintf("%s-api-route", vc.Name))
		apiRoute.SetNamespace(vc.Namespace)
		apiRoute.SetLabels(map[string]string{
			"app.kubernetes.io/managed-by":  "vcop-operator",
			"app.kubernetes.io/part-of":     "gateway-api",
			"vcop.gitops.io/virtualcluster": vc.Name,
		})
		if len(ownerRefs) > 0 {
			apiRoute.SetOwnerReferences(ownerRefs)
		}
		apiRoute.Object["spec"] = map[string]interface{}{
			"parentRefs": []interface{}{
				map[string]interface{}{
					"name":        gwName,
					"namespace":   gwNs,
					"sectionName": "https",
				},
			},
			"hostnames": []interface{}{apiHost},
			"rules": []interface{}{
				map[string]interface{}{
					"matches": []interface{}{
						map[string]interface{}{
							"path": map[string]interface{}{
								"type":  "PathPrefix",
								"value": "/",
							},
						},
					},
					"backendRefs": []interface{}{
						map[string]interface{}{
							"name": vc.Name,
							"port": int64(443),
						},
					},
				},
			},
		}
		_ = r.createOrUpdateHostResource(ctx, apiRoute)

		// 4. Reconcile BackendTLSPolicy and CA ConfigMap so Envoy initiates TLS to the Kubernetes API server
		_ = r.reconcileApiBackendTLS(ctx, vc, ownerRefs)
	}

	return nil
}

func (r *GatewayAPIReconciler) reconcileApiBackendTLS(ctx context.Context, vc *v1alpha1.VirtualCluster, ownerRefs []metav1.OwnerReference) error {
	caCmName := fmt.Sprintf("%s-apiserver-ca", vc.Name)

	var caBytes []byte
	certsSec := &corev1.Secret{}
	if err := r.hostClient.Get(ctx, types.NamespacedName{Name: fmt.Sprintf("%s-certs", vc.Name), Namespace: vc.Namespace}, certsSec); err == nil {
		if b, ok := certsSec.Data["ca.crt"]; ok && len(b) > 0 {
			caBytes = b
		}
	}
	if len(caBytes) == 0 {
		customCaSec := &corev1.Secret{}
		if err := r.hostClient.Get(ctx, types.NamespacedName{Name: fmt.Sprintf("vc-custom-ca-%s", vc.Name), Namespace: vc.Namespace}, customCaSec); err == nil {
			if b, ok := customCaSec.Data["ca.crt"]; ok && len(b) > 0 {
				caBytes = b
			}
		}
	}
	if len(caBytes) == 0 {
		vcSec := &corev1.Secret{}
		if err := r.hostClient.Get(ctx, types.NamespacedName{Name: fmt.Sprintf("vc-%s", vc.Name), Namespace: vc.Namespace}, vcSec); err == nil {
			if b, ok := vcSec.Data["certificate-authority"]; ok && len(b) > 0 {
				caBytes = b
			}
		}
	}

	if len(caBytes) > 0 {
		cm := &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:      caCmName,
				Namespace: vc.Namespace,
				Labels: map[string]string{
					"app.kubernetes.io/managed-by":  "vcop-operator",
					"app.kubernetes.io/part-of":     "gateway-api",
					"vcop.gitops.io/virtualcluster": vc.Name,
				},
			},
			Data: map[string]string{
				"ca.crt": string(caBytes),
			},
		}
		if len(ownerRefs) > 0 {
			cm.SetOwnerReferences(ownerRefs)
		}
		existingCm := &corev1.ConfigMap{}
		if err := r.hostClient.Get(ctx, types.NamespacedName{Name: caCmName, Namespace: vc.Namespace}, existingCm); apierrors.IsNotFound(err) {
			_ = r.hostClient.Create(ctx, cm)
		} else if err == nil {
			existingCm.Data = cm.Data
			if len(ownerRefs) > 0 {
				existingCm.SetOwnerReferences(ownerRefs)
			}
			_ = r.hostClient.Update(ctx, existingCm)
		}

		btp := &unstructured.Unstructured{}
		btp.SetGroupVersionKind(gwApiBackendTLSPolicyGVK)
		btp.SetName(fmt.Sprintf("%s-api-backend-tls", vc.Name))
		btp.SetNamespace(vc.Namespace)
		btp.SetLabels(map[string]string{
			"app.kubernetes.io/managed-by":  "vcop-operator",
			"app.kubernetes.io/part-of":     "gateway-api",
			"vcop.gitops.io/virtualcluster": vc.Name,
		})
		if len(ownerRefs) > 0 {
			btp.SetOwnerReferences(ownerRefs)
		}
		btp.Object["spec"] = map[string]interface{}{
			"targetRefs": []interface{}{
				map[string]interface{}{
					"group": "",
					"kind":  "Service",
					"name":  vc.Name,
				},
			},
			"validation": map[string]interface{}{
				"caCertificateRefs": []interface{}{
					map[string]interface{}{
						"group": "",
						"kind":  "ConfigMap",
						"name":  caCmName,
					},
				},
				"hostname": vc.Name,
			},
		}
		_ = r.createOrUpdateHostResource(ctx, btp)
	}

	return nil
}

func (r *GatewayAPIReconciler) createOrUpdateHostResource(ctx context.Context, obj *unstructured.Unstructured) error {
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

func (r *GatewayAPIReconciler) cleanupAppRoutes(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	resources := []struct {
		gvk  schema.GroupVersionKind
		name string
	}{
		{gwApiHTTPRouteGVK, fmt.Sprintf("%s-redirect", vc.Name)},
		{gwApiHTTPRouteGVK, fmt.Sprintf("%s-route", vc.Name)},
	}

	for _, res := range resources {
		u := &unstructured.Unstructured{}
		u.SetGroupVersionKind(res.gvk)
		u.SetName(res.name)
		u.SetNamespace(vc.Namespace)
		_ = r.hostClient.Delete(ctx, u)
	}
	return nil
}

func (r *GatewayAPIReconciler) cleanupHostRouting(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	_ = r.cleanupAppRoutes(ctx, vc)

	resources := []struct {
		gvk  schema.GroupVersionKind
		name string
	}{
		{gwApiHTTPRouteGVK, fmt.Sprintf("%s-api-route", vc.Name)},
		{gwApiBackendTLSPolicyGVK, fmt.Sprintf("%s-api-backend-tls", vc.Name)},
	}

	for _, res := range resources {
		u := &unstructured.Unstructured{}
		u.SetGroupVersionKind(res.gvk)
		u.SetName(res.name)
		u.SetNamespace(vc.Namespace)
		_ = r.hostClient.Delete(ctx, u)
	}

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-apiserver-ca", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.hostClient.Delete(ctx, cm)

	return nil
}

// CleanupGuestGatewayAPI cleans up in-guest Gateway API components and cert-manager host certificates/secrets
// without removing the unified host routing HTTPRoutes.
func (r *GatewayAPIReconciler) CleanupGuestGatewayAPI(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	// Clean up cert-manager Certificate on host
	certGVK := schema.GroupVersionKind{
		Group:   "cert-manager.io",
		Version: "v1",
		Kind:    "Certificate",
	}
	certU := &unstructured.Unstructured{}
	certU.SetGroupVersionKind(certGVK)
	certU.SetName(fmt.Sprintf("%s-gateway-cert", vc.Name))
	certU.SetNamespace(vc.Namespace)
	_ = r.hostClient.Delete(ctx, certU)

	// Clean up TLS secret on host
	tlsSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-gateway-tls", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.hostClient.Delete(ctx, tlsSec)

	// Clean up in-guest Gateway API components if cluster is reachable
	if r.addonsRec != nil {
		vClient, dynClient, err := r.addonsRec.GetVirtualClusterClients(ctx, vc)
		if err == nil && vClient != nil {
			_ = r.cleanupGuestGatewayAPIResources(ctx, vc, vClient, dynClient)
		}
	}

	return nil
}

// CleanupAllGatewayAPI cleans up all host routing resources, cert-manager certificates, and TLS secrets
func (r *GatewayAPIReconciler) CleanupAllGatewayAPI(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	_ = r.cleanupHostRouting(ctx, vc)
	return r.CleanupGuestGatewayAPI(ctx, vc)
}

func (r *GatewayAPIReconciler) cleanupGuestGatewayAPIResources(ctx context.Context, vc *v1alpha1.VirtualCluster, vClient client.Client, dynClient dynamic.Interface) error {
	// 1. Delete in-guest Deployment
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy",
			Namespace: "gateway-system",
		},
	}
	_ = vClient.Delete(ctx, dep, client.PropagationPolicy(metav1.DeletePropagationBackground))

	// 2. Delete in-guest Service
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy",
			Namespace: "gateway-system",
		},
	}
	_ = vClient.Delete(ctx, svc)

	// 3. Delete in-guest ConfigMap & ServiceAccount
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy-config",
			Namespace: "gateway-system",
		},
	}
	_ = vClient.Delete(ctx, cm)

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "gateway-proxy",
			Namespace: "gateway-system",
		},
	}
	_ = vClient.Delete(ctx, sa)

	// 4. Delete in-guest Gateway & HTTPRoute
	if dynClient != nil {
		_ = dynClient.Resource(gwApiHTTPRouteGVR).Namespace("gateway-system").Delete(ctx, "main-entrypoint", metav1.DeleteOptions{})
		_ = dynClient.Resource(gwApiGatewayGVR).Namespace("gateway-system").Delete(ctx, "default-gateway", metav1.DeleteOptions{})
	}

	// 5. Delete guest namespace gateway-system
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "gateway-system",
		},
	}
	_ = vClient.Delete(ctx, ns, client.PropagationPolicy(metav1.DeletePropagationBackground))

	return nil
}

