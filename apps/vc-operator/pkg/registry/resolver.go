package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

const (
	ConfigMapName      = "vcop-image-registry"
	ConfigMapNamespace = "vcop-system"

	AnnotationImageRegistry = "vops.gitops.io/image-registry"
	AnnotationImageSwapFrom = "vops.gitops.io/image-swap-from"
	AnnotationImageSwapTo   = "vops.gitops.io/image-swap-to"
	AnnotationImageFlatten  = "vops.gitops.io/image-flatten"
)

// GlobalConfig defines cluster-wide image swap and registry relocation settings
type GlobalConfig struct {
	TargetRegistry string     `json:"targetRegistry,omitempty"` // e.g. "registry.com/library"
	SwapFrom       string     `json:"swapFrom,omitempty"`       // e.g. "harbor.com"
	SwapTo         string     `json:"swapTo,omitempty"`         // e.g. "registry.com/library"
	Flatten        bool       `json:"flatten"`                  // defaults to true when target has path
	Rules          []SwapRule `json:"rules,omitempty"`
	UpdatedAt      string     `json:"updatedAt,omitempty"`
}

type SwapRule struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// ParsedImage holds the decomposed components of a container image string
type ParsedImage struct {
	Original   string
	Domain     string
	Path       string
	Repository string
	Tag        string
	Digest     string
}

// ParseImage breaks down an image reference into its constituent parts.
func ParseImage(image string) ParsedImage {
	parsed := ParsedImage{Original: image}
	ref := image

	// 1. Separate digest if present
	if parts := strings.SplitN(ref, "@", 2); len(parts) == 2 {
		ref = parts[0]
		parsed.Digest = parts[1]
	}

	// 2. Separate tag if present
	// Must be careful not to confuse port in domain (e.g. localhost:5000/image) with tag
	lastSlash := strings.LastIndex(ref, "/")
	tagColon := -1
	if lastSlash == -1 {
		tagColon = strings.Index(ref, ":")
	} else {
		sub := ref[lastSlash+1:]
		if idx := strings.Index(sub, ":"); idx != -1 {
			tagColon = lastSlash + 1 + idx
		}
	}

	if tagColon != -1 {
		parsed.Tag = ref[tagColon+1:]
		ref = ref[:tagColon]
	}

	// 3. Determine if the first segment is a registry domain (contains '.', ':', or is 'localhost')
	parts := strings.Split(ref, "/")
	if len(parts) > 1 && (strings.Contains(parts[0], ".") || strings.Contains(parts[0], ":") || parts[0] == "localhost") {
		parsed.Domain = parts[0]
		parts = parts[1:]
	}

	// 4. Remainder represents repository name and optional namespaces
	if len(parts) > 0 {
		parsed.Repository = parts[len(parts)-1]
		if len(parts) > 1 {
			parsed.Path = strings.Join(parts[:len(parts)-1], "/")
		}
	}

	return parsed
}

// RewriteImage performs registry replacement, FQDN swap, and repository flattening.
func RewriteImage(originalImage string, targetRegistry, swapFrom, swapTo string, flatten bool) string {
	if originalImage == "" {
		return originalImage
	}

	targetRegistry = strings.TrimSuffix(strings.TrimSpace(targetRegistry), "/")
	swapFrom = strings.TrimSuffix(strings.TrimSpace(swapFrom), "/")
	swapTo = strings.TrimSuffix(strings.TrimSpace(swapTo), "/")

	parsed := ParseImage(originalImage)

	// Build full original reference tag suffix
	tagSuffix := ""
	if parsed.Tag != "" {
		tagSuffix = ":" + parsed.Tag
	} else if parsed.Digest != "" {
		tagSuffix = "@" + parsed.Digest
	}

	// 1. Handle Explicit Swap Rule (e.g. from "harbor.com" to "registry.com/library")
	if swapFrom != "" && swapTo != "" {
		origDomainAndPath := parsed.Domain
		if origDomainAndPath != "" && parsed.Path != "" {
			origDomainAndPath += "/" + parsed.Path
		}

		if strings.HasPrefix(originalImage, swapFrom) || strings.HasPrefix(origDomainAndPath, swapFrom) || parsed.Domain == swapFrom {
			if flatten {
				return fmt.Sprintf("%s/%s%s", swapTo, parsed.Repository, tagSuffix)
			}
			// Replace swapFrom prefix directly
			trimmed := strings.TrimPrefix(originalImage, swapFrom)
			trimmed = strings.TrimPrefix(trimmed, "/")
			return fmt.Sprintf("%s/%s", swapTo, trimmed)
		}
	}

	// 2. Handle Target Registry Relocation (e.g. relocate any image to "registry.com/library")
	if targetRegistry != "" {
		if flatten {
			return fmt.Sprintf("%s/%s%s", targetRegistry, parsed.Repository, tagSuffix)
		}

		// Non-flatten: preserve repository sub-path if it existed
		if parsed.Path != "" {
			return fmt.Sprintf("%s/%s/%s%s", targetRegistry, parsed.Path, parsed.Repository, tagSuffix)
		}
		return fmt.Sprintf("%s/%s%s", targetRegistry, parsed.Repository, tagSuffix)
	}

	return originalImage
}

