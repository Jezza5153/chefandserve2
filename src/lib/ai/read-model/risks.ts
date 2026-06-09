/**
 * Risk scan — forward-looking "wat kan ons deze week bijten", for proactive intelligence:
 *   1. Onderbezetting — open/aanvraag-diensten binnen 7 dagen (nog niemand bevestigd).
 *   2. Verlopende papieren bij INGEROOSTERDE chefs — een document dat verloopt terwijl de chef
 *      een bevestigde/geaccepteerde dienst in de toekomst heeft (dan kan die straks niet werken).
 *   3. Vastgelopen uren — ingediend > 5 dagen niet getekend, of concept > 3 dagen niet ingediend.
 *
 * Read-only, owner-scoped. Severity-sorted (hoog → middel).
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefDocuments, chefs, clients, placements, shiftHours, shifts } from "@/lib/db/schema";

const DOC_TYPE_NL: Record<string, string> = {
  cv: "CV", photo: "foto", certificate: "certificaat", id_document: "ID-bewijs",
  id_copy_front: "ID (voor)", id_copy_back: "ID (achter)", bsn_registration: "BSN-registratie",
  bank_card: "bankpas", other: "document",
};
const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
const names = (xs: (string | null)[], max = 3) => {
  const u = [...new Set(xs.filter((x): x is string => !!x))];
  return u.length <= max ? u.join(", ") : `${u.slice(0, max).join(", ")} +${u.length - max}`;
};

export type Risk = { ernst: "hoog" | "middel"; soort: string; melding: string };

export async function scanRisksForAi(now: Date): Promise<{ risks: Risk[]; count: number }> {
  const in2d = new Date(now.getTime() + 2 * 86_400_000);
  const in7d = new Date(now.getTime() + 7 * 86_400_000);
  const in30d = new Date(now.getTime() + 30 * 86_400_000);
  const d5ago = new Date(now.getTime() - 5 * 86_400_000);
  const d3ago = new Date(now.getTime() - 3 * 86_400_000);

  const [understaffed, expiringScheduled, stuckHours] = await Promise.all([
    db
      .select({ client: clients.companyName, at: shifts.startsAt })
      .from(shifts)
      .leftJoin(clients, eq(clients.id, shifts.clientId))
      .where(and(inArray(shifts.status, ["open", "request"]), gte(shifts.startsAt, now), lt(shifts.startsAt, in7d)))
      .orderBy(asc(shifts.startsAt)),
    db
      .select({ chef: chefs.fullName, docType: chefDocuments.type, expiresAt: chefDocuments.expiresAt, shiftAt: shifts.startsAt })
      .from(chefDocuments)
      .innerJoin(chefs, eq(chefs.id, chefDocuments.chefId))
      .innerJoin(placements, eq(placements.chefId, chefs.id))
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          isNull(chefDocuments.deletedAt),
          isNotNull(chefDocuments.expiresAt),
          lt(chefDocuments.expiresAt, in30d),
          inArray(placements.status, ["confirmed", "accepted"]),
          gte(shifts.startsAt, now),
        ),
      )
      .orderBy(asc(shifts.startsAt)),
    db
      .select({ status: shiftHours.status })
      .from(shiftHours)
      .where(
        or(
          and(eq(shiftHours.status, "submitted"), lt(shiftHours.submittedAt, d5ago)),
          and(eq(shiftHours.status, "draft"), lt(shiftHours.createdAt, d3ago)),
        ),
      ),
  ]);

  const risks: Risk[] = [];

  if (understaffed.length > 0) {
    const urgent = understaffed.some((s) => new Date(s.at) < in2d);
    risks.push({
      ernst: urgent ? "hoog" : "middel",
      soort: "onderbezetting",
      melding: `${understaffed.length} open dienst(en) binnen 7 dagen (${names(understaffed.map((s) => s.client))}) — eerstvolgende ${dayNl(understaffed[0].at)}.`,
    });
  }

  if (expiringScheduled.length > 0) {
    // one entry per (chef, doctype) — keep the soonest upcoming shift
    const seen = new Set<string>();
    const items: string[] = [];
    for (const r of expiringScheduled) {
      const key = `${r.chef}|${r.docType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(`${r.chef} (${DOC_TYPE_NL[r.docType] ?? r.docType} verloopt ${r.expiresAt ? dayNl(r.expiresAt) : "?"}, dienst ${dayNl(r.shiftAt)})`);
    }
    risks.push({
      ernst: "hoog",
      soort: "verlopend document bij ingeroosterde chef",
      melding: `${items.length} ingeroosterde chef(s) met een verlopend document: ${items.slice(0, 4).join("; ")}${items.length > 4 ? " …" : ""}.`,
    });
  }

  const submitted = stuckHours.filter((h) => h.status === "submitted").length;
  const draft = stuckHours.filter((h) => h.status === "draft").length;
  if (submitted > 0 || draft > 0) {
    const parts = [
      submitted > 0 ? `${submitted} > 5 dagen niet getekend door de klant` : "",
      draft > 0 ? `${draft} > 3 dagen niet ingediend door de chef` : "",
    ].filter(Boolean);
    risks.push({ ernst: "middel", soort: "vastgelopen uren", melding: `Urenregels blijven hangen: ${parts.join(", ")}.` });
  }

  risks.sort((a, b) => (a.ernst === b.ernst ? 0 : a.ernst === "hoog" ? -1 : 1));
  return { risks, count: risks.length };
}
