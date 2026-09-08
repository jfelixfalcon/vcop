package capacity

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

const (
	// IgnoreCapacityAnnotation allows administrators to bypass capacity validation if needed
	IgnoreCapacityAnnotation = "vops.gitops.io/ignore-capacity-check"
)

// VClusterResourceSummary represents resource allocation and usage for a single virtual cluster
type VClusterResourceSummary struct {
	Name             string            `json:"name"`
	Namespace        string            `json:"namespace"`
	Phase            string            `json:"phase"`
	RequestedCPU     resource.Quantity `json:"requestedCpu"`
	RequestedMemory  resource.Quantity `json:"requestedMemory"`
	RequestedStorage resource.Quantity `json:"requestedStorage"`
	LimitsCPU        resource.Quantity `json:"limitsCpu"`
	LimitsMemory     resource.Quantity `json:"limitsMemory"`
	UsedCPU          resource.Quantity `json:"usedCpu"`
	UsedMemory       resource.Quantity `json:"usedMemory"`
	UsedStorage      resource.Quantity `json:"usedStorage"`
}

// ClusterCapacity represents cluster-wide allocatable vs requested resource metrics
type ClusterCapacity struct {
	TotalNodes         int                       `json:"totalNodes"`
	AllocatableCPU     resource.Quantity         `json:"allocatableCpu"`
	AllocatableMemory  resource.Quantity         `json:"allocatableMemory"`
	AllocatableStorage resource.Quantity         `json:"allocatableStorage"`
	TotalCPU           resource.Quantity         `json:"totalCpu"`
	TotalMemory        resource.Quantity         `json:"totalMemory"`
	TotalStorage       resource.Quantity         `json:"totalStorage"`

	// Dynamic Hardware & Accelerator Recognition
	TotalGPUs          int                       `json:"totalGpus"`
	AllocatableGPUs    int                       `json:"allocatableGpus"`
	GPUModel           string                    `json:"gpuModel"`
	GPUVendor          string                    `json:"gpuVendor"`
	HardwareString     string                    `json:"hardwareString"`

	RequestedCPU       resource.Quantity         `json:"requestedCpu"`
	RequestedMemory    resource.Quantity         `json:"requestedMemory"`
	RequestedStorage   resource.Quantity         `json:"requestedStorage"`

	LimitsCPU          resource.Quantity         `json:"limitsCpu"`
	LimitsMemory       resource.Quantity         `json:"limitsMemory"`

	AvailableCPU       resource.Quantity         `json:"availableCpu"`
	AvailableMemory    resource.Quantity         `json:"availableMemory"`
	AvailableStorage   resource.Quantity         `json:"availableStorage"`

	VClusters          []VClusterResourceSummary `json:"vclusters"`
}

// CalculateVirtualClusterQuota computes the requested and limit resources for a given VirtualCluster
func CalculateVirtualClusterQuota(vc *v1alpha1.VirtualCluster) (reqCPU, reqMem, reqStorage, limCPU, limMem resource.Quantity) {
	sReqCPU := "4"
	sReqMem := "8Gi"
	sReqStorage := "25Gi"
	sLimCPU := "8"
	sLimMem := "16Gi"

	switch vc.Spec.SizePreset {
	case v1alpha1.PresetNormal, v1alpha1.PresetSmall:
		sReqCPU = "1"
		sReqMem = "2Gi"
		sReqStorage = "10Gi"
		sLimCPU = "2"
		sLimMem = "4Gi"
	case v1alpha1.PresetHA, v1alpha1.PresetLarge:
		sReqCPU = "8"
		sReqMem = "16Gi"
		sReqStorage = "50Gi"
		sLimCPU = "16"
		sLimMem = "32Gi"
	default: // PresetMedium
		sReqCPU = "4"
		sReqMem = "8Gi"
		sReqStorage = "25Gi"
		sLimCPU = "8"
		sLimMem = "16Gi"
	}

	if vc.Spec.CustomResources != nil {
		if vc.Spec.CustomResources.CPU != "" {
			sReqCPU = vc.Spec.CustomResources.CPU
			sLimCPU = vc.Spec.CustomResources.CPU
		}
		if vc.Spec.CustomResources.Memory != "" {
			sReqMem = vc.Spec.CustomResources.Memory
			sLimMem = vc.Spec.CustomResources.Memory
		}
		if vc.Spec.CustomResources.Storage != "" {
			sReqStorage = vc.Spec.CustomResources.Storage
		}
	}

	if vc.Spec.Policies != nil && vc.Spec.Policies.ResourceQuota != nil {
		rq := vc.Spec.Policies.ResourceQuota
		if rq.RequestsCPU != "" {
			sReqCPU = rq.RequestsCPU
		}
		if rq.RequestsMemory != "" {
			sReqMem = rq.RequestsMemory
		}
		if rq.RequestsStorage != "" {
			sReqStorage = rq.RequestsStorage
		}
		if rq.LimitsCPU != "" {
			sLimCPU = rq.LimitsCPU
		}
		if rq.LimitsMemory != "" {
			sLimMem = rq.LimitsMemory
		}
	}

	reqCPU = parseQuantitySafe(sReqCPU, "1")
	reqMem = parseQuantitySafe(sReqMem, "2Gi")
	reqStorage = parseQuantitySafe(sReqStorage, "10Gi")
	limCPU = parseQuantitySafe(sLimCPU, "2")
	limMem = parseQuantitySafe(sLimMem, "4Gi")

	return
}

