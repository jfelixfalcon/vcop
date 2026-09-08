package capacity

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

func TestCalculateVirtualClusterQuota(t *testing.T) {
	// Small preset
	vcSmall := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetSmall,
		},
	}
	reqCPU, reqMem, reqStorage, limCPU, limMem := CalculateVirtualClusterQuota(vcSmall)
	if reqCPU.String() != "1" || reqMem.String() != "2Gi" || reqStorage.String() != "10Gi" || limCPU.String() != "2" || limMem.String() != "4Gi" {
		t.Errorf("Unexpected small quota: %v, %v, %v, %v, %v", reqCPU, reqMem, reqStorage, limCPU, limMem)
	}

	// Medium preset (default)
	vcMedium := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{},
	}
	reqCPU, reqMem, reqStorage, limCPU, limMem = CalculateVirtualClusterQuota(vcMedium)
	if reqCPU.String() != "4" || reqMem.String() != "8Gi" || reqStorage.String() != "25Gi" || limCPU.String() != "8" || limMem.String() != "16Gi" {
		t.Errorf("Unexpected medium quota: %v, %v, %v, %v, %v", reqCPU, reqMem, reqStorage, limCPU, limMem)
	}

	// Custom overrides via Policies.ResourceQuota
	vcCustom := &v1alpha1.VirtualCluster{
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetMedium,
			Policies: &v1alpha1.PoliciesSpec{
				ResourceQuota: &v1alpha1.ResourceQuotaPolicy{
					RequestsCPU:     "6",
					RequestsMemory:  "12Gi",
					RequestsStorage: "40Gi",
					LimitsCPU:       "12",
					LimitsMemory:    "24Gi",
				},
			},
		},
	}
	reqCPU, reqMem, reqStorage, limCPU, limMem = CalculateVirtualClusterQuota(vcCustom)
	if reqCPU.String() != "6" || reqMem.String() != "12Gi" || reqStorage.String() != "40Gi" || limCPU.String() != "12" || limMem.String() != "24Gi" {
		t.Errorf("Unexpected custom quota: %v, %v, %v, %v, %v", reqCPU, reqMem, reqStorage, limCPU, limMem)
	}
}

func TestValidateVirtualClusterCapacity(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	node1 := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("16"),
				corev1.ResourceMemory:           resource.MustParse("32Gi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
		},
	}

	existingVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "existing-vc", Namespace: "default"},
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetLarge, // 8 CPU, 16Gi RAM, 50Gi Storage
		},
	}

	client := fake.NewClientBuilder().WithScheme(scheme).WithObjects(node1, existingVC).Build()
	ctx := context.Background()

	// 1. Target VC that fits (Medium: 4 CPU, 8Gi RAM, 25Gi Storage -> Total: 12 CPU, 24Gi RAM, 75Gi Storage <= 16 CPU, 32Gi, 100Gi)
	fitVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "new-vc", Namespace: "default"},
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetMedium,
		},
	}
	if err := ValidateVirtualClusterCapacity(ctx, client, fitVC, nil); err != nil {
		t.Fatalf("Expected fitVC to be allowed, got: %v", err)
	}

	// 2. Target VC that exceeds CPU (Custom 10 CPU -> Total: 18 CPU > 16 CPU)
	overCPUVC := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "over-vc", Namespace: "default"},
		Spec: v1alpha1.VirtualClusterSpec{
			CustomResources: &v1alpha1.CustomResources{
				CPU:    "10",
				Memory: "4Gi",
			},
		},
	}
	if err := ValidateVirtualClusterCapacity(ctx, client, overCPUVC, nil); err == nil {
		t.Fatalf("Expected overCPUVC to be rejected, but got nil")
	}

	// 3. Target VC with bypass annotation
	bypassVC := overCPUVC.DeepCopy()
	bypassVC.Annotations = map[string]string{IgnoreCapacityAnnotation: "true"}
	if err := ValidateVirtualClusterCapacity(ctx, client, bypassVC, nil); err != nil {
		t.Fatalf("Expected bypassVC to succeed due to annotation, got: %v", err)
	}

	// 4. Update existing cluster without increasing resources
	sameVC := existingVC.DeepCopy()
	sameVC.Spec.KubernetesVersion = "v1.32.0"
	if err := ValidateVirtualClusterCapacity(ctx, client, sameVC, existingVC); err != nil {
		t.Fatalf("Expected updating existingVC without quota change to pass, got: %v", err)
	}
}

