# Retention Matrix — chefandserve2.0

> **SOURCE OF TRUTH** for how long each entity is kept (`bewaartermijn`) and why.
> Drives the retention worker and the erasure-scope decision (which rows survive an art. 17 request).
>
> This document mirrors the shape of the **`retention_policies`** table in `src/lib/db/schema.ts`:
>
> ```ts
> retentionPolicies = pgTable("retention_policies", {
>   entityType:      text("entity_type").primaryKey(),   // e.g. "shift_hours"
>   retentionPeriod: text("retention_period").notNull(), // Postgres interval, e.g. "7 years"
>   legalBasis:      text("legal_basis").notNull(),
>   description:     text("description"),
> })
> ```
>
> Each row below maps to one `entity_type` row to seed. `retention_period` values are written as
> **Postgres interval strings** (`'7 years'`, `'90 days'`) so they drop straight into the column.

## Principles

- **Fiscale bewaarplicht (legal hold):** payroll, hours and invoicing administration must be kept
  **7 years** (Belastingdienst). Some property/onroerend-goed records run **10 years** — n/a for current
  schema but noted for completeness. These rows are **NOT erasable** on a data-subject request.
- **Beginsel van opslagbeperking (storage limitation, art. 5(1)(e)):** everything else is kept
  **"niet langer dan noodzakelijk"** — operational data is purged once it no longer serves the purpose.
- **Toestemming/verantwoording (consent + accountability, art. 7(1) / 5(2)):** consent records are kept as
  long as the consent relationship exists **plus a reasonable proof window** after withdrawal.
- **Beveiliging/verantwoording (security + accountability):** `audit_log` is kept for a security/accountability
  window even though it references data subjects.
- **Soft-deleted records** (`chefs`/`clients`/`chef_documents` with `deletedAt`) are anonymised on exit and
  the row is **purged after its retention window** — but only after confirming no legal hold attaches.

## Legend

| Mark | Meaning |
|------|---------|
| **HOLD (7y)** | Fiscale bewaarplicht — legal hold, NOT erasable on request |
| **Consent** | Kept for the consent relationship + proof window |
| **Security** | Kept for accountability/security, then purged |
| **Discretionary** | "No longer than necessary" — operator sets the clock to the shortest defensible window |

---

## Matrix

