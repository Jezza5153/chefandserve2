#!/usr/bin/env bash
# PR-CHEF-13 — monthly restore drill.
#
# Restores the latest backup into a Neon dev branch and runs sanity
# queries. Inserts a restore_drills row with the result.
#
# Why: a backup that's never restored is not a backup.
#
# Manual run: bash scripts/restore-drill.sh
#
# Requires neonctl (npm install -g neonctl) AND project-ref configured.
# If you don't have neonctl set up, you can run with TARGET=local_dev
# (set LOCAL_RESTORE_DB_URL env to a throwaway local postgres):
#   LOCAL_RESTORE_DB_URL=postgres://... bash scripts/restore-drill.sh

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${HOME}/Backups/chefandserve2"
LOG="${BACKUP_DIR}/restore.log"

mkdir -p "${BACKUP_DIR}"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "${LOG}" >&2
}

log "===== restore drill starting ====="

# Pick the most recent backup
LATEST=$(ls -t "${BACKUP_DIR}"/dump-*.sql.gz* 2>/dev/null | head -1)
if [[ -z "${LATEST}" ]]; then
  log "FAIL: no backups found in ${BACKUP_DIR}"
  exit 1
fi
log "latest backup: ${LATEST}"

# Decrypt if needed
WORK="${LATEST}"
if [[ "${LATEST}" == *.age ]]; then
  if [[ -z "${AGE_PRIVATE_KEY_FILE:-}" ]]; then
    log "FAIL: encrypted backup but AGE_PRIVATE_KEY_FILE not set"
    exit 1
  fi
  WORK="${BACKUP_DIR}/restore-decrypted.sql.gz"
  if ! age -d -i "${AGE_PRIVATE_KEY_FILE}" -o "${WORK}" "${LATEST}" 2>>"${LOG}"; then
    log "FAIL: age decryption failed"
    exit 1
  fi
  log "decrypted → ${WORK}"
fi

# Restore target
TARGET="${TARGET:-local_dev}"
TARGET_URL=""
if [[ "${TARGET}" == "local_dev" ]]; then
  TARGET_URL="${LOCAL_RESTORE_DB_URL:-}"
  if [[ -z "${TARGET_URL}" ]]; then
    log "FAIL: LOCAL_RESTORE_DB_URL not set"
    exit 1
  fi
elif [[ "${TARGET}" == "neon_dev_branch" ]]; then
  log "FAIL: neon_dev_branch target not implemented yet — use TARGET=local_dev"
  exit 1
fi

# Restore
log "restoring to ${TARGET}..."
RESULT="ok"
ROW_CHECK="0"
NOTES=""
if ! gunzip -c "${WORK}" | psql "${TARGET_URL}" -q -v ON_ERROR_STOP=1 >>"${LOG}" 2>&1; then
  RESULT="failed"
  NOTES="psql restore returned nonzero"
fi

# Sanity queries
if [[ "${RESULT}" == "ok" ]]; then
  USERS_COUNT=$(psql "${TARGET_URL}" -t -A -c "SELECT count(*) FROM users")
  CHEFS_COUNT=$(psql "${TARGET_URL}" -t -A -c "SELECT count(*) FROM chefs")
  ROW_CHECK="${USERS_COUNT}"
  log "sanity: ${USERS_COUNT} users, ${CHEFS_COUNT} chefs"
  if [[ "${USERS_COUNT}" -lt 1 ]] || [[ "${CHEFS_COUNT}" -lt 0 ]]; then
    RESULT="data_mismatch"
    NOTES="users=${USERS_COUNT}, chefs=${CHEFS_COUNT}"
  fi
fi

# Cleanup decrypted file
if [[ "${WORK}" != "${LATEST}" ]]; then
  rm -f "${WORK}"
fi

# Insert restore_drills row in PROD DB (where the data lives)
PROD_URL=$(grep -E '^DATABASE_URL_UNPOOLED=' "${PROJECT_ROOT}/.env.local" | head -1 | cut -d= -f2-)
if [[ -n "${PROD_URL}" ]]; then
  psql "${PROD_URL}" -v ON_ERROR_STOP=1 -q -c "
    INSERT INTO restore_drills (restored_at, target, row_count_spot_check, result, notes)
    VALUES (now(), '${TARGET}', ${ROW_CHECK}, '${RESULT}', NULLIF('${NOTES}', ''))
  " >>"${LOG}" 2>&1 || log "WARN: could not insert restore_drills row"
fi

log "RESULT: ${RESULT}"
log "===== restore drill done ====="
[[ "${RESULT}" == "ok" ]] && exit 0 || exit 1
