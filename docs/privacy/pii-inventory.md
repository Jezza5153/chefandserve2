# PII Inventory — chefandserve2.0

> **SOURCE OF TRUTH** for AVG/GDPR data-subject requests (DSAR). Drives the scope of
> data-export packages (art. 15 access / art. 20 portability) and erasure (art. 17).
> Generated against `src/lib/db/schema.ts`. **One row per table — all 51 tables in the schema are listed.**
>
> Two data-subject types hold PII: **chefs** and **klant contact persons**. Internal
> (Maarten/Jezza) users also have account PII but are not external data subjects.
>
> **Payingit / fiscal legal hold (`bewaarplicht`):** business + payroll administration
> must be kept **~7 years** (10 years for some property/onroerend-goed records). Any row
> that is part of the payroll/hours/invoicing administration is **NOT erasable on request**
> — it is *retained under legal hold* and only purged after its retention window. See
> `retention-matrix.md` for the per-entity clock.

## Legend

| Symbol | Meaning |
|--------|---------|
| **Yes** (Contains PII?) | Holds personal data of a chef and/or a klant contact person |
| **No** | Operational/system data, no direct personal data (may reference a userId — see notes) |
| **Indirect** | No PII columns itself, but rows are *about* a data subject (link/join table or reference) |
| **Full** (Export) | Requester's own data — include verbatim in the export package |
| **Redact** (Export) | Row may contain a *third party's* data — include only the requester's own context, strip/anonymise the other person |
| **Exclude** (Export) | Never export — security internals, raw provider payloads, or private admin notes |
| **Erase** (art.17) | Can be deleted/anonymised on a valid request |
| **Retain** (art.17) | Legal hold (payroll/hours/tax/accountability) — refuse erasure, keep until retention expiry |
| **Soft-delete** | Table has a `deletedAt` column (anonymise-in-place possible; R2 bytes purged by worker) |
| **art.15** | Right of access (broad — all personal data we hold about them) |
| **art.20** | Right to portability (narrower — only data *they provided*, processed by consent/contract, machine-readable) |

> **Identity-of-the-subject note.** chefs/clients use a `text` uuid PK; a `users` row may
> or may not be linked (`chefs.userId` / `clients.userId`, nullable). A DSAR resolver must
> fan out from BOTH the master record id AND the linked `users.id` to gather everything.

---

## Inventory

