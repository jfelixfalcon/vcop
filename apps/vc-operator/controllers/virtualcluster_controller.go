package controllers

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
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
	"github.com/vops/vc-operator/pkg/registry"
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

	EtcdReconciler             *EtcdReconciler
	SyncerReconciler           *SyncerReconciler
	KubeconfigReconciler       *KubeconfigReconciler
	AddonsReconciler           *AddonsReconciler
	UpgradeManager             *UpgradeManager
	QuotaReconciler            *QuotaReconciler
	RBACReconciler             *RBACReconciler
	IstioReconciler            *IstioReconciler
	GatewayAPIReconciler       *GatewayAPIReconciler
	DisasterRecoveryReconciler *DisasterRecoveryReconciler
}

// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=vops.gitops.io,resources=virtualclusters/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=statefulsets;deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=services;configmaps;secrets;persistentvolumeclaims;pods;resourcequotas;limitranges;namespaces;serviceaccounts,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=rbac.authorization.k8s.io,resources=roles;rolebindings;clusterroles;clusterrolebindings,verbs=get;list;watch;create;update;patch;delete
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
	if r.GatewayAPIReconciler == nil {
		r.GatewayAPIReconciler = NewGatewayAPIReconciler(r.Client, r.AddonsReconciler)
	}
	if r.DisasterRecoveryReconciler == nil {
		r.DisasterRecoveryReconciler = NewDisasterRecoveryReconciler(r.Client)
	}
	registry.InitResolver(r.Client)

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

	// Determine and record cluster architecture type
	if vc.Spec.ClusterType == "" {
		vc.Status.ClusterType = v1alpha1.ClusterTypeVCluster
	} else if vc.IsNamespaced() {
		vc.Status.ClusterType = v1alpha1.ClusterTypeNamespaced
	} else {
		vc.Status.ClusterType = vc.Spec.ClusterType
	}

	// 1.5 Ensure target managed namespaces exist on the host
	if vc.IsNamespaced() {
		if err := r.ensureNamespaces(ctx, &vc); err != nil {
			log.Error(err, "failed ensuring managed namespaces")
			vc.Status.Phase = v1alpha1.PhaseDegraded
			_ = r.Status().Update(ctx, &vc)
			return ctrl.Result{RequeueAfter: 10 * time.Second}, err
		}
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

	// 2.6 Synchronize Host Hardware Info ConfigMap (vcop-hardware-info)
	_ = r.syncHardwareConfigMap(ctx)

	// 2.8 Reconcile Disaster Recovery Storage & Automated Backups
	if vc.IsNamespaced() {
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionTrue, "HostDRManaged", "Host cluster infrastructure manages disaster recovery for namespaced environments")
	} else if err := r.DisasterRecoveryReconciler.ReconcileDisasterRecovery(ctx, &vc); err != nil {
		log.Error(err, "failed reconciling disaster recovery backups")
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionFalse, "DisasterRecoveryFailed", err.Error())
	} else if vc.Spec.DisasterRecovery != nil && vc.Spec.DisasterRecovery.Enabled {
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionTrue, "BackupsConfigured", fmt.Sprintf("Automated etcd backups configured with %s schedule", vc.Spec.DisasterRecovery.Schedule))
	} else {
		r.setCondition(&vc, v1alpha1.ConditionDisasterRecoveryReady, metav1.ConditionTrue, "DisasterRecoveryDisabled", "Automated backups disabled")
	}

	// 3 & 4. Reconcile Backing Store & Control Plane / Workloads
	isSleeping := vc.IsSleeping()
	var etcdReady bool
	var syncerReady bool
	var endpoint string

	if vc.IsNamespaced() {
		if isSleeping {
			_ = r.sleepNamespacedWorkloads(ctx, &vc)
			r.setCondition(&vc, v1alpha1.ConditionSleeping, metav1.ConditionTrue, "ClusterSleeping", "Host namespaced cluster workloads are in sleep mode (scaled to 0)")
			r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionFalse, "ControlPlaneSleeping", "Namespaced cluster is in sleep mode")
			r.setCondition(&vc, v1alpha1.ConditionEtcdReady, metav1.ConditionFalse, "StorageSleeping", "Namespaced cluster storage is in sleep mode")
			vc.Status.Phase = v1alpha1.PhaseSleeping
			vc.Status.Metrics = v1alpha1.ClusterMetrics{
				ActiveNodeCount: 0,
				PodCount:        0,
				MemoryUsage:     "0Mi",
				CPUUsage:        "0m",
			}
		} else {
			_ = r.wakeNamespacedWorkloads(ctx, &vc)
			etcdReady = true
			syncerReady = true
			endpoint = r.getHostApiEndpoint(ctx, &vc)
			vc.Status.Endpoint = endpoint

			r.setCondition(&vc, v1alpha1.ConditionSleeping, metav1.ConditionFalse, "ClusterAwake", "Host namespaced cluster is awake and active")
			r.setCondition(&vc, v1alpha1.ConditionControlPlaneReady, metav1.ConditionTrue, "HostControlPlaneReady", "Host Kubernetes control plane is active")
			r.setCondition(&vc, v1alpha1.ConditionEtcdReady, metav1.ConditionTrue, "HostStorageReady", "Host cluster backing storage is active")
		}
	} else if isSleeping {
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
		if vc.IsNamespaced() {
			if err := r.KubeconfigReconciler.ReconcileNamespacedKubeconfig(ctx, &vc, endpoint); err != nil {
				log.Error(err, "failed reconciling namespaced kubeconfig")
				r.setCondition(&vc, v1alpha1.ConditionKubeconfigGenerated, metav1.ConditionFalse, "KubeconfigFailed", err.Error())
			} else {
				kubeconfigReady = true
				r.setCondition(&vc, v1alpha1.ConditionKubeconfigGenerated, metav1.ConditionTrue, "KubeconfigReady", "Host namespaced admin kubeconfig secret successfully generated")
			}
		} else {
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
	}

	// 6. Reconcile External Add-ons (CoreDNS & Metrics Server)
	var addonsReady bool
	if vc.IsNamespaced() {
		addonsReady = true
		r.setCondition(&vc, v1alpha1.ConditionAddonsReady, metav1.ConditionTrue, "HostAddonsConfigured", "Host CoreDNS and Metrics Server services available for namespace")
	} else if kubeconfigReady && (vc.Spec.Components.CoreDNS.Enabled || vc.Spec.Components.MetricsServer.Enabled) {
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
	if vc.IsNamespaced() {
		if err := r.RBACReconciler.ReconcileNamespacedRBAC(ctx, &vc); err != nil {
			log.Error(err, "failed reconciling host namespaced RBAC")
			r.setCondition(&vc, v1alpha1.ConditionRBACReady, metav1.ConditionFalse, "RBACReconcileFailed", err.Error())
		} else {
			rbacReady = true
			r.setCondition(&vc, v1alpha1.ConditionRBACReady, metav1.ConditionTrue, "RBACConfigured", "Host namespace RBAC role bindings successfully reconciled")
		}
	} else if kubeconfigReady {
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
		if vc.IsNamespaced() {
			istioReady = true
			r.setCondition(&vc, v1alpha1.ConditionIstioReady, metav1.ConditionTrue, "IstioHostConfigured", "Host namespace Istio routing active")
		} else if !kubeconfigReady {
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
	} else {
		if r.IstioReconciler != nil {
			_ = r.IstioReconciler.CleanupAllIstio(ctx, &vc)
		}
		meta.RemoveStatusCondition(&vc.Status.Conditions, v1alpha1.ConditionIstioReady)
	}

	// 9b. Reconcile Opinionated Application Entrypoint (Gateway API & TLS)
	var gatewayAPIReady bool = true
	if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.Enabled {
		if vc.IsNamespaced() {
			gatewayAPIReady = true
			r.setCondition(&vc, v1alpha1.ConditionGatewayAPIReady, metav1.ConditionTrue, "GatewayAPIHostConfigured", "Host namespace Gateway API routing active")
		} else if !kubeconfigReady {
			r.setCondition(&vc, v1alpha1.ConditionGatewayAPIReady, metav1.ConditionFalse, "WaitingForControlPlane", "Gateway API ingress awaiting control plane readiness")
			gatewayAPIReady = false
		} else {
			ready, err := r.GatewayAPIReconciler.ReconcileGatewayAPI(ctx, &vc)
			if err != nil {
				log.Error(err, "failed reconciling opinionated Gateway API entrypoint")
				r.setCondition(&vc, v1alpha1.ConditionGatewayAPIReady, metav1.ConditionFalse, "GatewayAPIReconcileFailed", err.Error())
				vc.Status.Phase = v1alpha1.PhaseDegraded
				_ = r.Status().Update(ctx, &vc)
				return ctrl.Result{RequeueAfter: 30 * time.Second}, err
			}
			gatewayAPIReady = ready
			if ready {
				r.setCondition(&vc, v1alpha1.ConditionGatewayAPIReady, metav1.ConditionTrue, "GatewayAPIConfigured", "Gateway API Gateway, HTTPRoute, and entrypoint proxy are active")
			} else {
				r.setCondition(&vc, v1alpha1.ConditionGatewayAPIReady, metav1.ConditionFalse, "GatewayAPIStarting", "Gateway API ingress rollout in progress")
			}
		}
	} else {
		if r.GatewayAPIReconciler != nil {
			_ = r.GatewayAPIReconciler.CleanupGuestGatewayAPI(ctx, &vc)
		}
		meta.RemoveStatusCondition(&vc.Status.Conditions, v1alpha1.ConditionGatewayAPIReady)
	}

	// 9c. Reconcile Unified Host Ingress Routing (Envoy Gateway)
	if r.GatewayAPIReconciler != nil {
		if err := r.GatewayAPIReconciler.ReconcileUnifiedHostRouting(ctx, &vc); err != nil {
			log.Error(err, "failed reconciling unified host ingress routing")
		}
	}
	log.Info("Component status", "cluster", vc.Name, "etcd", etcdReady, "syncer", syncerReady, "kubeconfig", kubeconfigReady, "addons", addonsReady, "quota", quotaReady, "rbac", rbacReady, "istio", istioReady, "gatewayAPI", gatewayAPIReady)

	// 10. Update Observed Versions & Final Phase
	previousPhase := vc.Status.Phase
	if isSleeping {
		vc.Status.Phase = v1alpha1.PhaseSleeping
	} else if etcdReady && syncerReady && addonsReady && quotaReady && rbacReady && istioReady && gatewayAPIReady {
		if vc.IsNamespaced() {
			vc.Status.VirtualK8sVersion = "host"
			vc.Status.VClusterVersion = "host-native"
			vc.Status.ClusterType = v1alpha1.ClusterTypeNamespaced
			vc.Status.ComponentVersions = &v1alpha1.ComponentVersionsStatus{
				Etcd:          "host",
				CoreDNS:       "host",
				MetricsServer: "host",
				Istio:         "host",
				GatewayAPI:    "host",
			}
			vc.Status.Phase = v1alpha1.PhaseReady
			if previousPhase != v1alpha1.PhaseReady {
				log.Info("Namespaced cluster transitioned to Ready", "cluster", vc.Name, "previousPhase", previousPhase)
				if r.Recorder != nil {
					r.Recorder.Event(&vc, corev1.EventTypeNormal, "ClusterReady", "Namespaced cluster governance, quotas, and RBAC are Active and Ready")
				}
			}
		} else {
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
			targetGatewayAPI := ""
			if vc.Spec.Components.GatewayAPI != nil && vc.Spec.Components.GatewayAPI.Enabled {
				targetGatewayAPI = vc.Spec.Components.GatewayAPI.Version
				if targetGatewayAPI == "" {
					targetGatewayAPI = "v1.2.0"
				}
			}

			vc.Status.VirtualK8sVersion = targetK8s
			vc.Status.VClusterVersion = targetVCluster
			vc.Status.ClusterType = v1alpha1.ClusterTypeVCluster
			vc.Status.ComponentVersions = &v1alpha1.ComponentVersionsStatus{
				Etcd:          targetEtcd,
				CoreDNS:       targetCoreDNS,
				MetricsServer: targetMetrics,
				Istio:         targetIstio,
				GatewayAPI:    targetGatewayAPI,
			}
			vc.Status.Phase = v1alpha1.PhaseReady
			if previousPhase != v1alpha1.PhaseReady {
				log.Info("Virtual cluster transitioned to Ready", "cluster", vc.Name, "previousPhase", previousPhase)
				if r.Recorder != nil {
					r.Recorder.Event(&vc, corev1.EventTypeNormal, "ClusterReady", "VirtualCluster control plane, addons, governance, and ingress are Active and Ready")
				}
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
		if !gatewayAPIReady {
			pending = append(pending, "gatewayAPI")
		}
		log.Info("Virtual cluster components syncing / pending", "cluster", vc.Name, "phase", vc.Status.Phase, "pending", pending)
	}

	if !isSleeping {
		if vc.IsNamespaced() {
			vc.Status.Metrics = r.calculateNamespacedMetrics(ctx, &vc)
		} else {
			vc.Status.Metrics = r.calculateMetrics(ctx, &vc)
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

	requeueDuration := 30 * time.Second
	if !isSleeping && (!addonsReady || !quotaReady || !rbacReady || !istioReady) {
		requeueDuration = 10 * time.Second
	}

	return ctrl.Result{RequeueAfter: requeueDuration}, nil
}

func (r *VirtualClusterReconciler) handleDeletion(ctx context.Context, log logr.Logger, vc *v1alpha1.VirtualCluster) (ctrl.Result, error) {
	if vc.IsNamespaced() {
		return r.handleNamespacedDeletion(ctx, log, vc)
	}

	log.Info("Executing graceful finalizer cleanup", "cluster", vc.Name, "namespace", vc.Namespace)
	vc.Status.Phase = v1alpha1.PhaseTerminating
	_ = r.Status().Update(ctx, vc)

	// 1. Clean up Disaster Recovery resources (CronJob, Jobs, PVC)
	if r.DisasterRecoveryReconciler != nil {
		if err := r.DisasterRecoveryReconciler.CleanupDisasterRecovery(ctx, vc); err != nil {
			log.Error(err, "error cleaning up disaster recovery during deletion")
		}
	}

	// 2. Clean up Istio host routing resources, cert-manager certificates, and TLS secrets
	if r.IstioReconciler != nil {
		if err := r.IstioReconciler.CleanupAllIstio(ctx, vc); err != nil {
			log.Error(err, "error cleaning up istio resources during deletion")
		}
	}

	// 2b. Clean up Gateway API host routing resources, cert-manager certificates, and TLS secrets
	if r.GatewayAPIReconciler != nil {
		if err := r.GatewayAPIReconciler.CleanupAllGatewayAPI(ctx, vc); err != nil {
			log.Error(err, "error cleaning up gateway API resources during deletion")
		}
	}

	// 3. Clean up HA etcd StatefulSet, client/headless services, and data PVCs
	if r.EtcdReconciler != nil {
		if err := r.EtcdReconciler.CleanupEtcd(ctx, vc); err != nil {
			log.Error(err, "error cleaning up etcd during deletion")
		}
	}

	// 4. Clean up syncer StatefulSet, services, configmaps, secrets, RBAC, and synced guest pods
	if r.SyncerReconciler != nil {
		if err := r.SyncerReconciler.CleanupSyncer(ctx, vc); err != nil {
			log.Error(err, "error cleaning up syncer during deletion")
		}
	}

	// 5. Sweep remaining resources in the namespace associated with this cluster
	r.cleanupRemainingClusterResources(ctx, log, vc)

	// 6. Check if this is a dedicated namespace for this virtual cluster
	isDedicated := r.isDedicatedNamespace(ctx, vc.Namespace, vc.Name)

	// 7. Remove finalizer
	controllerutil.RemoveFinalizer(vc, VirtualClusterFinalizer)
	if err := r.Update(ctx, vc); err != nil {
		log.Error(err, "failed to remove finalizer from VirtualCluster", "cluster", vc.Name)
		return ctrl.Result{}, err
	}

	// 8. If dedicated namespace, delete the namespace itself
	if isDedicated {
		log.Info("Deleting dedicated namespace for virtual cluster", "namespace", vc.Namespace)
		ns := &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name: vc.Namespace,
			},
		}
		if err := r.Delete(ctx, ns); err != nil && !errors.IsNotFound(err) {
			log.Error(err, "error deleting dedicated namespace", "namespace", vc.Namespace)
		}
	}

	log.Info("Successfully finalized and cleaned up VirtualCluster and its resources", "cluster", vc.Name)
	return ctrl.Result{}, nil
}

func (r *VirtualClusterReconciler) isDedicatedNamespace(ctx context.Context, namespace, clusterName string) bool {
	if namespace == "" || namespace == "default" {
		return false
	}
	systemNamespaces := map[string]bool{
		"default":            true,
		"kube-system":        true,
		"kube-public":        true,
		"kube-node-lease":    true,
		"local-path-storage": true,
		"cert-manager":       true,
		"keycloak-operator":  true,
		"vcop-system":        true,
	}
	if systemNamespaces[namespace] || strings.HasPrefix(namespace, "kube-") || strings.HasPrefix(namespace, "vcop-") {
		return false
	}

	// Check if there are other active VirtualClusters in this namespace
	vcList := &v1alpha1.VirtualClusterList{}
	if err := r.List(ctx, vcList, client.InNamespace(namespace)); err != nil {
		return false
	}

	for _, item := range vcList.Items {
		if item.Name != clusterName && item.DeletionTimestamp.IsZero() {
			return false
		}
	}

	return true
}

func (r *VirtualClusterReconciler) cleanupRemainingClusterResources(ctx context.Context, log logr.Logger, vc *v1alpha1.VirtualCluster) {
	isDedicated := r.isDedicatedNamespace(ctx, vc.Namespace, vc.Name)
	grace := int64(0)
	delOpts := &client.DeleteOptions{GracePeriodSeconds: &grace}

	// 1. Pods
	podList := &corev1.PodList{}
	if err := r.List(ctx, podList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range podList.Items {
			pod := &podList.Items[i]
			if isDedicated || r.resourceBelongsToCluster(&pod.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				if len(pod.Finalizers) > 0 {
					pod.Finalizers = nil
					_ = r.Update(ctx, pod)
				}
				_ = r.Delete(ctx, pod, delOpts)
			}
		}
	}

	// 2. PersistentVolumeClaims
	pvcList := &corev1.PersistentVolumeClaimList{}
	if err := r.List(ctx, pvcList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range pvcList.Items {
			pvc := &pvcList.Items[i]
			if isDedicated || r.resourceBelongsToCluster(&pvc.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				if len(pvc.Finalizers) > 0 {
					pvc.Finalizers = nil
					_ = r.Update(ctx, pvc)
				}
				_ = r.Delete(ctx, pvc)
			}
		}
	}

	// 3. Services
	svcList := &corev1.ServiceList{}
	if err := r.List(ctx, svcList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range svcList.Items {
			svc := &svcList.Items[i]
			if isDedicated || r.resourceBelongsToCluster(&svc.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				_ = r.Delete(ctx, svc)
			}
		}
	}

	// 4. ConfigMaps (preserve kube-root-ca.crt)
	cmList := &corev1.ConfigMapList{}
	if err := r.List(ctx, cmList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range cmList.Items {
			cm := &cmList.Items[i]
			if cm.Name == "kube-root-ca.crt" {
				continue
			}
			if isDedicated || r.resourceBelongsToCluster(&cm.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				_ = r.Delete(ctx, cm)
			}
		}
	}

	// 5. Secrets (preserve default SA token secrets)
	secList := &corev1.SecretList{}
	if err := r.List(ctx, secList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range secList.Items {
			sec := &secList.Items[i]
			if sec.Type == corev1.SecretTypeServiceAccountToken && strings.HasPrefix(sec.Name, "default-token-") {
				continue
			}
			if isDedicated || r.resourceBelongsToCluster(&sec.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				_ = r.Delete(ctx, sec)
			}
		}
	}

	// 6. ServiceAccounts (preserve default)
	saList := &corev1.ServiceAccountList{}
	if err := r.List(ctx, saList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range saList.Items {
			sa := &saList.Items[i]
			if sa.Name == "default" {
				continue
			}
			if isDedicated || r.resourceBelongsToCluster(&sa.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				_ = r.Delete(ctx, sa)
			}
		}
	}

	// 7. Roles & RoleBindings
	roleList := &rbacv1.RoleList{}
	if err := r.List(ctx, roleList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range roleList.Items {
			role := &roleList.Items[i]
			if isDedicated || r.resourceBelongsToCluster(&role.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				_ = r.Delete(ctx, role)
			}
		}
	}
	rbList := &rbacv1.RoleBindingList{}
	if err := r.List(ctx, rbList, client.InNamespace(vc.Namespace)); err == nil {
		for i := range rbList.Items {
			rb := &rbList.Items[i]
			if isDedicated || r.resourceBelongsToCluster(&rb.ObjectMeta, vc.Name, vc.Spec.ClusterName) {
				_ = r.Delete(ctx, rb)
			}
		}
	}
}

func (r *VirtualClusterReconciler) resourceBelongsToCluster(meta *metav1.ObjectMeta, clusterName, specName string) bool {
	if meta.Labels != nil {
		if meta.Labels["vcluster.loft.sh/managed-by"] == clusterName ||
			meta.Labels["vcluster.loft.sh/belongs-to"] == clusterName ||
			meta.Labels["vops.gitops.io/cluster"] == clusterName ||
			meta.Labels["vops.gitops.io/cluster"] == specName ||
			meta.Labels["release"] == clusterName ||
			meta.Labels["app.kubernetes.io/instance"] == clusterName ||
			meta.Labels["vcluster-name"] == clusterName {
			return true
		}
	}
	name := meta.Name
	if strings.HasSuffix(name, fmt.Sprintf("-x-%s", clusterName)) ||
		strings.HasPrefix(name, fmt.Sprintf("%s-", clusterName)) ||
		name == clusterName {
		return true
	}
	return false
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
	r.GatewayAPIReconciler = NewGatewayAPIReconciler(mgr.GetClient(), r.AddonsReconciler)
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
		Owns(&corev1.ServiceAccount{}).
		Owns(&rbacv1.RoleBinding{}).
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

func (r *VirtualClusterReconciler) syncHardwareConfigMap(ctx context.Context) error {
	var nodeList corev1.NodeList
	if err := r.List(ctx, &nodeList); err != nil {
		return err
	}

	gpuModel, gpuVendor, totalGPUs, allocatableGPUs, hardwareStr := capacity.DetectHardware(nodeList.Items)

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vcop-hardware-info",
			Namespace: "vcop-system",
		},
	}

	_, err := controllerutil.CreateOrUpdate(ctx, r.Client, cm, func() error {
		if cm.Data == nil {
			cm.Data = make(map[string]string)
		}
		cm.Data["gpuModel"] = gpuModel
		cm.Data["gpuVendor"] = gpuVendor
		cm.Data["totalGpus"] = fmt.Sprintf("%d", totalGPUs)
		cm.Data["allocatableGpus"] = fmt.Sprintf("%d", allocatableGPUs)
		cm.Data["hardwareString"] = hardwareStr
		cm.Data["lastScanned"] = time.Now().UTC().Format(time.RFC3339)
		return nil
	})

	return err
}

func (r *VirtualClusterReconciler) ensureNamespaces(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	targetNamespaces := vc.GetNamespaces()
	for _, nsName := range targetNamespaces {
		ns := &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name: nsName,
			},
		}
		_, err := controllerutil.CreateOrUpdate(ctx, r.Client, ns, func() error {
			if ns.Labels == nil {
				ns.Labels = make(map[string]string)
			}
			ns.Labels["app.kubernetes.io/managed-by"] = "vc-operator"
			ns.Labels["vops.gitops.io/cluster"] = vc.Name
			return nil
		})
		if err != nil && !errors.IsAlreadyExists(err) {
			return fmt.Errorf("failed ensuring namespace %s: %w", nsName, err)
		}
	}
	return nil
}

func (r *VirtualClusterReconciler) sleepNamespacedWorkloads(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	log := r.Log.WithValues("virtualcluster", vc.Name, "namespace", vc.Namespace)
	targetNamespaces := vc.GetNamespaces()

	for _, ns := range targetNamespaces {
		depList := &appsv1.DeploymentList{}
		if err := r.List(ctx, depList, client.InNamespace(ns)); err == nil {
			for i := range depList.Items {
				dep := &depList.Items[i]
				if dep.Namespace == "kube-system" || dep.Namespace == "vcop-system" {
					continue
				}
				if dep.Spec.Replicas != nil && *dep.Spec.Replicas > 0 {
					if dep.Annotations == nil {
						dep.Annotations = make(map[string]string)
					}
					if _, exists := dep.Annotations[PreSleepReplicasAnnotation]; !exists {
						dep.Annotations[PreSleepReplicasAnnotation] = strconv.Itoa(int(*dep.Spec.Replicas))
					}
					zero := int32(0)
					dep.Spec.Replicas = &zero
					if err := r.Update(ctx, dep); err != nil {
						log.Info("Could not scale down deployment", "dep", dep.Name, "namespace", dep.Namespace, "err", err)
					}
				}
			}
		}

		stsList := &appsv1.StatefulSetList{}
		if err := r.List(ctx, stsList, client.InNamespace(ns)); err == nil {
			for i := range stsList.Items {
				sts := &stsList.Items[i]
				if sts.Namespace == "kube-system" || sts.Namespace == "vcop-system" {
					continue
				}
				if sts.Spec.Replicas != nil && *sts.Spec.Replicas > 0 {
					if sts.Annotations == nil {
						sts.Annotations = make(map[string]string)
					}
					if _, exists := sts.Annotations[PreSleepReplicasAnnotation]; !exists {
						sts.Annotations[PreSleepReplicasAnnotation] = strconv.Itoa(int(*sts.Spec.Replicas))
					}
					zero := int32(0)
					sts.Spec.Replicas = &zero
					if err := r.Update(ctx, sts); err != nil {
						log.Info("Could not scale down statefulset", "sts", sts.Name, "namespace", sts.Namespace, "err", err)
					}
				}
			}
		}
	}
	return nil
}

func (r *VirtualClusterReconciler) wakeNamespacedWorkloads(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	targetNamespaces := vc.GetNamespaces()

	for _, ns := range targetNamespaces {
		depList := &appsv1.DeploymentList{}
		if err := r.List(ctx, depList, client.InNamespace(ns)); err == nil {
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
					_ = r.Update(ctx, dep)
				}
			}
		}

		stsList := &appsv1.StatefulSetList{}
		if err := r.List(ctx, stsList, client.InNamespace(ns)); err == nil {
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
					_ = r.Update(ctx, sts)
				}
			}
		}
	}
	return nil
}

