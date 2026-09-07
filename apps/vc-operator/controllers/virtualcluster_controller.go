package controllers

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
	"github.com/vops/vc-operator/pkg/capacity"
	"k8s.io/client-go/tools/record"
	"k8s.io/client-go/util/retry"
)

const (
	VirtualClusterFinalizer    = "vops.gitops.io/finalizer"
	PreSleepReplicasAnnotation = "vops.gitops.io/pre-sleep-replicas"
)

// VirtualClusterReconciler reconciles a VirtualCluster object
type VirtualClusterReconciler struct {
	client.Client
	Log      logr.Logger
	Scheme   *runtime.Scheme
	Recorder record.EventRecorder

	EtcdReconciler       *EtcdReconciler
	SyncerReconciler     *SyncerReconciler
	KubeconfigReconciler *KubeconfigReconciler
	AddonsReconciler     *AddonsReconciler
	UpgradeManager       *UpgradeManager
	QuotaReconciler      *QuotaReconciler
	RBACReconciler       *RBACReconciler
	IstioReconciler      *IstioReconciler
	DisasterRecoveryReconciler *DisasterRecoveryReconciler
}

// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=statefulsets;deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;configmaps;secrets;persistentvolumeclaims;pods;resourcequotas;limitranges,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=coordination.k8s.io,resources=leases,verbs=get;list;watch;create;update;patch;delete

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

	log.Info("Starting reconciliation cycle", "cluster", vc.Name, "namespace", vc.Namespace, "currentPhase", vc.Status.Phase, "generation", vc.Generation)

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
	if r.RBACReconciler == nil {
		r.RBACReconciler = NewRBACReconciler(r.Client)
	}
	if r.IstioReconciler == nil {
		r.IstioReconciler = NewIstioReconciler(r.Client, r.AddonsReconciler)
	}
	if r.DisasterRecoveryReconciler == nil {
		r.DisasterRecoveryReconciler = NewDisasterRecoveryReconciler(r.Client)
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

	// 2.5 Check Host Capacity & Overallocation Guardrails
	if err := capacity.ValidateVirtualClusterCapacity(ctx, r.Client, &vc, nil); err != nil {
		log.Info("Host capacity overallocation detected", "cluster", vc.Name, "error", err.Error())
		r.setCondition(&vc, v1alpha1.ConditionCapacityAvailable, metav1.ConditionFalse, "HostCapacityExceeded", err.Error())
		if vc.Status.Phase == v1alpha1.PhasePending || vc.Status.Phase == v1alpha1.PhaseProvisioning {
			vc.Status.Phase = v1alpha1.PhaseDegraded
			_ = r.Status().Update(ctx, &vc)
			return ctrl.Result{RequeueAfter: 30 * time.Second}, nil
		}
	} else {
		r.setCondition(&vc, v1alpha1.ConditionCapacityAvailable, metav1.ConditionTrue, "CapacityAvailable", "Host cluster has sufficient allocatable compute and storage for requested quota")
	}

	// 2.8 Reconcile Disaster Recovery Storage & Automated Backups
	if err := r.DisasterRecoveryReconciler.ReconcileDisasterRecovery(ctx, &vc); err != nil {
		log.Error(err, "failed reconciling disaster recovery backups")
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionFalse, "DisasterRecoveryFailed", err.Error())
	} else if vc.Spec.DisasterRecovery != nil && vc.Spec.DisasterRecovery.Enabled {
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionTrue, "BackupsConfigured", fmt.Sprintf("Automated etcd backups configured with %s schedule", vc.Spec.DisasterRecovery.Schedule))
	} else {
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionTrue, "DisasterRecoveryDisabled", "Automated backups disabled")
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

	// 8. Reconcile Guest RBAC Delegation (ClusterRoleBinding for owner, allowed-emails, and allowed-groups)
	var rbacReady bool
	if kubeconfigReady {
		if err := r.RBACReconciler.ReconcileGuestRBAC(ctx, &vc); err != nil {
			log.Error(err, "failed reconciling guest cluster RBAC")
			r.setCondition(&vc, v1alpha1.ConditionRBACReady, metav1.ConditionFalse, "RBACReconcileFailed", err.Error())
		} else {
			rbacReady = true
			r.setCondition(&vc, v1alpha1.ConditionRBACReady, metav1.ConditionTrue, "RBACConfigured", "Guest cluster RBAC role bindings successfully reconciled")
		}
	} else {
		r.setCondition(&vc, v1alpha1.ConditionRBACReady, metav1.ConditionFalse, "WaitingForControlPlane", "RBAC delegation awaiting control plane and kubeconfig readiness")
	}

	// 9. Reconcile Opinionated Application Entrypoint (Istio & TLS)
	var istioReady bool = true
	if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Enabled {
		if !kubeconfigReady {
			r.setCondition(&vc, v1alpha1.ConditionIstioReady, metav1.ConditionFalse, "WaitingForControlPlane", "Istio ingress awaiting control plane readiness")
			istioReady = false
		} else {
			ready, err := r.IstioReconciler.ReconcileIstio(ctx, &vc)
			if err != nil {
				log.Error(err, "failed reconciling opinionated Istio entrypoint")
				r.setCondition(&vc, v1alpha1.ConditionIstioReady, metav1.ConditionFalse, "IstioReconcileFailed", err.Error())
				// Abort deployment and mark Degraded if issuer does not exist or validation failed
				vc.Status.Phase = v1alpha1.PhaseDegraded
				_ = r.Status().Update(ctx, &vc)
				return ctrl.Result{RequeueAfter: 30 * time.Second}, err
			}
			istioReady = ready
			if ready {
				r.setCondition(&vc, v1alpha1.ConditionIstioReady, metav1.ConditionTrue, "IstioConfigured", "Istio control plane, ingress gateway, and VirtualService entrypoint are active")
			} else {
				r.setCondition(&vc, v1alpha1.ConditionIstioReady, metav1.ConditionFalse, "IstioStarting", "Istio ingress rollout in progress")
			}
		}
	}
	log.Info("Component status", "cluster", vc.Name, "etcd", etcdReady, "syncer", syncerReady, "kubeconfig", kubeconfigReady, "addons", addonsReady, "quota", quotaReady, "rbac", rbacReady, "istio", istioReady)

	// 10. Update Observed Versions & Final Phase
	previousPhase := vc.Status.Phase
	if isSleeping {
		vc.Status.Phase = v1alpha1.PhaseSleeping
	} else if etcdReady && syncerReady && addonsReady && quotaReady && rbacReady && istioReady {
		targetK8s := vc.Spec.KubernetesVersion
		if targetK8s == "" {
			targetK8s = "v1.31.0"
		}
		targetVCluster := vc.Spec.VClusterVersion
		if targetVCluster == "" {
			targetVCluster = "0.36.0"
		}

		targetEtcd := vc.Spec.EtcdVersion
		if targetEtcd == "" {
			targetEtcd = "3.6.8-0"
		}
		targetCoreDNS := vc.Spec.Components.CoreDNS.Version
		if targetCoreDNS == "" {
			targetCoreDNS = "v1.11.3"
		}
		targetMetrics := vc.Spec.Components.MetricsServer.Version
		if targetMetrics == "" {
			targetMetrics = "v0.7.2"
		}
		targetIstio := ""
		if vc.Spec.Components.Istio != nil && vc.Spec.Components.Istio.Enabled {
			targetIstio = vc.Spec.Components.Istio.Version
			if targetIstio == "" {
				targetIstio = "1.24.2"
			}
		}

		vc.Status.VirtualK8sVersion = targetK8s
		vc.Status.VClusterVersion = targetVCluster
		vc.Status.ComponentVersions = &v1alpha1.ComponentVersionsStatus{
			Etcd:          targetEtcd,
			CoreDNS:       targetCoreDNS,
			MetricsServer: targetMetrics,
			Istio:         targetIstio,
		}
		vc.Status.Phase = v1alpha1.PhaseReady
		if previousPhase != v1alpha1.PhaseReady {
			log.Info("Virtual cluster transitioned to Ready", "cluster", vc.Name, "previousPhase", previousPhase)
			if r.Recorder != nil {
				r.Recorder.Event(&vc, corev1.EventTypeNormal, "ClusterReady", "VirtualCluster control plane, addons, governance, and ingress are Active and Ready")
			}
		}
	} else {
		var pending []string
		if !etcdReady {
			pending = append(pending, "etcd")
		}
		if !syncerReady {
			pending = append(pending, "syncer")
		}
		if !addonsReady {
			pending = append(pending, "addons")
		}
		if !quotaReady {
			pending = append(pending, "quota")
		}
		if !rbacReady {
			pending = append(pending, "rbac")
		}
		if !istioReady {
			pending = append(pending, "istio")
		}
		log.Info("Virtual cluster components syncing / pending", "cluster", vc.Name, "phase", vc.Status.Phase, "pending", pending)
	}

	if !isSleeping {
		vc.Status.Metrics = r.calculateMetrics(ctx, &vc)
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

	requeueDuration := 30 * time.Second
	if !isSleeping && (!addonsReady || !quotaReady || !rbacReady || !istioReady) {
		requeueDuration = 10 * time.Second
	}

	return ctrl.Result{RequeueAfter: requeueDuration}, nil
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
	existing := meta.FindStatusCondition(vc.Status.Conditions, condType)
	meta.SetStatusCondition(&vc.Status.Conditions, metav1.Condition{
		Type:               condType,
		Status:             status,
		Reason:             reason,
		Message:            message,
		LastTransitionTime: metav1.Now(),
	})
	if r.Recorder != nil && (existing == nil || existing.Status != status || existing.Reason != reason) {
		eventType := corev1.EventTypeNormal
		if status == metav1.ConditionFalse && reason != "ClusterAwake" && reason != "AddonsDisabled" {
			eventType = corev1.EventTypeWarning
		}
		r.Recorder.Event(vc, eventType, reason, message)
	}
}

