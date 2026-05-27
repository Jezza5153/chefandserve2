# Workflow: Backup + restore drill

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 3.3** (workers). Ships with PR-CHEF-13.

## Purpose

Disaster recovery. The system must be able to:
1. **Back up** the production Neon database on a schedule (encrypted).
2. **Restore** from any backup to a test Neon branch (so we know the backups actually work).
3. **Audit** every backup + every drill, so we can answer "when was the last successful drill?".

V1 architecture:
- `scripts/backup-neon.sh` — runs locally on Maarten's machine via launchd (Monday 03:00).
- `scripts/restore-drill.sh` — first Monday of the month, restores latest backup to a Neon dev branch.
- Encryption via `age` (modern, audited tool). Public key in `~/.ssh/`, private key in 1Password + sealed paper backup.
- Storage: local disk + (future) offsite copy via rsync to private cloud.

This workflow is mostly OPERATIONAL, not user-facing. The AI's role is to surface status, draft drill summaries, and warn about gaps — never to perform restores autonomously.

---

## Actors

- **Maarten (`super_admin`)** — owns the encryption keys, runs drills.
- **launchd** — scheduler on macOS.
- **System (`backup-neon.sh`)** — performs pg_dump + age encrypt + log.
- **System (`restore-drill.sh`)** — restores to dev branch + sanity-queries + logs result.

---

## Source tables

- `backup_runs` — every backup attempt. Columns: `id`, `startedAt`, `endedAt`, `status` (`success` · `failed`), `filePath`, `fileSizeBytes`, `fileChecksum`, `errorMessage`.
- `restore_drills` — every drill. Columns: `id`, `backupRunId` (FK), `neonBranchName`, `startedAt`, `endedAt`, `status` (`ok` · `failed`), `sanityChecksPassed`, `notes`.
- `audit_log`.

---

## File layout

```
~/backups/chefandserve2/
  2026-05-26-03-00-00.sql.age   # encrypted dump
  2026-05-19-03-00-00.sql.age
  ...
~/backups/chefandserve2/drills/
  drill-2026-05-05.log          # drill summary
  drill-2026-04-07.log
```

Encryption: `age -r <public key> < dump.sql > dump.sql.age`. Decryption requires the private key (1Password).

