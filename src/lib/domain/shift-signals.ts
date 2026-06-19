/**
 * CHEF-PR3 — in-shift status signals (domain).
 *
 * One-tap statuses a chef sends from the shift screen before/while working:
 *   onderweg · vertraagd · hulp nodig · "ik voel me niet veilig" · kan niet starten.
 * Each records a row (the owner's timeline/dispute record) AND notifies the owner.
 * The safety signal ("onveilig") is URGENT — always pushed, never throttled.
 *
 * Dark behind SHIFT_SIGNALS_ENABLED. Ownership IS the lookup: only the chef placed
 * (accepted/confirmed) on the shift can signal. Owner-only notifications in v1
 * (klant comms need the structured-message guardrails — a separate feature). The
 * chef's free `detail` is DATA, not instructions (trimmed + capped).
 */
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { chefs, clients, placements, shiftSignals, shifts, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createNotification, notifyUser } from "@/lib/integrations";
import { amsterdamDayKey } from "@/lib/roster-format";

export type ShiftSignalKind =
  | "onderweg"
  | "vertraagd"
  | "hulp"
  | "onveilig"
  | "kan_niet_starten"
  | "langer_doorwerken"
  | "geen_pauze";

export function shiftSignalsEnabled(): boolean {
  return env.SHIFT_SIGNALS_ENABLED === "true";
}

/** UI vocabulary: each kind + its label + optional structured sub-options (bucket key → label). */
export const SHIFT_SIGNAL_UI: {
  kind: ShiftSignalKind;
  label: string;
  urgent: boolean;
  options?: { key: string; label: string }[];
}[] = [
  { kind: "onderweg", label: "Ik ben onderweg", urgent: false },
  {
    kind: "vertraagd",
    label: "Ik ben vertraagd",
    urgent: false,
    options: [
      { key: "min_15", label: "± 15 min later" },
      { key: "min_30", label: "± 30 min later" },
      { key: "onbekend", label: "Weet nog niet" },
    ],
  },
  {
    kind: "kan_niet_starten",
    label: "Ik ben er, maar kan niet starten",
    urgent: true,
    options: [
      { key: "contact_afwezig", label: "Contactpersoon afwezig" },
      { key: "ingang_dicht", label: "Ingang dicht / kom er niet in" },
      { key: "keuken_niet_klaar", label: "Keuken niet klaar" },
      { key: "verkeerde_locatie", label: "Verkeerde locatie" },
      { key: "anders", label: "Anders" },
    ],
  },
  {
    kind: "hulp",
    label: "Hulp nodig",
    urgent: true,
    options: [
      { key: "contact", label: "Krijg contactpersoon niet te pakken" },
      { key: "taak", label: "Vraag over de opdracht" },
      { key: "anders", label: "Anders" },
    ],
  },
  { kind: "onveilig", label: "Ik voel me niet veilig / niet correct behandeld", urgent: true },
  {
    kind: "langer_doorwerken",
    label: "Ik werk langer door",
    urgent: false,
    options: [
      { key: "min_30", label: "± 30 min langer" },
      { key: "uur_1", label: "± 1 uur langer" },
      { key: "klant_vraagt", label: "Klant vraagt extra" },
      { key: "onbekend", label: "Weet nog niet hoelang" },
    ],
  },
  { kind: "geen_pauze", label: "Geen pauze mogelijk", urgent: false },
];

const VALID_KINDS = new Set(SHIFT_SIGNAL_UI.map((o) => o.kind));
const THROTTLE_HOURS = 4;

async function ownerUserId(): Promise<string | null> {
  if (!env.MAARTEN_EMAIL) return null;
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, env.MAARTEN_EMAIL))
    .limit(1);
  return owner?.id ?? null;
}

const NOTIF_TYPE = "shift_signal";

/** Was this exact signal kind already sent for this placement recently? (anti-spam,
 *  per-kind so different statuses each still notify). Checked against the signals
 *  table itself — call BEFORE inserting the new row. */