// Resolver manages cluster-wide image rewrites with caching and fallback
type Resolver struct {
	client    client.Client
	mu        sync.RWMutex
	cache     *GlobalConfig
	lastFetch time.Time
	cacheTTL  time.Duration
}

var (
	defaultResolver *Resolver
	resolverOnce    sync.Once
)

// InitResolver initializes the singleton image resolver
func InitResolver(c client.Client) *Resolver {
	resolverOnce.Do(func() {
		defaultResolver = &Resolver{
			client:   c,
			cacheTTL: 10 * time.Second,
		}
	})
	return defaultResolver
}

// GetResolver returns the initialized resolver or an environment-only resolver
func GetResolver() *Resolver {
	if defaultResolver == nil {
		defaultResolver = &Resolver{
			cacheTTL: 10 * time.Second,
		}
	}
	return defaultResolver
}

// GetGlobalConfig retrieves the active image registry configuration from K8s or environment
func (r *Resolver) GetGlobalConfig(ctx context.Context) GlobalConfig {
	r.mu.RLock()
	if r.cache != nil && time.Since(r.lastFetch) < r.cacheTTL {
		cfg := *r.cache
		r.mu.RUnlock()
		return cfg
	}
	r.mu.RUnlock()

	config := GlobalConfig{
		TargetRegistry: strings.TrimSpace(os.Getenv("GLOBAL_IMAGE_REGISTRY")),
		SwapFrom:       strings.TrimSpace(os.Getenv("IMAGE_SWAP_FROM")),
		SwapTo:         strings.TrimSpace(os.Getenv("IMAGE_SWAP_TO")),
		Flatten:        os.Getenv("IMAGE_FLATTEN") != "false",
	}

	if r.client != nil && ctx != nil {
		cm := &corev1.ConfigMap{}
		err := r.client.Get(ctx, types.NamespacedName{
			Name:      ConfigMapName,
			Namespace: ConfigMapNamespace,
		}, cm)
		if err == nil && cm.Data != nil {
			if raw, ok := cm.Data["image-registry.json"]; ok && raw != "" {
				var cmConfig GlobalConfig
				if err := json.Unmarshal([]byte(raw), &cmConfig); err == nil {
					if cmConfig.TargetRegistry != "" {
						config.TargetRegistry = cmConfig.TargetRegistry
					}
					if cmConfig.SwapFrom != "" {
						config.SwapFrom = cmConfig.SwapFrom
					}
					if cmConfig.SwapTo != "" {
						config.SwapTo = cmConfig.SwapTo
					}
					config.Flatten = cmConfig.Flatten
					config.Rules = cmConfig.Rules
				}
			}
		}
	}

	r.mu.Lock()
	r.cache = &config
	r.lastFetch = time.Now()
	r.mu.Unlock()

	return config
}

// RewriteImage resolves the effective image for a specific VirtualCluster context
func (r *Resolver) RewriteImage(originalImage string, vc *v1alpha1.VirtualCluster) string {
	if originalImage == "" {
		return originalImage
	}

	ctx := context.Background()
	global := r.GetGlobalConfig(ctx)

	targetRegistry := global.TargetRegistry
	swapFrom := global.SwapFrom
	swapTo := global.SwapTo
	flatten := global.Flatten

	if vc != nil {
		// Cluster-level spec override
		if vc.Spec.ImageRegistry != "" {
			targetRegistry = vc.Spec.ImageRegistry
		}

		// Cluster-level annotations take top precedence
		if vc.Annotations != nil {
			if reg, ok := vc.Annotations[AnnotationImageRegistry]; ok && reg != "" {
				targetRegistry = reg
			}
			if from, ok := vc.Annotations[AnnotationImageSwapFrom]; ok && from != "" {
				swapFrom = from
			}
			if to, ok := vc.Annotations[AnnotationImageSwapTo]; ok && to != "" {
				swapTo = to
			}
			if fl, ok := vc.Annotations[AnnotationImageFlatten]; ok && fl != "" {
				flatten = (fl == "true" || fl == "1")
			}
		}

		// Spec custom rules
		for _, rule := range vc.Spec.ImageRewriteRules {
			if rule.From != "" && rule.To != "" {
				if strings.Contains(originalImage, rule.From) {
					swapFrom = rule.From
					swapTo = rule.To
					break
				}
			}
		}
	}

	// Check global multi-rules
	for _, rule := range global.Rules {
		if rule.From != "" && rule.To != "" && strings.Contains(originalImage, rule.From) {
			swapFrom = rule.From
			swapTo = rule.To
			break
		}
	}

	return RewriteImage(originalImage, targetRegistry, swapFrom, swapTo, flatten)
}

