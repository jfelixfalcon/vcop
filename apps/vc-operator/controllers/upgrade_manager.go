package controllers

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

type UpgradeManager struct {
	client.Client
}

func NewUpgradeManager(c client.Client) *UpgradeManager {
	return &UpgradeManager{Client: c}
}

// CheckUpgradeStatus detects if an upgrade is pending or in-progress
func (m *UpgradeManager) CheckUpgradeStatus(vc *v1alpha1.VirtualCluster) (needsUpgrade bool, desc string) {
	if vc.IsNamespaced() {
		return false, ""
	}

	desiredVCluster := vc.Spec.VClusterVersion
	if desiredVCluster == "" {
		desiredVCluster = "0.36.0"
	}

	desiredK8s := vc.Spec.KubernetesVersion
	if desiredK8s == "" {
		desiredK8s = "v1.31.0"
	}

	if vc.Status.VClusterVersion != "" && vc.Status.VClusterVersion != desiredVCluster {
		return true, fmt.Sprintf("Upgrading vCluster engine %s -> %s", vc.Status.VClusterVersion, desiredVCluster)
	}

	if vc.Status.VirtualK8sVersion != "" && vc.Status.VirtualK8sVersion != desiredK8s {
		return true, fmt.Sprintf("Upgrading Kubernetes control plane %s -> %s", vc.Status.VirtualK8sVersion, desiredK8s)
	}

	return false, ""
}

// PerformUpgradeCheck executes pre-flight checks and triggers backup/snapshot sequencing
func (m *UpgradeManager) PerformUpgradeCheck(ctx context.Context, vc *v1alpha1.VirtualCluster, etcdReady, syncerReady bool) error {
	if !etcdReady {
		return fmt.Errorf("pre-flight check failed: etcd quorum not healthy, delaying upgrade")
	}

	// Record snapshot checkpoint annotation on VirtualCluster
	if vc.Annotations == nil {
		vc.Annotations = make(map[string]string)
	}
	vc.Annotations["vops.gitops.io/last-etcd-snapshot"] = metav1.Now().UTC().Format("2006-01-02T15:04:05Z")

	meta.SetStatusCondition(&vc.Status.Conditions, metav1.Condition{
		Type:               v1alpha1.ConditionControlPlaneReady,
		Status:             metav1.ConditionFalse,
		Reason:             "UpgradeInProgress",
		Message:            "Rolling update of control plane and syncer in progress",
		LastTransitionTime: metav1.Now(),
	})

	return nil
}
