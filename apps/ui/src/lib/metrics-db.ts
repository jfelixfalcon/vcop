import { Pool } from 'pg';
import type { LivePodMetric, MetricTimeBucket, WorkloadKind } from './types';

export interface PodMetricSampleInput {
  vcluster: string;
  vclusterNamespace?: string;
  namespace: string;
  workloadKind: WorkloadKind;
  workloadName: string;
  podName: string;
  cpuMillis: number;
  memoryBytes: number;
  cpuLimitMillis?: number;
  memoryLimitBytes?: number;
  cpuRequestMillis?: number;
  memoryRequestBytes?: number;
  phase: string;
  ready: boolean;
  restarts: number;
  timestamp?: Date;
}

// In-memory fallback ring buffer in case DB is momentarily offline
const memoryFallbackBuffer: Record<string, PodMetricSampleInput[]> = {};
const MAX_FALLBACK_SAMPLES_PER_CLUSTER = 1000;

let pool: Pool | null = null;
let dbInitialized = false;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.METRICS_DB_HOST || 'vcop-metrics-db.vcop-system.svc',
      port: parseInt(process.env.METRICS_DB_PORT || '5432', 10),
      database: process.env.METRICS_DB_NAME || 'vcop_metrics',
      user: process.env.METRICS_DB_USER || 'vcop',
      password: process.env.METRICS_DB_PASSWORD || 'vcop-metrics-db-pass-2026',
      connectionTimeoutMillis: 3500,
      idleTimeoutMillis: 30000,
      max: 8,
    });

    pool.on('error', (err) => {
      console.warn('[metrics-db] Idle client error:', err.message);
    });
  }
  return pool;
}

