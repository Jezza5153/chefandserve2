/**
 * geocode-backfill — Cockpit PR-3. Populate chef + shift coordinates from
 * postcode/city via PDOK (keyless). Run after intake or on demand:
 *   npx tsx scripts/geocode-backfill.mts            # apply
 *   npx tsx scripts/geocode-backfill.mts --dry-run  # count only
 * Idempotent: only touches rows that have an address/city but no coords yet.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

const { neon } = await import("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
const { geocodeNL, geocodeCity } = await import("@/lib/domain/geo");

const DRY = process.argv.includes("--dry-run");
let chefN = 0;
let shiftN = 0;

const chefs = (await sql`
  SELECT id, postcode, house_number FROM chefs
  WHERE postcode IS NOT NULL AND latitude IS NULL AND deleted_at IS NULL
  LIMIT 500
`) as { id: string; postcode: string; house_number: string | null }[];
for (const c of chefs) {
  const ll = await geocodeNL(c.postcode, c.house_number);
  if (ll) {
    if (!DRY) await sql`UPDATE chefs SET latitude=${ll.lat}, longitude=${ll.lng}, updated_at=now() WHERE id=${c.id}`;
    chefN++;
  }
}

const shifts = (await sql`
  SELECT id, city, location FROM shifts
  WHERE (city IS NOT NULL OR location IS NOT NULL) AND latitude IS NULL
  LIMIT 500
`) as { id: string; city: string | null; location: string | null }[];
for (const s of shifts) {
  const ll = await geocodeCity(s.city ?? s.location);
  if (ll) {
    if (!DRY) await sql`UPDATE shifts SET latitude=${ll.lat}, longitude=${ll.lng}, updated_at=now() WHERE id=${s.id}`;
    shiftN++;
  }
}

console.log(`geocode-backfill: chefs=${chefN} shifts=${shiftN}${DRY ? " (dry-run — no writes)" : ""}`);
