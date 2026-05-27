# Workflow: Privacy request (inzage / correctie / verwijdering / export)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.6**. Ships with PR-CHEF-10.

## Purpose

Under the AVG, every user has rights:
- **Inzage** (right of access) — what data do you hold on me?
- **Correctie** (right to rectification) — correct inaccurate data.
- **Verwijdering** (right to erasure / "right to be forgotten") — delete my data.
- **Overdraagbaarheid** (right to data portability / export) — give me my data in a portable format.

The privacy request workflow gives users a structured way to invoke these rights, with a 30-day SLA. `super_admin` only handles requests; other admins do not.

V1 is a **manual workflow** — request comes in, super_admin reviews, generates response (a PDF or data file), uploads to R2, marks fulfilled. Full automation (auto-erasure cascade) is out of scope for V1; flagged for PR-CHEF-FUT.

---

## Actors

- **User** (chef or klant or internal) — creates the request.
- **`super_admin`** — fulfills the request. Other admin roles cannot.
- **System** — emails + audit + SLA tracking.

---

## Source tables

- `privacy_requests` — the request record. Columns include `userId`, `type`, `reason`, `status`, `dueDate (now + 30d)`, `responseFileUrl`, `handledBy`, `decisionNotes`.
- `users` — caller.
- R2 — response files at `privacy/<requestId>/<filename>`.
- `email_messages` — both intake confirmation + response delivery.
- `audit_log`.

---

## Request types

| Type | Dutch label | What admin does |
|---|---|---|
| `inzage` | "Inzage in mijn gegevens" | Run export of user's rows from app DB + Payingit info (where applicable); produce PDF/JSON; upload to R2; deliver. |
| `correctie` | "Gegevens corrigeren" | Identify the field(s); update via the right flow (e.g. profile change request flow OR direct admin edit). Confirm to user. |
| `verwijdering` | "Mijn gegevens verwijderen" | Manual cascade: soft-delete the user's master row; delete embeddings; revoke active sessions; coordinate with Payingit for their side. |
| `export` | "Mijn gegevens exporteren (overdraagbaarheid)" | Same as `inzage` but in machine-readable JSON. |

---

## Human status labels

`privacy_requests.status`:

| Backend | Dutch label |
|---|---|
| `pending` | "In behandeling" |
| `in_progress` | "Wordt verwerkt" |
| `fulfilled` | "Voldaan" |
| `rejected` | "Afgewezen" (rare; only for clearly unauthenticated requests) |

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `pending` | user (own) | user is authed; type specified; optional reason | `createPrivacyRequest(type, reason)` |
| `pending` | `in_progress` | `super_admin` | row is `pending`; admin marks they're working it | `claimPrivacyRequest(reqId)` |
| `in_progress` | `fulfilled` | `super_admin` | response file uploaded to R2; `responseFileUrl` set; user notified | `fulfillPrivacyRequest(reqId, responseFileUrl, decisionNotes)` |
| `pending` / `in_progress` | `rejected` | `super_admin` | reason required (e.g. "could not verify identity") | `rejectPrivacyRequest(reqId, decisionNotes)` |

SLA: `dueDate = createdAt + 30 days`. After 30 days unfulfilled, status auto-flags as `overdue` in admin UI (not a separate enum state — a derived flag).

---

## AI can read

Through `privacy.list_requests`:

- For caller: own requests + their status.
- For `super_admin`: all requests with SLA visibility.
- For other admins (`owner`): NOT visible. This is super_admin-only territory.

The AI may surface: "Je inzage-verzoek van 1 mei is in behandeling; deadline 31 mei."

---

## AI can draft

- **User-side**: explanation of what each request type means + which is appropriate for their situation.
- **`super_admin`-side**:
  - Draft response intro letter (in Dutch) for `inzage` / `export`.
  - Checklist of tables to extract per user.
  - Draft erasure plan: list of rows to soft-delete + side effects (embeddings, sessions, R2 files).
  - Draft rejection letter with reason.
- **Aggregate reporting**: "3 verzoeken openstaan; oudste 12 dagen oud (deadline 31 mei)."

---

## AI can execute only after explicit human confirmation

- **`privacy.create_request`** — user clicks "Verzoek indienen" on `/chef/privacy` or `/client/privacy`. AI may help format the reason. Audit: `ai.privacy.create_request`.
- **`privacy.claim`** — super_admin clicks "Pak op". Audit: `ai.privacy.claim`.
- **`privacy.fulfill`** — super_admin uploads response file, types decisionNotes, clicks "Markeer als voldaan". Audit: `ai.privacy.fulfill`.
- **`privacy.reject`** — super_admin clicks "Wijs af" with reason. Audit: `ai.privacy.reject`.

For `verwijdering` requests, the actual erasure cascade is a **multi-step manual checklist** in V1 — the AI may track which steps are done, but each mutation (soft-delete chef, soft-delete user, delete embeddings, revoke sessions, etc.) is a separate explicit click.

---

## AI must never do

