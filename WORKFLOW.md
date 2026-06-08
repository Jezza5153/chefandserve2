# Chef & Serve — WORKFLOW.md

> Process map. Every workflow, every API endpoint, every server action, every email, every cron — all in one place so we don't forget to link something later.
> Updated whenever a wiring changes (new action / new email / new outbox event / new cron).

**Companion to:** `MEMORY.md` (state) · `AI_INTEGRATION.md` (strategic AI brief) · `docs/ai/` (workflow playbooks)

---

## How to read this doc

- **WORKFLOW sections** — end-to-end user journeys (chef accepts shift, klant signs hours, etc.).
- **WIRING sections** — every server-callable endpoint and what triggers it.
- **EVENT MAP** — single table of every email + every notification + every outbox event with all its recipients and triggers.

---

# Part 1 — User-facing workflows

Each workflow lists: trigger, actors, route flow, state changes, side effects (emails / notifications / outbox / audit). Backend statuses use raw names here for technical accuracy — UI maps them via `humanStatus()`.

## 1.1 — Chef onboarding (Jotform → portal access)

```
┌──────────────────────────────────────────────────────────────────┐
│ TRIGGER: Chef submits Jotform                                     │
└──────────────────────────────────────────────────────────────────┘
   ↓
   POST /api/intake/chef  (webhook)
   ↓
   INSERT chef_submissions (status='new')
   ↓
   EMAIL: notification route 'chef_submission_received' → Maarten
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ ADMIN ACTION: Maarten reviews in /admin/business/inbox            │
└──────────────────────────────────────────────────────────────────┘
   ↓
   convertChefSubmission(submissionId)  →  src/lib/domain/conversions.ts
   ↓
   INSERT chefs (status='onboarding') · UPDATE chef_submissions.status='converted'
   AUDIT: 'chef_submissions.converted'
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ ADMIN ACTION: Maarten clicks "Activate portal" on chef detail     │
└──────────────────────────────────────────────────────────────────┘
   ↓
   inviteChefToPortal(chefId, actingUserId)  →  src/lib/domain/portal-invites.ts
   ↓
   INSERT users(kind='chef', status='invited') · UPDATE chefs.userId=fk
   ↓
   activatePortalUser(userId, actingUserId)
   ↓
   UPDATE users.status='active' · EMAIL: PortalInviteEmail(recipientKind='chef') → chef
   AUDIT: 'auth.portal_invited' + 'auth.portal_activated'
   ↓
   ┌─ Chef clicks link → /login → magic-link → /chef
```

## 1.2 — Internal staff onboarding (PR-A)

```
┌──────────────────────────────────────────────────────────────────┐
│ TRIGGER: super_admin opens /admin/system/users/new                │
└──────────────────────────────────────────────────────────────────┘
   ↓
   inviteStaff(formData)  →  src/app/(admin)/admin/system/users/new/page.tsx
   ↓
   requireRole("super_admin", { strict: true })
   ↓
   inviteInternalStaff({ email, name, role, actingUserId })  →  src/lib/domain/portal-invites.ts
   ↓
   INSERT users(kind='internal', status='active') · INSERT user_roles · EMAIL: PortalInviteEmail(internal)
   AUDIT: 'auth.internal_staff_invited'
   ↓
   ┌─ User clicks → /login → magic-link → /admin → middleware checks setup → /admin/account/setup
       Wizard: password → 2FA → recovery codes → /admin/business
```

## 1.3 — Internal staff 2FA reset by admin (PR-C0)

```
super_admin opens /admin/system/users/[id] → "Reset 2FA" section
   ↓
   reset2FA(formData)  →  /admin/system/users/[id]/page.tsx
   ↓
   requireRole("super_admin", { strict: true })
   ↓
   Confirms target email match
   ↓
   resetInternalUser2FA({ targetUserId, actingUserId })  →  src/lib/domain/auth-admin.ts
   ↓
   UPDATE users SET totp_secret_encrypted=null, totp_enabled=false,
                     totp_enrolled_at=null, permissions_version+=1
   DELETE user_recovery_codes WHERE user_id=target
   AUDIT: 'auth.totp_reset_by_admin'
   ↓
   ┌─ Target's next request → JWT permissionsVersion mismatch → /login
       Even old device cookies fail because enrolledAtMs no longer matches.
```

## 1.4 — Forgot password (PR-C)

```
/login → "Wachtwoord vergeten?" → /login/forgot-password
   ↓
   submit(formData) — email + Turnstile + rate-limit
   ↓
   requestRecovery({ email, intent: 'password', origin })  →  src/lib/domain/recovery.ts
   ↓
   IF internal + active + has_password + totp_enabled:
     createIntent(userId, 'password') → 64-char hex token, 15-min TTL
     EMAIL: RecoveryEmail(intent='password') → user
     AUDIT: 'auth.recovery_requested'
   ↓
   redirect /verify  (same UI for known/unknown — no enumeration)
   ↓
User clicks email link → /recover/password?token=…
   ↓
   peekIntent(token, 'password') — non-mutating check
   ↓
   Form: current TOTP code + new password (twice)
   ↓
   submit(formData) — validates TOTP, then password, THEN consumes intent atomically
   ↓
   UPDATE users SET password_hash=…, password_set_at=now(), permissions_version+=1
   AUDIT: 'auth.password_reset'
   ↓
   redirect /login?reset=password
```

## 1.5 — Lost 2FA (PR-C)

```
Similar to 1.4 but intent='totp'. Recovery page asks for a single recovery code.
On consume: UPDATE users SET totp_secret_encrypted=null, totp_enabled=false,
                              totp_enrolled_at=null, permissions_version+=1
            DELETE user_recovery_codes WHERE user_id AND used_at IS NULL
AUDIT: 'auth.totp_recovery_used'
Redirect /login?reset=2fa  →  user logs in via magic-link → middleware → setup-wizard step 2 (re-enroll)
```

## 1.6 — Shift proposal → chef accept → admin confirm (current)

```
ADMIN: matches chef to shift  →  proposePlacement(shiftId, chefId)  →  src/lib/domain/matching.ts
   ↓
   INSERT placements (status='proposed', proposedAt=now())
   EMAIL: ShiftProposedEmail → chef
   AUDIT: 'placements.proposed'
   ↓
CHEF: /chef shows pending proposal → /chef/shifts/[placementId] → respond({decision})
   ↓
   UPDATE placements SET status='accepted'/'rejected', respondedAt=now()
   AUDIT: 'placements.chef_accepted' or '.chef_rejected'
   ↓
ADMIN: /admin/business/shifts/[id] → setPlacementStatus(newStatus='confirmed')
   ↓
   UPDATE placements SET status='confirmed', confirmedAt=now()
   EMAIL: ShiftConfirmedClientEmail → klant
   AUDIT: 'placements.confirmed'
   ↓
   (Gap today: chef does NOT get confirmation email — fixed in PR-CHEF-5)
```

## 1.7 — Klant submits in-portal shift request (PR-F3)

```
/client/request → submitPortalRequest(formData)
   ↓
   requireClientSelf()  →  resolves clientId via session.user.id → clients.userId
   ↓
   INSERT client_submissions (status='triaged', source='client_portal')
   EMAIL: recipientsFor('client_portal_request') → Maarten (or configured route)
   AUDIT: 'client.portal_request_submitted'
   ↓
   redirect /client/request?ok=1
```

## 1.8 — Chef availability blocking (PR-F2)

```
/chef/availability → click date (or shift-click range)
   ↓
   toggleDate(iso, blocked) OR setRange(start, end, blocked)
   ↓
   requireChefSelf()
   ↓
   INSERT/DELETE chef_availability (chefId, date, available=false)
   AUDIT: 'chef.availability_updated' or '.availability_range_updated'
```

## 1.9 — Klant shift hub (PR-KLANT-0, the canonical klant route)

`/client/shifts/[shiftId]` is the klant's single source of truth for one
shift. Every shift-related dashboard card links here FIRST (hub-canonical
rule); only global actions (nieuwe aanvraag, agenda, profiel) bypass it.

```
/client/shifts/[shiftId]  →  src/app/(client)/client/shifts/[shiftId]/page.tsx
   ↓
   requireClientSelf()  →  resolves clientId via session.user.id → clients.userId
   ↓
   getClientShiftLabel({shiftStatus, hasPlacement, placementStatus, hoursStatus})
      →  src/lib/client-shift-labels.ts
      →  returns { humanStatus, nextStep, allowedActions[] }  (NO raw statuses)
      →  hours lifecycle takes precedence over placement lifecycle
   ↓
   listVisibleComments(placementId, { kind:'client', userId })
      →  src/lib/domain/comments.ts  →  ownership checked, then WHERE visibility='client_visible'
   ↓
   Renders 7 fixed sections: header · status+WhatHappensNext · chefs ·
   uren · feedback · acties · berichten
   (V1 skeleton: chef-preview / change-cancel / rating slots are "binnenkort"
    placeholders — filled by PR-KLANT-2/3/5)
```

**Foundations primitives shipped here (wired by later PRs):**

| Primitive | File | Purpose |
|---|---|---|
| `getClientShiftLabel()` | `src/lib/client-shift-labels.ts` | status → {humanStatus, nextStep, allowedActions} |
| `WhatHappensNext` | `src/components/client/WhatHappensNext.tsx` | "Wat gebeurt er nu?" line (tone: neutral/action/done) |
| `addPlacementComment()` | `src/lib/domain/comments.ts` | trim + validate 1–1000 + plain-text + audit `placement_comments.created` |
| `listVisibleComments()` | `src/lib/domain/comments.ts` | ownership-checked visibility scopes (admin=all · client=client_visible · chef=chef_visible) |
| `recipientsForClient()` | `src/lib/domain/client-recipients.ts` | single klant email-routing seam (see Part 4.5) |

> **Rule:** `placement_comments` (with a `visibility` enum) replaces
> ad-hoc `placements.notes` blobs for all multi-actor comments. Klant
> input NEVER touches `placements.notes`. See `docs/ai/rag-source-catalog.md`.

AI playbook: `docs/ai/workflow-playbooks/client-shift-hub.md` ·
Tool contracts: `docs/ai/tool-contracts/client-tools.md` ·
Migration: `drizzle/0020_klant_foundations.sql`

## 1.10 — Klant profile editing (PR-KLANT-1, sectioned + finance-protected)

`/client/profile` — two authority zones. Field authority is documented in
`docs/ai/source-of-truth-map.md`.

```
DIRECT EDIT (instant) — saveClientProfile(formData)
   src/app/(client)/client/profile/page.tsx
   fields: contactName · phone · email(comms) · shiftAddress · city ·
           shiftArrivalNotes · billingEmail
   ↓
   UPDATE clients SET … ; AUDIT 'client.profile_updated' ; outbox 'client.updated'
   ↓
   if billingEmail changed AND old existed:
      EMAIL BillingEmailChangedKlantEmail → OLD billing address
      (anti-takeover; NOT via recipientsForClient — must reach the OLD addr)
   ↓
   redirect ?ok=saved
   NOTE: editing shiftAddress/city affects only FUTURE requests/templates;
         existing shifts keep their snapshot (correction round 3, #2).

REQUEST CHANGE (admin approves) — requestClientChange(formData)
   fields: companyName · kvk · btw · paymentTermsDays · billingAddress · authEmail
   ↓
   INSERT client_change_requests (status='pending')
   AUDIT 'client.change_requested'
   EMAIL admin (recipientsFor 'client_portal_request', inline React)
   ↓
   redirect ?ok=requested
   ↓
ADMIN: /admin/business/clients/[id] → Wijzigingsverzoeken
   approveClientChange / rejectClientChange (atomic: WHERE status='pending')
   ↓
   on approve: apply value (clients column, or users.email for authEmail) +
               outbox 'client.updated'
   AUDIT 'client.change_approved' | 'client.change_rejected'
   EMAIL klant outcome via recipientsForClient(clientId,'generic') (inline React)
```

