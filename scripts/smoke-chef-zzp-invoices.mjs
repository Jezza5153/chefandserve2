/**
 * Smoke — chef ZZP self-billing (CHEF-PR7). Read-only.
 * 1. chef_invoices table + enum present (mig 0071).
 * 2. decide transition guards (mirror decideChefInvoice): approve/reject only from
 *    'submitted'; paid only from 'approved'. amount validation. PDF key prefix guard.
 * Run (dev only): node --env-file=.env.local scripts/smoke-chef-zzp-invoices.mjs
 */
import { neon } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/ep-green-mouse/.test(url)) throw new Error("dev only");
const sql = neon(url);
let f = 0; const ok = (l, p) => { console.log(`${p?"✓":"✗"} ${l}`); if(!p) f++; };

const t = await sql`SELECT to_regclass(${"public.chef_invoices"}) t`;
ok("chef_invoices table present", t[0].t !== null);
const e = await sql`SELECT e.enumlabel v FROM pg_type ty JOIN pg_enum e ON e.enumtypid=ty.oid WHERE ty.typname='chef_invoice_status' ORDER BY e.enumsortorder`;
ok("status enum = concept/submitted/approved/paid/rejected",
  e.map(r=>r.v).join(",") === "concept,submitted,approved,paid,rejected");

// decide guard: which current statuses allow which decision
const allows = (decision, current) => (decision === "paid" ? ["approved"] : ["submitted"]).includes(current);
ok("approve from submitted", allows("approved","submitted"));
ok("reject from submitted", allows("rejected","submitted"));
ok("cannot approve from concept", !allows("approved","concept"));
ok("cannot approve an already-approved", !allows("approved","approved"));
ok("paid only from approved", allows("paid","approved") && !allows("paid","submitted"));

const validAmount = (c) => Number.isFinite(c) && c > 0 && c <= 5_000_000;
ok("€540 valid", validAmount(54000));
ok("€0 invalid", !validAmount(0));
ok("€50001 too large", !validAmount(5_000_100));

// PDF key prefix guard (mirror createChefInvoice): only this chef's invoices/ prefix
const acceptKey = (chefId, key) => !!key && key.startsWith(`chefs/${chefId}/invoices/`);
ok("own invoices/ key accepted", acceptKey("c1","chefs/c1/invoices/u/x.pdf"));
ok("other chef key rejected", !acceptKey("c1","chefs/c2/invoices/u/x.pdf"));

console.log(f === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${f})`);
process.exit(f === 0 ? 0 : 1);
