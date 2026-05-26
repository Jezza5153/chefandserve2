# Chef & Serve — Operations Platform Roadmap

> Permanent reference for the v2.0 build. Closed-system, single-tenant SaaS replacing Shift Manager with a Chef-and-Serve–tailored roster + matching system, integrated with Payingit for payroll and Jotform for intake.

**Repo:** https://github.com/Jezza5153/chefandserve2
**Marketing site:** https://chefandserve.nl (already deployed)
**App (future):** https://app.chefandserve.nl (or `/admin`, `/chef`, `/client` paths under main domain)

---

## Stack

| Tool | Job |
|---|---|
| **Vercel** | Hosting for Next.js app (marketing + admin + portals) |
| **Neon** | Serverless Postgres (prod / staging / dev branches) |
| **Cloudflare** | DNS + R2 object storage (CVs, photos, certificates, signed contracts) |
| **Resend** | All transactional email (magic links, shift confirmations, digests) |
| **Railway** | Background workers + cron (Payingit sync, AI batches, WhatsApp/SMS) |
| **Sentry** | Error monitoring (free tier — feeds the IT-admin dashboard) |
| **Auth.js v5** | Authentication (email magic links via Resend, Neon adapter) |
| **Jotform** | Public-facing intake forms — kept for low-friction lead capture |
| **Payingit** | Backoffice (loondienst contracts, payroll, AFAS, invoicing) — kept as integration partner |

**Closed-system simplification:** single-tenant. No `org_id` on tables. No public signup — all accounts created by admins.

---

## Roles

| Role | Person | Access |
|---|---|---|
| `super_admin` (IT) | Jezza | Sentry feed, audit log, webhook diagnostics, DB tools, impersonation, cron status, slow queries |
| `owner` | Maarten | Full business view: chefs, clients, shifts, hours, financials, daily digest. NO technical/error views |
| `coordinator` | e.g. Lisa | Read+write chefs/clients/shifts/placements · approve hours. NO financial totals, NO role mgmt, NO invoices |
| `recruiter` | Talent ops | Read+write chefs · read shifts. NO clients, NO invoicing, NO payroll |
| `bookkeeper` | Finance | Read+write hours/invoices/payments. NO chef profile edits, NO roster |
| `sales` | BD | Read+write clients · read shifts. NO chef rates, NO payroll |
| `read_only` | Audit/observer | Read everything · mutate nothing |
| `chef` | Chef-network | Own profile · own shifts · own hours · own availability |
| `client` | Client company | Own company · own upcoming shifts · own invoices |

Custom roles can be created at `/admin/roles` (super_admin only) by toggling `(resource, action)` permissions.

**Authorization model:** RBAC with `(resource, action)` permission grain.
- Permissions: `chefs.read`, `chefs.write`, `chefs.delete`, `clients.read`, … (~40 in total)
- Roles bundle permissions
- Users have one or more roles
- All checks server-side. UI hides things the user can't see.
- Every mutation logs to `audit_log`.

---

## Database (high-level)

~14 tables for v1:

```
users                ─ everyone who logs in
roles                ─ named permission bundles
permissions          ─ (resource, action) primitives
role_permissions     ─ many-to-many
user_roles           ─ many-to-many

chefs                ─ full chef profile (vakniveau, segments, locatie, rate, Payingit ID)
chef_availability    ─ chef × date × available/blocked

clients              ─ company info (KvK, BTW, payment terms, Payingit client ID)

shifts               ─ client request for staff (date, role, segment, headcount, rate)
placements           ─ chef × shift (status, hours, amounts)
hours                ─ approved hours per placement (synced to Payingit)

messages             ─ outbound communications log (Resend tracking)
audit_log            ─ who did what when (super_admin only)
errors               ─ app-level errors with user context (super_admin only)
webhooks_received    ─ raw Jotform/Payingit/etc. webhooks (for replay + debug)
```

Sensitive fields (BSN, bank details) are encrypted at the column level using `pgcrypto`.

---

## Maarten's daily workflow (`/admin/business`)

