/**
 * Import klanten from the old system's export_debiteur_contacten.csv.
 *
 *   npx tsx --env-file=<env> scripts/import-debiteuren.ts --file=path.csv           # DRY RUN
 *   npx tsx --env-file=<env> scripts/import-debiteuren.ts --file=path.csv --execute # writes (prod only)
 *
 * ⚠️ THE EXPORT IS MISALIGNED (owner's warning was right). Verified against the data:
 *   header "Achternaam:Email:Mobiel"  → the column holds ONLY the surname
 *   header "Fuctie"                   → the column holds the EMAIL
 *   header "Andere filialen"          → the column holds the PHONE (or literal
 *                                       "onbekend" = null; 4 such rows)
 * There is NO functie field in the data. Do not "fix" this mapping to match the
 * header — the header lies, the data above is verified (74/74 emails contain @,
 * 56/60 phone-shaped values in the last column).
 *
 * STRUCTURE (74 rows = contact persons, 37 bedrijven, 41 (bedrijf,filiaal) pairs):
 * - Filiaalnaam is usually just the CITY or a name variant → ONE client per bedrijf.
 * - EXCEPT real multi-venue companies (Baut ×4, Park Plaza ×2): one client per
 *   filiaal, named "Bedrijf — Filiaal", because shifts happen at a location.
 * - Land comes in three spellings (NL/Nederland/Nederlands) → normalized away.
 *
 * CONTACTS → client_contacts is UNIQUE per (client, role):
 * - best ops contact  → role "planning" + becomes clients.contactName/email/phone
 * - billing-ish email → role "finance"  + clients.billingEmail
 *   (billing-ish = facturen@|administratie@|invoice|crediteuren|finance@|AP@|inkoop)
 * - second ops        → role "onsite"
 * - any further contacts overflow into clients.notes (no role squatting).
 * - internal @chefandserve.nl contacts (6 rows) create the CLIENT but never a
 *   contact row: klant mail must not route back to the agency. Listed in the census.
 *
 * Idempotent on lower(companyName): existing clients are skipped, never overwritten.
 * status: "active" — these are the CURRENT paying customers of the old system.
 * Debiteurnr is not imported (same call as Medewerker ID; recoverable from the CSV
 * via external_refs if invoice migration ever needs it).
 */
import { readFileSync } from "node:fs";

import { and, isNull, sql as dsql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clientContacts, clients } from "@/lib/db/schema";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const fileArg = args.find((a) => a.startsWith("--file="))?.slice(7);
if (!fileArg) {
  console.error("Usage: import-debiteuren.ts --file=path.csv [--execute]");
  process.exit(2);
}

/* ----- csv (semicolon, quoted) — same parser as import-medewerkers ---------- */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ";") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]!).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const vals = parseLine(l);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = (vals[i] ?? "").trim()));
    return row;
  });
}

/* ----- the verified (mis)mapping -------------------------------------------- */
type Contact = { name: string; email: string; phone: string | null; billing: boolean; internal: boolean };

const BILLING_RE = /(factu|invoice|administrat|crediteur|finance|inkoop|(^|[._-])ap@)/i;

function contactFrom(r: Record<string, string>): Contact | null {
  const surname = (r["Achternaam:Email:Mobiel"] ?? "").trim(); // ← surname ONLY (verified)
  const email = (r["Fuctie"] ?? "").trim().toLowerCase();       // ← the EMAIL (verified)
  const phoneRaw = (r["Andere filialen"] ?? "").trim();          // ← the PHONE (verified)
  if (!email || !email.includes("@")) return null;
  const phone = /onbekend/i.test(phoneRaw) || !phoneRaw ? null : phoneRaw.replace(/^\(0\)/, "0");
  const name = `${(r["Voornaam"] ?? "").trim()} ${surname}`.replace(/\s+/g, " ").trim() || email.split("@")[0]!;
  return {
    name,
    email,
    phone,
    billing: BILLING_RE.test(email),
    internal: email.endsWith("@chefandserve.nl"),
  };
}

/** Companies where filiaal = a real separate venue → one client per filiaal. */
const MULTI_VENUE = new Set(["baut b.v.", "park plaza hotel"]);

