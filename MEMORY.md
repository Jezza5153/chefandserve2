# Chef & Serve — MEMORY.md

> Single source of truth for "what's in this codebase right now". Updated after every PR ships.
> If you're an AI agent or a new dev opening this repo for the first time, **read this first**.

## ▶ Resuming in a fresh chat / new dev?

Read in this order: **CLAUDE.md → MEMORY.md (this file) → WORKFLOW.md**, then
`docs/ai/` before any AI work. The active plan is at
`~/.claude/plans/goofy-moseying-truffle.md`. Everything shipped is in the **PR
ledger** below; anything planned-but-not-built is flagged ⏳ or noted under
"Open questions". You can pick up mid-phase from here with zero prior context —
each PR shipped with a migration, a `scripts/smoke-*.mjs`, and WORKFLOW.md
linkage. The hotel (klant) phase is **fully shipped** (PR-KLANT-0…5 + DOCS).

**Last updated:** Klant phase complete — PR-KLANT-0…5 + PR-KLANT-DOCS (see "PR ledger")
**Live URL:** https://chefandserve2.vercel.app
**Repo:** github.com/Jezza5153/chefandserve2

---

## Map: where to find what

| Topic | File |
|---|---|
| Codebase guide (auto-loaded keystone) | `CLAUDE.md` — stack · hard rules · map · how-to-work |
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
│  • /chef — "wat moet ik nu doen?" dashboard (Today/Action/Money)  │
│  • /chef/hours — list + /chef/hours/[id] simple-form              │
│  • /chef/shifts/[id] — accept/reject + cancel (severity-aware)    │
│    with contact card (tel:/WhatsApp/Maps)                          │
│  • /chef/availability calendar · /chef/profile editable           │
│  • /chef/notifications · /chef/calendar (ICS subscribe)           │
├──────────────────────────────────────────────────────────────────┤
│ Klant portal                                                      │
│  • /client — "actie nodig" dashboard                              │
│  • /client/shifts/[id]/hours — receipt-style sign/reject          │
│  • /client/request · /client/notifications · /client/calendar     │
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
| PR-AI-0 | AI/RAG docs spine (docs/ai/) | ✅ live (28 docs, 7,230 lines — 11 base files + 10 workflow playbooks + 6 tool-contract files + README) |
| PR-CHEF-1 | Hours chain (chef → klant → admin → exported) + trust timeline | ✅ live (migration 0012 applied · 9 emails · trust timeline · chef form · klant receipt · admin queue+detail) |
| PR-CHEF-2 | Three role dashboards ("wat moet ik nu doen?") | ✅ live (chef + klant + admin all "actie nodig" first + integration health card + ActionCard shared) |
| PR-CHEF-3 | Admin bulk approval + dispute UX + manual-add hours | ✅ live (magic eligibility + bulk-select bar + per-row approve + anomaly flagging in queue) |
| PR-CHEF-4 | Profile editing (direct + request-change split) | ✅ live (migration 0013 · ProfileForm direct edit · RequestChangeFormSection for sensitive fields · profile_change_requests table) |
| PR-CHEF-5 | Confirm-notify chef + cancel-severity + contact cards | ✅ live (ShiftConfirmedChefEmail · ShiftCancelledByChefClientEmail · cancellation-severity util · cancel flow with tel: CTA · contact card · rejection reason on accept/reject) |
| PR-CHEF-6 | Notification prefs scaffolding | ✅ live (migration 0014 · notification_prefs table · shouldSendToUser/setPref helpers · V1 always-on) |
| PR-CHEF-7 | Payroll batches + corrections + CSV export | ⏳ |
| PR-CHEF-8 | Email delivery tracking (Resend webhooks) | ✅ live (POST /api/webhooks/resend with svix-signature HMAC verify · recordEmailEventFromWebhook updates email_messages.status) |
| PR-CHEF-9 | In-app notification inbox UI | ✅ live (bell with unread badge in all 3 layouts · /chef/notifications · /client/notifications · /admin/notifications · markRead + markAllRead) |
| PR-CHEF-10 | AVG consent + privacy requests + retention policies | ✅ live (migration 0018 · consent_log + privacy_requests + DPA + retention_policies · ConsentGate modal flag-gated · /privacy-chef + /privacy-klant placeholders) |
| PR-CHEF-11 | Calendar ICS feeds (chef + klant) | ✅ live (migration 0015 calendar_token · src/lib/calendar/ics.ts · /chef/calendar.ics + /client/calendar.ics public-by-token · /chef/calendar + /client/calendar UI with copy URL + rotate secret) |
| PR-CHEF-12 | Document verification + expiry + visibility | ✅ live (migration 0016 · clientVisible+verifiedAt/By+expiresAt+status on chef_documents · /api/chef-document/[id] 3-way access · workers/document-expiry.ts · profile doc list with visibility chips) |
| PR-CHEF-13 | Backup + restore drill + encryption | ✅ live (migration 0017 · backup-neon.sh + restore-drill.sh + backup-install.sh + launchd plist + age-encryption support + 12-week retention · backup_runs + restore_drills tables) |
| PR-CHEF-7 | Payroll batches + corrections + CSV export | ✅ live (migration 0019 · payroll_batches + lines + shift_hour_corrections · /admin/business/payroll + CSV export route) |
| PR-CHEF-14 | Polish: countdown, empty/late states, doc visibility labels | ✅ folded into PR-CHEF-2 (countdown/earnings) + PR-CHEF-12 (doc labels) + PR-CHEF-5 (rejection reason) |
| PR-CHEF-15 | Web Push (DEFERRED) | 💤 deferred |
| PR-CHEF-FUT | Reserved API/webhook schemas (no UI) | 💤 reserved |

