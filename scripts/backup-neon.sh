#!/usr/bin/env bash
# PR-CHEF-13 — weekly Neon DB backup to Mac Mini.
#
# Runs from launchd (~/Library/LaunchAgents/com.chefandserve2.backup.plist)
# every Monday 03:00 local time. Output goes to ~/Backups/chefandserve2/.
#
# Steps:
#   1. pg_dump Neon DB via DATABASE_URL_UNPOOLED (from .env.local)
#   2. gzip
#   3. (optional) age-encrypt if AGE_PUBLIC_KEY env var is set
#   4. compute sha256 of gzip (and of encrypted file if encrypted)
#   5. INSERT into backup_runs via psql
#   6. keep last 12 weeks, delete older
#
# Manual run: bash scripts/backup-neon.sh
# Logs: ~/Backups/chefandserve2/backup.log
#
# NEVER logs the DATABASE_URL.

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${HOME}/Backups/chefandserve2"
LOG="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "${LOG}" >&2
}

log "===== backup starting ====="

# Load DATABASE_URL_UNPOOLED from .env.local
if [[ ! -f "${PROJECT_ROOT}/.env.local" ]]; then
  log "FAIL: ${PROJECT_ROOT}/.env.local not found"
  exit 1
fi
# Extract the connection string without echoing it
DATABASE_URL_UNPOOLED=$(grep -E '^DATABASE_URL_UNPOOLED=' "${PROJECT_ROOT}/.env.local" | head -1 | cut -d= -f2-)
if [[ -z "${DATABASE_URL_UNPOOLED}" ]]; then
  log "FAIL: DATABASE_URL_UNPOOLED not set in .env.local"
  exit 1
fi

# Tools check
if ! command -v pg_dump >/dev/null 2>&1; then
  log "FAIL: pg_dump not installed (brew install libpq && brew link --force libpq)"
  exit 1
fi

DATE=$(date -u +"%Y-%m-%d-%H%M")
FILE="${BACKUP_DIR}/dump-${DATE}.sql.gz"

log "writing ${FILE} ..."
if ! pg_dump --format=plain --no-owner --no-acl --no-comments --clean --if-exists \
  "${DATABASE_URL_UNPOOLED}" 2>>"${LOG}" | gzip > "${FILE}"; then
  log "FAIL: pg_dump returned nonzero"
  rm -f "${FILE}"
  exit 1
fi

SIZE=$(stat -f%z "${FILE}" 2>/dev/null || stat -c%s "${FILE}" 2>/dev/null || echo 0)
if [[ "${SIZE}" -lt 1024 ]]; then
  log "FAIL: file size ${SIZE} bytes < 1KB — backup probably empty"
  exit 1
fi
SHA=$(shasum -a 256 "${FILE}" | awk '{print $1}')
log "wrote ${SIZE} bytes · sha256: ${SHA:0:16}..."

# Optional age encryption
ENCRYPTED_SHA=""
if [[ -n "${AGE_PUBLIC_KEY:-}" ]] && command -v age >/dev/null 2>&1; then
  ENC_FILE="${FILE}.age"
  if age -r "${AGE_PUBLIC_KEY}" -o "${ENC_FILE}" "${FILE}" 2>>"${LOG}"; then
    ENCRYPTED_SHA=$(shasum -a 256 "${ENC_FILE}" | awk '{print $1}')
    rm "${FILE}"  # remove unencrypted now that .age exists
    FILE="${ENC_FILE}"
    log "encrypted → ${ENC_FILE} · sha256: ${ENCRYPTED_SHA:0:16}..."
  else
    log "WARN: age encryption failed — keeping unencrypted"
  fi
else
  log "INFO: AGE_PUBLIC_KEY not set or 'age' missing — backup unencrypted"
fi

# Insert backup_runs row
if command -v psql >/dev/null 2>&1; then
  psql "${DATABASE_URL_UNPOOLED}" -v ON_ERROR_STOP=1 -q -c "
    INSERT INTO backup_runs (started_at, finished_at, status, file_size, checksum, encrypted_checksum, location)
    VALUES (
      now() - interval '1 minute', now(), 'ok',
      ${SIZE}, '${SHA}',
      $(if [[ -n "${ENCRYPTED_SHA}" ]]; then echo "'${ENCRYPTED_SHA}'"; else echo "NULL"; fi),
      '${FILE}'
    )
  " >>"${LOG}" 2>&1 || log "WARN: could not insert backup_runs row"
fi

# Retention: keep 12 weeks
find "${BACKUP_DIR}" -name 'dump-*.sql.gz*' -type f -mtime +84 -delete

log "OK: ${FILE} (${SIZE} bytes)"
log "===== backup done ====="