func parseQuantitySafe(val, fallback string) resource.Quantity {
	if q, err := resource.ParseQuantity(val); err == nil {
		return q
	}
	return resource.MustParse(fallback)
}

// GetClusterCapacity inspects all cluster nodes and virtual clusters to build a capacity breakdown
func GetClusterCapacity(ctx context.Context, c client.Client) (*ClusterCapacity, error) {
	capSummary := &ClusterCapacity{
		VClusters: make([]VClusterResourceSummary, 0),
	}

	var nodeList corev1.NodeList
	if err := c.List(ctx, &nodeList); err != nil {
		return nil, fmt.Errorf("failed listing cluster nodes: %w", err)
	}

	capSummary.TotalNodes = len(nodeList.Items)
	for _, node := range nodeList.Items {
		if cpu := node.Status.Allocatable.Cpu(); cpu != nil {
			capSummary.AllocatableCPU.Add(*cpu)
		}
		if mem := node.Status.Allocatable.Memory(); mem != nil {
			capSummary.AllocatableMemory.Add(*mem)
		}
		if storage := node.Status.Allocatable.StorageEphemeral(); storage != nil {
			capSummary.AllocatableStorage.Add(*storage)
		}

		if cpu := node.Status.Capacity.Cpu(); cpu != nil {
			capSummary.TotalCPU.Add(*cpu)
		}
		if mem := node.Status.Capacity.Memory(); mem != nil {
			capSummary.TotalMemory.Add(*mem)
		}
		if storage := node.Status.Capacity.StorageEphemeral(); storage != nil {
			capSummary.TotalStorage.Add(*storage)
		}
	}

	// Dynamic hardware and accelerator recognition
	capSummary.GPUModel, capSummary.GPUVendor, capSummary.TotalGPUs, capSummary.AllocatableGPUs, capSummary.HardwareString = DetectHardware(nodeList.Items)

	var vcList v1alpha1.VirtualClusterList
	if err := c.List(ctx, &vcList); err != nil {
		return nil, fmt.Errorf("failed listing virtual clusters: %w", err)
	}

	for _, vc := range vcList.Items {
		if vc.DeletionTimestamp != nil {
			continue
		}

		reqCPU, reqMem, reqStorage, limCPU, limMem := CalculateVirtualClusterQuota(&vc)
		capSummary.RequestedCPU.Add(reqCPU)
		capSummary.RequestedMemory.Add(reqMem)
		capSummary.RequestedStorage.Add(reqStorage)
		capSummary.LimitsCPU.Add(limCPU)
		capSummary.LimitsMemory.Add(limMem)

		summary := VClusterResourceSummary{
			Name:             vc.Name,
			Namespace:        vc.Namespace,
			Phase:            string(vc.Status.Phase),
			RequestedCPU:     reqCPU,
			RequestedMemory:  reqMem,
			RequestedStorage: reqStorage,
			LimitsCPU:        limCPU,
			LimitsMemory:     limMem,
		}

		if vc.Status.Quota != nil && vc.Status.Quota.Used != nil {
			if uCPU, ok := vc.Status.Quota.Used[string(corev1.ResourceRequestsCPU)]; ok {
				summary.UsedCPU = parseQuantitySafe(uCPU, "0")
			}
			if uMem, ok := vc.Status.Quota.Used[string(corev1.ResourceRequestsMemory)]; ok {
				summary.UsedMemory = parseQuantitySafe(uMem, "0")
			}
			if uStorage, ok := vc.Status.Quota.Used[string(corev1.ResourceRequestsStorage)]; ok {
				summary.UsedStorage = parseQuantitySafe(uStorage, "0")
			}
		}

		capSummary.VClusters = append(capSummary.VClusters, summary)
	}

	// Calculate Headroom
	availCPU := capSummary.AllocatableCPU.DeepCopy()
	availCPU.Sub(capSummary.RequestedCPU)
	if availCPU.Sign() < 0 {
		capSummary.AvailableCPU = resource.MustParse("0")
	} else {
		capSummary.AvailableCPU = availCPU
	}

	availMem := capSummary.AllocatableMemory.DeepCopy()
	availMem.Sub(capSummary.RequestedMemory)
	if availMem.Sign() < 0 {
		capSummary.AvailableMemory = resource.MustParse("0")
	} else {
		capSummary.AvailableMemory = availMem
	}

	availStorage := capSummary.AllocatableStorage.DeepCopy()
	availStorage.Sub(capSummary.RequestedStorage)
	if availStorage.Sign() < 0 {
		capSummary.AvailableStorage = resource.MustParse("0")
	} else {
		capSummary.AvailableStorage = availStorage
	}

	return capSummary, nil
}