func TestGetClusterCapacity(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = corev1.AddToScheme(scheme)
	_ = v1alpha1.AddToScheme(scheme)

	node1 := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("16"),
				corev1.ResourceMemory:           resource.MustParse("32Gi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("16"),
				corev1.ResourceMemory:           resource.MustParse("32Gi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
		},
	}

	vc1 := &v1alpha1.VirtualCluster{
		ObjectMeta: metav1.ObjectMeta{Name: "vc-1", Namespace: "default"},
		Spec: v1alpha1.VirtualClusterSpec{
			SizePreset: v1alpha1.PresetSmall, // 1 CPU, 2Gi, 10Gi
		},
		Status: v1alpha1.VirtualClusterStatus{
			Phase: v1alpha1.PhaseReady,
		},
	}

	client := fake.NewClientBuilder().WithScheme(scheme).WithObjects(node1, vc1).Build()
	cap, err := GetClusterCapacity(context.Background(), client)
	if err != nil {
		t.Fatalf("GetClusterCapacity failed: %v", err)
	}

	if cap.AllocatableCPU.String() != "16" {
		t.Errorf("Expected 16 allocatable CPU, got %s", cap.AllocatableCPU.String())
	}
	if cap.RequestedCPU.String() != "1" {
		t.Errorf("Expected 1 requested CPU, got %s", cap.RequestedCPU.String())
	}
	if cap.AvailableCPU.String() != "15" {
		t.Errorf("Expected 15 available CPU, got %s", cap.AvailableCPU.String())
	}
	if len(cap.VClusters) != 1 {
		t.Errorf("Expected 1 vcluster, got %d", len(cap.VClusters))
	}
}

func TestDetectHardware(t *testing.T) {
	// Case 1: Node with NVIDIA A100 labels and allocatable GPUs
	nodeNvidia := corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "gpu-node-1",
			Labels: map[string]string{
				"nvidia.com/gpu.product": "NVIDIA-A100-SXM4-40GB",
			},
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceName("nvidia.com/gpu"): resource.MustParse("2"),
			},
			Capacity: corev1.ResourceList{
				corev1.ResourceName("nvidia.com/gpu"): resource.MustParse("2"),
			},
		},
	}

	model, vendor, total, alloc, hwStr := DetectHardware([]corev1.Node{nodeNvidia})
	if vendor != "NVIDIA" {
		t.Errorf("Expected NVIDIA vendor, got: %s", vendor)
	}
	if !strings.Contains(model, "A100") {
		t.Errorf("Expected model containing A100, got: %s", model)
	}
	if total != 2 || alloc != 2 {
		t.Errorf("Expected 2 GPUs, got total=%d, alloc=%d", total, alloc)
	}
	if !strings.Contains(hwStr, "CUDA") {
		t.Errorf("Expected CUDA in hardwareString, got: %s", hwStr)
	}

	// Case 2: Node without GPU (pure CPU cluster)
	nodeCPU := corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "cpu-node-1",
		},
		Status: corev1.NodeStatus{
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU: resource.MustParse("8"),
			},
		},
	}
	modelCPU, vendorCPU, totalCPU, _, hwStrCPU := DetectHardware([]corev1.Node{nodeCPU})
	// Note: if host machine has /proc/driver/nvidia, detectProcNvidiaGPU will find it.
	// But if running in isolated environment, it will be None / CPU.
	if totalCPU == 0 {
		if vendorCPU != "None" || modelCPU != "None" {
			t.Errorf("Expected None for CPU node, got vendor=%s, model=%s", vendorCPU, modelCPU)
		}
		if !strings.Contains(hwStrCPU, "CPU") {
			t.Errorf("Expected CPU in hardware string, got: %s", hwStrCPU)
		}
	} else {
		// Host GPU was detected via /proc
		if !strings.Contains(hwStrCPU, "CUDA") {
			t.Errorf("Expected CUDA in hardware string when host GPU is present, got: %s", hwStrCPU)
		}
	}
}