| Table | PII columns | Contains PII? | Export (access art.15) | Export (portability art.20) | Erase/anonymize (art.17) | Legal hold | Retention | Third-party-data risk |
|-------|-------------|---------------|-------------------------|------------------------------|---------------------------|------------|-----------|------------------------|
| **users** | `email`, `name`, `image`, `passwordHash`*, `totpSecretEncrypted`*, `calendarTokenSecret`* | Yes | Full (identity fields only; *exclude credentials) | Full (email, name) | Erase (anonymise: null name/email/image, wipe secrets) — *unless* linked to retained payroll rows, then retain stub | No (account itself) | Until subject + linked records purged | Low — own account. Secrets (`passwordHash`, `totp*`, `calendarTokenSecret`) are **Exclude** always |
| **auth_accounts** | OAuth tokens (`access_token`, `refresh_token`, `id_token`) tied to userId | No (credentials) | Exclude | Exclude | Erase (cascade on user delete) | No | Session lifetime | Low — security internals, never export |
| **auth_sessions** | `userId` only | No | Exclude | — | Erase (cascade) | No | Session expiry | None |
| **auth_verification_tokens** | `identifier` (= email) | Indirect | Exclude | — | Erase (consumed on use; expire) | No | 15 min / on use | Low — short-lived magic-link token |
| **roles** | — | No | Exclude (system config) | — | Erase (config) | No | Lifetime of system | None |
| **permissions** | — | No | Exclude (system config) | — | Erase (config) | No | Lifetime of system | None |
| **role_permissions** | — | No | Exclude (mapping) | — | Erase (config) | No | Lifetime of system | None |
| **user_roles** | `userId`, `grantedBy` (both internal users) | Indirect | Exclude (internal RBAC) | — | Erase (cascade) | No | While account active | Contains `grantedBy` (another admin) — internal only, do not export |
| **audit_log** | `userId` (actor), `ip`, `userAgent`, `before`/`after` jsonb (may embed PII snapshots) | Yes | **Redact** — give the subject their own actions; redact other userIds and unrelated `before`/`after` snapshots | Exclude (not provided-by-subject) | **Retain** (security + accountability) | **Yes** (accountability) | Security window (see matrix, e.g. 1–2y) | **High** — holds actor id + other users' ids + arbitrary mutation snapshots. Filter to subject; redact others |
| **error_log** | `userId`, `userAgent`, `context` jsonb (may incidentally hold PII), `stack` | No (diagnostics) | Exclude (security/ops internals) | Exclude | Retain (debug window) then purge | Soft (ops) | Short ops window | Stacks/context may name third parties — internal only |
| **webhooks_received** | `payload` jsonb = raw Jotform/Payingit body (names, emails, phones) | Yes (raw) | **Exclude raw payload** — point to the structured submission instead | Exclude | Erase (purge after processing window) | No | Replay/forensics window | **High** — raw third-party-shaped payload; never export raw bytes |
| **user_recovery_codes** | `codeHash` (bcrypt) tied to userId | No (credentials) | Exclude | Exclude | Erase (deleted when 2FA disabled / cascade) | No | While 2FA enrolled | Security internals — never export |
| **notification_routes** | `recipients` (array of admin emails), `updatedBy` | Indirect | Exclude (internal routing config) | — | Erase (config) | No | Config lifetime | Internal staff emails — not a data-subject export |
| **rate_limits** | `keyHash` = hmac(scope + email/ip) — **hashed, not raw** | No (pseudonymous) | Exclude | — | Erase (worker prunes >7d) | No | 7 days | Hashed only — no recoverable PII |
| **chef_submissions** | `fullName`, `email`, `phone`, `notes`, `rolesRequested`, `locationPreference`, `rawPayload` jsonb | Yes | Full for the chef (structured fields). **Exclude `rawPayload`** (raw Jotform) | Full (data they submitted) | Erase if not converted/retained; if converted & linked to payroll → retain | Maybe (if part of administration) | Until converted/rejected + window | Medium — `rawPayload` raw; `notes` is applicant free-text (own) |
| **client_submissions** | `companyName`, `contactName`, `email`, `phone`, `notes`, `location`, `rawPayload` jsonb | Yes (contact person) | Full for the klant contact (structured). **Exclude `rawPayload`** | Full (data they submitted) | Erase if not converted; if converted & administration → retain | Maybe | Until converted/rejected + window | Medium — `rawPayload` raw; company data mostly not personal |
| **chefs** | `fullName`, `email`, `phone`, `city`, `specialties`, `languages`, rate, `payingitEmployeeId`, **`notes`** | Yes | Full (identity/profile). **Exclude `notes`** (Maarten's private tribal knowledge) | Full (profile data they provided) | **Anonymise via soft-delete** if no payroll history; **Retain** the parts referenced by retained `shift_hours`/payroll | Partial (rate/payroll linkage = hold) | 7y if administration-linked, else discretionary | **`notes` = third-party/admin opinion — never export.** Rate is contractual |
| **clients** | `contactName`, `email`, `phone`, `billingEmail`, `kvk`, `btw`, `address`/`shiftAddress`/`billingAddress`, **`notes`** | Yes (contact person) | Full for the contact (their name/email/phone). **Exclude `notes`** | Full (provided data) | **Anonymise the contact person**; **Retain** company/billing identifiers that are part of invoicing administration | **Yes** (invoicing identifiers) | 7y (administration) | **`notes` = private admin notes — exclude.** `kvk`/`btw` are company, not personal |
| **chef_availability** | `chefId`, `notes` (chef's own blocked-date notes) | Indirect | Full (the chef's own calendar) | Full | Erase (operational, cascade on chef delete) | No | "No longer than necessary" | Low — single chef's own data |
| **shifts** | `location`, `city`, `notes`, `createdBy` (internal), `clientId` (links a klant) | Indirect | **Redact** — a chef export gets only shifts they were placed on; redact other chefs/klant internal notes | Exclude (operational, not subject-provided) | **Retain** if invoiced/part of administration | **Yes** (when billed) | 7y (administration) | Medium — `notes` mixes scopes; a shift links a klant + many chefs |
| **chef_documents** | `filename`, `r2Key`, plus R2 **bytes** = CV / **id_document** / photo / certificate | Yes | Full to the chef (their own files via presigned URL); list metadata + provide bytes | Full (documents they uploaded) | **Erase** (soft-delete row + worker purges R2 object) unless a doc is payroll/identity evidence under hold | Maybe (id evidence) | Until expiry/exit + window | High-sensitivity (ID docs) but **own data**. `id_document` is special-category-adjacent — handle carefully |
| **placements** | `notes`, `matchScore`, `chefId`+`shiftId` link, `proposedBy` (internal) | Indirect | **Redact** — chef gets their own placement rows; strip `notes`/`matchScore` (internal opinion) and other people | Exclude (internal matching) | **Retain** when tied to logged hours/payroll | **Yes** (payroll linkage) | 7y (administration) | Medium — `notes` is internal; `matchScore` is Maarten's private judgement → exclude |
| **recovery_intents** | `token` tied to userId | No (credentials) | Exclude | Exclude | Erase (single-use, expires 15 min) | No | 15 min | Security internals — never export |
| **integration_connections** | `configEncrypted` (provider creds), `lastError` | No (system) | Exclude | — | Erase (config) | No | Connection lifetime | Provider credentials — never export |
| **integration_outbox** | `payloadJson` jsonb = **client billing / payroll export bodies**, `entityId` | Yes (embedded) | **Exclude payloads** — derive the subject's facts from the canonical tables instead | Exclude | Erase after delivery window; **Retain** if it constitutes the only record of an exported payroll/billing event | Maybe (payroll/billing) | Delivery + forensics window | **High** — payloads carry client billing + chef payroll; never export raw |
| **integration_runs** | `createdBy` (internal), `notes` | No (ops) | Exclude (ops internals) | — | Erase after window | No | Forensics window | Low — operator/ops data |
| **external_refs** | `entityId` (chef/client/shift), `externalId`, `metaJson` | Indirect | Exclude (system mapping) | — | **Retain** while the external payroll/accounting record exists | Maybe (payroll/accounting) | Mirrors external system | Low — maps our id ↔ Payingit id; no direct PII |
| **email_messages** | `toEmail`, `template`, `userId`, `entityId`, `error` | Yes | **Redact** — give the subject only messages addressed to *them* (`toEmail` = their address); never expose other recipients' threads | Exclude (transactional, not provided) | Erase after window; **Retain** invoicing/payroll-notice mails that are part of administration | Maybe (admin notices) | Delivery + dispute window | **High** — holds recipient/thread routing; export only the subject's own messages |
| **email_events** | `payloadJson` jsonb = Resend webhook (recipient, bounce reason), links a message | Yes (embedded) | **Exclude raw payload** — at most confirm delivery status of the subject's own mail | Exclude | Erase (cascade on message delete) after window | No | Delivery + dispute window | **High** — raw provider event with recipient data; never export raw |
| **notifications** | `userId`, `title`, `body`, `actionUrl`, `entityId` | Yes | Full to that user (their own in-app inbox) | Exclude (system-generated, not provided) | Erase (cascade on user delete) | No | "No longer than necessary" | Low — scoped to one user, but `body` may name a counterparty → light redact |
| **contact_logs** | `actorUserId` (internal), `targetId` (chef/client), `note`, `outcome`, `channel` | Yes | **Redact** — a subject may see that contact occurred; `note` is Maarten's operational memory → exclude/summarise | Exclude (internal log) | Erase after operational window unless dispute-relevant | No | Operational window | **High** — `note` is internal opinion about the subject; treat like admin notes |
| **shift_hours** | `chefNotes`, `clientNotes`, `adminNotes`, rates, worked minutes, `clientSignedBy`/`adminApprovedBy` (internal), links chef+client+shift | Yes | **Redact** — chef gets their own hours (own notes, times, rate); strip `clientNotes`/`adminNotes` and the klant's signer identity | Exclude (payroll evidence) | **RETAIN — core payroll administration** | **Yes (7y bewaarplicht)** | **7 years** | **High** — the trust-chain backbone; mixes chef/klant/admin notes. Retain, redact on access |
| **profile_change_requests** | `chefId`, `currentValue`/`proposedValue` jsonb (e.g. name/email/rate), `reason`, `decidedBy` | Yes | **Redact** — chef gets their own requests; strip `decidedBy` admin identity & internal `decisionNotes` | Exclude (workflow) | Erase after window; **Retain** if it documents a rate change feeding payroll | Maybe (rate history) | Workflow + window | Medium — values are the chef's own; decision notes are internal |
| **client_change_requests** | `clientId`, `currentValue`/`proposedValue` jsonb (companyName/kvk/btw/billing), `reason` | Yes (contact) | **Redact** — klant contact gets their own requests; strip internal `decisionNotes`/`decidedBy` | Exclude (workflow) | Erase after window; **Retain** if it documents billing/identity change in administration | Maybe (billing history) | Workflow + window | Medium — mostly company data; decision notes internal |
| **client_shift_change_requests** | `clientId`, `requestedBy`, `reason`, `proposedChange` jsonb, `decisionNotes` | Yes (contact) | **Redact** — klant gets their own request; strip admin `decisionNotes`/`decidedBy` | Exclude (workflow) | Erase after window; **Retain** if shift was invoiced | Maybe (if billed) | Workflow + window | Medium — links a shift (other people); decision notes internal |
| **shift_templates** | `notes`, `createdBy` (internal), `clientId` | Indirect | Full to the klant (their own recurring pattern) | Exclude (operational) | Erase (operational, cascade on client delete) | No | "No longer than necessary" | Low — a klant's own template; `createdBy` is internal |
| **shift_template_exceptions** | `reason`, `createdBy` (internal), links a template | Indirect | Full to the klant (own exception) | Exclude | Erase (cascade) | No | "No longer than necessary" | Low — operational |
| **ratings** | `stars`, `tags`, `comment`, links **chef + klant**, `createdBy` | Yes (both subjects) | **Redact heavily** — internal-only feature. A **chef** may get the aggregate/their own rating but **not** the klant author identity or raw negative `comment`. A **klant** may get ratings *they authored* | Exclude (internal feedback) | Erase the free-text `comment` on request; the numeric signal may be retained as anonymised aggregate | No | Operational / matching signal | **High** — a rating is one person's opinion *about another*. Author ↔ subject crosswise; never reveal the counterparty |
| **backup_runs** | — (ops metadata: checksums, file path) | No | Exclude (ops internals) | — | Erase after window | No | Ops window | None |
| **restore_drills** | — (ops metadata) | No | Exclude (ops internals) | — | Erase after window | No | Ops window | None |
| **notification_prefs** | `userId`, `prefs` jsonb | Indirect | Full to that user (their own opt-out settings) | Full (their preferences) | Erase (cascade on user delete) | No | While account active | None — own settings |
| **consent_log** | `userId`, `documentKey`, `ip`, `userAgent`, `acceptedAt` | Yes | Full to the subject (proof of their own consent — append-only) | Full (their consent record) | **Retain** as long as the consent relationship + a reasonable proof window (accountability art. 7(1)) | **Yes** (proof of consent) | Consent relationship + proof window | Low — own consent. `ip`/`userAgent` are evidentiary, keep |
| **privacy_requests** | `requesterName`, `requesterEmail`, `requesterPhone`, `rawRequestText`, `identityNotes`, `decisionNotes`, `correctionScope` jsonb | Yes | **Redact** — the subject's own DSAR is theirs, but `identityNotes`/`decisionNotes` are internal handling notes → exclude | Exclude (compliance record) | **Retain** (proof we honoured the right — accountability) | **Yes** (compliance evidence) | Proof window (e.g. 1–3y after closure) | Medium — own request data; internal handling notes excluded |
| **privacy_request_messages** | `body` (correspondence), `direction`, `channel`, `createdBy` | Yes | **Redact** — give inbound/outbound correspondence with the subject; exclude `internal_note` direction rows | Exclude (compliance record) | **Retain** (proof of communication) | **Yes** (compliance evidence) | Proof window | Medium — `internal_note` rows are staff-only, never export |
| **data_processing_agreements** | `clientId`, `acceptedBy`, `version`, `fileUrl`, `fileChecksum` | Indirect | Full to the klant (their own signed DPA) | Exclude (contractual record) | **Retain** (contract/accountability) | **Yes** (contractual) | Contract + statutory window | Low — company-level contract; `acceptedBy` is the klant's own signer |
| **retention_policies** | — (config: entityType → interval) | No | Exclude (system config) | — | Erase (config) | No | System lifetime | None — see `retention-matrix.md` |
| **payroll_batches** | period, rates, totals (chef cost / client revenue / margin), `exportedBy`, `externalRef` | Yes (financial) | **Redact** — a subject does not get the whole batch; derive only their own line. Totals are aggregate business data | Exclude (financial admin) | **RETAIN — payroll/invoicing administration** | **Yes (7y bewaarplicht)** | **7 years** | **High** — batch aggregates all chefs/klanten; never export wholesale |
| **payroll_batch_lines** | `amountCents`, `clientAmountCents`, links a `shiftHours` row (→ chef + klant) | Yes (financial) | **Redact** — chef gets only lines deriving from their own hours; strip `clientAmountCents` (klant-side margin) | Exclude (financial admin) | **RETAIN — payroll administration** | **Yes (7y bewaarplicht)** | **7 years** | **High** — line carries both chef pay and client charge; expose only own side |
| **shift_hour_corrections** | `reason`, deltas (minutes/amounts), `createdBy`/`approvedBy` (internal), links a `shiftHours` row | Yes (financial) | **Redact** — chef gets corrections to their own hours; strip internal approver identity & client-side deltas | Exclude (financial admin) | **RETAIN — part of payroll administration** | **Yes (7y bewaarplicht)** | **7 years** | **High** — financial correction record; retain, redact counterparty/internal fields |
| **placement_comments** | `body` (free-text), `authorUserId`, `authorKind`, `visibility`, links a placement (→ chef + klant) | Yes | **Redact by `visibility`** — export only rows the subject is allowed to see (`client_visible` to that klant, `chef_visible` to that chef); **never** export `internal` (admin/matching) comments | Exclude (operational) | Erase free-text on request unless dispute/administration-relevant | No | Operational window | **High** — explicitly designed for multi-actor scoping. A comment may *name another person*. Honour `visibility` strictly; never leak `internal` |
| **client_contacts** | `name`, `email`, `phone`, `role` | Yes (contact person) | Full to that contact person (their own row). To a *different* contact at the same klant → **Redact** colleagues | Full (their contact details) | **Erase/anonymise** the contact on request unless tied to retained administration | No (contact directory) | While client active + window | Medium — a klant has *multiple* contacts; one contact's DSAR must not reveal colleagues |

---

## Redaction rules (apply to every export)

1. **Never export raw email/webhook payloads.** `webhooks_received.payload`, `integration_outbox.payloadJson`,
   `email_events.payloadJson`, and `chef_submissions.rawPayload` / `client_submissions.rawPayload` are
   provider-shaped blobs that carry third-party data and routing internals. Derive the subject's facts from
   the canonical tables (chefs/clients/shift_hours/etc.) and export those instead.
2. **Never export private admin notes.** `chefs.notes` and `clients.notes` are Maarten's tribal knowledge
   (subjective opinions, commercial judgement). Likewise `placements.notes` + `matchScore`, `contact_logs.note`,
   `placement_comments` with `visibility='internal'`, and all `decisionNotes`/`identityNotes` fields. These are
   internal-only and must be stripped from any art. 15 access package.
3. **Never export security/audit internals.** `passwordHash`, `totpSecretEncrypted`, `calendarTokenSecret`,
   `auth_accounts` tokens, `user_recovery_codes`, `recovery_intents`, `rate_limits`, `integration_connections.configEncrypted`.
   These are credentials/defences, not personal data the subject is entitled to receive.
4. **For linked/relationship rows, include own context only and redact unrelated people.**
   - `audit_log` → filter to `userId` = subject; redact other actors' ids and unrelated `before`/`after` snapshots.
   - `placement_comments` → filter by `visibility` to what the subject may see; never reveal other actors' internal scope.
   - `email_messages` → only rows where `toEmail` = the subject's address; never expose other recipients.
   - `integration_outbox` → never the raw payload (holds client billing).
   - `ratings` → a rating links chef ↔ klant; reveal only the requester's own side, never the counterparty's identity or raw negative comment.
   - `payroll_batch_lines` / `shift_hours` → expose only the requester's own pay side; strip the klant-charge/margin columns and internal approver identities.
   - `client_contacts` → one contact's DSAR returns *their* row only; redact colleagues at the same klant.
5. **Special-category caution.** `chef_documents` of `type='id_document'` (passport/ID) is highly sensitive.
   It IS the chef's own data and is exportable to them via presigned URL, but log access and apply
   identity-verification gates before release.
6. **Legal hold trumps erasure.** When an art. 17 erasure request lands, retain every row tied to payroll/hours/
   invoicing administration (`shift_hours`, `payroll_batches`, `payroll_batch_lines`, `shift_hour_corrections`,
   plus the administration-linked identifiers on `chefs`/`clients`/`external_refs`) for the full ~7-year
   `bewaarplicht`. Anonymise/soft-delete everything else and record the partial fulfilment + retained-scope
   reasoning on the `privacy_requests` row.

## Erasure mechanics

- Tables with a `deletedAt` column support **anonymise-in-place / soft-delete**: `chefs`, `clients`,
  `chef_documents`. For these, erasure = null the PII columns + set `deletedAt` (preserves FK integrity for
  retained financial rows) and queue the R2 object purge (`chef_documents`).
- Tables without `deletedAt` that are **not** under legal hold can be hard-deleted on cascade when the parent
  `users`/`chefs`/`clients` row is removed (most `onDelete: "cascade"` children: `notifications`,
  `chef_availability`, `consent_log` — note consent is retained for proof, so suppress rather than delete).
- The **`privacy_erasure_tombstones`** table (shipped PR-AVG-2, migration 0026) records a hashed,
  non-reversible marker (HMAC of the lower-cased email via `RATE_LIMIT_HASH_SECRET`) of each erased
  subject so a re-submission of the same source data is not silently re-imported (`findTombstoneByEmail`),
  to prove the erasure happened (`retained_entities_summary`), and to survive backup restore
  (`scripts/replay-erasure-tombstones.mjs`, PR-AVG-3). The erasure scope is also written to
  `privacy_requests.decisionNotes`.
- Erasure + export are implemented in `src/lib/domain/privacy-{export,erasure,subject}.ts`. The redaction
  allow-list above is enforced there and covered by `scripts/smoke-avg-erasure.mts` (30 assertions:
  own-data present + 5 third-party fixtures excluded + legal-hold preservation + tombstone).
