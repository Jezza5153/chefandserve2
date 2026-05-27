// Smoke test for PR-C migration. Delete after verification.
import { config } from "dotenv";
config({ path: ".env.local" });
const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

console.log("=== PR-C smoke ===\n");

const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('recovery_intents','user_recovery_codes','users','rate_limits','audit_log') ORDER BY tablename`;
console.log("Auth-related tables:", tables.map(t => t.tablename).join(", "));

const cols = await sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='recovery_intents' ORDER BY ordinal_position`;
console.log("\nrecovery_intents columns:");
for (const c of cols) {
  console.log("  " + c.column_name + " :: " + c.data_type + (c.is_nullable === "NO" ? " NOT NULL" : ""));
}

const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename='recovery_intents'`;
console.log("Indexes:", idx.map(i => i.indexname).join(", "));

const enums = await sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='recovery_intent' ORDER BY enumsortorder`;
console.log("Enum recovery_intent values:", enums.map(e => e.enumlabel).join(", "));

console.log("\n=== internal users ===");
const internalUsers = await sql`SELECT email, totp_enabled, (password_hash IS NOT NULL) AS has_password, status, kind FROM users WHERE kind='internal' ORDER BY email`;
for (const u of internalUsers) {
  console.log("  " + u.email + " :: status=" + u.status + " totp=" + u.totp_enabled + " has_password=" + u.has_password);
}

console.log("\n=== recent auth audit (last 20) ===");
const recent = await sql`SELECT action, created_at, user_id FROM audit_log WHERE action LIKE 'auth.%' ORDER BY created_at DESC LIMIT 20`;
for (const r of recent) {
  console.log("  " + r.created_at.toISOString() + "  " + r.action + (r.user_id ? "  (" + r.user_id.slice(0, 8) + "…)" : ""));
}

console.log("\n=== currently-active intents (should be 0) ===");
const live = await sql`SELECT COUNT(*)::int AS n FROM recovery_intents WHERE consumed_at IS NULL AND expires_at > now()`;
console.log("  active intents:", live[0].n);

console.log("\n=== currently-active rate-limit rows (sanity check) ===");
const rl = await sql`SELECT scope, count FROM rate_limits ORDER BY updated_at DESC LIMIT 5`;
for (const r of rl) console.log("  " + r.scope + " count=" + r.count);

console.log("\nSmoke OK ✓");