Server actions: `saveClientProfile` · `requestClientChange` (klant page) ·
`approveClientChange` · `rejectClientChange` (admin clients/[id]).
Emails: `BillingEmailChangedKlantEmail` + 2 inline-React (admin notify, klant
outcome). AI playbook: `docs/ai/workflow-playbooks/client-profile-change.md` ·
Migration: `drizzle/0021_client_change_requests.sql`.

## 1.11 — Klant never trapped: retract submission + change/cancel any shift (PR-KLANT-2)

Two escape hatches so a klant always has an action.

```
A) RETRACT a still-pending portal submission — /client/requests
   cancelSubmission(formData) → cancelClientSubmission()  (domain)
   ↓ ownership: source='client_portal' + companyName match
   ↓ atomic UPDATE client_submissions SET status='cancelled_by_client'
     WHERE id=? AND status IN ('new','triaged')  (else "al in behandeling")
   AUDIT client_submission.cancelled_by_client ; admin notify email

B) CHANGE / CANCEL an existing shift — /client/shifts/[shiftId] (hub modals)
   requestShiftChangeAction(formData)  →  createShiftChangeRequest()  (domain)
   ↓ reason >= 5 ; ownership (shift.clientId == client.id)
   ↓ one OPEN request per (shift, kind): pre-check + partial-unique backstop
     → duplicate → "Je hebt al een verzoek openstaan"
   INSERT client_shift_change_requests (status='pending')
   AUDIT client_shift_change.{change,cancel}_requested
   EMAIL admin ClientChangeRequestAdminEmail (recipientsFor 'client_portal_request')
   ↓
ADMIN: /admin/business/inbox "Klant-verzoeken" queue
   decideShiftRequest(formData) → decideShiftChangeRequest()  (domain)
   ↓ atomic flip pending→approved/rejected ; admin coordinates the actual
     shift change manually (chefs are committed — this records + closes)
   AUDIT client_shift_change.{approved,rejected}
   EMAIL klant ClientChangeRequestOutcomeKlantEmail (recipientsForClient
     'client_shift_change_requested') + notification 'client_shift_change_decided'
```

Domain: `src/lib/domain/shift-change-requests.tsx` (`createShiftChangeRequest`,
`cancelClientSubmission`, `decideShiftChangeRequest`). Client components:
`ChangeRequestModal` · `CancelRequestModal` · `_components/RequestStatusBadge`.
AI playbooks: `docs/ai/workflow-playbooks/client-request-cancellation.md` ·
`client-shift-change-request.md` · Migration: `drizzle/0022_client_change_cancel.sql`.

## 1.12 — Chef preview + structured comments (PR-KLANT-3, no schema)

Klant sees the proposed chef BEFORE confirm, can comment (no veto), reads
admin replies. All comments are `placement_comments` — `placements.notes` is
NEVER touched by klant input.

```
ADMIN proposes → proposePlacement()  src/lib/domain/matching.ts
   ↓ (existing) chef email
   ↓ (PR-KLANT-3) klant email ChefProposedKlantEmail (recipientsForClient
     'chef_proposed') + notification 'chef_proposed' → /client/shifts/[id]
   ↓
KLANT hub /client/shifts/[shiftId]:
   - proposed-chef card: name · vakniveau · ervaring + "Waarom voorgesteld?"
     reasons (getMatchReasonsForPlacement — positive/clientVisible ONLY,
     never internal warnings)
   - ChefFeedbackForm → sendChefComment() → addPlacementComment(
       authorKind='client', visibility='client_visible')  [ownership-checked]
   - klant comment → admin email (recipientsFor 'client_portal_request')
   - copy is "Stuur opmerking" — NEVER "Akkoord/Goedkeuren" (no veto)
   ↓
ADMIN shift detail /admin/business/shifts/[id]:
   - sees ALL comments (listVisibleComments kind='admin')
   - replyComment() → addPlacementComment(authorKind='admin', visibility
     selectable: client_visible | chef_visible | internal)
   ↓
KLANT hub "Berichten": admin replies with visibility='client_visible' appear.
```

`getMatchReasonsForPlacement` reuses the extracted `buildReasonsAndWarnings`
(shared with `findMatchesForShift` — one source of truth). Chef photo IS shown
on the hub (`ChefAvatar`, initials fallback) — `/api/chef-photo/[id]` authz
was extended so a klant can load a clientVisible+verified photo of a chef
placed on one of THEIR shifts (no enumeration); same gate enforced in the hub
query (`chefDocuments` where clientVisible + verifiedAt + not deleted).
Client component: `ChefFeedbackForm`. Email: `ChefProposedKlantEmail`.
AI playbook: `docs/ai/workflow-playbooks/chef-preview-comment.md`.

## 1.13 — Recurring shift templates (PR-KLANT-4, migration 0023)

Admin defines a weekly pattern; a daily worker materializes real shifts.
Overnight (17:00–01:00) + DST handled in Postgres via AT TIME ZONE. Generated
shifts are independent — editing a template never rewrites existing shifts.

```
ADMIN /admin/business/templates/new → createTemplate()
   INSERT shift_templates (day_of_week [Postgres DOW 0=Sun], starts/ends time,
     ends_next_day, headcount, rates, generate_horizon_days)
   live preview-before-save (TemplateForm client component, no round-trip)
   AUDIT shift_templates.created
   ↓
WORKER workers/generate-recurring-shifts.ts (daily 04:00 Amsterdam, in supervisor JOBS)
   for each active template not generated in 6h:
     INSERT shifts SELECT generate_series(today, today+horizon) filtered by DOW,
       minus shift_template_exceptions, startsAt/endsAt via
       AT TIME ZONE 'Europe/Amsterdam' (+1 day when ends_next_day OR end<=start),
       location ← clients.shift_address (snapshot), status='open'
     ON CONFLICT (source_template_id, source_template_date)
       WHERE source_template_id IS NOT NULL DO NOTHING   ← partial-index match!
   UPDATE last_generated_at ; AUDIT shift_templates.generated
   ↓
ADMIN /admin/business/templates/[id]:
   addException / removeException (skip dates) · toggleActive (pause/resume)
   shows next dates AND exceptions side-by-side
   ↓
KLANT /client/templates: friendly weekly view + requestTemplateChange()
   → client_change_requests field='template:<id>' (admin sees in same tab)
```

Pure helpers: `src/lib/shift-template-format.ts` (previewDates, formatPattern,
formatTimeRange, durationHours — used by both admin preview + klant view).
Client components: `TemplateForm` · `ExceptionsManager`.
AI playbook: `docs/ai/workflow-playbooks/recurring-shift-template-change.md`.

> **Gotcha (caught by smoke):** a PARTIAL unique index requires the matching
> predicate in `ON CONFLICT … WHERE …` or Postgres errors 42P10. Both the
> worker and `scripts/smoke-klant-templates.mjs` include it.

## 1.14 — Rating loop (PR-KLANT-5, migration 0024)

Structured klant feedback (stars + tags) — INTERNAL-ONLY V1.

```
approveHoursRow() (src/lib/domain/hours.ts) — after hours admin-approved:
   EMAIL RatingPendingKlantEmail (recipientsForClient 'rating_pending')
   + notification 'rating_pending' → /client/shifts/[id]/rate
   + /client dashboard "Beoordeel je chef" card (approved hours, no rating yet)
   ↓
KLANT /client/shifts/[shiftId]/rate → submitRatingAction → submitRating()
   ownership (placement→shift→client) · stars 1–5 · sanitizeTags (drops unknown)
   INSERT ratings (placement_id UNIQUE = double-submit guard)
   then recompute chefs.average_rating + rating_count (sequential — neon-http
   has no interactive tx; rollup is a self-healing cache, ratings is truth)
   AUDIT ratings.created
   ↓
VISIBILITY (encoded in src/lib/domain/ratings.ts, not just docs):
   getChefAverageForAdmin → full avg + count + recent (admin chef-detail)
   getChefSummaryForChef  → average NULL until ratingCount>=5 (chef profile)
   getChefPreviewForKlant → no rating data at all (V1)
```

Tags: `src/lib/rating-tags.ts` (positive + negative, Dutch labels, soft hints;
negative tags need human review before penalizing — `ai-safety-rules.md`).
Client component: `RatingForm`. Email: `RatingPendingKlantEmail`.
AI playbook: `docs/ai/workflow-playbooks/client-rating-feedback.md` ·
Tool contract: `docs/ai/tool-contracts/rating-tools.md`.

## 1.15 — Privacy-request fulfillment (PR-AVG-1, migration 0025)

A data subject (chef / klant contact / off-portal person) files an AVG request;
a super_admin works it through the 30-day SLA. Source of truth for scope:
`docs/privacy/pii-inventory.md`.

```
INTAKE (two paths):
  Portal — /chef/privacy · /client/privacy → createPrivacyRequest(channel='portal',
    identity='verified' via session) → audit privacy.request_created → admin email
  Off-portal — /admin/system/privacy-requests/new (super_admin) →
    createPrivacyRequest(channel=email/phone/whatsapp/letter, identity='not_started')
  Both: dueDate = now + 30d ; notify recipientsFor('privacy_request') [Maarten + Jezza]
   ↓
SUPER_ADMIN cockpit /admin/system/privacy-requests (overdue · due-week · waiting-identity counts)
   ↓ detail [id] stepper:
   claimPrivacyRequest (pending→in_progress)            audit privacy.request_claimed
   setIdentityVerification (status/method/notes)        audit privacy.identity_verified
   logRequestMessage (inbound/outbound/internal)        audit privacy.message_logged
   extendSla (reason + new dueDate + requester notice)  audit privacy.request_extended
   withdrawRequest (→withdrawn)                          audit privacy.request_withdrawn
   decidePrivacyRequest (fulfilled/partial/rejected + notes → requester email)
                                                         audit privacy.fulfilled/.rejected
```

Identity is **evidence** (status/method/by/at/notes), not a checkbox; export +
erasure execution (PR-AVG-2) are blocked until `identity_status='verified'`.
Domain: `src/lib/domain/privacy.ts`. Emails: `PrivacyRequestReceivedAdminEmail`
· `PrivacyRequestOutcomeEmail` · `PrivacyRequestExtensionEmail`. Correspondence
log: `privacy_request_messages`. AI playbook (extend): `docs/ai/workflow-playbooks/privacy-request.md`.

---

## 1.16 — Native public intake + Jotform retirement (PR-K2-1/K2-2, no migration)