### Klant (hotel) phase — ✅ shipped

| PR | Description | Status |
|---|---|---|
| PR-KLANT-0 | Foundations: shift hub + placement_comments + client_contacts + recipients + AI docs | ✅ live (migration 0020 · /client/shifts/[shiftId] hub · comments.ts visibility-scoped · client-recipients.ts · client-shift-labels.ts · 8 playbooks + 4 tool contracts) |
| PR-KLANT-1 | Profile editing (sectioned, paymentTerms→request) | ✅ live (migration 0021 · /client/profile sectioned: Contactpersoon · Shiftlocatie · Facturatie · request-change · client_change_requests table · admin Wijzigingsverzoeken tab · BillingEmailChangedKlantEmail to OLD address · recipientsForClient outcome email) |
| PR-KLANT-2 | Requests list + cancel + change/cancel for existing shifts | ✅ live (migration 0022 · /client/requests list + retract · shift hub change/cancel modals · client_shift_change_requests + one-open-per-shift-per-kind unique index · submission_status cancelled_by_client · admin inbox decision queue · ClientChangeRequestAdminEmail + ClientChangeRequestOutcomeKlantEmail) |
| PR-KLANT-3 | Chef preview + structured comments + email | ✅ live (no schema · hub proposed-chef card + "Waarom voorgesteld?" reasons via getMatchReasonsForPlacement · ChefFeedbackForm → placement_comments client_visible (NEVER notes) · admin shift-detail comment thread + visibility-scoped reply · proposePlacement adds ChefProposedKlantEmail + chef_proposed notification · klant comment → admin email) |
| PR-KLANT-4 | Recurring templates + exceptions + overnight + preview | ✅ live (migration 0023 · shift_templates + shift_template_exceptions · shifts.source_template_id/date + idempotency index · generate-recurring-shifts worker (Europe/Amsterdam, overnight ends_next_day, ON CONFLICT partial-index) · admin templates list/new/[id] + live preview-before-save + ExceptionsManager + activate toggle · /client/templates friendly view + change-request) |
| PR-KLANT-5 | Rating loop + tags + N≥5 rule + email | ✅ live (migration 0024 · ratings table + chefs.average_rating/rating_count rollup · rating-tags.ts vocab · domain/ratings.ts (submit + recompute + 3 visibility-scoped readers: admin-all / chef-N≥5 / klant-none) · /client/shifts/[shiftId]/rate stars+tags form · RatingPendingKlantEmail + bell + dashboard card on approveHoursRow · admin chef-detail feedback section · chef-profile N≥5 summary) |
| PR-KLANT-DOCS | CLAUDE.md + WORKFLOW link-complete + MEMORY resume-header | ✅ shipped |

