# Chef & Serve — MEMORY.md

> Single source of truth for "what's in this codebase right now". Updated after every PR ships.
> If you're an AI agent or a new dev opening this repo for the first time, **read this first**.

**Last updated:** PR-AI-0 + PR-CHEF-0 + ... (see "PR ledger" below)
**Live URL:** https://chefandserve2.vercel.app
**Repo:** github.com/Jezza5153/chefandserve2

---

## Map: where to find what

| Topic | File |
|---|---|
| Plan (current operating plan) | `~/.claude/plans/goofy-moseying-truffle.md` |
| Strategic AI architecture | `AI_INTEGRATION.md` (4-layer model · data inventory · phased rollout) |
| Phase-by-phase tactical brief | `BUILD_PLAN.md` |
| 12-week roadmap | `ROADMAP.md` |
| State ledger (THIS FILE) | `MEMORY.md` |
| Process map / API linkage | `WORKFLOW.md` |
| AI playbooks + contracts | `docs/ai/` (see PR-AI-0) |
| DB schema (Drizzle) | `src/lib/db/schema.ts` |
| DB migrations | `drizzle/*.sql` |
| Smoke tests | `scripts/smoke-*.{sh,mjs}` |
| Backup scripts | `scripts/backup-*.sh` + `scripts/launchd/*.plist` |

---

## Stack

- **Frontend/Backend**: Next.js 15 App Router · React 19 · TypeScript
- **DB**: Neon Postgres (serverless) · Drizzle ORM · pgvector ready
- **Auth**: Auth.js v5 (JWT strategy) · Resend magic-link + Credentials (password+TOTP)
- **2FA**: OTPAuth · AES-256-GCM secret encryption · bcrypt recovery codes
- **Storage**: Cloudflare R2 (`chefandserve` bucket — scoped token)
- **Email**: Resend
- **Anti-bot**: Cloudflare Turnstile
- **Hosting**: Vercel (web) · Railway (workers)
- **Locale**: Dutch (UI) · `nl-NL` date formatting

---

