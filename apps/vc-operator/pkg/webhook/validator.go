package webhook

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/validation/field"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"github.com/vops/vc-operator/pkg/capacity"
)

var (
	clusterNameRegex = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`)
	semverRegex      = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$`)
)

type ParsedVersion struct {
	Major int
	Minor int
	Patch int
}

func ParseSemver(v string) (*ParsedVersion, error) {
	clean := strings.TrimPrefix(v, "v")
	matches := semverRegex.FindStringSubmatch(clean)
	if len(matches) < 4 {
		return nil, fmt.Errorf("invalid semver format: %q", v)
	}
	major, err := strconv.Atoi(matches[1])
	if err != nil {
		return nil, err
	}
	minor, err := strconv.Atoi(matches[2])
	if err != nil {
		return nil, err
	}
	patch, err := strconv.Atoi(matches[3])
	if err != nil {
		return nil, err
	}
	return &ParsedVersion{Major: major, Minor: minor, Patch: patch}, nil
}

// CompareVersions returns -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
func CompareVersions(v1, v2 *ParsedVersion) int {
	if v1.Major != v2.Major {
		if v1.Major < v2.Major {
			return -1
		}
		return 1
	}
	if v1.Minor != v2.Minor {
		if v1.Minor < v2.Minor {
			return -1
		}
		return 1
	}
	if v1.Patch != v2.Patch {
		if v1.Patch < v2.Patch {
			return -1
		}
		return 1
	}
	return 0
}

// VirtualClusterValidator validates VirtualCluster create and update requests
type VirtualClusterValidator struct {
	Client client.Client
}

func NewVirtualClusterValidator(c ...client.Client) *VirtualClusterValidator {
	if len(c) > 0 {
		return &VirtualClusterValidator{Client: c[0]}
	}
	return &VirtualClusterValidator{}
}

