# RAG Source Catalog

> Every potential source of context for the AI, classified into four buckets:
> **Broad index** · **Access-filtered** · **Restricted** · **NEVER index**.

This is the indexer's allowlist. If a source isn't in `Broad index` or `Access-filtered`, the embedding worker (`workers/embedding-refresh.ts`, currently a no-op stub) must not touch it.

Pairs with [`rag-ingestion-contract.md`](./rag-ingestion-contract.md) for chunking + retrieval mechanics.

---

## The four buckets

### 1. Broad index — vectorized, retrievable by any authed user (with role-aware result filtering at query time)

These are sources where the *content* itself doesn't carry PII or financial data — they're domain knowledge.

| Source | What | Refresh | Notes |
|---|---|---|---|
| Project docs (`docs/ai/`, `MEMORY.md`, `WORKFLOW.md`, `AI_INTEGRATION.md`, `BUILD_PLAN.md`, `ROADMAP.md`, `README.md`) | The repo's own knowledge base | On commit | Self-documenting RAG. AI uses these to answer "how does the system work?". |
| Public privacy pages (`src/content/privacy-chef.mdx`, `privacy-klant.mdx`) | Legal text | On commit | Helps AI answer "what data do we store and why?" |
| Internal SOP / playbooks (future) | Operating procedures | On commit | When written, place under `docs/sops/`. |
| Vakniveau + segment glossary | Domain language | On schema change | Stays in sync with the `vakniveau` and `segment` enums + `ai-glossary.md`. |
| Public-facing marketing copy on chefandserve.nl | What the company says publicly | Weekly | Used so AI doesn't contradict published claims. |

**Retrieval rule:** results are returned to anyone authed. Pre-prompt injection is fine; nothing sensitive lives here.

---

### 2. Access-filtered — vectorized, but retrieval filters by caller's RBAC at query time

These sources contain identifier-bearing or business data. Every chunk MUST be tagged with:
- `tenantScope` (e.g. `chefId:<uuid>` or `clientId:<uuid>` or `internal`)
- `visibility` enum (e.g. `chef_own`, `klant_own`, `admin_only`, `placement_bridge`)

The retriever applies these filters BEFORE returning chunks to the LLM.

| Source | What | Refresh | Visibility logic |
|---|---|---|---|
| Chef profile (`chefs.notes`, `chefs.specialties`, `chefs.languages`, `chefs.segments`, `chefs.city`, public CV text from `chef_documents` where type=cv AND uploadedBy=chef themselves) | Chef bio for matching | On chef update | Visible: that chef themselves + admins. Klanten see only `{name, city, vakniveau}` of chefs placed at their shifts (placement_bridge). |
| Client profile (`clients.notes`, `clients.address`, `clients.city`, `clients.companyName`) | Klant briefing for matching | On client update | Visible: that klant themselves + admins. Chefs see only `{companyName, city}` of klanten where they have an active placement (placement_bridge). |
| Maarten's tribal-knowledge notes (`chefs.notes` written by admins, `clients.notes` written by admins, future `notes` table) | Operator memory ("Daniel pairs poorly with Wim") | On write | **Admin-only.** Never returned to chef or klant queries. |
| Past placements joined with ratings + hours discrepancy | "Which chefs did well at this client?" | Nightly | Admin-only for full text. Chef sees only own. Klant sees only own. |
| Shift descriptions (`shifts.notes`, `shifts.whenDescription`) | Semantic search "find similar past shifts" | On shift create/update | Admin-only by default. Chef + klant see only shifts they're linked to. |
| Free-text Maarten notes table (future) | Operator's note pad | On write | Admin-only. |
| Email thread bodies (`email_messages` + `email_events`) | "What was last said to this chef?" | On send + on webhook | Sender + recipient + admin. Heavy redaction: never quote a chef's body to a klant. |
| Contact logs (`contact_logs`, PR-CHEF-5) | Phone-call summaries | On write | Admin-only. |