### AVG/GDPR compliance phase — active (plan: privacy-operations workflow)

| PR | Description | Status |
|---|---|---|
| PR-AVG-pre | docs/privacy/pii-inventory.md (51 tables) + retention-matrix.md | ✅ |
| PR-AVG-1 | Privacy-request intake (portal + off-portal manual) + identity verification + correspondence log + SLA extension + withdrawal + super_admin compliance queue | ✅ live (migration 0025 · privacy_requests intake/identity/SLA/correction cols + user_id nullable + other/withdrawn enum values · privacy_request_messages · domain/privacy.ts · chef+klant /privacy capture · /admin/system/privacy-requests list+new+[id] · 3 emails · privacy_request notification event) |
| PR-AVG-2 | Preview + export package (redacted, zip→R2, ~7d on-demand links) + correction (art.16) + erasure (art.17, legal-hold-aware) + tombstones | ✅ live (migration 0026 · privacy_erasure_tombstones · domain/privacy-{subject,export,erasure}.ts + applyCorrection · getLegalHoldsForUser · jszip dep · r2.putObject + EXPORT_DOWNLOAD_TTL · admin [id] export/correct/erase panels + [id]/download route · smoke-avg-erasure.mts 30/30 incl. 5 third-party redaction fixtures) |
| PR-AVG-3 | Retention purge worker (double-gated) + retention admin + backup replay | ⏳ next |

> AVG rules (load-bearing): user requests / super_admin fulfills (no autonomous erasure) · identity verified before export/erase · soft-delete-first · Payingit 7-year hold = structured legal holds · never export third-party PII (redact) · preview before execute · erasure tombstones + backup replay · 30-day SLA (extendable, art. 12(3)) · `AVG_CONSENT_ENFORCED` stays false until lawyer fills privacy text.

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

