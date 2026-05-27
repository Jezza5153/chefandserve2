#!/usr/bin/env bash
# PR-CHEF-13 — install launchd plist for weekly backup.
#
# Run once: bash scripts/backup-install.sh
# Triggers immediate test run, then schedules Monday 03:00 weekly.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="${PROJECT_ROOT}/scripts/launchd/com.chefandserve2.backup.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/com.chefandserve2.backup.plist"
BACKUP_DIR="${HOME}/Backups/chefandserve2"

if [[ ! -f "${PLIST_SRC}" ]]; then
  echo "ERROR: plist template not found at ${PLIST_SRC}"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
mkdir -p "${HOME}/Library/LaunchAgents"

# Substitute placeholders in template
sed \
  -e "s|__PROJECT_ROOT__|${PROJECT_ROOT}|g" \
  -e "s|__BACKUP_DIR__|${BACKUP_DIR}|g" \
  "${PLIST_SRC}" > "${PLIST_DST}"

echo "Installed: ${PLIST_DST}"

# Unload if already loaded
launchctl bootout "gui/$(id -u)" "${PLIST_DST}" 2>/dev/null || true

# Load
launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"
echo "Loaded into launchd. Next fire: Monday 03:00 local time."

# Immediate test run
echo "Running immediate test backup..."
bash "${PROJECT_ROOT}/scripts/backup-neon.sh"

echo
echo "✓ Setup complete. Verify with:"
echo "  launchctl list | grep chefandserve2"
echo "  ls -la ${BACKUP_DIR}/"
