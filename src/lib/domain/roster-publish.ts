/**
 * Planbord "Publiceer" — commit a week's DRAFT placements to the chefs + klanten.
 *
 * Walks every draft placement whose shift starts in [startUtc, endUtc):
 *   1. RE-VALIDATES at commit time (a concept built days ago can go stale): the
 *      chef must not be blocked that calendar day, and must not now overlap a
 *      LIVE (proposed/accepted/confirmed) placement on another shift.
 *   2. Atomically flips draft → proposed (guarded `WHERE status = 'draft'`, so a
 *      concurrent publish/remove can never double-fire the mails).
 *   3. Fires the EXACT proposal mails via sendProposalNotifications, recomputes
 *      the shift status, and audits the publish.
 *
 * Stale/conflicting drafts are SKIPPED (left as draft) and returned so the
 * planbord can surface "2 concepten conflicteren — fix eerst". neon-http has no
 * interactive tx, so this is sequential + atomic-per-row (CLAUDE.md hard rule).
 */
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";

import { ChefWeekPlanningEmail } from "@/emails/ChefWeekPlanningEmail";
import { KlantWeekPlanningEmail } from "@/emails/KlantWeekPlanningEmail";
import { recordAuditCore } from "@/lib/audit";
import { buildIcs, placementUid } from "@/lib/calendar/ics";
import { db } from "@/lib/db/client";
import { chefAvailability, chefs, clients, placements, shifts } from "@/lib/db/schema";
import { recipientsForClient } from "@/lib/domain/client-recipients";
import { recomputeShiftStatus } from "@/lib/domain/shift-status";
import { transitionPlacement } from "@/lib/domain/placement-transition";
import { sendEmail, formatShiftWhen } from "@/lib/email";
import { env } from "@/lib/env";
import { createNotification, recordEmailMessage } from "@/lib/integrations";
import { formatChefRole } from "@/lib/labels";

export type PublishSkip = {
  placementId: string;
  chefName: string;
  reason: "blocked" | "conflict";
};

export type PublishResult = {
  /** Drafts flipped → proposed (chef + klant notified). */
  published: number;
  /** Drafts left untouched because they went stale — show these to the planner. */
  skipped: PublishSkip[];
  /** Total drafts considered in the period. */
  total: number;
};

export async function publishDraftsForPeriod(args: {
  startUtc: Date;
  endUtc: Date;
  actorUserId: string;
}): Promise<PublishResult> {
  const drafts = await db
    .select({
      placementId: placements.id,
      chefId: placements.chefId,
      chefName: chefs.fullName,
      shiftId: shifts.id,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
    })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(placements.status, "draft"),
        gte(shifts.startsAt, args.startUtc),
        lt(shifts.startsAt, args.endUtc),
      ),
    );

  const skipped: PublishSkip[] = [];
  const publishedIds: string[] = [];
  let published = 0;

  for (const d of drafts) {
    // 1a. Chef explicitly blocked on this calendar day?
    const dayStart = new Date(d.startsAt);
    dayStart.setUTCHours(0, 0, 0, 0);
    const blocked = await db
      .select({ chefId: chefAvailability.chefId })
      .from(chefAvailability)
      .where(
        and(
          eq(chefAvailability.chefId, d.chefId),
          eq(chefAvailability.date, dayStart),
          eq(chefAvailability.available, false),
        ),
      )
      .limit(1);
    if (blocked.length > 0) {
      skipped.push({ placementId: d.placementId, chefName: d.chefName, reason: "blocked" });
      continue;
    }

    // 1b. Would publishing now create a real double-book against a LIVE placement
    //     on another shift? (Other still-draft concepts don't count yet — each is
    //     re-checked when ITS publish runs.)
    const conflict = await db
      .select({ id: placements.id })
      .from(placements)
      .innerJoin(shifts, eq(shifts.id, placements.shiftId))
      .where(
        and(
          eq(placements.chefId, d.chefId),
          ne(placements.shiftId, d.shiftId),
          inArray(placements.status, ["proposed", "accepted", "confirmed"]),
          sql`NOT (${shifts.endsAt} <= ${d.startsAt} OR ${shifts.startsAt} >= ${d.endsAt})`,
        ),
      )
      .limit(1);
    if (conflict.length > 0) {
      skipped.push({ placementId: d.placementId, chefName: d.chefName, reason: "conflict" });
      continue;
    }

    // 2. Atomic flip draft → proposed. The WHERE guard means a concurrent
    //    publish/remove resolves to 0 rows here instead of double-notifying.
    const now = new Date();
    const flipped = await db
      .update(placements)
      .set({ status: "proposed", proposedAt: now, proposedBy: args.actorUserId, updatedAt: now })
      .where(and(eq(placements.id, d.placementId), eq(placements.status, "draft")))
      .returning({ id: placements.id });
    if (flipped.length === 0) continue; // concurrently published or removed

    // 3. Recompute shift status + audit. Notifications go out as ONE weekly
    //    digest per chef + per klant AFTER the loop — not N per-placement mails.
    await recomputeShiftStatus(d.shiftId);
    await recordAuditCore({
      userId: args.actorUserId,
      action: "placements.publish",
      resource: "placements",
      resourceId: d.placementId,
      after: { shiftId: d.shiftId, chefId: d.chefId },
    });
    publishedIds.push(d.placementId);
    published++;
  }

  // ONE weekly digest per chef + per klant (each with a .ics for their calendar) —
  // best-effort; a mail failure must never undo the publish.
  if (publishedIds.length > 0) {
    await sendWeekDigests(publishedIds, args.startUtc).catch((e) =>
      console.error("[publish] week digests failed:", e),
    );
  }

  return { published, skipped, total: drafts.length };
}

