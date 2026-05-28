# Workflow Catalog

> Index of every workflow playbook in [`workflow-playbooks/`](./workflow-playbooks/). Each playbook follows the template documented in [`README.md`](./README.md).

The point of a playbook is so the AI can answer "what happens when X?" without inventing a flow. Every playbook cites the corresponding section in [`../../WORKFLOW.md`](../../WORKFLOW.md), the audit keys, the notifications fired, and what the AI is allowed to read / draft / execute.

---

## Catalog

| # | Playbook | WORKFLOW.md reference | Ships with PR |
|---|---|---|---|
| 1 | [Hours trust chain](./workflow-playbooks/hours-trust-chain.md) | Part 2.1 | PR-CHEF-1 |
| 2 | [Shift proposal → accept → confirm](./workflow-playbooks/shift-proposal-accept-confirm.md) | Part 1.6 | (currently live) |
| 3 | [Chef cancellation (severity tiers)](./workflow-playbooks/chef-cancellation.md) | Part 2.2 | PR-CHEF-5 |
| 4 | [Client hours signing](./workflow-playbooks/client-hours-signing.md) | Part 2.1 (sub-flow) | PR-CHEF-1 |
| 5 | [Admin bulk hours approval](./workflow-playbooks/admin-bulk-approval.md) | Part 2.1 (sub-flow) | PR-CHEF-3 |
| 6 | [Profile change request](./workflow-playbooks/profile-change-request.md) | Part 2.3 | PR-CHEF-4 |
| 7 | [Payroll export (CSV batch)](./workflow-playbooks/payroll-export.md) | Part 2.1 final stage | PR-CHEF-7 |
| 8 | [AVG consent gate](./workflow-playbooks/avg-consent.md) | Part 2.5 | PR-CHEF-10 |
| 9 | [Privacy request (inzage / correctie / verwijdering / export)](./workflow-playbooks/privacy-request.md) | Part 2.6 | PR-CHEF-10 |
| 10 | [Backup + restore drill](./workflow-playbooks/backup-restore.md) | Part 3.3 (workers) | PR-CHEF-13 |

### Klant (hotel) workflows — PR-KLANT phase

| # | Playbook | WORKFLOW.md reference | Ships with PR |
|---|---|---|---|
| 11 | [Client shift hub (single source of truth)](./workflow-playbooks/client-shift-hub.md) | Part 2 (klant) | PR-KLANT-0 |
| 12 | [Client profile change (direct vs. request)](./workflow-playbooks/client-profile-change.md) | Part 2.3 (klant) | PR-KLANT-1 |
| 13 | [Client request cancellation (pending submission)](./workflow-playbooks/client-request-cancellation.md) | Part 1.7 / 2 (klant) | PR-KLANT-2 |
| 14 | [Client shift change / cancel request](./workflow-playbooks/client-shift-change-request.md) | Part 2 (klant) | PR-KLANT-2 |
| 15 | [Chef preview + klant comment (view + comment, no veto)](./workflow-playbooks/chef-preview-comment.md) | Part 2 (klant) | PR-KLANT-3 |
| 16 | [Recurring shift template change (admin-owned)](./workflow-playbooks/recurring-shift-template-change.md) | Part 2 / 3.3 (klant) | PR-KLANT-4 |
| 17 | [Client rating / feedback (internal-only, tags)](./workflow-playbooks/client-rating-feedback.md) | Part 2 (klant) | PR-KLANT-5 |
| 18 | [Client contact routing (recipientsForClient)](./workflow-playbooks/client-contact-routing.md) | Part 4 (routing) | PR-KLANT-0 |

Matching tool contracts: [`client-tools.md`](./tool-contracts/client-tools.md), [`client-request-tools.md`](./tool-contracts/client-request-tools.md), [`client-template-tools.md`](./tool-contracts/client-template-tools.md), [`rating-tools.md`](./tool-contracts/rating-tools.md).

### Operator / AI-assistant workflows — impersonation + AI-PA phase

