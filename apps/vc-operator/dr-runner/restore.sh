#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backup}"
DATA_DIR="${DATA_DIR:-/var/lib/etcd}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-}"
CLUSTER_NAME="${CLUSTER_NAME:-vcluster}"
INITIAL_CLUSTER="${INITIAL_CLUSTER:-}"
INITIAL_CLUSTER_TOKEN="${INITIAL_CLUSTER_TOKEN:-${CLUSTER_NAME}}"
INITIAL_ADVERTISE_PEER_URLS="${INITIAL_ADVERTISE_PEER_URLS:-}"
MEMBER_NAME="${MEMBER_NAME:-default}"

echo "=== vCOp Disaster Recovery Restore Runner ==="
echo "Member Name: ${MEMBER_NAME}"
echo "Data Directory: ${DATA_DIR}"

if [ -z "${SNAPSHOT_FILE}" ]; then
  if [ -f "${BACKUP_DIR}/${CLUSTER_NAME}-snapshot-latest.db" ]; then
    SNAPSHOT_FILE="${BACKUP_DIR}/${CLUSTER_NAME}-snapshot-latest.db"
  else
    # Find newest .db file
    SNAPSHOT_FILE=$(ls -t "${BACKUP_DIR}"/*.db 2>/dev/null | head -n 1 || true)
  fi
fi

# If snapshot file is not yet found or does not exist locally, check shared DR vault
SHARED_DIR="${SHARED_BACKUP_DIR:-/shared-backups}"
if [ -z "${SNAPSHOT_FILE}" ] || [ ! -f "${SNAPSHOT_FILE}" ]; then
  BASE_NAME=$(basename "${SNAPSHOT_FILE:-}")
  if [ -n "${BASE_NAME}" ] && [ -f "${SHARED_DIR}/${BASE_NAME}" ]; then
    echo "Found snapshot in shared DR vault: ${SHARED_DIR}/${BASE_NAME}"
    SNAPSHOT_FILE="${SHARED_DIR}/${BASE_NAME}"
    # Mirror into local backup directory
    cp "${SNAPSHOT_FILE}" "${BACKUP_DIR}/${BASE_NAME}" 2>/dev/null || true
  elif [ -f "${SHARED_DIR}/${CLUSTER_NAME}-snapshot-latest.db" ]; then
    echo "Found latest snapshot in shared DR vault: ${SHARED_DIR}/${CLUSTER_NAME}-snapshot-latest.db"
    SNAPSHOT_FILE="${SHARED_DIR}/${CLUSTER_NAME}-snapshot-latest.db"
    cp "${SNAPSHOT_FILE}" "${BACKUP_DIR}/${CLUSTER_NAME}-snapshot-latest.db" 2>/dev/null || true
  fi
fi

if [ -z "${SNAPSHOT_FILE}" ] || [ ! -f "${SNAPSHOT_FILE}" ]; then
  echo "INFO: No snapshot file found to restore at ${SNAPSHOT_FILE}. Proceeding normally."
  exit 0
fi

echo "Restoring from snapshot: ${SNAPSHOT_FILE}"

RESTORED_MARKER="${DATA_DIR}/.restored_$(basename "${SNAPSHOT_FILE}")"
if [ -f "${RESTORED_MARKER}" ]; then
  echo "Snapshot ${SNAPSHOT_FILE} was already restored into ${DATA_DIR}. Skipping duplicate restore."
  exit 0
fi

# If data dir already has member directory and force isn't set, skip
if [ -d "${DATA_DIR}/member" ] && [ "${FORCE_RESTORE:-false}" != "true" ]; then
  echo "Data directory ${DATA_DIR}/member already exists. Skipping restore."
  exit 0
fi

# Clean destination data directory
rm -rf "${DATA_DIR:?}"/*

RESTORE_ARGS=(
  "snapshot" "restore" "${SNAPSHOT_FILE}"
  "--data-dir=${DATA_DIR}"
  "--name=${MEMBER_NAME}"
  "--skip-hash-check=true"
)

if [ -n "${INITIAL_CLUSTER}" ]; then
  RESTORE_ARGS+=("--initial-cluster=${INITIAL_CLUSTER}")
fi
if [ -n "${INITIAL_CLUSTER_TOKEN}" ]; then
  RESTORE_ARGS+=("--initial-cluster-token=${INITIAL_CLUSTER_TOKEN}")
fi
if [ -n "${INITIAL_ADVERTISE_PEER_URLS}" ]; then
  RESTORE_ARGS+=("--initial-advertise-peer-urls=${INITIAL_ADVERTISE_PEER_URLS}")
fi

etcdutl "${RESTORE_ARGS[@]}"

touch "${RESTORED_MARKER}"

echo "=== Restore Complete ==="