```
08:00 dashboard
  📥 Inbox: new Jotform submissions
  📅 Today's shifts (with status indicators)
  ⏰ Actions needed: approvals pending, conflicts
  💶 Financial pulse: this week's revenue, hours pending payment
  ⭐ Chef ratings: highlights + low scores needing follow-up

10:00 — New client request lands
  → Click "Match chefs" → top 8 ranked by (vakniveau × segment × distance × history)
  → "Propose to top 3" → Resend sends + portal notifications

11:30 — Chef accepts → placement.confirmed
  → Calendar updates, client gets confirmation with chef photo + bio

22:00 — Chef submits hours via portal

08:00 next day — Maarten approves batch
Friday 17:00 — Railway cron pushes week to Payingit → payroll + invoicing flow
```

## Jezza's daily workflow (`/admin/system`)

```
- Sentry error feed (last 24h)
- Webhook delivery health (Jotform, Payingit)
- Cron job status (last run, last success, queue depth)
- Slow query report
- Audit log search (who touched X, when)
- Impersonation tool (login as any user to repro bugs)
- DB connection pool health
```

---

## Roadmap — 12-week build

### Phase 0 — Foundation *(week 1)*
- [ ] Neon DB project provisioned (prod + staging + dev branches)
- [ ] Schema migration #1: users, roles, permissions, audit_log, errors, webhooks_received
- [ ] Auth.js v5 + Resend magic links + Neon adapter
- [ ] App shell layout: `(admin)`, `(chef)`, `(client)` route groups
- [ ] Seed first super_admin (Jezza) + owner (Maarten)
- [ ] Cloudflare DNS for `app.chefandserve.nl` → Vercel (or use `/admin` path)
- [ ] Sentry installed, errors flowing
- [ ] Vercel preview deployments wired to Neon staging branch

**Deliverable:** Maarten + Jezza can log in via magic link. Empty dashboards visible.

### Phase 1 — Jotform intake capture *(week 2)*
- [ ] `chef_submissions` + `client_submissions` tables
- [ ] `/api/intake/chef` + `/api/intake/client` webhook receivers with signature verification
- [ ] Jotform webhooks pointed at our endpoints
- [ ] `/admin/inbox` showing new submissions with raw-payload viewer
- [ ] Resend email to Maarten on every new submission
- [ ] "Convert to chef" / "Convert to client" buttons

**Deliverable:** every Jotform fill lands in DB + Maarten's inbox.

### Phase 2 — Chef + client master records *(weeks 3-4)*
- [ ] `chefs` + `clients` full schema
- [ ] `/admin/chefs` + `/admin/clients`: list, filter, search, detail page
- [ ] Tabs: profile · documents · availability · history · notes
- [ ] File uploads to Cloudflare R2 (CV, photos, certificates) with virus scan + signed URLs
- [ ] Tags · segments · vakniveau
- [ ] Bulk import existing Shift Manager chefs (one-time CSV)

**Deliverable:** all chef + client data lives in your DB.

### Phase 3 — Shifts + roster + matching *(weeks 5-7)*
- [ ] `shifts` + `placements` tables
- [ ] Roster view: weekly calendar, drag-drop chefs onto shifts
- [ ] Conflict detection (double-booked, unavailable)
- [ ] **Smart match v1**: ranking by `(vakniveau match × segment overlap × distance × history × current availability)`
- [ ] "Propose to chef" → Resend email + portal notification
- [ ] Chef acceptance flow (email link or portal button)

**Deliverable:** Maarten runs the roster entirely in-house.

### Phase 4 — Chef portal *(weeks 8-9)*
- [ ] Chef login (role=chef)
- [ ] `/chef/dashboard` — upcoming shifts, hours due, profile
- [ ] Availability calendar UI (toggle days, block weeks)
- [ ] Accept/decline proposed shifts
- [ ] Submit hours after shift
- [ ] Mobile-friendly responsive PWA
- [ ] **Migrate chefs from Shift Manager in batches**
- [ ] Cancel Shift Manager once last chef migrated

**Deliverable:** chefs use chefandserve.nl exclusively. Shift Manager retired. **You stop paying Shift Manager.**

### Phase 5 — Hours approval + Payingit bridge *(week 10)*
- [ ] Hours approval UI
- [ ] Validation (claimed vs. scheduled vs. reasonable overtime)
- [ ] **Talk to Payingit, get integration spec** (their SFTP/CSV/API)
- [ ] Railway cron: every Friday 17:00, push week's approved hours to Payingit
- [ ] Sync-status back: pending / paid / failed
- [ ] Discrepancy report

