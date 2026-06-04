# Onboarding go-live runbook

Ordered steps to ship the native onboarding feature (PR #4) to prod. Nothing here
is auto-run — `main` auto-deploys to prod, so each step is deliberate. Companion
doc: `MIGRATION-0033-MERGE-NOTE.md` (the migration-collision detail for step 3).

**No new external API / paid service / token is required.** The only new secret is
`PII_ENCRYPTION_KEY` (a self-generated random string). Resend, R2, Neon, Turnstile
already exist in the stack.

---

## 0. GATE — prod health (investigated 2026-06-04: no code defect)
- [x] **Prod crash (digest `2370483898`) — investigated, no deterministic bug found.**
      Prod runs **clean `main @ d426ec0`** (migration 0032), NOT the feature branch
      (`/sollicitatie` → 404 confirms it). A 3-agent reproduction against a clone of
      the live DB showed main's chef-detail page renders crash-free for the affected
      chef, schema matches (no drift), and the email edit **saved successfully**. The
      render + loader + save + audit paths are all deterministically clean → the
      one-off 500 was almost certainly **transient** (Neon cold-start / connection
      blip during the post-save audit insert or the redirect re-render).
      **Action: reload the chef page to confirm.** If it recurs deterministically,
      reproduce the live stack on a clone via a dev server (exact prod commit is known).

## 1. Set the encryption key (BEFORE merge — env validation is required, app won't boot without it)
```bash
openssl rand -base64 32        # generate locally; do NOT reuse TOTP_ENCRYPTION_KEY
```
- [ ] Add `PII_ENCRYPTION_KEY` in **Vercel → Settings → Environment Variables** (Production + Preview).
- [ ] Add the same `PII_ENCRYPTION_KEY` in **Railway** (the workers read it too).
- [ ] ⚠️ Key derivation is a bare SHA-256 with **no key-version** — once a chef has
      onboarded, rotating this key makes their BSN/IBAN/ID **undecryptable**. Treat as permanent.

## 2. R2 CORS for browser uploads (task #58) — onboarding uploads ID/BSN/bank docs
- [ ] Allow the prod origin on the `chefandserve` bucket. Either the Cloudflare
      dashboard (R2 → bucket → Settings → CORS) or:
```bash
# wrangler (needs Cloudflare auth):
wrangler r2 bucket cors put chefandserve --rules '[{
  "AllowedOrigins": ["https://chefandserve2.vercel.app","http://localhost:3000"],
  "AllowedMethods": ["GET","PUT","HEAD"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3600
}]'
```
- [ ] Verify a presigned PUT from the browser succeeds (no CORS error in console).

## 3. Resolve the 0033 migration collision → renumber to 0034
- [ ] Decide merge order vs `chef-portal-polish` (PR #1). Plan says chef/roster first.
- [ ] Follow `MIGRATION-0033-MERGE-NOTE.md` exactly: rebase the second-merged branch
      on the post-first-merge `main`, delete its 0033 artifacts, `drizzle-kit generate`
      → `0034_*`, verify the full chain on an isolated Neon branch.

## 4. Apply the migration to the prod DB (BEFORE the code goes live)
- [ ] Point `DATABASE_URL` at the prod `chef and serve` DB and run:
```bash
npm run db:migrate          # creates forms/EAV/reminders tables + chef columns + enums
```
  If the code deploys before this runs, every onboarding/chef page 500s on missing columns.

## 5. Seed roles + forms
```bash
npm run db:seed             # idempotent — adds the planner role + permissions
npm run db:seed:forms       # publishes the chef-apply + chef-onboarding forms
```

## 6. Merge → deploy
- [ ] Merge PR #4 (now 0034). Vercel builds + deploys.
- [ ] Smoke prod: `/sollicitatie` renders; `/admin/business/forms` lists both forms;
      a test chef can open `/chef/onboarding`.

## 7. Post-deploy switches
- [ ] Assign the **planner** role to whoever does intake (`/admin/system/users/[id]`).
- [ ] Create Maarten's birthday reminder rule, run the worker once
      (`npx tsx workers/supervisor.ts --run-now=reminders` against prod) to confirm it
      fires + is idempotent, then set `REMINDERS_ENABLED=true` in Railway.
- [ ] Disable the chef Jotform apply CTA (replaced by `/sollicitatie`).

## Rollback
- App: redeploy the previous Vercel deployment (instant).
- DB: migration 0033/0034 is **additive only** (new tables/columns/enum values) — a
  rolled-back app simply ignores them; no destructive down-migration needed.