## Currently-shipped flow at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│ Marketing (chefandserve2.vercel.app)                              │
│  • Homepage, 17 service pages, about, work-with-us, contact       │
│  • /aanmelden → chef or klant Jotform                             │
│  • Header: [Inloggen] [Aanmelden]                                 │
├──────────────────────────────────────────────────────────────────┤
│ Jotform intake                                                    │
│  • Chef form  → chef_submissions  (idempotent on external_id)     │
│  • Klant form → client_submissions                                │
│  • Webhook: /api/intake/{chef,client}                             │
├──────────────────────────────────────────────────────────────────┤
│ Admin (super_admin + owner)                                       │
│  • /admin/business — KPIs + actions                               │
│  • /admin/business/inbox — Jotform submissions triage             │
│  • /admin/business/chefs · clients · shifts · roster              │
│  • /admin/system/{users,roles,errors,audit,webhooks,emails,…}     │
│  • Convert submission → chef/client master record                 │
│  • Invite chef/client to portal (status invited → active + email) │
│  • Invite internal staff (PR-A)                                   │
│  • Reset another internal's 2FA (PR-C0)                           │
├──────────────────────────────────────────────────────────────────┤
│ Chef portal (mobile-first)                                        │
│  • /chef dashboard · /chef/profile · /chef/availability           │
│  • /chef/shifts · /chef/shifts/[id] — accept/reject               │
│  • /chef/hours — STUB (PR-CHEF-1 will replace)                    │
├──────────────────────────────────────────────────────────────────┤
│ Klant portal                                                      │
│  • /client dashboard · /client/profile · /client/shifts           │
│  • /client/request — submit shift request in-portal               │
├──────────────────────────────────────────────────────────────────┤
│ Auth                                                              │
│  • /login (magic-link primary, password+TOTP behind toggle)       │
│  • /login/forgot-password · /login/lost-2fa                       │
│  • /recover/password · /recover/2fa (purpose-bound tokens)        │
│  • /admin/account/setup/* (force-enrollment wizard)               │
│  • TOTP_ENFORCE=true (12h re-prompt per device)                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## PR ledger

### Shipped (in production)

| PR | Description | Status |
|---|---|---|
| PR-Z | Wizard 2FA crash fix (Next.js 15 cookies rule) | ✅ live |
| PR-A | Internal staff invite UI + simplified /login | ✅ live |
| PR-C0 | Admin Reset 2FA + cookie revocation chain (v2 cookie format) | ✅ live |
| PR-B | TOTP_ENFORCE=true + TOTP_REVERIFY_HOURS=12 | ✅ live |
| PR-C | Recovery flows (forgot password + lost 2FA, Fence 5 purpose-bound tokens) | ✅ live (migration 0010 applied) |
| PR-D | UX polish (users-list 2FA/last-login columns, calendar today ring, client request success card) | ✅ live |

### In-progress / next

| PR | Description | Status |
|---|---|---|
| PR-CHEF-0 | Integration spine (outbox/runs/external_refs/email tracking/notifications/contact_logs) | ✅ live (migration 0011 applied · 18/18 smoke pass · /admin/business/integrations live) |
| PR-AI-0 | AI/RAG docs spine (docs/ai/) | 🟡 in progress (background agent) |
| PR-CHEF-1 | Hours chain (chef → klant → admin → exported) + trust timeline | ✅ live (migration 0012 applied · 9 emails · trust timeline · chef form · klant receipt · admin queue+detail) |
| PR-CHEF-2 | Three role dashboards ("wat moet ik nu doen?") | ⏳ |
| PR-CHEF-3 | Admin bulk approval + dispute UX + manual-add hours | ⏳ |
| PR-CHEF-4 | Profile editing (direct + request-change split) | ⏳ |
| PR-CHEF-5 | Confirm-notify chef + cancel-severity + contact cards + contact_logs | ⏳ |
| PR-CHEF-6 | Notification prefs scaffolding | ⏳ |
| PR-CHEF-7 | Payroll batches + corrections + CSV export | ⏳ |
| PR-CHEF-8 | Email delivery tracking (Resend webhooks) | ⏳ |
| PR-CHEF-9 | In-app notification inbox UI | ⏳ |
| PR-CHEF-10 | AVG consent + privacy requests + retention policies | ⏳ |
| PR-CHEF-11 | Calendar ICS feeds (chef + klant) | ⏳ |
| PR-CHEF-12 | Document verification + expiry + visibility | ⏳ |
| PR-CHEF-13 | Backup + restore drill + encryption | ⏳ |
| PR-CHEF-14 | Polish: countdown, empty/late states, doc visibility labels | ⏳ |
| PR-CHEF-15 | Web Push (DEFERRED) | 💤 deferred |
| PR-CHEF-FUT | Reserved API/webhook schemas (no UI) | 💤 reserved |

---

## DB schema state (Drizzle — `src/lib/db/schema.ts`)

### Enums

`user_kind` (internal, chef, client) · `user_status` (invited, active, disabled) · `error_severity` · `submission_status` · `vakniveau` · `segment` · `chef_status` · `client_status` · `shift_status` · `chef_document_type` · `placement_status` · `recovery_intent` (password, totp)

### Tables (live in prod)

**Auth + RBAC**: `users` · `auth_accounts` · `auth_sessions` · `auth_verification_tokens` · `roles` · `permissions` · `role_permissions` · `user_roles` · `user_recovery_codes` · `recovery_intents` (PR-C)

**Observability**: `audit_log` · `error_log` · `webhooks_received`

**Rate limiting**: `rate_limits` (PR-S1A)

**Notifications routing**: `notification_routes` (PR-F1) — admin events configurable

**Jotform intake**: `chef_submissions` · `client_submissions`

**Master records**: `chefs` · `clients` · `chef_availability` · `chef_documents`

**Shifts/placements**: `shifts` · `placements`

### Tables (planned per active plan)

**PR-CHEF-0**: `integration_connections` · `integration_outbox` · `integration_runs` · `external_refs` · `email_messages` · `email_events` · `notifications` · `contact_logs`

**PR-CHEF-1**: `shift_hours` + `shift_hours_status` enum

**PR-CHEF-4**: `profile_change_requests`

**PR-CHEF-6**: `notification_prefs`

**PR-CHEF-7**: `payroll_batches` · `payroll_batch_lines` · `shift_hour_corrections`

**PR-CHEF-10**: `consent_log` · `privacy_requests` · `data_processing_agreements` · `retention_policies`

**PR-CHEF-12**: extends `chef_documents` (clientVisible, verifiedAt/By, expiresAt, status)

**PR-CHEF-13**: `backup_runs` · `restore_drills`

**PR-CHEF-FUT (reserved)**: `api_clients` · `webhook_endpoints` · `webhook_deliveries`

### Migration history

| File | What | Status |
|---|---|---|
| 0000_light_captain_flint.sql | Initial users/auth/RBAC | applied |
| 0001..0008 | Submissions, chefs, clients, shifts, etc. | applied |
| 0009_noisy_sprite.sql | notification_routes (PR-F1) | applied |
| 0010_recovery_intents.sql | recovery_intents (PR-C) | applied (May 27) |
| 0011_integration_spine.sql | integration_connections + integration_outbox + integration_runs + external_refs + email_messages + email_events + notifications + contact_logs (PR-CHEF-0) | applied (May 27) |
| 0012_shift_hours.sql | shift_hours + shift_hours_status enum (PR-CHEF-1) | applied (May 27) |
| 0013..pending | profile_change_requests + payroll batches + AVG + … | not yet generated |

---

## Production env vars (Vercel)

**Required**: `DATABASE_URL` · `DATABASE_URL_UNPOOLED` · `AUTH_SECRET` · `RESEND_API_KEY` · `RESEND_FROM_EMAIL` · `NEXT_PUBLIC_APP_URL` · `RATE_LIMIT_HASH_SECRET` · `TOTP_ENCRYPTION_KEY` · `TOTP_ENFORCE=true` · `TOTP_REVERIFY_HOURS=12`

**Optional** (Turnstile): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` · `TURNSTILE_SECRET_KEY`

**R2** (Cloudflare): `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET=chefandserve` · `R2_PUBLIC_URL`

**Email routing**: `MAARTEN_EMAIL` · `JEZZA_EMAIL` (fallbacks; `notification_routes` rows override)

**Coming with this plan**:
- `RESEND_WEBHOOK_SECRET` (PR-CHEF-8 — Resend webhook signature verification)
- `AVG_CONSENT_ENFORCED` default `false` (PR-CHEF-10 — flip after lawyer review)

---

## Critical security invariants

1. **TOTP_ENFORCE=true is live.** Every internal user with `totp_enabled` gets a 12h device cookie. v2 cookie format includes `enrolledAtMs` so admin reset invalidates ALL device cookies on next request.
2. **Password reset bumps `permissions_version`** → invalidates JWT on other devices.
3. **2FA reset bumps `permissions_version`** + wipes secret + wipes recovery codes + sets `totp_enrolled_at=null` (which kills cookie v2 validation).
4. **Recovery intents are purpose-bound** (Fence 5). A forgot-password token cannot be used for lost-2fa, and vice versa. Single-use atomic via `UPDATE … WHERE consumed_at IS NULL`.
5. **Auth IS the lookup.** No chef/client id ever comes from form data. Server actions resolve entity by `session.user.id → entity.userId`.
6. **State transitions are atomic.** `UPDATE … WHERE id = ? AND status = '<expected>'`. If 0 rows update, request is stale.

---

## Critical operational invariants (active plan)

1. **No external API call inside a business transaction.** Approve hours → DB update + outbox enqueue. Worker delivers external.
2. **Idempotency keys on every outbox row.** Same `(eventType, entityId, action)` → same key. Re-enqueue is a no-op.
3. **Append-only after export.** Once `shift_hours.status='exported'`, only `shift_hour_corrections` mutations allowed.
4. **External system IDs in `external_refs`, never on entity tables.**
5. **Every email send creates an `email_messages` row.** Status updated by Resend webhook.
6. **No raw backend statuses in UI.** Pipe through `humanStatus()` from `src/lib/hours-labels.ts`.

---

## Workers (Railway crons)

| Worker | File | Schedule | Status |
|---|---|---|---|
| Embedding refresh | `workers/embedding-refresh.ts` | nightly | live, currently no-op (pgvector ready, embeddings not started) |
| Error digest | `workers/error-digest.ts` | daily | live |
| Weekly digest | `workers/weekly-digest.ts` | Monday 08:00 | live |
| Payingit sync | `workers/payingit-sync.ts` | TBD | stub |
| Retention | `workers/retention.ts` | TBD | stub (AVG1) |
| Supervisor | `workers/supervisor.ts` | hourly | live |
| Complete placements | `workers/complete-placements.ts` | 30 min | PLAN: PR-CHEF-1 |
| Hours reminders | `workers/hours-reminders.ts` | daily | PLAN: PR-CHEF-1 |
| Document expiry | `workers/document-expiry.ts` | daily | PLAN: PR-CHEF-12 |
| Payroll export | `workers/payroll-export.ts` | manual | PLAN: PR-CHEF-7 |

---

## Smoke tests (in repo)

- `scripts/smoke-prod.sh` — 17 HTTP-level checks against live URL
- `scripts/smoke-pr-c.mjs` — Neon DB schema sanity after PR-C
- `scripts/smoke-recovery-intents.mjs` — Fence 5 invariant tests (atomicity, intent-bound, expiry)
- `scripts/reset-internal-2fa.ts` — emergency 2FA reset CLI
- `scripts/smoke-integration-spine.mjs` — PR-CHEF-0 (to be added)

---

## Open questions / decisions deferred

1. **Payingit API spec** — not publicly documented. CSV export first; live API integration when Payingit gives us API docs.
2. **Accounting platform** — Exact / Moneybird / AFAS? Adapter pattern supports any.
3. **Legal text for AVG modals** — placeholders + TODO; lawyer fills in.
4. **age key location for encrypted backups** — public key in `~/.ssh/`, private key 1Password + sealed paper backup.
5. **iOS/Android Calendar subscription UX testing** — PR-CHEF-11 needs manual test on real device.
6. **Cancellation severity thresholds** — 48h/24h/same-day from `src/lib/cancellation-severity.ts`; tune after 1 month real use.
7. **Web Push** — deferred to PR-CHEF-15; rely on emails + in-app notifications for V1.

---

## How to update this file

Update **after every PR ships**:
1. Move PR from "In-progress" → "Shipped"
2. Add to migration history if a new migration ran
3. Add to env vars if a new one was set
4. Add to workers if a new worker shipped
5. Add to smoke tests if new
6. Update "Currently-shipped flow at a glance" if user-facing surface changed

**Never** update this for in-progress work — wait until merged + deployed + smoke-verified.
