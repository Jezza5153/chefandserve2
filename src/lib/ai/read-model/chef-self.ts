/**
 * Chef self-service read-model — the data behind the CHEF portal assistant. EVERY function
 * takes a `chefId` resolved from the session (resolveChefActor → subject.entityId), and queries
 * ONLY that chef's rows. The model never supplies an id, so a chef can only ever see their own
 * data. Mirrors the /chef dashboard queries; humanised (no raw enums) for the brain.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftHours, shifts } from "@/lib/db/schema";
import { computeChefAmountCents, formatEuro, humanStatus } from "@/lib/hours-labels";
import { formatShiftRole } from "@/lib/labels";

const dt = (d: Date | string) =>
  new Date(d).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Upcoming confirmed/accepted shifts + open proposals awaiting this chef's answer. */
export async function chefMyShifts(chefId: string) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const rows = await db
    .select({ p: placements, s: shifts, client: clients.companyName, city: shifts.city, loc: shifts.location })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(and(eq(placements.chefId, chefId), inArray(placements.status, ["proposed", "accepted", "confirmed"]), gte(shifts.startsAt, startOfToday)))
    .orderBy(shifts.startsAt);

  const proposals = rows.filter((r) => r.p.status === "proposed");
  const confirmed = rows.filter((r) => r.p.status === "accepted" || r.p.status === "confirmed");
  const shape = (r: (typeof rows)[number]) => ({
    client: r.client,
    role: formatShiftRole(r.s.roleNeeded),
    when: dt(r.s.startsAt),
    where: [r.loc, r.city].filter(Boolean).join(", ") || null,
    status: r.p.status === "proposed" ? "voorgesteld (wacht op jouw antwoord)" : r.p.status === "accepted" ? "geaccepteerd (nog te bevestigen door kantoor)" : "bevestigd",
  });
  return {
    proposals: proposals.map(shape),
    confirmed: confirmed.map(shape),
    nextConfirmed: confirmed[0] ? shape(confirmed[0]) : null,
  };
}

/** Hours buckets: to log, rejected (action needed), and the money picture. */
export async function chefMyHours(chefId: string) {
  const rows = await db
    .select({ h: shiftHours, s: shifts, client: clients.companyName })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(eq(shiftHours.chefId, chefId))
    .orderBy(desc(shifts.startsAt));

  const eur = (rs: typeof rows) => formatEuro(rs.reduce((s, { h }) => s + computeChefAmountCents(h.workedMinutes, h.chefRateCents), 0));
  const toLog = rows.filter((r) => r.h.status === "draft");
  const rejected = rows.filter((r) => r.h.status === "client_rejected" || r.h.status === "admin_rejected");
  const inControle = rows.filter((r) => r.h.status === "submitted" || r.h.status === "client_signed");
  const approved = rows.filter((r) => r.h.status === "admin_approved" || r.h.status === "exported");

  const shape = (r: (typeof rows)[number]) => ({
    client: r.client,
    role: formatShiftRole(r.s.roleNeeded),
    when: dt(r.s.startsAt),
    status: humanStatus(r.h.status),
  });
  return {
    toLog: toLog.map(shape),
    rejected: rejected.map(shape),
    money: { teOntvangen: eur(approved), inControle: eur(inControle), afgekeurd: eur(rejected) },
  };
}

/** Profile + onboarding status — "what's still missing so I can be planned + paid". */
export async function chefMyProfile(chefId: string) {
  const [c] = await db
    .select({
      name: chefs.fullName,
      vakniveau: chefs.vakniveau,
      onboardingStatus: chefs.onboardingStatus,
      city: chefs.city,
      phone: chefs.phone,
      hasIban: chefs.ibanEncrypted,
      hasBsn: chefs.bsnEncrypted,
      idType: chefs.idType,
    })
    .from(chefs)
    .where(eq(chefs.id, chefId))
    .limit(1);
  if (!c) return null;
  const missing: string[] = [];
  if (!c.hasIban) missing.push("IBAN (voor uitbetaling)");
  if (!c.hasBsn) missing.push("BSN");
  if (!c.idType) missing.push("ID-bewijs");
  if (!c.phone) missing.push("telefoonnummer");
  const onboarding =
    c.onboardingStatus === "submitted" ? "afgerond" : c.onboardingStatus === "in_progress" ? "nog niet af" : "nog niet gestart";
  return {
    name: c.name,
    vakniveau: formatShiftRole(c.vakniveau),
    city: c.city,
    onboarding,
    missing,
  };
}
