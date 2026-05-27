# Tool contracts: Notifications + email

> Tools for drafting, sending, listing, and marking notifications + transactional emails. See [`../workflow-playbooks/`](../workflow-playbooks/) for the workflows that fire these.

---

## Tool: `notifications.list_unread`

### Purpose
Show the caller's unread in-app notifications.

### Inputs
- limit: int (default 20, max 100)

### Required role
any authed.

### Allowed user kinds
internal · chef · client

### Read scope
`notifications` WHERE `userId = caller.id` AND `readAt IS NULL`. Admin may pass `userId` to read another's (audit-logged).

### Write scope
None.

### Result shape
```jsonc
{
  "unread": [
    { "id": "...", "type": "hours_to_sign", "title": "...", "body": "...", "actionUrl": "/client/shifts/.../hours", "createdAt": "..." }
  ],
  "totalUnread": 3
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.notifications.list_unread`

---

## Tool: `notifications.mark_read`

### Purpose
Mark a notification as read.

### Inputs
- notificationId: uuid

### Required role
any authed (own notification only — admin cannot mark someone else's read).

### Allowed user kinds
internal · chef · client

### Write scope
`UPDATE notifications SET readAt=now() WHERE id=? AND userId=caller.id AND readAt IS NULL`.

### Preconditions
- Notification exists, owned by caller.

### Side effects
- audit `notification.read` (small).

### Confirmation requirement
`autonomous` (Mode 4 — safe action, reversible only in the trivial sense of "still in DB"; the user's own data).

### Audit events
- `ai.notifications.mark_read`
- `notification.read`

### Rollback strategy
n/a (could set `readAt` back to null via DB, but no UI for it).

---

## Tool: `notifications.draft_message`

### Purpose
Draft a message (email + in-app body) for a recipient. Does not send.

### Inputs
- recipientType: enum `chef` | `klant` | `admin`
- recipientId: text (chef/client id, or `user.id` for admin)
- intent: enum `reminder` | `apology` | `clarification` | `info` | `acknowledgement`
- contextEntityType: enum `placement` | `shift_hours` | `shift` | `chef` | `client` | `none`
- contextEntityId: text (matches the type)
- toneHint: text (optional, free-text guidance)

### Required role
owner | super_admin (admins draft messages to others)

### Allowed user kinds
internal

### Read scope
Caller's RBAC + context entity for grounding.

### Write scope
None (draft only).

### Result shape
```jsonc
{
  "emailDraft": { "subject": "...", "body": "..." },
  "inAppDraft": { "title": "...", "body": "..." },
  "recipient": { "userId": "uuid", "email": "...", "kind": "chef" },
  "context": { "type": "shift_hours", "id": "...", "summary": "..." },
  "draftId": "uuid"  // ephemeral; in-memory only, expires 30 min
}
```

### Confirmation requirement
`draft` — never sends.

### Audit events
`ai.notifications.draft_message`

### Rollback strategy
n/a (no mutation).

---

## Tool: `notifications.send`

### Purpose
Send a drafted message (email + in-app).

### Inputs
- draftId: uuid (from `notifications.draft_message`) OR inline fields:
- recipientUserId: uuid
- emailSubject: text
- emailBody: text
- inAppTitle: text
- inAppBody: text
- emailTemplate: text (template key, e.g. "AdminAdHocMessage")

### Required role
owner | super_admin (future bookkeeper for finance-specific sends)

### Allowed user kinds
internal

### Read scope
Recipient user row (for email + UI links).

### Write scope
- INSERT `email_messages` (status='queued').
- INSERT `notifications`.
- Calls `sendEmail()` (downstream → Resend) + `recordEmailMessage()` + `createNotification()`.

### Preconditions
- Caller has permission to message that recipient (e.g. admin → any user; chef/klant cannot use this tool to message another chef/klant).
- Recipient is `active`.
- Per-recipient rate-limit (max 5 ad-hoc messages per recipient per day from same sender).

### Side effects
- audit `notification.created` + `email.message_recorded`.
- Email sent via Resend (status updated by webhook later → `email_events`).

### Dry-run result shape
```jsonc
{
  "wouldSend": { "to": "daniel@example.com", "subject": "...", "channel": "email + in-app" },
  "wouldInsertNotification": { "userId": "...", "type": "ad_hoc" }
}
```

### Confirmation requirement
`assisted_execute`. Admin clicks "Verstuur nu" with confirmation copy showing exact recipient + subject.

### Audit events
- `ai.notifications.send`
- `notification.created`
- `email.message_recorded`

### Rollback strategy
None for sent emails. Admin sends a follow-up if needed.

---

## Tool: `email.read_status`

### Purpose
Check delivery status of a previously sent email.

### Inputs
- emailMessageId: uuid (or providerMessageId from Resend)

### Required role
owner | super_admin (sender + recipient + admins; non-admins can read own emails only)

### Allowed user kinds
internal

### Read scope
`email_messages` + joined `email_events`.

### Write scope
None.

### Result shape
```jsonc
{
  "emailMessageId": "...",
  "to": "daniel@example.com",
  "subject": "...",
  "status": "delivered",        // queued · sent · delivered · bounced · complained · failed
  "events": [
    { "event": "queued", "at": "..." },
    { "event": "delivered", "at": "..." }
  ]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.email.read_status`

---

## Tool: `notifications.draft_admin_digest`

### Purpose
Draft the weekly admin digest (KPIs + queue + flags). Replacement for current `workers/weekly-digest.ts` content.

### Inputs
- period: enum `weekly` | `daily` | `monthly`

### Required role
owner | super_admin

### Allowed user kinds
internal

### Read scope
Aggregate over `placements`, `shift_hours`, `chef_documents`, `email_events`, `error_log`, `notifications`.

### Write scope
None (draft).

### Result shape
```jsonc
{
  "kpis": { "openShifts": 4, "pendingHours": 12, "documentsExpiringSoon": 2 },
  "flags": ["3 chefs hebben 30 dagen niet ingelogd", "1 outbox event failed twice"],
  "draftSubject": "Wekelijkse update Chef & Serve",
  "draftBody": "..."
}
```

### Confirmation requirement
`draft` (digest is shown to admin; sending uses `notifications.send`).

### Audit events
`ai.notifications.draft_admin_digest`

---

## Boundaries

### What none of these tools may do

- **Send mass communications without per-recipient confirmation.** A bulk send to 200 chefs is NOT a single AI call; admin curates per recipient.
- **Email chefs on behalf of klanten (or vice versa) without admin in the loop.** Chef-to-klant comms route through admin.
- **Resend an already-delivered email** without explicit reason + audit.
- **Send emails outside business hours** without explicit "this is urgent" flag from admin.
- **Tamper with `email_events`** — that's webhook-write only.

### What `chef` and `client` roles can do here

- `notifications.list_unread` — own only.
- `notifications.mark_read` — own only.
- Nothing else. Chefs and klanten don't draft + send messages to others; they communicate via the standard workflows (request, reject, etc.) which fire their own emails.