func (r *VirtualClusterReconciler) calculateNamespacedMetrics(ctx context.Context, vc *v1alpha1.VirtualCluster) v1alpha1.ClusterMetrics {
	if vc.IsSleeping() || vc.Status.Phase == v1alpha1.PhaseSleeping {
		return v1alpha1.ClusterMetrics{
			ActiveNodeCount: 0,
			PodCount:        0,
			MemoryUsage:     "0Mi",
			CPUUsage:        "0m",
		}
	}

	activeNodes := int32(1)
	var nodeList corev1.NodeList
	if err := r.List(ctx, &nodeList); err == nil && len(nodeList.Items) > 0 {
		activeNodes = int32(len(nodeList.Items))
	}

	podCount := int32(0)
	var totalCpuMillis int64
	var totalMemBytes int64

	targetNamespaces := vc.GetNamespaces()
	for _, ns := range targetNamespaces {
		var podList corev1.PodList
		if err := r.List(ctx, &podList, client.InNamespace(ns)); err == nil {
			for _, pod := range podList.Items {
				if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
					continue
				}
				podCount++
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
		}
	}

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

func (r *VirtualClusterReconciler) handleNamespacedDeletion(ctx context.Context, log logr.Logger, vc *v1alpha1.VirtualCluster) (ctrl.Result, error) {
	log.Info("Executing graceful finalizer cleanup for namespaced cluster", "cluster", vc.Name, "namespace", vc.Namespace)
	vc.Status.Phase = v1alpha1.PhaseTerminating
	_ = r.Status().Update(ctx, vc)

	targetNamespaces := vc.GetNamespaces()
	for _, ns := range targetNamespaces {
		// Clean up RoleBinding
		binding := &rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{
				Name:      DefaultGuestAdminBindingName,
				Namespace: ns,
			},
		}
		_ = r.Delete(ctx, binding)

		saBinding := &rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("%s-sa-admin-binding", vc.Name),
				Namespace: ns,
			},
		}
		_ = r.Delete(ctx, saBinding)

		// Clean up ResourceQuota & LimitRange
		rq := &corev1.ResourceQuota{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("%s-quota", vc.Name),
				Namespace: ns,
			},
		}
		_ = r.Delete(ctx, rq)

		lr := &corev1.LimitRange{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("%s-limits", vc.Name),
				Namespace: ns,
			},
		}
		_ = r.Delete(ctx, lr)
	}

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-admin", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, sa)

	tokenSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-admin-token", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, tokenSec)

	kubeSec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-kubeconfig", vc.Name),
			Namespace: vc.Namespace,
		},
	}
	_ = r.Delete(ctx, kubeSec)

	r.cleanupRemainingClusterResources(ctx, log, vc)

	isDedicated := r.isDedicatedNamespace(ctx, vc.Namespace, vc.Name)
	controllerutil.RemoveFinalizer(vc, VirtualClusterFinalizer)
	if err := r.Update(ctx, vc); err != nil {
		log.Error(err, "failed to remove finalizer from VirtualCluster", "cluster", vc.Name)
		return ctrl.Result{}, err
	}

	if isDedicated {
		log.Info("Deleting dedicated namespace for namespaced cluster", "namespace", vc.Namespace)
		ns := &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name: vc.Namespace,
			},
		}
		_ = r.Delete(ctx, ns)
	}

	log.Info("Successfully finalized namespaced cluster", "cluster", vc.Name)
	return ctrl.Result{}, nil
}

func (r *VirtualClusterReconciler) getHostApiEndpoint(ctx context.Context, vc *v1alpha1.VirtualCluster) string {
	if vc.Annotations != nil && vc.Annotations["vops.gitops.io/custom-endpoint"] != "" {
		return strings.TrimSpace(vc.Annotations["vops.gitops.io/custom-endpoint"])
	}
	if host := os.Getenv("KUBERNETES_SERVICE_HOST"); host != "" {
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		if port == "" {
			port = "443"
		}
		return fmt.Sprintf("https://%s:%s", host, port)
	}
	return "https://kubernetes.default.svc:443"
}