function segmentGuess(name: string): string | null {
  const n = name.toLowerCase();
  if (/(hotel|hilton|waldorf|astoria|valk|nh |nhow|krasnapolsky|park plaza|parkinn|renaissance|conscious|anantara)/.test(n)) return "hotel";
  if (/(event|catering)/.test(n)) return "event";
  if (/(café|cafe|brasserie|bar |gastrobar|strand|beach|cantina|paviljoen)/.test(n)) return "casual";
  return null; // owner fills the rest — a wrong segment steers matching wrong
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: klant data belongs on prod (ep-icy-scene) only.");
    process.exit(2);
  }

  const rows = parseCsv(readFileSync(fileArg!, "utf-8"));
  console.log(`csv rows: ${rows.length}`);

  // group contact rows into clients
  type Group = { companyName: string; city: string | null; address: string | null; contacts: Contact[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const bedrijf = (r["Bedrijfsnaam"] ?? "").trim();
    if (!bedrijf) continue;
    const filiaal = (r["Filiaalnaam"] ?? "").trim();
    const isMulti = MULTI_VENUE.has(bedrijf.toLowerCase());
    const companyName = isMulti && filiaal ? `${bedrijf} — ${filiaal}` : bedrijf;
    const key = companyName.toLowerCase();

    if (!groups.has(key)) {
      const straat = (r["straat"] ?? "").trim();
      const nr = (r["Huisnnummer"] ?? "").trim(); // header typo is the export's, not ours
      const pc = (r["Postcode"] ?? "").trim().toUpperCase().replace(/^(\d{4})\s?([A-Z]{2})$/, "$1 $2");
      groups.set(key, {
        companyName,
        city: (r["Plaats"] ?? "").trim() || null,
        address: [straat && nr ? `${straat} ${nr}` : straat || null, pc || null].filter(Boolean).join(", ") || null,
        contacts: [],
      });
    }
    const c = contactFrom(r);
    if (c) groups.get(key)!.contacts.push(c);
  }
  console.log(`clients to consider: ${groups.size}`);

  const existing = await db
    .select({ companyName: clients.companyName })
    .from(clients)
    .where(and(isNull(clients.deletedAt), dsql`true`));
  const existingNames = new Set(existing.map((r) => r.companyName.toLowerCase()));

  let inserted = 0, skipped = 0, contactRows = 0, internalSkipped = 0, overflowed = 0;
  const internalList: string[] = [];

  for (const g of groups.values()) {
    if (existingNames.has(g.companyName.toLowerCase())) { skipped++; continue; }

    const internal = g.contacts.filter((c) => c.internal);
    if (internal.length) { internalSkipped += internal.length; internalList.push(g.companyName); }
    const external = g.contacts.filter((c) => !c.internal);
    const billing = external.filter((c) => c.billing);
    const ops = external.filter((c) => !c.billing);
    const primary = ops[0] ?? billing[0] ?? null;
    const financeContact = billing[0] ?? null;
    const onsite = ops[1] ?? null;
    const overflow = external.filter((c) => c !== primary && c !== financeContact && c !== onsite);

    const noteParts = ["Geïmporteerd uit oud systeem (export_debiteur_contacten.csv)"];
    if (overflow.length) {
      noteParts.push(`Extra contacten: ${overflow.map((c) => `${c.name} <${c.email}>${c.phone ? ` ${c.phone}` : ""}`).join(" · ")}`);
      overflowed += overflow.length;
    }
    if (internal.length) noteParts.push("Contact liep in het oude systeem via Chef & Serve zelf — echte klant-contactpersoon nog vast te leggen");

    if (!EXECUTE) { inserted++; contactRows += [primary, financeContact, onsite].filter(Boolean).length; continue; }

    const [row] = await db
      .insert(clients)
      .values({
        companyName: g.companyName,
        contactName: primary?.name ?? null,
        email: primary?.email ?? null,
        phone: primary?.phone ?? null,
        billingEmail: financeContact?.email ?? null,
        address: g.address,
        city: g.city,
        segment: segmentGuess(g.companyName) as never,
        status: "active",
        notes: noteParts.join(" · "),
      })
      .returning({ id: clients.id });

    const contactValues: (typeof clientContacts.$inferInsert)[] = [];
    if (primary) contactValues.push({ clientId: row!.id, name: primary.name, email: primary.email, phone: primary.phone, role: "planning" });
    if (financeContact && financeContact.email !== primary?.email) {
      contactValues.push({ clientId: row!.id, name: financeContact.name, email: financeContact.email, phone: financeContact.phone, role: "finance" });
    }
    if (onsite) contactValues.push({ clientId: row!.id, name: onsite.name, email: onsite.email, phone: onsite.phone, role: "onsite" });
    if (contactValues.length) {
      await db.insert(clientContacts).values(contactValues).onConflictDoNothing();
      contactRows += contactValues.length;
    }
    inserted++;
  }

  console.log(`\n  ${EXECUTE ? "inserted" : "WOULD insert"}: ${inserted} clients · ${contactRows} contact rows`);
  console.log(`  skipped (companyName already in system): ${skipped}`);
  console.log(`  internal @chefandserve.nl contacts skipped: ${internalSkipped} (bij: ${internalList.join(", ") || "-"})`);
  console.log(`  overflow contacts → notes: ${overflowed}`);

  if (EXECUTE && inserted > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "clients.import",
      resource: "clients",
      resourceId: "debiteuren-csv",
      after: { inserted, contactRows, skipped, source: "export_debiteur_contacten.csv (oud systeem)" },
    }).catch((e) => console.error("audit failed (import succeeded):", e));
  }
}

main().then(() => process.exit(0));