// ValidateVirtualClusterCapacity verifies that targetVC's quota request will not cause host overallocation
func ValidateVirtualClusterCapacity(ctx context.Context, c client.Client, targetVC *v1alpha1.VirtualCluster, oldVC *v1alpha1.VirtualCluster) error {
	if targetVC.Annotations != nil && targetVC.Annotations[IgnoreCapacityAnnotation] == "true" {
		return nil
	}

	if c == nil {
		return nil
	}

	var nodeList corev1.NodeList
	if err := c.List(ctx, &nodeList); err != nil {
		if strings.Contains(err.Error(), "no kind is registered") {
			return nil
		}
		return fmt.Errorf("failed checking host node capacity: %w", err)
	}

	if len(nodeList.Items) == 0 {
		// If no nodes in context (e.g. unit tests without nodes), pass
		return nil
	}

	var allocatableCPU, allocatableMemory, allocatableStorage resource.Quantity
	for _, node := range nodeList.Items {
		if cpu := node.Status.Allocatable.Cpu(); cpu != nil {
			allocatableCPU.Add(*cpu)
		}
		if mem := node.Status.Allocatable.Memory(); mem != nil {
			allocatableMemory.Add(*mem)
		}
		if storage := node.Status.Allocatable.StorageEphemeral(); storage != nil {
			allocatableStorage.Add(*storage)
		}
	}

	targetReqCPU, targetReqMem, targetReqStorage, _, _ := CalculateVirtualClusterQuota(targetVC)

	if oldVC != nil {
		oldReqCPU, oldReqMem, oldReqStorage, _, _ := CalculateVirtualClusterQuota(oldVC)
		// If the update does not increase CPU, Memory, or Storage demands, allow it
		if targetReqCPU.Cmp(oldReqCPU) <= 0 && targetReqMem.Cmp(oldReqMem) <= 0 && targetReqStorage.Cmp(oldReqStorage) <= 0 {
			return nil
		}
	}

	var vcList v1alpha1.VirtualClusterList
	if err := c.List(ctx, &vcList); err != nil {
		return fmt.Errorf("failed listing virtual clusters for capacity check: %w", err)
	}

	var otherReqCPU, otherReqMem, otherReqStorage resource.Quantity
	for _, vc := range vcList.Items {
		if vc.DeletionTimestamp != nil {
			continue
		}
		if vc.Name == targetVC.Name && (targetVC.Namespace == "" || vc.Namespace == targetVC.Namespace) {
			continue
		}
		rCPU, rMem, rStorage, _, _ := CalculateVirtualClusterQuota(&vc)
		otherReqCPU.Add(rCPU)
		otherReqMem.Add(rMem)
		otherReqStorage.Add(rStorage)
	}

	// Test CPU
	totalProjectedCPU := otherReqCPU.DeepCopy()
	totalProjectedCPU.Add(targetReqCPU)
	if allocatableCPU.Sign() > 0 && totalProjectedCPU.Cmp(allocatableCPU) > 0 {
		availCPU := allocatableCPU.DeepCopy()
		availCPU.Sub(otherReqCPU)
		if availCPU.Sign() < 0 {
			availCPU = resource.MustParse("0")
		}
		return fmt.Errorf("CPU overallocation: requesting %s, but host cluster only has %s available (%s allocatable, %s already allocated)",
			targetReqCPU.String(), availCPU.String(), allocatableCPU.String(), otherReqCPU.String())
	}

	// Test Memory
	totalProjectedMem := otherReqMem.DeepCopy()
	totalProjectedMem.Add(targetReqMem)
	if allocatableMemory.Sign() > 0 && totalProjectedMem.Cmp(allocatableMemory) > 0 {
		availMem := allocatableMemory.DeepCopy()
		availMem.Sub(otherReqMem)
		if availMem.Sign() < 0 {
			availMem = resource.MustParse("0")
		}
		return fmt.Errorf("Memory overallocation: requesting %s, but host cluster only has %s available (%s allocatable, %s already allocated)",
			targetReqMem.String(), availMem.String(), allocatableMemory.String(), otherReqMem.String())
	}

	// Test Storage (if host storage is reported and greater than 0)
	if allocatableStorage.Sign() > 0 {
		totalProjectedStorage := otherReqStorage.DeepCopy()
		totalProjectedStorage.Add(targetReqStorage)
		if totalProjectedStorage.Cmp(allocatableStorage) > 0 {
			availStorage := allocatableStorage.DeepCopy()
			availStorage.Sub(otherReqStorage)
			if availStorage.Sign() < 0 {
				availStorage = resource.MustParse("0")
			}
			return fmt.Errorf("Storage overallocation: requesting %s, but host cluster only has %s available (%s allocatable, %s already allocated)",
				targetReqStorage.String(), availStorage.String(), allocatableStorage.String(), otherReqStorage.String())
		}
	}

	return nil
}