// SetupWithManager sets up the controller with the Manager.
func (r *VirtualClusterReconciler) SetupWithManager(mgr ctrl.Manager) error {
	r.Recorder = mgr.GetEventRecorderFor("virtualcluster-controller")
	r.EtcdReconciler = NewEtcdReconciler(mgr.GetClient())
	r.SyncerReconciler = NewSyncerReconciler(mgr.GetClient())
	r.KubeconfigReconciler = NewKubeconfigReconciler(mgr.GetClient())
	r.AddonsReconciler = NewAddonsReconciler(mgr.GetClient())
	r.UpgradeManager = NewUpgradeManager(mgr.GetClient())
	r.QuotaReconciler = NewQuotaReconciler(mgr.GetClient())
	r.RBACReconciler = NewRBACReconciler(mgr.GetClient())
	r.IstioReconciler = NewIstioReconciler(mgr.GetClient(), r.AddonsReconciler)
	r.DisasterRecoveryReconciler = NewDisasterRecoveryReconciler(mgr.GetClient())

	return ctrl.NewControllerManagedBy(mgr).
		For(&v1alpha1.VirtualCluster{}).
		Owns(&appsv1.StatefulSet{}).
		Owns(&appsv1.Deployment{}).
		Owns(&corev1.Service{}).
		Owns(&corev1.ConfigMap{}).
		Owns(&corev1.Secret{}).
		Owns(&corev1.ResourceQuota{}).
		Owns(&corev1.LimitRange{}).
		Owns(&batchv1.CronJob{}).
		Complete(r)
}