**Klant phase (live)**: `placement_comments` (visibility-scoped, PR-KLANT-0) · `client_contacts` (routing seam, PR-KLANT-0) · `client_change_requests` (PR-KLANT-1) · `client_shift_change_requests` (PR-KLANT-2, one-open-per-shift-per-kind) · `shift_templates` + `shift_template_exceptions` (PR-KLANT-4) · `clients.shiftAddress`/`shiftArrivalNotes`/`billingAddress` (PR-KLANT-0) · `client_submissions.cancelled_by_client*` (PR-KLANT-2) · `shifts.source_template_id`/`source_template_date` (PR-KLANT-4) · `ratings` + `chefs.averageRating`/`ratingCount` (PR-KLANT-5)

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
| 0013_profile_change_requests.sql | profile_change_requests (PR-CHEF-4) | applied |
| 0014_notification_prefs.sql | notification_prefs (PR-CHEF-6) | applied |
| 0015_calendar_token.sql | calendar ICS tokens (PR-CHEF-11) | applied |
| 0016_chef_documents_trust.sql | chef_documents trust cols (PR-CHEF-12) | applied |
| 0017_backup_runs.sql | backup_runs + restore_drills (PR-CHEF-13) | applied |
| 0018_avg_privacy.sql | consent_log + privacy_requests + retention_policies (PR-CHEF-10) | applied |
| 0019_payroll_batches.sql | payroll_batches + lines + shift_hour_corrections (PR-CHEF-7) | applied |
| 0020_klant_foundations.sql | placement_comments + client_contacts + clients address split (PR-KLANT-0) | applied (May 28) |
| 0021_client_change_requests.sql | client_change_requests + client_change_status enum (PR-KLANT-1) | applied (May 28) |
| 0022_client_change_cancel.sql | client_shift_change_requests + 2 enums + submission_status 'cancelled_by_client' + client_submissions cancel cols (PR-KLANT-2) | applied (May 28) |
| 0023_shift_templates.sql | shift_templates + shift_template_exceptions + shifts.source_template_id/date + idempotency index (PR-KLANT-4) | applied (May 28) |
| 0024_ratings.sql | ratings + chefs.average_rating/rating_count rollup (PR-KLANT-5) | applied (May 28) |
| 0025_avg_fulfillment.sql | privacy_requests intake/identity/SLA/correction cols + user_id nullable + other/withdrawn enum values + privacy_request_messages (PR-AVG-1) | applied (May 28) |
| 0026_avg_tombstones.sql | privacy_erasure_tombstones (HMAC email hash · retained_entities_summary · per-subject ids) (PR-AVG-2) | applied (May 28) |

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
| Complete placements | `workers/complete-placements.ts` | every 30 min | ✅ live (supervisor JOBS — hours trust chain, PR-CHEF-1) |
| Document expiry | `workers/document-expiry.ts` | daily 06:00 Amsterdam | ✅ live (supervisor JOBS, PR-CHEF-12) |
| Payroll export | `workers/payroll-export.ts` | manual | PLAN: PR-CHEF-7 |
| Generate recurring shifts | `workers/generate-recurring-shifts.ts` | daily 04:00 Amsterdam | ✅ live (registered in supervisor JOBS, PR-KLANT-4) |
| Hours reminders | `workers/hours-reminders.ts` | daily | PLAN: PR-CHEF-1 — file not yet created |

> All scheduled workers run via `workers/supervisor.ts` JOBS (node-cron,
> Europe/Amsterdam): weekly-digest · error-digest · embedding-refresh ·
> payingit-sync · generate-recurring-shifts · complete-placements ·
> document-expiry. `hours-reminders` is referenced in the plan but the file
> doesn't exist yet; `payroll-export` is manual.

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

### Known follow-ups discovered during the klant phase (spawned as side tasks)

8. ~~**Worker scheduling gap**~~ ✅ RESOLVED — `complete-placements` (every 30 min) + `document-expiry` (daily 06:00) are now registered in `workers/supervisor.ts` JOBS. Worker tsc passes; `complete-placements` sanity-run clean (0 flipped, idempotent). `hours-reminders.ts` does not exist yet (left as PLAN).
9. ~~**Chef profile-change admin review (PR-CHEF-4 gap)**~~ ✅ RESOLVED — `/admin/business/chefs/[id]` now has a "Wijzigingsverzoeken" section with `approveProfileChange`/`rejectProfileChange` (hourlyRate writes both min/max cents), atomic flip, audit, chef outcome email. Smoke: `scripts/smoke-chef-profile-change.mjs`.
10. ~~**Chef photo for klanten**~~ ✅ RESOLVED — `/api/chef-photo/[id]` authz extended: a klant can load a clientVisible+verified photo of a chef placed on one of THEIR shifts (no enumeration; chef-self + super_admin paths intact). Hub renders `ChefAvatar` (photo + initials fallback) with the same gate in the query.

## How to update this file

Update **after every PR ships**:
1. Move PR from "In-progress" → "Shipped"
2. Add to migration history if a new migration ran
3. Add to env vars if a new one was set
4. Add to workers if a new worker shipped
5. Add to smoke tests if new
6. Update "Currently-shipped flow at a glance" if user-facing surface changed

**Never** update this for in-progress work — wait until merged + deployed + smoke-verified.
