# Source-of-Truth Map

> For every fact the AI might surface, this doc says: **which table holds it · who can mutate it · how stale can it be · what the AI is allowed to read or say about it**. The AI must never invent a fact not present here.

This is the grounding contract for Layer 1 (per `../../AI_INTEGRATION.md`). The AI quotes from these rows; nothing else.

---

## How to read each row

- **Fact** — the user-visible concept ("chef's hourly rate", "shift status", "klant's billing email").
- **Canonical table** — the single Drizzle table that owns the source of truth. If a fact appears in two tables, one is canonical and the other is a denormalised cache.
- **Who can change it** — RBAC + workflow gate (e.g. "chef requests, admin approves").
- **Freshness budget** — how stale a cached/derived copy may be before the AI must refetch.
- **AI access** — `read` / `read_filtered` / `restricted` / `never`. See `rag-source-catalog.md` for definitions.
- **AI may say** / **may NOT say** — concrete examples to keep the model honest.

---

## Identity facts

### Chef name, email, phone

| | |
|---|---|
| Canonical table | `chefs` (`fullName`, `email`, `phone`) |
| Who can change | Chef (via `profile.draft_change_request` — admin approval required for email; phone is direct) · Admin (`owner`+) |
| Freshness budget | live |
| AI access | `read_filtered` — visible only to that chef themselves and to admins. Klanten see the chef's name only when there's an active placement linking them. |
| AI may say | "Je naam is Daniel Pulitzer." (to the chef) · "Je sous chef voor 12 juni is Daniel." (to the linked klant) |
| AI may NOT say | "Daniel's telefoonnummer is +31 ..." to a non-admin without a current placement bridge. |

### Klant company, contact, billing email

| | |
|---|---|
| Canonical table | `clients` (`companyName`, `contactName`, `email`, `billingEmail`, `kvk`, `btw`) |
| Who can change | Klant (own profile via `profile.draft_change_request` — admin approval for billing-impacting fields) · Admin (`owner`+) |
| Freshness budget | live |
| AI access | `read_filtered` — klant sees own. Chef sees only `companyName` + `city` of clients they're placed at. Admins see all. |
| AI may say | "Je facturen worden gestuurd naar billing@hotel.nl." (to that klant) · "Je werkt 12 juni bij Hotel Pulitzer Amsterdam." (to the assigned chef) |
| AI may NOT say | KvK number or btw to a non-admin chef. |

### BSN, IBAN, identity documents

| | |
|---|---|
| Canonical table | NOT in app DB. BSN stays in Payingit. IBAN is in Payingit. ID documents are stored in R2 with metadata in `chefDocuments` (bytes are not in DB). |
| Who can change | Chef (uploads ID document — admin verifies via `documents.verify`). BSN/IBAN only via Payingit's flow, not via this app. |
| Freshness budget | n/a |
| AI access | `never` for BSN/IBAN/document-bytes. `restricted` for document METADATA (type, uploadedAt, verifiedAt). |
| AI may say | "Je VOG-document is geverifieerd op 1 mei 2026 en is geldig tot 1 mei 2031." |
| AI may NOT say | BSN, IBAN, account holder name, anything from inside the PDF bytes. Even to the document owner — the AI shouldn't OCR identity docs. |

---

## Availability + status facts

### Chef availability (blocked dates)

| | |
|---|---|
| Canonical table | `chefAvailability` (one row per blocked date; absence = available) |
| Who can change | Chef themselves only (via `/chef/availability`) |
| Freshness budget | live |
| AI access | `read_filtered` — chef sees own; admin sees all. Klant never sees raw availability. |
| AI may say | "Je hebt 12 t/m 15 juni geblokkeerd." (to chef) · "Sophie is op 14 juni niet beschikbaar." (to admin only) |
| AI may NOT say | "Daniel is op 12 juni vrij — wil je hem voorstellen?" to a klant. The chef must be proposed by Maarten, not exposed via availability scan. |

### Chef lifecycle status

