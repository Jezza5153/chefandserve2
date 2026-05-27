# Chef & Serve — DB Backup + Restore

> Survival hatch until we ship a hosted backup service. Backups land on
> the user's Mac Mini, encrypted (optional) with age. Restore drills
> verify the backup is actually restorable.

## What ships in this repo

- `scripts/backup-neon.sh` — runs pg_dump → gzip → optional age → records
  to `backup_runs` table.
- `scripts/restore-drill.sh` — restores latest backup to a target DB and
  runs sanity queries. Records to `restore_drills` table.
- `scripts/backup-install.sh` — installs the launchd plist + triggers
  an immediate test run.
- `scripts/launchd/com.chefandserve2.backup.plist` — launchd job that
  fires every Monday 03:00 local time.

## Setup (one time)

### Prereqs

```bash
# pg_dump from libpq (NOT the postgresql-server formula):
brew install libpq
brew link --force libpq

# Optional but recommended: age for at-rest encryption
brew install age
```

### Generate an age key pair (recommended)

```bash
mkdir -p ~/.ssh
age-keygen -o ~/.ssh/chefandserve-backup.key
# This prints "Public key: age1xxxxxx..." — copy that string.
chmod 600 ~/.ssh/chefandserve-backup.key

# Store the public key in your shell rc for the backup script
echo 'export AGE_PUBLIC_KEY="age1xxxxxx..."' >> ~/.zshrc
echo 'export AGE_PRIVATE_KEY_FILE="$HOME/.ssh/chefandserve-backup.key"' >> ~/.zshrc
source ~/.zshrc
```

**CRITICAL**: also save the private key to 1Password + a sealed paper
copy in a physical safe. If you lose the key, you can NEVER decrypt your
backups.

### Install launchd schedule

```bash
bash scripts/backup-install.sh
```

This:
- Substitutes paths in the plist template
- Copies to `~/Library/LaunchAgents/`
- Bootstraps it (launchd picks it up)
- Triggers one immediate test backup

Verify:

```bash
launchctl list | grep chefandserve2
ls -la ~/Backups/chefandserve2/
cat ~/Backups/chefandserve2/backup.log | tail -20
```

You should see a `dump-YYYY-MM-DD-HHMM.sql.gz.age` (or `.sql.gz` if no
age) file plus a recent backup_runs row in the production DB.

## Manual operations

### Run a backup right now

```bash
bash scripts/backup-neon.sh
```

### Run a restore drill

```bash
# Target = local postgres (recommended for first try):
LOCAL_RESTORE_DB_URL='postgres://user:pass@localhost:5432/cs_restore_test' \
  bash scripts/restore-drill.sh
```

Manual restore from a specific backup file:

```bash
# Decrypt if encrypted
age -d -i ~/.ssh/chefandserve-backup.key \
  -o /tmp/restore.sql.gz \
  ~/Backups/chefandserve2/dump-2026-05-27-0300.sql.gz.age

# Restore
gunzip -c /tmp/restore.sql.gz | psql 'postgres://...your-target-db...'
```

### Force the launchd job to fire now (test schedule)

```bash
launchctl kickstart -k "gui/$(id -u)/com.chefandserve2.backup"
```

### Disable / re-enable

```bash
# Stop
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.chefandserve2.backup.plist

# Re-enable
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.chefandserve2.backup.plist
```

## Retention

`backup-neon.sh` keeps the last 12 weeks (84 days) of files locally.
Older files are deleted. `backup_runs` rows in the DB are kept forever
(< 1KB each — trivial).

## Recovery worst-case path

1. Get the most recent encrypted `dump-*.sql.gz.age` from `~/Backups/chefandserve2/`.
2. Decrypt with `~/.ssh/chefandserve-backup.key`.
3. `gunzip` → SQL.
4. Run a fresh Neon DB (or spin up a temporary one).
5. `psql ... < dump.sql` to restore.
6. Reconnect the app to the new connection string in Vercel env.

## Out of scope (future work)

- Hosted backup target (S3 / Backblaze B2). Cheap and reliable.
- Continuous WAL archiving (point-in-time recovery, not just daily snapshots).
- pgvector index rebuild after restore (Phase 9+).
