---
paths:
  - "src/lib/db/**"
  - "drizzle/**"
---

# Database & migrations — working rules

## Workflow

1. Edit `src/lib/db/schema.ts` → `npm run db:generate -- --name <x>` → **inspect the SQL**.
2. Additive-only on shared tables (`clients`, `chefs`, `shifts`, `placements`): never DROP/ALTER columns owned by parallel chats — billing/payingit/invoices (invoicing chat), `clients.intel` (intel chat).
3. `npm run db:migrate` applies to DEV (`.env.local`, branch `ep-green-mouse`).
4. Migration numbers can collide across parallel chats — check `drizzle/meta/_journal.json` has exactly one entry per number before merging; renumber yours if theirs landed first.

## Postgres/Neon gotchas

- neon-http driver: NO interactive transactions. Atomic single statements (`UPDATE … WHERE status='expected'`, reject on 0 rows), `withTx` for mutation+audit pairing, or sequential + self-healing rollups.
- Enums: APPEND values only (code array order = DB order); `ALTER TYPE … ADD VALUE` can't run in a transaction with other statements.
- Partial unique index upserts: `ON CONFLICT (...) WHERE <predicate> DO NOTHING` — a bare ON CONFLICT against a partial index throws 42P10.
- Before adding a unique index over existing data: run the duplicate-preflight (`GROUP BY … HAVING count(*)>1`) and resolve dupes first (most-filled row wins, else newest `updated_at`).

## Applying to PROD (the footgun)

`drizzle.config.ts` AND `src/lib/db/seed-forms.ts` hard-code `config({ path: ".env.local" })` and read
`DATABASE_URL_UNPOOLED ?? DATABASE_URL` — dotenv does NOT override shell vars, so exporting only
`DATABASE_URL` silently migrates DEV. Always:

```bash
npx vercel env pull /tmp/cs-prod.env --environment=production --yes
grep -oE 'ep-[a-z0-9-]+' /tmp/cs-prod.env | sort -u        # MUST print ep-icy-scene (prod). ep-green-mouse = dev → STOP.
export DATABASE_URL_UNPOOLED="$(grep -E '^DATABASE_URL_UNPOOLED=' /tmp/cs-prod.env | cut -d= -f2- | tr -d '"')"
export DATABASE_URL="$DATABASE_URL_UNPOOLED"
npm run db:migrate                                          # idempotent; applies only pending
npx tsx --env-file=/tmp/cs-prod.env src/lib/db/seed-forms.ts   # if forms changed (idempotent)
rm /tmp/cs-prod.env                                         # never leave prod secrets on disk
```

Verify afterwards via `information_schema` (table/column/enum present) — never assume.