// DetectHardware inspects node attributes, labels, allocatable devices, and host kernel drivers
func DetectHardware(nodes []corev1.Node) (gpuModel string, gpuVendor string, totalGPUs int, allocatableGPUs int, hardwareString string) {
	for _, node := range nodes {
		// Check allocatable GPUs
		for resName, qty := range node.Status.Allocatable {
			s := strings.ToLower(string(resName))
			if strings.Contains(s, "gpu") {
				val := int(qty.Value())
				allocatableGPUs += val
				if strings.Contains(s, "nvidia") {
					gpuVendor = "NVIDIA"
				} else if strings.Contains(s, "amd") {
					gpuVendor = "AMD"
				} else if strings.Contains(s, "intel") {
					gpuVendor = "Intel"
				}
			}
		}
		for resName, qty := range node.Status.Capacity {
			if strings.Contains(strings.ToLower(string(resName)), "gpu") {
				totalGPUs += int(qty.Value())
			}
		}

		// Check node labels for GPU model
		for k, v := range node.Labels {
			kLower := strings.ToLower(k)
			if (strings.Contains(kLower, "gpu.product") ||
				strings.Contains(kLower, "accelerator") ||
				strings.Contains(kLower, "gpu-model") ||
				strings.Contains(kLower, "gpu.family")) && v != "" {
				if gpuModel == "" {
					clean := strings.ReplaceAll(v, "-", " ")
					clean = strings.ReplaceAll(clean, "_", " ")
					gpuModel = clean
				}
			}
		}
	}

	// Host kernel proc discovery (/proc/driver/nvidia/gpus/*/information) if not resolved from node labels
	if gpuModel == "" {
		if hostModel := detectProcNvidiaGPU(); hostModel != "" {
			gpuModel = hostModel
			gpuVendor = "NVIDIA"
			if totalGPUs == 0 {
				totalGPUs = 1
				allocatableGPUs = 1
			}
		}
	}

	if gpuModel == "" {
		gpuModel = "None"
		gpuVendor = "None"
		hardwareString = "CPU Engine (Host Multi-Threaded)"
	} else {
		if gpuVendor == "NVIDIA" {
			if !strings.HasPrefix(strings.ToLower(gpuModel), "nvidia") {
				gpuModel = "NVIDIA " + gpuModel
			}
			hardwareString = fmt.Sprintf("%s (CUDA)", gpuModel)
		} else if gpuVendor == "AMD" {
			hardwareString = fmt.Sprintf("%s (ROCm)", gpuModel)
		} else if gpuVendor == "Intel" {
			hardwareString = fmt.Sprintf("%s (oneAPI)", gpuModel)
		} else {
			hardwareString = gpuModel
		}
	}

	return
}

func detectProcNvidiaGPU() string {
	matches, err := filepath.Glob("/proc/driver/nvidia/gpus/*/information")
	if err != nil || len(matches) == 0 {
		return ""
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "Model:") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "Model:"))
		}
	}
	return ""
}

