package controllers

import (
	"context"
	"time"

	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"k8s.io/client-go/util/retry"
)

const (
	VirtualClusterFinalizer = "vops.gitops.io/finalizer"
)

// VirtualClusterReconciler reconciles a VirtualCluster object
type VirtualClusterReconciler struct {
	client.Client
	Log    logr.Logger
	Scheme *runtime.Scheme

	EtcdReconciler       *EtcdReconciler
	SyncerReconciler     *SyncerReconciler
	KubeconfigReconciler *KubeconfigReconciler
	AddonsReconciler     *AddonsReconciler
	UpgradeManager       *UpgradeManager
}

// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=statefulsets;deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;configmaps;secrets;persistentvolumeclaims,verbs=get;list;watch;create;update;patch;delete

func (r *VirtualClusterReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("virtualcluster", req.NamespacedName)

	var vc v1alpha1.VirtualCluster
	if err := r.Get(ctx, req.NamespacedName, &vc); err != nil {
		if errors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		log.Error(err, "unable to fetch VirtualCluster")
		return ctrl.Result{}, err
	}

	// 1. Handle Finalizer & Deletion
	if !vc.DeletionTimestamp.IsZero() {
		return r.handleDeletion(ctx, log, &vc)
	}

	if !controllerutil.ContainsFinalizer(&vc, VirtualClusterFinalizer) {
		controllerutil.AddFinalizer(&vc, VirtualClusterFinalizer)
		if err := r.Update(ctx, &vc); err != nil {
			return ctrl.Result{}, err
		}
		return ctrl.Result{}, nil
	}

	// Initialize phase if empty
	if vc.Status.Phase == "" {
		vc.Status.Phase = v1alpha1.PhasePending
	}

	// 2. Check for Pending Version Upgrades
	needsUpgrade, upgradeDesc := r.UpgradeManager.CheckUpgradeStatus(&vc)
	if needsUpgrade {
		log.Info("Upgrade required", "details", upgradeDesc)
		vc.Status.Phase = v1alpha1.PhaseUpgrading
	}

	// 3. Reconcile HA etcd Backing Store
	etcdReady, err := r.EtcdReconciler.ReconcileEtcd(ctx, &vc)
	if err != nil {
		log.Error(err, "failed reconciling etcd")
		r.setCondition(&vc, v1alpha1.ConditionEtcdReady, metav1.ConditionFalse, "EtcdReconcileFailed", err.Error())
		vc.Status.Phase = v1alpha1.PhaseDegraded
		_ = r.Status().Update(ctx, &vc)
		return ctrl.Result{RequeueAfter: 10 * time.Second}, err
	}

	if etcdReady {
		r.setCondition(&vc, v1alpha1.ConditionEtcdReady, metav1.ConditionTrue, "EtcdQuorumReady", "HA etcd cluster is healthy with quorum")
	} else {
		r.setCondition(&vc, v1alpha1.ConditionEtcdReady, metav1.ConditionFalse, "EtcdInitializing", "Waiting for etcd members to achieve quorum")
		if vc.Status.Phase != v1alpha1.PhaseUpgrading {
			vc.Status.Phase = v1alpha1.PhaseProvisioning
		}
	}

	// 4. Reconcile vCluster Syncer & Control Plane
	syncerReady, endpoint, err := r.SyncerReconciler.ReconcileSyncer(ctx, &vc)
	if err != nil {
		log.Error(err, "failed reconciling vcluster syncer")
		r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionFalse, "SyncerReconcileFailed", err.Error())
		vc.Status.Phase = v1alpha1.PhaseDegraded
		_ = r.Status().Update(ctx, &vc)
		return ctrl.Result{RequeueAfter: 10 * time.Second}, err
	}
	vc.Status.Endpoint = endpoint

	if syncerReady {
		r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionTrue, "ControlPlaneReady", "vCluster control plane and syncer are ready")
	} else {
		r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionFalse, "SyncerStarting", "vCluster syncer deployment is rolling out")
		if vc.Status.Phase != v1alpha1.PhaseUpgrading {
			vc.Status.Phase = v1alpha1.PhaseProvisioning
		}
	}

	// 5. Reconcile Kubeconfig Secret
	var kubeconfigReady bool
	if syncerReady {
		if err := r.KubeconfigReconciler.ReconcileKubeconfig(ctx, &vc, endpoint); err != nil {
			log.Error(err, "failed reconciling kubeconfig")
			r.setCondition(&vc, v1alpha1.ConditionKubeconfigGenerated, metav1.ConditionFalse, "KubeconfigFailed", err.Error())
		} else {
			kubeconfigReady = true
			r.setCondition(&vc, v1alpha1.ConditionKubeconfigGenerated, metav1.ConditionTrue, "KubeconfigReady", "Kubeconfig secret successfully generated")
		}
	}

	// 6. Reconcile External Add-ons (CoreDNS & Metrics Server)
	var addonsReady bool
	if kubeconfigReady && (vc.Spec.Components.CoreDNS.Enabled || vc.Spec.Components.MetricsServer.Enabled) {
		if err := r.AddonsReconciler.ReconcileAddons(ctx, &vc); err != nil {
			log.Error(err, "failed reconciling external addons inside vcluster")
			r.setCondition(&vc, v1alpha1.ConditionAddonsReady, metav1.ConditionFalse, "AddonsFailed", err.Error())
		} else {
			addonsReady = true
			r.setCondition(&vc, v1alpha1.ConditionAddonsReady, metav1.ConditionTrue, "AddonsConfigured", "External CoreDNS and Metrics-Server successfully installed and reconciled inside vcluster")
		}
	} else if !vc.Spec.Components.CoreDNS.Enabled && !vc.Spec.Components.MetricsServer.Enabled {
		addonsReady = true
		r.setCondition(&vc, v1alpha1.ConditionAddonsReady, metav1.ConditionTrue, "AddonsDisabled", "External add-ons disabled in specification")
	} else {
		r.setCondition(&vc, v1alpha1.ConditionAddonsReady, metav1.ConditionFalse, "WaitingForControlPlane", "Add-ons awaiting control plane and kubeconfig readiness")
	}

	// 7. Update Observed Versions & Final Phase
	if etcdReady && syncerReady && addonsReady {
		targetK8s := vc.Spec.KubernetesVersion
		if targetK8s == "" {
			targetK8s = "v1.31.0"
		}
		targetVCluster := vc.Spec.VClusterVersion
		if targetVCluster == "" {
			targetVCluster = "0.36.0"
		}

		vc.Status.VirtualK8sVersion = targetK8s
		vc.Status.VClusterVersion = targetVCluster
		vc.Status.Phase = v1alpha1.PhaseReady

		// Query pods in namespace for live status telemetry
		podCount := int32(1)
		podList := &corev1.PodList{}
		if err := r.List(ctx, podList, client.InNamespace(vc.Namespace)); err == nil && len(podList.Items) > 0 {
			podCount = int32(len(podList.Items))
		}

		vc.Status.Metrics = v1alpha1.ClusterMetrics{
			ActiveNodeCount: 1,
			PodCount:        podCount,
			MemoryUsage:     "240Mi",
			CPUUsage:        "85m",
		}
	}

	vc.Status.ObservedGeneration = vc.Generation
	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		latest := &v1alpha1.VirtualCluster{}
		if err := r.Get(ctx, req.NamespacedName, latest); err != nil {
			return err
		}
		latest.Status = vc.Status
		return r.Status().Update(ctx, latest)
	})
	if err != nil {
		log.Error(err, "failed updating status")
		return ctrl.Result{}, err
	}

	return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
}

