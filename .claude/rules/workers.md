---
paths:
  - "workers/**"
  - "src/app/api/cron/**"
  - "src/app/api/webhooks/**"
---

# Workers, cron routes & webhooks — working rules

## Architecture (thin ticker → app-side route)

- Railway runs ONE process: `workers/supervisor.ts` schedules JOBS (node-cron, Europe/Amsterdam) and spawns each job as a fresh `tsx` subprocess.
- Standalone workers CANNOT import the `@/` alias — anything needing shared read-models/domain lives app-side at `src/app/api/cron/<name>/route.ts`, and the worker is a thin ticker that POSTs it (see `daily-briefing.ts` / `onboarding-nudge.ts`).
- Cron routes auth with `Authorization: Bearer <CRON_SECRET>` compared via `timingSafeEqual`; no secret configured → 503.
- Webhook routes (e.g. `resend-inbound`) verify svix HMAC signatures BEFORE processing, land the raw payload in `webhooks_received` (with `signatureValid`), and return 200 on per-item processing errors so one bad payload can't wedge provider retries.

## Conventions for a new job

- Dark-launch: gate on a `<NAME>_ENABLED` env flag (default off) — check it in BOTH the worker and the route.
- Idempotent: a re-fire must be harmless (dedup ledger, per-user recency throttle, or a `lastSentDate` guard).
- Register in the `JOBS` array in `supervisor.ts` with a comment stating schedule + gate.
- Notifications from jobs go through `createNotification()` (best-effort, never throw into the job).

## Verify & run

```bash
cd workers && npx tsc --noEmit          # workers have their own tsconfig — always run on worker changes
npx tsx workers/<name>.ts               # manual one-shot
npx tsx workers/supervisor.ts --run-now=<name>
```

Railway needs `CRON_SECRET` + `NEXT_PUBLIC_APP_URL` (+ the job's own flag) in its env.
