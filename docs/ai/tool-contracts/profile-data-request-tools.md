# Tool Contracts — Profile Data Requests

> Admin-initiated "vul je gegevens aan" requests: the office asks a chef/klant to
> complete missing profile fields (via email/WhatsApp/phone channel), then tracks
> status. Wraps `src/lib/domain/profile-data-requests.ts` +
> `src/lib/domain/profile-completeness.ts`. Read + assisted_execute (admin).

---

## Tool: profile_data_request.list

### Purpose
List outstanding data requests + each subject's completeness %, so the PA can say
"3 chefs missen nog hun postcode".

### Inputs
- subjectKind?: 'chef' | 'client'
- status?: 'draft' | 'sent' | 'completed' | 'expired' | 'failed'

### Required role
`owner` | `super_admin` (read).

### Read scope
`profile_data_requests`, `chefs`/`clients` (for `getProfileCompleteness`).

### Write scope
(none)

### Confirmation requirement
`read` (Mode 1).

### Audit events
`ai.profile_data_request.list`.

---

## Tool: profile_data_request.draft

### Purpose
Draft a request (which fields are missing, suggested channel + message) WITHOUT
sending — the human reviews.

### Inputs
- subjectKind: 'chef' | 'client'
- subjectId: string
- fields?: string[] — default = the missing fields from completeness

### Required role
`owner` | `super_admin`.

### Read scope
`getProfileCompleteness` → missing fields.

### Write scope
(none — draft only)

### Dry-run result shape
`{ subjectId, missingFields, suggestedChannel, draftMessage }`

### Confirmation requirement
`draft` (Mode 2).

### Audit events
`ai.profile_data_request.draft`.

---

## Tool: profile_data_request.create

### Purpose
Create + send the request after explicit confirm. The actual "fill in" is done by
the subject; this only asks.

### Inputs
- subjectKind: 'chef' | 'client'
- subjectId: string
- requestedFields: string[]
- channel: 'email' | 'whatsapp' | 'phone'

### Required role
`owner` | `super_admin`.

### Write scope
`profile_data_requests` (insert). Audit: `profile_data_request.created`.

### Preconditions
Subject exists; not erased (AVG tombstone check).

### Side effects
Outbox/email for email channel; in-app notification; `audit_log`.

### Confirmation requirement
`assisted_execute` (Mode 3).

### Audit events
`ai.profile_data_request.create` + `profile_data_request.created`.

### Rollback strategy
Soft-cancel the request row (status → expired); no data was changed on the subject.

---

## Hard rules

1. This asks the subject to fill data — it never WRITES the subject's profile.
   Profile edits go through `profile-tools.md` (chef/client own; admin direct).
2. Not destructive → allowed during impersonation + (future) PA assisted_execute,
   audited as the actor.
3. Channel = how we ask; respects the subject's notification routing.