/**
 * Remove a single concept from the planbord. Atomic guard (`status = 'draft'`)
 * so it can NEVER delete an already-published (proposed/accepted/confirmed)
 * placement — that path is the change/cancel REQUEST flow, never a silent delete.
 * Returns whether a draft row was actually removed.
 */
export async function removeDraftPlacement(placementId: string): Promise<{ removed: boolean }> {
  const deleted = await db
    .delete(placements)
    .where(and(eq(placements.id, placementId), eq(placements.status, "draft")))
    .returning({ id: placements.id });
  return { removed: deleted.length > 0 };
}

/** Wis alle concepten (drafts) in een periode — voor "opnieuw" na een autofill. */
export async function clearDraftsForPeriod(args: {
  startUtc: Date;
  endUtc: Date;
}): Promise<{ removed: number }> {
  const ids = await db
    .select({ id: placements.id })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(
        eq(placements.status, "draft"),
        gte(shifts.startsAt, args.startUtc),
        lt(shifts.startsAt, args.endUtc),
      ),
    );
  if (ids.length === 0) return { removed: 0 };
  await db.delete(placements).where(
    and(
      inArray(
        placements.id,
        ids.map((r) => r.id),
      ),
      eq(placements.status, "draft"),
    ),
  );
  return { removed: ids.length };
}

/**
 * Batch-confirm — flip every ACCEPTED placement in the period → confirmed (the
 * planner's "bevestig alle geaccepteerde" once chefs have said yes). Reuses the
 * tested transitionPlacement (atomic terminal guard + audit + shift recompute +
 * the chef + klant confirmation mails). Sequential + best-effort; a stale row
 * just no-ops (changed=false).
 */
export type ConfirmResult = { confirmed: number; total: number; blocked: number };

export async function confirmAcceptedForPeriod(args: {
  startUtc: Date;
  endUtc: Date;
  actorUserId: string;
}): Promise<ConfirmResult> {
  const accepted = await db
    .select({ placementId: placements.id })
    .from(placements)
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .where(
      and(
        eq(placements.status, "accepted"),
        gte(shifts.startsAt, args.startUtc),
        lt(shifts.startsAt, args.endUtc),
      ),
    );
  let confirmed = 0;
  let blocked = 0;
  for (const a of accepted) {
    // No override possible in a batch (no human reason) → P3a-2: a compliance-blocked
    // chef returns ok:false reason:'blocked' and is SKIPPED (not auto-confirmed), counted
    // so the planner can see it rather than it vanishing silently.
    const res = await transitionPlacement({
      placementId: a.placementId,
      newStatus: "confirmed",
      actorUserId: args.actorUserId,
      expectedStatus: "accepted", // house rule (matches the 3 sibling confirm callers): a row that
      // changed since the select resolves to changed:false, never a duplicate mail-cascade.
    });
    if (res.ok && res.changed) confirmed++;
    else if (!res.ok && res.reason === "blocked") blocked++;
  }
  return { confirmed, total: accepted.length, blocked };
}

/* ----- weekly publish digests (PR-PLANBORD-2) ------------------------------ */

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function weekLabelOf(startUtc: Date): string {
  return `week van ${startUtc.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Amsterdam",
  })}`;
}

/**
 * After a publish, send ONE digest per chef + ONE per klant for the period — the
 * chef gets their week with venue address, on-site contact person + phone and the
 * chef-visible details; the klant gets the proposed chef + a phone number "voor het
 * geval dat". Each carries a .ics so they drop the week into their calendar. AVG:
 * the chef-facing details come from `chef_visible_notes`, never the internal `notes`.
 * Best-effort — every send is independent and never throws back into publish.
 */
