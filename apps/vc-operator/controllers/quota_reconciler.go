package controllers

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

type QuotaReconciler struct {
	client client.Client
}

func NewQuotaReconciler(c client.Client) *QuotaReconciler {
	return &QuotaReconciler{client: c}
}

// ReconcileQuota ensures ResourceQuota and LimitRange policies are enforced on host and inside vcluster
func (r *QuotaReconciler) ReconcileQuota(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	labels := map[string]string{
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Name,
	}

	// 1. Determine effective ResourceQuota specs
	hardLimits := r.buildHardLimits(vc)

	quotaName := fmt.Sprintf("%s-quota", vc.Name)
	hostQuota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:      quotaName,
			Namespace: vc.Namespace,
		},
	}

	_, err := controllerutil.CreateOrUpdate(ctx, r.client, hostQuota, func() error {
		hostQuota.Labels = labels
		hostQuota.Spec.Hard = hardLimits
		return controllerutil.SetControllerReference(vc, hostQuota, r.client.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed reconciling host ResourceQuota: %w", err)
	}

	// 2. Read live observed quota status from host
	latestQuota := &corev1.ResourceQuota{}
	if err := r.client.Get(ctx, types.NamespacedName{Name: quotaName, Namespace: vc.Namespace}, latestQuota); err == nil {
		hardMap := make(map[string]string)
		for k, v := range latestQuota.Status.Hard {
			hardMap[string(k)] = v.String()
		}
		usedMap := make(map[string]string)
		for k, v := range latestQuota.Status.Used {
			usedMap[string(k)] = v.String()
		}

		vc.Status.Quota = &v1alpha1.QuotaStatus{
			Hard: hardMap,
			Used: usedMap,
		}
	}

	// 3. Reconcile LimitRange on host
	limitRangeName := fmt.Sprintf("%s-limits", vc.Name)
	limitRangeItem := r.buildLimitRangeItem(vc)
	hostLR := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{
			Name:      limitRangeName,
			Namespace: vc.Namespace,
		},
	}

	_, err = controllerutil.CreateOrUpdate(ctx, r.client, hostLR, func() error {
		hostLR.Labels = labels
		hostLR.Spec.Limits = []corev1.LimitRangeItem{limitRangeItem}
		return controllerutil.SetControllerReference(vc, hostLR, r.client.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed reconciling host LimitRange: %w", err)
	}

	// 4. If vCluster is running and reachable, sync ResourceQuota & LimitRange inside vCluster
	_ = r.syncInsideVCluster(ctx, vc, hardLimits, limitRangeItem)

	return nil
}

func (r *QuotaReconciler) buildHardLimits(vc *v1alpha1.VirtualCluster) corev1.ResourceList {
	hard := corev1.ResourceList{}

	// Defaults based on sizePreset
	reqCPU := "4"
	reqMem := "8Gi"
	reqStorage := "25Gi"
	limCPU := "8"
	limMem := "16Gi"
	pods := "25"
	pvcs := "10"

	switch vc.Spec.SizePreset {
	case v1alpha1.PresetNormal, v1alpha1.PresetSmall:
		reqCPU = "1"
		reqMem = "2Gi"
		reqStorage = "10Gi"
		limCPU = "2"
		limMem = "4Gi"
		pods = "10"
		pvcs = "5"
	case v1alpha1.PresetHA, v1alpha1.PresetLarge:
		reqCPU = "8"
		reqMem = "16Gi"
		reqStorage = "50Gi"
		limCPU = "16"
		limMem = "32Gi"
		pods = "50"
		pvcs = "25"
	}

	// If CustomResources provided, override
	if vc.Spec.CustomResources != nil {
		if vc.Spec.CustomResources.CPU != "" {
			limCPU = vc.Spec.CustomResources.CPU
			reqCPU = vc.Spec.CustomResources.CPU
		}
		if vc.Spec.CustomResources.Memory != "" {
			limMem = vc.Spec.CustomResources.Memory
			reqMem = vc.Spec.CustomResources.Memory
		}
		if vc.Spec.CustomResources.Storage != "" {
			reqStorage = vc.Spec.CustomResources.Storage
		}
	}

	// If Policies.ResourceQuota explicitly provided, override with user values
	if vc.Spec.Policies != nil && vc.Spec.Policies.ResourceQuota != nil {
		rq := vc.Spec.Policies.ResourceQuota
		if rq.RequestsCPU != "" {
			reqCPU = rq.RequestsCPU
		}
		if rq.RequestsMemory != "" {
			reqMem = rq.RequestsMemory
		}
		if rq.RequestsStorage != "" {
			reqStorage = rq.RequestsStorage
		}
		if rq.LimitsCPU != "" {
			limCPU = rq.LimitsCPU
		}
		if rq.LimitsMemory != "" {
			limMem = rq.LimitsMemory
		}
		if rq.Pods != "" {
			pods = rq.Pods
		}
		if rq.PersistentVolumeClaims != "" {
			pvcs = rq.PersistentVolumeClaims
		}

		if rq.ServicesNodePorts != "" {
			if q, err := resource.ParseQuantity(rq.ServicesNodePorts); err == nil {
				hard[corev1.ResourceServicesNodePorts] = q
			}
		}
		if rq.ServicesLoadBalancers != "" {
			if q, err := resource.ParseQuantity(rq.ServicesLoadBalancers); err == nil {
				hard[corev1.ResourceServicesLoadBalancers] = q
			}
		}
		if rq.ConfigMaps != "" {
			if q, err := resource.ParseQuantity(rq.ConfigMaps); err == nil {
				hard[corev1.ResourceConfigMaps] = q
			}
		}
		if rq.Secrets != "" {
			if q, err := resource.ParseQuantity(rq.Secrets); err == nil {
				hard[corev1.ResourceSecrets] = q
			}
		}
	}

	if q, err := resource.ParseQuantity(reqCPU); err == nil {
		hard[corev1.ResourceRequestsCPU] = q
	}
	if q, err := resource.ParseQuantity(reqMem); err == nil {
		hard[corev1.ResourceRequestsMemory] = q
	}
	if q, err := resource.ParseQuantity(reqStorage); err == nil {
		hard[corev1.ResourceRequestsStorage] = q
	}
	if q, err := resource.ParseQuantity(limCPU); err == nil {
		hard[corev1.ResourceLimitsCPU] = q
	}
	if q, err := resource.ParseQuantity(limMem); err == nil {
		hard[corev1.ResourceLimitsMemory] = q
	}
	if q, err := resource.ParseQuantity(pods); err == nil {
		hard[corev1.ResourcePods] = q
	}
	if q, err := resource.ParseQuantity(pvcs); err == nil {
		hard[corev1.ResourcePersistentVolumeClaims] = q
	}

	return hard
}

func (r *QuotaReconciler) buildLimitRangeItem(vc *v1alpha1.VirtualCluster) corev1.LimitRangeItem {
	defCPU := "1"
	defMem := "1Gi"
	defReqCPU := "100m"
	defReqMem := "128Mi"

	item := corev1.LimitRangeItem{
		Type:           corev1.LimitTypeContainer,
		Default:        corev1.ResourceList{},
		DefaultRequest: corev1.ResourceList{},
		Max:            corev1.ResourceList{},
		Min:            corev1.ResourceList{},
	}

	if vc.Spec.Policies != nil && vc.Spec.Policies.LimitRange != nil {
		lr := vc.Spec.Policies.LimitRange
		if lr.DefaultCPU != "" {
			defCPU = lr.DefaultCPU
		}
		if lr.DefaultMemory != "" {
			defMem = lr.DefaultMemory
		}
		if lr.DefaultRequestCPU != "" {
			defReqCPU = lr.DefaultRequestCPU
		}
		if lr.DefaultRequestMemory != "" {
			defReqMem = lr.DefaultRequestMemory
		}
		if lr.MaxCPU != "" {
			if q, err := resource.ParseQuantity(lr.MaxCPU); err == nil {
				item.Max[corev1.ResourceCPU] = q
			}
		}
		if lr.MaxMemory != "" {
			if q, err := resource.ParseQuantity(lr.MaxMemory); err == nil {
				item.Max[corev1.ResourceMemory] = q
			}
		}
		if lr.MinCPU != "" {
			if q, err := resource.ParseQuantity(lr.MinCPU); err == nil {
				item.Min[corev1.ResourceCPU] = q
			}
		}
		if lr.MinMemory != "" {
			if q, err := resource.ParseQuantity(lr.MinMemory); err == nil {
				item.Min[corev1.ResourceMemory] = q
			}
		}
	}

	if q, err := resource.ParseQuantity(defCPU); err == nil {
		item.Default[corev1.ResourceCPU] = q
	}
	if q, err := resource.ParseQuantity(defMem); err == nil {
		item.Default[corev1.ResourceMemory] = q
	}
	if q, err := resource.ParseQuantity(defReqCPU); err == nil {
		item.DefaultRequest[corev1.ResourceCPU] = q
	}
	if q, err := resource.ParseQuantity(defReqMem); err == nil {
		item.DefaultRequest[corev1.ResourceMemory] = q
	}

	return item
}

func (r *QuotaReconciler) syncInsideVCluster(ctx context.Context, vc *v1alpha1.VirtualCluster, hard corev1.ResourceList, lrItem corev1.LimitRangeItem) error {
	var cfgBytes []byte
	secName := fmt.Sprintf("%s-kubeconfig", vc.Name)
	sec := &corev1.Secret{}
	if err := r.client.Get(ctx, types.NamespacedName{Name: secName, Namespace: vc.Namespace}, sec); err == nil {
		cfgBytes = sec.Data["config"]
	}

	if len(cfgBytes) == 0 {
		vcSecName := fmt.Sprintf("vc-%s", vc.Name)
		vcSec := &corev1.Secret{}
		if err := r.client.Get(ctx, types.NamespacedName{Name: vcSecName, Namespace: vc.Namespace}, vcSec); err == nil {
			cfgBytes = vcSec.Data["config"]
		}
	}

	if len(cfgBytes) == 0 {
		return nil
	}

	restConfig, err := clientcmd.RESTConfigFromKubeConfig(cfgBytes)
	if err != nil {
		return err
	}
	restConfig.Host = fmt.Sprintf("https://%s.%s.svc:443", vc.Name, vc.Namespace)
	restConfig.Insecure = true
	restConfig.CAData = nil
	restConfig.CAFile = ""
	restConfig.Timeout = 5 * time.Second

	vScheme := runtime.NewScheme()
	_ = corev1.AddToScheme(vScheme)
	vClient, err := client.New(restConfig, client.Options{Scheme: vScheme})
	if err != nil {
		return err
	}

	// Create/update in default namespace inside vCluster
	vQuota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vcluster-quota",
			Namespace: "default",
		},
	}
	_, _ = controllerutil.CreateOrUpdate(ctx, vClient, vQuota, func() error {
		vQuota.Spec.Hard = hard
		return nil
	})

	vLR := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vcluster-limits",
			Namespace: "default",
		},
	}
	_, _ = controllerutil.CreateOrUpdate(ctx, vClient, vLR, func() error {
		vLR.Spec.Limits = []corev1.LimitRangeItem{lrItem}
		return nil
	})

	return nil
}
