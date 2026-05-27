# Chef & Serve — Background workers (Railway)

Stand-alone Node scripts that run on Railway as scheduled jobs. They share
the same DB (`DATABASE_URL_UNPOOLED`) + emails (`RESEND_API_KEY`) as the
main Next.js app on Vercel.

**Why Railway and not Vercel?** Vercel functions have a 60-second timeout
that's fine for webhooks but bad for batch jobs. Railway lets us run
processes for minutes/hours, with predictable cron scheduling.

## Workers in this folder

| File | Purpose | Suggested schedule |
|---|---|---|
| `weekly-digest.ts` | Email Maarten a Monday morning summary of last week | `0 8 * * MON` |
| `payingit-sync.ts` | Push approved hours to Payingit | `0 17 * * FRI` (stub for now) |
| `embedding-refresh.ts` | Compute embeddings for new/changed chefs/clients/shifts | `0 3 * * *` (3am daily) |
| `error-digest.ts` | Email Jezza last 24h of errors if any | `0 7 * * *` (7am daily) |

## How to deploy a worker to Railway

1. Push this folder to GitHub (already done — workers/ is in the repo)
2. In Railway: New Project → Deploy from GitHub → pick `chefandserve2`
3. Settings → Root Directory → `workers`
4. Settings → Variables → import from Vercel (or set manually):
   - `DATABASE_URL_UNPOOLED`
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `JEZZA_EMAIL`, `MAARTEN_EMAIL` (for digest recipients)
   - `OPENAI_API_KEY` (only needed for `embedding-refresh.ts`)
5. Settings → Service Name → e.g. `cs-weekly-digest`
6. Build command: `npm install`
7. Start command: `npx tsx weekly-digest.ts` (or whichever file)
8. Settings → Cron Schedule → paste the schedule from the table above

Each worker is independent. You can deploy them all to one Railway project
as separate services, or one per project — your call.

## Local testing

From the project root:

```bash
# Test a worker locally (uses .env.local for credentials)
npx tsx workers/weekly-digest.ts
```

## Adding a new worker

1. Drop a new `.ts` file in this folder
2. Import db client from `../src/lib/db/client.ts` if you want shared schema
   (or copy minimal deps — workers can be standalone)
3. Use `process.exit(0)` on success, `process.exit(1)` on failure so Railway
   marks the cron run correctly
4. Add a row to the table above + this README

## Anti-patterns to avoid

- **Don't import from `@/lib/auth`** — Auth.js depends on Next.js runtime
- **Don't import React/email templates** — they need Next bundler. Use raw
  `resend.emails.send({ from, to, subject, html: "<plain html>" })` instead.
- **Don't run mutations without an audit_log row** — workers should write
  `userId: null, action: "worker.<name>"` to keep the audit trail honest