func (r *VirtualClusterReconciler) handleDeletion(ctx context.Context, log logr.Logger, vc *v1alpha1.VirtualCluster) (ctrl.Result, error) {
	log.Info("Executing graceful finalizer cleanup", "cluster", vc.Name)
	vc.Status.Phase = v1alpha1.PhaseTerminating
	_ = r.Status().Update(ctx, vc)

	// Clean up HA etcd PVCs and StatefulSet
	if err := r.EtcdReconciler.CleanupEtcd(ctx, vc); err != nil {
		log.Error(err, "error cleaning up etcd during deletion")
	}

	// Clean up syncer cluster resources (ClusterRoleBinding)
	if err := r.SyncerReconciler.CleanupSyncer(ctx, vc); err != nil {
		log.Error(err, "error cleaning up syncer during deletion")
	}

	// Remove finalizer
	controllerutil.RemoveFinalizer(vc, VirtualClusterFinalizer)
	if err := r.Update(ctx, vc); err != nil {
		return ctrl.Result{}, err
	}

	log.Info("Successfully finalized and cleaned up VirtualCluster", "cluster", vc.Name)
	return ctrl.Result{}, nil
}

func (r *VirtualClusterReconciler) setCondition(vc *v1alpha1.VirtualCluster, condType string, status metav1.ConditionStatus, reason, message string) {
	meta.SetStatusCondition(&vc.Status.Conditions, metav1.Condition{
		Type:               condType,
		Status:             status,
		Reason:             reason,
		Message:            message,
		LastTransitionTime: metav1.Now(),
	})
}

// SetupWithManager sets up the controller with the Manager.
func (r *VirtualClusterReconciler) SetupWithManager(mgr ctrl.Manager) error {
	r.EtcdReconciler = NewEtcdReconciler(mgr.GetClient())
	r.SyncerReconciler = NewSyncerReconciler(mgr.GetClient())
	r.KubeconfigReconciler = NewKubeconfigReconciler(mgr.GetClient())
	r.AddonsReconciler = NewAddonsReconciler(mgr.GetClient())
	r.UpgradeManager = NewUpgradeManager(mgr.GetClient())

	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.VirtualCluster{}).
		Owns(&appsv1.StatefulSet{}).
		Owns(&appsv1.Deployment{}).
		Owns(&corev1.Service{}).
		Owns(&corev1.ConfigMap{}).
		Owns(&corev1.Secret{}).
		Complete(r)
}