| | |
|---|---|
| Canonical table | `chefs.status` (`onboarding` · `active` · `paused` · `inactive` · `archived`) |
| Who can change | Admin (`owner`+) |
| Freshness budget | live |
| AI access | `read_filtered` — admin sees raw; chef sees own (human-labelled); klant never sees other chefs' status. |
| AI may say | "Je staat momenteel op 'onboarding' — Maarten is nog bezig met je intake." |
| AI may NOT say | Status of other chefs to non-admins. Raw enum strings to anyone — use `humanStatus()` mapping. |

### Klant lifecycle status

| | |
|---|---|
| Canonical table | `clients.status` (`prospect` · `active` · `paused` · `archived`) |
| Who can change | Admin (`owner`+) |
| Freshness budget | live |
| AI access | `read_filtered` — same pattern as chef status. |

---

## Shift + placement facts

### Shift status

| | |
|---|---|
| Canonical table | `shifts.status` (`request` · `open` · `filled` · `completed` · `cancelled`) |
| Who can change | Admin via `setShiftStatus`; some transitions are automatic (completed via cron). |
| Freshness budget | live |
| AI access | `read_filtered` — klant sees own shifts; chef sees shifts they're placed on; admin sees all. |
| AI may say | "Je dienst van 12 juni is bevestigd." (using human label) |
| AI may NOT say | Raw enum (`'confirmed'`) — must use Dutch label from `src/lib/hours-labels.ts`. |

### Placement status (the chef ↔ shift link)

| | |
|---|---|
| Canonical table | `placements.status` (`proposed` · `accepted` · `rejected` · `confirmed` · `cancelled` · `no_show` · `completed`) |
| Who can change | Each transition has its own server action (see `tool-contracts/shift-tools.md`). All require auth + ownership/role check. |
| Freshness budget | live |
| AI access | `read_filtered` — chef sees own placements; klant sees placements at their shifts; admin sees all. |
| AI may say | "Voorstel verstuurd op 6 juni, geaccepteerd op 7 juni, bevestigd op 8 juni." (human-friendly timeline) |
| AI may NOT say | Invent a placement that doesn't exist. Suggest a placement that hasn't actually been proposed. |

### Match score (Phase 9 onward)

| | |
|---|---|
| Canonical table | `placements.matchScore` (0-100, integer; null if not scored) |
| Who can change | Internal heuristic at proposal time; later AI itself (audited under `ai.shifts.score_placement`). |
| Freshness budget | snapshot at proposal time — does NOT recompute |
| AI access | `read_filtered` — admin only. |
| AI may say | "Match-score op het moment van voorstel was 92." |
| AI may NOT say | Present matchScore as if it were a live recomputation; or to a chef. |

### Shift location (snapshotted)

| | |
|---|---|
| Canonical table | `shifts.location`, `shifts.city` — **snapshotted at shift creation** from `clients.shiftAddress` / `clients.city`. |
| Who can change | System at creation (and the recurring-shift worker copies `clients.shiftAddress → shifts.location`). NOT retroactively changed by a klant profile edit. |
| Freshness budget | immutable per shift once created |
| AI access | `read_filtered` — klant sees own; chef sees shifts they're placed on; admin all. |
| AI may say | "De chef meldt zich op {shifts.location}." (the snapshot for that shift) |
| AI may NOT say | That an existing shift's location changed because the klant edited `clients.shiftAddress` — profile edits affect only FUTURE requests/templates. |

### Placement comments (the multi-actor comment store)

| | |
|---|---|
| Canonical table | `placement_comments` (`author_kind`, `visibility` enum `internal`/`client_visible`/`chef_visible`, `body` 1–1000 chars plain text). **This is the canonical store — NOT `placements.notes`.** |
| Who can change | Append-only: klant (`client_visible`), admin (any visibility), chef where admin shared (`chef_visible`). Via `addPlacementComment()`; reads via `listVisibleComments()`. |
| Freshness budget | live |
| AI access | `read_filtered` by visibility — klant sees `client_visible`; chef sees `chef_visible`; admin sees all. `placements.notes` is `restricted` (admin tool only) and NEVER surfaced to klant/chef. |
| AI may say | "Je vroeg op 6 juni of Daniel HACCP heeft; Chef & Serve antwoordde ..." (from `client_visible` rows) |
| AI may NOT say | Quote an `internal` or `chef_visible` comment to a klant. Read `placements.notes` for a klant-facing answer. |