// CanonicalImage represents a cataloged container image used in vCOp/vCluster
type CanonicalImage struct {
	Component  string `json:"component"`
	Category   string `json:"category"`
	Role       string `json:"role"`
	Image      string `json:"image"`
	Registry   string `json:"registry"`
	Repository string `json:"repository"`
	Tag        string `json:"tag"`
}

// CanonicalImages returns all core images used across vClusters and the platform
func CanonicalImages() []CanonicalImage {
	return []CanonicalImage{
		{Component: "syncer", Category: "controlPlane", Role: "vCluster core synchronization and control-loop engine", Image: "ghcr.io/loft-sh/vcluster-oss:0.36.0", Registry: "ghcr.io", Repository: "loft-sh/vcluster-oss", Tag: "0.36.0"},
		{Component: "kubernetes-v1.31", Category: "controlPlane", Role: "Guest Kubernetes API server and controller binaries (v1.31)", Image: "ghcr.io/loft-sh/kubernetes:v1.31.0", Registry: "ghcr.io", Repository: "loft-sh/kubernetes", Tag: "v1.31.0"},
		{Component: "kubernetes-v1.32", Category: "controlPlane", Role: "Guest Kubernetes API server and controller binaries (v1.32)", Image: "ghcr.io/loft-sh/kubernetes:v1.32.0", Registry: "ghcr.io", Repository: "loft-sh/kubernetes", Tag: "v1.32.0"},
		{Component: "kubernetes-v1.33", Category: "controlPlane", Role: "Guest Kubernetes API server and controller binaries (v1.33)", Image: "ghcr.io/loft-sh/kubernetes:v1.33.0", Registry: "ghcr.io", Repository: "loft-sh/kubernetes", Tag: "v1.33.0"},
		{Component: "etcd-v3.6", Category: "backingStore", Role: "Dedicated high-throughput etcd backing store", Image: "registry.k8s.io/etcd:3.6.8-0", Registry: "registry.k8s.io", Repository: "etcd", Tag: "3.6.8-0"},
		{Component: "etcd-v3.5", Category: "backingStore", Role: "Long-term support etcd backing store", Image: "registry.k8s.io/etcd:3.5.18-0", Registry: "registry.k8s.io", Repository: "etcd", Tag: "3.5.18-0"},
		{Component: "coredns", Category: "addons", Role: "In-cluster CoreDNS resolver service", Image: "registry.k8s.io/coredns/coredns:v1.11.3", Registry: "registry.k8s.io", Repository: "coredns/coredns", Tag: "v1.11.3"},
		{Component: "metrics-server", Category: "addons", Role: "Resource telemetry and Horizontal Pod Autoscaling (HPA) provider", Image: "registry.k8s.io/metrics-server/metrics-server:v0.7.2", Registry: "registry.k8s.io", Repository: "metrics-server/metrics-server", Tag: "v0.7.2"},
		{Component: "istio-pilot", Category: "meshAndIngress", Role: "Istio discovery control plane (istiod)", Image: "docker.io/istio/pilot:1.24.2", Registry: "docker.io", Repository: "istio/pilot", Tag: "1.24.2"},
		{Component: "istio-proxy", Category: "meshAndIngress", Role: "Istio Envoy ingress gateway proxy", Image: "docker.io/istio/proxyv2:1.24.2", Registry: "docker.io", Repository: "istio/proxyv2", Tag: "1.24.2"},
		{Component: "dr-runner", Category: "disasterRecovery", Role: "Automated snapshot backup and point-in-time restore runner", Image: "vops/etcd-dr-runner:v1.3.0", Registry: "docker.io", Repository: "vops/etcd-dr-runner", Tag: "v1.3.0"},
		{Component: "operator", Category: "platform", Role: "Virtual cluster Kubernetes custom controller", Image: "vops/vc-operator:v1.4.1", Registry: "docker.io", Repository: "vops/vc-operator", Tag: "v1.4.1"},
		{Component: "operations-center-ui", Category: "platform", Role: "Operations Center multi-tenant dashboard and UI", Image: "vops/vc-operations-center:v1.4.1", Registry: "docker.io", Repository: "vops/vc-operations-center", Tag: "v1.4.1"},
		{Component: "ai-inference-engine", Category: "platform", Role: "vCOp AI copilot, cost analyzer, and triage engine", Image: "vops/vc-ai:v1.4.1", Registry: "docker.io", Repository: "vops/vc-ai", Tag: "v1.4.1"},
		{Component: "metrics-db", Category: "platform", Role: "Timescale/PostgreSQL time-series telemetry store", Image: "docker.io/library/postgres:16-alpine", Registry: "docker.io", Repository: "library/postgres", Tag: "16-alpine"},
	}
}