| # | Playbook | Reference | Ships with |
|---|---|---|---|
| 19 | [Act as a user to fix a setting (Bekijk als)](./workflow-playbooks/act-as-user-to-fix-setting.md) | impersonation modules | write-impersonation phase |
| 20 | [AI changes a setting (PA assisted-execute)](./workflow-playbooks/ai-changes-a-setting.md) | [`ai-pa-access-model.md`](./ai-pa-access-model.md) | Layer 4 (PA) |

Matching tool contracts: [`impersonation-tools.md`](./tool-contracts/impersonation-tools.md), [`cockpit-tools.md`](./tool-contracts/cockpit-tools.md), [`system-tools.md`](./tool-contracts/system-tools.md), [`matching-tools.md`](./tool-contracts/matching-tools.md), [`profile-data-request-tools.md`](./tool-contracts/profile-data-request-tools.md), [`client-taxonomy-tools.md`](./tool-contracts/client-taxonomy-tools.md).

---

## Cross-cutting concerns (covered in every playbook)

Each playbook addresses:

- **Atomic transitions** — every status change uses `UPDATE … WHERE id = ? AND status = '<expected>'` and rejects if 0 rows updated.
- **Outbox first** — external side effects go through `integration_outbox`, not direct API calls.
- **Idempotency** — every outbox event has a deterministic idempotency key on `(eventType, entityId, action)`.
- **Audit log** — every mutation writes to `audit_log` with a stable action key.
- **Notifications** — in-app + email, routed per `notification_routes` when applicable.
- **Human labels** — UI never shows raw enum; uses `humanStatus()` from `src/lib/hours-labels.ts`.
- **AI surface** — what the AI may read, draft, assist-execute, or never do.

---

## Workflows NOT in this catalog (intentionally)

Workflows that exist but don't yet have an AI surface (the AI doesn't act on them):

- Auth flows: signin, magic-link, password reset, 2FA enrollment + reset. The AI can REFER users to these flows but never executes them. See `tool-contracts/` — there's no `auth.*` write tool for AI.
- Internal staff invite. Same — refer-only.
- Public marketing pages (handled by CMS).
- Jotform webhook ingestion (system-side; AI reads triaged inbox, not raw webhook).

These remain documented in `WORKFLOW.md` Parts 1.1–1.5 but don't need their own AI playbook.

---

## How to add a new playbook

1. Copy the template from `README.md` (or any existing playbook).
2. Cite the matching section in `WORKFLOW.md`.
3. List the source tables touched.
4. Fill in the **allowed transitions** table.
5. Be explicit about **AI must never do** — when in doubt, list it.
6. Add to the table above.
7. Reflect any new audit keys in `ai-audit-and-logging.md`.
8. Add at least 2 golden tests to `ai-evaluation-set.md` exercising the new flow.

---

## Co-evolution rule

When a PR-CHEF-N ships its code, it ALSO ships the body of its playbook. The base playbook files in PR-AI-0 exist with the template + skeletal content; the feature PR fills in the operational detail (allowed transitions, real audit keys, real notification keys).

| PR | Adds / updates playbook |
|---|---|
| PR-CHEF-1 | `hours-trust-chain.md` · `client-hours-signing.md` |
| PR-CHEF-3 | `admin-bulk-approval.md` |
| PR-CHEF-4 | `profile-change-request.md` |
| PR-CHEF-5 | `chef-cancellation.md` |
| PR-CHEF-7 | `payroll-export.md` |
| PR-CHEF-10 | `avg-consent.md` · `privacy-request.md` |
| PR-CHEF-13 | `backup-restore.md` |
| PR-KLANT-0 | `client-shift-hub.md` · `client-contact-routing.md` (+ all 8 base bodies scaffolded) |
| PR-KLANT-1 | `client-profile-change.md` |
| PR-KLANT-2 | `client-request-cancellation.md` · `client-shift-change-request.md` |
| PR-KLANT-3 | `chef-preview-comment.md` |
| PR-KLANT-4 | `recurring-shift-template-change.md` |
| PR-KLANT-5 | `client-rating-feedback.md` |