---

## Klant control facts (PR-KLANT-0 / PR-KLANT-1)

### Payment term

| | |
|---|---|
| Canonical table | `clients.paymentTermsDays` |
| Who can change | **Admin-controlled.** The klant *requests* a change (`client_change_requests`, `field='paymentTermsDays'`); an admin approves. The klant can NEVER set it directly. |
| Freshness budget | live |
| AI access | `restricted` — admin + own klant (read). |
| AI may say | "Je betaaltermijn is 14 dagen." (to that klant) · "Hotel X heeft een wijziging naar 60 dagen aangevraagd, wacht op akkoord." (admin) |
| AI may NOT say | "Ik heb je betaaltermijn op 60 gezet." The AI never mutates it; it drafts a request, an admin approves. |

### Klant profile field authority (direct vs. request-change)

| | |
|---|---|
| Canonical table | `clients` — direct: `contactName`, `phone`, `billingEmail`, `shiftAddress`, `shiftArrivalNotes`, `city`. Request-change: `companyName`, `kvk`, `btw`, `email`, `paymentTermsDays`, `billingAddress`. |
| Who can change | Direct fields: klant immediately (audited, outbox `client.updated`). Request-change fields: klant requests, admin approves (`client_change_requests`). |
| Freshness budget | live |
| AI access | `read_filtered` — klant own; admin all. |
| AI may say | "Telefoon kun je direct wijzigen; bedrijfsnaam gaat via een verzoek." |
| AI may NOT say | Offer to directly edit a request-change field. Change `billingEmail` without noting the OLD-address confirmation safeguard. |

---

## Hours + payroll facts (planned, PR-CHEF-1, PR-CHEF-7)

### Shift hours lifecycle

| | |
|---|---|
| Canonical table | `shift_hours` (`status` enum: `draft` · `submitted` · `client_signed` · `client_rejected` · `admin_approved` · `admin_rejected` · `exported` · `void`) |
| Who can change | Each transition is gated. Chef can `submit` from `draft`. Klant can `client_sign` or `client_reject` from `submitted`. Admin can `admin_approve` or `admin_reject` from `client_signed`. Exporter cron moves `admin_approved` → `exported`. **Append-only after `exported`** — only `shift_hour_corrections` mutations. |
| Freshness budget | live |
| AI access | `read_filtered` — chef sees own; klant sees own; admin sees all. |
| AI may say | "Je uren van 8 juni zijn 'goedgekeurd door admin' sinds 14 juni 09:21." |
| AI may NOT say | "Je bent al betaald" — the AI cannot infer Payingit-side delivery status from app DB alone. Use `email_events` if available, otherwise stop at `exported`. |

### Payroll batch

| | |
|---|---|
| Canonical table | `payroll_batches` (`status`: `draft` · `exported` · `voided`), with rows in `payroll_batch_lines`. |
| Who can change | Admin (`owner`+). Export operation: atomic write to R2, then UPDATE statuses. |
| Freshness budget | live |
| AI access | `restricted` — admin-only. |
| AI may say | "Batch mei-2026 is geëxporteerd op 28 mei, 47 regels, totaal €12.345,67." |
| AI may NOT say | Per-chef bank-side details. Initiate a batch creation autonomously. |

### Corrections after export

| | |
|---|---|
| Canonical table | `shift_hour_corrections` (`status`: `pending` · `approved` · `rejected`) |
| Who can change | Admin creates; a different admin approves (two-eye principle, enforced in `approveCorrection`). |
| Freshness budget | live |
| AI access | `restricted` — admin-only. Two-eye principle means the SAME admin who created cannot approve. |
| AI may say | "Er staat een correctie open van Lisa voor Daniel, 8 juni, +0,5 uur. Wacht op een tweede admin." |
| AI may NOT say | Approve a correction on behalf of an admin. Even with confirmation, the AI cannot bypass two-eye. |

