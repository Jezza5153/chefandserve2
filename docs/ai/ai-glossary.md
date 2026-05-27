# AI Glossary — Chef & Serve domain language

> The vocabulary the AI must know to answer accurately. When the model encounters one of these terms, this is the canonical definition. Update whenever a new domain term is added to the schema or workflows.

This doc is itself a **broad-index RAG source** (per [`rag-source-catalog.md`](./rag-source-catalog.md)) — the AI retrieves from here when a user uses one of these terms.

---

## A

### Admin

Internal staff member with `owner` or `super_admin` role. In Dutch UI, often referred to as "Maarten" specifically (since Maarten is the current sole owner) but the system is multi-admin-ready.

### admin_approved

Backend status of a `shift_hours` row meaning the admin has signed off after the klant's signature. Dutch UI label: "Goedgekeurd door admin". Next step: payroll export.

### admin_rejected

Backend status meaning the admin sent the row back. Dutch: "Afgewezen door admin". Less common than `client_rejected`.

### AVG

Algemene Verordening Gegevensbescherming — the Dutch implementation of GDPR (Europe's General Data Protection Regulation). Every data-processing activity must have a legal basis, and most have a consent record in `consent_log`.

### Append-only

After `shift_hours.status='exported'`, the row cannot be mutated. All adjustments go through `shift_hour_corrections`. The AI never proposes to "edit an exported row".

### `auth_accounts`, `auth_sessions`, `auth_verification_tokens`

Auth.js adapter tables. Used by the framework; the AI never reads these directly (they're NEVER-index in `rag-source-catalog.md`).

### `audit_log`

Append-only record of every mutation. The AI never deletes from it; admin queries it via `audit.search`. See [`ai-audit-and-logging.md`](./ai-audit-and-logging.md) for the event taxonomy.

---

## B

### Backup

A `pg_dump` of production Neon, encrypted via `age`, stored locally + (future) offsite. Runs Monday 03:00 via launchd. See [`workflow-playbooks/backup-restore.md`](./workflow-playbooks/backup-restore.md).

### Banqueting

A `segment` enum value. Large-scale catering events (weddings, corporate). Different rhythm than fine dining.

### Bookkeeper

Future role (`bookkeeper`) — restricted finance role. Can read all finance, approve hours, run payroll batches. CANNOT propose placements, modify shifts, invite users. Planned for PR-CHEF-7+.

### BSN

Burgerservicenummer — Dutch citizen service number. Personal identifier. **Never stored in our DB.** Lives in Payingit. Never returned by AI in any form. Tagged NEVER-index.

### Btw

Belasting Toegevoegde Waarde — Dutch VAT. Klanten with `btw` field set are VAT-registered. AI shows this to admin only.

---

## C

### Chef

Hospitality worker placed via the platform. Master record in `chefs`. Portal user (linked via `users.id`) when invited. Multiple sub-roles via `vakniveau`.

### Chef portal

`/chef/*` routes. Mobile-first. Chef sees own data only.

### Chef status

Lifecycle enum: `onboarding` · `active` · `paused` · `inactive` · `archived`. Only `active` chefs are proposed for new shifts.

### Code Snippets

Refers to a different system (chefandserve.nl WordPress site, not this Next.js app). Don't confuse — this Glossary is for THIS repo.

### `client_signed`

Backend status meaning the klant has signed `shift_hours`. Dutch: "Ondertekend door klant, wacht op admin".

### `client_rejected`

Klant rejected the submitted hours with a reason. Chef can resubmit. Dutch: "Afgewezen door klant".

### Confirmed (placement)

Both chef and admin have agreed. Klant is notified. Shift is locked in. Backend: `placements.status='confirmed'`.

### Consent log

`consent_log` table — append-only record of each user's acceptance of each version of each consent document. See [`workflow-playbooks/avg-consent.md`](./workflow-playbooks/avg-consent.md).

### Contact log

`contact_logs` table (PR-CHEF-5+). Admin notes about phone calls (e.g. "called Daniel about Tier 3 cancel"). Admin-only.

### Correction

`shift_hour_corrections` row. Append-only delta to a post-export `shift_hours` row. Requires two-eye principle (creator ≠ approver).

### Coordinator

Future role (`coordinator`) — operational role. Can propose placements but not approve hours. Read-only on finance.

### `cs-payroll-pillar-v1`, `cs-...`

Markers from a DIFFERENT project (chefandserve.nl WordPress site). Not relevant here. If a chef or klant says "the website says X", they may be referring to the marketing site, which is separate from this portal.

---

## D

### Diensten

Dutch for "shifts" — singular `dienst`. The AI uses `dienst` consistently in user-facing copy.

### DPA

Data Processing Agreement (verwerkersovereenkomst). For klant companies. Stored in `data_processing_agreements` (planned PR-CHEF-10).

### Draft (hours)

`shift_hours.status='draft'`. Created by the `complete-placements` worker. Chef fills in and submits. Dutch: "In te dienen door chef".

---

## E

### Embeddings

Vector representations of text. Stored in `ai_embeddings` (planned). Generated by `text-embedding-3-small` (OpenAI). Used for semantic RAG. See [`rag-ingestion-contract.md`](./rag-ingestion-contract.md).

### Enforce (consent)

`AVG_CONSENT_ENFORCED` env var. When `true`, middleware blocks unconsenting users from portal pages. V1 default is `false` (lawyer review pending).

### `exported`

Terminal status for `shift_hours`. Means it's in a closed payroll batch. Cannot be mutated. Dutch: "Verwerkt voor uitbetaling".

### External_refs

`external_refs` table — maps our entity IDs to external system IDs (Payingit, accounting). Never on the entity table directly.

---

## F

### Fence 5

Internal naming for the purpose-bound recovery token rule (PR-C). A forgot-password token cannot be used for lost-2fa, and vice versa. Enforced via `recovery_intents.intent` field.

### Fine dining

A `segment` enum value. Higher-end restaurants. Higher vakniveau expectations.

---

## H

### Headcount

`shifts.headcount` — number of chefs needed. A shift with headcount=3 spawns up to 3 `placements`.

### Hours chain

The four-link consent chain: chef submits → klant signs → admin approves → exported. See [`workflow-playbooks/hours-trust-chain.md`](./workflow-playbooks/hours-trust-chain.md). The single most important workflow in the system.

### `humanStatus()`

Helper in `src/lib/hours-labels.ts` (PR-CHEF-1). Maps backend enums to Dutch UI labels. The AI MUST use this — never the raw enum.

---

## I

### Idempotency key

A deterministic key on every outbox row. Format depends on event type; for hours approval: `hours.approved:<hoursId>`. Re-enqueueing the same key is a no-op.

### Inzage

AVG right of access — "show me what data you hold on me". One of four privacy request types. See [`workflow-playbooks/privacy-request.md`](./workflow-playbooks/privacy-request.md).

### Internal (user kind)

`users.kind='internal'` — staff (admins). Distinct from `chef` and `client`.

### Integration outbox

`integration_outbox` table (PR-CHEF-0). Every external system call goes through here — never direct API call from a DB transaction.

---

## K

### Klant

Dutch for "client". UI consistently uses "klant". Master record in `clients`. Multiple klant locations possible (`client_locations`, planned).

### Klant portal

`/client/*` routes. Klant sees own shifts + own hours queue + can submit new requests.

### KvK

Kamer van Koophandel — Dutch Chamber of Commerce. KvK number registers a company. `clients.kvk` field.

---

## L

### Lockout

When TOTP fails 5 times in 5 minutes, the rate-limit triggers. Audit `auth.totp_rate_limited`. Notification key `totp_lockout` may alert admin.

### Long-running tool

A tool call that takes >5 seconds. AI shows progress + interim status.

---

## M

### Magic link

Auth.js + Resend email-based login. Primary auth flow. Token in `auth_verification_tokens`, single-use.

### Maarten

The founder. Sole `owner` + `super_admin` today. Voice + tribal-knowledge documented in `~/.claude/projects/.../memory/MAARTEN-PROFILE.md` (a sibling project's memory).

### Manual add hours

`manualAddHours` admin action. Creates a `shift_hours` row directly at `admin_approved` status, bypassing chef + klant chain. Used when chef forgot to confirm or chain otherwise broke. Audit `shift_hours.admin_created (manual)`.

### Match score

`placements.matchScore` (0-100). Snapshot at proposal time. Computed by heuristic (Phase 1+) or AI (Phase 9+). Does not recompute.

### Mode 1 / 2 / 3 / 4

AI operating modes. See [`ai-safety-rules.md`](./ai-safety-rules.md).
- Mode 1: Read-only
- Mode 2: Draft (no execution)
- Mode 3: Assisted execute (after confirmation)
- Mode 4: Autonomous safe (rare)

---

## N

### Neon

Postgres-as-a-service. Production DB. Serverless. Branches for dev + restore drills.

### Notification

In-app `notifications` table row (planned PR-CHEF-0). Recipient + type + title + body + actionUrl. Separate from email; both fire on most events.

### `notification_routes`

Per-event configurable recipient list (PR-F1). For admin events only (e.g. `weekly_digest` → Maarten's email).

### No-show

`placements.status='no_show'`. Chef didn't appear. Admin marks after `shift.endsAt`.

---

## O

### Onboarding

`chefs.status='onboarding'`. Intake done, paperwork in progress. Chef cannot yet receive proposals (only `active` chefs do).

### Outbox

See "Integration outbox".

### Owner

RBAC role. Most powerful business role short of `super_admin`. Maarten's day-to-day role.

---

## P

### Payingit

External payroll provider (ZZP umbrella). Cannot be called directly from a transaction — all communication via outbox + worker. V1 uses CSV export only; live API later.

### Payroll batch

`payroll_batches` row. Grouping of `admin_approved` `shift_hours` for a period. After export, rows become `exported`. See [`workflow-playbooks/payroll-export.md`](./workflow-playbooks/payroll-export.md).

### Placement

`placements` row — the (chef, shift) link. Lifecycle: proposed → accepted → confirmed → completed (or rejected/cancelled/no_show).

### Privacy request

`privacy_requests` row. User's invocation of an AVG right (inzage / correctie / verwijdering / export). 30-day SLA. super_admin only handles.

### Profile change request

`profile_change_requests` row. Chef's proposal to change a locked field (rate, vakniveau, identity). Admin approves or rejects. See [`workflow-playbooks/profile-change-request.md`](./workflow-playbooks/profile-change-request.md).

### Proposed (placement)

`placements.status='proposed'`. Admin proposed; chef hasn't responded yet.

### Pulitzer Amsterdam

A real klant (used as example). Hotel. `segment='hotel'`.

---

## R

### R2 (Cloudflare)

Object storage. Bucket: `chefandserve`. Chef documents at `chefs/<chefId>/<docId>/<filename>`. Payroll CSVs at `payroll/<year>/<batchId>.csv`. Access via presigned URLs only.

### RAG

Retrieval-Augmented Generation. The AI's Layer 2 (per `AI_INTEGRATION.md`). Embeddings + retrieval rules in [`rag-ingestion-contract.md`](./rag-ingestion-contract.md).

### Recovery code

8 codes generated at TOTP enrollment. bcrypt-hashed in `user_recovery_codes`. Single-use (atomic UPDATE).

### Recovery intent

`recovery_intents` row (PR-C). Purpose-bound (password OR totp), single-use, 15-min TTL. Fence 5.

### Resend

Email delivery provider. Webhook updates `email_events`.

### Restore drill

`restore_drills` row. Monthly test: restore the latest backup to a Neon dev branch + run sanity queries. See [`workflow-playbooks/backup-restore.md`](./workflow-playbooks/backup-restore.md).

---

## S

### Segment

Hospitality segment enum: `casual` · `fine_dining` · `hotel` · `banqueting` · `catering` · `event` · `corporate` · `michelin`. Drives matching.

### Shift

`shifts` row. A klant's request (e.g. "sous chef, 12 juni 18:00–23:00, 1 person").

### `shift_hours`

The trust-chain row. Lifecycle: draft → submitted → client_signed/client_rejected → admin_approved/admin_rejected → exported.

### `shift_hour_corrections`

Append-only correction rows for post-export adjustments.

### `shift_proposed`

In-app notification type. Sent to chef when admin proposes a placement.

### SLA

Service-Level Agreement. For privacy requests: 30 days. For hours signing: soft 5-day target (admin nudged).

### Soft-delete

`deleted_at` column on `chefs`, `clients`, `shifts`, `chef_documents`. Preserves training data + audit trail. Hard delete only via privacy request erasure.

### Super_admin

Top RBAC role. Only Maarten + Jezza. Can reset 2FA, fulfill privacy requests, invite internal staff.

### `submitted` (hours)

Chef has filled in `shift_hours` and submitted. Awaits klant signature.

---

## T

### Tariff

Hourly rate. Chef's range in `chefs.hourlyRateMinCents` and `Max`. Placement's effective rate is `placements.chefRateCents` (override) or `shifts.chefRateCents` (default).

### Tier 1 / 2 / 3 (cancellation)

Severity tiers based on hours-until-shift. See [`workflow-playbooks/chef-cancellation.md`](./workflow-playbooks/chef-cancellation.md). T3 = <24h = last-minute, admin call needed.

### TOTP

Time-based One-Time Password. RFC 6238. 6-digit codes. Enrolled secret in `users.totpSecretEncrypted` (AES-256-GCM). `TOTP_ENFORCE=true` is live; 12h device cookie via v2 format.

### Trust chain

See "Hours chain".

### Two-eye principle

A second admin must approve a correction (creator ≠ approver). Enforced at SQL level (`WHERE createdBy != user.id`).

---

## V

### Vakniveau

Chef skill ladder. Enum: `keukenhulp` · `bediening` · `host` · `runner` · `commis` · `chef_de_partie` · `sous_chef` · `chef_de_cuisine` · `executive_chef` · `patissier` · `banqueting` · `breakfast` · `roomservice` · `other`. Drives matching.

### Verwijderen / Verwijdering

AVG right of erasure. One of four privacy request types. NL law retention may keep some data (tax) — response must say so.

### Voorstel

Dutch for "proposal" — a placement in `proposed` state.

### `voided`

Used in two contexts:
- `shift_hours.status='void'`: admin invalidated a row (rare).
- `payroll_batches.status='voided'`: admin cancelled a draft batch.

---

## W

### Weglot

Translation service used on the chefandserve.nl WordPress marketing site (separate project). Creates `/nl/` copies. Not relevant to this Next.js portal — the portal is Dutch-only.

### Wet DBA

Dutch law on independent contractors. Time-sensitive; AI MUST cite published docs for any claim, not pretraining. Maarten's prior venture JUSTHORECA ceased due to "ZZP crackdown" — related context.

### Withholding

Tax withholding handled by Payingit on payroll. We don't compute it.

### Worker

A background process on Railway. Crons run on schedule. Examples: `embedding-refresh`, `weekly-digest`, `complete-placements`, `hours-reminders`, `document-expiry`, `payroll-export`, `retention`, `supervisor`.

---

## Y

### Yoast SEO

A WordPress plugin used on chefandserve.nl marketing site. Not relevant to this portal. If a user mentions it, they're talking about the other project.

---

## Z

### ZZP

Zelfstandige Zonder Personeel — Dutch for solo self-employed contractor. Wet DBA enforces stricter rules on ZZP arrangements. Chef & Serve operates via Payingit's umbrella structure, not direct ZZP.

---

## Glossary maintenance

- New domain term shipped in code? → add a row here.
- A term's meaning changed? → update + bump `redaction_version` in the RAG indexer (forces reindex of the glossary chunks).
- Removed feature? → keep the term but mark "(deprecated)" so historical answers stay accurate.

This file is one of the broad-index RAG sources. The AI may quote definitions from here in user-facing answers (with citation: "Bron: docs/ai/ai-glossary.md#hours-chain").
