#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backup}"
CLUSTER_NAME="${CLUSTER_NAME:-vcluster}"
ETCD_ENDPOINT="${ETCD_ENDPOINT:-https://127.0.0.1:2379}"
CACERT="${CACERT:-/run/config/pki/etcd-ca.crt}"
CERT="${CERT:-/run/config/pki/etcd-server.crt}"
KEY="${KEY:-/run/config/pki/etcd-server.key}"
RETENTION_COUNT="${RETENTION_COUNT:-7}"

mkdir -p "${BACKUP_DIR}"

TS=$(date -u +%Y%m%d-%H%M%S)
SNAPSHOT_NAME="${CLUSTER_NAME}-snapshot-${TS}.db"
SNAPSHOT_PATH="${BACKUP_DIR}/${SNAPSHOT_NAME}"
META_PATH="${BACKUP_DIR}/${CLUSTER_NAME}-snapshot-${TS}.json"

echo "=== vCOp Disaster Recovery Backup Runner ==="
echo "Timestamp: ${TS}"
echo "Target Endpoint: ${ETCD_ENDPOINT}"
echo "Output Snapshot: ${SNAPSHOT_PATH}"

# Check endpoint health before snapshotting
etcdctl --endpoints="${ETCD_ENDPOINT}" \
        --cacert="${CACERT}" \
        --cert="${CERT}" \
        --key="${KEY}" \
        endpoint health || {
  echo "ERROR: etcd endpoint ${ETCD_ENDPOINT} is unhealthy!"
  exit 1
}

# Save snapshot
etcdctl --endpoints="${ETCD_ENDPOINT}" \
        --cacert="${CACERT}" \
        --cert="${CERT}" \
        --key="${KEY}" \
        snapshot save "${SNAPSHOT_PATH}"

# Verify snapshot status
etcdutl snapshot status "${SNAPSHOT_PATH}"

# Compute size
SIZE_BYTES=$(wc -c < "${SNAPSHOT_PATH}" | tr -d ' ')
SIZE_HUMAN=$(du -h "${SNAPSHOT_PATH}" | cut -f1)

# Maintain latest copy
cp "${SNAPSHOT_PATH}" "${BACKUP_DIR}/${CLUSTER_NAME}-snapshot-latest.db"

# Write metadata
cat <<METADATA > "${META_PATH}"
{
  "name": "${SNAPSHOT_NAME}",
  "filename": "${SNAPSHOT_NAME}",
  "clusterOrigin": "${CLUSTER_NAME}",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "size": "${SIZE_HUMAN}",
  "sizeBytes": ${SIZE_BYTES},
  "status": "Completed"
}
METADATA

# Update index manifest in backup dir for rapid querying by UI
INDEX_FILE="${BACKUP_DIR}/backups-index.json"
echo "[" > "${INDEX_FILE}.tmp"
FIRST=true
for f in $(ls -t "${BACKUP_DIR}"/${CLUSTER_NAME}-snapshot-*.json 2>/dev/null); do
  if [ "${FIRST}" = true ]; then
    FIRST=false
  else
    echo "," >> "${INDEX_FILE}.tmp"
  fi
  cat "$f" >> "${INDEX_FILE}.tmp"
done
echo "]" >> "${INDEX_FILE}.tmp"
mv "${INDEX_FILE}.tmp" "${INDEX_FILE}"

echo "Snapshot successfully saved (${SIZE_HUMAN}, ${SIZE_BYTES} bytes)"

# Mirror to shared DR vault if directory is available (enables cross-cluster restore)
SHARED_DIR="${SHARED_BACKUP_DIR:-/shared-backups}"
if [ -d "${SHARED_DIR}" ]; then
  echo "Mirroring snapshot to shared DR vault: ${SHARED_DIR}"
  cp "${SNAPSHOT_PATH}" "${SHARED_DIR}/${SNAPSHOT_NAME}" || true
  cp "${META_PATH}" "${SHARED_DIR}/${CLUSTER_NAME}-snapshot-${TS}.json" || true
  cp "${SNAPSHOT_PATH}" "${SHARED_DIR}/${CLUSTER_NAME}-snapshot-latest.db" || true
fi

# Enforce retention policy
echo "Enforcing retention policy (keep ${RETENTION_COUNT} most recent backups)..."
SNAPSHOT_COUNT=$(ls -1 "${BACKUP_DIR}"/${CLUSTER_NAME}-snapshot-*.db 2>/dev/null | grep -v 'latest' | wc -l || echo 0)
if [ "${SNAPSHOT_COUNT}" -gt "${RETENTION_COUNT}" ]; then
  EXCESS=$((SNAPSHOT_COUNT - RETENTION_COUNT))
  echo "Found ${SNAPSHOT_COUNT} backups, removing ${EXCESS} oldest..."
  ls -1tr "${BACKUP_DIR}"/${CLUSTER_NAME}-snapshot-*.db 2>/dev/null | grep -v 'latest' | head -n "${EXCESS}" | while read -r old_db; do
    echo "Pruning old snapshot: ${old_db}"
    rm -f "${old_db}"
    rm -f "${old_db%.db}.json"
  done
fi

echo "=== Backup Complete ==="