---

## Communications facts

### Email messages

| | |
|---|---|
| Canonical table | `email_messages` (every send) + `email_events` (Resend webhook updates). PR-CHEF-0 + PR-CHEF-8. |
| Who can change | System (write on send) · Resend webhook (status updates). Never user-mutable. |
| Freshness budget | up to 24h (Resend retries) |
| AI access | `read_filtered` — sender + recipient + admin can see metadata; bodies kept short-term then pruned per retention policy. |
| AI may say | "De herinneringsmail naar Daniel is 'delivered' op 8 juni 09:15." |
| AI may NOT say | Quote a chef's email body to a klant or vice versa. Re-send an email autonomously. |

### In-app notifications

| | |
|---|---|
| Canonical table | `notifications` (PR-CHEF-0) — userId, type, title, body, actionUrl, readAt. |
| Who can change | System (create) · the recipient (mark read). |
| Freshness budget | live |
| AI access | `read_filtered` — recipient only (admins see all). |
| AI may say | "Je hebt 3 ongelezen notificaties." |
| AI may NOT say | Read another user's notifications. Mark someone else's notifications as read. |

### Contact logs (PR-CHEF-5)

| | |
|---|---|
| Canonical table | `contact_logs` — who called whom about which shift, when, optional notes. |
| Who can change | Admin (`owner`+). |
| Freshness budget | live |
| AI access | `restricted` — admin-only. |
| AI may say | "Maarten heeft Daniel gebeld op 14 juni 14:30 over de annulering." |
| AI may NOT say | Insert a contact log retroactively. |

---

## Auth + identity-mutation facts

### Password

| | |
|---|---|
| Canonical table | `users.passwordHash` (bcrypt) |
| Who can change | User themselves via `/recover/password` or `/admin/account/setup/password`. Admin CANNOT directly reset; admin can only trigger Recovery email via existing flow. |
| Freshness budget | live |
| AI access | `never` (no read of hash). The fact "user has password" (`passwordHash IS NOT NULL`) is `restricted` to admin. |
| AI may say | "Je hebt een wachtwoord ingesteld." |
| AI may NOT say | The hash. The plaintext (impossible). "Reset Maarten's password" — never. |

### TOTP enrollment

| | |
|---|---|
| Canonical table | `users.totpEnabled`, `users.totpSecretEncrypted` (AES-256-GCM), `users.totpEnrolledAt`, `userRecoveryCodes` |
| Who can change | User themselves via wizard. `super_admin` may RESET (wipe + force re-enroll) via `resetInternalUser2FA`. |
| Freshness budget | live |
| AI access | `never` (no read of secret). `totpEnabled` boolean and `totpEnrolledAt` are `restricted` to admin. |
| AI may say | "Je 2FA is actief sinds 12 maart 2026." |
| AI may NOT say | The secret. Decrypt anything. Invoke the reset endpoint without explicit super_admin confirmation. |

### Recovery intents

| | |
|---|---|
| Canonical table | `recoveryIntents` (purpose-bound, single-use, 15-min TTL) |
| Who can change | System (create on request) · system (consume on use). Never user-mutable directly. |
| Freshness budget | live |
| AI access | `never` (these are short-lived secrets). |

---

## RBAC facts

### Roles + permissions

| | |
|---|---|
| Canonical table | `roles`, `permissions`, `rolePermissions`, `userRoles` |
| Who can change | Schema-level seeds + `super_admin` UI (when shipped). |
| Freshness budget | live |
| AI access | `read_filtered` — user can see their own roles. Admin can see all. |
| AI may say | "Je hebt de rollen: super_admin, owner." (to that user) |
| AI may NOT say | Modify role assignments. Even on confirmation; this requires direct super_admin UI action. |

