# Backup & erasure policy — chefandserve2.0

> How backups interact with the right to erasure (AVG art. 17). Shipped PR-AVG-3.
> Pairs with `scripts/replay-erasure-tombstones.mjs`, the `privacy_erasure_tombstones`
> table, and the retention worker (`workers/retention.ts`).

## The problem

A backup taken **before** an erasure still contains the erased person's PII. If
that backup is later restored, the PII **resurrects** — re-creating data we were
legally obliged to delete. AVG accepts that you cannot scrub historical backups
in place, *provided* backups are:

1. **isolated** (not used for normal processing / access / export), and
2. **re-erased on restore**, before the restored data serves production.

## Backup properties

- **Encrypted at rest** — backups are written as encrypted `.age` files (see
  `scripts/backup-neon.sh`, PR-CHEF-13) on the Mac Mini; checksums recorded in
  `backup_runs`.
- **Retention** — keep the rolling backup set only as long as operationally
  needed for disaster recovery (a small number of weeks); older encrypted
  archives are destroyed on schedule.
- **Not a data source** — backups are **never** used to answer a data-subject
  access/export request or for any normal processing. They exist solely for
  disaster recovery.

## The hard rule: replay tombstones before production use

When a backup is restored to **any** environment that could serve real data
(production, a promoted Neon branch, a staging DB exposed to staff), the restore
runbook MUST, before traffic is allowed:

```bash
# 1. Restore the encrypted backup (see restore-drill.sh)
# 2. Re-apply every erasure that happened after the backup was taken:
node scripts/replay-erasure-tombstones.mjs --dry-run   # inspect what will be re-erased
node scripts/replay-erasure-tombstones.mjs             # apply
```

`replay-erasure-tombstones.mjs` reads every row in `privacy_erasure_tombstones`
and re-anonymises the matching `users` / `chefs` / `clients` identity rows by
their original id. It is **idempotent** — if the restored DB already reflects the
erasure, it does nothing. It does **not** touch legal-held financial rows
(`shift_hours`, payroll), which were retained by design.

Because tombstones store an **HMAC of the email** (never the email itself) plus
the original ids, the replay works without reintroducing any PII of its own.

## Re-import / re-submission guard

If an erased person submits a new Jotform intake with the same email, a lookup on
`findTombstoneByEmail()` flags that this subject was previously erased so a human
reconfirms intent before the record is re-created — preventing silent
re-importing of just-erased data.

## Checklist (restore runbook)

- [ ] Restore the encrypted backup to the target DB.
- [ ] Run `replay-erasure-tombstones.mjs --dry-run`; sanity-check the counts.
- [ ] Run `replay-erasure-tombstones.mjs` (apply).
- [ ] Confirm no `users.email` lacks the `deleted-…@erased.invalid` form for any
      tombstoned id.
- [ ] Only then route production traffic to the restored DB.
