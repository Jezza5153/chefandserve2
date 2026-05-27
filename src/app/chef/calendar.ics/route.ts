/**
 * /chef/calendar.ics?token=… — PR-CHEF-11.
 *
 * Public-by-token ICS feed for a chef. Token authenticated via
 * users.calendarTokenSecret (rotate to revoke).
 *
 * Returns all confirmed/accepted/completed placements. Cancelled
 * placements still emitted with STATUS:CANCELLED so subscribers
 * remove the event from their calendar app.
 */

import { eq } from "drizzle-orm";
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

  // Confirm chef linked to this user
  const [chef] = await db
    .select({ id: chefs.id, name: chefs.fullName })
    .from(chefs)
    .where(eq(chefs.userId, userId))
    .limit(1);
  if (!chef) return new Response("No chef profile", { status: 404 });

  // All placements for this chef
  const rows = await db
    .select({
      placementId: placements.id,
      status: placements.status,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      shiftRole: shifts.roleNeeded,
      shiftLocation: shifts.location,
      clientName: clients.companyName,
      clientPhone: clients.phone,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(eq(placements.chefId, chef.id));

  const ics = buildIcs({
    calendarName: `Chef & Serve — ${chef.name}`,
    events: rows.map((r) => ({
      uid: placementUid(r.placementId),
      summary: `${r.shiftRole} bij ${r.clientName}`,
      description: `Klant: ${r.clientName}${r.clientPhone ? ` · ${r.clientPhone}` : ""}`,
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
