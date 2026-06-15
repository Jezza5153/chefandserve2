/**
 * Per-shift communication timeline — a human-readable operations history for ONE
 * shift, assembled from the timestamped sources that already exist (placement
 * lifecycle, hours lifecycle, multi-actor comments, logged contacts). PURE
 * ASSEMBLY: no new data, no writes. Used by the dashboard timeline drawer so the
 * operator can see "wat is er gebeurd?" without hunting across pages.
 *
 * (Email open/delivered events exist too via emailMessages+emailEvents; a future
 * wave can fold them in — kept out of v1 to keep the join lean.)
 */
import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, contactLogs, placementComments, placements, shiftHours } from "@/lib/db/schema";

export type TimelineTone = "neutral" | "good" | "warn";
export type TimelineEvent = {
  at: Date;
  label: string;
  tone: TimelineTone;
};

function push(events: TimelineEvent[], at: Date | null | undefined, label: string, tone: TimelineTone = "neutral") {
  if (at) events.push({ at: new Date(at), label, tone });
}

/** Ordered (newest-first) timeline for a shift. Returns [] if the shift has no history yet. */
export async function getShiftTimeline(shiftId: string): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // 1. Placement lifecycle (one set per chef on the shift).
  const pls = await db
    .select({
      id: placements.id,
      chefName: chefs.fullName,
      proposedAt: placements.proposedAt,
      respondedAt: placements.respondedAt,
      confirmedAt: placements.confirmedAt,
      completedAt: placements.completedAt,
      cancelledAt: placements.cancelledAt,
    })
    .from(placements)
    .leftJoin(chefs, eq(chefs.id, placements.chefId))
    .where(eq(placements.shiftId, shiftId));

  const placementIds = pls.map((p) => p.id);
  for (const p of pls) {
    const who = p.chefName ?? "chef";
    push(events, p.proposedAt, `Voorgesteld — ${who}`);
    push(events, p.respondedAt, `Reactie van ${who}`);
    push(events, p.confirmedAt, `Bevestigd — ${who}`, "good");
    push(events, p.completedAt, `Afgerond — ${who}`, "good");
    push(events, p.cancelledAt, `Geannuleerd — ${who}`, "warn");
  }

  // 2. Hours lifecycle.
  const hrs = await db
    .select({
      submittedAt: shiftHours.submittedAt,
      clientSignedAt: shiftHours.clientSignedAt,
      adminApprovedAt: shiftHours.adminApprovedAt,
    })
    .from(shiftHours)
    .where(eq(shiftHours.shiftId, shiftId));
  for (const h of hrs) {
    push(events, h.submittedAt, "Uren ingediend");
    push(events, h.clientSignedAt, "Klant tekende de uren");
    push(events, h.adminApprovedAt, "Uren goedgekeurd", "good");
  }

  // 3. Multi-actor comments (on this shift's placements).
  if (placementIds.length > 0) {
    const comments = await db
      .select({ createdAt: placementComments.createdAt, authorKind: placementComments.authorKind, body: placementComments.body })
      .from(placementComments)
      .where(inArray(placementComments.placementId, placementIds));
    for (const c of comments) {
      push(events, c.createdAt, `Notitie (${c.authorKind}): ${snippet(c.body)}`);
    }
  }

  // 4. Logged contacts (calls / messages) tied to the shift or its placements.
  const targets = or(
    and(eq(contactLogs.entityType, "shift"), eq(contactLogs.entityId, shiftId)),
    placementIds.length > 0
      ? and(eq(contactLogs.entityType, "placement"), inArray(contactLogs.entityId, placementIds))
      : undefined,
  );
  const contacts = await db
    .select({ createdAt: contactLogs.createdAt, channel: contactLogs.channel, outcome: contactLogs.outcome, note: contactLogs.note })
    .from(contactLogs)
    .where(targets);
  for (const ct of contacts) {
    const tail = [ct.outcome, ct.note ? `"${snippet(ct.note)}"` : null].filter(Boolean).join(" · ");
    push(events, ct.createdAt, `Contact via ${ct.channel}${tail ? ` — ${tail}` : ""}`);
  }

  return events.sort((a, b) => b.at.getTime() - a.at.getTime());
}

function snippet(s: string, max = 80): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