---

## Audit + observability facts

### Audit log

| | |
|---|---|
| Canonical table | `auditLog` — append-only at DB level. |
| Who can change | System (auto-write on every mutation via `withAudit()` wrapper). Never user-mutable. |
| Freshness budget | live |
| AI access | `read_filtered` — admin sees all; users see only their own actions. |
| AI may say | "Lisa heeft op 14 juni Daniel's uren goedgekeurd." (admin context) |
| AI may NOT say | Insert or delete audit rows. Quote audit payloads that contain other users' identifiers to a non-admin. |

### Error log

| | |
|---|---|
| Canonical table | `errorLog` |
| Who can change | System (auto-write). Admin can mark resolved. |
| Freshness budget | live |
| AI access | `restricted` — admin-only. |

### Webhooks received

| | |
|---|---|
| Canonical table | `webhooksReceived` |
| Who can change | System. |
| Freshness budget | live |
| AI access | `restricted` — admin-only. |

---

## AVG / consent facts (PR-CHEF-10)

### Consent log

| | |
|---|---|
| Canonical table | `consent_log` (userId, documentKey, version, acceptedAt, ip, userAgent) |
| Who can change | User themselves only (server action `acceptConsent`). **Never delegable**, never admin-modifiable. |
| Freshness budget | live |
| AI access | `read_filtered` — user sees own; admin sees aggregate counts (anonymisable). |
| AI may say | "Je hebt het Gegevensgebruik-document v1 geaccepteerd op 1 mei 2026." |
| AI may NOT say | Accept consent on the user's behalf — FORBIDDEN under any circumstances. See `ai-safety-rules.md`. |

### Privacy requests

| | |
|---|---|
| Canonical table | `privacy_requests` (`status`: `pending` · `fulfilled` · `rejected`), with 30-day SLA. |
| Who can change | User creates; `super_admin` only fulfils/rejects. |
| Freshness budget | live |
| AI access | `restricted` — own user + super_admin. |
| AI may say | "Je inzage-verzoek van 1 mei is in behandeling, deadline 31 mei." |
| AI may NOT say | Fulfill the request autonomously. Quote uploaded response PDFs to other users. |

---

## Integration outbox facts (PR-CHEF-0)

### Outbox row

| | |
|---|---|
| Canonical table | `integration_outbox` (idempotency key on `(eventType, entityId, action)`). |
| Who can change | System (enqueue on every mutation that should fire externally). Admin can manually retry a failed row. |
| Freshness budget | live |
| AI access | `restricted` — admin-only. |
| AI may say | "Outbox heeft 3 mislukte rijen — allemaal `payroll_batch.exported`. Laatste poging: 5 minuten geleden." |
| AI may NOT say | Mutate `external_refs` rows. Skip the idempotency check. Initiate a manual retry without admin confirmation. |

---

## Derived / read-model views (proposed shapes)

These views don't exist as SQL yet — they're documented here so AI tools can be written against a stable contract.

### `ai_hours_queue_view`

One row per shift_hours, joined with chef + klant + shift, presenting only fields safe to surface to the asking actor.

```
shiftHoursId          uuid
humanStatus           text   -- via humanStatus() mapping
nextActor             enum   -- chef · klant · admin · system
overdueDays           int    -- 0 if not overdue
chefName              text
clientName            text
shiftDate             date
workedMinutes         int
expectedChefAmount    int    -- cents
expectedClientAmount  int    -- cents
anomalyFlags          text[] -- ["scheduleDeviation", "rateOverride"]
allowedActions        text[] -- whitelist per asking actor's role
```

Owner: PR-CHEF-1 should ship the SQL view; until then, tools synthesise from base tables.

### `ai_shift_context_view`

```
shiftId               text
clientCompanyName     text
location              text
startsAt              timestamptz
endsAt                timestamptz
requiredRole          vakniveau
assignedChefs         jsonb  -- [{chefId, name, placementStatus}]
missingConfirmations  text[] -- e.g. ['chef_unread_proposal']
timeline              jsonb  -- ordered events: proposed → accepted → confirmed
```

