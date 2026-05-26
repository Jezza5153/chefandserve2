# Chef & Serve — Build Plan

> Single source of truth for the operations-platform build. Read this end-to-end before contributing.

**Repo:** https://github.com/Jezza5153/chefandserve2
**Stage host:** Vercel
**Strategic 12-week roadmap:** [`ROADMAP.md`](./ROADMAP.md)
**This document:** tactical Phase 0 detail — environments, URLs, credentials, PR sequence.

---

## Table of contents

1. [Quick reference](#1-quick-reference)
2. [Why we're building this](#2-why-were-building-this)
3. [Current state](#3-current-state)
4. [Environments & URLs](#4-environments--urls)
5. [Tokens & credentials checklist](#5-tokens--credentials-checklist)
6. [Stack — what each tool does](#6-stack--what-each-tool-does)
7. [Database schema (Phase 0)](#7-database-schema-phase-0)
8. [Roles & permissions (RBAC)](#8-roles--permissions-rbac)
9. [Phase 0 — the six PRs](#9-phase-0--the-six-prs)
10. [Workflow — Maarten's daily flow](#10-workflow--maartens-daily-flow)
11. [Cost projection](#11-cost-projection)
12. [Open decisions / TODO](#12-open-decisions--todo)

---

## 1. Quick reference

| Thing | Value |
|---|---|
| **Staging marketing URL** | `https://chefandserve2.vercel.app` |
| **Staging app/admin URL** | Same project — paths `/login`, `/admin` (Phase 0) |
| **Future production marketing URL** | `https://chefandserve.nl` (flip at launch — currently serving old WordPress) |
| **Future production app URL** | `https://app.chefandserve.nl` (added at launch via subdomain CNAME) |
| **Branch model** | `main` is always deployable. Feature branches per PR, fast-forward merge. |
| **Vercel project** | `chefandserve2` (already exists, linked to GitHub) |
| **PR sequence** | PR-0A ✅ shipped · PR-0B → PR-0F (this build) · Phase 1+ in ROADMAP |
| **Key fact** | Closed-system, single-tenant. No `org_id` in tables. No multi-tenancy. |
| **Auth** | Magic links via Resend. **Seed-only login** — unknown emails rejected. |
| **Errors** | Sentry is the only error source of truth. No custom `errors` table. |

---

## 2. Why we're building this

**Replacing Shift Manager** (generic chef-portal SaaS at `chefandserve.shiftmanager.pro`) with an in-house operations platform tailored to Chef & Serve's premium-chef network. Shift Manager works for basic rostering but has no AI, no smart vakniveau × segment matching, no client portal, and no way to extend.

**Keeping Jotform** for public-facing intake forms (chef + client) — proven low-friction conversion, free, deliverable. Phase 1 wires Jotform webhooks into our database.

**Keeping Payingit** as the umbrella-employer / payroll backoffice. They handle loondienst contracts, AFAS payroll, Wet DBA compliance, invoicing, debiteurenbeheer. We don't replicate that.

**Building ourselves:**
- Roster brain (smart matching, conflict detection, drag-drop calendar)
- Chef portal (login, see shifts, submit hours, set availability)
- Client portal (login, see who's coming, request more staff)
- Admin app (Maarten's daily ops, Jezza's system view)
- Hours approval flow + Payingit push integration
- AI matching layer (Phase 4+)

**Outcomes:**
- Lower monthly SaaS cost (Shift Manager goes away)
- Own all operational data — basis for AI/automation
- Single brand — chef + client experience under chefandserve.nl
- Custom matching for premium positioning (chef×segment×vakniveau scoring)

Full strategic context: [`ROADMAP.md`](./ROADMAP.md).

---

## 3. Current state

### What's shipped to staging (Vercel main branch)

- 29 marketing pages built in Next.js 15 (homepage, 17 services, 2 pillars, 5 company, 2 founder, 2 legal)
- Cinematic design language: video hero, Prata serif, burgundy/cream palette, photographic full-bleed sections
- JSON-LD schema on every page (EmploymentAgency+LocalBusiness, FAQPage, Service+pricing offers)
- `robots.ts` + `sitemap.ts` (native Next.js App Router)
- `vercel.json` security headers + Frankfurt region
- **PR-0A shipped:** Jotform intake CTAs on `/work-with-us` (chef) and `/contact-us` (client)
- `ROADMAP.md` committed (strategic plan)
- `BUILD_PLAN.md` ← this document

### What's NOT yet built (Phase 0 still to ship)

- App shell (`(auth)` and `(admin)` route groups)
- Auth.js v5 magic-link login
- Neon Postgres connection + Drizzle schema
- Idempotent seed (Jezza, Maarten, Gina users + roles + permissions)
- Sentry error monitoring
- RBAC middleware
- Admin shell with role-aware sidebar

### What's deferred (later phases — see `ROADMAP.md`)

- Jotform webhook intake (Phase 1)
- Chef + client master records UI (Phase 2)
- R2 file uploads (Phase 2)
- Shifts + placements + smart matching (Phase 3)
- Chef portal (Phase 4)
- Payingit bridge (Phase 5)
- Client portal (Phase 6)
- Communications layer (Phase 7)
- AI matching (Phase 9+)

---

## 4. Environments & URLs

We use a **two-stage URL plan**: paths during staging, subdomains at launch. Code is config-driven so the cutover is just env var changes.

### Staging (now — until launch is approved)

| URL | Purpose | Notes |
|---|---|---|
| `https://chefandserve2.vercel.app` | All routes — marketing + app | Single Vercel project. Path-based separation. |
| `https://chefandserve2.vercel.app/` | Marketing homepage | Public |
| `https://chefandserve2.vercel.app/work-with-us/` | Chef intake page | Jotform CTA |
| `https://chefandserve2.vercel.app/contact-us/` | Client intake page | Jotform CTA |
| `https://chefandserve2.vercel.app/login` | Auth (PR-0E) | Magic-link form |
| `https://chefandserve2.vercel.app/admin/business` | Maarten/Gina dashboard | role: `owner` (PR-0F) |
| `https://chefandserve2.vercel.app/admin/system` | Jezza dashboard | role: `super_admin` (PR-0F) |
| Vercel preview URLs | One per branch, auto-generated | `chefandserve2-git-<branch>.vercel.app` |

**Why staging stays on `.vercel.app` URLs:** the apex `chefandserve.nl` currently serves the old WordPress site (different hosting, different DNS provider). Adding subdomains there during staging risks DNS confusion. The `.vercel.app` URLs are clean, free, and zero-DNS-touch.

### Production (launch — done as one coordinated cutover)

| URL | Purpose |
|---|---|
| `https://chefandserve.nl` | Marketing site — apex DNS flipped from old WP to Vercel |
| `https://app.chefandserve.nl` | Auth + admin + chef portal + client portal — new subdomain CNAME to Vercel |
| `https://chefandserve2.vercel.app` | Optional: kept as staging-after-launch (deploys from a `staging` branch) |

**Cutover steps (done in one window, ~30 min):**
1. In Cloudflare DNS: change apex `chefandserve.nl` A/CNAME to Vercel target
2. In Cloudflare DNS: add `app` CNAME → `cname.vercel-dns.com`
3. In Vercel project settings: add both `chefandserve.nl` and `app.chefandserve.nl` as production domains
4. Update env vars:
   - `NEXT_PUBLIC_SITE_URL=https://chefandserve.nl`
   - `NEXT_PUBLIC_APP_URL=https://app.chefandserve.nl`
   - `AUTH_URL=https://app.chefandserve.nl`
5. Enable host-guard middleware (currently no-op in staging — see PR-0B notes)
6. Redeploy production
7. Old WordPress site goes dark (cancel hosting)

**Why this is safe:** all chef-portal URLs, client-portal URLs, magic-link emails, audit-log URLs use `process.env.NEXT_PUBLIC_APP_URL`. One env var change moves everything.

---

## 5. Tokens & credentials checklist

What I need from you to proceed. Per PR:

### PR-0B — App shell (no tokens needed)

Pure code change. No accounts. Builds the auth/admin route groups with stub content.

### PR-0C — Env validation + Sentry

| What | Where | Notes |
|---|---|---|
| `SENTRY_DSN` | Sentry → project settings → Client Keys | Format: `https://xxx@oXXX.ingest.sentry.io/XXX` |
| `SENTRY_AUTH_TOKEN` | Sentry → settings → auth tokens (create new) | Needs `project:write`, `release:admin` scopes |
| `SENTRY_ORG` | URL slug | e.g. `chef-and-serve` |
| `SENTRY_PROJECT` | URL slug | e.g. `chefandserve` |
| `NEXT_PUBLIC_SENTRY_DSN` | Same as `SENTRY_DSN` | Exposed to client for browser-side errors |

Set all in Vercel project → Settings → Environment Variables → both Production AND Preview environments.

### PR-0D — Database

| What | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Neon → project → connection string | **Pooled** connection (default) for app reads/writes |
| `DATABASE_URL_UNPOOLED` | Neon → unpooled connection | Used for `drizzle-kit migrate` (long-lived connections) |
| Neon project name | (decision needed) | Suggest: `chefandserve-ops` |
| Dev/staging branch | Create explicitly in Neon | Suggest branch name: `dev` (preview deploys use this) |
| Email — Jezza | (your email) | Lowercase. Used as `super_admin` login. |
| Email — Maarten | (his email) | Lowercase. `owner` role. |
| Email — Gina | (her email) | Lowercase. `owner` role. |

### PR-0E — Auth.js magic-link

| What | Where | Notes |
|---|---|---|
| `RESEND_API_KEY` | resend.com → API keys → create | Starts with `re_` |
| Resend sending domain | Verify `chefandserve.nl` (production) OR `chefandserve2.vercel.app` (staging) | Domain verification adds DKIM/SPF records to DNS |
| `RESEND_FROM_EMAIL` | e.g. `noreply@chefandserve.nl` | Must match verified domain |
| `AUTH_SECRET` | Generated: `openssl rand -base64 32` | I can generate and add to `.env.local`. **Never commit.** |
| `AUTH_URL` | `https://chefandserve2.vercel.app` (staging) | Becomes `https://app.chefandserve.nl` at launch |

**Resend domain verification gotcha:** for staging you might want to verify a subdomain you control (e.g. set up Resend with a tiny test domain you own), since adding DKIM/SPF to chefandserve.nl while WordPress is still live there could conflict with their existing mail records. Safer staging path: use Resend's default `onboarding@resend.dev` for staging emails, switch to `noreply@chefandserve.nl` at launch. **Decision needed** (see open decisions section).

### PR-0F — RBAC + admin shell (no tokens needed)

Builds on PR-0D + PR-0E. Pure code.

### Phase 2+ (deferred until Phase 0 lands)

| What | Phase | Notes |
|---|---|---|
| `R2_ACCESS_KEY_ID`, `R2_SECRET`, `R2_BUCKET`, `R2_ENDPOINT` | Phase 2 | Cloudflare R2 for chef CVs, photos, certificates |
| Railway project link | Phase 5 | Background workers for Payingit sync, AI batches |
| Payingit integration spec | Phase 5 | CSV/SFTP/API — needs a call with Payingit |
| WhatsApp Business API | Phase 7 | Optional — urgent shift fills |

---

## 6. Stack — what each tool does

| Tool | Phase 0 role | Why this tool |
|---|---|---|
| **Vercel** | Host Next.js (marketing + app) | Same repo, edge-fast, preview deploys per branch, native Neon integration, free hobby tier covers us until traffic grows |
| **Neon** | Postgres for ops data | Serverless, branching (free dev/staging DBs), Vercel-native, scale-to-zero on idle |
| **Auth.js v5** | Magic-link auth + session management | Open-source, owned by Vercel team, Drizzle adapter, Resend provider built-in |
| **Resend** | Transactional email | Modern API, React Email templates, excellent deliverability, free tier 3k/mo |
| **Sentry** | Error monitoring | Free tier 5k events/mo, Next.js auto-instrumented, source maps |
| **Cloudflare** | DNS (DNS already managed there) + R2 (Phase 2) | R2 has zero egress fees — way cheaper than S3 for chef-document downloads |
| **Railway** | Background workers (Phase 5+) | Long-running tasks don't fit Vercel function timeouts |
| **Drizzle ORM** | Type-safe SQL + migrations | Better DX than Prisma for this stack; pairs naturally with Neon |
| **TypeScript strict** | Type safety | Already on `strict: true` |
| **Tailwind CSS** | Styling | Already in use across marketing site; same design system for admin |

---

## 7. Database schema (Phase 0)

Single-tenant. No `org_id` columns. ~14 tables for full v1; Phase 0 ships 9 of them.

### Tables shipping in PR-0D

```sql
-- USERS & AUTH
users
  id                     uuid primary key
  email                  text unique not null    -- check: lower(email) = email
  name                   text
  kind                   enum('internal','chef','client')   -- identity type, NOT role
  status                 enum('invited','active','disabled') default 'invited'
  permissions_version    int default 1            -- bumped on role change → invalidates JWTs
  created_at, updated_at

auth_accounts            -- Auth.js Drizzle adapter
auth_sessions            -- (JWT strategy; table required by adapter but mostly unused)
auth_verification_tokens -- magic-link tokens (consumed on use, expire 15 min)

-- RBAC
roles
  id (uuid), key (unique text), label, description

permissions
  id, resource (text), action (text)
  unique(resource, action)

role_permissions
  role_id (fk), permission_id (fk)
  unique(role_id, permission_id)

user_roles
  user_id (fk), role_id (fk), granted_by (fk → users.id), granted_at
  unique(user_id, role_id)

-- OBSERVABILITY (Sentry handles errors; we log user actions)
audit_log
  id, user_id, action, resource, resource_id,
  before (jsonb), after (jsonb),
  ip, user_agent, created_at

-- INTAKE (table seeded in Phase 0, populated in Phase 1)
webhooks_received
  id, source (text — 'jotform' | 'payingit' | ...),
  payload (jsonb), signature_valid (bool),
  processed_at, created_at
```

### Sensitive-data policy

- `users.email` lowercased via check constraint
- Phase 2 will add `chefs.bsn_encrypted` using `pgcrypto` (BSN is GDPR-sensitive)
- Phase 2 will add `clients.payment_details_encrypted` similarly
- **Never** store raw chef CVs or PDFs in Postgres — they go to Cloudflare R2 with presigned URLs

### What's NOT in Phase 0

- No `errors` table. Sentry owns this. Adding our own table would either duplicate Sentry or be sanitized to uselessness.
- No `chef_submissions` / `client_submissions` yet — Phase 1
- No `chefs`, `clients`, `shifts`, `placements`, `hours` — Phase 2 / Phase 3
- No `messages` (email tracking) — Phase 7

### Full schema reference

See [`ROADMAP.md`](./ROADMAP.md) for the complete 14-table v1 schema.

---

## 8. Roles & permissions (RBAC)

### Roles seeded in Phase 0

| Role key | Person | Default landing | Access |
|---|---|---|---|
| `super_admin` | Jezza (you) | `/admin/system` | **Everything.** Tech + business + audit + error feed + impersonation. |
| `owner` | Maarten, Gina | `/admin/business` | Full business view. **Cannot** access system/errors/audit/users/roles. |

### Roles NOT seeded yet (defined in code for future use)

| Role key | Will get |
|---|---|
| `coordinator` | read/write chefs/clients/shifts/placements; approve hours; **no** financial totals, **no** role management |
| `recruiter` | read/write chefs; read shifts; **no** clients, **no** invoicing |
| `bookkeeper` | read/write hours/invoices/payments; **no** chef profile edits, **no** roster |
| `sales` | read/write clients; read shifts; **no** chef rates, **no** payroll |
| `read_only` | read everything; mutate nothing |
| `chef` | own profile, own shifts, own hours, own availability (Phase 4) |
| `client` | own company, own bookings, own invoices (Phase 6) |

### Permissions model

`(resource, action)` pairs. ~12 in Phase 0, grows per feature phase.

Phase 0 permissions seeded:
- `users.read`, `users.write`
- `roles.read`, `roles.write`
- `audit.read`
- `errors.read` (placeholder — Sentry handles actual errors; this gates `/admin/system/errors` link visibility)
- `chefs.read`, `clients.read`, `shifts.read`, `hours.read` (owners can already see these "Binnenkort" placeholder pages)
- `invoices.read`, `dashboard.read`

### JWT invalidation strategy

JWTs hold `userId, email, kind, roles, permissionsVersion`. On every JWT validation:

```ts
if (db.users.permissionsVersion !== token.permissionsVersion) {
  return null;  // forces re-login
}
```

When an admin assigns/removes a role, bump that user's `permissions_version`. All their open sessions invalidate on next request. No "stale permissions until token expires" bugs.

---

## 9. Phase 0 — the six PRs

Each PR is independent. Each runs `npm run build && lint && type-check` before merge. Fast-forward merge to `main`. Vercel auto-deploys.

### PR-0A — Jotform CTAs ✅ SHIPPED

**Branch:** `pr-0a-jotform-ctas` (deleted post-merge)
**Commits:** `1ce796d` (Jotform CTAs), `c2f1af2` (ROADMAP)
**Files:** `src/lib/site.ts`, `src/app/work-with-us/page.tsx`, `src/app/contact-us/page.tsx`
**Status:** live on staging
**Acceptance:** ✅ build/lint/type-check pass · ✅ `/work-with-us` has chef Jotform pill · ✅ `/contact-us` has client Jotform pill + focused intake card

### PR-0B — App shell + route groups

**Goal:** add `(auth)` and `(admin)` route groups with stub pages. **Do not move marketing pages.** Middleware added but host-guard rule is disabled in staging.

**Files created:**
```
src/middleware.ts                       -- redirect /admin/* + /login → /login when unauthed (Phase 0 = no auth check yet, just stub)
src/app/(auth)/layout.tsx               -- minimal layout, no Header/Footer
src/app/(auth)/login/page.tsx           -- stub email form ("Phase 0 placeholder")
src/app/(auth)/verify/page.tsx          -- "Check je e-mail" stub
src/app/(admin)/layout.tsx              -- minimal AdminShell stub (sidebar shell, no nav items yet)
src/app/(admin)/admin/page.tsx          -- placeholder ("Phase 0 — auth coming in PR-0E")
```

**Acceptance:**
- `npm run build` passes
- `chefandserve2.vercel.app/login` → 200 (stub form)
- `chefandserve2.vercel.app/admin` → 200 (placeholder)
- All 29 marketing pages still 200 unchanged
- Sitemap.xml still includes marketing pages only

**Tokens needed:** none.

**Risk:** low — additive only.

### PR-0C — Env validation + Sentry

**Goal:** error visibility before adding auth/DB. Build crashes loudly on missing env.

**Files created:**
```
src/lib/env.ts                          -- zod-validated server/client env schemas
instrumentation.ts                       -- Sentry init
sentry.client.config.ts
sentry.server.config.ts
sentry.edge.config.ts
```

**Dependencies added (pinned):**
```json
{ "@sentry/nextjs": "^8.40.0", "zod": "^3.23.0" }
```

**Acceptance:**
- Missing `SENTRY_DSN` → build fails with readable zod error message
- Server error → visible in Sentry within 30s
- Client error → visible in Sentry
- `grep -r AUTH_SECRET .next/static` → 0 matches

**Tokens needed:** `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, org + project slugs.

**Risk:** low. Isolated PR.

### PR-0D — Database schema + idempotent seed

**Goal:** Postgres foundation ready for Phase 1+.

**Files created:**
```
src/lib/db/client.ts                    -- Neon HTTP driver, exports typed `db`
src/lib/db/schema.ts                    -- Drizzle table definitions
src/lib/db/seed.ts                      -- idempotent seed (INSERT...ON CONFLICT)
drizzle.config.ts
drizzle/0001_init.sql                   -- generated migration
```

**Dependencies (pinned):**
```json
{
  "drizzle-orm": "0.36.4",
  "@neondatabase/serverless": "0.10.4",
  "@auth/drizzle-adapter": "1.7.4",
  "drizzle-kit": "0.28.1",   // dev
  "tsx": "4.19.2"            // dev
}
```

**Scripts added to package.json:**
```json
{
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:seed": "tsx src/lib/db/seed.ts",
  "db:studio": "drizzle-kit studio"
}
```

**Seed script outputs (idempotent):**
- 2 roles: `super_admin`, `owner`
- 12 permissions (see section 8)
- 3 users: Jezza (super_admin), Maarten (owner), Gina (owner) — all `kind=internal`, `status=active`

**Acceptance:**
- `npm run db:migrate` applies cleanly to Neon dev branch
- `npm run db:seed` succeeds
- Re-running seed: 0 inserts/updates
- All emails stored lowercase (SQL check)

**Tokens needed:** `DATABASE_URL` + `DATABASE_URL_UNPOOLED` + 3 emails (Jezza, Maarten, Gina).

**Risk:** medium — schema is foundation. PR-isolated for rollback.

### PR-0E — Auth.js magic-link (seed-only)

**Goal:** internal users can log in. Unknown emails are rejected.

**Files created:**
```
src/lib/auth.ts                         -- Auth.js v5 config
src/app/api/auth/[...nextauth]/route.ts -- handler
src/emails/magic-link.tsx               -- React Email template (Prata + burgundy)
src/actions/sign-in.ts                  -- server action: signInWithEmail(email)
```

**Files modified:**
- `src/app/(auth)/login/page.tsx` — replace stub with real email-input form
- `src/app/(auth)/verify/page.tsx` — proper "Check je e-mail" page

**Dependencies (pinned):**
```json
{
  "next-auth": "5.0.0-beta.25",
  "resend": "4.0.1",
  "@react-email/components": "0.0.31"
}
```

**Key auth behavior:**
- `signIn` callback queries DB; if user not found OR status ≠ `active` → reject. No auto-create.
- `jwt` callback enriches token with roles + `permissionsVersion`; re-validates on every use.
- `events.signIn` writes to `audit_log`.

**Acceptance:**
- Login as Jezza/Maarten/Gina → magic link arrives within 30s
- Click link → redirects to `/admin`
- Login as `random@example.com` → "Account not found" error, **no row created**
- Used token cannot be reused
- Expired token (>15 min) rejected
- `audit_log` shows `auth.signin` event

**Tokens needed:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AUTH_SECRET`, `AUTH_URL`.

**Risk:** medium — auth.js v5 is beta. Pinned version. PR-isolated.

### PR-0F — RBAC middleware + admin shell

**Goal:** role-aware sidebar, different default landings, hard route gates.

**Files created:**
```
src/lib/permissions.ts                  -- can(user, resource, action) server helper
src/components/admin/AdminShell.tsx     -- sidebar + topbar
src/components/admin/PermissionGate.tsx -- <Gate resource action> server component
src/components/admin/SidebarNav.tsx     -- role-filtered nav items
src/app/(admin)/admin/business/page.tsx -- Maarten/Gina dashboard (placeholder cards: "Binnenkort")
src/app/(admin)/admin/system/page.tsx   -- Jezza overview
src/app/(admin)/admin/system/errors/page.tsx   -- links out to Sentry dashboard
src/app/(admin)/admin/system/audit/page.tsx    -- paginated audit_log list with filters
src/app/(admin)/admin/system/users/page.tsx    -- list users + roles (read-only)
src/app/(admin)/admin/system/roles/page.tsx    -- list roles + permissions (read-only)
```

**Files modified:**
- `src/app/(admin)/admin/page.tsx` — role-based redirect (super_admin → /system, owner → /business)
- `src/middleware.ts` — add role gates on `/admin/system/*`, `/admin/users`, `/admin/roles`

**Sidebar — super_admin (Jezza):**
```
System
  ├─ Dashboard           /admin/system
  ├─ Errors              /admin/system/errors  → links to Sentry
  ├─ Audit               /admin/system/audit
  ├─ Health              "Binnenkort" (disabled)
  ├─ Users               /admin/system/users
  └─ Roles               /admin/system/roles
Operations
  ├─ Dashboard           /admin/business
  ├─ Inbox               "Binnenkort"
  ├─ Chefs               "Binnenkort"
  ├─ Clients             "Binnenkort"
  ├─ Shifts              "Binnenkort"
  ├─ Roster              "Binnenkort"
  └─ Hours               "Binnenkort"
```

**Sidebar — owner (Maarten, Gina):**
```
Operations
  ├─ Dashboard           /admin/business
  └─ ... (same as super_admin Operations group)
```

"Binnenkort" items render as disabled rows with a burgundy pill. No dead links.

**Acceptance:**
- Jezza logs in → lands `/admin/system`, sees System + Operations
- Jezza navigates to `/admin/business` → loads (super_admin allowed everywhere)
- Maarten logs in → lands `/admin/business`, sees Operations only
- Maarten visits `/admin/system` → redirected to `/admin/business`
- Maarten visits `/admin/users` → redirected to `/admin/business`
- Unauthed → `/login?next=<original>`
- Wrong-role: no blank page, no crash

**Tokens needed:** none beyond PR-0D + PR-0E.

**Risk:** low-medium. Middleware logic is sensitive. PR-isolated.

---

## 10. Workflow — Maarten's daily flow (post-Phase 1, illustration)

Phase 0 ships empty dashboards. Phase 1 fills the Inbox. By Phase 3, this is the daily reality:

```
08:00  Maarten opens app.chefandserve.nl
       Dashboard greets him:
         • 2 nieuwe chef-aanmeldingen (Jotform → Inbox)
         • 1 nieuwe klant-aanvraag
         • 4 shifts vandaag
         • 12 placements wachten op uren-akkoord
         • Wekelijkse Payingit-sync: vrijdag 17:00

10:00  Klant-aanvraag binnen (Inbox)
       Click "Match chefs" → top 8 ranked
       Click "Propose to top 3" → emails sent via Resend
       Audit log: who matched what, when

11:30  Chef accepteert via portal
       Status: placement.confirmed
       Client krijgt bevestigingsmail met chef-foto + bio

17:00  Sous chef meldt zich ziek
       Chef markeert "no show" in portal
       Systeem suggereert 3 backup-chefs available NU
       Maarten one-click proposes → backup accepteert binnen 25 min

22:00  Chef dient uren in via portal

08:00 next day  Maarten approveert batch
                Vrijdag 17:00 → Railway cron pusht uren naar Payingit
                Payingit verzorgt loon + factuur
```

Jezza's flow (`/admin/system`):
```
08:00  Open Sentry feed (or /admin/system/errors)
       Check webhook delivery health
       Check cron job status
       Audit-log search if Maarten reports anything weird
```

---

## 11. Cost projection

All free during Phase 0. Scales gently.

| Tool | Phase 0 (free tier) | At 6mo scale | At 12mo scale |
|---|---|---|---|
| Vercel Hobby | Free | €20/mo (Pro) | €20/mo |
| Neon | 0.5 GB free | €19/mo (10 GB Launch) | €19/mo |
| Cloudflare DNS + R2 | DNS free, 10 GB R2 free | €5/mo | €10/mo |
| Resend | 3k emails/mo free | €20/mo (50k) | €20/mo |
| Railway | $5 starter credit | €10–20/mo | €20–40/mo |
| Sentry | 5k events free | Free still likely | €26/mo if needed |
| **Subtotal** | **€0** | **~€75/mo** | **~€100–120/mo** |
| Shift Manager (cancelled in Phase 4) | (whatever you pay today) | **€0** | **€0** |

**Net of Shift Manager cancellation, this likely runs at or below your current SaaS spend** with way more capability.

---

## 12. Open decisions / TODO

Things needing your input before specific PRs ship:

### Before PR-0C (Sentry)
- ☐ Create Sentry account; create Next.js project; share DSN + auth token + slugs

### Before PR-0D (DB)
- ☐ Create Neon project `chefandserve-ops`; create `dev` branch; share `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
- ☐ Confirm 3 emails: Jezza, Maarten, Gina (lowercase)

### Before PR-0E (auth)
- ☐ Create Resend account
- ☐ **Decide staging sender domain:**
  - **Option A (recommended):** verify `chefandserve.nl` in Resend — DKIM/SPF records added to Cloudflare DNS. **Risk:** if current chefandserve.nl WordPress uses its own mail (SMTP for forms?), the new DKIM records might conflict. Test before committing.
  - **Option B (safer for staging):** verify a separate domain you own (e.g. cheap test domain). Switch to chefandserve.nl at launch.
  - **Option C (zero-setup):** use Resend's `onboarding@resend.dev` for staging. Lowest deliverability, fine for testing the 3 of us, swap at launch.
- ☐ Share `RESEND_API_KEY`
- ☐ Decide `RESEND_FROM_EMAIL` (e.g. `noreply@chefandserve.nl` once verified)
- ☐ Allow me to generate `AUTH_SECRET` locally (will write to `.env.local`, never committed)

### Launch-day decisions (defer until Phase 6+ landed)
- ☐ When does the apex chefandserve.nl flip from WordPress to Vercel?
- ☐ Plan for old WordPress site graceful shutdown
- ☐ SEO redirects: any URL changes that need 301s beyond current `next.config.ts`?
- ☐ Cancel Shift Manager subscription (Phase 4 chef-portal go-live)
- ☐ Schedule Payingit integration call (Phase 5)

### Outside Phase 0 (Phase 1+ planning)
- ☐ Jotform field schemas (export JSON or share screenshots) — needed for Phase 1 webhook intake design
- ☐ Existing Shift Manager export — chefs + clients + active shifts (CSV for Phase 2 migration)
- ☐ Add additional werknemer accounts when ready (Lisa? Anna? others)

---

## Appendix — running PRs locally

```bash
# Clone & install
git clone https://github.com/Jezza5153/chefandserve2.git
cd chefandserve2
cp .env.example .env.local              # fill in tokens
npm install

# Dev
npm run dev                              # localhost:3000

# DB workflows (after PR-0D)
npm run db:generate                      # generate migration from schema.ts
npm run db:migrate                       # apply to DB
npm run db:seed                          # idempotent seed
npm run db:studio                        # browse data in Drizzle Studio

# Quality gates (run before every commit)
npm run type-check
npm run lint
npm run build
```

---

**Last updated:** PR-0A shipped. Awaiting tokens to unblock PR-0C+.

**Questions?** Open an issue or DM Jezza.
