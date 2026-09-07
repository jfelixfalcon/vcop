import type { APIRoute } from 'astro';
import { getVirtualCluster, triggerEtcdBackup, updateDisasterRecovery, restoreEtcdSnapshot } from '../../../../lib/k8s-client';
import { canUserManageCluster } from '../../../../lib/auth';

export const GET: APIRoute = async ({ params, locals }) => {
  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cluster = await getVirtualCluster(name);
  if (!cluster) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        spec: cluster.spec?.disasterRecovery || { enabled: true, schedule: 'daily', retentionCount: 7, storageSize: '10Gi' },
        status: cluster.status?.disasterRecovery || {
          enabled: false,
          schedule: 'daily',
          backupsCount: 0,
          totalSizeBytes: 0,
          totalSizeStr: '0 MB',
          recentBackups: [],
        },
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user || !canUserManageCluster(user)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Forbidden: Administrator privileges required to manage disaster recovery.' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { name } = params;
  if (!name) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cluster = await getVirtualCluster(name);
  if (!cluster) {
    return new Response(JSON.stringify({ success: false, error: 'Cluster not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'backup-now') {
      const result = await triggerEtcdBackup(name, cluster.namespace);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Manual backup job ${result.jobName} triggered successfully for cluster ${name}`,
          data: result,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (action === 'update-schedule') {
      if (!body.disasterRecovery) {
        return new Response(JSON.stringify({ success: false, error: 'disasterRecovery spec required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const updated = await updateDisasterRecovery(name, body.disasterRecovery, cluster.namespace);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Disaster recovery schedule updated for cluster ${name}`,
          data: updated,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (action === 'restore') {
      const snapshotName = body.snapshotName;
      if (!snapshotName) {
        return new Response(JSON.stringify({ success: false, error: 'snapshotName required for restore' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const updated = await restoreEtcdSnapshot(name, snapshotName, cluster.namespace);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Restore initiated for cluster ${name} from snapshot ${snapshotName}. StatefulSet pods are restarting.`,
          data: updated,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Invalid action '${action}'. Must be 'backup-now', 'update-schedule', or 'restore'.` }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
