# Forms, onboarding, reminders & the planner role

> The native replacement for Jotform chef intake. A two-stage funnel feeds the
> `chefs` record — the central KPI source — plus a form-builder, a configurable
> reminders engine, and a `planner` role. Shipped as PR-FB-0…5, PR-PLAN, PR-REM-1/2,
> PR-AVG, PR-KPI. Migration `0033_long_vision.sql`.

## The funnel (two stages)

```
Stage 1  /sollicitatie  (public, form chef-apply)  → chef_submissions (source 'native_apply')
              │  office triages in /admin/business/inbox → converts to a chef + invites to portal
Stage 2  /chef/onboarding (authenticated, form chef-onboarding) → chefs + chef_field_values + chef_documents
              │  → feeds KPIs (getOnboardingReadiness) + reminders + payroll
```

- **Stage 1** is short + fully admin-editable (all custom fields). It only creates a
  `chef_submissions` row — no sensitive PII. `src/lib/domain/applications.ts`.
- **Stage 2** is the full personal-data form (BSN, IBAN, ID, bank, uploads). It writes the
  chef record. `src/lib/domain/onboarding.ts`.

## Form-builder data model (`src/lib/db/schema.ts`)

- `forms` (slug, title, audience, status, version) — one row per form. Seeded: `chef-onboarding`,
  `chef-apply` (`src/lib/db/seed-forms.ts`, `npm run db:seed:forms`).
- `form_sections` (form_id, title, sort_order).
- `form_fields` (form_id, section_id, **kind** system|custom, **system_key**, type, key, label,
  required, is_visible, is_sensitive, options, validation, document_type).
- `chef_field_values` — EAV answers for **custom** fields, keyed unique on (chef_id, field_id),
  with typed columns (value_text/number/boolean/date/json + document_id + is_encrypted).

### Hybrid system vs custom (the key invariant)

- **System fields** (`kind='system'`, non-null `system_key`) bind to a typed `chefs`/`chef_documents`
  column via the code-owned registry `src/lib/forms/system-bindings.ts`
  (`SYSTEM_BINDINGS`). The builder may relabel/reorder/require/hide them but **cannot delete or
  retype** them — payroll + typed KPIs depend on them. Enforced server-side in the builder actions.
- **Custom fields** (`kind='custom'`) are fully admin-editable and store answers in `chef_field_values`.

### Field types

`text textarea email phone number date select multiselect checkbox boolean file iban bsn postcode country heading`.
Shared validators (BSN 11-proef, IBAN mod-97, NL postcode, …) live in `src/lib/forms/validation.ts`
and run **both** client- and server-side. File fields resolve to `chef_documents` rows (R2).

## Encryption (special-category PII)

`bsn_encrypted`, `iban_encrypted`, `id_number_encrypted` on `chefs` are **AES-256-GCM** ciphertext via
`src/lib/crypto.ts` (`encryptPii`/`decryptPii`, key `PII_ENCRYPTION_KEY`). Never plaintext in the DB,
never logged, never sent to the client (masked `•••• 1234` echo only). The cipher is the same one
`src/lib/totp.ts` uses (extracted to `crypto.ts`); each cipher binds to its own key via a static getter
so the env ref stays inlinable for the edge bundle.

## EAV → KPI contract

Custom-field answers are queryable without joining `form_fields` (denormalized `field_key` + index):

```sql
-- numeric aggregate over a custom field
SELECT avg(value_number) FROM chef_field_values WHERE field_key = 'years_michelin';
-- multiselect containment
SELECT chef_id FROM chef_field_values WHERE field_key = 'cuisines' AND value_json ? 'frans';
```

Sensitive custom fields (`is_encrypted=true`) are NOT KPI-queryable (ciphertext). `getOnboardingReadiness`
(`src/lib/domain/profile-completeness.ts`) scores payroll/identity readiness from the typed `chefs`
columns + document presence; surfaced on Chef 360 (`/admin/business/chefs/[id]`).

## Reminders engine (configurable)

- `reminder_rules` (trigger_type, lead_days, channel, recipients[], recipient_roles[],
  notify_subject_chef, params jsonb, enabled) + `reminder_sends` ledger (idempotency: unique
  (rule_id, chef_id, occurrence_key) + partial unique for null-chef).
- Triggers: `chef_birthday` (annual; Feb-29 → Feb-28 in common years), `id_document_expiry`,
  `certificate_expiry`, `chef_inactivity` (availability staleness), `custom_date` (reserved).
- Worker `workers/reminders.ts` (supervisor cron 06:30 Amsterdam) — dark-launched via
  `REMINDERS_ENABLED` (default off). Admin/planner CRUD at `/admin/business/reminders`.

## Planner role + gating

- Seeded role `planner` (`src/lib/db/seed.ts`): chefs + shifts/roster + forms + reminders; NOT
  clients-write / hours-approval / payroll / system.
- `requireAnyRole(["owner","planner"])` (`src/lib/permissions.ts`) gates chef/shift/roster/template/
  inbox/forms/reminders surfaces. Super_admins assign roles on `/admin/system/users/[id]` (bumps
  `permissionsVersion` so the JWT refreshes; refuses to remove the last super_admin).

## AVG / privacy

- Erasure (`privacy-erasure.ts`) nulls every new PII column + deletes `chef_field_values`; documents
  purged via the existing chef_documents flow.
- Export (`privacy-export.ts`) includes the subject's own onboarding data — the 3 encrypted fields
  **decrypted for the subject** (art. 20), EAV answers (sensitive decrypted) — never to third parties.
- Consent: Stage-2 submit records `gegevensgebruik_chef_v1` + `verwerking_bijzondere_gegevens_chef_v1`.
- Full map: `docs/privacy/pii-inventory.md` (§"PR-FB").

## Jotform decommission

- The chef apply CTA on `/work-with-us` now points to `/sollicitatie` (native). The
  `site.jotform.chef` constant is unused by our pages.
- The legacy webhook `POST /api/intake/chef` is left in place as a no-harm receiver (it only writes to
  `chef_submissions`, same inbox) so a still-configured Jotform integration never 404s. **To fully
  retire:** disable the chef form in the Jotform dashboard (or remove its webhook URL). The client
  intake (`site.jotform.client` / `/contact-us`) is intentionally still Jotform — out of scope here.

## Deploy checklist

1. Merge after the chef/klant/roster branches (migration numbering + `chef_events`).
2. `npm run db:migrate` (applies `0033`).
3. `npm run db:seed` (planner role + perms) · `npm run db:seed:forms` (both forms).
4. Set `PII_ENCRYPTION_KEY` (Vercel + Railway) — `openssl rand -base64 32`. Required before any chef
   submits onboarding (BSN/IBAN/ID encryption).
5. Assign the `planner` role to office staff on `/admin/system/users/[id]`.
6. Verify a birthday rule on `/admin/business/reminders`, then flip `REMINDERS_ENABLED=true` (Railway).
7. Disable the chef Jotform form once `/sollicitatie` is confirmed live.