### `ai_user_action_feed_view`

The "wat moet ik nu doen?" feed.

```
userId                text
role                  enum   -- chef · klant · admin
actionType            text   -- e.g. 'submit_hours', 'sign_hours', 'approve_hours'
title                 text   -- Dutch
description           text
actionUrl             text
priority              enum   -- urgent · normal · info
dueAt                 timestamptz
```

### `ai_integration_health_view`

```
provider              text   -- payroll · accounting · calendar · email
status                enum   -- ok · degraded · failing
failedRuns            int    -- last 24h
lastSuccessAt         timestamptz
nextAction            text   -- 'retry', 'rotate_credentials', 'contact_vendor'
```

### `ai_document_risk_view`

```
chefId                text
documentType          chef_document_type
status                enum   -- needs_review · verified · rejected · expired
expiresAt             timestamptz
daysToExpiry          int    -- negative if expired
clientVisible         boolean
```

---

## Domain intelligence modules (derived facts + helpers)

These `src/lib/domain/*` (and `src/lib/*`) modules compute DERIVED facts from the
canonical tables above. The AI reads their OUTPUT (it never re-derives the logic
itself). All are read-only unless noted; RBAC = the calling surface's role.

| Module (`src/lib/...`) | Computes | AI access |
|---|---|---|
| `domain/roster-format` | Roster row formatting + bezetting / onderbezet labels for the cockpit | read |
| `domain/staffing-intelligence` | Candidate ranking + "waarom (niet) nr 1?" explanation for a shift | read (admin/owner) |
| `domain/chef-history` | A chef's placement history, top segments, top klanttype | read_filtered |
| `domain/profile-completeness` | `getProfileCompleteness` — % complete + missing fields (chef/client) | read_filtered |
| `domain/client-taxonomy` | Client type / tags / favorite-blocked classification | read (admin/owner) |
| `domain/dashboard-intel` | Business cockpit attention ranking + delta rule | read (admin/owner) |
| `domain/system-intel` | System cockpit attention ranking + health rollup | read (super_admin) |
| `geo` | Postcode → lat/long, distance | read |
| `travel` | Travel-time / route estimation between chef + venue | read |
| `domain/profile-data-requests` | Admin-initiated "fill in your data" requests (chef/client) | read + assisted_execute (admin) |
| `domain/user-settings` | Per-user settings (notification prefs, etc.) | read + assisted_execute (own/admin) |
| `domain/impersonation` | Bekijk-als start/stop/overlay + `assertImpersonationAllowed` guard | read-only for AI (never sets impersonation) |
| `lib/impersonation-denylist` | Pure path/method destructive denylist used by middleware | read (informs PA what is blocked) |
| `lib/audit` | `recordAuditCore` / `recordAuditFromRequest` — canonical audit writers | write (the PA logs through `recordAuditCore`) |

Tool surfaces wrapping these: `tool-contracts/matching-tools.md`,
`tool-contracts/cockpit-tools.md`, `tool-contracts/system-tools.md`,
`tool-contracts/client-taxonomy-tools.md`,
`tool-contracts/profile-data-request-tools.md`,
`tool-contracts/impersonation-tools.md`.

---

## How the AI uses this map

When a user asks "X", the AI:

1. Looks up the fact in this map.
2. Confirms the asking actor's role has `read` or `read_filtered` access.
3. Queries the canonical table (or read-model view).
4. Renders using human labels (`humanStatus()` for statuses, `nl-NL` formatting for numbers/dates).
5. Cites the row: "Bron: shift_hours #abc-123, ingediend op 8 juni 09:15."
6. If asked to mutate: checks `tool-contracts/<surface>.md` for the right tool and confirmation requirement.

**The AI's grounding rule:** if it can't find the fact in a row, it says so. It does not extrapolate from training data. The model knows about Wet DBA 2026, Payingit, the AVG only via what's in `rag-source-catalog.md` — not via its pretraining.
