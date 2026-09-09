import { Pool } from 'pg';
import type {
  AuditEvent,
  AuditCategory,
  AuditStatus,
  AuditLogQueryFilters,
  AuditLogStats,
} from './types';

let pool: Pool | null = null;
let dbInitialized = false;

// In-memory fallback ring buffer for instant local reads and offline resilience
const inMemoryAuditLogs: AuditEvent[] = [];
const MAX_IN_MEMORY_LOGS = 1000;

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
      console.warn('[audit-logger] Idle database client error:', err.message);
    });
  }
  return pool;
}

/**
 * Initializes the PostgreSQL audit_logs table and performance indexes.
 */
export async function initAuditDb(): Promise<boolean> {
  if (dbInitialized) return true;
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGSERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          user_id VARCHAR(128),
          username VARCHAR(256) NOT NULL,
          user_role VARCHAR(64) NOT NULL,
          action VARCHAR(128) NOT NULL,
          category VARCHAR(64) NOT NULL,
          resource_type VARCHAR(64) NOT NULL,
          resource_name VARCHAR(256),
          status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
          details JSONB,
          ip_address VARCHAR(128),
          user_agent TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_ts 
          ON audit_logs(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user 
          ON audit_logs(username, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_category 
          ON audit_logs(category, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
          ON audit_logs(action, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_resource 
          ON audit_logs(resource_type, resource_name);
      `);
      dbInitialized = true;
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn('[audit-logger] PostgreSQL init warning (using in-memory buffer):', err.message);
    return false;
  }
}

/**
 * Extracts client IP address accurately from standard reverse proxy headers.
 */
export function extractClientIp(request?: Request): string {
  if (!request) return '127.0.0.1';
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map((ip) => ip.trim());
    if (ips.length > 0 && ips[0]) return ips[0];
  }
  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp.trim();
  return '127.0.0.1';
}

/**
 * Extracts User-Agent string from request.
 */
export function extractUserAgent(request?: Request): string {
  if (!request) return 'Internal System';
  return request.headers.get('user-agent') || 'Unknown Client';
}

export interface RecordAuditLogParams {
  action: string;
  category: AuditCategory;
  resourceType: string;
  resourceName?: string;
  username: string;
  userRole?: string;
  userId?: string;
  status?: AuditStatus;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  request?: Request;
}

/**
 * Records an audit log event into memory buffer and persistently into PostgreSQL.
 */
export async function recordAuditLog(params: RecordAuditLogParams): Promise<AuditEvent> {
  const timestamp = new Date().toISOString();
  const ipAddress = params.ipAddress || extractClientIp(params.request);
  const userAgent = params.userAgent || extractUserAgent(params.request);
  const userRole = params.userRole || 'viewer';
  const status = params.status || 'SUCCESS';
  const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const event: AuditEvent = {
    id,
    timestamp,
    userId: params.userId,
    username: params.username || 'anonymous',
    userRole,
    action: params.action,
    category: params.category,
    resourceType: params.resourceType,
    resourceName: params.resourceName,
    status,
    details: params.details,
    ipAddress,
    userAgent,
  };

  // 1. Always append to in-memory buffer
  inMemoryAuditLogs.unshift(event);
  if (inMemoryAuditLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryAuditLogs.pop();
  }

  // 2. Asynchronously write to PostgreSQL
  (async () => {
    try {
      const ready = await initAuditDb();
      if (!ready) return;

      const p = getPool();
      await p.query(
        `INSERT INTO audit_logs (
          timestamp, user_id, username, user_role, action, category,
          resource_type, resource_name, status, details, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          new Date(timestamp),
          event.userId || null,
          event.username,
          event.userRole,
          event.action,
          event.category,
          event.resourceType,
          event.resourceName || null,
          event.status,
          event.details ? JSON.stringify(event.details) : null,
          event.ipAddress || null,
          event.userAgent || null,
        ]
      );
    } catch (err: any) {
      console.warn('[audit-logger] Failed writing audit log to PostgreSQL:', err.message);
    }
  })().catch(() => {});

  return event;
}

/**
 * Queries audit logs with full filtering, search, and pagination.
 */
