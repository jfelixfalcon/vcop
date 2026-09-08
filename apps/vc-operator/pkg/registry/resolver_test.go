package registry

import (
	"strings"
	"testing"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestParseImage(t *testing.T) {
	tests := []struct {
		input    string
		expected ParsedImage
	}{
		{
			input: "ghcr.io/loft-sh/vcluster-oss:0.36.0",
			expected: ParsedImage{
				Domain:     "ghcr.io",
				Path:       "loft-sh",
				Repository: "vcluster-oss",
				Tag:        "0.36.0",
			},
		},
		{
			input: "registry.k8s.io/etcd:3.6.8-0",
			expected: ParsedImage{
				Domain:     "registry.k8s.io",
				Path:       "",
				Repository: "etcd",
				Tag:        "3.6.8-0",
			},
		},
		{
			input: "registry.k8s.io/metrics-server/metrics-server:v0.7.2",
			expected: ParsedImage{
				Domain:     "registry.k8s.io",
				Path:       "metrics-server",
				Repository: "metrics-server",
				Tag:        "v0.7.2",
			},
		},
		{
			input: "coredns/coredns:v1.11.3",
			expected: ParsedImage{
				Domain:     "",
				Path:       "coredns",
				Repository: "coredns",
				Tag:        "v1.11.3",
			},
		},
		{
			input: "postgres:16-alpine",
			expected: ParsedImage{
				Domain:     "",
				Path:       "",
				Repository: "postgres",
				Tag:        "16-alpine",
			},
		},
		{
			input: "harbor.com:5000/proj/team/image:latest@sha256:abcdef",
			expected: ParsedImage{
				Domain:     "harbor.com:5000",
				Path:       "proj/team",
				Repository: "image",
				Tag:        "latest",
				Digest:     "sha256:abcdef",
			},
		},
	}

	for _, tt := range tests {
		res := ParseImage(tt.input)
		if res.Domain != tt.expected.Domain {
			t.Errorf("[%s] expected domain %s, got %s", tt.input, tt.expected.Domain, res.Domain)
		}
		if res.Path != tt.expected.Path {
			t.Errorf("[%s] expected path %s, got %s", tt.input, tt.expected.Path, res.Path)
		}
		if res.Repository != tt.expected.Repository {
			t.Errorf("[%s] expected repo %s, got %s", tt.input, tt.expected.Repository, res.Repository)
		}
		if res.Tag != tt.expected.Tag {
			t.Errorf("[%s] expected tag %s, got %s", tt.input, tt.expected.Tag, res.Tag)
		}
	}
}

func TestRewriteImage(t *testing.T) {
	tests := []struct {
		name           string
		image          string
		targetRegistry string
		swapFrom       string
		swapTo         string
		flatten        bool
		expected       string
	}{
		{
			name:           "Relocate and flatten to registry.com/library",
			image:          "ghcr.io/loft-sh/vcluster-oss:0.36.0",
			targetRegistry: "registry.com/library",
			flatten:        true,
			expected:       "registry.com/library/vcluster-oss:0.36.0",
		},
		{
			name:           "Relocate etcd to registry.com/library",
			image:          "registry.k8s.io/etcd:3.6.8-0",
			targetRegistry: "registry.com/library",
			flatten:        true,
			expected:       "registry.com/library/etcd:3.6.8-0",
		},
		{
			name:           "Relocate metrics-server to registry.com/library",
			image:          "registry.k8s.io/metrics-server/metrics-server:v0.7.2",
			targetRegistry: "registry.com/library",
			flatten:        true,
			expected:       "registry.com/library/metrics-server:v0.7.2",
		},
		{
			name:           "Swap from harbor.com to registry.com/library with flatten",
			image:          "harbor.com/vcluster-oss:0.36.0",
			swapFrom:       "harbor.com",
			swapTo:         "registry.com/library",
			flatten:        true,
			expected:       "registry.com/library/vcluster-oss:0.36.0",
		},
		{
			name:           "Swap from harbor.com to registry.com/library with nested path",
			image:          "harbor.com/loft-sh/vcluster-oss:0.36.0",
			swapFrom:       "harbor.com",
			swapTo:         "registry.com/library",
			flatten:        true,
			expected:       "registry.com/library/vcluster-oss:0.36.0",
		},
		{
			name:           "Swap from harbor.com to registry.com/library preserving path (non-flatten)",
			image:          "harbor.com/loft-sh/vcluster-oss:0.36.0",
			swapFrom:       "harbor.com",
			swapTo:         "registry.com/library",
			flatten:        false,
			expected:       "registry.com/library/loft-sh/vcluster-oss:0.36.0",
		},
		{
			name:           "No swap when source does not match",
			image:          "quay.io/other/tool:v1",
			swapFrom:       "harbor.com",
			swapTo:         "registry.com/library",
			flatten:        true,
			expected:       "quay.io/other/tool:v1",
		},
		{
			name:           "Combined target relocation with swap rule",
			image:          "harbor.com/vops/vc-operator:v1.4.1",
			targetRegistry: "registry.com/library",
			swapFrom:       "harbor.com",
			swapTo:         "registry.com/library",
			flatten:        true,
			expected:       "registry.com/library/vc-operator:v1.4.1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := RewriteImage(tt.image, tt.targetRegistry, tt.swapFrom, tt.swapTo, tt.flatten)
			if got != tt.expected {
				t.Errorf("RewriteImage() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestCanonicalImages(t *testing.T) {
	images := CanonicalImages()
	if len(images) < 10 {
		t.Fatalf("expected at least 10 canonical images, got %d", len(images))
	}
	// Verify each image can be parsed
	for _, img := range images {
		parsed := ParseImage(img.Image)
		if parsed.Repository == "" {
			t.Errorf("failed parsing repository for %s", img.Image)
		}
		// Test flattening rewrite to registry.com/library
		rewritten := RewriteImage(img.Image, "registry.com/library", "", "", true)
		if !strings.HasPrefix(rewritten, "registry.com/library/") {
			t.Errorf("expected prefix registry.com/library/, got %s", rewritten)
		}
	}
}

func TestRewriteImageWithVirtualCluster(t *testing.T) {
	resolver := GetResolver()
	vc := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			ImageRegistry: "registry.com/library",
		},
	}
	res := resolver.RewriteImage("ghcr.io/loft-sh/vcluster-oss:0.36.0", vc)
	if res != "registry.com/library/vcluster-oss:0.36.0" {
		t.Fatalf("expected registry.com/library/vcluster-oss:0.36.0, got %s", res)
	}

	// Test annotation swap
	vc.Annotations = map[string]string{
		AnnotationImageSwapFrom: "harbor.com",
		AnnotationImageSwapTo:   "registry.com/library",
	}
	res2 := resolver.RewriteImage("harbor.com/vcluster-oss:0.36.0", vc)
	if res2 != "registry.com/library/vcluster-oss:0.36.0" {
		t.Fatalf("expected registry.com/library/vcluster-oss:0.36.0, got %s", res2)
	}
}
