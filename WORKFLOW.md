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
(shared with `findMatchesForShift` — one source of truth). Photo display for
klanten is deferred (needs chef-photo API authz for clientVisible+verified).
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

## 2.3 — Profile change request (PR-CHEF-4)

```
/chef/profile → "Verzoek wijziging" on locked field (rate / vakniveau / name / email)
   ↓
   requestChange(field, proposedValue, reason)
   ↓
   INSERT profile_change_requests (status='pending')
   AUDIT: 'chef.profile_change_requested'
   createNotification(admin recipients, 'profile_change_request')
   sendEmail(ProfileChangeRequestAdminEmail)
   ↓
ADMIN: /admin/business/chefs/[id] → "Wijzigingsverzoeken" tab → approve/reject
   ↓
   approveChangeRequest(reqId, decisionNotes) OR rejectChangeRequest(...)
   ↓
   ON approve:
     UPDATE chefs SET <field>=proposedValue
     UPDATE profile_change_requests SET status='approved', decidedAt, decidedBy
     AUDIT: 'chef.profile_change_approved'
     enqueueIntegrationEvent('chef.updated')  ← future Payingit rate sync
     createNotification(chef.user, 'profile_change_approved')
     sendEmail(ProfileChangeApprovedChefEmail)
   ON reject: similar, status='rejected', no chef field change
```

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
| `approveChangeRequest` / `rejectChangeRequest` | admin chef detail | requireRole(owner) | UPDATE chefs · UPDATE profile_change_requests · email |
| `cancelShift` (chef) | `(chef)/chef/shifts/[placementId]/page.tsx` | requireAuth + chefSelf | UPDATE placements · outbox · 2 emails |
| `logContact` | (admin shift/chef detail) | requireRole(owner) | INSERT contact_logs |
| `acceptConsent` | `(chef)/chef/_components/ConsentGate.tsx` server action | requireAuth | INSERT consent_log |
| `createPrivacyRequest` | `(chef)/chef/privacy/page.tsx` | requireAuth | INSERT privacy_requests |
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
| `/api/chef-photo/[id]` | GET | requireAuth + ownership-or-admin | Presigned R2 image |
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
| `workers/retention.ts` | (stub) | AVG retention purging | * | DELETE per retention_policies |
| `workers/supervisor.ts` | hourly | Health checks | * | error_log |
| `workers/generate-recurring-shifts.ts` | daily 04:00 Amsterdam (in supervisor JOBS) | Materialize recurring-template shifts (overnight-aware, idempotent) | shift_templates, shift_template_exceptions, clients | shifts |
| `workers/complete-placements.ts` (PLANNED) | 30 min | Flip placement.confirmed → completed when endsAt+1h past, create draft shift_hours | placements, shifts | placements, shift_hours |
| `workers/hours-reminders.ts` (PLANNED) | daily | Chef nudges + klant timeouts + admin alerts | shift_hours | createNotification + sendEmail |
| `workers/document-expiry.ts` (PLANNED) | daily | 30d-out expiry warnings | chef_documents | notifications + sendEmail |
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
| **(planned)** HoursReminderChefEmail | cron 24/72h after completed | chef.email | no | shift_hours.reminder_chef |
| **(planned)** HoursReminderKlantEmail | cron 5d after submit | klant + admin cc | YES (admin cc) | shift_hours.reminder_klant |
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

Admin templates (PR-KLANT-4):
  /admin/business/templates · /admin/business/templates/new · /admin/business/templates/[id]

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
+ inline-React: client change-request admin notify · klant change outcome · submission-cancelled admin notify · klant-comment admin notify
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
```

---

## How to update this file

- **Before** opening a PR: add new wiring rows here so reviewers can see linkage.
- **After** PR merges: update Part 1/2/3 with shipped vs planned tag.
- **When** an audit action is renamed or removed: search this file + update.
- The "Linkage checklists" (Part 5) are your pre-flight before adding anything new.
