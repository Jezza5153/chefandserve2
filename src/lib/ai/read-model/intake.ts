/**
 * Intake inbox read-model — the new/awaiting-triage applications the owner clears: chef
 * applications (who applied, what role, experience, where) and klant requests (which company,
 * what they need, when, headcount). Closes the assistant's biggest blind spot: it knew the
 * intake COUNT but couldn't see WHO. Read-only; owner-gated (inbox.read).
 */
import { desc, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefSubmissions, clientSubmissions } from "@/lib/db/schema";

const SUB_STATUS_NL: Record<string, string> = {
  new: "nieuw", triaged: "bekeken", converted: "omgezet", rejected: "afgewezen",
  duplicate: "duplicaat", cancelled_by_client: "ingetrokken",
};
const OPEN = ["new", "triaged"] as const;
const dayNl = (d: Date | string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });

export async function intakeInboxForAi(args: { limit: number }) {
  const [chefSubs, clientSubs] = await Promise.all([
    db
      .select({
        fullName: chefSubmissions.fullName,
        roles: chefSubmissions.rolesRequested,
        years: chefSubmissions.yearsExperience,
        place: chefSubmissions.locationPreference,
        status: chefSubmissions.status,
        notes: chefSubmissions.notes,
        at: chefSubmissions.createdAt,
      })
      .from(chefSubmissions)
      .where(inArray(chefSubmissions.status, [...OPEN]))
      .orderBy(desc(chefSubmissions.createdAt))
      .limit(args.limit),
    db
      .select({
        company: clientSubmissions.companyName,
        contact: clientSubmissions.contactName,
        role: clientSubmissions.roleRequested,
        segment: clientSubmissions.segment,
        place: clientSubmissions.location,
        when: clientSubmissions.dateNeeded,
        headcount: clientSubmissions.headcount,
        status: clientSubmissions.status,
        notes: clientSubmissions.notes,
        at: clientSubmissions.createdAt,
      })
      .from(clientSubmissions)
      .where(inArray(clientSubmissions.status, [...OPEN]))
      .orderBy(desc(clientSubmissions.createdAt))
      .limit(args.limit),
  ]);

  return {
    chefs: chefSubs.map((s) => ({
      naam: s.fullName ?? "onbekend",
      wil: s.roles ?? "—",
      ervaring: s.years != null ? `${s.years} jr` : null,
      plaats: s.place ?? null,
      status: SUB_STATUS_NL[s.status] ?? s.status,
      aangevraagd: dayNl(s.at),
      notitie: s.notes ?? null,
    })),
    klanten: clientSubs.map((s) => ({
      bedrijf: s.company ?? "onbekend",
      contact: s.contact ?? null,
      rol: s.role ?? null,
      segment: s.segment ?? null,
      plaats: s.place ?? null,
      wanneer: s.when ?? null,
      aantal: s.headcount ?? null,
      status: SUB_STATUS_NL[s.status] ?? s.status,
      aangevraagd: dayNl(s.at),
      notitie: s.notes ?? null,
    })),
    totaal: chefSubs.length + clientSubs.length,
  };
}