| entity_type | retention period | legal basis | what triggers the clock | notes |
|-------------|------------------|-------------|--------------------------|-------|
| `shift_hours` | `'7 years'` | **HOLD (7y)** — fiscale bewaarplicht (payroll/loonadministratie) | End of the boekjaar in which the hours were `exported` (or `admin_approved`) | Trust-chain backbone. Read-only after approval. **Never erase on request** — anonymise the linked chef instead, keep the financial row. |
| `payroll_batches` | `'7 years'` | **HOLD (7y)** — fiscale bewaarplicht (loon/facturatie) | End of the boekjaar of `exportedAt` | Aggregated payroll export. Legal hold. |
| `payroll_batch_lines` | `'7 years'` | **HOLD (7y)** — fiscale bewaarplicht | Follows parent `payroll_batches` | Per-chef/per-klant amounts. Legal hold. |
| `shift_hour_corrections` | `'7 years'` | **HOLD (7y)** — fiscale bewaarplicht | End of the boekjaar of the correction's `approvedAt`/export | Financial correction trail. Legal hold. |
| `external_refs` | `'7 years'` | **HOLD (7y)** when mapping payroll/accounting ids | Follows the external payroll/accounting record | Maps our id ↔ Payingit/accounting id; keep while the external administration record must exist. |
| `data_processing_agreements` | `'7 years'` | **HOLD (7y)** — contractual + accountability | `acceptedAt` (or contract end) | Signed DPA per klant. Keep for the statutory/contract window. |
| `clients` (administration-linked identifiers) | `'7 years'` | **HOLD (7y)** — invoicing administration (`kvk`, `btw`, billing address/email) | Last invoice / boekjaar in which the klant was billed | On erasure, anonymise the *contact person* (name/email/phone) but **retain** the company/billing identifiers that are part of facturatie. |
| `chefs` (administration-linked) | `'7 years'` if payroll history exists, else `'discretionary'` | **HOLD (7y)** for the parts feeding `shift_hours`/payroll; otherwise storage limitation | Last shift worked / boekjaar of last payment | If a chef ever had paid hours → retain the payroll-linked identity stub for 7y; soft-delete + anonymise the rest. A never-placed chef is fully erasable. |
| `chef_documents` | `'7 years'` if payroll/identity evidence, else `'2 years'` after exit | **HOLD (7y)** for id/payroll evidence; otherwise storage limitation | `expiresAt`, chef exit (`deletedAt`), or end of working relationship | Soft-delete row + purge R2 bytes when window passes. `id_document`/payroll-relevant docs follow the 7y hold; CVs/photos are discretionary. |
| `consent_log` | `'consent relationship + 3 years'` | **Consent** — art. 7(1) accountability | `acceptedAt`; proof window starts at consent withdrawal / account closure | Append-only. Keep proof of *what* was consented and *when* for a reasonable window after the relationship ends. |
| `privacy_requests` + `privacy_request_messages` | `'3 years'` after closure | **Accountability** — proof the right was honoured | Request `status` reaches `fulfilled`/`rejected`/`withdrawn` | Keep the compliance record (and inbound/outbound correspondence) to demonstrate handling. Internal-note rows are staff-only. |
| `audit_log` | `'2 years'` | **Security** + accountability | Row `createdAt` | Retained for forensics/accountability; references actor + subject ids. Pruned by retention worker after the window. |
| `error_log` | `'90 days'` | **Security** / ops (storage limitation) | Row `createdAt` (or `resolvedAt`) | Diagnostics only. Stacks/context may incidentally hold PII → short window. |
| `webhooks_received` | `'90 days'` | Discretionary — replay/forensics | Row `createdAt` / `processedAt` | Raw third-party payloads. Purge once the replay window passes; never export. |
| `email_messages` | `'2 years'` (admin/invoicing notices) / `'90 days'` (transactional) | Discretionary; **HOLD (7y)** if the mail *is* an invoice/payroll notice | `createdAt` / `lastEventAt` | Keep delivery records long enough for disputes; a mail that constitutes part of the administration follows the 7y hold. |
| `email_events` | `'90 days'` | Discretionary — delivery debugging | Follows parent `email_messages` (cascade) | Raw Resend webhook events. Short window. |
| `notifications` | `'1 year'` | Discretionary — storage limitation | `createdAt` (or `readAt`) | In-app inbox. Purge old read notifications; cascade on user delete. |
| `chef_submissions` | `'2 years'` if not converted; else follows `chefs` | Discretionary; **HOLD (7y)** once converted & payroll-linked | `status` reaches `rejected`/`duplicate`, else `createdAt` | Raw `rawPayload` purged with the row. A converted submission's retention follows the chef. |
| `client_submissions` | `'2 years'` if not converted; else follows `clients` | Discretionary; **HOLD (7y)** once converted & billed | `status` reaches `rejected`/`duplicate`/`cancelled_by_client`, else `createdAt` | As above for klanten. |
| `placement_comments` | `'2 years'` | Discretionary — operational, dispute window | `createdAt` | Visibility-scoped. `internal` comments stay internal; purge after the operational/dispute window. |
| `contact_logs` | `'2 years'` | Discretionary — operational memory | `createdAt` | Maarten's call/WhatsApp outcomes. Internal; short window. |
| `client_contacts` | follows parent `clients` | Discretionary — contact directory | Client `deletedAt` / contact removal | Anonymise/remove a contact on request unless tied to retained administration. |
| `placements` | `'7 years'` if tied to logged hours, else `'2 years'` | **HOLD (7y)** when invoiced; else storage limitation | Shift completion / last linked `shift_hours` | A placement that produced paid hours is part of the administration; an unfilled/cancelled one is discretionary. |
| `shifts` | `'7 years'` if invoiced, else `'2 years'` | **HOLD (7y)** when billed; else storage limitation | `cancelledAt` / shift end / last invoice | Billed shifts follow the administration hold; un-actioned requests are discretionary. |
| `chef_availability` | `'1 year'` | Discretionary — operational | `date` in the past | Calendar history; purge stale rows; cascade on chef delete. |
| `shift_templates` + `shift_template_exceptions` | `'2 years'` after `active=false` | Discretionary — operational | Template deactivation / `lastGeneratedAt` | Recurring patterns; purge after deactivation window. |
| `client_change_requests` / `client_shift_change_requests` / `profile_change_requests` | `'7 years'` if it documents a billing/rate change, else `'2 years'` | **HOLD (7y)** for finance/rate history; else storage limitation | Request decided (`decidedAt`) | A request that changed a rate or billing field is administration evidence; cosmetic ones are discretionary. |
| `ratings` | `'2 years'` (free-text) / aggregate kept | Discretionary — matching signal | `createdAt` | Erase free-text `comment` on request; numeric signal may persist as anonymised aggregate. Internal-only feature. |
| `rate_limits` | `'7 days'` | Security — abuse prevention (storage limitation) | `updatedAt` (last hit) | Hashed keys only. Worker prunes cold rows. |
| `recovery_intents` / `auth_verification_tokens` | `'15 minutes'` (expiry) | Security — single-use credentials | `createdAt` / `consumedAt` | Expire/consume; no PII export. |
| `backup_runs` / `restore_drills` | `'2 years'` | Ops record-keeping | `createdAt` | Operator truth; checksums/paths only, no PII. |
| `integration_runs` | `'1 year'` | Ops / forensics | `createdAt` | Export-run history; ops data. |
| `integration_outbox` | `'90 days'` after `sent`/`failed` resolution | Discretionary; **HOLD (7y)** if it is the only record of an exported payroll/billing event | `sentAt` / resolution | Payloads carry billing/payroll; if the canonical row also exists, purge after the forensics window. |

> **Note on entity_types not listed:** auth/config/RBAC tables (`users` credentials, `auth_accounts`,
> `auth_sessions`, `roles`, `permissions`, `role_permissions`, `user_roles`, `notification_routes`,
> `notification_prefs`, `integration_connections`, `user_recovery_codes`, `retention_policies` itself) are
> system/credential data, not data-subject retention targets — they live and die with the account/config and
> need no fiscal retention row. They are intentionally omitted from the `retention_policies` seed.

## Quick split: legal-hold vs discretionary

- **Legal hold (7y, NOT erasable on request):** `shift_hours`, `payroll_batches`, `payroll_batch_lines`,
  `shift_hour_corrections`, payroll/billing-linked `external_refs`, `data_processing_agreements`,
  administration-linked identifiers on `clients` and `chefs`, billed `shifts`/`placements`, and any
  `*_change_request` that records a finance/rate change.
- **Consent/accountability:** `consent_log` (relationship + proof window), `privacy_requests` +
  `privacy_request_messages` (proof window), `audit_log` (security window).
- **Discretionary ("no longer than necessary"):** everything else — submissions (pre-conversion),
  `placement_comments`, `contact_logs`, `notifications`, `chef_availability`, templates, `ratings` free-text,
  diagnostics/webhooks/email events, and short-lived security tokens.
