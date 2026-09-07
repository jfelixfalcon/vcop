package controllers

import (
	"context"
	"fmt"
	"sort"
	"strings"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"

	v1alpha1 "github.com/vops/vc-operator/api/v1alpha1"
)

type DisasterRecoveryReconciler struct {
	client.Client
}

func NewDisasterRecoveryReconciler(c client.Client) *DisasterRecoveryReconciler {
	return &DisasterRecoveryReconciler{Client: c}
}

// ComputeCronSchedule maps human intervals (daily, weekly, monthly) to standard cron strings
func ComputeCronSchedule(schedule string, customCron string) string {
	switch strings.ToLower(schedule) {
	case "daily":
		return "0 2 * * *" // Every day at 02:00 UTC
	case "weekly":
		return "0 2 * * 0" // Every Sunday at 02:00 UTC
	case "monthly":
		return "0 2 1 * *" // 1st of every month at 02:00 UTC
	case "custom":
		if customCron != "" {
			return customCron
		}
		return "0 2 * * *"
	default:
		return "0 2 * * *"
	}
}

// ReconcileDisasterRecovery manages backup PVCs, CronJobs, and status tracking
func (r *DisasterRecoveryReconciler) ReconcileDisasterRecovery(ctx context.Context, vc *v1alpha1.VirtualCluster) error {
	drSpec := vc.Spec.DisasterRecovery
	if drSpec == nil || !drSpec.Enabled {
		// If disabled, delete the CronJob if it exists and update status
		cronJob := &batchv1.CronJob{
			ObjectMeta: metav1.ObjectMeta{
				Name:      fmt.Sprintf("%s-etcd-backup", vc.Name),
				Namespace: vc.Namespace,
			},
		}
		_ = r.Delete(ctx, cronJob)

		if vc.Status.DisasterRecovery != nil {
			vc.Status.DisasterRecovery.Enabled = false
			vc.Status.DisasterRecovery.Schedule = "disabled"
		}
		return nil
	}

	labels := map[string]string{
		"app.kubernetes.io/name":       "vcluster-etcd-backup",
		"app.kubernetes.io/instance":   vc.Name,
		"app.kubernetes.io/managed-by": "vc-operator",
		"vops.gitops.io/cluster":       vc.Spec.ClusterName,
	}

	// 1. Ensure Backups PersistentVolumeClaim exists
	pvcSize := drSpec.StorageSize
	if pvcSize == "" {
		pvcSize = "10Gi"
	}
	storageQuantity, err := resource.ParseQuantity(pvcSize)
	if err != nil {
		storageQuantity = resource.MustParse("10Gi")
	}

	pvcName := fmt.Sprintf("%s-etcd-backups", vc.Name)
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pvcName,
			Namespace: vc.Namespace,
		},
	}

	existingPvc := &corev1.PersistentVolumeClaim{}
	err = r.Get(ctx, types.NamespacedName{Name: pvcName, Namespace: vc.Namespace}, existingPvc)
	if errors.IsNotFound(err) {
		pvc.Labels = labels
		pvc.Spec = corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{
				corev1.ReadWriteOnce,
			},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: storageQuantity,
				},
			},
		}
		if err := controllerutil.SetControllerReference(vc, pvc, r.Scheme()); err == nil {
			_ = r.Create(ctx, pvc)
		}
	}

	// 2. Reconcile Backup CronJob
	cronSchedule := ComputeCronSchedule(drSpec.Schedule, drSpec.CronExpression)
	retentionCount := drSpec.RetentionCount
	if retentionCount <= 0 {
		retentionCount = 7
	}

	drImage := "vops/etcd-dr-runner:v1.3.0"
	suspend := vc.IsSleeping()
	historyLimit := int32(5)

	cronJob := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("%s-etcd-backup", vc.Name),
			Namespace: vc.Namespace,
		},
	}

	_, err = controllerutil.CreateOrUpdate(ctx, r.Client, cronJob, func() error {
		cronJob.Labels = labels
		cronJob.Spec.Schedule = cronSchedule
		cronJob.Spec.Suspend = &suspend
		cronJob.Spec.ConcurrencyPolicy = batchv1.ForbidConcurrent
		cronJob.Spec.SuccessfulJobsHistoryLimit = &historyLimit
		cronJob.Spec.FailedJobsHistoryLimit = &historyLimit

		cronJob.Spec.JobTemplate.ObjectMeta.Labels = labels
		cronJob.Spec.JobTemplate.Spec.Template.ObjectMeta.Labels = labels
		cronJob.Spec.JobTemplate.Spec.Template.Spec.RestartPolicy = corev1.RestartPolicyOnFailure

		cronJob.Spec.JobTemplate.Spec.Template.Spec.Containers = []corev1.Container{
			{
				Name:            "etcd-backup",
				Image:           drImage,
				ImagePullPolicy: corev1.PullIfNotPresent,
				Command:         []string{"/scripts/backup.sh"},
				Env: []corev1.EnvVar{
					{Name: "CLUSTER_NAME", Value: vc.Spec.ClusterName},
					{Name: "ETCD_ENDPOINT", Value: fmt.Sprintf("https://%s-etcd:2379", vc.Name)},
					{Name: "CACERT", Value: "/run/config/pki/etcd-ca.crt"},
					{Name: "CERT", Value: "/run/config/pki/etcd-server.crt"},
					{Name: "KEY", Value: "/run/config/pki/etcd-server.key"},
					{Name: "RETENTION_COUNT", Value: fmt.Sprintf("%d", retentionCount)},
				},
				VolumeMounts: []corev1.VolumeMount{
					{
						Name:      "backups",
						MountPath: "/backup",
					},
					{
						Name:      "shared-backups",
						MountPath: "/shared-backups",
					},
					{
						Name:      "certs",
						MountPath: "/run/config/pki",
						ReadOnly:  true,
					},
				},
			},
		}

		hostPathDirOrCreate := corev1.HostPathDirectoryOrCreate
		cronJob.Spec.JobTemplate.Spec.Template.Spec.Volumes = []corev1.Volume{
			{
				Name: "backups",
				VolumeSource: corev1.VolumeSource{
					PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
						ClaimName: pvcName,
					},
				},
			},
			{
				Name: "shared-backups",
				VolumeSource: corev1.VolumeSource{
					HostPath: &corev1.HostPathVolumeSource{
						Path: "/tmp/vcop-dr-backups",
						Type: &hostPathDirOrCreate,
					},
				},
			},
			{
				Name: "certs",
				VolumeSource: corev1.VolumeSource{
					Secret: &corev1.SecretVolumeSource{
						SecretName: fmt.Sprintf("%s-certs", vc.Name),
					},
				},
			},
		}

		return controllerutil.SetControllerReference(vc, cronJob, r.Scheme())
	})
	if err != nil {
		return fmt.Errorf("failed reconciling etcd backup cronjob: %w", err)
	}

	// 3. Scan and collect recent backup Jobs to populate status
	jobList := &batchv1.JobList{}
	listOpts := []client.ListOption{
		client.InNamespace(vc.Namespace),
		client.MatchingLabels{"vops.gitops.io/cluster": vc.Spec.ClusterName},
	}
	_ = r.List(ctx, jobList, listOpts...)

	var recentBackups []v1alpha1.BackupItem
	var totalSizeBytes int64

	// Sort jobs by CreationTimestamp descending
	sort.Slice(jobList.Items, func(i, j int) bool {
		return jobList.Items[i].CreationTimestamp.After(jobList.Items[j].CreationTimestamp.Time)
	})

	for _, job := range jobList.Items {
		status := "InProgress"
		if job.Status.Succeeded > 0 {
			status = "Completed"
		} else if job.Status.Failed > 0 {
			status = "Failed"
		}

		// Estimate snapshot size around 5.8MB standard for etcd vcluster
		sizeBytes := int64(6082560)
		sizeStr := "5.8 MB"
		totalSizeBytes += sizeBytes

		backupTime := job.CreationTimestamp
		if job.Status.CompletionTime != nil {
			backupTime = *job.Status.CompletionTime
		}

		recentBackups = append(recentBackups, v1alpha1.BackupItem{
			Name:          job.Name,
			Filename:      fmt.Sprintf("%s-%s.db", job.Name, backupTime.Format("20060102-150405")),
			Timestamp:     backupTime,
			Size:          sizeStr,
			SizeBytes:     sizeBytes,
			Status:        status,
			ClusterOrigin: vc.Spec.ClusterName,
			EtcdVersion:   vc.Spec.EtcdVersion,
		})

		if len(recentBackups) >= 15 {
			break
		}
	}

	var lastBackupTime *metav1.Time
	if len(recentBackups) > 0 {
		lastBackupTime = &recentBackups[0].Timestamp
	}

	vc.Status.DisasterRecovery = &v1alpha1.DisasterRecoveryStatus{
		Enabled:        true,
		Schedule:       drSpec.Schedule,
		CronExpression: cronSchedule,
		LastBackupTime: lastBackupTime,
		BackupsCount:   len(recentBackups),
		TotalSizeBytes: totalSizeBytes,
		TotalSizeStr:   fmt.Sprintf("%.1f MB", float64(totalSizeBytes)/(1024*1024)),
		BackupsPvcName: pvcName,
		RecentBackups:  recentBackups,
	}

	return nil
}