export async function queryAuditLogs(
  filters: AuditLogQueryFilters = {}
): Promise<{ logs: AuditEvent[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  try {
    const ready = await initAuditDb();
    if (ready) {
      const p = getPool();
      const whereClauses: string[] = [];
      const values: any[] = [];
      let valIndex = 1;

      if (filters.category && filters.category !== 'ALL') {
        whereClauses.push(`category = $${valIndex++}`);
        values.push(filters.category);
      }

      if (filters.status && filters.status !== 'ALL') {
        whereClauses.push(`status = $${valIndex++}`);
        values.push(filters.status);
      }

      if (filters.username && filters.username.trim()) {
        whereClauses.push(`LOWER(username) = LOWER($${valIndex++})`);
        values.push(filters.username.trim());
      }

      if (filters.resourceType && filters.resourceType.trim()) {
        whereClauses.push(`LOWER(resource_type) = LOWER($${valIndex++})`);
        values.push(filters.resourceType.trim());
      }

      if (filters.resourceName && filters.resourceName.trim()) {
        whereClauses.push(`LOWER(resource_name) LIKE LOWER($${valIndex++})`);
        values.push(`%${filters.resourceName.trim()}%`);
      }

      if (filters.startDate) {
        whereClauses.push(`timestamp >= $${valIndex++}`);
        values.push(new Date(filters.startDate));
      }

      if (filters.endDate) {
        whereClauses.push(`timestamp <= $${valIndex++}`);
        values.push(new Date(filters.endDate));
      }

      if (filters.search && filters.search.trim()) {
        const term = `%${filters.search.trim()}%`;
        whereClauses.push(`(
          LOWER(username) LIKE LOWER($${valIndex}) OR
          LOWER(action) LIKE LOWER($${valIndex}) OR
          LOWER(resource_name) LIKE LOWER($${valIndex}) OR
          LOWER(resource_type) LIKE LOWER($${valIndex}) OR
          LOWER(ip_address) LIKE LOWER($${valIndex}) OR
          details::text ILIKE $${valIndex}
        )`);
        values.push(term);
        valIndex++;
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count query
      const countRes = await p.query(`SELECT COUNT(*) as total FROM audit_logs ${whereSql}`, values);
      const total = parseInt(countRes.rows[0]?.total || '0', 10);

      // Data query
      const dataQuery = `
        SELECT id, timestamp, user_id, username, user_role, action, category,
               resource_type, resource_name, status, details, ip_address, user_agent
        FROM audit_logs
        ${whereSql}
        ORDER BY timestamp DESC
        LIMIT $${valIndex++} OFFSET $${valIndex++}
      `;
      const dataRes = await p.query(dataQuery, [...values, limit, offset]);

      const logs: AuditEvent[] = dataRes.rows.map((row) => ({
        id: row.id.toString(),
        timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
        userId: row.user_id,
        username: row.username,
        userRole: row.user_role,
        action: row.action,
        category: row.category,
        resourceType: row.resource_type,
        resourceName: row.resource_name,
        status: row.status,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
      }));

      return { logs, total, limit, offset };
    }
  } catch (err: any) {
    console.warn('[audit-logger] Query failed on PostgreSQL, falling back to in-memory:', err.message);
  }

  // In-memory fallback querying
  let filtered = [...inMemoryAuditLogs];

  if (filters.category && filters.category !== 'ALL') {
    filtered = filtered.filter((l) => l.category === filters.category);
  }
  if (filters.status && filters.status !== 'ALL') {
    filtered = filtered.filter((l) => l.status === filters.status);
  }
  if (filters.username && filters.username.trim()) {
    const un = filters.username.trim().toLowerCase();
    filtered = filtered.filter((l) => l.username.toLowerCase() === un);
  }
  if (filters.resourceType && filters.resourceType.trim()) {
    const rt = filters.resourceType.trim().toLowerCase();
    filtered = filtered.filter((l) => l.resourceType.toLowerCase() === rt);
  }
  if (filters.resourceName && filters.resourceName.trim()) {
    const rn = filters.resourceName.trim().toLowerCase();
    filtered = filtered.filter((l) => (l.resourceName || '').toLowerCase().includes(rn));
  }
  if (filters.startDate) {
    const sTime = new Date(filters.startDate).getTime();
    filtered = filtered.filter((l) => new Date(l.timestamp).getTime() >= sTime);
  }
  if (filters.endDate) {
    const eTime = new Date(filters.endDate).getTime();
    filtered = filtered.filter((l) => new Date(l.timestamp).getTime() <= eTime);
  }
  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim().toLowerCase();
    filtered = filtered.filter((l) =>
      l.username.toLowerCase().includes(s) ||
      l.action.toLowerCase().includes(s) ||
      (l.resourceName || '').toLowerCase().includes(s) ||
      l.resourceType.toLowerCase().includes(s) ||
      (l.ipAddress || '').toLowerCase().includes(s) ||
      (l.details ? JSON.stringify(l.details).toLowerCase().includes(s) : false)
    );
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return { logs: paginated, total, limit, offset };
}

/**
 * Calculates statistics across audit events for dashboards and metrics cards.
 */
export async function getAuditStats(): Promise<AuditLogStats> {
  const defaultDistribution: Record<AuditCategory, number> = {
    AUTH: 0,
    CLUSTER: 0,
    APP: 0,
    ADMIN: 0,
    SECURITY: 0,
    SYSTEM: 0,
  };

  try {
    const ready = await initAuditDb();
    if (ready) {
      const p = getPool();
      const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const statsRes = await p.query(
        `SELECT
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE category = 'AUTH' AND status = 'SUCCESS') as total_logins,
          COUNT(*) FILTER (WHERE category = 'AUTH' AND status = 'FAILURE') as failed_logins,
          COUNT(*) FILTER (WHERE category = 'CLUSTER') as cluster_mutations,
          COUNT(DISTINCT username) as active_users
         FROM audit_logs
         WHERE timestamp >= $1`,
        [past24h]
      );

      const distRes = await p.query(
        `SELECT category, COUNT(*) as count
         FROM audit_logs
         WHERE timestamp >= $1
         GROUP BY category`,
        [past24h]
      );

      const dist: Record<AuditCategory, number> = { ...defaultDistribution };
      for (const row of distRes.rows) {
        if (row.category in dist) {
          dist[row.category as AuditCategory] = parseInt(row.count, 10);
        }
      }

      const row = statsRes.rows[0] || {};
      return {
        totalEvents: parseInt(row.total_events || '0', 10),
        totalLogins: parseInt(row.total_logins || '0', 10),
        failedLogins: parseInt(row.failed_logins || '0', 10),
        clusterMutations: parseInt(row.cluster_mutations || '0', 10),
        activeUsersCount: parseInt(row.active_users || '0', 10),
        recentActivityDistribution: dist,
      };
    }
  } catch (err: any) {
    console.warn('[audit-logger] getAuditStats fallback to in-memory:', err.message);
  }

  // In-memory stats calculation (past 24h)
  const past24hTime = Date.now() - 24 * 60 * 60 * 1000;
  const recentLogs = inMemoryAuditLogs.filter((l) => new Date(l.timestamp).getTime() >= past24hTime);

  const users = new Set<string>();
  const dist: Record<AuditCategory, number> = { ...defaultDistribution };
  let totalLogins = 0;
  let failedLogins = 0;
  let clusterMutations = 0;

  for (const log of recentLogs) {
    users.add(log.username);
    if (log.category in dist) {
      dist[log.category]++;
    }
    if (log.category === 'AUTH') {
      if (log.status === 'SUCCESS') totalLogins++;
      else if (log.status === 'FAILURE') failedLogins++;
    }
    if (log.category === 'CLUSTER') {
      clusterMutations++;
    }
  }

  return {
    totalEvents: recentLogs.length,
    totalLogins,
    failedLogins,
    clusterMutations,
    activeUsersCount: users.size,
    recentActivityDistribution: dist,
  };
}

/**
 * Formats audit logs for export as CSV or JSON.
 */
export async function exportAuditLogs(
  format: 'json' | 'csv',
  filters: AuditLogQueryFilters = {}
): Promise<string> {
  const result = await queryAuditLogs({ ...filters, limit: 1000, offset: 0 });
  const logs = result.logs;

  if (format === 'json') {
    return JSON.stringify(logs, null, 2);
  }

  // CSV formatting
  const headers = ['Timestamp', 'Username', 'Role', 'Category', 'Action', 'ResourceType', 'ResourceName', 'Status', 'IPAddress', 'Details'];
  const escapeCsv = (str: any): string => {
    if (str === null || str === undefined) return '""';
    const s = typeof str === 'object' ? JSON.stringify(str) : String(str);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const rows = logs.map((log) => [
    escapeCsv(log.timestamp),
    escapeCsv(log.username),
    escapeCsv(log.userRole),
    escapeCsv(log.category),
    escapeCsv(log.action),
    escapeCsv(log.resourceType),
    escapeCsv(log.resourceName || ''),
    escapeCsv(log.status),
    escapeCsv(log.ipAddress || ''),
    escapeCsv(log.details || {}),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