async function sameKindRecently(placementId: string, kind: ShiftSignalKind): Promise<boolean> {
  const since = new Date(Date.now() - THROTTLE_HOURS * 60 * 60 * 1000);
  const [row] = await db
    .select({ id: shiftSignals.id })
    .from(shiftSignals)
    .where(
      and(
        eq(shiftSignals.placementId, placementId),
        eq(shiftSignals.kind, kind),
        gt(shiftSignals.createdAt, since),
      ),
    )
    .limit(1);
  return !!row;
}

export async function recordShiftSignal(args: {
  chefId: string;
  placementId: string;
  kind: ShiftSignalKind;
  detail?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!shiftSignalsEnabled()) return { ok: false, reason: "disabled" };
  if (!VALID_KINDS.has(args.kind)) return { ok: false, reason: "bad-kind" };

  // Ownership: a live placement on this shift, owned by the chef.
  const placement = await db.query.placements.findFirst({
    where: and(eq(placements.id, args.placementId), eq(placements.chefId, args.chefId)),
  });
  if (!placement || !["accepted", "confirmed"].includes(placement.status)) {
    return { ok: false, reason: "not-owned" };
  }

  const detail = (args.detail ?? "").trim().slice(0, 500) || null;

  // Safety always pings; the rest throttle to one owner-ping per kind per window
  // (the row is still recorded for the timeline either way).
  const notify =
    args.kind === "onveilig" || !(await sameKindRecently(args.placementId, args.kind));

  await db.insert(shiftSignals).values({
    placementId: args.placementId,
    chefId: args.chefId,
    shiftId: placement.shiftId,
    kind: args.kind,
    detail,
  });

  if (notify) {
    await notifyOwner(placement.shiftId, args.chefId, args.placementId, args.kind, detail).catch(
      (e) => console.error("[shift-signals] owner notify failed:", e),
    );
  }
  return { ok: true };
}

async function notifyOwner(
  shiftId: string,
  chefId: string,
  placementId: string,
  kind: ShiftSignalKind,
  detail: string | null,
): Promise<void> {
  const owner = await ownerUserId();
  if (!owner) return;

  const ui = SHIFT_SIGNAL_UI.find((o) => o.kind === kind);
  const urgent = ui?.urgent ?? false;

  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });
  const client = shift ? await db.query.clients.findFirst({ where: eq(clients.id, shift.clientId) }) : null;
  const who = chef?.fullName ?? "Een chef";
  const where = client?.companyName ?? "een klant";
  const when = shift ? amsterdamDayKey(shift.startsAt) : "";
  const detailLabel = detail
    ? ui?.options?.find((o) => o.key === detail)?.label ?? detail
    : null;

  const title =
    kind === "onveilig"
      ? `⚠️ ${who} voelt zich niet veilig — ${where}`
      : kind === "kan_niet_starten"
        ? `${who} kan niet starten bij ${where}`
        : kind === "hulp"
          ? `${who} vraagt hulp — ${where}`
          : kind === "vertraagd"
            ? `${who} is vertraagd — ${where}`
            : kind === "langer_doorwerken"
              ? `${who} werkt langer door — ${where}`
              : kind === "geen_pauze"
                ? `${who} had geen pauze — ${where}`
                : `${who} is onderweg — ${where}`;
  const body = `${when}${detailLabel ? ` · ${detailLabel}` : ""}`;

  const payload = {
    userId: owner,
    type: NOTIF_TYPE,
    title,
    body,
    actionUrl: `/admin/business/shifts/${shiftId}`,
    entityType: "placements",
    entityId: placementId,
  } as const;

  if (urgent) {
    await notifyUser({ ...payload, push: true });
  } else {
    await createNotification(payload);
  }
}

/** Recent signals for a placement (chef-facing confirmation + owner timeline). */
export function listShiftSignals(placementId: string) {
  return db
    .select({ kind: shiftSignals.kind, detail: shiftSignals.detail, createdAt: shiftSignals.createdAt })
    .from(shiftSignals)
    .where(eq(shiftSignals.placementId, placementId))
    .orderBy(shiftSignals.createdAt);
}

/** Narrow a raw string to a valid kind (for server-action input). */
export function asShiftSignalKind(raw: string): ShiftSignalKind | null {
  return VALID_KINDS.has(raw as ShiftSignalKind) ? (raw as ShiftSignalKind) : null;
}