Public CTAs no longer link out to Jotform — they hit native forms that land in our own DB.

```
Klant "Personeel aanvragen"   /horeca-personeel-aanvragen (+ /aanvragen alias)
  page → getPublishedForm('client-request') → <ClientRequestForm>
  submit → submitClientRequestAction (honeypot + client_request_ip rate-limit)
         → submitClientRequest() → client_submissions (source 'native_request', status 'new')
         → recipientsFor('client_submission_received') office email
  admin edits the form live at /admin/business/forms/client-request

Chef "Aanmelden als chef"     /sollicitatie  (already native — PR-FB-5)
Contact "Stuur een bericht"   /contact-us <ContactForm>  (was a mailto: form)
  submit → submitContactAction → submitContactMessage()
         → client_submissions (source 'native_contact') + office email
```

CTAs read `site.intake.{chef,client}` (`src/lib/site.ts`); `/aanmelden` + `/contact-us` updated. `site.jotform.*` kept only for legacy webhook/inbox reference. The legacy Jotform webhooks `/api/intake/{chef,client}` are being retired — a fail-open per-IP rate limit (`intake_webhook_ip`) caps injection abuse until the Jotform forms are disabled and the endpoints removed. Files: `src/lib/domain/{client-requests,contact-messages}.ts`, `src/app/horeca-personeel-aanvragen/*`, `src/app/contact-us/{ContactForm.tsx,actions.ts}`. Smoke: `scripts/smoke-klant-native-intake.mjs`.

## 1.17 — Chef respond() ownership scoping (PR-K2-4 IDOR fix)

`respond()` in `/chef/shifts/[placementId]` (accept/reject a proposed placement) previously did `UPDATE placements … WHERE id=?` with no ownership predicate — any authenticated user could accept/reject another chef's placement (IDOR). It now resolves the caller via `chefs.userId` and runs an atomic, ownership-scoped transition: `UPDATE … WHERE id=? AND chef_id=? AND status='proposed'` (0 rows → `?error=stale`); the notes-append read is scoped the same way. Restores the "Auth IS the lookup" hard rule. A full sweep of every `(client)`+`(chef)` loader and action confirmed no other holes (two low-severity data-minimization follow-ups logged in MEMORY.md).

## 1.18 — Klant venue preferences (PR-K2-5, no migration)

The klant self-describes their venue so the match is better — **without picking the chef** (the "no veto" rule stands; K2-3 chef approve/decline was dropped for this).

```
/client/profile  "Jouw zaak & voorkeuren" (DIRECT-edit, like shiftArrivalNotes)
  → clientType  (select, CLIENT_TYPE_OPTIONS)   → clients.client_type
  → clientTags[] (chips,  CLIENT_TAG_OPTIONS)    → clients.client_tags
  saveClientProfile validates against the shared client-taxonomy (no free text),
  audit + outbox 'client.updated'. New shifts snapshot these → domain/matching.ts
  already reads clientType/clientTags for match reasons. favoriteChefIds /
  blockedChefIds stay ADMIN-only (matching controls, not klant-editable).
```

Vocab source of truth: `src/lib/domain/client-taxonomy.ts` (shared by the admin client editor, chef filters, matching reasons). Smoke: `scripts/smoke-klant-preferences.mjs`.

## 1.19 — Klant KPI card (PR-K2-6, no migration)

`/client` "Jouw cijfers" — read-only aggregates scoped to `clients.userId`: komende (confirmed, future) + afgeronde shifts, uren te tekenen (`shiftHours.status='submitted'`), 30-dagen besteed (`Σ worked_minutes × client_rate_cents / 6000`, approved/exported only — rates are snapshotted on the hours row, there is no client "master rate"), meest-ingezette chef. All inline in the dashboard page.

## 1.20 — Klant mail-voorkeuren (PR-K2-7, no migration)

`/client/notifications` adds toggles for 4 MUTABLE categories (`chef_proposed`, `hours_ready_to_sign`, `client_shift_change_requested`, `rating_pending`) → `setPref` → `notification_prefs`. Gating is central: `recipientsForClient` checks `shouldSendToUser(client.userId, event)` for mutable events and returns `[]` if muted. Critical mail (`billing_email_changed` = anti-takeover, `generic`) is never mutable. Vocab: `CLIENT_NOTIFICATION_PREFS` in `domain/client-recipients.ts`.

## 1.21 — Admin per-form recipients (PR-K2-8, no migration)

`recipientsForForm(slug, fallbackEvent)` reads a `form:<slug>` row in `notification_routes` (enabled+recipients = override · enabled+empty = fallback · disabled = mute), else the generic event. The chef-apply / client-request / contact handlers call it. Admin edits these in `/admin/system/notifications` "Per formulier" (the `saveRoute` action accepts `form:*` keys; cache-invalidation only for typed events). Registry: `FORM_ROUTES` in `notifications.ts`. The AI "Stel chefs voor" heuristic match (Phase 9A) is already live on `/admin/business/shifts/[id]` (`findMatchesForShift` → ranked candidates + `proposePlacement`).

## 1.22 — Owner AI assistant (PA-V1 + 2026-06 expansion, no migration)

Owner/super_admin chat on `/admin/assistant` + a floating widget on every `/admin` page. Stateless: the client posts the full message history to `POST /api/ai/chat`; the route resolves the actor (the owner's effective permissions ARE the assistant's ceiling — it can never exceed Maarten), assembles the system prompt (`DEFAULT_SYSTEM_PROMPT` + `ASSISTANT_PLAYBOOK` + page context + writable owner-memory) and runs the channel-agnostic agent loop (`runOwnerAssistant` → `runAgent`) against the OpenAI brain (`openai-brain.ts`, model `gpt-5.4`, native tool-call threading + conversation context across turns). **Parallel tool calls:** when a question needs several independent tools the model batches them in ONE response and `runAgent` runs them **concurrently** (`Promise.all`) — one model round-trip instead of N (the big latency/cost saver; a mixed batch that includes an action still pauses cleanly on the confirm gate, reads already ran side-effect-free). Per-turn token usage is tallied (`recordAiUsage` → `business_settings['ai_usage']`) and shown with gpt-5.4 cost on the `/admin/system` AI-tokens card.

**Gate (every tool call, `executeTool`):** permission check against the actor's set (else `denied`) → for `outbound`/`financial` tools, mint a signed confirm token and PAUSE (`needs_confirmation`); the human echoes it back via the confirm UI before the action runs. Reads run immediately. Every call emits an AI meta-audit row (`aiAuditSink`), paired with the domain's own business audit. Rate-limited `ai_chat_user` (30/min).

**Tool registry (`src/lib/ai/tools/index.ts`) — 49 tools (30 read / 13 act / 6 personal):**
- *read:* `business.overview` · `shifts.open_soon`/`find` · `chefs.find` · `clients.find` · `insights.leaderboards` · `integrations.health` · `hours.list_awaiting_approval` · `chefs.list_profile_changes` · `chefs.work_summary`/`feedback`/`trends` · `clients.history` · `clients.health` (Klant 360 verdict) · `roster.overview` · `planner.cockpit` · `shifts.suggest_chefs` · `shifts.margin` · `contacts.timeline` · `chefs`/`clients.semantic_search` · `knowledge.search` · `briefing.daily` (dagstart: gisteren-recap + vandaag-forecast) · `audit.search` · `documents.list_for_chef` · `documents.expiring` (all chefs, soonest-first) · `privacy.list_requests` · `email.status` · `payroll.read` (the oversight cluster = Restricted tool-only data, metadata/aggregate-only)
- *act (confirm-gated):* `hours.approve`/`reject`/`send_reminder` · `placements.propose`/`confirm`/`cancel` · `roster.publish`/`autofill`/`copy_last_week` · `email.send` · `chefs.approve`/`reject_profile_change` · `chefs.send_availability_reminder`
- *personal (self, no confirm):* `reminders.create`/`list`/`complete` · `memory.remember`/`list`/`forget`

Read tools wrap the SAME tested domain logic the screens use (chef-history · client-history · roster-intel `rosterAiSummary` · planner-intel · matching) — never a re-implementation, so the AI can't disagree with the UI. Act tools share the domain mutation (e.g. `decideChefProfileChange` is used by both the admin chef page and `chefs.approve/reject_profile_change`). Enum codes are humanised via `src/lib/labels.ts` before the brain sees them.

