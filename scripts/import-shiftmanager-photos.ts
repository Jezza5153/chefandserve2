/**
 * Mining round 3 — chef PROFILE PHOTOS from the old system into R2 + chef_documents.
 *
 *   scripts/with-prod-env.sh scripts/import-shiftmanager-photos.ts \
 *     --map=~/Downloads/shiftmanager-extract/photos.txt \
 *     --roster=~/Downloads/shiftmanager-extract/roster.txt [--execute]
 *
 * WHY. `chef_documents` had 0 rows, so every ChefCard rendered initials in a circle — the
 * opposite of "Maarten knows his chefs at a glance". The old system holds a photo for 119
 * of the 204 migrated chefs.
 *
 * THE SOURCE BUCKET IS PUBLIC. The old system renders these via presigned S3 URLs, but the
 * objects answer an unsigned GET too (verified: HTTP 200 without a signature). We therefore
 * need only the filename, which the medewerker LIST pages expose — no per-chef page fetch,
 * no credentials, and nothing about the old system changes. Downloading a file we are the
 * data controller for is exactly what a migration is.
 *
 * AVG:
 * - `clientVisible: false` for EVERY row. A handful of chefs consented to photo-sharing in
 *   the old system (recorded in chefs.notes by the Medewerkers.csv import) but consent for
 *   THAT system is not consent for this one — the owner flips them per chef when asked.
 * - `status: "uploaded"` (not verified) — nobody at C&S has looked at these in the new
 *   system yet, and pretending otherwise would fake an approval trail.
 * - The photo route already gates who may fetch the bytes (internal staff with chefs.read,
 *   the chef themselves, and klanten only for client-visible docs).
 *
 * Idempotent: a chef who already has a non-deleted photo row is skipped. Dry-run default;
 * --execute refuses anything but prod.
 */
import { readFileSync } from "node:fs";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments, chefs } from "@/lib/db/schema";
import { chefDocumentKey, putObject, r2IsConfigured } from "@/lib/r2";
import { recordAuditCore } from "@/lib/audit";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)?.replace(/^~/, process.env.HOME ?? "");
const mapPath = arg("map");
const rosterPath = arg("roster");
if (!mapPath || !rosterPath) {
  console.error("Usage: import-shiftmanager-photos.ts --map=photos.txt --roster=roster.txt [--execute]");
  process.exit(2);
}

const BUCKET_BASE = "https://shooble-clients.s3.eu-central-1.amazonaws.com/chefandserve/upload/employee/photo";
const MAX_BYTES = 10 * 1024 * 1024;

const mimeFor = (f: string) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : /\.png$/i.test(f) ? "image/png" : null);

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)/)?.[1] ?? "?";
  console.log(`host: ${host} · mode: ${EXECUTE ? "EXECUTE" : "dry-run"} · R2: ${r2IsConfigured() ? "geconfigureerd" : "ONTBREEKT"}`);
  if (EXECUTE && !host.includes("ep-icy-scene")) {
    console.error("REFUSING --execute: foto's horen op prod (ep-icy-scene).");
    process.exit(2);
  }
  if (EXECUTE && !r2IsConfigured()) {
    console.error("REFUSING --execute: R2 is niet geconfigureerd in deze omgeving.");
    process.exit(2);
  }

  // uid → filename
  const photos = new Map<string, string>();
  for (const line of readFileSync(mapPath!, "utf-8").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d{17}\.jpe?g)$/i);
    if (m) photos.set(m[1], m[2]);
  }
  // uid → email (the join key to prod)
  const emailByUid = new Map<string, string>();
  for (const line of readFileSync(rosterPath!, "utf-8").split("\n")) {
    const m = line.match(/^(\d+)\s+\S+\s+.+?\s+::\s+(\S+)$/);
    if (m) emailByUid.set(m[1], m[2].toLowerCase());
  }
  console.log(`foto's in bestand: ${photos.size} · roster-koppelingen: ${emailByUid.size}`);

  const rows = await db
    .select({ id: chefs.id, fullName: chefs.fullName, email: chefs.email })
    .from(chefs)
    .where(isNull(chefs.deletedAt));
  const byEmail = new Map(rows.filter((r) => r.email).map((r) => [r.email!.toLowerCase(), r]));

  let uploaded = 0, skippedExisting = 0, noMatch = 0, failed = 0, bytes = 0;

  for (const [uid, filename] of photos) {
    const email = emailByUid.get(uid);
    const chef = email ? byEmail.get(email) : undefined;
    if (!chef) { noMatch++; continue; }

    const existing = await db
      .select({ id: chefDocuments.id })
      .from(chefDocuments)
      .where(and(eq(chefDocuments.chefId, chef.id), eq(chefDocuments.type, "photo"), isNull(chefDocuments.deletedAt)))
      .limit(1);
    if (existing.length > 0) { skippedExisting++; continue; }

    const mime = mimeFor(filename);
    if (!mime) { failed++; console.error(`  ! onbekend bestandstype: ${filename}`); continue; }

    if (!EXECUTE) { uploaded++; continue; }

    try {
      const res = await fetch(`${BUCKET_BASE}/${filename}`);
      if (!res.ok) { failed++; console.error(`  ! ${chef.fullName}: HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
        failed++;
        console.error(`  ! ${chef.fullName}: ongeldige grootte ${buf.byteLength}`);
        continue;
      }

      // Mint the row first so the R2 key can carry its id (same shape as the upload UI).
      const [doc] = await db
        .insert(chefDocuments)
        .values({
          chefId: chef.id,
          type: "photo",
          filename,
          mimeType: mime,
          sizeBytes: buf.byteLength,
          r2Key: "pending",
          clientVisible: false, // AVG: consent in the OLD system is not consent here
          status: "uploaded",
        })
        .returning({ id: chefDocuments.id });

      const key = chefDocumentKey(chef.id, doc!.id, filename);
      await putObject(key, buf, mime);
      await db.update(chefDocuments).set({ r2Key: key }).where(eq(chefDocuments.id, doc!.id));

      uploaded++;
      bytes += buf.byteLength;
    } catch (e) {
      failed++;
      console.error(`  ! ${chef.fullName}: ${String(e).slice(0, 120)}`);
    }
  }

  console.log(`\n${EXECUTE ? "geüpload" : "ZOU uploaden"}: ${uploaded} foto's${EXECUTE ? ` (${(bytes / 1048576).toFixed(1)} MB)` : ""}`);
  console.log(`  al aanwezig: ${skippedExisting} · geen prod-chef gevonden: ${noMatch} · mislukt: ${failed}`);
  console.log("  Alle foto's staan op clientVisible=false — de owner zet ze per chef vrij.");

  if (EXECUTE && uploaded > 0) {
    await recordAuditCore({
      userId: null as never,
      action: "chefs.import_photos",
      resource: "chef_documents",
      resourceId: "shiftmanager-photos",
      after: { uploaded, skippedExisting, noMatch, failed, source: "ShiftManager employee photo bucket" },
    }).catch((e) => console.error("audit failed (import ok):", e));
  }
}

main().then(() => process.exit(0));