// validateBasicSpec performs static syntax and component validation
func (v *VirtualClusterValidator) validateBasicSpec(ctx context.Context, vc *v1alpha1.VirtualCluster) field.ErrorList {
	var allErrs field.ErrorList
	fldPath := field.NewPath("spec")

	// Validate clusterName
	if vc.Spec.ClusterName == "" {
		allErrs = append(allErrs, field.Required(fldPath.Child("clusterName"), "clusterName is required"))
	} else if len(vc.Spec.ClusterName) > 63 {
		allErrs = append(allErrs, field.TooLong(fldPath.Child("clusterName"), vc.Spec.ClusterName, 63))
	} else if !clusterNameRegex.MatchString(vc.Spec.ClusterName) {
		allErrs = append(allErrs, field.Invalid(fldPath.Child("clusterName"), vc.Spec.ClusterName, "must consist of lower case alphanumeric characters or '-', and must start and end with an alphanumeric character"))
	}

	// Validate clusterType
	if vc.Spec.ClusterType != "" &&
		vc.Spec.ClusterType != v1alpha1.ClusterTypeVCluster &&
		vc.Spec.ClusterType != v1alpha1.ClusterTypeNamespaced &&
		vc.Spec.ClusterType != v1alpha1.ClusterTypeHost {
		allErrs = append(allErrs, field.NotSupported(fldPath.Child("clusterType"), vc.Spec.ClusterType, []string{
			string(v1alpha1.ClusterTypeVCluster),
			string(v1alpha1.ClusterTypeNamespaced),
			string(v1alpha1.ClusterTypeHost),
		}))
	}

	// Validate namespaces if specified
	for i, ns := range vc.Spec.Namespaces {
		if ns == "" {
			allErrs = append(allErrs, field.Required(fldPath.Child("namespaces").Index(i), "namespace name cannot be empty"))
		} else if len(ns) > 63 {
			allErrs = append(allErrs, field.TooLong(fldPath.Child("namespaces").Index(i), ns, 63))
		} else if !clusterNameRegex.MatchString(ns) {
			allErrs = append(allErrs, field.Invalid(fldPath.Child("namespaces").Index(i), ns, "must consist of lower case alphanumeric characters or '-'"))
		}
	}

	// Validate kubernetesVersion
	if vc.Spec.KubernetesVersion != "" {
		if _, err := ParseSemver(vc.Spec.KubernetesVersion); err != nil {
			allErrs = append(allErrs, field.Invalid(fldPath.Child("kubernetesVersion"), vc.Spec.KubernetesVersion, err.Error()))
		}
	}

	// Validate vclusterVersion
	if !vc.IsNamespaced() && vc.Spec.VClusterVersion != "" {
		if _, err := ParseSemver(vc.Spec.VClusterVersion); err != nil {
			allErrs = append(allErrs, field.Invalid(fldPath.Child("vclusterVersion"), vc.Spec.VClusterVersion, err.Error()))
		}
	}

	// Validate rawConfig syntax
	if vc.Spec.RawConfig != nil && len(vc.Spec.RawConfig.Raw) > 0 {
		var dummy map[string]interface{}
		errJSON := json.Unmarshal(vc.Spec.RawConfig.Raw, &dummy)
		errYAML := yaml.Unmarshal(vc.Spec.RawConfig.Raw, &dummy)
		if (errJSON != nil && errYAML != nil) || dummy == nil {
			allErrs = append(allErrs, field.Invalid(fldPath.Child("rawConfig"), string(vc.Spec.RawConfig.Raw), "must be a valid JSON or YAML object mapping"))
		}
	}

	// Validate helmValues syntax
	if vc.Spec.HelmValues != nil && len(vc.Spec.HelmValues.Raw) > 0 {
		var dummy map[string]interface{}
		errJSON := json.Unmarshal(vc.Spec.HelmValues.Raw, &dummy)
		errYAML := yaml.Unmarshal(vc.Spec.HelmValues.Raw, &dummy)
		if (errJSON != nil && errYAML != nil) || dummy == nil {
			allErrs = append(allErrs, field.Invalid(fldPath.Child("helmValues"), string(vc.Spec.HelmValues.Raw), "must be a valid JSON or YAML object mapping"))
		}
	}
	// Validate Istio opinionated component & cert-manager issuer
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Enabled {
		istioPath := fldPath.Child("components", "istio")
		issuerKind := vc.Spec.Components.Istio.CertificateIssuerKind
		if issuerKind != "" && issuerKind != "ClusterIssuer" && issuerKind != "Issuer" {
			allErrs = append(allErrs, field.NotSupported(istioPath.Child("certificateIssuerKind"), issuerKind, []string{"ClusterIssuer", "Issuer"}))
		}

		issuerName := strings.TrimSpace(vc.Spec.Components.Istio.CertificateIssuer)
		if issuerName != "" && v.Client != nil {
			u := &unstructured.Unstructured{}
			var targetNamespace string
			if strings.EqualFold(issuerKind, "Issuer") {
				u.SetGroupVersionKind(schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: "Issuer"})
				targetNamespace = vc.Namespace
			} else {
				u.SetGroupVersionKind(schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: "ClusterIssuer"})
				targetNamespace = ""
			}
			err := v.Client.Get(ctx, types.NamespacedName{Name: issuerName, Namespace: targetNamespace}, u)
			if err != nil {
				allErrs = append(allErrs, field.Invalid(istioPath.Child("certificateIssuer"), issuerName, fmt.Sprintf("cert-manager %s %q does not exist on host cluster", issuerKind, issuerName)))
			}
		}
	}

	// Validate Gateway API opinionated component & cert-manager issuer
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.Enabled {
		gwPath := fldPath.Child("components", "gatewayAPI")
		issuerKind := vc.Spec.Components.GatewayAPI.CertificateIssuerKind
		if issuerKind != "" && issuerKind != "ClusterIssuer" && issuerKind != "Issuer" {
			allErrs = append(allErrs, field.NotSupported(gwPath.Child("certificateIssuerKind"), issuerKind, []string{"ClusterIssuer", "Issuer"}))
		}

		issuerName := strings.TrimSpace(vc.Spec.Components.GatewayAPI.CertificateIssuer)
		if issuerName != "" && v.Client != nil {
			u := &unstructured.Unstructured{}
			var targetNamespace string
			if strings.EqualFold(issuerKind, "Issuer") {
				u.SetGroupVersionKind(schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: "Issuer"})
				targetNamespace = vc.Namespace
			} else {
				u.SetGroupVersionKind(schema.GroupVersionKind{Group: "cert-manager.io", Version: "v1", Kind: "ClusterIssuer"})
				targetNamespace = ""
			}
			err := v.Client.Get(ctx, types.NamespacedName{Name: issuerName, Namespace: targetNamespace}, u)
			if err != nil {
				allErrs = append(allErrs, field.Invalid(gwPath.Child("certificateIssuer"), issuerName, fmt.Sprintf("cert-manager %s %q does not exist on host cluster", issuerKind, issuerName)))
			}
		}
	}

	return allErrs
}

