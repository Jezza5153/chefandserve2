# Tool contracts — June 2026 additions (deep-wiring wave)

> One consolidated contract for the tools shipped in the 2026-06 expansion waves (PR #110–#145).
> Format per tool: purpose · risk/permission · input · output · invariants. The registry
> (`src/lib/ai/tools/index.ts` / `portal-index.ts`) is the source of truth for what's live;
> `scripts/smoke-ai-tools.mts` validates every entry against the RBAC catalog.

## Owner tools

### `client_onboarding.missing` — read · `clients.read`
Which klanten still miss required company data (mirror of chef `onboarding.missing`).
Input: `{ clientId? }`. Output: missing-field LABELS only (bedrijfsnaam/bezoekadres/KvK/BTW/
rechtsvorm/algemeen contact/tekenbevoegde/RI&E), least-complete first.
**Invariants:** labels only — never values; billing fields are NOT part of readiness (invoicing team).

### `demand.forecast` — read · `shifts.read`
Forward staffing outlook: open slots (headcount − confirmed) per ISO-week × role, default 6 weeks
(max 26). Output: rows/shortfalls/totalOpen. **Invariants:** forward FACTS from real shifts, not ML;
counts only, no PII; "gevuld = confirmed" matches the roster rule.

### `ratings.trends` — read · `chefs.read`
Fleet-wide quality radar (90d): declining chefs (recent 30d avg vs prior 60d, ±0.5★, min 3 ratings)
+ repeat-low chef↔klant pairs (≥2× ≤3★). **Invariants:** internal-only (ratings V1); for one chef's
ratings use `chefs.feedback`.

### `inbound.list` — read · `clients.read`
Captured inbound e-mail: sender, subject, classification (klacht/spoed/vraag/overig), inbox label.
**Invariants:** NEVER returns the body (untrusted sender content stays out of the model context);
**inherits the asking human's inbox-ACL** (`viewerInboxFilter` from `ctx.actor`) — a planner's AI
never sees the owners' boxes; super_admin sees all; senders matched staff-first → "intern".

### `feedback.review` — read · `cockpit.read`
The assistant's own report card: 👍/👎 counts (30d default) + the recent 👎 cases (capped snippets).
**Invariants:** read side of `ai_feedback`; suggests memory.remember/playbook follow-up, never
auto-changes behaviour.

### `watchdog.findings` — read · `cockpit.read`
Runs the §6 decision-point detectors on demand (stale open shifts >24h · silent chefs 30d+ ·
low ratings ≤2★ 7d). Same engine as the daily watchdog cron. **Invariants:** names+counts only.

### `system.health` — read · `integrations.read`
Platform self-check: error_log last 24h (total/unresolved/top-3 messages **truncated, never
stacks/context blobs**) + latest metrics-snapshot date.

### `inboxes.list` — read · `cockpit.read`
Inbox-access mapping: label/address/members per captured mailbox.

### `inboxes.grant_access` / `inboxes.revoke_access` — **outbound (confirm-gated)** · `system.write`
Grant/revoke a member on an inbox by LOGIN e-mail. **Invariants:** `system.write` is granted to no
role (catalog) → executor ceiling limits execution to super_admin; both audited
(`inboxes.access_granted/revoked`); revoke resolves the member via the members list.

### `shifts.create` — **outbound (confirm-gated)** · `shifts.write`
Create an OPEN shift. Input: clientId (via clients.find), startsAt/endsAt ISO, roleNeeded
(vakniveau enum), headcount?, city/location/notes?. Wraps `domain/shifts.ts createShift()` — the
SAME function the /admin/business/shifts/new page calls (one verb, one function). **Invariants:**
validates klant-exists + endsAt>startsAt; audits `shifts.create`; confirm summary renders
Amsterdam time; suggests `shifts.suggest_chefs` next.

### `memory.remember` (changed behaviour)
Cap **50 facts/user** (oldest evicted, eviction reported in the summary); dedup on normalized text
(same fact → refreshed, "Dat wist ik al"); `memory.list` reports `n/50`. Mining cron
(`ai-memory-mining`, dark) proposes facts from recent owner chats — **propose-only**, never writes.

## Portal tools (chef)

### `mijn.documenten` — read · own-scope (`ctx.actor.subject.entityId`)
Own documents: type, filename, verified, expiry (+ 60-day expiring-soon warning).

### `mijn.beoordeling` — read · own-scope
Own rating **AVERAGE only, and only at ≥5 ratings** (V1 house rule) — never individual ratings,
comments, or per-klant detail. Below 5: "nog te weinig beoordelingen (n van 5)".

## Cross-cutting invariants (this wave)
- All three chat surfaces get the **time-context block** (Amsterdam now + ISO week) via the dynamic
  trailing message — never in the cached system-prompt prefix.
- **AI_DAILY_BUDGET** (env, price-currency) hard-stops new turns at 100% (80% warning notification);
  **circuit breaker** (3 provider failures/10min → 5min pause) + **OPENAI_FALLBACK_MODEL** one-retry.
- The eval (66 cases: 38 golden · 12 chaos · 4 multi-turn · 12 safety) runs in CI on every
  AI-touching PR (`.github/workflows/ai-eval.yml`, model pinned, paced).