**Deliverable:** end-to-end loop closed. Jotform → DB → roster → shift → hours → Payingit → paid.

### Phase 6 — Client portal *(weeks 11-12)*
- [ ] Client login (role=client)
- [ ] `/client/dashboard` — upcoming bookings with chef photos + bios
- [ ] Request more staff (form posts to `shifts` with status='request')
- [ ] Invoice access (PDF via Resend or signed R2 URL)
- [ ] Rate chef after shift (feeds back into matching score)

**Deliverable:** clients self-serve.

### Phase 7 — Communications layer *(week 13)*
- [ ] React Email templates: shift_confirmed · hours_due · invoice_ready · weekly_digest · cancellation
- [ ] WhatsApp Business API via Railway worker — urgent shift fills only
- [ ] SMS fallback via Twilio
- [ ] In-app notifications + read receipts

### Phase 8 — IT-admin lane *(week 14)* — Jezza's super-admin views
- [ ] `/admin/system/errors` — curated Sentry view + custom errors table
- [ ] `/admin/system/audit` — searchable audit log
- [ ] `/admin/system/health` — webhooks, crons, queue depth, slow queries
- [ ] Daily IT digest email at 7am to Jezza
- [ ] Impersonation flow (login as any user to repro bugs)

**Deliverable:** Jezza has one URL to check every morning. Bugs get fixed fast.

### Phase 9 — AI matching layer *(weeks 15-18)* — once historical data is rich
- [ ] Embedding model on placement-success history
- [ ] Auto-suggest top-3 chefs for every new client request
- [ ] Cancellation-risk prediction per chef per week
- [ ] Demand forecast: "next week you'll be short 4 sous chefs"
- [ ] Tariff optimization: "raise chef-X's rate, they're underpriced"
- [ ] OpenAI/Claude API on structured data — cheap with proper context

### Phase 10 — Native-feeling mobile PWA *(weeks 19+)*
- [ ] Install-as-app on iOS/Android
- [ ] Push notifications for shift offers (web push)
- [ ] Offline cache: "my next 7 shifts"

---

## Cost projection

| Tool | Free tier | Month 4+ |
|---|---|---|
| Vercel Hobby | Free | €20/mo (Pro) |
| Neon | 0.5GB free | €19/mo (Launch, 10GB) |
| Cloudflare DNS + R2 | First 10GB R2 free | ~€5/mo |
| Resend | 3k emails/mo free | €20/mo (50k emails) |
| Railway | $5 starter | €10-20/mo |
| Sentry | 5k events free | Stays free |
| **Total** | **€0** | **~€75/mo** |

Cheaper than Shift Manager, and you own the stack.

---

## What's still needed from Maarten / Jezza

1. **Subdomain decision**: `app.chefandserve.nl` (recommended) or `/admin` paths under main domain?
2. **Jotform field schemas**: export or screenshots of both forms (chef intake + client intake)
3. **Account credentials needed**:
   - Neon: project ID + dev branch connection string
   - Resend: API key + verified `chefandserve.nl` domain (DKIM/SPF)
   - Cloudflare R2: `chefandserve-docs` bucket + API token
   - Sentry: DSN for new Next.js project
   - Railway: project linked to GitHub repo
4. **Payingit integration spec**: 30-min call with Payingit asking *"how do other staffing agencies push hours and chef onboarding to you? CSV/SFTP/API?"*
5. **Existing Shift Manager export**: CSV of current chefs + clients + active shifts (needed for Phase 2 + 4 migration)
6. **First werknemer roles to seed**: just `super_admin` + `owner` for now, or pre-seed `coordinator` / `recruiter` / etc.?

---

## Reference

- **Main project CLAUDE.md** (legacy WP context): `/Users/jezza/Documents/Projects/chef-serve-seo/CLAUDE.md`
- **Marketing site repo**: this one (`chefandserve2.0/`)
- **App will live in same repo** under `(admin)`, `(chef)`, `(client)` Next.js route groups (single deployment, single auth, isolated layouts)