// ValidateCreate validates a new VirtualCluster
func (v *VirtualClusterValidator) ValidateCreate(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	allErrs := v.validateBasicSpec(ctx, vc)

	// Validate host capacity to prevent overallocation
	if v.Client != nil {
		if err := capacity.ValidateVirtualClusterCapacity(ctx, v.Client, vc, nil); err != nil {
			allErrs = append(allErrs, field.Forbidden(field.NewPath("spec"), err.Error()))
		}
	}

	if len(allErrs) == 0 {
		return nil
	}
	return apierrors.NewInvalid(schema.GroupKind{Group: "vops.gitops.io", Kind: "VirtualCluster"}, vc.Name, allErrs)
}

// ValidateUpdate validates modifications to an existing VirtualCluster
func (v *VirtualClusterValidator) ValidateUpdate(ctx context.Context, oldVC, newVC *v1alpha1.VirtualCluster) error {
	allErrs := v.validateBasicSpec(ctx, newVC)
	fldPath := field.NewPath("spec")

	// ClusterName is immutable
	if oldVC.Spec.ClusterName != "" && newVC.Spec.ClusterName != oldVC.Spec.ClusterName {
		allErrs = append(allErrs, field.Forbidden(fldPath.Child("clusterName"), "clusterName is immutable once created"))
	}

	// ClusterType is immutable
	oldType := oldVC.Spec.ClusterType
	if oldType == "" {
		oldType = v1alpha1.ClusterTypeVCluster
	}
	newType := newVC.Spec.ClusterType
	if newType == "" {
		newType = v1alpha1.ClusterTypeVCluster
	}
	if oldType != newType && !(oldVC.IsNamespaced() && newVC.IsNamespaced()) {
		allErrs = append(allErrs, field.Forbidden(fldPath.Child("clusterType"), "clusterType is immutable once created"))
	}

	// Kubernetes Version upgrade safety checks
	if oldVC.Spec.KubernetesVersion != "" && newVC.Spec.KubernetesVersion != "" {
		oldK8s, errOld := ParseSemver(oldVC.Spec.KubernetesVersion)
		newK8s, errNew := ParseSemver(newVC.Spec.KubernetesVersion)
		if errOld == nil && errNew == nil {
			// Prevent downgrades
			if CompareVersions(newK8s, oldK8s) < 0 {
				allErrs = append(allErrs, field.Forbidden(fldPath.Child("kubernetesVersion"), fmt.Sprintf("Kubernetes downgrade from %s to %s is prohibited", oldVC.Spec.KubernetesVersion, newVC.Spec.KubernetesVersion)))
			}

			// Prevent jumping more than 1 minor version at once (e.g. 1.28 -> 1.30 disallowed)
			if newK8s.Major == oldK8s.Major {
				if newK8s.Minor > oldK8s.Minor+1 {
					allErrs = append(allErrs, field.Forbidden(fldPath.Child("kubernetesVersion"), fmt.Sprintf("Skipping minor versions during upgrade is not supported: %s to %s (max delta is +1 minor version)", oldVC.Spec.KubernetesVersion, newVC.Spec.KubernetesVersion)))
				}
			}
		}
	}

	// vCluster Engine Version upgrade safety checks
	if !newVC.IsNamespaced() && oldVC.Spec.VClusterVersion != "" && newVC.Spec.VClusterVersion != "" {
		oldEng, errOld := ParseSemver(oldVC.Spec.VClusterVersion)
		newEng, errNew := ParseSemver(newVC.Spec.VClusterVersion)
		if errOld == nil && errNew == nil {
			// Prevent engine downgrades
			if CompareVersions(newEng, oldEng) < 0 {
				allErrs = append(allErrs, field.Forbidden(fldPath.Child("vclusterVersion"), fmt.Sprintf("vCluster engine downgrade from %s to %s is prohibited", oldVC.Spec.VClusterVersion, newVC.Spec.VClusterVersion)))
			}
		}
	}

	// Validate host capacity on update to prevent overallocation
	if v.Client != nil {
		if err := capacity.ValidateVirtualClusterCapacity(ctx, v.Client, newVC, oldVC); err != nil {
			allErrs = append(allErrs, field.Forbidden(fldPath, err.Error()))
		}
	}

	if len(allErrs) == 0 {
		return nil
	}
	return apierrors.NewInvalid(schema.GroupKind{Group: "vops.gitops.io", Kind: "VirtualCluster"}, newVC.Name, allErrs)
}

// ValidateDelete validates teardown of a VirtualCluster
func (v *VirtualClusterValidator) ValidateDelete(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	return nil
}