**Retrieval rule:** retriever runs a metadata filter (`tenantScope` ∩ caller's `tenantScope`s) before returning chunks. The LLM never sees chunks outside its scope.

---

### 3. Restricted — NOT indexed for RAG. Reachable only via typed tool calls with explicit confirmation.

These are facts the AI may *say*, but only by calling a tool, not by retrieving a chunk.

| Source | Why restricted | How to access |
|---|---|---|
| Payroll batch contents (`payroll_batches`, `payroll_batch_lines`) | Financial. Aggregates per chef. | Tool: `payroll.draft_batch` / read-only `integrations.health`. |
| Shift hours rates + amounts (`shift_hours` amount fields, `shift_hour_corrections` deltas) | Financial. | Tool: `hours.read`, `hours.summarize`. |
| Audit log entries with PII payloads | Historical record of identity changes | Tool: `audit.search` filtered by viewer. |
| Privacy requests (`privacy_requests`) | Legal sensitivity | Tool: `privacy.list_requests`. |
| Outbox failures (`integration_outbox`, `integration_runs`) | Operational risk surface | Tool: `integrations.health`. |
| Document metadata (`chef_documents`) | Existence is OK; bytes are not | Tool: `documents.list_for_chef` / `documents.read_metadata`. Bytes only via presigned URL after confirmation. |

**Retrieval rule:** these sources have no embeddings. AI may produce a tool call to fetch a structured answer, but cannot bring this content into the LLM context via RAG.

---

### 4. NEVER index — never vectorized, never returned to AI even via tool

Hard floor. The AI must not see these in any form.

| Source | Why |
|---|---|
| BSN | Personal identifier; lives in Payingit, not in our DB. |
| IBAN / bank account / account holder name | Financial credential. |
| ID document bytes (passport, ID card) | Identity document content. We store the metadata; the bytes go through R2 with no AI surface. |
| Password hashes (`users.passwordHash`) | Bcrypt hashes are computationally costly to leak but still treated as secret. |
| TOTP secrets (`users.totpSecretEncrypted`) | AES-encrypted. Decryption is server-only at TOTP-verify time. |
| Recovery codes (`userRecoveryCodes.codeHash`) | Single-use bypasses. |
| Recovery intents (`recoveryIntents.token`) | 15-minute live secrets. |
| Auth.js session tokens, magic-link tokens (`authVerificationTokens`, `authSessions`) | Active session credentials. |
| Rate-limit hashes (`rateLimits.keyHash`) | Derived from PII; HMAC'd to prevent reverse lookup. Treat as opaque. |
| `.env` values, secrets, API keys | Self-explanatory. |
| Raw Resend webhook payloads (`webhooksReceived` for resend) | May contain email body fragments + bounce reasons; admin can read via tool, never via RAG. |
| Error log stack traces with environment context | May contain leaked PII; admin can read via tool. |
| Internal staff DMs / private comms | Not currently stored. If ever added → NEVER index. |
| Third-party documents we don't own (e.g. images uploaded by chefs as portfolio pieces) | Copyright + licensing unclear. |

**If you ever find yourself indexing one of these by accident:**
1. Purge the embeddings table immediately.
2. Audit-log the incident (`ai.indexing_violation`).
3. File a privacy incident if PII was leaked.

---

## Source-to-bucket lookup (every Drizzle table)

Quick reference — should match `src/lib/db/schema.ts`:

| Table | Bucket | Notes |
|---|---|---|
| `users` (name, email) | Access-filtered | Name + email only. Hashed + encrypted fields → NEVER. |
| `users` (passwordHash, totpSecretEncrypted) | NEVER | |
| `authAccounts`, `authSessions`, `authVerificationTokens` | NEVER | |
| `roles`, `permissions`, `rolePermissions`, `userRoles` | Restricted (tool only) | RBAC graph is not RAG fodder. |
| `userRecoveryCodes`, `recoveryIntents` | NEVER | |
| `auditLog` | Restricted (tool only) | Quote via `audit.search`. |
| `errorLog` | Restricted (tool only) | Admin-only. |
| `webhooksReceived` | Restricted (tool only) | |
| `rateLimits` | NEVER | |
| `notificationRoutes` | Restricted (tool only) | |
| `chefSubmissions`, `clientSubmissions` | Access-filtered (admin-only chunks) | Free-text fields safe; PII fields require visibility tagging. |
| `chefs` (notes, specialties, vakniveau, segments, city) | Access-filtered | Chef-own + admin + placement-bridge. |
| `chefs` (email, phone) | Restricted (tool only) | Don't put contact methods in RAG. |
| `clients` (notes, address, companyName, segment) | Access-filtered | Klant-own + admin + placement-bridge. |
| `clients` (kvk, btw, billingEmail, paymentTermsDays) | Restricted (tool only) | |
| `chefAvailability` | Restricted (tool only) | Tool only. |
| `shifts` (notes, whenDescription, location, city) | Access-filtered | Default admin-only; participants see linked. |
| `shifts` (clientRateCents, chefRateCents) | Restricted (tool only) | Financial. |
| `placements` | Access-filtered | Participants + admin. Don't include `matchScore` in RAG chunks. |
| `chefDocuments` (filename, type, uploadedAt) | Restricted (tool only) | Metadata via tool. Bytes → NEVER index. |
| `shift_hours` (planned, PR-CHEF-1) | Restricted (tool only) | Financial. |
| `shift_hour_corrections` (planned) | Restricted (tool only) | Financial. |
| `payroll_batches`, `payroll_batch_lines` (planned) | Restricted (tool only) | Financial. |
| `consent_log` (planned) | Restricted (tool only) | |
| `privacy_requests` (planned) | Restricted (tool only) | |
| `data_processing_agreements` (planned) | Access-filtered (admin chunks) + Broad index for public copies | Legal text is fine to RAG. |
| `notifications` (planned, PR-CHEF-0) | Restricted (tool only) | Recipient + admin only. |
| `contact_logs` (planned) | Restricted (tool only) | Admin-only. |
| `email_messages`, `email_events` (planned) | Access-filtered | Sender + recipient + admin. Bodies redact PII before chunking. |
| `integration_outbox`, `integration_runs`, `external_refs` (planned) | Restricted (tool only) | Operational. |
| `backup_runs`, `restore_drills` (planned) | Restricted (tool only) | Admin-only. |

---

## What goes into a chunk

For every Access-filtered chunk, the indexer MUST attach metadata:

```jsonc
{
  "source_table": "chefs",
  "source_pk": "<uuid>",
  "field": "notes",
  "tenantScope": "chefId:<uuid>",           // who "owns" the chunk
  "visibility": "chef_own_and_admin",        // see enum below
  "indexedAt": "2026-05-27T18:00:00Z",
  "redactionVersion": 1                      // bump if redaction rules change → reindex
}
```

### Visibility enum

- `public` — anyone authed.
- `chef_own_and_admin` — that chef + admins.
- `klant_own_and_admin` — that klant + admins.
- `placement_bridge` — chef ↔ klant chunk: visible to both sides of an active placement + admins.
- `admin_only` — admins (`owner` / `super_admin`).
- `super_admin_only` — `super_admin` exclusively.

---

## Reindex triggers

| Event | Tables to reindex |
|---|---|
| Chef profile update | `chefs` chunks for that chef |
| Chef notes update | same |
| Client profile update | `clients` chunks |
| Shift create/update | `shifts` chunks for that shift |
| Document upload + verify | `chef_documents` metadata (if surfacing CV text — only when CV uploaded by the chef themselves, not third-party files) |
| Schema change to enums (vakniveau, segment) | Glossary doc reindex |
| Public docs commit | Broad index reindex |

`workers/embedding-refresh.ts` runs nightly; reads `chefs.updatedAt > last_run` etc., reindexes deltas. On the day this worker starts producing embeddings (not yet — currently a no-op stub), the contract above is the test it must pass.

---

## Pre-flight checklist when adding a new source

- [ ] Which bucket? Default to `Restricted` unless there's a clear safety story for indexing.
- [ ] If `Access-filtered`: what's the `visibility` enum?
- [ ] What's the redaction step? (Strip emails, phones, BSN-shaped strings, IBAN-shaped strings.)
- [ ] Refresh trigger?
- [ ] Add a row to "Source-to-bucket lookup" above.
- [ ] If financial / identity / health-document → put in `Restricted` or `NEVER`. Be paranoid.

---

## Klant comment store rule (PR-KLANT-0)

> **NEVER read `placements.notes` for klant-facing answers.** Use `placement_comments WHERE visibility='client_visible'` (via `listVisibleComments(placementId, { kind:'client' })`) or the curated `ai_client_shift_summary_view`.

`placements.notes` is a single free-text blob that historically mixed admin private notes, Maarten's matching notes, klant-visible notes, klant feedback, and chef-visible notes — a privacy leak waiting to happen. PR-KLANT-0 replaced it with the structured `placement_comments` table, where every row carries an explicit `visibility` enum (`internal` / `client_visible` / `chef_visible`). The retriever and every tool MUST honour this:

| Viewer | May read |
|---|---|
| admin | `placement_comments` all visibilities |
| klant (own shift) | `placement_comments` `visibility='client_visible'` only |
| chef (own placement) | `placement_comments` `visibility='chef_visible'` only |

Source-to-bucket additions:

| Table | Bucket | Notes |
|---|---|---|
| `placements` (`notes`) | Restricted (tool only, admin) | Legacy blob. NEVER surfaced to klant/chef. Prefer `placement_comments`. |
| `placement_comments` | Access-filtered | Visibility enum is the filter. `client_visible` → klant-own + admin; `chef_visible` → chef-own + admin; `internal` → admin only. Plain-text bodies, 1–1000 chars. |
| `client_contacts` (email, phone) | Restricted (tool only) | Klant-own + admin. Routing seam; don't put contact methods in RAG. |
| `client_change_requests`, `client_shift_change_requests` | Access-filtered (admin + own klant) | Free-text reason/decision_notes; PII-tag per klant. |
| `shift_templates` (`chef_rate_cents`, `client_rate_cents`) | Restricted (tool only, admin) | Financial. Klant projection omits rates. |
| `ratings` (stars, tags, comment) | Restricted (tool only) | Internal-only V1. Admin full; chef own-average at N≥5; klant never. |

---

## Proposed klant read-model views (future-curated sources)

These SQL views do not exist yet (same status as `ai_hours_queue_view` et al. in `source-of-truth-map.md`). They are the **future-curated, safe-by-construction** sources klant-facing tools should read from instead of base tables. Until they ship, tools synthesise from base tables while honouring the visibility rules above.

| View | Purpose | Safety property |
|---|---|---|
| `ai_client_shift_summary_view` | One row per shift: `humanStatus`, `nextAction`, `proposedChefsSafeSummary` (clientVisible only), `confirmedChefs`, `hoursStatus`, `ratingStatus`, `allowedClientActions`. | Pre-redacted to clientVisible fields; never includes `placements.notes`, internal comments, or ratings. |
| `ai_client_request_queue_view` | One row per submission / shift change request: `humanStatus`, `nextStep`, `canCancel`, `canRequestChange`. | Own-klant scoped. |
| `ai_recurring_template_summary_view` | One row per template: `humanPattern`, `nextGeneratedDates`, `pendingChangeRequest`, `allowedActions`. | Klant projection omits `chef_rate_cents`/`client_rate_cents`. |
| `ai_client_feedback_view` | One row per placement: `commentSummary`, `visibility`, `adminActionNeeded`. | Visibility-tagged; chef/klant rating exposure follows the N≥5 + internal-only rules. |

When these views ship, the contract above is the test they must pass: a klant-scoped query through them must be incapable of returning `placements.notes`, an `internal`/`chef_visible` comment, or any chef rating.
