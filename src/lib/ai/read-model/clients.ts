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
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { hasActiveSubscription } from "@/lib/domain/push-subscriptions";
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

/**
 * How the office can reach a klant — AVG-safe (returns booleans + a COUNT, never the
 * actual e-mail addresses or phone). Mirrors chefReachability (#170). "Krijgt klant X
 * mijn mails / hoe bereik ik ze?": portal account (bell), web push, e-mail (does a
 * generic mail resolve to at least one recipient via recipientsForClient — respecting
 * opt-outs), and whether a separate billing address is on file.
 */
export async function clientReachability(clientId: string) {
  const [client] = await db
    .select({
      name: clients.companyName,
      billingEmail: clients.billingEmail,
      userId: clients.userId,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return null;

  const recipients = await recipientsForClient(clientId, "generic");
  const push = client.userId ? await hasActiveSubscription(client.userId) : false;

  return {
    client: { id: clientId, name: client.name },
    portalAccess: Boolean(client.userId), // portal account → in-app bell
    push,
    email: recipients.length > 0,
    emailRecipientCount: recipients.length, // COUNT only — never the addresses (AVG)
    hasBillingEmail: Boolean(client.billingEmail),
  };
}