**RAG — two layers, both live:**
- *Layer 2a (per-row semantic search):* `chefs`/`clients.semantic_search` embed the query (`src/lib/ai/embeddings.ts`, text-embedding-3-small) and cosine-search the per-row `embedding` vectors (`read-model/semantic.ts`, raw SQL `<=>`) the `embedding-refresh` worker maintains.
- *Layer 2b (chunked notes-RAG → `knowledge.search`):* semantic recall over the free-text NOTES corpus. **Ingestion** (`src/lib/ai/rag/{sources,ingest}.ts` + `scripts/rag-ingest.mts`): each allowlisted source (chef/klant-notities, dienstomschrijvingen, contactlogs, **afgeronde plaatsingen + beoordelingen** `placements.outcome` admin_only, **chef-CV-tekst** `chef_documents` (alleen door de chef zélf geüploade tekst-PDF's, via `ingestCvs` → R2-bytes + `unpdf`-tekstextractie, geen OCR, `chef_own_and_admin`) — `sources.ts` is the indexer's allowlist — plus **project docs** MEMORY/WORKFLOW/AI_INTEGRATION/README/CLAUDE + `docs/ai/*.md` via `ingestDocs` + heading-aware `chunkMarkdown`, `source_table='docs'`, `tenant_scope='internal'`/`visibility='admin_only'` owner-only, script-only since the Vercel cron can't read repo files) → build text → **redact PII** (`rag/redact.ts` — email/phone/IBAN/BSN/card/DOB, the load-bearing AVG step, runs at INDEX time) → density-gate (>30% redacted ⇒ skip) → **chunk** (`rag/chunk.ts`, ~500-tok) → embed → **soft-supersede + insert** into `ai_embeddings` (manual `manual_ai_embeddings.sql`: `vector(1536)` + HNSW cosine), idempotent via `content_hash`. **Retrieval** (`rag/retrieve.ts`): embed query → cosine over `ai_embeddings`, filtered by the **PURE** access filter (`rag/access.ts`) — `tenant_scope` ∩ caller-scopes AND `visibility` — BEFORE the LLM sees a chunk. Owner spans all tenants; chef/klant are scoped to self + placement-bridge (future PAs are safe-by-construction). `read-model/knowledge.ts` turns hits into human citations ("Notitie over chef Lisa de Vries").

Both layers degrade to "niet beschikbaar" without a key/vectors. **Refresh + lifecycle:** the chunked store is re-indexed **nightly app-side** by the Vercel cron `GET /api/cron/rag-ingest` (→ `ingestAll()`, `vercel.json` `0 3 * * *`, gated on `CRON_SECRET`) — app-side, not a Railway worker, because the standalone worker deploy (own package-lock + node_modules, no `@/` alias, no `../src`) can't import the shared redact/chunk/sources/ingest, and duplicating them would risk PII-redaction drift (forbidden by the contract). `scripts/rag-ingest.mts` is the same engine for manual/bulk reindex. **Retention** (`workers/retention.ts` strategy 5, double-gated): prunes superseded chunks >30d + chunks whose chef/klant source was soft-deleted >30d. **AVG erasure** (`eraseUserData`): synchronously purges an erased subject's chunks via `src/lib/ai/rag/purge.ts` (by `tenant_scope`) the moment the erasure commits — the retention sweep is the backstop.

Files: `src/lib/ai/{runtime,tools,read-model,actions,rag}/**` · `src/lib/ai/{playbook,config,embeddings,types}.ts` · `src/app/api/ai/chat/route.ts` · `src/app/api/cron/rag-ingest/route.ts` · `src/components/ai/Assistant{Widget,Chat}.tsx`. Smokes (key-free gate): `scripts/smoke-ai-{spine,brain,tools,safety,usage,rag}.mts` (rag covers redaction + chunking + the access-filter logic + the AVG purge-scope builder) + LIVE `scripts/smoke-ai-rag-retrieval.mts` (NEVER-source allowlist · redaction-in-corpus · chef-A-never-sees-chef-B · synchronous-purge round-trip · retention purge-SQL) + live `scripts/live-ai-{brain,loop,context}-check.mts`. **Release regression net:** `scripts/eval-ai.mts` (golden routing + safety-refusal, real brain, planning-only — 25/25: 15 golden across the tool surface + 10 safety boundaries) + `scripts/eval-ai-answers.mts` (FULL-execution answer hygiene — runs the real loop + real tools and greps the final answer for raw-status-enum leaks (R6) + Payingit overclaims (R7); caught a real `client_signed` leak via a tool description) + `scripts/live-ai-{,portal-}eval.mts` (owner / chef+klant tool-routing) + LIVE `scripts/smoke-ai-rag-retrieval.mts` (cross-tenant + NEVER-source). Run after any prompt / tool / model change → see `docs/ai/ai-evaluation-set.md`. ⚠ OpenAI key rotation pending; WhatsApp/voice channels ON HOLD.

## 1.23 — Chef + klant portal assistants (read-only, own-data-only)

TWO more assistant personas — one for chefs, one for klanten. Both reuse the SAME agent loop + executor + audit as the owner, with three differences that make them safe for a non-staff user:
- **Ownership scope, not RBAC.** `AiActor` gained a `subject: {kind, entityId}`. `resolveChefActor`/`resolveClientActor(userId)` resolve the entity from `chefs.userId`/`clients.userId` (the "auth IS the lookup" rule) and stamp it as the subject. The portal tools (chef: `mijn.diensten`/`mijn.uren`/`mijn.beschikbaarheid`/`mijn.profiel` · klant: `onze.diensten`/`onze.uren`/`onze.vaste_diensten`/`onze.aanvragen`, in `tools/chef-self.ts` + `tools/client-self.ts`) are `permission:null` + `risk:'read'` and key EVERY query off `ctx.actor.subject.entityId` — the model never supplies an id, and the tool input schemas accept none, so a caller can't be steered to another tenant's data.
- **Separate registries.** `buildChefRegistry()` / `buildClientRegistry()` (`tools/portal-index.ts`) hold ONLY their own tools — no owner tools leak in.
- **Separate channel + persona.** `POST /api/ai/portal/chat` gates on `session.user.kind` and branches: chef → `runChefAssistant` + `CHEF_SYSTEM_PROMPT`, klant → `runClientAssistant` + `CLIENT_SYSTEM_PROMPT` (`runtime/portal-prompts.ts`). Floating widgets on both portals reuse `AssistantChat`/`AssistantWidget` (now take an `endpoint` prop). Read-only V1 — the prompt steers concrete actions (accept a proposal, sign hours) back to the portal UI. Smoke: `scripts/smoke-ai-portal.mts` (both personas: read-only + no-id-injection + live scoped execution + clean no-subject error).

## 1.24 — Planbord: concept-rooster bouwen + publiceren (PR-PLANBORD-1, migration 0039)

Route `/admin/business/roster/planbord` (gate `shifts:write`; **Rooster** = overzicht/read-only, **Planbord** = bouwen). 7 dag-kolommen × shift-kaarten met N slots als drop-targets; chef-pool rail rechts. Focus een shift (zoek-knop) → `matchesForShiftAction` → `findMatchesForShift` rangschikt de chefs met score + reden + waarschuwing (de "waarom"). **Of "Vul de week"** (`autofillWeekAction` → `autofillWeek`, PR-PLANBORD-3): greedy autofill zet de best passende beschikbare chef als concept op élke open plek — per slot her-query zodat een net-geplaatste chef uit een overlappende plek valt (géén dubbele boekingen, niet 2× op één dienst), met een lichte fairness-spreiding. Concepten dus; daarna gewoon controleren + Publiceren. Een **"Per chef"-lens** (toggle) draait het bord om naar chef-rijen × 7 dagen (`ChefWeekGrid`, PR-PLANBORD-4): wie staat waar, ieders weekbelasting (badge) en **wie nog vrij is** — geblokkeerde dagen uit `chef_availability` tonen als "niet beschikbaar", dus "vrij" = écht vrij (PR-PLANBORD-5) — read-only inzicht.

1. **Sleep chef → open slot** → `draftChefAction` → `draftPlacement()` maakt een **DRAFT**-plaatsing (`placement_status='draft'`, enum via migration 0039). Stil: géén mail, géén `recomputeShiftStatus`. **Onzichtbaar** voor chef + klant (status-allowlists), voor de ICS-feeds (`status != 'draft'`), en telt niet mee in shift-status/fill (`recomputeShiftStatus` sluit draft uit). `draftPlacement` weigert een live rij (proposed/accepted/confirmed) te overschrijven.
2. **Concept terugtrekken** → `removeDraftAction` → `removeDraftPlacement()` — atomair `DELETE WHERE status='draft'`, raakt dus NOOIT een gepubliceerde plaatsing (dat is het change/cancel-REQUEST-pad, §1.11).
3. **Publiceer week** → `publishWeekAction(weekStart)` → `publishDraftsForPeriod()`: per concept **her-valideren** (chef geblokkeerd op die dag, of nu dubbel geboekt tegen een live plaatsing → **overslaan + terugmelden**), dan atomair `draft→proposed` (`WHERE status='draft'`), `recomputeShiftStatus` + audit `placements.publish`, dan **ÉÉN weekoverzicht-mail per chef én per klant** (`sendWeekDigests`, ná de loop — géén N losse voorstel-mails): de **chef** krijgt zijn week met **adres + contactpersoon + telefoon + chef-zichtbare details** (`chef_visible_notes`, AVG-veilig), de **klant** de voorgestelde chef **met telefoonnummer**; beide met een **`.ics`-bijlage** (hele week in de agenda) + in-app notificatie. **Dit is het enige moment dat chef + klant bericht krijgen.** (weekdigests = PR-PLANBORD-2: `emails/{Chef,Klant}WeekPlanningEmail.tsx`, `sendEmail` attachments)
4. Daarna loopt alles via de bestaande pijplijn (§1.6): chef accepteert → admin bevestigt → uren.

**AI (owner PA):** `roster.autofill` (confirm-gated) vult de week met concepten ("vul de week voor volgende week"); `roster.publish` (confirm-gated, `risk:outbound`) doet stap 3 ("publiceer maar"); `roster.overview` meldt `draftsPending` ("X concepten staan klaar, nog niet gepubliceerd"). Alle drie owner-only, smoke-gedekt (`smoke-ai-tools` 162/0). Engine: `domain/roster-publish.ts` + `domain/matching.ts` (`draftPlacement`/`sendProposalNotifications`). UI: `roster/planbord/{page,actions,_components/Planbord}.tsx` · dep `@dnd-kit/core`. Verified: `scripts/smoke-planbord.mts` **13/0** (draft onzichtbaar · recompute negeert draft · publish flipt + her-valideert conflict wég · removeDraft-guard).

---

# Part 2 — Planned workflows (per active plan)

These are documented HERE before the code lands so we don't forget the linkage when we build.

## 2.1 — Hours chain (PR-CHEF-1, depends on PR-CHEF-0 outbox)

```
┌──────────────────────────────────────────────────────────────────┐
│ TRIGGER: shift.endsAt + 1h passes                                 │
└──────────────────────────────────────────────────────────────────┘
   ↓
   Worker: workers/complete-placements.ts (30 min cron)
   ↓
   UPDATE placements SET status='completed' WHERE status='confirmed' AND endsAt < now()-1h
   INSERT shift_hours (status='draft', placementId=...) — idempotent on placementId UNIQUE
   AUDIT: 'placements.completed_auto' · 'shift_hours.draft_created'
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ CHEF: /chef shows "Uren in te dienen" → /chef/hours/[placementId]│
└──────────────────────────────────────────────────────────────────┘
   ↓
   submitHours(formData) — startedAt/endedAt/breakMinutes/notes
   ↓
   UPDATE shift_hours WHERE id=? AND status IN ('draft','client_rejected')
     SET status='submitted', submittedAt=now(), ...
   AUDIT: 'shift_hours.submit'
   enqueueIntegrationEvent({ eventType: 'hours.submitted', entityId, idempotencyKey })
   createNotification(klant.user, type='hours_to_sign', actionUrl='/client/shifts/.../hours')
   sendEmail(HoursSubmittedKlantEmail) + recordEmailMessage(...)
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ KLANT: /client/shifts/[id]/hours — receipt-style page              │
└──────────────────────────────────────────────────────────────────┘
   ↓
   sign(hoursId) OR reject(hoursId, reason)
   ↓
   requireClientSelf() + ownership check
   UPDATE shift_hours WHERE id=? AND status='submitted'
     SET status='client_signed'|'client_rejected', clientSignedAt=..., clientSignedBy=user.id
   AUDIT: 'shift_hours.client_signed' or '.client_rejected'
   ON sign: enqueueIntegrationEvent('hours.client_signed'),
            createNotification(chef.user, 'hours_signed'),
            createNotification(admin recipients, 'hours_ready_to_approve'),
            sendEmail(HoursSignedChefEmail) + recordEmailMessage,
            sendEmail(HoursSignedAdminEmail) → recipientsFor('hours_signed')
   ON reject: createNotification(chef.user, 'hours_rejected_by_klant'),
              sendEmail(HoursRejectedByKlantChefEmail)
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ ADMIN: /admin/business/hours — queue + bulk-approve (PR-CHEF-3)   │
└──────────────────────────────────────────────────────────────────┘
   ↓
   approveHours(hoursId)
   ↓
   requireRole("owner" | "super_admin")
   UPDATE shift_hours WHERE id=? AND status='client_signed'
     SET status='admin_approved', adminApprovedAt=now(), adminApprovedBy=user.id
   AUDIT: 'shift_hours.admin_approved'
   enqueueIntegrationEvent({ provider: 'payroll', eventType: 'hours.approved',
                              idempotencyKey: 'hours.approved:' + hoursId })
   createNotification(chef.user, 'hours_approved')
   sendEmail(HoursApprovedChefEmail) + sendEmail(HoursApprovedKlantEmail)
   ↓
┌──────────────────────────────────────────────────────────────────┐
│ PAYROLL: /admin/business/payroll — batch CSV export (PR-CHEF-7)   │
└──────────────────────────────────────────────────────────────────┘
   ↓
   createPayrollBatch({ periodStart, periodEnd }) — picks all admin_approved rows in window
   ↓
   INSERT payroll_batches (status='draft')
   INSERT payroll_batch_lines (one per shift_hours)
   ↓
   exportPayrollBatch(batchId) — generates CSV, uploads to R2, computes sha256
   ↓
   UPDATE payroll_batches SET status='exported', fileUrl=..., fileChecksum=..., exportedAt, exportedBy
   UPDATE shift_hours SET status='exported', payingitExportedAt=now() FOR each line
   AUDIT: 'payroll_batches.exported'
   enqueueIntegrationEvent('payroll_batch.exported')
```

## 2.2 — Cancel-shift severity (PR-CHEF-5)

```
/chef/shifts/[id] → "Annuleren" — tier UI based on hours-until-shift
   ↓
   cancel(reason) — server action
   ↓
   requireAuth() + ownership check
   UPDATE placements WHERE id=? AND status IN ('accepted','confirmed')
     SET status='cancelled', cancelledAt=now(), cancelledReason=reason
   AUDIT: 'placements.chef_cancelled'
   enqueueIntegrationEvent('placement.cancelled_by_chef')
   createNotification(admin recipients, 'shift_cancelled_by_chef')
   createNotification(klant.user, 'shift_cancelled_by_chef')
   sendEmail(ShiftCancelledByChefClientEmail) → klant
   sendEmail(ShiftCancelledByChefAdminEmail) → recipientsFor('placement_chef_cancelled')
   ↓
   (Tier 3 only: copy includes [Bel Maarten] tel: link)
```

## 2.3 — Profile change request (PR-CHEF-4) — ✅ SHIPPED (admin review added post-klant-phase)

```
/chef/profile → "Verzoek wijziging" on locked field (hourlyRate / vakniveau / fullName / email)
   ↓
   requestChange(field, proposedValue, reason)   src/app/(chef)/chef/profile/page.tsx
   ↓
   INSERT profile_change_requests (status='pending')
   AUDIT: 'chef.profile_change_requested' ; admin notify email
   ↓
ADMIN: /admin/business/chefs/[id] → "Wijzigingsverzoeken" section → Goedkeuren/Afwijzen
   ↓
   approveProfileChange / rejectProfileChange (→ decideProfileChange helper)
   ↓
   ON approve: apply field → chefs column(s) — hourlyRate writes BOTH
     hourlyRateMinCents + hourlyRateMaxCents from proposedValue {min,max}
   atomic UPDATE profile_change_requests SET status WHERE id=? AND status='pending'
   AUDIT: 'chef.profile_change_approved' | 'chef.profile_change_rejected'
   EMAIL chef outcome (inline-React, direct to chefs.email + recordEmailMessage)
   ON reject: status='rejected', no chef field change
```

(The chef-request side shipped in PR-CHEF-4; the admin review UI was a gap
closed afterwards — mirrors the klant Wijzigingsverzoeken flow §1.10.)

## 2.4 — Hours correction after export (PR-CHEF-7)

```
/admin/business/payroll/[batchId] OR /admin/business/hours/[id] → "Maak correctie"
   ↓
   createCorrection(originalHoursId, type, deltaWorked, deltaChef, deltaClient, reason)
   ↓
   requireRole("owner"|"super_admin")
   INSERT shift_hour_corrections (status='pending', createdBy)
   AUDIT: 'shift_hour_corrections.created'
   createNotification(other admins, 'correction_to_review')
   ↓
   DIFFERENT admin opens correction → approveCorrection(corrId, decisionNotes)
   ↓
   UPDATE shift_hour_corrections SET status='approved', approvedBy, approvedAt
   AUDIT: 'shift_hour_corrections.approved'
   enqueueIntegrationEvent('correction.ready')  ← picked up by next payroll batch
   ↓
   Next batch picks this up as a new line (positive or negative delta).
```

## 2.5 — AVG consent gate (PR-CHEF-10)

```
Chef logs in for first time (or after consent version bump)
   ↓
   Middleware: hasCurrentConsent(userId, 'gegevensgebruik_chef_v1')?
   ↓
   If NO:
     IF AVG_CONSENT_ENFORCED=true → redirect to /chef/_consent (blocking modal page)
     ELSE → modal shown but dismissable (V1 dev safety)
   ↓
   User clicks "Akkoord en doorgaan"
   ↓
   acceptConsent('gegevensgebruik_chef_v1')
   ↓
   INSERT consent_log (userId, documentKey, acceptedAt, ip, userAgent)
   AUDIT: 'consent.accepted'
   createNotification(user, 'consent_acknowledged') — optional, low-noise
   ↓
   redirect to original target
```

## 2.6 — Privacy request (PR-CHEF-10)

```
/chef/privacy or /client/privacy → "Vraag inzage / correctie / verwijdering / export"
   ↓
   createPrivacyRequest(type, reason)
   ↓
   INSERT privacy_requests (status='pending', dueDate=now()+30d)
   AUDIT: 'privacy.request_created'
   createNotification(admin super_admin, 'privacy_request')
   sendEmail(PrivacyRequestAdminEmail) → super_admin recipients
   ↓
ADMIN: /admin/system/privacy/[id] → handles + uploads response PDF + marks fulfilled
   ↓
   UPDATE privacy_requests SET status='fulfilled', responseFileUrl, handledBy, decisionNotes
   sendEmail(PrivacyResponseUserEmail) → requester
   AUDIT: 'privacy.request_fulfilled'
```

## 2.7 — Document verification (PR-CHEF-12)

```
CHEF uploads document → POST /api/chef-documents/upload (presigned R2)
   ↓
   INSERT chef_documents (status='needs_review', uploadedBy=chef.userId)
   AUDIT: 'chef_documents.uploaded'
   createNotification(admin recipients, 'document_needs_review')
   ↓
ADMIN: /admin/business/chefs/[id] documents tab → verify/reject/toggle visibility/set expiry
   ↓
   verifyDocument(docId) OR rejectDocument(docId, reason) OR setVisibility(docId, visible)
       OR setExpiry(docId, expiresAt)
   ↓
   UPDATE chef_documents SET status='verified'|'rejected'|..., verifiedAt, verifiedBy
   AUDIT: 'chef_documents.verified' / '.rejected' / '.visibility_changed' / '.expiry_set'
   createNotification(chef.user, 'document_verified' or '_rejected')
   ↓
CRON workers/document-expiry.ts (daily):
   FIND docs WHERE expiresAt < now()+30d AND status='verified' AND no expiry-notif sent in 30d
   FOREACH:
     createNotification(chef.user, 'document_expiring_soon')
     sendEmail(DocumentExpiryWarningChefEmail)
     AUDIT: 'chef_documents.expiry_warned'
```

---

# Part 3 — Wiring map: every server-callable endpoint

## 3.1 — App Router server actions

| Action | File | Auth | Mutation |
|---|---|---|---|
| `passwordLogin` | `(auth)/login/page.tsx` | none | signIn("password-totp") |
| `sendMagicLink` | `(auth)/login/page.tsx` | none | signIn("resend") |
| `requestRecovery` submit | `(auth)/login/forgot-password/page.tsx` | none | createIntent + sendEmail |
| `requestRecovery` submit | `(auth)/login/lost-2fa/page.tsx` | none | createIntent + sendEmail |
| `submit` (consume) | `(auth)/recover/password/page.tsx` | token | consumeIntent + UPDATE users |
| `submit` (consume) | `(auth)/recover/2fa/page.tsx` | token | consumeIntent + wipe TOTP |
| `setPassword` | `(admin)/admin/account/setup/password/page.tsx` | requireAuth | UPDATE users.password |
| `confirm2FA` | `(admin)/admin/account/setup/2fa/page.tsx` | requireAuth | UPDATE users + generate recovery codes |
| `startTotpSetup` | same | requireAuth | cookie write |
| `inviteStaff` | `(admin)/admin/system/users/new/page.tsx` | requireRole(super_admin, strict) | INSERT users + user_roles |
| `reset2FA` | `(admin)/admin/system/users/[id]/page.tsx` | requireRole(super_admin, strict) | resetInternalUser2FA |
| `respond` | `(chef)/chef/shifts/[placementId]/page.tsx` | requireAuth + ownership | UPDATE placements |
| `submitPortalRequest` | `(client)/client/request/page.tsx` | requireAuth + clientSelf | INSERT client_submissions |
| `toggleDate` / `setRange` | `(chef)/chef/availability/page.tsx` | requireAuth + chefSelf | INSERT/DELETE chef_availability |
| `setPlacementStatus` | `(admin)/admin/business/shifts/[id]/page.tsx` | requireRole(owner) | UPDATE placements + email |
| `convertChefSubmission` | (admin chef submissions) | requireRole(owner) | INSERT chefs + UPDATE submissions |
| `inviteChefToPortal` / `inviteClientToPortal` | (admin chef/client detail) | requireRole(owner) | INSERT users + UPDATE chefs/clients |
| `activatePortalUser` | (admin) | requireRole(owner) | UPDATE users.status + sendEmail |
| `saveClientProfile` | `(client)/client/profile/page.tsx` | requireAuth + own client | UPDATE clients · audit · outbox · (billing-email-changed mail to OLD addr) |
| `requestClientChange` | `(client)/client/profile/page.tsx` | requireAuth + own client | INSERT client_change_requests · admin email |
| `approveClientChange` / `rejectClientChange` | `(admin)/admin/business/clients/[id]/page.tsx` | requireRole(owner) | atomic UPDATE client_change_requests · apply value · outbox · klant outcome email |
| `cancelSubmission` | `(client)/client/requests/page.tsx` | requireAuth + own client | atomic UPDATE client_submissions → cancelled_by_client · admin notify |
| `requestShiftChangeAction` | `(client)/client/shifts/[shiftId]/page.tsx` | requireAuth + own client | INSERT client_shift_change_requests (dup-guarded) · admin email |
| `decideShiftRequest` | `(admin)/admin/business/inbox/page.tsx` | requireRole(owner) | atomic decide client_shift_change_requests · klant outcome email + notification |
| `sendChefComment` | `(client)/client/shifts/[shiftId]/page.tsx` | requireAuth + own shift | addPlacementComment(client/client_visible) · admin email |
| `replyComment` | `(admin)/admin/business/shifts/[id]/page.tsx` | requireRole(owner) | addPlacementComment(admin, visibility selectable) |
| `createTemplate` | `(admin)/admin/business/templates/new/page.tsx` | requireRole(owner) | INSERT shift_templates · audit |
| `addException` / `removeException` / `toggleActive` | `(admin)/admin/business/templates/[id]/page.tsx` | requireRole(owner) | mutate shift_template_exceptions / shift_templates.active · audit |
| `requestTemplateChange` | `(client)/client/templates/page.tsx` | requireAuth + own template | INSERT client_change_requests field='template:<id>' · admin email |
| `submitRatingAction` | `(client)/client/shifts/[shiftId]/rate/page.tsx` | requireAuth + own shift | submitRating() · INSERT ratings + recompute chefs rollup |
| `submit` (privacy) | `(chef)/chef/privacy/page.tsx` · `(client)/client/privacy/page.tsx` | requireAuth (self) | createPrivacyRequest(channel=portal, identity=verified) · admin email |
| `create` (manual privacy intake) | `(admin)/admin/system/privacy-requests/new/page.tsx` | requireRole(super_admin, strict) | createPrivacyRequest(off-portal, identity=not_started) · audit |
| `doClaim` / `doSetIdentity` / `doLogMessage` / `doExtendSla` / `doWithdraw` / `doDecide` | `(admin)/admin/system/privacy-requests/[id]/page.tsx` | requireRole(super_admin, strict) | atomic UPDATE privacy_requests / INSERT privacy_request_messages · audit · requester email (extension/outcome) |
| `doBuildExport` / `doApplyCorrection` / `doErase` (PR-AVG-2) | `(admin)/admin/system/privacy-requests/[id]/page.tsx` | requireRole(super_admin, strict) + identity verified + typed-confirm (erase) | buildUserDataExport (zip→R2) · applyCorrection (allow-listed field, before/after audit) · eraseUserData (anonymise + R2 purge + legal-hold-aware + tombstone) |
| `GET` download | `(admin)/admin/system/privacy-requests/[id]/download/route.ts` | requireRole(super_admin, strict) | createExportDownloadLink → 302 to presigned R2 link (~7d) · audit export_download_link_created |
| `updatePolicy` (PR-AVG-3) | `(admin)/admin/system/retention/page.tsx` | requireRole(super_admin, strict) | UPDATE retention_policies (period/basis/desc) · audit retention_policies.updated |

### Planned (per active plan)

| Action | File (planned) | Auth | Mutation |
|---|---|---|---|
| `submitHours` | `(chef)/chef/hours/[placementId]/page.tsx` | requireAuth + chefSelf + placement ownership | INSERT/UPDATE shift_hours · outbox · notification · email |
| `signHours` / `rejectHours` | `(client)/client/shifts/[shiftId]/hours/page.tsx` | requireAuth + clientSelf | UPDATE shift_hours · outbox · notif · email |
| `approveHours` / `rejectHours` (admin) | `(admin)/admin/business/hours/[id]/page.tsx` | requireRole(owner) | UPDATE shift_hours · outbox · notif · email |
| `bulkApproveHours` | `(admin)/admin/business/hours/page.tsx` | requireRole(owner) | LOOP approveHours per id (NOT one tx) |
| `manualAddHours` | `(admin)/admin/business/shifts/[id]/page.tsx` | requireRole(owner) | INSERT shift_hours with status, audit reason |
| `saveProfile` (direct) | `(chef)/chef/profile/page.tsx` | requireAuth + chefSelf | UPDATE chefs · audit |
| `requestChange` | same | requireAuth + chefSelf | INSERT profile_change_requests |
| `approveProfileChange` / `rejectProfileChange` (→ `decideProfileChange`) | `(admin)/admin/business/chefs/[id]/page.tsx` | requireRole(owner) | apply field → chefs · atomic UPDATE profile_change_requests · chef outcome email — ✅ SHIPPED |
| `cancelShift` (chef) | `(chef)/chef/shifts/[placementId]/page.tsx` | requireAuth + chefSelf | UPDATE placements · outbox · 2 emails |
| `logContact` | (admin shift/chef detail) | requireRole(owner) | INSERT contact_logs |
| `acceptConsent` | `(chef)/chef/_components/ConsentGate.tsx` server action | requireAuth | INSERT consent_log |
| `createPrivacyRequest` | `(chef)/chef/privacy/page.tsx` · `(client)/client/privacy/page.tsx` · admin intake | requireAuth / super_admin | INSERT privacy_requests — ✅ SHIPPED (PR-AVG-1, see §1.15) |
| `verifyDocument` etc. | admin chef detail | requireRole(owner) | UPDATE chef_documents |
| `createPayrollBatch` / `exportPayrollBatch` | `(admin)/admin/business/payroll/page.tsx` | requireRole(owner) | INSERT batches + lines · CSV to R2 · UPDATE statuses |
| `createCorrection` | (admin) | requireRole(owner) | INSERT shift_hour_corrections |
| `approveCorrection` | (admin) | requireRole(owner) | UPDATE corrections · outbox |
| `retryOutboxRow` | `(admin)/admin/business/integrations/outbox/page.tsx` | requireRole(owner) | UPDATE integration_outbox · re-queue |
| `markNotificationRead` | (chef|client|admin) | requireAuth + ownership | UPDATE notifications.readAt |

## 3.2 — API routes

### Public

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Status JSON for uptime monitors |
| `/api/csp-report` | POST | CSP Report-Only collector |
| `/api/intake/chef` | POST | Jotform webhook (chef form) |
| `/api/intake/client` | POST | Jotform webhook (client form) |

### Auth-gated

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/[...nextauth]` | * | none/jwt | Auth.js endpoints (signin/callback) |
| `/api/chef-photo/[id]` | GET | chef-self · super_admin · **klant** (clientVisible+verified photo of a chef on their shift — PR-KLANT-3) | Presigned R2 image |
| `/api/admin/r2/upload-url` | POST | requireRole(owner) | Presigned PUT URL |

### Planned

| Route | Method | Purpose |
|---|---|---|
| `/api/chef-document/[id]` | GET | Ownership-gated download (any type, not just photo) |
| `/api/webhooks/resend` | POST | Resend delivery webhooks → email_events table |
| `/chef/calendar.ics` | GET | ICS feed for chef (token-authenticated, NOT session) |
| `/client/calendar.ics` | GET | ICS feed for klant |
| `/api/admin/integrations/retry/[outboxId]` | POST | Manual retry button for failed outbox row |
| `/api/admin/payroll/export/[batchId]` | GET | Stream CSV download (admin-only) |

## 3.3 — Workers (Railway cron)

| Worker | Schedule | Purpose | Reads | Writes |
|---|---|---|---|---|
| `workers/embedding-refresh.ts` | nightly | pgvector embeddings (currently no-op) | chefs, clients | (future) embeddings |
| `workers/error-digest.ts` | daily | Summarizes error_log → email Jezza | error_log | sendEmail |
| `workers/weekly-digest.ts` | Monday 08:00 | KPI digest → Maarten | placements, shifts | sendEmail |
| `workers/payingit-sync.ts` | TBD | (stub) Payroll API call | placements, hours | external |
| `workers/retention.ts` ✅ (supervisor JOBS, Sun 02:00 Amsterdam — PR-AVG-3) | weekly | AVG storage-limitation purge. **DOUBLE-GATED**: RETENTION_ENABLED!=="true" → disabled/exit; else RETENTION_DRY_RUN!=="false" → dry-run report; else live. Purges soft-deleted chef_documents (+ R2 bytes) / orphan chefs / clients past retention_policies period, skipping legal holds | retention_policies, chef_documents, chefs, clients, shift_hours | DELETE + R2 deleteObject + audit retention.purge_executed |
| `workers/supervisor.ts` | hourly | Health checks | * | error_log |
| `workers/generate-recurring-shifts.ts` | daily 04:00 Amsterdam (in supervisor JOBS) | Materialize recurring-template shifts (overnight-aware, idempotent) | shift_templates, shift_template_exceptions, clients | shifts |
| `workers/complete-placements.ts` ✅ (supervisor JOBS, every 30 min) | 30 min | Flip placement.confirmed → completed when endsAt+1h past, create draft shift_hours | placements, shifts | placements, shift_hours |
| `workers/document-expiry.ts` ✅ (supervisor JOBS, daily 06:00) | daily | 30d-out expiry warnings | chef_documents | notifications + sendEmail |
| `workers/deliver-outbox.ts` ✅ (supervisor JOBS, every 5 min — PR-AUDIT-5) | 5 min | Drain integration_outbox: atomically ack `internal` breadcrumbs (pending→sent) + write an integration_runs row; external providers (payroll/csv) left pending until their handler lands | integration_outbox, integration_runs | UPDATE + audit |
| `workers/hours-reminders.ts` ✅ (supervisor JOBS, daily 09:00 Amsterdam — PR-AUDIT-6) | daily | Chef 24/72h nudge (draft hours), klant 5d sign-reminder, admin 10d force-approve alert. **GATED**: HOURS_REMINDERS_ENABLED!=="true" → disabled/exit (no sends on demo data). Idempotent via audit_log stage markers | shift_hours, chefs, clients, shifts | notifications + sendPlainEmail |
| `workers/payroll-export.ts` (PLANNED) | manual | CSV batch generation | payroll_batches | R2 + payroll_batches |
| `scripts/backup-neon.sh` (PLANNED) | Monday 03:00 local launchd | pg_dump + age encrypt | (DB) | local .age file + backup_runs |
| `scripts/restore-drill.sh` (PLANNED) | first Monday monthly | Restore last backup to Neon dev branch | local backup | restore_drills |

---

# Part 4 — EVENT MAP (the linkage doc)

Every email, every in-app notification, every outbox event — single table.
The point of this map: **when wiring a new server action, check this table to see what should fire.**

## 4.1 — Emails (every send must create an `email_messages` row — PR-CHEF-8 enforcement)

| Template | Trigger | Recipient | Routable? | Audit action |
|---|---|---|---|---|
| MagicLinkEmail | signIn("resend") | identifier | no | (Auth.js) |
| PortalInviteEmail (chef) | activatePortalUser | chef.email | no | auth.portal_activated |
| PortalInviteEmail (client) | activatePortalUser | client.email | no | auth.portal_activated |
| PortalInviteEmail (internal) | inviteInternalStaff | user.email | no | auth.internal_staff_invited |
| RecoveryEmail (password) | requestRecovery 'password' | user.email | no | auth.recovery_requested |
| RecoveryEmail (totp) | requestRecovery 'totp' | user.email | no | auth.recovery_requested |
| ShiftProposedEmail | proposePlacement | chef.email | no | placements.proposed |
| ShiftConfirmedClientEmail | setPlacementStatus → confirmed | klant.email | no | placements.confirmed |
| **(planned)** ShiftConfirmedChefEmail | same | chef.email | no | placements.confirmed |
| **(planned)** ShiftCancelledByChefClientEmail | chef cancel | klant.email | no | placements.chef_cancelled |
| **(planned)** ShiftCancelledByChefAdminEmail | chef cancel | recipientsFor('placement_chef_cancelled') | YES | placements.chef_cancelled |
| **(planned)** HoursSubmittedKlantEmail | chef submitHours | klant.email | no | shift_hours.submit |
| **(planned)** HoursSignedChefEmail | klant signHours | chef.email | no | shift_hours.client_signed |
| **(planned)** HoursSignedAdminEmail | klant signHours | recipientsFor('hours_signed') | YES | shift_hours.client_signed |
| **(planned)** HoursRejectedByKlantChefEmail | klant rejectHours | chef.email | no | shift_hours.client_rejected |
| **(planned)** HoursApprovedChefEmail | admin approveHours | chef.email | no | shift_hours.admin_approved |
| **(planned)** HoursApprovedKlantEmail | admin approveHours | klant.email | no | shift_hours.admin_approved |
| **(planned)** HoursRejectedByAdminEmail | admin rejectHours | chef + klant | no (2 sends) | shift_hours.admin_rejected |
| HoursReminderChef (worker HTML) ✅ | hours-reminders 24/72h on draft | chef.email | no | shift_hours.reminder_chef (stage 24h/72h) |
| HoursReminderKlant (worker HTML) ✅ | hours-reminders 5d on submitted | klant.email | no | shift_hours.reminder_klant (stage klant_5d) |
| HoursForceApproveAdmin (worker HTML) ✅ | hours-reminders 10d on submitted | recipientsFor('hours_admin_force_approve_needed') | YES | shift_hours.reminder_klant (stage admin_10d) |
| **(planned)** ProfileChangeRequestAdminEmail | requestChange | recipientsFor('profile_change_request') | YES | chef.profile_change_requested |
| **(planned)** ProfileChangeApprovedChefEmail | approveChangeRequest | chef.email | no | chef.profile_change_approved |
| **(planned)** DocumentExpiryWarningChefEmail | cron document-expiry | chef.email | no | chef_documents.expiry_warned |
| **(planned)** PrivacyRequestAdminEmail | createPrivacyRequest | recipientsFor('privacy_request') | YES (super_admin) | privacy.request_created |
| **(planned)** PrivacyResponseUserEmail | admin fulfills | requester.email | no | privacy.request_fulfilled |

## 4.2 — In-app notifications (table `notifications`, PR-CHEF-0 creates, PR-CHEF-9 builds UI)

Each notification has: `userId`, `type`, `title`, `body`, `actionUrl`, `entityType`, `entityId`.

| Type | Recipient | Triggered by | actionUrl |
|---|---|---|---|
| `shift_proposed` | chef | proposePlacement | /chef/shifts/[placementId] |
| `shift_confirmed` | chef | setPlacementStatus→confirmed | /chef/shifts/[placementId] |
| `hours_to_log` | chef | worker creates draft | /chef/hours/[placementId] |
| `hours_to_sign` | klant | chef submitHours | /client/shifts/[shiftId]/hours |
| `hours_signed` | chef | klant signs | /chef/hours/[placementId] |
| `hours_rejected_by_klant` | chef | klant rejects | /chef/hours/[placementId] |
| `hours_ready_to_approve` | admin recipients | klant signs | /admin/business/hours |
| `hours_approved` | chef | admin approves | /chef/hours/[placementId] |
| `hours_rejected_by_admin` | chef | admin rejects | /chef/hours/[placementId] |
| `shift_cancelled_by_chef` | klant + admin | chef cancels | /client/shifts/[id] / /admin/business/shifts/[id] |
| `profile_change_request` | admin | chef requests | /admin/business/chefs/[id] |
| `profile_change_approved` | chef | admin approves | /chef/profile |
| `correction_to_review` | other admin | one admin creates | /admin/business/hours/[id] |
| `document_needs_review` | admin | chef uploads | /admin/business/chefs/[id] |
| `document_verified` / `_rejected` | chef | admin verifies | /chef/profile |
| `document_expiring_soon` | chef | cron 30d-out | /chef/profile |
| `email_bounce` | admin | Resend webhook bounce | /admin/business/chefs/[id] or clients |
| `privacy_request` | super_admin | user creates | /admin/system/privacy/[id] |
| `consent_acknowledged` | user (low-noise) | acceptConsent | / |
| `payroll_batch_ready` | admin | createPayrollBatch | /admin/business/payroll/[id] |
| `payroll_batch_exported` | admin | exportPayrollBatch | /admin/business/payroll/[id] |

## 4.3 — Outbox events (table `integration_outbox`, PR-CHEF-0)

Event types double as future webhook event names (PR-CHEF-FUT).

| eventType | Provider | Trigger | Idempotency key format |
|---|---|---|---|
| `chef.created` | payroll, accounting | INSERT chefs | `chef.created:<chefId>` |
| `chef.updated` | payroll | approveChangeRequest | `chef.updated:<chefId>:<v>` |
| `client.created` | accounting | INSERT clients | `client.created:<clientId>` |
| `shift.created` | calendar | INSERT shifts | `shift.created:<shiftId>` |
| `shift.confirmed` | calendar | setPlacementStatus→confirmed | `shift.confirmed:<placementId>` |
| `placement.cancelled_by_chef` | calendar, alerting | cancelShift | `placement.cancelled_by_chef:<placementId>` |
| `hours.submitted` | (internal) | submitHours | `hours.submitted:<hoursId>` |
| `hours.client_signed` | (internal) | signHours | `hours.client_signed:<hoursId>` |
| `hours.approved` | payroll | approveHours | `hours.approved:<hoursId>` |
| `correction.ready` | payroll | approveCorrection | `correction.ready:<corrId>` |
| `payroll_batch.exported` | payroll | exportPayrollBatch | `payroll_batch.exported:<batchId>` |
| `email.sent` | (internal) | sendEmail | `email.sent:<providerMessageId>` |

## 4.4 — Notification routing (`notification_routes` table, PR-F1 — admin events only)

Current event keys:
- `chef_submission_received` · `client_submission_received` · `client_portal_request` · `weekly_digest` · `error_critical` · `totp_lockout` · `erasure_r2_failure`

Planned additions (PR-CHEF-N):
- `hours_signed` · `hours_klant_timeout` · `hours_admin_force_approve_needed` (PR-CHEF-1)
- `placement_chef_cancelled` (PR-CHEF-5)
- `profile_change_request` (PR-CHEF-4)
- `privacy_request` (PR-CHEF-10)
- `document_needs_review` · `document_expiring_soon` (PR-CHEF-12)

## 4.5 — Klant email routing seam (`recipientsForClient()`, PR-KLANT-0)

The single path for EVERY klant transactional email. No call site in
PR-KLANT-1…5 may hard-code `client.email` — all route through here.
`src/lib/domain/client-recipients.ts`.

```
recipientsForClient(clientId, eventKey): Promise<string[]>
  V1 → [client.email]  (or [client.billingEmail] for finance events)
  V2 → resolve by client_contacts.role with fallback to client.email
```

| eventKey | V2 role(s) | V1 fallback |
|---|---|---|
| `chef_proposed` | planning, onsite | client.email |
| `hours_ready_to_sign` | hours_approval | client.email |
| `billing_email_changed` | finance | client.billingEmail |
| `client_shift_change_requested` | planning, emergency | client.email |
| `rating_pending` | planning | client.email |
| `generic` | planning | client.email |

`client_contacts` table (roles: planning · onsite · finance ·
hours_approval · emergency) exists from migration 0020 with NO UI in V1 —
it's the seam so V2 multi-recipient routing needs no migration.
AI playbook: `docs/ai/workflow-playbooks/client-contact-routing.md`.

## 4.6 — Comment visibility model (`placement_comments`, PR-KLANT-0)

`placement_comments` (migration 0020) replaces `placements.notes` blobs
for all multi-actor comments. Each row carries an explicit `visibility`.

| visibility | Who reads it (via `listVisibleComments`) |
|---|---|
| `internal` | admin only |
| `client_visible` | admin + the owning klant |
| `chef_visible` | admin + the chef on that placement |

- `author_kind` enum: client · admin · chef · system
- `body` CHECK: 1–1000 chars · trimmed · plain-text (never `dangerouslySetInnerHTML`)
- `metadata jsonb` reserved for future AI (summaries, sentiment, thread ids)
- visibility filter happens IN THE QUERY, ownership verified BEFORE it.

> AI rule (`docs/ai/rag-source-catalog.md`): never read `placements.notes`
> for klant-facing answers — use `placement_comments WHERE visibility='client_visible'`.

---

# Part 5 — Linkage checklists (use these when adding a new feature)

## ☐ Adding a new server action that mutates state

- [ ] Place under a route that already has `requireAuth()` / `requireRole()` — auth lookup pattern (session → entity ownership)
- [ ] Use atomic `UPDATE … WHERE id=? AND status='<expected>'` — reject if 0 rows
- [ ] INSERT into `audit_log` with a stable action key (`<resource>.<action>`)
- [ ] If state change should trigger external system → `enqueueIntegrationEvent()` with idempotency key
- [ ] If user should know → `createNotification(targetUser, ...)`
- [ ] If transactional email → `sendEmail()` + `recordEmailMessage()`
- [ ] If admin routable email → `recipientsFor(eventKey)` then loop
- [ ] Add to WORKFLOW.md Part 3 (Wiring map)
- [ ] Add new audit/notification/outbox keys to Part 4 (Event map)
- [ ] If new workflow → add Part 1 or Part 2 entry
- [ ] If new tool the AI should later use → add to `docs/ai/tool-contracts/`

## ☐ Adding a new email template

- [ ] Wrap with `EmailLayout` from `src/emails/_layout.tsx`
- [ ] Use `styles.h1/.para/.button` from `_layout.tsx`
- [ ] Define `recipientKind` if reused across kinds
- [ ] Always call `sendEmail()` + `recordEmailMessage()` together
- [ ] Add to WORKFLOW.md Part 4.1 table
- [ ] Mention in MEMORY.md if it's a major comms surface

## ☐ Adding a new DB table

- [ ] Define in `src/lib/db/schema.ts`
- [ ] Run `npm run db:generate -- --name <feature>` for migration
- [ ] Inspect generated SQL — check FK cascades + indexes
- [ ] Apply via `npm run db:migrate` (after local test)
- [ ] Update MEMORY.md schema state
- [ ] Add type exports at bottom of schema.ts (`export type Foo = typeof foo.$inferSelect`)
- [ ] Consider retention policy → add row to `retention_policies` seed

## ☐ Adding a new worker

- [ ] Place in `workers/` directory (Railway picks them up)
- [ ] Use `_lib.ts` patterns for DB connection
- [ ] Idempotent — running twice must be safe
- [ ] Logs structured (JSON) to stdout
- [ ] Add to Railway cron schedule
- [ ] Add to MEMORY.md workers table
- [ ] Add to WORKFLOW.md Part 3.3

## ☐ Adding a new integration

- [ ] Decide: real API or CSV adapter
- [ ] Add to `integration_connections` (rows seeded for known providers; UI in admin)
- [ ] All output via `integration_outbox` — never direct API call from a transaction
- [ ] Workers consume outbox by `provider` field
- [ ] External IDs in `external_refs`
- [ ] Add to /admin/business/integrations control room
- [ ] Document tool contract in `docs/ai/tool-contracts/integration-tools.md`

---

# Part 6 — Quick-reference indexes

## All current routes (post PR-D)

```
Public marketing:
  / · /work-with-us · /contact-us · /aanmelden · /privacybeleid
  /<17 service pages>

Auth:
  /login · /verify · /verify-2fa
  /login/forgot-password · /login/lost-2fa
  /recover/password · /recover/2fa

Admin (super_admin + owner):
  /admin · /admin/business · /admin/business/inbox
  /admin/business/chefs[/id] · /admin/business/clients[/id]
  /admin/business/shifts[/id] · /admin/business/roster
  /admin/account/{2fa,setup,setup/password,setup/2fa,setup/codes,2fa/codes,2fa/disable}
  /admin/system/{users,users/new,users/[id],roles,errors,audit,webhooks,emails,notifications,health}

Chef portal:
  /chef · /chef/profile · /chef/availability · /chef/hours · /chef/shifts · /chef/shifts/[id]

Klant portal:
  /client · /client/profile · /client/shifts · /client/shifts/[shiftId] (hub)
  /client/shifts/[shiftId]/hours · /client/requests · /client/templates · /client/request
  /client/privacy · /chef/privacy (AVG request capture, PR-AVG-1)

Admin templates (PR-KLANT-4):
  /admin/business/templates · /admin/business/templates/new · /admin/business/templates/[id]

Admin privacy (PR-AVG-1/2/3, super_admin):
  /admin/system/privacy-requests · /admin/system/privacy-requests/new · /admin/system/privacy-requests/[id]
  /admin/system/privacy-requests/[id]/download (PR-AVG-2) · /admin/system/retention (PR-AVG-3)

API:
  /api/health · /api/csp-report
  /api/auth/[...nextauth]
  /api/intake/chef · /api/intake/client
  /api/chef-photo/[id]
  /api/admin/r2/upload-url
```

## All current emails

```
MagicLinkEmail · PortalInviteEmail · RecoveryEmail
ShiftProposedEmail · ShiftConfirmedClientEmail
Hours* (9 templates, PR-CHEF-1) · ShiftConfirmedChefEmail · ShiftCancelledByChefClientEmail
BillingEmailChangedKlantEmail (PR-KLANT-1, → OLD billing address)
ClientChangeRequestAdminEmail · ClientChangeRequestOutcomeKlantEmail (PR-KLANT-2)
ChefProposedKlantEmail (PR-KLANT-3, → klant on propose)
RatingPendingKlantEmail (PR-KLANT-5, → klant after hours approved)
PrivacyRequestReceivedAdminEmail · PrivacyRequestOutcomeEmail · PrivacyRequestExtensionEmail (PR-AVG-1)
+ inline-React: client change-request admin notify · klant change outcome · submission-cancelled admin notify · klant-comment admin notify · template-change admin notify
```

## All current audit actions

```
auth.signin · auth.portal_invited · auth.portal_activated · auth.password_set
auth.totp_enrolled · auth.totp_verified · auth.totp_verify_failed
auth.totp_rate_limited · auth.totp_reset_by_admin · auth.recovery_requested
auth.password_reset · auth.totp_recovery_used · auth.internal_staff_invited
auth.invite_rejected · auth.setup_incomplete_blocked
auth.rate_limited
chef_submissions.created · chef_submissions.converted
client_submissions.created · client_submissions.converted
chefs.created · chefs.updated · clients.created · clients.updated
shifts.created · shifts.updated
placements.proposed · placements.chef_accepted · placements.chef_rejected · placements.confirmed
chef.availability_updated · chef.availability_range_updated
client.portal_request_submitted
client.profile_updated · client.change_requested · client.change_approved · client.change_rejected (PR-KLANT-1)
client_submission.cancelled_by_client (PR-KLANT-2)
client_shift_change.change_requested · .cancel_requested · .approved · .rejected (PR-KLANT-2)
placement_comments.created (PR-KLANT-0 helper, wired PR-KLANT-3: klant comment + admin reply)
shift_templates.created · .generated · .exception_added · .exception_removed · .activated · .paused (PR-KLANT-4)
client.template_change_requested (PR-KLANT-4)
ratings.created (PR-KLANT-5)
privacy.request_created · .claimed · .identity_verified · .message_logged · .request_extended · .request_withdrawn · .fulfilled · .rejected (PR-AVG-1)
privacy.export_generated · .export_download_link_created · .correction_applied · .erasure_executed · .erasure_partial (PR-AVG-2)
retention.purge_executed · retention_policies.updated (PR-AVG-3)
```

## Planned audit actions

```
shift_hours.draft_created · shift_hours.submit
shift_hours.client_signed · shift_hours.client_rejected
shift_hours.admin_approved · shift_hours.admin_rejected
shift_hours.admin_created (manual) · shift_hours.void
shift_hour_corrections.created · shift_hour_corrections.approved
placements.completed_auto · placements.chef_cancelled
chef.profile_updated · chef.profile_change_requested · chef.profile_change_approved / .rejected
chef_documents.uploaded · .verified · .rejected · .visibility_changed · .expiry_set · .expiry_warned
consent.accepted
privacy.request_created · privacy.request_fulfilled
payroll_batches.created · .exported · .voided
contact_log.created
integration.outbox_enqueued · .outbox_retried · .outbox_failed
email.message_recorded · email.event_recorded
notification.created · notification.read · notification.suppressed
backup_runs.created · backup_runs.failed
restore_drills.created
ratings.created (PR-KLANT-5)
privacy.request_created · .claimed · .identity_verified · .message_logged · .request_extended · .request_withdrawn · .fulfilled · .rejected (PR-AVG-1)
privacy.export_generated · .export_download_link_created · .correction_applied · .erasure_executed · .erasure_partial (PR-AVG-2)
retention.purge_executed · retention_policies.updated (PR-AVG-3)
```

---

# Part 7 — Cross-reference index (PR-KLANT-DOCS)

The one-stop map: **workflow ↔ route ↔ server action ↔ email ↔ notification ↔
migration ↔ AI playbook**. Use it to find where to fix or extend a behavior.
Klant phase + the hours spine are fully indexed; older chef-phase workflows
are covered by Parts 1–4 above.

## 7.1 — Klant phase (PR-KLANT-0…5)

| Workflow | Route(s) | Server action(s) / domain | Email(s) | Notification | Migration | AI playbook |
|---|---|---|---|---|---|---|
| Shift hub (canonical) §1.9 | `/client/shifts/[shiftId]` | `getClientShiftLabel` · `listVisibleComments` | — | — | 0020 | client-shift-hub.md |
| Profile editing §1.10 | `/client/profile` · admin `clients/[id]` | `saveClientProfile` · `requestClientChange` · `approve/rejectClientChange` | BillingEmailChangedKlantEmail + inline | — | 0021 | client-profile-change.md |
| Retract submission §1.11 | `/client/requests` | `cancelSubmission` → `cancelClientSubmission` | inline admin notify | — | 0022 | client-request-cancellation.md |
| Shift change/cancel §1.11 | `/client/shifts/[shiftId]` · admin `inbox` | `requestShiftChangeAction` → `createShiftChangeRequest` · `decideShiftRequest` → `decideShiftChangeRequest` | ClientChangeRequestAdminEmail · ClientChangeRequestOutcomeKlantEmail | client_shift_change_decided | 0022 | client-shift-change-request.md |
| Chef preview + comments §1.12 | hub + admin `shifts/[id]` | `proposePlacement` · `sendChefComment` · `replyComment` · `addPlacementComment` · `getMatchReasonsForPlacement` | ChefProposedKlantEmail + inline | chef_proposed | (0020 comments) | chef-preview-comment.md |
| Recurring templates §1.13 | admin `templates[/new,/[id]]` · `/client/templates` | `createTemplate` · `add/removeException` · `toggleActive` · `requestTemplateChange` · worker `generate-recurring-shifts` | template-change inline | — | 0023 | recurring-shift-template-change.md |
| Rating loop §1.14 | `/client/shifts/[shiftId]/rate` | `submitRatingAction` → `submitRating` (+ `approveHoursRow` trigger) | RatingPendingKlantEmail | rating_pending | 0024 | client-rating-feedback.md |
| Privacy fulfillment §1.15 | admin `/admin/system/privacy-requests[/new,/[id]]` · `/chef/privacy` · `/client/privacy` | `createPrivacyRequest` · `claim/setIdentity/logMessage/extendSla/withdraw/decidePrivacyRequest` | PrivacyRequest{Received,Outcome,Extension}Email | privacy_request | 0025 | privacy-request.md |
| Privacy export/correct/erase §1.15 (PR-AVG-2) | admin `/admin/system/privacy-requests/[id][/download]` | `previewUserDataExport` · `buildUserDataExport` · `createExportDownloadLink` · `previewCorrection`/`applyCorrection` · `previewUserErasure`/`eraseUserData` · `getLegalHoldsForUser` · tombstones | (reuses Outcome email) | erasure_r2_failure | 0026 | privacy-request.md |
| Retention purge §1.15 (PR-AVG-3) | worker `workers/retention.ts` · admin `/admin/system/retention` | retention worker (double-gated) · `updatePolicy` · `scripts/{seed-retention-policies,replay-erasure-tombstones}.mjs` | — | — | (uses 0026 tombstones) | retention-matrix.md · backup-erasure-policy.md |
| Roster + intelligence (Cockpit PR-1) | admin `/admin/business/roster` | `roster-format` (`getShiftHealth`/`getShiftNextAction`/`getShiftWarnings`/`getFillState` + Amsterdam-DST bucketing, tunable `DEFAULT_ROSTER_SETTINGS`) · `RosterShiftCard` | — | — | (no migration) | plan: goofy-moseying-truffle |
| Instellingen hub (Cockpit PR-1.7) | admin `/admin/account/instellingen` | `domain/user-settings` (getRosterSettings/saveRosterSettings, merge-over-defaults) · `integrations/prefs` setPref (Meldingen) · feeds roster intel + defaultView | — | (per-user notification_prefs toggles) | 0027 user_settings | plan: goofy-moseying-truffle |
| Contact routing (seam) | (no UI V1) | `recipientsForClient` | (all klant mail) | — | 0020 | client-contact-routing.md |

## 7.2 — Seam helpers (one source of truth — touch these, not call sites)

| Seam | File | Used by |
|---|---|---|
| Klant email recipients | `src/lib/domain/client-recipients.ts` | every klant transactional email |
| Visibility-scoped comments | `src/lib/domain/comments.ts` | hub thread + admin reply + chef view |
| Klant shift status labels | `src/lib/client-shift-labels.ts` | hub + dashboard |
| Match reasons | `src/lib/domain/matching.ts` `buildReasonsAndWarnings` | admin scoring + klant "Waarom voorgesteld?" |
| Rating visibility | `src/lib/domain/ratings.ts` | admin (all) · chef (N≥5) · klant (none) |
| Template date math | `src/lib/shift-template-format.ts` + worker `AT TIME ZONE` | admin preview + klant view + generation |

## 7.3 — AI assistant tool layer (LIVE — see §1.22)

The owner AI assistant is **live** (PA-V1 + 2026-06 expansion + notes-RAG + Klant 360 + oversight + parallel tool calls): 47 tools in
`src/lib/ai/tools/index.ts`, runtime in `src/lib/ai/runtime/**`, full flow in §1.22.
Design contracts: `docs/ai/tool-contracts/` (client-tools · client-request-tools ·
client-template-tools · rating-tools) · safety envelope `docs/ai/ai-safety-rules.md` ·
RAG source rules `docs/ai/rag-source-catalog.md` (NEVER read `placements.notes` for
klant-facing answers) · RAG ingestion spec `docs/ai/rag-ingestion-contract.md`
(chunked notes-RAG — **LIVE**: `src/lib/ai/rag/**` + `knowledge.search`, `ai_embeddings` store).

---

## How to update this file

- **Before** opening a PR: add new wiring rows here so reviewers can see linkage.
- **After** PR merges: update Part 1/2/3 with shipped vs planned tag.
- **When** an audit action is renamed or removed: search this file + update.
- The "Linkage checklists" (Part 5) are your pre-flight before adding anything new.
