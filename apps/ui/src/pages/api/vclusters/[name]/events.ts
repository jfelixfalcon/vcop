import type { APIRoute } from 'astro';
import { getVirtualCluster, getVirtualClusterEvents } from '../../../../lib/k8s-client';
import { queryAuditLogs } from '../../../../lib/audit-logger';
import type { K8sEvent } from '../../../../lib/types';

export const GET: APIRoute = async ({ params }) => {
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

  // 1. Fetch live Kubernetes namespace events
  const k8sEvents = await getVirtualClusterEvents(cluster.namespace, cluster.name);

  // 2. Fetch platform audit logs for this virtual cluster
  let auditEvents: K8sEvent[] = [];
  try {
    const auditRes = await queryAuditLogs({ resourceName: cluster.name, limit: 25 });
    if (auditRes && Array.isArray(auditRes.logs)) {
      auditEvents = auditRes.logs.map((log) => ({
        name: `audit-${log.id}`,
        type: (log.status === 'SUCCESS' ? 'Normal' : 'Warning') as 'Normal' | 'Warning',
        reason: log.action || 'AuditActivity',
        message:
          typeof log.details?.message === 'string'
            ? log.details.message
            : typeof log.details?.reason === 'string'
            ? log.details.reason
            : `${log.username} triggered ${log.action} [${log.category}]`,
        count: 1,
        lastTimestamp: log.timestamp,
        sourceComponent: log.username === 'system' || log.username === 'vc-operator' ? 'vc-operator' : `user:${log.username}`,
        involvedObject: {
          kind: 'VirtualCluster',
          name: cluster.name,
          namespace: cluster.namespace,
        },
      }));
    }
  } catch (err) {
    console.warn('[events-api] Audit log query fallback:', err);
  }

  // 3. Synthesize operator reconciliation condition events
  const conditionEvents: K8sEvent[] = (cluster.status.conditions || []).map((cond) => ({
    name: `${cluster.name}-${cond.type}`,
    type: (cond.status === 'False' && cond.type !== 'Sleeping' ? 'Warning' : 'Normal') as 'Normal' | 'Warning',
    reason: cond.reason || cond.type,
    message: cond.message || `${cond.type} reconciled to ${cond.status}`,
    count: 1,
    lastTimestamp: cond.lastTransitionTime,
    sourceComponent: 'virtualcluster-controller',
    involvedObject: {
      kind: 'VirtualCluster',
      name: cluster.name,
      namespace: cluster.namespace,
    },
  }));

  // 4. Merge, de-duplicate, and sort descending by timestamp
  const seen = new Set<string>();
  const allEvents: K8sEvent[] = [];

  for (const ev of [...k8sEvents, ...auditEvents, ...conditionEvents]) {
    const key = `${ev.involvedObject?.name || ''}:${ev.reason}:${(ev.message || '').slice(0, 60)}`;
    if (!seen.has(key)) {
      seen.add(key);
      allEvents.push(ev);
    }
  }

  allEvents.sort((a, b) => {
    const timeA = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
    const timeB = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
    return timeB - timeA;
  });

  return new Response(JSON.stringify({ success: true, events: allEvents }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
