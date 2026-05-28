# Chef & Serve 2.0 — Claude codebase guide

> Operations platform for a Dutch premium-chef staffing agency. AVG/GDPR-aware.
> Three portals: internal staff (super_admin/owner), chefs, klanten (hotels).
> This file auto-loads every session — keep it tight. Deeper detail lives in
> the docs below.

## Read these first (orientation order)

1. **MEMORY.md** — current state: PR ledger, DB tables, migrations, env, workers, open questions. The context-switch document.
2. **WORKFLOW.md** — process map: every workflow (Part 1), route, server action, email, outbox event, audit key, with file + migration + AI-playbook links. Part 7 is the cross-reference index.
3. **AI_INTEGRATION.md** — strategic 4-layer AI architecture (not yet built; docs co-evolve).
4. **docs/ai/** — AI playbooks + tool contracts + safety rules. Read before ANY AI work.
5. **~/.claude/plans/goofy-moseying-truffle.md** — the active hotel-side plan (all PR-KLANT-* shipped).

## Stack

Next.js 15 App Router · Drizzle ORM + Neon Postgres (neon-http driver) ·
Auth.js v5 (JWT, TOTP enforced) · Resend (email) · Cloudflare R2 (files) ·
Turnstile · Vercel (web) + Railway (workers via supervisor.ts) · Dutch UI.

## Hard rules (NEVER violate — load-bearing)

- **Auth IS the lookup**: never trust an id from form data; resolve the entity via `session.user.id` (clients.userId / chefs.userId).
- **Atomic transitions**: `UPDATE … WHERE id=? AND status='<expected>'`; reject if 0 rows. (neon-http has NO interactive transactions — use atomic single statements or sequential + self-healing rollups.)
- **No external API call inside a business mutation** → `enqueueIntegrationEvent()`; a worker delivers it.
- **No raw backend statuses in UI** → `humanStatus()` (hours) / `getClientShiftLabel()` (klant shift) / human-label helpers. Every status ends with a "Wat gebeurt er nu?" next-step line.
- **Multi-actor comments** → `placement_comments` with a `visibility` enum (internal/client_visible/chef_visible), NEVER `placements.notes`. Reads go through `listVisibleComments()` (ownership-checked).
- **All klant transactional email** → `recipientsForClient(clientId, eventKey)`, never a hard-coded `client.email`. (Exception: billing-email-changed mail goes to the OLD address on purpose.)
- **Every email send** → `sendEmail()` + `recordEmailMessage()` together. **Every user-visible event** → `createNotification()`.
- **Change/cancel on a converted shift is a REQUEST**, never an instant mutation (chefs are committed). One open request per shift per kind.
- **Ratings internal-only V1**: admin sees all; chef sees own average only at ratingCount≥5; other klanten never.
- **Partial unique index** → `ON CONFLICT (...) WHERE <predicate> DO NOTHING` (else Postgres 42P10).
- **AVG**: plain Dutch, consent before mutation (flag-gated), AI never reads `placements.notes` for klant-facing answers.

## Map of the codebase

- `src/lib/db/schema.ts` — all tables (census in MEMORY.md)
- `src/lib/integrations/` — outbox, notifications, email tracking, external refs, health
- `src/lib/domain/` — business logic: hours · matching · comments · ratings · client-recipients · shift-change-requests · portal-invites · chef-documents
- `src/lib/` — utils: client-shift-labels · hours-labels · rating-tags · shift-template-format · permissions · email · recovery-intents
- `src/app/(admin|chef|client|auth)/` — four route groups. `/admin/business/*` ops (owner), `/admin/system/*` super_admin.
- `src/emails/` — React Email templates (wrap `_layout.tsx`)
- `workers/` — Railway crons via `supervisor.ts` JOBS (node-cron, Europe/Amsterdam)
- `drizzle/` — migrations 0000..0024 (`npm run db:migrate`)
- `scripts/` — `smoke-*.mjs` (per-PR DB smokes), `smoke-prod.sh`, backups, emergency 2FA reset

## How to work here

- **Migrations**: edit `schema.ts` → `npm run db:generate -- --name X` → inspect SQL → `npm run db:migrate`
- **Verify**: `npm run type-check && npm run lint && npm run build` (+ `cd workers && npx tsc --noEmit` for worker changes)
- **Smoke**: `bash scripts/smoke-prod.sh` (17 prod routes) · `node scripts/smoke-<feature>.mjs` (per-PR DB)
- **Ship**: commit to `main` → Vercel auto-deploys. Update MEMORY.md + WORKFLOW.md after EVERY PR (the doc-continuity contract).
- **`* 2` dirs**: the project lives under iCloud-synced `Documents/`, which spawns empty `"* 2"` duplicate dirs that break local `tsc`. They are gitignored; `rm -rf` them if type-check complains about phantom `.next/types`.

## The product spine

Chef logs hours → klant signs → Chef & Serve approves → payroll exports.
The klant's single source of truth is **`/client/shifts/[shiftId]`** (the hub):
status + "wat gebeurt er nu?" · proposed-chef preview + comment · uren · feedback ·
change/cancel request · berichten. Every shift-related dashboard card links here first.

## Known open items (see MEMORY.md "open questions")

- `complete-placements` + `document-expiry` workers exist but aren't yet in `supervisor.ts` JOBS (spawned task).
- Admin review UI for chef `profile_change_requests` (PR-CHEF-4) not built (spawned task).
- Chef photo not shown to klanten on the hub — needs chef-photo API authz (spawned task).
