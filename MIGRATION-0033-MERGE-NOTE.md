# ⚠️ Migration 0033 collision — read before merging `feat/chef-onboarding-forms`

**Status:** known, characterised, **not yet resolved** (resolution is a merge-time step — see below).

## The collision

Two unmerged feature branches each added a migration at **journal index 33**:

| Branch | File | Adds (DDL) |
|--------|------|-----------|
| `feat/chef-onboarding-forms` (this PR, #4) | `drizzle/0033_long_vision.sql` | `forms`, `form_sections`, `form_fields`, `chef_field_values`, `reminder_rules`, `reminder_sends`; new `chefs` onboarding columns; `chef_document_type` enum values; 6 new enums (`form_status`, `form_field_kind`, `form_field_type`, `chef_onboarding_status`, `reminder_trigger`, `reminder_channel`) |
| `chef-portal-polish` | `drizzle/0033_chef_notes_and_events.sql` | `chef_events`; new `shifts` columns; `chef_event_type` enum |

`origin/main` is at **0032** — **neither** has merged yet.

**What actually conflicts** (verified):
- The two `.sql` files have **different names**, so they do *not* collide on filename.
- They collide on **`drizzle/meta/_journal.json`** — both add an entry with `"idx": 33`.
- They collide on **`drizzle/meta/0033_snapshot.json`** — same filename, different content.
- The migrations are **DDL-independent** (no shared table/column/enum), so there is **no schema
  conflict to reconcile** — only a mechanical renumber.

## Resolution — do this at merge time, on whichever branch merges SECOND

> Do **not** renumber speculatively before the first 0033 is on `main`. The regenerated
> snapshot must be diffed against a baseline that already includes the first 0033's tables,
> otherwise the snapshot chain is wrong and a `0032 → 0034` journal gap can result.

Assume `chef-portal-polish` merges first (per the plan's sequencing note — chef/roster work
lands before onboarding). Then, for **this** branch:

```bash
# 1. Rebase this branch onto the updated main (now containing 0033_chef_notes_and_events)
git checkout feat/chef-onboarding-forms
git fetch origin
git rebase origin/main
#    Expect conflicts in ONLY these three meta files — resolve by taking main's side
#    and deleting THIS branch's 0033 artifacts (we regenerate them in step 2):
#      drizzle/meta/_journal.json        (keep main's idx-33 = chef_notes_and_events)
#      drizzle/meta/0033_snapshot.json   (keep main's)
git rm drizzle/0033_long_vision.sql            # remove our now-orphaned migration
#    (its objects still live in src/lib/db/schema.ts — that's the source of truth)

# 2. Regenerate as 0034 against the new baseline
npx drizzle-kit generate                       # produces drizzle/0034_*.sql + meta/0034_snapshot.json
#    Sanity-check the generated 0034 contains EXACTLY the onboarding objects from the table
#    above (forms/EAV/reminders/chef columns/enums) and nothing from chef_notes_and_events.

# 3. Verify the full chain on an isolated Neon branch (NEVER prod ep-icy-scene-abjt6uye)
#    Create a throwaway branch, point DATABASE_URL at it, then:
npx drizzle-kit migrate                        # must apply 0000..0034 cleanly, no errors
npm run type-check && npm run lint && npm run build

# 4. Commit + force-push the rebased branch
git add -A && git commit -m "chore(db): renumber onboarding migration 0033 -> 0034 (post chef-portal-polish merge)"
git push --force-with-lease origin feat/chef-onboarding-forms
```

If the **opposite** order is chosen (onboarding merges first), apply the identical procedure to
`chef-portal-polish` instead (rename its `chef_notes_and_events` migration to 0034).

## Deploy prerequisites (separate from the collision — also block this merge)

`main` auto-deploys to prod (`chefandserve2.vercel.app`). Before this PR merges, prod needs:

1. **`PII_ENCRYPTION_KEY`** set in Vercel (BSN/IBAN/ID encryption; the onboarding writeback
   throws without it). Generate with `openssl rand -base64 32`. Must differ from
   `TOTP_ENCRYPTION_KEY`. **Note:** key derivation is a bare SHA-256 of this env var with no
   key-version field — rotating it makes all previously-encrypted PII undecryptable. Treat as
   permanent once chefs have onboarded.
2. The **0034 migration applied** to the prod DB (`chef and serve`) before/with the deploy, or
   the new columns/tables won't exist and onboarding pages 500.
3. The unrelated **prod crash (digest 2370483898)** resolved — see the session report; it needs
   the Vercel function log to pinpoint and is environment-specific (not reproducible from
   code + data; `chefs.email` is nullable + non-unique, so the chef-edit path does not throw).

`REMINDERS_ENABLED` stays unset (worker is a no-op until a human flips it after Maarten's
birthday rule is verified).