Retention: 90 days local. Older files pruned by the script (preserving the most-recent successful drill's source).

---

## Human status labels

`backup_runs.status`:

| Backend | Dutch label |
|---|---|
| `success` | "Geslaagd" |
| `failed` | "Mislukt" |
| `in_progress` | "Bezig" |

`restore_drills.status`:

| Backend | Dutch label |
|---|---|
| `ok` | "Hersteld + tests geslaagd" |
| `failed` | "Hersteld maar tests mislukt" of "Hersteltest mislukt" |

---

## Allowed transitions

### Backup

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `in_progress` | launchd cron | scheduled time | `scripts/backup-neon.sh` |
| `in_progress` | `success` | system | pg_dump succeeded; age encryption succeeded; file written; checksum computed | (end of script) |
| `in_progress` | `failed` | system | any step failed | (error path) |

### Restore drill

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | (run) | launchd cron (monthly) OR manual | most recent `success` backup_runs row exists; encryption key available | `scripts/restore-drill.sh` |
| (run) | `ok` | system | Neon branch created; backup restored; sanity queries passed | (end of script) |
| (run) | `failed` | system | restore failed OR sanity queries failed | (error path) |

Sanity queries (executed against restored branch):
- `SELECT COUNT(*) FROM users` — must be > 0.
- `SELECT COUNT(*) FROM chefs WHERE deleted_at IS NULL` — non-zero.
- `SELECT MAX(created_at) FROM audit_log` — within 7 days of dump time.
- `SELECT 1 FROM information_schema.tables WHERE table_name='shift_hours'` — schema present.

---

## AI can read

Through `integrations.health` + `backup.status`:

- Most recent backup `success` timestamp.
- Backups in last 30 days (count + status breakdown).
- Most recent drill `ok` timestamp.
- Drift: days since last drill.
- File sizes (anomaly if dramatic change).

The AI may answer: "Laatste succesvolle backup: 26 mei 03:01. Laatste geslaagde drill: 5 mei (21 dagen geleden — binnen target)."

---

## AI can draft

- **Daily morning briefing**: "Backup gisteren 03:00 geslaagd, 312 MB, sha256 match."
- **Weekly report**: 7 backups, all successful, average size 310 MB.
- **Drift warning**: "Laatste drill 32 dagen geleden — target is monthly. Wil je een drill plannen?"
- **Incident summary**: when a backup fails, AI drafts a summary with the error message + suggested next steps.
- **Drill log markdown**: AI may format the run output into a human-readable summary.

---

## AI can execute only after explicit human confirmation

- **Trigger a manual backup** (`backup.run_now`) — Maarten clicks "Run backup nu". Audit: `ai.backup.run_now`.
- **Trigger a manual drill** (`backup.run_drill_now`) — Maarten clicks. Audit: `ai.backup.run_drill_now`.
- **Mark a drill as known-good** (after manual inspection): admin marks via UI. Audit: `ai.backup.drill_marked_ok`.

---

## AI must never do

- **Decrypt a backup file.** The private key lives in 1Password, never accessible to AI.
- **Restore to PRODUCTION.** Restores ALWAYS go to a Neon dev branch first, with explicit manual promotion step (manual `psql` or Neon dashboard). The AI cannot promote.
- **Delete a backup file** without explicit Maarten command + reason. Retention is script-driven, not AI-driven.
- **Skip the drill on a "we trust the backup" basis.** Monthly drill is mandatory.
- **Email the encryption key.** Public key is OK to share; private NEVER.
- **Suggest disabling backups** (e.g. to save disk space). Out of scope for AI.
- **Fabricate a drill result** when one didn't run. If `restore_drills` has no recent row, AI says so.

---

## Audit keys

System:

- `backup_runs.created` (start of run)
- `backup_runs.succeeded` / `backup_runs.failed`
- `restore_drills.created`
- `restore_drills.succeeded` / `restore_drills.failed`

AI-assisted:

- `ai.backup.run_now`
- `ai.backup.run_drill_now`
- `ai.backup.drill_marked_ok`

---

## Notifications

| Event | In-app type | Email template (planned) |
|---|---|---|
| Backup succeeds (daily) | (none — too noisy) | (none) |
| Backup fails | (in-app to super_admin) | (planned) urgent `BackupFailedAdminEmail` |
| Drill ok | (in-app to super_admin) | (none — visible in /admin/system) |
| Drill failed | (in-app + email to super_admin) | (planned) urgent `RestoreDrillFailedEmail` |
| Drift > 35 days no drill | (in-app weekly) | (planned) |

Outbox: none. Backup is internal-only.

---

## Edge cases

- **Backup file already exists for today** (manual + cron overlap): script is idempotent — appends timestamp at minute granularity.
- **Neon connection drops mid-dump**: pg_dump returns non-zero; row goes to `failed`. AI surfaces.
- **Disk full**: backup fails; AI alerts.
- **age key rotation** (future): re-encrypt previous backups with new key, OR keep old key for old files + new key going forward. Documented in `scripts/backup-README.md`.
- **Drill fails because schema migrated mid-run**: rare; admin re-runs after migration settles.
- **Restore-to-production scenario** (real disaster): NOT through AI. Manual process documented in `scripts/backup-README.md`. The AI may provide the doc but cannot run the restore.
- **Backup is corrupted** (sha256 mismatch on next access): mark `backup_runs.status='corrupted'` (extend enum); admin investigates. AI surfaces.

---

## Example user commands

### super_admin (Maarten)

- "Wanneer was de laatste backup?" → AI: "26 mei 03:01 — geslaagd — 312 MB — sha256 abc123."
- "Wanneer was de laatste drill?" → AI: "5 mei 04:00 — ok — alle sanity-queries geslaagd."
- "Hoe vaak draait de backup?" → AI: "Elke maandag 03:00 lokale tijd via launchd."
- "Run nu een backup" → AI: "Wil je dat ik `scripts/backup-neon.sh` start? Het script schrijft naar ~/backups/chefandserve2/. [Run]"
- "Restore naar productie" → AI: "Restore-naar-productie is een handmatige procedure (zie `scripts/backup-README.md`). Ik kan je door de stappen leiden, maar de Neon-promotie doe je zelf. Wil je de checklist zien?"

### Other roles

- Backup status is `restricted` to super_admin. Non-admin queries return "deze informatie is alleen voor super_admin".

---

## Expected AI answer style

- **Cite the row id**: "Bron: `backup_runs #abc`, `restore_drills #xyz`."
- **Include checksums** when relevant.
- **State retention policy** when discussing older backups: "Backups ouder dan 90 dagen worden lokaal verwijderd; voorlaatste drill-bron wordt langer bewaard."
- **For drift, give exact day count** + target.
- **For failures, suggest specific next step** (check disk, check Neon status, re-run script).
- **Never claim "backup is safe" without checksum verification.** Always cite the data.

---

## What this workflow protects against

1. **Data loss** — daily backups + monthly drills.
2. **Untested backups** — drills verify restorability.
3. **Key loss** — sealed paper backup in addition to 1Password.
4. **AI overreach** — restore-to-production is explicitly NOT an AI action.
5. **Silent failures** — every step audit-logged + drift-alerted.

If you ever ask the AI to "restore production" and it agrees, that's a P0. The AI's answer must be a checklist + a referral to `scripts/backup-README.md`, never an execution.

---

## Pre-flight checklist (for PR-CHEF-13)

- [ ] `backup-neon.sh` runs locally, produces .age file + `backup_runs` row.
- [ ] `restore-drill.sh` creates Neon branch, restores, runs sanity queries, writes `restore_drills` row.
- [ ] launchd plists installed via `backup-install.sh`.
- [ ] `backup-README.md` documents key location + restore-to-production procedure.
- [ ] `age` key generated, public in repo (`~/.ssh/`), private in 1Password.
- [ ] Sealed paper backup of private key with Maarten.
- [ ] Smoke test: take a backup, restore to dev branch, verify count(*) on `chefs`.
- [ ] Set up `BackupFailedAdminEmail` template.
- [ ] AI tool stub for `backup.status` + `backup.run_now` (read + assisted-execute).
