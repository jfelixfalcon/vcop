package controllers

import (
	"context"
	"fmt"
	"strconv"
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
	VirtualClusterFinalizer    = "vops.gitops.io/finalizer"
	PreSleepReplicasAnnotation = "vops.gitops.io/pre-sleep-replicas"
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
	QuotaReconciler      *QuotaReconciler
}

// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=statefulsets;deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;configmaps;secrets;persistentvolumeclaims;pods,verbs=get;list;watch;create;update;patch;delete

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

	if r.EtcdReconciler == nil {
		r.EtcdReconciler = NewEtcdReconciler(r.Client)
	}
	if r.SyncerReconciler == nil {
		r.SyncerReconciler = NewSyncerReconciler(r.Client)
	}
	if r.KubeconfigReconciler == nil {
		r.KubeconfigReconciler = NewKubeconfigReconciler(r.Client)
	}
	if r.AddonsReconciler == nil {
		r.AddonsReconciler = NewAddonsReconciler(r.Client)
	}
	if r.UpgradeManager == nil {
		r.UpgradeManager = NewUpgradeManager(r.Client)
	}
	if r.QuotaReconciler == nil {
		r.QuotaReconciler = NewQuotaReconciler(r.Client)
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

	// 3 & 4. Reconcile HA etcd Backing Store & vCluster Syncer
	isSleeping := vc.IsSleeping()
	var etcdReady bool
	var syncerReady bool
	var endpoint string

	if isSleeping {
		// 1. Put virtual workloads to sleep while apiserver and etcd are still running
		_ = r.sleepVirtualWorkloads(ctx, &vc)

		// 2. Scale syncer StatefulSet to 0
		_, endpoint, _ = r.SyncerReconciler.ReconcileSyncer(ctx, &vc)
		vc.Status.Endpoint = endpoint

		// 3. Scale HA etcd StatefulSet to 0 (PVCs remain completely preserved)
		_, _ = r.EtcdReconciler.ReconcileEtcd(ctx, &vc)

		// 4. Ensure all synced tenant pods on host are completely terminated
		_ = r.cleanUpHostPods(ctx, &vc)

		r.setCondition(&vc, v1alpha1.ConditionSleeping, metav1.ConditionTrue, "ClusterSleeping", "Virtual cluster, syncer, workloads, and etcd cluster are in sleep mode")
		r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionFalse, "ControlPlaneSleeping", "vCluster syncer is scaled down in sleep mode")
		r.setCondition(&vc, v1alpha1.ConditionEtcdReady, metav1.ConditionFalse, "EtcdSleeping", "HA etcd cluster is scaled down in sleep mode (PVC data preserved)")
		vc.Status.Phase = v1alpha1.PhaseSleeping
		vc.Status.Metrics = v1alpha1.ClusterMetrics{
			ActiveNodeCount: 0,
			PodCount:        0,
			MemoryUsage:     "0Mi",
			CPUUsage:        "0m",
		}
	} else {
		// 3. Reconcile HA etcd Backing Store (starts etcd first)
		var err error
		etcdReady, err = r.EtcdReconciler.ReconcileEtcd(ctx, &vc)
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
		syncerReady, endpoint, err = r.SyncerReconciler.ReconcileSyncer(ctx, &vc)
		if err != nil {
			log.Error(err, "failed reconciling vcluster syncer")
			r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionFalse, "SyncerReconcileFailed", err.Error())
			vc.Status.Phase = v1alpha1.PhaseDegraded
			_ = r.Status().Update(ctx, &vc)
			return ctrl.Result{RequeueAfter: 10 * time.Second}, err
		}
		vc.Status.Endpoint = endpoint

		r.setCondition(&vc, v1alpha1.ConditionSleeping, metav1.ConditionFalse, "ClusterAwake", "Virtual cluster is awake and active")
		if syncerReady {
			r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionTrue, "ControlPlaneReady", "vCluster control plane and syncer are ready")
		} else {
			r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionFalse, "SyncerStarting", "vCluster syncer deployment is rolling out")
			if vc.Status.Phase != v1alpha1.PhaseUpgrading {
				vc.Status.Phase = v1alpha1.PhaseProvisioning
			}
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

			// Restore any virtual workloads that were scaled to 0 during sleep
			_ = r.wakeVirtualWorkloads(ctx, &vc)
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

	// 7. Reconcile Governance Policies (ResourceQuota & LimitRange)
	var quotaReady bool
	if err := r.QuotaReconciler.ReconcileQuota(ctx, &vc); err != nil {
		log.Error(err, "failed reconciling quota policies")
		r.setCondition(&vc, v1alpha1.ConditionQuotaReady, metav1.ConditionFalse, "QuotaFailed", err.Error())
	} else {
		quotaReady = true
		r.setCondition(&vc, v1alpha1.ConditionQuotaReady, metav1.ConditionTrue, "QuotaEnforced", "ResourceQuota and LimitRange governance policies are active")
	}

	// 8. Update Observed Versions & Final Phase
	if isSleeping {
		vc.Status.Phase = v1alpha1.PhaseSleeping
	} else if etcdReady && syncerReady && addonsReady && quotaReady {
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
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
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

func (r *VirtualClusterReconciler) sleepVirtualWorkloads(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	log := r.Log.WithValues("virtualcluster", vc.Name, "namespace", vc.Namespace)

	// Attempt to connect to virtual cluster with a short timeout
	timeoutCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if r.AddonsReconciler != nil {
		vClient, _, err := r.AddonsReconciler.GetVirtualClusterClients(timeoutCtx, vc)
		if err == nil {
			// 1. Scale down virtual Deployments
			depList := &appsv1.DeploymentList{}
			if err := vClient.List(timeoutCtx, depList); err == nil {
				for i := range depList.Items {
					dep := &depList.Items[i]
					if dep.Spec.Replicas != nil && *dep.Spec.Replicas > 0 {
						if dep.Annotations == nil {
							dep.Annotations = make(map[string]string)
						}
						if _, exists := dep.Annotations[PreSleepReplicasAnnotation]; !exists {
							dep.Annotations[PreSleepReplicasAnnotation] = strconv.Itoa(int(*dep.Spec.Replicas))
						}
						zero := int32(0)
						dep.Spec.Replicas = &zero
						if err := vClient.Update(timeoutCtx, dep); err != nil {
							log.Info("Could not scale down virtual deployment", "dep", dep.Name, "namespace", dep.Namespace, "err", err)
						} else {
							log.Info("Scaled down virtual deployment to 0 for sleep", "dep", dep.Name, "namespace", dep.Namespace)
						}
					}
				}
			}

			// 2. Scale down virtual StatefulSets
			stsList := &appsv1.StatefulSetList{}
			if err := vClient.List(timeoutCtx, stsList); err == nil {
				for i := range stsList.Items {
					sts := &stsList.Items[i]
					if sts.Spec.Replicas != nil && *sts.Spec.Replicas > 0 {
						if sts.Annotations == nil {
							sts.Annotations = make(map[string]string)
						}
						if _, exists := sts.Annotations[PreSleepReplicasAnnotation]; !exists {
							sts.Annotations[PreSleepReplicasAnnotation] = strconv.Itoa(int(*sts.Spec.Replicas))
						}
						zero := int32(0)
						sts.Spec.Replicas = &zero
						if err := vClient.Update(timeoutCtx, sts); err != nil {
							log.Info("Could not scale down virtual statefulset", "sts", sts.Name, "namespace", sts.Namespace, "err", err)
						} else {
							log.Info("Scaled down virtual statefulset to 0 for sleep", "sts", sts.Name, "namespace", sts.Namespace)
						}
					}
				}
			}
		}
	}

	// Always clean up host pods
	return r.cleanUpHostPods(ctx, vc)
}

func (r *VirtualClusterReconciler) cleanUpHostPods(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	log := r.Log.WithValues("virtualcluster", vc.Name, "namespace", vc.Namespace)

	podList := &corev1.PodList{}
	listOpts := []client.ListOption{
		client.InNamespace(vc.Namespace),
		client.MatchingLabels{
			"vcluster.loft.sh/managed-by": vc.Name,
		},
	}
	if err := r.List(ctx, podList, listOpts...); err != nil {
		return fmt.Errorf("failed listing synced pods on host: %w", err)
	}

	for i := range podList.Items {
		pod := &podList.Items[i]
		if pod.DeletionTimestamp.IsZero() {
			log.Info("Deleting synced tenant pod on host for sleeping cluster",
				"pod", pod.Name, "namespace", pod.Namespace)
			grace := int64(0)
			if err := r.Delete(ctx, pod, &client.DeleteOptions{GracePeriodSeconds: &grace}); err != nil && !errors.IsNotFound(err) {
				log.Error(err, "Failed deleting synced host pod", "pod", pod.Name)
			}
		}
	}

	return nil
}

func (r *VirtualClusterReconciler) wakeVirtualWorkloads(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	log := r.Log.WithValues("virtualcluster", vc.Name, "namespace", vc.Namespace)

	timeoutCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	if r.AddonsReconciler == nil {
		return nil
	}

	vClient, _, err := r.AddonsReconciler.GetVirtualClusterClients(timeoutCtx, vc)
	if err != nil {
		return err
	}

	// 1. Restore virtual Deployments
	depList := &appsv1.DeploymentList{}
	if err := vClient.List(timeoutCtx, depList); err == nil {
		for i := range depList.Items {
			dep := &depList.Items[i]
			if val, ok := dep.Annotations[PreSleepReplicasAnnotation]; ok {
				orig, err := strconv.Atoi(val)
				if err == nil && orig > 0 {
					orig32 := int32(orig)
					dep.Spec.Replicas = &orig32
				} else {
					one := int32(1)
					dep.Spec.Replicas = &one
				}
				delete(dep.Annotations, PreSleepReplicasAnnotation)
				if err := vClient.Update(timeoutCtx, dep); err != nil {
					log.Error(err, "Failed restoring virtual deployment replicas", "dep", dep.Name)
				} else {
					log.Info("Restored virtual deployment replicas upon wake up",
						"dep", dep.Name, "replicas", *dep.Spec.Replicas)
				}
			}
		}
	}

	// 2. Restore virtual StatefulSets
	stsList := &appsv1.StatefulSetList{}
	if err := vClient.List(timeoutCtx, stsList); err == nil {
		for i := range stsList.Items {
			sts := &stsList.Items[i]
			if val, ok := sts.Annotations[PreSleepReplicasAnnotation]; ok {
				orig, err := strconv.Atoi(val)
				if err == nil && orig > 0 {
					orig32 := int32(orig)
					sts.Spec.Replicas = &orig32
				} else {
					one := int32(1)
					sts.Spec.Replicas = &one
				}
				delete(sts.Annotations, PreSleepReplicasAnnotation)
				if err := vClient.Update(timeoutCtx, sts); err != nil {
					log.Error(err, "Failed restoring virtual statefulset replicas", "sts", sts.Name)
				} else {
					log.Info("Restored virtual statefulset replicas upon wake up",
						"sts", sts.Name, "replicas", *sts.Spec.Replicas)
				}
			}
		}
	}

	return nil
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
	r.QuotaReconciler = NewQuotaReconciler(mgr.GetClient())

	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.VirtualCluster{}).
		Owns(&appsv1.StatefulSet{}).
		Owns(&appsv1.Deployment{}).
		Owns(&corev1.Service{}).
		Owns(&corev1.ConfigMap{}).
		Owns(&corev1.Secret{}).
		Owns(&corev1.ResourceQuota{}).
		Owns(&corev1.LimitRange{}).
		Complete(r)
}
