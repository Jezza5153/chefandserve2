/**
 * /client/calendar.ics?token=… — PR-CHEF-11.
 *
 * Klant calendar feed. Shows confirmed/accepted shifts where any chef
 * is placed for this klant. Cancelled placements emitted with
 * STATUS:CANCELLED so calendar apps remove them.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shifts, users } from "@/lib/db/schema";
import {
  buildIcs,
  icsEtag,
  parseCalendarToken,
  placementUid,
} from "@/lib/calendar/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) return new Response("Token required", { status: 401 });

  const userId = await parseCalendarToken({
    token,
    lookupSecret: async (uid) => {
      const [u] = await db
        .select({ secret: users.calendarTokenSecret })
        .from(users)
        .where(eq(users.id, uid))
        .limit(1);
      return u?.secret ?? null;
    },
  });
  if (!userId) return new Response("Invalid token", { status: 401 });

  const [client] = await db
    .select({ id: clients.id, name: clients.companyName })
    .from(clients)
    .where(eq(clients.userId, userId))
    .limit(1);
  if (!client) return new Response("No client profile", { status: 404 });

  const rows = await db
    .select({
      placementId: placements.id,
      status: placements.status,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      shiftRole: shifts.roleNeeded,
      shiftLocation: shifts.location,
      chefName: chefs.fullName,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(and(eq(shifts.clientId, client.id)));

  const ics = buildIcs({
    calendarName: `Chef & Serve — ${client.name}`,
    events: rows.map((r) => ({
      uid: placementUid(r.placementId),
      summary: `${r.shiftRole}: ${r.chefName}`,
      description: `Chef: ${r.chefName} · Status: ${r.status}`,
      location: r.shiftLocation ?? undefined,
      startsAt: new Date(r.shiftStart),
      endsAt: new Date(r.shiftEnd),
      status:
        r.status === "cancelled" || r.status === "rejected" || r.status === "no_show"
          ? "CANCELLED"
          : r.status === "proposed"
            ? "TENTATIVE"
            : "CONFIRMED",
    })),
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=60",
      ETag: `"${icsEtag(ics)}"`,
    },
  });
}