export async function initMetricsDb(): Promise<boolean> {
  if (dbInitialized) return true;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS pod_metrics_samples (
          id BIGSERIAL PRIMARY KEY,
          vcluster VARCHAR(128) NOT NULL,
          vcluster_namespace VARCHAR(128) NOT NULL DEFAULT 'default',
          namespace VARCHAR(128) NOT NULL,
          workload_kind VARCHAR(64) NOT NULL,
          workload_name VARCHAR(128) NOT NULL,
          pod_name VARCHAR(256) NOT NULL,
          cpu_millis INT NOT NULL,
          memory_bytes BIGINT NOT NULL,
          cpu_limit_millis INT,
          memory_limit_bytes BIGINT,
          cpu_request_millis INT,
          memory_request_bytes BIGINT,
          phase VARCHAR(32),
          ready BOOLEAN,
          restarts INT,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_pms_vc_ts 
          ON pod_metrics_samples(vcluster, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_pms_workload 
          ON pod_metrics_samples(vcluster, namespace, workload_name, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_pms_pod 
          ON pod_metrics_samples(vcluster, namespace, pod_name, timestamp DESC);
      `);
      dbInitialized = true;
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn('[metrics-db] Database initialization warning (falling back to in-memory):', err.message);
    return false;
  }
}

export async function recordPodMetricsBatch(samples: PodMetricSampleInput[]): Promise<void> {
  if (!samples || samples.length === 0) return;

  const now = new Date();
  // Always buffer in memory for instant local queries
  for (const s of samples) {
    s.timestamp = s.timestamp || now;
    if (!memoryFallbackBuffer[s.vcluster]) {
      memoryFallbackBuffer[s.vcluster] = [];
    }
    const buf = memoryFallbackBuffer[s.vcluster];
    buf.push(s);
    if (buf.length > MAX_FALLBACK_SAMPLES_PER_CLUSTER) {
      buf.shift();
    }
  }

  try {
    const isReady = await initMetricsDb();
    if (!isReady) return;

    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      const queryText = `
        INSERT INTO pod_metrics_samples (
          vcluster, vcluster_namespace, namespace, workload_kind, workload_name,
          pod_name, cpu_millis, memory_bytes, cpu_limit_millis, memory_limit_bytes,
          cpu_request_millis, memory_request_bytes, phase, ready, restarts, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `;

      for (const s of samples) {
        await client.query(queryText, [
          s.vcluster,
          s.vclusterNamespace || 'default',
          s.namespace,
          s.workloadKind,
          s.workloadName,
          s.podName,
          s.cpuMillis,
          s.memoryBytes,
          s.cpuLimitMillis || null,
          s.memoryLimitBytes || null,
          s.cpuRequestMillis || null,
          s.memoryRequestBytes || null,
          s.phase,
          s.ready,
          s.restarts,
          s.timestamp || now,
        ]);
      }

      await client.query('COMMIT');

      // Async retention cleanup: 7 days
      if (Math.random() < 0.05) {
        client.query("DELETE FROM pod_metrics_samples WHERE timestamp < NOW() - INTERVAL '7 days'").catch(() => {});
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn('[metrics-db] Failed to insert samples into Postgres:', err.message);
  }
}

export interface HistoricalQueryOptions {
  vcluster: string;
  timeRange?: '15m' | '1h' | '6h' | '24h' | '7d';
  namespace?: string;
  workloadName?: string;
  workloadKind?: string;
  podName?: string;
}

export async function getHistoricalBuckets(options: HistoricalQueryOptions): Promise<MetricTimeBucket[]> {
  const range = options.timeRange || '1h';

  // Determine interval & date_trunc step
  let intervalSql = "INTERVAL '1 hour'";
  let stepMinutes = 2;
  let truncStep = 'minute';
  let totalLookbackMs = 60 * 60 * 1000;

  switch (range) {
    case '15m':
      intervalSql = "INTERVAL '15 minutes'";
      stepMinutes = 1;
      truncStep = 'minute';
      totalLookbackMs = 15 * 60 * 1000;
      break;
    case '6h':
      intervalSql = "INTERVAL '6 hours'";
      stepMinutes = 10;
      truncStep = 'hour';
      totalLookbackMs = 6 * 60 * 60 * 1000;
      break;
    case '24h':
      intervalSql = "INTERVAL '24 hours'";
      stepMinutes = 30;
      truncStep = 'hour';
      totalLookbackMs = 24 * 60 * 60 * 1000;
      break;
    case '7d':
      intervalSql = "INTERVAL '7 days'";
      stepMinutes = 120;
      truncStep = 'day';
      totalLookbackMs = 7 * 24 * 60 * 60 * 1000;
      break;
    case '1h':
    default:
      intervalSql = "INTERVAL '1 hour'";
      stepMinutes = 2;
      truncStep = 'minute';
      totalLookbackMs = 60 * 60 * 1000;
      break;
  }

  try {
    const isReady = await initMetricsDb();
    if (isReady) {
      const p = getPool();
      const params: any[] = [options.vcluster];
      let filterClauses = '';

      if (options.namespace) {
        params.push(options.namespace);
        filterClauses += ` AND namespace = $${params.length}`;
      }
      if (options.workloadName) {
        params.push(options.workloadName);
        filterClauses += ` AND workload_name = $${params.length}`;
      }
      if (options.workloadKind) {
        params.push(options.workloadKind);
        filterClauses += ` AND workload_kind = $${params.length}`;
      }
      if (options.podName) {
        params.push(options.podName);
        filterClauses += ` AND pod_name = $${params.length}`;
      }

      // Group by timestamp bucket, aggregating across pods or workloads
      const query = `
        SELECT 
          to_timestamp(floor(extract(epoch from timestamp) / (${stepMinutes} * 60)) * (${stepMinutes} * 60)) AT TIME ZONE 'UTC' as bucket_ts,
          COALESCE(SUM(cpu_millis), 0) as total_cpu_millis,
          COALESCE(ROUND(AVG(cpu_millis)), 0) as avg_cpu_millis,
          COALESCE(MAX(cpu_millis), 0) as max_cpu_millis,
          COALESCE(SUM(memory_bytes), 0) as total_memory_bytes,
          COALESCE(ROUND(AVG(memory_bytes)), 0) as avg_memory_bytes,
          COALESCE(MAX(memory_bytes), 0) as max_memory_bytes,
          COUNT(DISTINCT pod_name) as active_pods
        FROM pod_metrics_samples
        WHERE vcluster = $1
          AND timestamp >= NOW() - ${intervalSql}
          ${filterClauses}
        GROUP BY bucket_ts
        ORDER BY bucket_ts ASC;
      `;

      const result = await p.query(query, params);
      if (result.rows && result.rows.length > 0) {
        return result.rows.map((r) => ({
          timestamp: new Date(r.bucket_ts).toISOString(),
          totalCpuMillis: Number(r.total_cpu_millis),
          avgCpuMillis: Number(r.avg_cpu_millis),
          maxCpuMillis: Number(r.max_cpu_millis),
          totalMemoryBytes: Number(r.total_memory_bytes),
          avgMemoryBytes: Number(r.avg_memory_bytes),
          maxMemoryBytes: Number(r.max_memory_bytes),
          activePods: Number(r.active_pods),
        }));
      }
    }
  } catch (err: any) {
    console.warn('[metrics-db] Database query fallback:', err.message);
  }

  // Fallback to memory ring buffer
  const clusterSamples = memoryFallbackBuffer[options.vcluster] || [];
  const cutoff = Date.now() - totalLookbackMs;
  const filtered = clusterSamples.filter((s) => {
    if (!s.timestamp || s.timestamp.getTime() < cutoff) return false;
    if (options.namespace && s.namespace !== options.namespace) return false;
    if (options.workloadName && s.workloadName !== options.workloadName) return false;
    if (options.workloadKind && s.workloadKind !== options.workloadKind) return false;
    if (options.podName && s.podName !== options.podName) return false;
    return true;
  });

  // Group into time buckets
  const bucketMap: Record<string, PodMetricSampleInput[]> = {};
  const bucketStepMs = stepMinutes * 60 * 1000;

  for (const s of filtered) {
    const t = s.timestamp!.getTime();
    const bucketTime = Math.floor(t / bucketStepMs) * bucketStepMs;
    const key = new Date(bucketTime).toISOString();
    if (!bucketMap[key]) bucketMap[key] = [];
    bucketMap[key].push(s);
  }

  const buckets: MetricTimeBucket[] = Object.entries(bucketMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, items]) => {
      const totalCpu = items.reduce((acc, cur) => acc + cur.cpuMillis, 0);
      const totalMem = items.reduce((acc, cur) => acc + cur.memoryBytes, 0);
      const maxCpu = Math.max(...items.map((i) => i.cpuMillis), 0);
      const maxMem = Math.max(...items.map((i) => i.memoryBytes), 0);
      const uniquePods = new Set(items.map((i) => i.podName)).size;

      return {
        timestamp: ts,
        totalCpuMillis: totalCpu,
        avgCpuMillis: Math.round(totalCpu / (items.length || 1)),
        maxCpuMillis: maxCpu,
        totalMemoryBytes: totalMem,
        avgMemoryBytes: Math.round(totalMem / (items.length || 1)),
        maxMemoryBytes: maxMem,
        activePods: uniquePods,
      };
    });

  return buckets;
}

/**
 * Returns recent CPU and Memory sparkline points (up to 12 points)
 * for a specific pod or workload.
 */
export async function getSparklineSeries(
  vcluster: string,
  key: { namespace: string; workloadName?: string; podName?: string }
): Promise<{ cpu: number[]; mem: number[] }> {
  try {
    const isReady = await initMetricsDb();
    if (isReady) {
      const p = getPool();
      let where = 'vcluster = $1 AND namespace = $2';
      const params: any[] = [vcluster, key.namespace];

      if (key.podName) {
        params.push(key.podName);
        where += ` AND pod_name = $${params.length}`;
      } else if (key.workloadName) {
        params.push(key.workloadName);
        where += ` AND workload_name = $${params.length}`;
      }

      const query = `
        SELECT 
          to_timestamp(floor(extract(epoch from timestamp) / 60) * 60) as bucket,
          SUM(cpu_millis) as cpu,
          SUM(memory_bytes) as mem
        FROM pod_metrics_samples
        WHERE ${where}
          AND timestamp >= NOW() - INTERVAL '20 minutes'
        GROUP BY bucket
        ORDER BY bucket ASC
        LIMIT 12;
      `;

      const res = await p.query(query, params);
      if (res.rows && res.rows.length > 0) {
        return {
          cpu: res.rows.map((r) => Number(r.cpu)),
          mem: res.rows.map((r) => Number(r.mem)),
        };
      }
    }
  } catch {}

  // Fallback to in-memory buffer
  const buf = memoryFallbackBuffer[vcluster] || [];
  const matches = buf.filter((s) => {
    if (s.namespace !== key.namespace) return false;
    if (key.podName && s.podName !== key.podName) return false;
    if (key.workloadName && s.workloadName !== key.workloadName) return false;
    return true;
  });

  const recent = matches.slice(-12);
  return {
    cpu: recent.map((s) => s.cpuMillis),
    mem: recent.map((s) => s.memoryBytes),
  };
}
