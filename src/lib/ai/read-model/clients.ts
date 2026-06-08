/**
 * Client deep-dive read-model — the klant-360 the assistant needs ("vertel me over klant X /
 * hoeveel besteden ze / welke chefs werken er"). Wraps the hardened getClientSummary
 * (client-history.ts): money from FINAL hours only, fill-rate over realized shifts — no
 * fabrication. Cents are converted to whole euros for the brain; client-type humanised.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { clients } from "@/lib/db/schema";
import { getClientSummary } from "@/lib/domain/client-history";
import { formatClientType } from "@/lib/labels";

export async function clientHistory(clientId: string) {
  const [client] = await db
    .select({
      id: clients.id,
      name: clients.companyName,
      city: clients.city,
      clientType: clients.clientType,
      status: clients.status,
      paymentTermsDays: clients.paymentTermsDays,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const s = await getClientSummary(clientId);
  return {
    client: {
      id: client.id,
      name: client.name,
      city: client.city,
      clientType: formatClientType(client.clientType),
      status: client.status,
      paymentTermsDays: client.paymentTermsDays,
    },
    totalShifts: s.totalShifts,
    completedShifts: s.completedShifts,
    openShifts: s.openShifts,
    upcomingShifts: s.upcomingShifts,
    fillRate: s.fillRate,
    totalHoursWorked: s.totalHoursWorked,
    spendEur: Math.round(s.spendCents / 100),
    marginEur: Math.round(s.marginCents / 100),
    distinctChefs: s.distinctChefs,
    repeatChefs: s.repeatChefs,
    topChefs: s.topChefs,
    ratingsGiven: s.ratingsGiven,
    averageRatingGiven: s.averageRatingGiven,
    signoffAvgHours: s.signoffAvgHours,
    pendingSignoff: s.pendingSignoff,
  };
}

export type ClientHistory = NonNullable<Awaited<ReturnType<typeof clientHistory>>>;