async function sendWeekDigests(placementIds: string[], startUtc: Date): Promise<void> {
  const rows = await db
    .select({
      placementId: placements.id,
      chefId: chefs.id,
      chefName: chefs.fullName,
      chefEmail: chefs.email,
      chefPhone: chefs.phone,
      chefUserId: chefs.userId,
      shiftStart: shifts.startsAt,
      shiftEnd: shifts.endsAt,
      role: shifts.roleNeeded,
      location: shifts.location,
      city: shifts.city,
      details: shifts.chefVisibleNotes,
      clientId: clients.id,
      companyName: clients.companyName,
      contactName: clients.contactName,
      clientPhone: clients.phone,
      clientUserId: clients.userId,
    })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .innerJoin(shifts, eq(shifts.id, placements.shiftId))
    .innerJoin(clients, eq(clients.id, shifts.clientId))
    .where(inArray(placements.id, placementIds));
  if (rows.length === 0) return;

  const weekLabel = weekLabelOf(startUtc);
  const app = env.NEXT_PUBLIC_APP_URL;
  type Row = (typeof rows)[number];
  const byStart = (a: Row, b: Row) => new Date(a.shiftStart).getTime() - new Date(b.shiftStart).getTime();

  // ----- per chef: their week + adres + contactpersoon + details + .ics -----
  for (const [chefId, list] of groupBy(rows, (r) => r.chefId)) {
    const sorted = [...list].sort(byStart);
    const c0 = sorted[0];
    const ics = buildIcs({
      calendarName: `Chef & Serve — ${weekLabel}`,
      events: sorted.map((s) => ({
        uid: placementUid(s.placementId),
        summary: `${formatChefRole(s.role)} bij ${s.companyName ?? "klant"}`,
        description: s.details ?? undefined,
        location: s.location ?? s.city ?? undefined,
        startsAt: new Date(s.shiftStart),
        endsAt: new Date(s.shiftEnd),
        status: "TENTATIVE" as const,
      })),
    });
    if (c0.chefEmail) {
      const send = await sendEmail({
        to: c0.chefEmail,
        subject: `Je planning — ${weekLabel}`,
        react: ChefWeekPlanningEmail({
          chefName: c0.chefName,
          weekLabel,
          shifts: sorted.map((s) => ({
            when: formatShiftWhen(s.shiftStart, s.shiftEnd),
            klant: s.companyName ?? "Klant",
            role: formatChefRole(s.role),
            location: s.location ?? s.city,
            contactName: s.contactName,
            contactPhone: s.clientPhone,
            details: s.details,
          })),
          portalUrl: `${app}/chef`,
        }),
        attachments: [{ filename: "planning-week.ics", content: Buffer.from(ics, "utf-8"), contentType: "text/calendar" }],
      });
      if (send.ok) {
        await recordEmailMessage({
          providerMessageId: send.id,
          toEmail: c0.chefEmail,
          template: "ChefWeekPlanningEmail",
          eventKey: "week_planning",
          entityType: "chefs",
          entityId: chefId,
          userId: c0.chefUserId ?? undefined,
        });
      }
    }
    if (c0.chefUserId) {
      await createNotification({
        userId: c0.chefUserId,
        type: "week_published",
        title: `Je planning · ${weekLabel}`,
        body: `${sorted.length} ${sorted.length === 1 ? "dienst" : "diensten"} ingepland — bevestig in het portaal.`,
        actionUrl: "/chef",
        entityType: "chefs",
        entityId: chefId,
      });
    }
  }

  // ----- per klant: their week + de chef + telefoonnummer + .ics -----
  for (const [clientId, list] of groupBy(rows, (r) => r.clientId)) {
    const sorted = [...list].sort(byStart);
    const c0 = sorted[0];
    const to = await recipientsForClient(clientId, "chef_proposed");
    const ics = buildIcs({
      calendarName: `Chef & Serve — ${c0.companyName ?? "planning"}`,
      events: sorted.map((s) => ({
        uid: placementUid(s.placementId),
        summary: `${formatChefRole(s.role)}: ${s.chefName}`,
        location: s.location ?? s.city ?? undefined,
        startsAt: new Date(s.shiftStart),
        endsAt: new Date(s.shiftEnd),
        status: "TENTATIVE" as const,
      })),
    });
    if (to.length > 0) {
      const send = await sendEmail({
        to,
        subject: `Jullie planning — ${weekLabel}`,
        react: KlantWeekPlanningEmail({
          contactName: c0.contactName,
          companyName: c0.companyName ?? "Klant",
          weekLabel,
          shifts: sorted.map((s) => ({
            when: formatShiftWhen(s.shiftStart, s.shiftEnd),
            role: formatChefRole(s.role),
            chefName: s.chefName,
            chefPhone: s.chefPhone,
          })),
          hubUrl: `${app}/client`,
        }),
        attachments: [{ filename: "planning-week.ics", content: Buffer.from(ics, "utf-8"), contentType: "text/calendar" }],
      });
      if (send.ok) {
        for (const addr of to) {
          await recordEmailMessage({
            providerMessageId: send.id,
            toEmail: addr,
            template: "KlantWeekPlanningEmail",
            eventKey: "week_planning",
            entityType: "clients",
            entityId: clientId,
          });
        }
      }
    }
    if (c0.clientUserId) {
      await createNotification({
        userId: c0.clientUserId,
        type: "week_published",
        title: `Jullie planning · ${weekLabel}`,
        body: `${sorted.length} ${sorted.length === 1 ? "dienst" : "diensten"} ingepland voor ${c0.companyName ?? "jullie"}.`,
        actionUrl: "/client",
        entityType: "clients",
        entityId: clientId,
      });
    }
  }
}