func (r *VirtualClusterReconciler) calculateMetrics(ctx context.Context, vc *v1alpha1.VirtualCluster) v1alpha1.ClusterMetrics {
	if vc.IsSleeping() || vc.Status.Phase == v1alpha1.PhaseSleeping {
		return v1alpha1.ClusterMetrics{
			ActiveNodeCount: 0,
			PodCount:        0,
			MemoryUsage:     "0Mi",
			CPUUsage:        "0m",
		}
	}

	activeNodes := int32(1)
	podCount := int32(0)
	var totalCpuMillis int64
	var totalMemBytes int64
	metricsFound := false

	// Attempt to query virtual cluster internal metrics server & pod/node lists
	if r.AddonsReconciler != nil {
		vCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()

		vClient, dynClient, err := r.AddonsReconciler.GetVirtualClusterClients(vCtx, vc)
		if err == nil && vClient != nil {
			// 1. Query nodes inside virtual cluster
			var nodeList corev1.NodeList
			if err := vClient.List(vCtx, &nodeList); err == nil && len(nodeList.Items) > 0 {
				activeNodes = int32(len(nodeList.Items))
			}

			// 2. Query pods inside virtual cluster
			var vPodList corev1.PodList
			if err := vClient.List(vCtx, &vPodList); err == nil {
				podCount = int32(len(vPodList.Items))
			}

			// 3. Query live metrics from metrics-server (metrics.k8s.io/v1beta1)
			if dynClient != nil {
				gvr := schema.GroupVersionResource{
					Group:    "metrics.k8s.io",
					Version:  "v1beta1",
					Resource: "pods",
				}
				podMetricsList, mErr := dynClient.Resource(gvr).List(vCtx, metav1.ListOptions{})
				if mErr == nil && len(podMetricsList.Items) > 0 {
					var rawCpuNanos int64
					var rawMemBytes int64
					for _, item := range podMetricsList.Items {
						containers, ok, _ := unstructured.NestedSlice(item.Object, "containers")
						if !ok {
							continue
						}
						for _, c := range containers {
							cMap, ok := c.(map[string]interface{})
							if !ok {
								continue
							}
							usage, ok, _ := unstructured.NestedMap(cMap, "usage")
							if !ok {
								continue
							}
							if cpuStr, ok := usage["cpu"].(string); ok {
								if q, err := resource.ParseQuantity(cpuStr); err == nil {
									rawCpuNanos += q.ScaledValue(resource.Nano)
								}
							}
							if memStr, ok := usage["memory"].(string); ok {
								if q, err := resource.ParseQuantity(memStr); err == nil {
									rawMemBytes += q.Value()
								}
							}
						}
					}
					totalCpuMillis = (rawCpuNanos + 500000) / 1000000
					if totalCpuMillis == 0 && rawCpuNanos > 0 {
						totalCpuMillis = 1
					}
					totalMemBytes = rawMemBytes
					metricsFound = true
				}
			}

			// 4. Fallback if metrics-server hasn't collected yet: sum container requests/limits
			if !metricsFound && len(vPodList.Items) > 0 {
				for _, pod := range vPodList.Items {
					if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
						continue
					}
					for _, c := range pod.Spec.Containers {
						if reqCpu := c.Resources.Requests.Cpu(); reqCpu != nil && reqCpu.MilliValue() > 0 {
							totalCpuMillis += reqCpu.MilliValue()
						} else if limCpu := c.Resources.Limits.Cpu(); limCpu != nil && limCpu.MilliValue() > 0 {
							totalCpuMillis += limCpu.MilliValue() / 2
						} else {
							totalCpuMillis += 10
						}

						if reqMem := c.Resources.Requests.Memory(); reqMem != nil && reqMem.Value() > 0 {
							totalMemBytes += reqMem.Value()
						} else if limMem := c.Resources.Limits.Memory(); limMem != nil && limMem.Value() > 0 {
							totalMemBytes += limMem.Value() / 2
						} else {
							totalMemBytes += 32 * 1024 * 1024
						}
					}
				}
				metricsFound = true
			}
		}
	}

	// 5. Host-side fallback if vClient could not be reached
	if !metricsFound || podCount == 0 {
		var hostPods corev1.PodList
		if err := r.List(ctx, &hostPods, client.InNamespace(vc.Namespace)); err == nil {
			var guestPodsCount int32
			for _, pod := range hostPods.Items {
				if pod.Labels["vcluster.loft.sh/managed-by"] == vc.Name {
					guestPodsCount++
					if !metricsFound {
						for _, c := range pod.Spec.Containers {
							if reqCpu := c.Resources.Requests.Cpu(); reqCpu != nil && reqCpu.MilliValue() > 0 {
								totalCpuMillis += reqCpu.MilliValue()
							}
							if reqMem := c.Resources.Requests.Memory(); reqMem != nil && reqMem.Value() > 0 {
								totalMemBytes += reqMem.Value()
							}
						}
					}
				}
			}
			if guestPodsCount > 0 {
				podCount = guestPodsCount
			} else if len(hostPods.Items) > 0 {
				podCount = int32(len(hostPods.Items))
			}
		}
	}

	// Format strings cleanly
	cpuUsageStr := fmt.Sprintf("%dm", totalCpuMillis)
	var memUsageStr string
	if totalMemBytes >= 1024*1024*1024 {
		memUsageStr = fmt.Sprintf("%.1fGi", float64(totalMemBytes)/(1024*1024*1024))
	} else {
		memUsageStr = fmt.Sprintf("%dMi", totalMemBytes/(1024*1024))
	}

	return v1alpha1.ClusterMetrics{
		ActiveNodeCount: activeNodes,
		PodCount:        podCount,
		MemoryUsage:     memUsageStr,
		CPUUsage:        cpuUsageStr,
	}
}
