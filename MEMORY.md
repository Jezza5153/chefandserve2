# Chef & Serve — MEMORY.md

> Single source of truth for "what's in this codebase right now". Updated after every PR ships.
> If you're an AI agent or a new dev opening this repo for the first time, **read this first**.

## ▶ Resuming in a fresh chat / new dev?

Read in this order: **CLAUDE.md → MEMORY.md (this file) → WORKFLOW.md**, then
`docs/ai/` before any AI work. The active plan is at
`~/.claude/plans/goofy-moseying-truffle.md`. Everything shipped is in the **PR
ledger** below; anything planned-but-not-built is flagged ⏳ or noted under
"Open questions". You can pick up mid-phase from here with zero prior context —
each PR shipped with a migration, a `scripts/smoke-*.mjs`, and WORKFLOW.md
linkage. The hotel (klant) phase is **fully shipped** (PR-KLANT-0…5 + DOCS).

**Last updated:** **AI-capabilities sprint — owner assistant now 48 tools + parallel tool-calls + a runnable eval harness** — **SHIPPED TO PROD (PR #81–#85, NO migration).** (1) **Bigger brain, efficiënter (#82):** the brain now **batches independent tools into one round-trip** and the agent loop runs them concurrently (`Promise.all` in `src/lib/ai/runtime/agent.ts`), pausing on the confirm-gate for any *action* in a mixed batch — verified live (gpt-5.4 pulled `business.overview`+`roster.overview` in one turn). Back-compatible with scripted single-`tool_call` brains; `openai-brain.ts` emits/parses the full `tool_calls` array. (2) **+6 oversight read tools** exposing the Restricted, tool-only data RAG never indexes: `audit.search` · `documents.list_for_chef` · `documents.expiring` (all chefs, soonest-first) · `privacy.list_requests` · `email.status` (delivery/bounce, **no bodies**) · `payroll.read` (batches + marge). All read-only, **permission-gated** (audit/chefs/privacy/emails/payroll `.read`), **metadata/aggregate-only** — the read-models (`src/lib/ai/read-model/oversight.ts`) strip bytes/payloads/raw text. (3) **Runnable eval harness** `scripts/eval-ai.mts` (#84): golden routing + safety-refusal against the **real brain** (planning-only, ~15 calls, no execution/DB writes) — **15/15** live. The release regression net: prompt-injection · "negeer de veiligheidsregels" · mass-send · consent-on-behalf · exported-row-mutation all **refuse in words**; "keur alle uren goed" + "annuleer Daniels dienst" **read first**. The eval *surfaced* the `documents.expiring` gap (G5 had no global route) and then *confirmed* the fix (#85). Census **48 tools (29 read / 13 act / 6 personal)**. Gate: type-check 0 · `smoke-ai-tools` 184/0 · `smoke-ai-safety` 68/0 · `eval-ai` 15/15 · `smoke-ai-spine` 36/0 · `smoke-ai-brain` 28/0 · lint+build green. Docs: `docs/ai/ai-evaluation-set.md` marks the harness live; `WORKFLOW.md` §1.22 + §7.3 updated. ⚠ **OpenAI key rotation STILL pending (owner)** — prod `*.semantic_search`/`knowledge.search` depend on it; Railway `OPENAI_API_KEY` + DB-branch confirm still open. ⚠ WhatsApp (sent.dm) sender built but **awaits Meta template approval** before wiring triggers + a `whatsapp.send` tool; the email templates (`src/emails/*`) are owned by **another chat — DO NOT TOUCH**.

**Prior — Chunked + PII-redacted notes-RAG (Stage 2)** — **SHIPPED TO PROD** (manual migration `drizzle/manual_ai_embeddings.sql` applied via `scripts/apply-ai-embeddings.mts`: new **`ai_embeddings`** table — `vector(1536)` + HNSW cosine index + soft-supersede). The owner assistant gained a **`knowledge.search`** tool (census now **38 tools — 22 read / 10 act / 6 personal**): semantic recall over the free-text NOTES corpus (chef/klant-notities, dienstomschrijvingen, contactlogs) with **human citations** ("Notitie over chef Lisa de Vries") — complements the per-row `*.semantic_search`. Pipeline (`src/lib/ai/rag/*`): build text → **redact PII** (the Stage-1 tested `redact()` — email/phone/IBAN/BSN/card/DOB) → density-gate (>30% redacted ⇒ skip) → **chunk** (~500-tok, paragraph-aware) → embed (`text-embedding-3-small`) → **soft-supersede + insert**, idempotent via content hash (`scripts/rag-ingest.mts`). **Access control is load-bearing + PURE** (`src/lib/ai/rag/access.ts`, unit-tested key-free in `smoke-ai-rag`): retrieval filters by **tenant_scope** ∩ caller-scopes AND **visibility** BEFORE the LLM sees a chunk — owner spans all tenants, chef/klant scoped to self + placement-bridge (so the future chef/klant PAs are safe-by-construction). Ingested LIVE: **45 chunks** (9 chef-notes + 9 chef-profielen + 5 klant-notes + 22 diensten; contactlogs none yet). Verified: `smoke-ai-rag` **33/0** (incl. the access-filter logic) + LIVE `scripts/smoke-ai-rag-retrieval.mts` **9/0** (NEVER-sources allowlist · redaction-in-corpus · **chef-A-never-sees-chef-B** · admin_only invisible to a chef). The **nightly auto-refresh is now wired app-side** (`GET /api/cron/rag-ingest` → `ingestAll()`, `vercel.json` cron `0 3 * * *`, gated on `CRON_SECRET`) — NOT a Railway worker, because the standalone worker deploy can't import the shared redact/chunk/sources/ingest and copying them would risk redaction drift; the app runtime has `ingestAll()` natively. **Retention + AVG purge done too:** `workers/retention.ts` prunes superseded chunks >30d + chunks of sources soft-deleted >30d (double-gated), and `eraseUserData` synchronously purges an erased subject's chunks via `src/lib/ai/rag/purge.ts` (`smoke-avg-erasure` 30/0 still green). OpenAI key rotation still pending (owner). **`CRON_SECRET` set on Vercel (prod+dev) + prod redeployed; live cron returns HTTP 200.** ⚠⚠ **DB TOPOLOGY GOTCHA (read before any prod DB work):** `.env.local` points at a Neon **DEV** branch (`ep-green-mouse-…`); **Vercel prod uses a DIFFERENT branch (`ep-icy-scene-…`)**. So every "live" verification via `.env.local` (this session AND the prior per-row-embedding run) actually hit DEV. The real prod DB (`ep-icy-scene`, fresher data) has now been seeded explicitly: `ai_embeddings` table + 45 chunks ingested, AND per-row embeddings populated (11 chefs + 6 clients) so BOTH `knowledge.search` and `*.semantic_search` work for real users. To run a prod migration/ingest, pull the prod URL (`vercel env pull` → use its `DATABASE_URL[_UNPOOLED]`), don't rely on `.env.local`. **Open:** Railway workers — prod per-row embeddings were empty until now, so the Railway `embedding-refresh` worker isn't populating prod (most likely OBSERVE mode = no valid `OPENAI_API_KEY` on Railway, consistent with the pending key rotation; also confirm Railway's `DATABASE_URL_UNPOOLED` = `ep-icy-scene`, not the dev branch — if it's on dev, ALL prod workers are writing to the wrong DB). **Prior — AI assistant expansion + UX polish** — GitHub **PR #49, #51–#57** (2026-06-08) — **SHIPPED TO PROD (merged to main, NO migration)**. The owner AI assistant grew **21 → 34 tools** (18 read / 10 act / 6 personal): chef-360 reads (`chefs.work_summary`/`feedback`/`trends`), `roster.overview` (staffing picture), `clients.history` (klant-360), `planner.cockpit` (urgent queue), `shifts.suggest_chefs` (ranked matches with reasons), and **RAG semantic search** (`chefs`/`clients.semantic_search` over pgvector — the `embedding-refresh` worker was run LIVE: 11 chefs + 6 clients embedded); plus profile-change approve/reject + availability-reminder act tools. Also: a **conversation-context fix** (the system prompt now carries topic across turns), **gpt‑5.4 token+cost metering** on the `/admin/system` AI-tokens card (built-in $2.50/$15 per 1M, env-overridable `OPENAI_PRICE_*`), and **human Dutch enum labels everywhere** (no more `chef_de_partie` in the UI — all via `src/lib/labels.ts` `formatChefRole`/`formatShiftRole`/`formatSegment`). All confirm/permission-gated + smoke-covered (tools 136 · safety 48). Model `gpt-5.4`; OpenAI key rotation still pending (owner will do it). NEXT big piece: deeper **chunked + PII-redacted notes-RAG** per `docs/ai/rag-ingestion-contract.md` (needs a migration). **Prior — Chef workflow UX (PR #47/#48, NO migration):** **#47 login-trap fix:** one-click **"Uitnodigen & activeren"** on chef + client detail pages chains the tested `inviteChef/ClientToPortal` → `activatePortalUser` (account + `active` + welcome-mail in one step), killing the `invited`-limbo state where an account silently couldn't log in (login = passwordless magic-link, only sent to an `active` user; invite-only, no self-signup). **#48 Chef 360 rework** around *"kan deze chef de vloer op?"*: new pure `src/lib/domain/chef-inzetbaarheid.ts` `computeChefInzetbaarheid()` verdict (`ready`/`almost`/`blocked` + blockers/warnings · 31/31 smoke `scripts/smoke-chef-inzetbaarheid.mts`), a top-of-page **Inzetbaarheidskaart** (`chefs/[id]/_components/InzetbaarheidCard.tsx` — verdict + blocker chips + reliability strapline + consolidated actions invite&activate/mail/bel/↓bewerken), page reordered (verdict → Chef 360 → beoordeling → documenten → bewerken `#anchor` → AVG → portaal), and Chef 360's onboarding/profiel checklists + recente-diensten collapsed behind `<details>`. ⚠ Both built **blind from a `/tmp` GitHub clone** (this Mac's `~/Documents` is macOS-TCC/Full-Disk-Access-blocked → no local render/DB; gate = type-check+lint+smoke, Vercel builds on merge) — **verify card render + invite→login live**. Follow-up offered: **Klant 360** ("goede klant?" verdict). **Owner AI assistant (PA V1)** is also live (`src/lib/ai/**` · `/api/ai/chat` · dashboard chat widget · 21 tools · owner-gated + rate-limited) — ⚠⚠ **its OpenAI test key STILL NEEDS ROTATION** (was exposed in chat); `AI_CONFIRM_SECRET` is set; WhatsApp channel ON HOLD. **Prior:** Admin settings + per-person RBAC (PR-SET-1 + PR-RBAC, 2026-06) — **SHIPPED TO PROD**. PR-SET-1: owner cockpit de-leaked (no system/error info); the hours-reminders worker is now UI-toggleable via `/admin/business/instellingen` (new `business_settings` table; worker reads the flag via raw SQL, env stays as a kill-switch). PR-RBAC: the dormant permission layer is now **LIVE** — a permission catalog (`src/lib/rbac/catalog.ts`, system/business classes), a `user_permissions` override table + memoized effective-set engine (role ∪ grant − revoke), **all 113 admin gates flipped from role-name to `requirePermission`** (behavior-neutral, parity-proven), an editable role editor (`/admin/system/roles`), a per-user override editor, and an owner **Team page** (`/admin/business/team`) to create staff + set per-person capabilities — all behind escalation guards (`src/lib/rbac/guards.ts`: owners can't grant system perms or escalate). Migrations 0037 (`business_settings`) + 0038 (`user_permissions`) on prod; prod `role_permissions` reconciled to the catalog (owner=27, planner=14, super_admin=50, 0 system on owner/planner). Prior: PR-AUDIT. See "PR ledger".
**Live URL:** https://chefandserve2.vercel.app
**Repo:** github.com/Jezza5153/chefandserve2

---

## Map: where to find what

| Topic | File |
|---|---|
| Codebase guide (auto-loaded keystone) | `CLAUDE.md` — stack · hard rules · map · how-to-work |
| Plan (current operating plan) | `~/.claude/plans/goofy-moseying-truffle.md` |
| Strategic AI architecture | `AI_INTEGRATION.md` (4-layer model · data inventory · phased rollout) |
| Phase-by-phase tactical brief | `BUILD_PLAN.md` |
| 12-week roadmap | `ROADMAP.md` |
| State ledger (THIS FILE) | `MEMORY.md` |
| Process map / API linkage | `WORKFLOW.md` |
| AI playbooks + contracts | `docs/ai/` (see PR-AI-0) |
| DB schema (Drizzle) | `src/lib/db/schema.ts` |
| DB migrations | `drizzle/*.sql` |
| Smoke tests | `scripts/smoke-*.{sh,mjs}` |
| Backup scripts | `scripts/backup-*.sh` + `scripts/launchd/*.plist` |

---

## Stack

- **Frontend/Backend**: Next.js 15 App Router · React 19 · TypeScript
- **DB**: Neon Postgres (serverless) · Drizzle ORM · pgvector ready
- **Auth**: Auth.js v5 (JWT strategy) · Resend magic-link + Credentials (password+TOTP)
- **2FA**: OTPAuth · AES-256-GCM secret encryption · bcrypt recovery codes
- **Storage**: Cloudflare R2 (`chefandserve` bucket — scoped token)
- **Email**: Resend
- **Anti-bot**: Cloudflare Turnstile
- **Hosting**: Vercel (web) · Railway (workers)
- **Locale**: Dutch (UI) · `nl-NL` date formatting

---

## Currently-shipped flow at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│ Marketing (chefandserve2.vercel.app)                              │
│  • Homepage, 17 service pages, about, work-with-us, contact       │
│  • /aanmelden → chef or klant Jotform                             │
│  • Header: [Inloggen] [Aanmelden]                                 │
├──────────────────────────────────────────────────────────────────┤
│ Jotform intake                                                    │
│  • Chef form  → chef_submissions  (idempotent on external_id)     │
│  • Klant form → client_submissions                                │
│  • Webhook: /api/intake/{chef,client}                             │
├──────────────────────────────────────────────────────────────────┤
│ Admin (super_admin + owner)                                       │
│  • /admin/business — KPIs + actions                               │
│  • /admin/business/inbox — Jotform submissions triage             │
│  • /admin/business/chefs · clients · shifts · roster              │
│  • /admin/system/{users,roles,errors,audit,webhooks,emails,…}     │
│  • Convert submission → chef/client master record                 │
│  • Invite chef/client to portal (status invited → active + email) │
│  • Invite internal staff (PR-A)                                   │
│  • Reset another internal's 2FA (PR-C0)                           │
├──────────────────────────────────────────────────────────────────┤
│ Chef portal (mobile-first)                                        │
│  • /chef — "wat moet ik nu doen?" dashboard (Today/Action/Money)  │
│  • /chef/hours — list + /chef/hours/[id] simple-form              │
│  • /chef/shifts/[id] — accept/reject + cancel (severity-aware)    │
│    with contact card (tel:/WhatsApp/Maps)                          │
│  • /chef/availability calendar · /chef/profile editable           │
│  • /chef/notifications · /chef/calendar (ICS subscribe)           │
├──────────────────────────────────────────────────────────────────┤
│ Klant portal                                                      │
│  • /client — "actie nodig" dashboard                              │
│  • /client/shifts/[id]/hours — receipt-style sign/reject          │
│  • /client/request · /client/notifications · /client/calendar     │
├──────────────────────────────────────────────────────────────────┤
│ Auth                                                              │
│  • /login (magic-link primary, password+TOTP behind toggle)       │
│  • /login/forgot-password · /login/lost-2fa                       │
│  • /recover/password · /recover/2fa (purpose-bound tokens)        │
│  • /admin/account/setup/* (force-enrollment wizard)               │
│  • TOTP_ENFORCE=true (12h re-prompt per device)                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## PR ledger

### Shipped (in production)

| PR | Description | Status |
|---|---|---|
| PR-Z | Wizard 2FA crash fix (Next.js 15 cookies rule) | ✅ live |
| PR-A | Internal staff invite UI + simplified /login | ✅ live |
| PR-C0 | Admin Reset 2FA + cookie revocation chain (v2 cookie format) | ✅ live |
| PR-B | TOTP_ENFORCE=true + TOTP_REVERIFY_HOURS=12 | ✅ live |
| PR-C | Recovery flows (forgot password + lost 2FA, Fence 5 purpose-bound tokens) | ✅ live (migration 0010 applied) |
| PR-D | UX polish (users-list 2FA/last-login columns, calendar today ring, client request success card) | ✅ live |
| PR-AUDIT | Backend-audit remediation: `client_submissions.client_id` FK (cross-tenant scoping) · klant emails via `recipientsForClient` · KPI bucketed by `confirmedAt` · chef-proposal + portal-invite email tracking · `deliver-outbox` + `hours-reminders` workers · CSP excluded from error KPI · dead-code/doc cleanup | ✅ SHIPPED (commit b0b92f0 · migration 0035 on prod · 17/17 prod smoke) |
| PR-SET-1 | Admin settings: owner cockpit de-leak + UI-toggleable hours-reminders (`business_settings` table) | ✅ SHIPPED (commit 86b0b3d · migration 0037 on prod · 17/17 prod smoke · 4/4 flag smoke) |
| PR-RBAC | Per-person permissions: catalog + `user_permissions` engine + 113-gate flip (role-name→permission, behavior-neutral) + role/override editors + owner Team page + escalation guards (G1–G5) | ✅ SHIPPED (commits c5ffd3d…087d2d9 · migration 0038 + prod seed-reconcile · parity 72/72 · guards 14/14 · manage e2e 5/5). Re-run `scripts/audit-permission-parity.ts` after any gate/catalog edit. Coordinate migration numbers with the teammate. |
| PA-V1 | Owner AI assistant: channel-agnostic agent loop + OpenAI brain (native tool-call threading) · 21 tools (8 read / 7 act / 6 personal) **[baseline — now 38 tools; see #49/#51–#57 + notes-RAG]** · owner-gated `/api/ai/chat` + dashboard chat widget · rate-limit `ai_chat_user` (30/min) · reminders + memory as jsonb bags in `business_settings` · smokes `smoke-ai-{spine,brain,tools,safety}` | ✅ live (no migration). ⚠ OpenAI **test key NEEDS ROTATION** (exposed in chat) · `AI_CONFIRM_SECRET` set · WhatsApp = **messaging channel** via sent.dm (`sendWhatsApp`, key set), NOT an AI channel — needs an approved template to send |
| #47 | Login-trap fix: one-click **"Uitnodigen & activeren"** (chains `inviteChef/ClientToPortal` → `activatePortalUser`) on chef + client detail pages — no more `invited`-limbo that can't log in | ✅ live (no migration · merged to main 2026-06-08) |
| #48 | Chef 360 rework ("kan deze chef de vloer op?"): pure `computeChefInzetbaarheid()` verdict + top **Inzetbaarheidskaart** (`chefs/[id]/_components/InzetbaarheidCard.tsx`) + page reorder + `<details>` overload collapse | ✅ live (no migration · smoke 31/31 · was stacked on #47). ⚠ built blind from /tmp clone — verify card render live |
| #49 | AI data-write tools + context fix + tokens + reminders: `chefs.{list,approve,reject}_profile_change` (shared `decideChefProfileChange` domain fn, reused by the admin page) · `chefs.send_availability_reminder` + `workers/availability-reminder.ts` (Thu 09:00, gated off via `business_settings['availability_reminders']`) · conversation-context fix (system prompt) · gpt-5.4 token+cost metering (`ai_usage` jsonb tally in business_settings + AI-tokens card) | ✅ live (no migration) |
| #51 | Human Dutch enum labels everywhere — every raw `vakniveau`/`roleNeeded`/`segment` render routed through `src/lib/labels.ts` (12 display sites + form dropdowns; deleted roster's dup `humanize`) + built-in gpt-5.4 pricing on the AI card | ✅ live (no migration) |
| #52–#57 | AI tools-first batch (21→34): `chefs.work_summary`/`feedback`/`trends` · `roster.overview` · `clients.history` · `planner.cockpit` · `shifts.suggest_chefs` · `chefs`/`clients.semantic_search` (RAG/pgvector). All confirm-free reads wrapping tested domain logic; `embedding-refresh` run LIVE to populate vectors | ✅ live (no migration) |
| #58–#60 | 2 small read tools → census 37: `shifts.margin` (omzet−loon per dienst) · `contacts.timeline` (laatste contact met chef/klant) | ✅ live (no migration) |
| #61 | Notes-RAG **Stage 1** (foundation): `src/lib/ai/rag/redact.ts` (PII redaction — email/phone/IBAN/BSN/card/DOB, every pattern unit-tested) + `chunk.ts` (~500-tok paragraph-aware) + `scripts/smoke-ai-rag.mts` | ✅ live (no migration · smoke 17/0) |
| Notes-RAG **Stage 2** | Chunked + PII-redacted notes-RAG end-to-end: **`ai_embeddings`** store (manual migration `manual_ai_embeddings.sql` — `vector(1536)` + HNSW cosine + soft-supersede) · ingestion `src/lib/ai/rag/{sources,ingest}.ts` + `scripts/rag-ingest.mts` (redact→density-gate→chunk→embed→supersede, idempotent via content hash) · **PURE** scope/visibility access filter `rag/access.ts` + cosine retrieval `rag/retrieve.ts` · owner-facing `read-model/knowledge.ts` (human citations) · **`knowledge.search`** tool (38th; 22 read/10 act/6 personal). Owner spans all tenants, chef/klant scoped to self+placement-bridge (future PAs safe-by-construction) | ✅ SHIPPED (migration `manual_ai_embeddings.sql` on prod · **45 chunks ingested LIVE** · `smoke-ai-rag` 33/0 incl. access-filter + LIVE `smoke-ai-rag-retrieval` 9/0: NEVER-allowlist · redaction-in-corpus · **chef-A-never-sees-chef-B** · admin_only invisible to chef) |
| Notes-RAG **autonomy** | Production-autonomous RAG: **nightly auto-refresh** app-side (`GET /api/cron/rag-ingest` → `ingestAll()`, `vercel.json` cron `0 3 * * *`, `CRON_SECRET`-gated — app-side because the standalone Railway worker can't import the shared redact/chunk pipeline) · **retention** (`workers/retention.ts` strategy 5: superseded chunks >30d + erased-source chunks >30d, double-gated) · **synchronous AVG purge** on erasure (`src/lib/ai/rag/purge.ts` ← `eraseUserData`) | ✅ SHIPPED (smoke-ai-rag 37/0 · LIVE smoke-ai-rag-retrieval 13/0 incl. purge round-trip + retention-SQL · retention dry-run clean · smoke-avg-erasure 30/0) |
| Notes-RAG **docs index** | `knowledge.search` now also covers **project documentation** (MEMORY/WORKFLOW/AI_INTEGRATION/README/CLAUDE + `docs/ai/*.md`): heading-aware markdown chunking (`chunkMarkdown`), `source_table='docs'`, `tenant_scope='internal'` + `visibility='admin_only'` (owner-only). Ingested by `scripts/rag-ingest.mts` (script-only — Vercel cron can't read repo files). 20 files → **523 chunks** (dev + prod) | ✅ SHIPPED (smoke-ai-rag 41/0 · retrieval smoke 13/0 with docs allowlisted · functional doc-hit confirmed). ⏳ CV-text OCR deferred (needs R2-fetch + pdf/OCR dep) |
| **Chef-assistent V1** | A SECOND assistant persona for chefs (read-only, own-data-only). New `AiActor.subject` ({kind,entityId}) — chef/klant tools key off the session-resolved subject, NEVER a model id ("auth IS the lookup"). `resolveChefActor` · chef read-model (`read-model/chef-self.ts`) · 4 tools `mijn.diensten`/`mijn.uren`/`mijn.beschikbaarheid`/`mijn.profiel` (`permission:null`+`risk:read`) · `buildChefRegistry` · `runChefAssistant` · `CHEF_SYSTEM_PROMPT` · `POST /api/ai/portal/chat` (gated on `session.user.kind`) · floating widget on the chef portal (reuses `AssistantChat`/`AssistantWidget` with an `endpoint` prop). | ✅ SHIPPED (smoke-ai-portal 14/0: read-only + can't-be-steered-to-another-chef + live scoped exec + clean no-subject error · owner gate unregressed · live agent answers a real chef with their own data). |
| **Klant 360 verdict** | "Goede klant?" — pure `computeClientHealth()` (`src/lib/domain/client-health.ts`: sterk/goed/aandacht + strengths/watchpoints over volume, marge, vaste chefs, openstaande handtekeningen, tekensnelheid, feedback) mirroring the Chef inzetbaarheid pattern. Reuses `getClientSummary` signals (no new queries) via `getClientHealth(clientId)`. Top-of-page **ClientHealthCard** on `/admin/business/clients/[id]` + owner AI tool **`clients.health`** (census 39 tools). | ✅ SHIPPED (smoke-client-health 11/0 pure · ai-tools 154/0 · ai-safety 53/0 · build green) |
| **Klant-assistent V1** | The klant mirror of the chef assistant — read-only, own-data-only. `resolveClientActor` · klant read-model (`read-model/client-self.ts`) · 4 tools `onze.diensten`/`onze.uren`/`onze.vaste_diensten`/`onze.aanvragen` · `buildClientRegistry` · `runClientAssistant` · `CLIENT_SYSTEM_PROMPT` · same `POST /api/ai/portal/chat` (branches on `session.user.kind`) · floating widget on the klant portal. | ✅ SHIPPED (smoke-ai-portal 28/0 — now covers BOTH personas: read-only + no-id-injection + live scoped exec + clean no-subject error · owner gate unregressed · type-check+lint+build green) |
| **Assistent-hardening** | (1) **Widget-gesprek blijft behouden** bij sluiten/navigeren — `AssistantChat` persisteert `msgs`+`pending` in `sessionStorage` per endpoint (owner/chef/klant gescheiden; skip-first-save guard tegen leeg-overschrijven) + **"Gesprek wissen"**-knop. Lost de bekende widget-unmount-reset op (geldt voor alle drie de assistenten). (2) **Portal tool-routing eval** `scripts/live-ai-portal-eval.mts` (chef+klant, planning-only, manueel — mirror van `live-ai-eval`). | ✅ SHIPPED (type-check+lint+build green · portal eval routet correct: chef 5/5, klant ✓) |
| **Portal round-out + placements-RAG** | (1) 4th tool per persona: chef `mijn.beschikbaarheid` (doorgegeven beschikbaarheid) · klant `onze.vaste_diensten` (terugkerende templates). (2) New RAG source **`placements.outcome`** (afgeronde plaatsingen + beoordeling, `admin_only` zodat alleen de owner-assistent ze ophaalt → ratings-internal-only blijft gehandhaafd) — "welke chef deed het goed bij deze klant". | ✅ SHIPPED (smoke-ai-portal 36/0 · retrieval smoke 13/0: placements allowlisted + **admin_only onzichtbaar voor chef** + chef-A-never-sees-chef-B · 25 placement-chunks ingested LIVE) |
| **CV-tekst-RAG** | `knowledge.search` indexeert nu ook **chef-CV's** — alleen door de chef zélf geüploade tekst-PDF's (`chef_documents` type=cv, `uploaded_by = chef.userId`; admin/derde-partij + ID-docs uitgesloten per contract). `ingestCvs` (`src/lib/ai/rag/ingest.ts`): R2-bytes (`getObjectBytes`) → `unpdf`-tekstextractie (géén OCR — scans/zonder ingebedde tekst worden overgeslagen) → redact → chunk → embed. `tenant_scope=chefId:<id>`, `visibility=chef_own_and_admin`. Voedt de matching-/rooster-vragen van Maarten met CV-inhoud. Dep: `unpdf@^1.6.2`. **Nightly cron-maintained** (CV-ingestie zit in `ingestAll` → de Vercel-cron pikt nieuwe CV's vanzelf op; `unpdf` dynamic-imported). | ✅ SHIPPED (type-check+lint+**build** groen incl. unpdf · pipeline live geverifieerd tegen prod: R2 configured, 0 chef-geüploade CV's nu → degradeert netjes; defensieve try/catch per doc kan ingestie nooit breken). ⏳ unpdf-extractie nog niet op een echte CV-PDF getest (geen PDF-docs in DB); indexeert vanzelf zodra een chef een CV-PDF uploadt |
| **WhatsApp send (sent.dm)** | `src/lib/whatsapp.ts` `sendWhatsApp({to:[E.164], template:{id/name,parameters}, channel, sandbox})` → `POST https://api.sent.dm/v3/messages`, auth `x-api-key` (`SENT_DM_API_KEY`, gezet op Vercel prod+dev + `.env.local`). Berichtenkanaal (reminders/notificaties), **GEEN AI-kanaal**. Injecteerbare transport → `scripts/smoke-whatsapp.mts` 15/0 (request-shape + success/error parsing, geen netwerk). Key live geverifieerd (sandbox-call → 200-auth, 400-validatie). | ✅ SHIPPED (sender + env + smoke + Vercel-key). ⏳ **Echt versturen vereist een vooraf goedgekeurde WhatsApp-template** (Meta-regel; sent.dm dwingt `template` af) — zodra Maarten een template aanmaakt + de naam deelt, wire ik die in de reminders (worker-side helper) + evt. een `whatsapp.send` AI-tool. Sleutel staat in chat → overweeg roteren. |
| **AI oversight tools** (blindspot sweep) | 3 read-tools die de assistent toegang geven tot **Restricted (tool-only) data** die RAG bewust nooit indexeert (`read-model/oversight.ts` + `tools/oversight.ts`, metadata-only): **`audit.search`** (auditlog: wie deed wat wanneer — `audit.read`, nooit de before/after-payloads) · **`documents.list_for_chef`** (chef-documenten: soort/status/verloop/geverifieerd — `chefs.read`, nooit bytes/URL) · **`privacy.list_requests`** (AVG-verzoeken: soort/status/termijn — `privacy.read`, nooit de ruwe tekst). Census **45 tools** (26 read / 13 act / 6 personal). | ✅ SHIPPED (smoke-ai-tools 175/0 · safety 65/0 · live geverifieerd tegen dev). Uit de blindspot-audit; rest buildable backlog (eval-harness, meer RAG-bronnen, worker-smokes) nog open. |
| **Parallel tool-calls** (#82) | "Bigger brain, efficiënter": de brain batcht onafhankelijke tools in één beurt; de agent-loop draait ze concurrent (`Promise.all`) en pauzeert op de confirm-gate zodra er een *actie* in de batch zit. `BrainStep` kreeg een `tool_calls`-variant; `openai-brain.ts` zendt/parset de volledige `tool_calls`-array; back-compat met scripted single-`tool_call`. | ✅ SHIPPED (smoke-ai-spine 36/0 + brain 28/0 incl. parallel-blokken · **live**: gpt-5.4 haalde `business.overview`+`roster.overview` in één beurt). |
| **Oversight II + eval + documents.expiring** (#83–#85) | (a) 3 read-tools erbij: **`email.status`** (aflever/bounce — `emails.read`, nooit de inhoud) · **`payroll.read`** (batches + marge — `payroll.read`) · **`documents.expiring`** (alle chefs, eerst-verlopend — `chefs.read`). (b) **Runnable eval-harness** `scripts/eval-ai.mts`: golden routing + safety-refusal tegen de echte brain (planning-only, ~15 calls) — **15/15**; release-regressienet (`docs/ai/ai-evaluation-set.md` markeert 'm live). De eval bracht de `documents.expiring`-gap aan het licht (G5) en bevestigde de fix. Census **48 tools** (29 read / 13 act / 6 personal). | ✅ SHIPPED (smoke-ai-tools 184/0 · safety 68/0 · eval-ai 15/15 · lint+build green). |
| **Playbook → Maarten's voorkeuren** (#87) | De 4 lege voorkeur-slots in `src/lib/ai/playbook.ts` ingevuld: standaard **kort & bondig** · **geen vaste bijzonderheden** (live via memory-tool) · extra voorzichtig bij plaatsing-annuleren + klant-mail. De CC-voorkeur ("altijd Maarten in CC") is **deterministisch op tool-niveau**: `sendEmail()` kreeg een optionele `cc`; `sendOwnerEmail` zet `env.MAARTEN_EMAIL` in CC (overslaan als hij de ontvanger is), de confirm-preview toont de CC-regel. | ✅ SHIPPED (type-check 0 · tools 184/0 · safety 68/0 · spine 36/0 · eval 15/15 · **Vercel prod ● Ready**). ⚠ Vercel **Preview** deploys falen structureel (geen env-vars op de Preview-env) — pre-existing, raakt elke PR; **Production** heeft de vars en is groen. ⚠ Lokale `npm run build` brak op de invoice-WIP (`src/lib/invoice-labels.ts` → ontbrekende `@/lib/db/schema-types`) van **een andere chat** in dezelfde working tree — niet gecommit, niet van mij; NIET aanraken. |

### In-progress / next

| PR | Description | Status |
|---|---|---|
| PR-CHEF-0 | Integration spine (outbox/runs/external_refs/email tracking/notifications/contact_logs) | ✅ live (migration 0011 applied · 18/18 smoke pass · /admin/business/integrations live) |
| PR-AI-0 | AI/RAG docs spine (docs/ai/) | ✅ live (28 docs, 7,230 lines — 11 base files + 10 workflow playbooks + 6 tool-contract files + README) |
| PR-CHEF-1 | Hours chain (chef → klant → admin → exported) + trust timeline | ✅ live (migration 0012 applied · 9 emails · trust timeline · chef form · klant receipt · admin queue+detail) |
| PR-CHEF-2 | Three role dashboards ("wat moet ik nu doen?") | ✅ live (chef + klant + admin all "actie nodig" first + integration health card + ActionCard shared) |
| PR-CHEF-3 | Admin bulk approval + dispute UX + manual-add hours | ✅ live (magic eligibility + bulk-select bar + per-row approve + anomaly flagging in queue) |
| PR-CHEF-4 | Profile editing (direct + request-change split) | ✅ live (migration 0013 · ProfileForm direct edit · RequestChangeFormSection for sensitive fields · profile_change_requests table) |
| PR-CHEF-5 | Confirm-notify chef + cancel-severity + contact cards | ✅ live (ShiftConfirmedChefEmail · ShiftCancelledByChefClientEmail · cancellation-severity util · cancel flow with tel: CTA · contact card · rejection reason on accept/reject) |
| PR-CHEF-6 | Notification prefs scaffolding | ✅ live (migration 0014 · notification_prefs table · shouldSendToUser/setPref helpers · V1 always-on) |
| PR-CHEF-7 | Payroll batches + corrections + CSV export | ⏳ |
| PR-CHEF-8 | Email delivery tracking (Resend webhooks) | ✅ live (POST /api/webhooks/resend with svix-signature HMAC verify · recordEmailEventFromWebhook updates email_messages.status) |
| PR-CHEF-9 | In-app notification inbox UI | ✅ live (bell with unread badge in all 3 layouts · /chef/notifications · /client/notifications · /admin/notifications · markRead + markAllRead) |
| PR-CHEF-10 | AVG consent + privacy requests + retention policies | ✅ live (migration 0018 · consent_log + privacy_requests + DPA + retention_policies · ConsentGate modal flag-gated · /privacy-chef + /privacy-klant placeholders) |
| PR-CHEF-11 | Calendar ICS feeds (chef + klant) | ✅ live (migration 0015 calendar_token · src/lib/calendar/ics.ts · /chef/calendar.ics + /client/calendar.ics public-by-token · /chef/calendar + /client/calendar UI with copy URL + rotate secret) |
| PR-CHEF-12 | Document verification + expiry + visibility | ✅ live (migration 0016 · clientVisible+verifiedAt/By+expiresAt+status on chef_documents · /api/chef-document/[id] 3-way access · workers/document-expiry.ts · profile doc list with visibility chips) |
| PR-CHEF-13 | Backup + restore drill + encryption | ✅ live (migration 0017 · backup-neon.sh + restore-drill.sh + backup-install.sh + launchd plist + age-encryption support + 12-week retention · backup_runs + restore_drills tables) |
| PR-CHEF-7 | Payroll batches + corrections + CSV export | ✅ live (migration 0019 · payroll_batches + lines + shift_hour_corrections · /admin/business/payroll + CSV export route) |
| PR-CHEF-14 | Polish: countdown, empty/late states, doc visibility labels | ✅ folded into PR-CHEF-2 (countdown/earnings) + PR-CHEF-12 (doc labels) + PR-CHEF-5 (rejection reason) |
| PR-CHEF-15 | Web Push (DEFERRED) | 💤 deferred |
| PR-CHEF-FUT | Reserved API/webhook schemas (no UI) | 💤 reserved |
| PR-PLANBORD-1 | **Drag-drop planbord** (`/admin/business/roster/planbord`, gate `shifts:write`) — concept-rooster met **publish-gate**: sleep chef → **DRAFT**-plaatsing (onzichtbaar voor chef+klant + ICS, telt niet mee in shift-status), focus-rail rangschikt matches met de "waarom"; **"Publiceer week"** flipt draft→proposed (her-valideert dubbele boekingen wég) + mailt iedereen via de geëxtraheerde `sendProposalNotifications`. AI: confirm-gated `roster.publish` ("publiceer maar") + draft-aware `roster.overview` (`draftsPending`). Engine: `draftPlacement`/`publishDraftsForPeriod`/`removeDraftPlacement` (`domain/roster-publish.ts` + `matching.ts`); `@dnd-kit/core`. | ✅ **dev-verified** (migration 0039 `draft` enum op DEV-branch · `smoke-planbord.mts` **13/0** · type-check+lint+**build** groen). ✅ **SHIPPED TO PROD** (migratie 0039 op prod `ep-icy-scene` toegepast + merge to main `522cfab` + Vercel-deploy; UI/auth-render nog te eyeballen) |
| PR-PLANBORD-2 | **Publiceren = weekoverzicht + agenda.** Publish stuurt nu **ÉÉN digest per chef** (zijn week + **adres + contactpersoon + telefoon + chef-zichtbare details**) en **ÉÉN per klant** (de chef **met telefoonnummer**) i.p.v. N losse voorstel-mails — beide met een **`.ics`-bijlage** voor de agenda. `sendEmail` kreeg attachments-support; `ChefWeekPlanningEmail`/`KlantWeekPlanningEmail` + `sendWeekDigests` in `roster-publish.ts`. AVG: chef-details uit `chef_visible_notes`, nooit interne `notes`. | ✅ dev-verified (type-check+lint+build+`smoke-planbord` 13/0 groen; mails best-effort). ✅ **SHIPPED TO PROD** (`522cfab`); ⏳ e-mail-render nog eyeballen (echte testmail) |
| PR-PLANBORD-3 | **"Vul de week" (AI drafts the week).** Greedy autofill over `findMatchesForShift`: zet de best passende beschikbare chef als **concept** op elke open plek — per slot her-query → géén dubbele boekingen / niet 2× op één dienst; lichte fairness-spreiding. Knop op het planbord (`autofillWeekAction`) + confirm-gated AI-tool **`roster.autofill`** ("vul de week"). `domain/roster-autofill.ts`. Deterministisch nu; LLM-scorer schuift later achter `findMatchesForShift` zónder UI-wijziging. | ✅ dev-verified (type-check+lint+build groen · `smoke-planbord` **16/0** incl. autofill · `smoke-ai-tools` **162/0** incl. roster.publish+autofill). ✅ **SHIPPED** (`522cfab`) |
| PR-PLANBORD-4 | **"Per chef"-lens op het planbord.** Toggle Per dag / Per chef: de chef×dag-pivot (`ChefWeekGrid`) toont elke actieve chef × 7 dagen met wat-ie-doet per dag (status-kleur), een **belasting-badge** en **vrije chefs grijs + geteld** ("X chefs nog vrij deze week") — read-only inzicht ("wie is vrij?"). `chefId` door de slots gedraad. | ✅ dev-verified (type-check+lint+build groen). ✅ **SHIPPED** (`522cfab`) |
| PR-PLANBORD-5 | **Beschikbaarheid op de "Per chef"-lens.** `chef_availability` (geblokkeerde dagen) nu zichtbaar in de pivot: geblokkeerde dag = "niet beschikbaar"-cel, en de **"vrij"-badge betekent nu écht vrij** (geen plaatsing én niet geblokkeerd); header telt chefs mét vrije dagen. Plus smoke-dekking voor publish's **blocked re-validatie** (overslaan + reden 'blocked'). | ✅ dev-verified (type-check+lint+build groen · `smoke-planbord` **18/0** incl. blocked-skip). ✅ **SHIPPED** (`522cfab`) |
| PR-PLANBORD-6 | **Build→review→publish afgerond.** "**Wis concepten**"-knop (`clearDraftsForPeriod` — wis alle week-concepten, "opnieuw" na een autofill) + de **match-score op concept-slots** (`Sander · 85` op draft-pills, zodat de planner ziet wáárom een autofill-pick landde). | ✅ dev-verified (type-check+lint+build groen · `smoke-planbord` **20/0** incl. clearDrafts). ✅ **SHIPPED** (`522cfab`) |
| PR-PLANBORD-7 | **Reistijd-hint in de match-rail.** Elke gerangschikte kandidaat toont nu zijn **afstand tot de locatie** (`estimateTravel`, chef-coörd → shift-coörd) — zodat de planner een nabije good-enough chef kan verkiezen boven een verre topscore. Afstand-only (modus-onafhankelijk). | ✅ **SHIPPED** (`c574578`) |
| PR-PLANBORD-8 | **Marge per kandidaat (owner-only).** De rail toont per kandidaat de geschatte **brutomarge** (klantomzet − loon − reis, via `estimateMargin`; loon = `chefs.hourlyRateMinCents ?? shift.chef_rate`) met tone-kleur — zo ziet de owner "beste chef ≠ meest winstgevend". Gegate op **`payroll.read`** (`hasPermission`) zodat planners alleen score + afstand zien, niet de tarieven. | ✅ **SHIPPED** (`2e3e5ef`) |
| PR-EMAILS-COPY | **Geperfectioneerde e-mailcopy + CTA's + copywriter-gids.** Alle **28** transactionele templates herschreven naar kalme, menselijke, action-first tekst (chef warm/praktisch · klant rustig/professioneel · admin kort · security/privacy serieus); elke statusmail eindigt met een duidelijke vervolgstap, ratings zeggen **"feedback"** (nooit "review/beoordeling"). Props/`<EmailLayout>`/`styles` onaangeroerd; branch-copy voor `recipientRole`/`recipientKind`/`intent`. **+ 3 ontbrekende CTA's gewired**: optionele `placementUrl`/`hubUrl` op `ShiftConfirmed{Chef,Client}Email` + `ShiftCancelledByChefClientEmail`, doorgegeven vanaf `placement-transition` / admin-shift-page / chef-cancel. **Copywriter-gids** `docs/EMAIL_TEMPLATES.md` + `scripts/render-emails.mts` → `previews/emails/*.html` (28 + index). | ✅ **SHIPPED** (`9a8de47`+`e2a61ce`; type-check+lint+build groen · 28/28 gerenderd) |
| PR-PLANBORD-CONFIRM | **Batch-confirm + acceptatie-voortgang op het planbord.** Na publiceren accepteren chefs zelf; de planner ziet nu een **voortgangsstrip** (X voorgesteld · Y geaccepteerd · Z bevestigd) en een **"Bevestig (N)"-knop** die álle geaccepteerde plaatsingen van de week in één keer bevestigt (`confirmAcceptedForPeriod` → `transitionPlacement` per rij → chef+klant-bevestigingsmail mét de nieuwe CTA's). `confirmWeekAction` + pipeline-counts uit de page. Sluit de lifecycle: concept → publiceer → accept → **bevestig**. | ✅ verified (type-check+lint+build groen · `smoke-planbord` **25/0** incl. batch-confirm + copyLastWeek + cancel-clears-drafts) |

### Klant (hotel) phase — ✅ shipped

| PR | Description | Status |
|---|---|---|
| PR-KLANT-0 | Foundations: shift hub + placement_comments + client_contacts + recipients + AI docs | ✅ live (migration 0020 · /client/shifts/[shiftId] hub · comments.ts visibility-scoped · client-recipients.ts · client-shift-labels.ts · 8 playbooks + 4 tool contracts) |
| PR-KLANT-1 | Profile editing (sectioned, paymentTerms→request) | ✅ live (migration 0021 · /client/profile sectioned: Contactpersoon · Shiftlocatie · Facturatie · request-change · client_change_requests table · admin Wijzigingsverzoeken tab · BillingEmailChangedKlantEmail to OLD address · recipientsForClient outcome email) |
| PR-KLANT-2 | Requests list + cancel + change/cancel for existing shifts | ✅ live (migration 0022 · /client/requests list + retract · shift hub change/cancel modals · client_shift_change_requests + one-open-per-shift-per-kind unique index · submission_status cancelled_by_client · admin inbox decision queue · ClientChangeRequestAdminEmail + ClientChangeRequestOutcomeKlantEmail) |
| PR-KLANT-3 | Chef preview + structured comments + email | ✅ live (no schema · hub proposed-chef card + "Waarom voorgesteld?" reasons via getMatchReasonsForPlacement · ChefFeedbackForm → placement_comments client_visible (NEVER notes) · admin shift-detail comment thread + visibility-scoped reply · proposePlacement adds ChefProposedKlantEmail + chef_proposed notification · klant comment → admin email) |
| PR-KLANT-4 | Recurring templates + exceptions + overnight + preview | ✅ live (migration 0023 · shift_templates + shift_template_exceptions · shifts.source_template_id/date + idempotency index · generate-recurring-shifts worker (Europe/Amsterdam, overnight ends_next_day, ON CONFLICT partial-index) · admin templates list/new/[id] + live preview-before-save + ExceptionsManager + activate toggle · /client/templates friendly view + change-request) |
| PR-KLANT-5 | Rating loop + tags + N≥5 rule + email | ✅ live (migration 0024 · ratings table + chefs.average_rating/rating_count rollup · rating-tags.ts vocab · domain/ratings.ts (submit + recompute + 3 visibility-scoped readers: admin-all / chef-N≥5 / klant-none) · /client/shifts/[shiftId]/rate stars+tags form · RatingPendingKlantEmail + bell + dashboard card on approveHoursRow · admin chef-detail feedback section · chef-profile N≥5 summary) |
| PR-KLANT-DOCS | CLAUDE.md + WORKFLOW link-complete + MEMORY resume-header | ✅ shipped |

### Klant-2 — native klant intake + JotForm retirement + IDOR fix (no migration)

| PR | Description | Status |
|---|---|---|
| PR-K2-1 | Native public klant intake form (`/horeca-personeel-aanvragen` + `/aanvragen` alias) | ✅ live (NO migration · seeds `client-request` form: audience=client, 10 fields, admin-editable at /admin/business/forms · `submitClientRequest` → client_submissions source `native_request`, status `new` · honeypot + `client_request_ip` rate-limit · mirrors /sollicitatie) |
| PR-K2-2 | Retire public JotForm CTAs + native /contact-us + webhook hardening | ✅ live (NO migration · `site.intake.{chef,client}` · /aanmelden + /contact-us CTAs → /sollicitatie + /horeca-personeel-aanvragen · contact `mailto` form → `ContactForm` → client_submissions source `native_contact` · fail-open `intake_webhook_ip` rate-limit on /api/intake/{chef,client}) |
| PR-K2-4 | Ownership/IDOR sweep of (client)+(chef) — fix chef `respond()` | ✅ live (NO migration · `respond()` resolves chef via chefs.userId + atomic `UPDATE … WHERE id=? AND chef_id=? AND status='proposed'` · audit confirmed 1 HIGH hole; all other reads/mutations correctly scoped) |
| PR-K2-5 | Klant venue profile & preferences (`/client/profile` "Voorkeuren") | ✅ live (NO migration · klant self-edits `client_type` + `client_tags[]` from the shared `client-taxonomy` — descriptive, non-binding match signal, NOT chef selection (respects no-veto) · already feeds `domain/matching.ts`; favorites/blocks stay admin-only · smoke `scripts/smoke-klant-preferences.mjs` 4/4) |
| PR-K2-6 | Klant KPI/insights card (`/client` "Jouw cijfers") | ✅ live (NO migration · read-only aggregates scoped to clients.userId: komende/afgeronde shifts, uren te tekenen, 30d besteed = Σ worked_minutes×client_rate_cents/6000 (approved/exported), meest-ingezette chef) |
| PR-K2-7 | Klant mail-voorkeuren (`/client/notifications`) | ✅ live (NO migration · toggles 4 mutable categories → notification_prefs via `setPref` · gated centrally in `recipientsForClient` via `shouldSendToUser` — billing/security mail always sends) |
| PR-K2-8 | Admin per-form notification recipients | ✅ live (NO migration · `recipientsForForm(slug,fallback)` reads a `form:<slug>` notification_routes row else the generic event · `/admin/system/notifications` "Per formulier" section · chef-apply/client-request/contact wired) |
| PR-K2-D | AI "Stel chefs voor" heuristic match | ✅ ALREADY SHIPPED (found during build-out) — `/admin/business/shifts/[id]` calls `findMatchesForShift` + renders ranked candidates (score/reasons/warnings/travel/margin) + one-click `proposePlacement`. Phase-9A heuristic + admin surface are LIVE; no work needed. |

> NO migration anywhere: `client_submissions.source` + `rate_limits.scope` are plain `text`; reused existing tables/enums/notification events. Smoke: `scripts/smoke-klant-native-intake.mjs` (10/10). Verified: build + browser render + real `submitClientRequest` row landed + IDOR cross-chef blocked. **Dropped:** PR-K2-3 (klant approve/decline of a proposed chef) — conflicts with the deliberate "no veto" design (`ChefFeedbackForm`: "NEVER Akkoord/Goedkeuren") + the "Maarten matches, geen algoritme" positioning; replaced by PR-K2-5 (descriptive venue prefs that steer the match without picking the chef). **Dev gap:** `RATE_LIMIT_HASH_SECRET` is missing from dev `.env.local` → blocks ALL public-form submits in dev (chef + klant); set in prod.

### AVG/GDPR compliance phase — active (plan: privacy-operations workflow)

| PR | Description | Status |
|---|---|---|
| PR-AVG-pre | docs/privacy/pii-inventory.md (51 tables) + retention-matrix.md | ✅ |
| PR-AVG-1 | Privacy-request intake (portal + off-portal manual) + identity verification + correspondence log + SLA extension + withdrawal + super_admin compliance queue | ✅ live (migration 0025 · privacy_requests intake/identity/SLA/correction cols + user_id nullable + other/withdrawn enum values · privacy_request_messages · domain/privacy.ts · chef+klant /privacy capture · /admin/system/privacy-requests list+new+[id] · 3 emails · privacy_request notification event) |
| PR-AVG-2 | Preview + export package (redacted, zip→R2, ~7d on-demand links) + correction (art.16) + erasure (art.17, legal-hold-aware) + tombstones | ✅ live (migration 0026 · privacy_erasure_tombstones · domain/privacy-{subject,export,erasure}.ts + applyCorrection · getLegalHoldsForUser · jszip dep · r2.putObject + EXPORT_DOWNLOAD_TTL · admin [id] export/correct/erase panels + [id]/download route · smoke-avg-erasure.mts 30/30 incl. 5 third-party redaction fixtures) |
| PR-AVG-3 | Retention purge worker (double-gated) + retention admin + backup replay | ✅ live (workers/retention.ts 3-state gate RETENTION_ENABLED/RETENTION_DRY_RUN both default safe · supervisor JOBS weekly Sun 02:00 · legal-hold-aware purge of soft-deleted chef_documents/chefs/clients + R2 byte purge via workers/_r2.ts · /admin/system/retention view/edit policies + risk banner · scripts/{seed-retention-policies,replay-erasure-tombstones}.mjs · docs/privacy/backup-erasure-policy.md · smoke-avg-retention.mjs 13/13) |

> AVG rules (load-bearing): user requests / super_admin fulfills (no autonomous erasure) · identity verified before export/erase · soft-delete-first · Payingit 7-year hold = structured legal holds · never export third-party PII (redact) · preview before execute · erasure tombstones + backup replay · 30-day SLA (extendable, art. 12(3)) · `AVG_CONSENT_ENFORCED` stays false until lawyer fills privacy text.

### Admin Staffing Cockpit phase — active (plan: `~/.claude/plans/goofy-moseying-truffle.md`)

| PR | Description | Status |
|---|---|---|
| PR-1 | Visual roster + deterministic intelligence (no schema/deps/AI) | ✅ live (`/admin/business/roster` week+month · `src/lib/roster-format.ts` shift health/next-action/warnings/fill + Amsterdam-DST bucketing · `RosterShiftCard` · "Aandacht nodig" strip + glance header · SidebarNav "Rooster" + dashboard wiring · **tunable seam** `DEFAULT_ROSTER_SETTINGS{criticalHours:24,labels}` ready for Instellingen · smoke-roster-intel.mts 49/49) |
| PR-1.7 | **Instellingen hub** — per-employee fine-tuning (broader hub) | ✅ live (migration 0027 `user_settings(user_id pk, prefs jsonb)` · `domain/user-settings.ts` getRosterSettings/saveRosterSettings merge-over-defaults · `/admin/account/instellingen` sections **Rooster** (criticalHours + standaard weergave + actie-labels → feeds roster intel) + **Meldingen** (per-user notification toggles via notification_prefs/setPref) · SidebarNav "Instellingen" · roster page threads getRosterSettings into the helpers + defaultView · smoke-user-settings.mts 11/11) |
| PR-1.5 | "Vul deze dienst" candidate panel on shift detail | ✅ live (`domain/{profile-completeness,staffing-intelligence}.ts` pure helpers · proof badges + confidence label + warnings + worked-here count + contact actions App/Mail/Belnotitie→contact_logs · smoke-staffing-intel.mts 53/53 (extended in PR-3.1/5) · availability now live via PR-4) |
| PR-1.6 | Chef 360 read model + work-history/feedback panels | ✅ live (`domain/chef-history.ts` getChefWorkSummary/FeedbackSummary/RecentShifts/**getChefClientHistory** (canonical "worked here" — PR-3.1 reuses) · chef detail Chef 360 section: snapshot (uren/diensten/rating/laatst) + reliability counts + topClients/topSegments + "Wat klanten zeggen" feedback + recente diensten · HARDENED: hours only from admin_approved/exported · smoke-chef-history.mts 16/16) |
| PR-2 | Rich chef intake from Jotform | ✅ live (migr 0028 · chefs + chef_submissions get street/house_number/postcode/lat/lng + transport_mode(car/motorbike/ebike/none) + preferences[] + employment_type(payroll/zzp/both) + applying_as(chef/front_of_house) · `intake/jotform.ts` parses them from the live form · `conversions.ts` carries to chefs · chef detail "Profiel & voorkeuren" chips + completeness% · AVG: erase nulls address/geo, export Full · matching soft-reason folded into PR-3.1 · smoke-chef-intake.mts 15/15) |
| PR-3 | Travel-cost + margin engine (free, PDOK) | ✅ live (migr 0029 shifts lat/lng · `domain/geo.ts` keyless PDOK geocode + haversine · `domain/travel.ts` estimateTravel (×1.3 road · per-km car .23/motor .21/ebike .05/OV .18) + estimateMargin (revenue−chef−reis, tone ok/low/negatief) · shift-detail candidate chip "≈ €X reis · Y km · {basis}" + marge · `scripts/geocode-backfill.mts` (chefs postcode + shifts city → coords) · smoke-travel.mts 17/17. NB: chips light up once geocode-backfill runs / chefs have postcodes) |
| PR-2.1 | Chef filters + missing-data workflow | ✅ live (migr 0030 `profile_data_requests` · chefs list filters: vervoer/voorkeur/employment/mist-data + smart views "Ontbijt+auto"/"Mist profieldata"/ZZP/Payroll + Vervoer-voorkeur kolom · `domain/profile-data-requests.ts` (createProfileDataRequest → email via ProfileDataRequestEmail + contact_logs + row · markCompletedByEmail closes loop on intake) · chef detail "Vraag ontbrekende gegevens" button + request history · AVG erase deletes requests · smoke-profile-requests.mts 11/11) |
| PR-2B | Client/shift requirements + venue type tags + favorite/blocked | ✅ live (migr 0031 · clients client_type/client_tags/favorite_chef_ids/blocked_chef_ids + shifts dress_code/language_required/min_experience/kitchen_type/solo_or_team/service_style/parking/meal/start_flexible · `domain/client-taxonomy.ts` shared type+tag vocab · client detail: set type+tags, view/remove favorite/blocked (audit) · shift detail favorite/block toggle · Chef 360 "Werkt vooral voor" top-klanttype · matching reasons: min_experience warning + language_required + preference↔segment/klanttype/tag (PREFERENCE_SIGNALS) · AVG: chef erasure array_removes id from klant favorite/blocked + pii-inventory note) |
| PR-3.1 | Candidate ranking with distance/margin/history | ✅ live (`staffing-intelligence.ts` getRankScore (blocked=−1 · ±favorite/available/worked-here/margin/distance/completeness) + getChefMatchExplanation (reasons·warnings·nextCheck) · shift detail ranks candidates by composite + favorite/blocked chips + "Checken:" line · smoke-staffing-intel.mts 53/53) |
| PR-4 | Availability + comms pipeline | ✅ live (shift detail reads chef_availability for the shift's Amsterdam day — row=available/unavailable, no row=unknown (warning, never available) → feeds badges/confidence/rank · logContact records placement journey via contact_logs · chef availability calendar already exists from PR-F2) |
| PR-5 | Match explanation + feedback loop (deterministic) | ✅ live (getChefMatchExplanation surfaces waarom/onzeker/checken + getRankGapReasons "Waarom niet nr 1?" on non-top candidates · outcome capture via placements (proposed/accepted/declined) + contact_logs (contacted + reason); no LLM) |

> **All cockpit PRs (PR-1…PR-5) are now live.** Next: per-page fine-tuning pass. Open follow-ups: intake-handler `markCompletedByEmail` hook (TODO), run `geocode-backfill.mts` so travel/margin + distance-ranking light up, chef availability admin-set UI (V1 = chef portal only).

> Cockpit LOCKED: visual language red=actie-nu·amber=risico/onbekend·green=klaar·blue=wacht·grey=afgerond·purple=AI(PR-5) · drill-down layers roster→shift→chef-drawer→full-profile · intelligence deterministic (no AI until PR-5) · don't fake structured filters from rawPayload (structure first, PR-2).

---

## DB schema state (Drizzle — `src/lib/db/schema.ts`)

### Enums

`user_kind` (internal, chef, client) · `user_status` (invited, active, disabled) · `error_severity` · `submission_status` · `vakniveau` · `segment` · `chef_status` · `client_status` · `shift_status` · `chef_document_type` · `placement_status` (+ `draft` — PR-PLANBORD-1, planbord concept) · `recovery_intent` (password, totp)

### Tables (live in prod)

**Auth + RBAC**: `users` · `auth_accounts` · `auth_sessions` · `auth_verification_tokens` · `roles` · `permissions` · `role_permissions` · `user_roles` · `user_recovery_codes` · `recovery_intents` (PR-C)

**Observability**: `audit_log` · `error_log` · `webhooks_received`

**Rate limiting**: `rate_limits` (PR-S1A)

**Notifications routing**: `notification_routes` (PR-F1) — admin events configurable

**Jotform intake**: `chef_submissions` · `client_submissions`

**Master records**: `chefs` · `clients` · `chef_availability` · `chef_documents`

**Shifts/placements**: `shifts` · `placements`

**Klant phase (live)**: `placement_comments` (visibility-scoped, PR-KLANT-0) · `client_contacts` (routing seam, PR-KLANT-0) · `client_change_requests` (PR-KLANT-1) · `client_shift_change_requests` (PR-KLANT-2, one-open-per-shift-per-kind) · `shift_templates` + `shift_template_exceptions` (PR-KLANT-4) · `clients.shiftAddress`/`shiftArrivalNotes`/`billingAddress` (PR-KLANT-0) · `client_submissions.cancelled_by_client*` (PR-KLANT-2) · `shifts.source_template_id`/`source_template_date` (PR-KLANT-4) · `ratings` + `chefs.averageRating`/`ratingCount` (PR-KLANT-5)

**AI / RAG (live)**: per-row `embedding` vector(1536) on `chefs`/`clients`/`shifts` (manual `manual_pgvector_prep.sql` — powers `*.semantic_search`) · **`ai_embeddings`** chunked notes-RAG store (`vector(1536)` + HNSW cosine · `tenant_scope`/`visibility`/`redaction_version`/`content_hash` · soft-supersede via `superseded_at`; manual `manual_ai_embeddings.sql`, NOT in Drizzle schema) · AI reminders/memory/token-usage as jsonb bags in `business_settings`

### Tables (planned per active plan)

**PR-CHEF-0**: `integration_connections` · `integration_outbox` · `integration_runs` · `external_refs` · `email_messages` · `email_events` · `notifications` · `contact_logs`

**PR-CHEF-1**: `shift_hours` + `shift_hours_status` enum

**PR-CHEF-4**: `profile_change_requests`

**PR-CHEF-6**: `notification_prefs`

**PR-CHEF-7**: `payroll_batches` · `payroll_batch_lines` · `shift_hour_corrections`

**PR-CHEF-10**: `consent_log` · `privacy_requests` · `data_processing_agreements` · `retention_policies`

**PR-CHEF-12**: extends `chef_documents` (clientVisible, verifiedAt/By, expiresAt, status)

**PR-CHEF-13**: `backup_runs` · `restore_drills`

**PR-CHEF-FUT (reserved)**: `api_clients` · `webhook_endpoints` · `webhook_deliveries`

### Migration history

| File | What | Status |
|---|---|---|
| 0000_light_captain_flint.sql | Initial users/auth/RBAC | applied |
| 0001..0008 | Submissions, chefs, clients, shifts, etc. | applied |
| 0009_noisy_sprite.sql | notification_routes (PR-F1) | applied |
| 0010_recovery_intents.sql | recovery_intents (PR-C) | applied (May 27) |
| 0011_integration_spine.sql | integration_connections + integration_outbox + integration_runs + external_refs + email_messages + email_events + notifications + contact_logs (PR-CHEF-0) | applied (May 27) |
| 0012_shift_hours.sql | shift_hours + shift_hours_status enum (PR-CHEF-1) | applied (May 27) |
| 0013_profile_change_requests.sql | profile_change_requests (PR-CHEF-4) | applied |
| 0014_notification_prefs.sql | notification_prefs (PR-CHEF-6) | applied |
| 0015_calendar_token.sql | calendar ICS tokens (PR-CHEF-11) | applied |
| 0016_chef_documents_trust.sql | chef_documents trust cols (PR-CHEF-12) | applied |
| 0017_backup_runs.sql | backup_runs + restore_drills (PR-CHEF-13) | applied |
| 0018_avg_privacy.sql | consent_log + privacy_requests + retention_policies (PR-CHEF-10) | applied |
| 0019_payroll_batches.sql | payroll_batches + lines + shift_hour_corrections (PR-CHEF-7) | applied |
| 0020_klant_foundations.sql | placement_comments + client_contacts + clients address split (PR-KLANT-0) | applied (May 28) |
| 0021_client_change_requests.sql | client_change_requests + client_change_status enum (PR-KLANT-1) | applied (May 28) |
| 0022_client_change_cancel.sql | client_shift_change_requests + 2 enums + submission_status 'cancelled_by_client' + client_submissions cancel cols (PR-KLANT-2) | applied (May 28) |
| 0023_shift_templates.sql | shift_templates + shift_template_exceptions + shifts.source_template_id/date + idempotency index (PR-KLANT-4) | applied (May 28) |
| 0024_ratings.sql | ratings + chefs.average_rating/rating_count rollup (PR-KLANT-5) | applied (May 28) |
| 0025_avg_fulfillment.sql | privacy_requests intake/identity/SLA/correction cols + user_id nullable + other/withdrawn enum values + privacy_request_messages (PR-AVG-1) | applied (May 28) |
| 0026_avg_tombstones.sql | privacy_erasure_tombstones (HMAC email hash · retained_entities_summary · per-subject ids) (PR-AVG-2) | applied (May 28) |
| 0027_user_settings.sql | user_settings (user_id pk · prefs jsonb) — per-employee cockpit settings hub (Cockpit PR-1.7) | applied (May 28) |
| 0028_chef_intake_rich.sql | chefs + chef_submissions: address (street/house_number/postcode/lat/lng) + transport_mode/preferences[]/employment_type/applying_as enums (Cockpit PR-2) | applied (May 28) |
| 0029_shift_geo.sql | shifts latitude/longitude (PDOK geocoded) for travel-cost (Cockpit PR-3) | applied (May 28) |
| 0030_profile_data_requests.sql | profile_data_requests (chef · type/fields/channel/status · sent/completed) — missing-data workflow (Cockpit PR-2.1) | applied (May 28) |
| 0031_client_shift_requirements.sql | clients client_type/client_tags/favorite_chef_ids/blocked_chef_ids + shifts dress_code/language_required/min_experience/kitchen_type/solo_or_team/service_style/parking_available/meal_included/start_flexible (Cockpit PR-2B) | applied (May 28) |
| 0032..0038 | geo · audit-impersonator · long-vision · chef-notes/events · client_submissions FK · metrics-daily · `business_settings` (0037) · `user_permissions` (0038) | applied |
| 0039_planbord_draft_status.sql | `placement_status` += `draft` — private concept placement for the planbord (PR-PLANBORD-1) | ✅ applied to **DEV**; ⏳ **PROD pending** (safe `ALTER TYPE ADD VALUE`; apply before/with the deploy) |
| `manual_pgvector_prep.sql` | **manual (non-Drizzle)** — pgvector extension + per-row `embedding` vector(1536) on chefs/clients/shifts + HNSW cosine | applied |
| `manual_ai_embeddings.sql` | **manual (non-Drizzle)** — `ai_embeddings` chunked notes-RAG store: `vector(1536)` + HNSW cosine + `tenant_scope`/`visibility`/`redaction_version`/`content_hash` + soft-supersede. Apply via `scripts/apply-ai-embeddings.mts` | applied (2026-06-08, prod) |

---

## Production env vars (Vercel)

**Required**: `DATABASE_URL` · `DATABASE_URL_UNPOOLED` · `AUTH_SECRET` · `RESEND_API_KEY` · `RESEND_FROM_EMAIL` · `NEXT_PUBLIC_APP_URL` · `RATE_LIMIT_HASH_SECRET` · `TOTP_ENCRYPTION_KEY` · `TOTP_ENFORCE=true` · `TOTP_REVERIFY_HOURS=12`

**Optional** (Turnstile): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` · `TURNSTILE_SECRET_KEY`

**R2** (Cloudflare): `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET=chefandserve` · `R2_PUBLIC_URL`

**Email routing**: `MAARTEN_EMAIL` · `JEZZA_EMAIL` (fallbacks; `notification_routes` rows override)

**AI assistant**: `AI_ENABLED=true` · `OPENAI_API_KEY` (⚠ rotation pending — owner) · `OPENAI_MODEL=gpt-5.4` · `AI_CONFIRM_SECRET` (≥32 chars, signs confirm tokens) · `OPENAI_PRICE_INPUT_PER_1M` / `OPENAI_PRICE_OUTPUT_PER_1M` / `OPENAI_PRICE_CURRENCY` (optional — override the built-in gpt-5.4 rate shown on the AI-tokens card). `OPENAI_API_KEY` also activates the `embedding-refresh` worker (per-row RAG) + the `GET /api/cron/rag-ingest` Vercel cron (chunked notes-RAG re-index). `CRON_SECRET` (≥16 chars) gates the cron — Vercel sends it as `Authorization: Bearer <secret>`; missing → the cron route refuses (503), so it can't be triggered publicly.

**Coming with this plan**:
- `RESEND_WEBHOOK_SECRET` (PR-CHEF-8 — Resend webhook signature verification)
- `AVG_CONSENT_ENFORCED` default `false` (PR-CHEF-10 — flip after lawyer review)

---

## Critical security invariants

1. **TOTP_ENFORCE=true is live.** Every internal user with `totp_enabled` gets a 12h device cookie. v2 cookie format includes `enrolledAtMs` so admin reset invalidates ALL device cookies on next request.
2. **Password reset bumps `permissions_version`** → invalidates JWT on other devices.
3. **2FA reset bumps `permissions_version`** + wipes secret + wipes recovery codes + sets `totp_enrolled_at=null` (which kills cookie v2 validation).
4. **Recovery intents are purpose-bound** (Fence 5). A forgot-password token cannot be used for lost-2fa, and vice versa. Single-use atomic via `UPDATE … WHERE consumed_at IS NULL`.
5. **Auth IS the lookup.** No chef/client id ever comes from form data. Server actions resolve entity by `session.user.id → entity.userId`.
6. **State transitions are atomic.** `UPDATE … WHERE id = ? AND status = '<expected>'`. If 0 rows update, request is stale.

---

## Critical operational invariants (active plan)

1. **No external API call inside a business transaction.** Approve hours → DB update + outbox enqueue. Worker delivers external.
2. **Idempotency keys on every outbox row.** Same `(eventType, entityId, action)` → same key. Re-enqueue is a no-op.
3. **Append-only after export.** Once `shift_hours.status='exported'`, only `shift_hour_corrections` mutations allowed.
4. **External system IDs in `external_refs`, never on entity tables.**
5. **Every email send creates an `email_messages` row.** Status updated by Resend webhook.
6. **No raw backend statuses in UI.** Pipe through `humanStatus()` from `src/lib/hours-labels.ts`.

---

## Workers (Railway crons)

| Worker | File | Schedule | Status |
|---|---|---|---|
| Embedding refresh | `workers/embedding-refresh.ts` | nightly 03:00 | ✅ live — **per-row embeddings populated** (ran LIVE: 11 chefs + 6 clients; shifts forward-looking only). Powers `chefs`/`clients.semantic_search`. text-embedding-3-small → per-row `embedding` vector(1536). Does NOT populate the chunked **`ai_embeddings`** store — that's the app-side Vercel cron `GET /api/cron/rag-ingest` (nightly `0 3 * * *`), since the standalone worker can't import the shared redact/chunk pipeline |
| Error digest | `workers/error-digest.ts` | daily | live |
| Weekly digest | `workers/weekly-digest.ts` | Monday 08:00 | live |
| Payingit sync | `workers/payingit-sync.ts` | TBD | stub |
| Retention | `workers/retention.ts` | TBD | stub (AVG1) |
| Supervisor | `workers/supervisor.ts` | hourly | live |
| Complete placements | `workers/complete-placements.ts` | every 30 min | ✅ live (supervisor JOBS — hours trust chain, PR-CHEF-1) |
| Document expiry | `workers/document-expiry.ts` | daily 06:00 Amsterdam | ✅ live (supervisor JOBS, PR-CHEF-12) |
| Payroll export | `workers/payroll-export.ts` | manual | PLAN: PR-CHEF-7 |
| Generate recurring shifts | `workers/generate-recurring-shifts.ts` | daily 04:00 Amsterdam | ✅ live (registered in supervisor JOBS, PR-KLANT-4) |
| Retention purge | `workers/retention.ts` | weekly Sun 02:00 Amsterdam | ✅ live (supervisor JOBS, PR-AVG-3 — DOUBLE-GATED RETENTION_ENABLED+RETENTION_DRY_RUN, both default safe → no-op until deliberately flipped) |
| Deliver outbox | `workers/deliver-outbox.ts` | every 5 min | ✅ live (supervisor JOBS, PR-AUDIT-5 — acks `internal` breadcrumbs pending→sent + writes integration_runs; defers payroll/csv until a handler lands) |
| Hours reminders | `workers/hours-reminders.ts` | daily 09:00 Amsterdam | ✅ live (supervisor JOBS, PR-AUDIT-6 — chef 24/72h, klant 5d, admin 10d; idempotent via audit markers; **GATED off** by default via HOURS_REMINDERS_ENABLED) |

> All scheduled workers run via `workers/supervisor.ts` JOBS (node-cron,
> Europe/Amsterdam): weekly-digest · error-digest · embedding-refresh ·
> payingit-sync · generate-recurring-shifts · complete-placements ·
> document-expiry · retention (double-gated) · deliver-outbox (every 5 min) ·
> hours-reminders (daily, gated off by default). `payroll-export` is manual.
> RETENTION env: `RETENTION_ENABLED` (default false) + `RETENTION_DRY_RUN`
> (default true) must BOTH be set deliberately on Railway for a live purge.

---

## Smoke tests (in repo)

- `scripts/smoke-prod.sh` — 17 HTTP-level checks against live URL
- `scripts/smoke-pr-c.mjs` — Neon DB schema sanity after PR-C
- `scripts/smoke-recovery-intents.mjs` — Fence 5 invariant tests (atomicity, intent-bound, expiry)
- `scripts/reset-internal-2fa.ts` — emergency 2FA reset CLI
- `scripts/smoke-integration-spine.mjs` — PR-CHEF-0 (to be added)
- `scripts/smoke-klant-native-intake.mjs` — PR-K2 (client-request form seeded · native_request/native_contact land · chef respond() IDOR predicate) — 10/10
- `scripts/smoke-klant-preferences.mjs` — PR-K2-5 (clients.client_type + client_tags round-trip the shared taxonomy) — 4/4
- `scripts/smoke-klant-notifications.mjs` — PR-K2-7/8 (notification_prefs schema + per-form notification_routes round-trip) — 4/4
- `scripts/smoke-ai-{spine,brain,tools,safety,usage}.mts` — AI runtime · brain/zod-schema · registry well-formedness (136) · per-tool gating (48) · token-tally math (12). Run tools/safety/usage with `--env-file=.env.local`.
- `scripts/live-ai-{brain,loop,context}-check.mts` — LIVE model checks (throwaway, real OpenAI key; not part of the gate)

---

## Open questions / decisions deferred

1. **Payingit API spec** — not publicly documented. CSV export first; live API integration when Payingit gives us API docs.
2. **Accounting platform** — Exact / Moneybird / AFAS? Adapter pattern supports any.
3. **Legal text for AVG modals** — placeholders + TODO; lawyer fills in.
4. **age key location for encrypted backups** — public key in `~/.ssh/`, private key 1Password + sealed paper backup.
5. **iOS/Android Calendar subscription UX testing** — PR-CHEF-11 needs manual test on real device.
6. **Cancellation severity thresholds** — 48h/24h/same-day from `src/lib/cancellation-severity.ts`; tune after 1 month real use.
7. **Web Push** — deferred to PR-CHEF-15; rely on emails + in-app notifications for V1.

### Known follow-ups discovered during the klant phase (spawned as side tasks)

8. ~~**Worker scheduling gap**~~ ✅ RESOLVED — `complete-placements` (every 30 min) + `document-expiry` (daily 06:00) registered in `workers/supervisor.ts` JOBS; **PR-AUDIT** then added `deliver-outbox` (every 5 min) + `hours-reminders` (daily 09:00, gated off by default). Worker tsc passes; all idempotent. The `hours-reminders` PLAN is now built.
9. ~~**Chef profile-change admin review (PR-CHEF-4 gap)**~~ ✅ RESOLVED — `/admin/business/chefs/[id]` now has a "Wijzigingsverzoeken" section with `approveProfileChange`/`rejectProfileChange` (hourlyRate writes both min/max cents), atomic flip, audit, chef outcome email. Smoke: `scripts/smoke-chef-profile-change.mjs`.
10. ~~**Chef photo for klanten**~~ ✅ RESOLVED — `/api/chef-photo/[id]` authz extended: a klant can load a clientVisible+verified photo of a chef placed on one of THEIR shifts (no enumeration; chef-self + super_admin paths intact). Hub renders `ChefAvatar` (photo + initials fallback) with the same gate in the query.

### Known follow-ups discovered during the K2-4 IDOR sweep

11. **`/client/templates` over-fetch (low)** — `templates/page.tsx` selects `shift_template_exceptions` with no where-clause (all clients) to build a lookup Map; only the caller's own templates render (no cross-client exposure), but add `inArray(shift_template_exceptions.template_id, ownTemplateIds)` for data-minimization.
12. **`client_submissions` keyed on `companyName` (low)** — no `clientId` FK yet, so klant requests/dashboard scope portal submissions by the caller's own `companyName` string. Not a cross-tenant IDOR, but two client records with an identical company name would see each other's portal submissions. Data-model follow-up: add `clientId` FK + backfill.

### AI assistant follow-ups (2026-06 expansion — PR #49/#51–#57)

13. **Deeper RAG (chunked + PII-redacted notes/CV/feedback index)** — ✅ **SHIPPED** (notes-RAG Stage 1 #61 + Stage 2): `ai_embeddings` table on prod (manual `manual_ai_embeddings.sql`), the PII-redaction pipeline (`redact()`), chunking, scope/visibility access filter, cosine retrieval, and the `knowledge.search` tool — all per `docs/ai/rag-ingestion-contract.md`, 45 chunks ingested LIVE, isolation/redaction/NEVER-source smokes green. **Autonomy follow-ups DONE:** (a) ✅ nightly auto-refresh wired **app-side** (`GET /api/cron/rag-ingest` → `ingestAll()`, `vercel.json` cron `0 3 * * *`, `CRON_SECRET`-gated — app-side, not the worker, because the standalone Railway worker can't import the shared redact/chunk pipeline); (b) ✅ `workers/retention.ts` prunes `superseded_at < now()-30d` + chunks of sources soft-deleted >30d (double-gated) **+ synchronous purge on AVG erasure** (`src/lib/ai/rag/purge.ts` ← `eraseUserData`). **Still optional:** (c) index CV-text (chef-uploaded only) + project docs (Broad index) when wanted; (d) reclassify `chefs.notes`/`clients.notes` visibility if/when we split chef-authored bio from admin tribal notes (V1 conservatively tags both `admin_only`).
14. **OpenAI key rotation** — test key was exposed in chat; owner will rotate. After rotating, update Vercel + Railway + local `.env.local`.
15. **Optional AI read tools not yet built**: `shift.margin_check`, `contact_logs.timeline`, `chef.profile_completeness`.
16. **AI tool census = 34** (18 read / 10 act / 6 personal). Registry: `src/lib/ai/tools/index.ts`. Add a tool → also add a present-assertion in `smoke-ai-tools.mts` and (if it has required input) a `SAMPLE` entry in `smoke-ai-safety.mts`.

## How to update this file

Update **after every PR ships**:
1. Move PR from "In-progress" → "Shipped"
2. Add to migration history if a new migration ran
3. Add to env vars if a new one was set
4. Add to workers if a new worker shipped
5. Add to smoke tests if new
6. Update "Currently-shipped flow at a glance" if user-facing surface changed

**Never** update this for in-progress work — wait until merged + deployed + smoke-verified.