- **Fulfill a request autonomously.** Even with confirmation, the response file must be reviewed.
- **Skip identity verification** for erasure requests. A bad-faith erasure request (someone trying to wipe a chef they don't own) is a high-risk scenario; super_admin must verify the requester is the data subject.
- **Quote response PDFs to other users.** Response files are private to the requester + super_admin.
- **Estimate the SLA leniently.** 30 days is 30 days, not "around a month".
- **Trigger an erasure without checking external system coupling.** Payingit may need the chef's employee record retained for tax reasons (7+ years in NL). Admin coordinates legally before app-side cascade.
- **Conceal that erasure may be incomplete.** Some data lives in Payingit and is outside our control; the response letter must say so.

---

## Audit keys

System:

- `privacy.request_created`
- `privacy.request_claimed`
- `privacy.request_fulfilled` (with `responseFileUrl` + checksum in payload)
- `privacy.request_rejected`
- `privacy.erasure_cascade_step` (per step in the manual cascade; e.g. `step: 'soft_delete_chef'`, `step: 'purge_embeddings'`)

AI-assisted:

- `ai.privacy.create_request`
- `ai.privacy.claim`
- `ai.privacy.fulfill`
- `ai.privacy.reject`
- `ai.privacy.draft_response`

---

## Notifications

Per `WORKFLOW.md` Part 4.1 + 4.4:

| Event | In-app type | Email template |
|---|---|---|
| User creates | `privacy_request` to super_admin recipients | `PrivacyRequestAdminEmail` |
| Admin fulfills | (in-app to user) | `PrivacyResponseUserEmail` |
| Admin rejects | (in-app to user) | (planned) `PrivacyRejectionUserEmail` |
| SLA approaching (5d before due) | (in-app to super_admin) | (planned) |
| SLA breached | (in-app + email to super_admin) | (planned) urgent |

Routing event key: `privacy_request` (super_admin only).

---

## Edge cases

- **Duplicate request from same user, same type, while one is pending**: server rejects. UI says "je hebt al een openstaand verzoek".
- **User accounts for chef + klant under same email**: privacy requests are USER-scoped, so the request covers the data linked to that user. AI must explain if the user holds multiple kinds.
- **Erasure but user has active placements**: super_admin coordinates with chef on whether to complete active placements first. AI surfaces the open placements: "Daniel heeft 2 open placements. Pre-erasure: review."
- **Inzage on a user who is no longer in our system** (soft-deleted): super_admin can still access the soft-deleted row (data retained for legal reasons until retention policy purges). AI: "Daniel is soft-deleted op 1 maart. Data is nog beschikbaar tot retentie-deadline 1 maart 2033 (legal hold)."
- **Cross-jurisdictional**: out of scope V1. NL/EU only.
- **Bulk export for super_admin** ("give me all chef data for legal request"): NOT through privacy requests; that's a separate admin tool.
- **AVG breach detection** (PR-CHEF-FUT): unrelated workflow; not in this playbook.

---

## Example user commands

### User (chef / klant)

- "Welke gegevens hebben jullie over mij?" → AI: "Wil je een formeel inzage-verzoek indienen? Dan krijg je binnen 30 dagen een gestructureerd overzicht. Klik [Verzoek indienen]."
- "Verwijder al mijn data" → AI: "Een verwijderingsverzoek is een formeel proces. Lees eerst wat dit betekent (sommige data moet wettelijk bewaard blijven voor belasting). Wil je een verzoek indienen? [Lees meer en dien in]."
- "Wat is de status?" → AI reads own requests.

### super_admin

- "Welke privacy-verzoeken zijn openstaand?" → AI lists with SLA.
- "Help me een inzage-rapport opstellen voor verzoek X" → AI drafts the structure: "Hier is een voorbeeld-tekst van een inleidende brief + een lijst van tabellen waar Daniel's data leeft + een conceptindeling voor de PDF. Bewerk + upload zelf."
- "Markeer verzoek X als voldaan" → AI: "Heb je het responsbestand geüpload naar R2? Wat staan er in de decisionNotes? [Markeer als voldaan]".

---

## Expected AI answer style

- **Be specific about timelines**: "30 dagen vanaf datum verzoek", with the actual deadline date.
- **Educate before acting**: explain the type of request and its implications.
- **Cite the request id**: "Verzoek `privreq #abc-123`."
- **Never minimise erasure consequences** (e.g. "alles wordt weg" — instead: "binnen onze app wordt het soft-deleted; Payingit bewaart voor 7 jaar voor belasting").
- **For super_admin**: always include the SLA marker (days left or overdue).
- **Refuse oversharing**: even within an admin context, response files are super_admin-only territory.

---

## What this workflow protects against

1. **Legal liability**: AVG fines for non-response within 30 days.
2. **Bad-faith erasure**: identity-verification step prevents impersonation.
3. **Cross-user leakage**: response files locked to requester + super_admin only.
4. **Mistaken auto-erasure**: AI never executes the cascade; super_admin clicks each step.
5. **Incomplete erasure**: documented response includes scope (app DB) and explicit out-of-scope (Payingit retention).

If the AI ever helps create a privacy request for someone other than the caller, that's a P0 boundary failure. Identity verification = `session.user.id === request.userId` always.
