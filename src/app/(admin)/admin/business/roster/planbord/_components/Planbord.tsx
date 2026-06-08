"use client";

/**
 * The planbord — a drag-drop "maak het rooster" board. 7 day-columns of shift
 * cards; a chef-pool rail on the right. Drag a chef onto a shift with open slots
 * → a CONCEPT (draft) via draftChefAction (no chef/klant contact). Focus a shift
 * (the search button) → the rail re-ranks to that shift's best matches with the
 * "why" + warnings. "Publiceer" commits the whole week's concepts at once.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Icon } from "@/components/admin/icons";
import {
  autofillWeekAction,
  clearDraftsAction,
  confirmWeekAction,
  copyLastWeekAction,
  draftChefAction,
  matchesForShiftAction,
  publishWeekAction,
  removeDraftAction,
} from "../actions";

export type PlanbordSlot = { placementId: string; chefId: string; chefName: string; status: string; matchScore: number | null };
export type PlanbordShift = {
  id: string;
  companyName: string;
  role: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  status: string;
  city: string | null;
  rejectedCount: number;
  slots: PlanbordSlot[];
};
export type PlanbordChef = {
  id: string;
  fullName: string;
  niveau: string | null;
  skills: string[];
  city: string | null;
};
type MarginTone = "ok" | "low" | "negative";
type ShiftMatch = {
  chefId: string;
  fullName: string;
  score: number;
  reason: string | null;
  warning: string | null;
  travelKm: number | null;
  marginCents: number | null;
  marginTone: MarginTone | null;
};
type RailChef = PlanbordChef & {
  score?: number;
  reason?: string | null;
  warning?: string | null;
  travelKm?: number | null;
  marginCents?: number | null;
  marginTone?: MarginTone | null;
};

const MARGIN_TONE: Record<MarginTone, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  low: "bg-amber-50 text-amber-700",
  negative: "bg-red-50 text-red-700",
};

const SLOT_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Concept", cls: "border border-dashed border-amber-400 bg-amber-50 text-amber-800" },
  proposed: { label: "Voorgesteld", cls: "bg-blue-100 text-blue-700" },
  accepted: { label: "Geaccepteerd", cls: "bg-indigo-100 text-indigo-700" },
  confirmed: { label: "Bevestigd", cls: "bg-emerald-100 text-emerald-700" },
};

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
function fmtDay(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("nl-NL", { timeZone: "UTC", ...opts });
}

export function Planbord({
  weekDays,
  weekStartKey,
  todayKey,
  prevWeek,
  nextWeek,
  byDay,
  chefPool,
  blockedByChef,
  draftCount,
  proposedCount,
  acceptedCount,
  confirmedCount,
}: {
  weekDays: string[];
  weekStartKey: string;
  todayKey: string;
  prevWeek: string;
  nextWeek: string;
  byDay: Record<string, PlanbordShift[]>;
  chefPool: PlanbordChef[];
  blockedByChef: Record<string, string[]>;
  draftCount: number;
  proposedCount: number;
  acceptedCount: number;
  confirmedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeChef, setActiveChef] = useState<PlanbordChef | null>(null);
  const [focusShift, setFocusShift] = useState<PlanbordShift | null>(null);
  const [matches, setMatches] = useState<ShiftMatch[] | null>(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lens, setLens] = useState<"day" | "chef">("day");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const chefById = useMemo(() => new Map(chefPool.map((c) => [c.id, c])), [chefPool]);

  function focusOnShift(shift: PlanbordShift) {
    setFocusShift(shift);
    setMatches(null);
    setLoadingMatches(true);
    startTransition(async () => {
      const m = await matchesForShiftAction(shift.id);
      setMatches(m);
      setLoadingMatches(false);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const chef = activeChef;
    setActiveChef(null);
    if (!e.over) return;
    const chefId = String(e.active.id);
    const shiftId = String(e.over.id);
    const match = matches?.find((m) => m.chefId === chefId);
    if (match?.warning && !window.confirm(`${match.fullName}: ${match.warning}.\n\nToch als concept plaatsen?`)) return;
    startTransition(async () => {
      const res = await draftChefAction({ shiftId, chefId, ...(match ? { matchScore: match.score } : {}) });
      if (res.status === "already_active") setMsg(`${chef?.fullName ?? "Chef"} staat al live op deze dienst.`);
      router.refresh();
    });
  }

  function removeDraft(placementId: string) {
    startTransition(async () => {
      await removeDraftAction(placementId);
      router.refresh();
    });
  }

  function publish() {
    if (
      !window.confirm(
        "Publiceer het concept-rooster voor deze week?\n\nAlle concepten worden naar de chefs en klanten gestuurd.",
      )
    )
      return;
    startTransition(async () => {
      const res = await publishWeekAction(weekStartKey);
      const skip =
        res.skipped.length > 0
          ? ` ${res.skipped.length} overgeslagen (${res.skipped
              .map((s) => `${s.chefName}: ${s.reason === "blocked" ? "geblokkeerd" : "dubbel"}`)
              .join("; ")}).`
          : "";
      setMsg(
        res.total === 0
          ? "Geen concepten om te publiceren."
          : `${res.published} van ${res.total} gepubliceerd — chefs en klanten zijn bericht.${skip}`,
      );
      router.refresh();
    });
  }

  function confirmWeek() {
    if (
      !window.confirm(
        `${acceptedCount} geaccepteerde plaatsing${acceptedCount === 1 ? "" : "en"} bevestigen?\n\nChef én klant krijgen de bevestigingsmail.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await confirmWeekAction(weekStartKey);
      setMsg(
        res.confirmed === 0
          ? "Geen geaccepteerde plaatsingen om te bevestigen."
          : `${res.confirmed} plaatsing${res.confirmed === 1 ? "" : "en"} bevestigd — chefs en klanten zijn bericht.`,
      );
      router.refresh();
    });
  }

  function autofill() {
    if (
      !window.confirm(
        "Vul de week automatisch met concepten?\n\nDe beste beschikbare chef komt op elke open plek — je kunt daarna nog slepen en aanpassen voordat je publiceert.",
      )
    )
      return;
    startTransition(async () => {
      const res = await autofillWeekAction(weekStartKey);
      setMsg(
        res.filled === 0
          ? "Geen open plekken gevuld (alles vol, of geen passende chefs beschikbaar)."
          : `${res.filled} concept${res.filled === 1 ? "" : "en"} toegevoegd op ${res.shiftsTouched} dienst${res.shiftsTouched === 1 ? "" : "en"} — controleer en publiceer.`,
      );
      router.refresh();
    });
  }

  function copyPrevWeek() {
    if (
      !window.confirm(
        "Kopieer vorige week?\n\nDe chefs van vorige week komen als concept op dezelfde dagen en diensten (zelfde klant, weekdag, rol). Je kunt daarna nog slepen en aanpassen voordat je publiceert.",
      )
    )
      return;
    startTransition(async () => {
      const res = await copyLastWeekAction(weekStartKey);
      setMsg(
        res.filled === 0
          ? "Niets te kopiëren — geen open plekken, of vorige week was er niets ingepland."
          : `${res.filled} concept${res.filled === 1 ? "" : "en"} gekopieerd van vorige week op ${res.matchedShifts} dienst${res.matchedShifts === 1 ? "" : "en"} — controleer en publiceer.`,
      );
      router.refresh();
    });
  }

  function clearDrafts() {
    if (!window.confirm(`Alle ${draftCount} concept${draftCount === 1 ? "" : "en"} van deze week verwijderen?`)) return;
    startTransition(async () => {
      const res = await clearDraftsAction(weekStartKey);
      setMsg(
        res.removed > 0
          ? `${res.removed} concept${res.removed === 1 ? "" : "en"} verwijderd.`
          : "Geen concepten om te verwijderen.",
      );
      router.refresh();
    });
  }

  const railChefs: RailChef[] =
    focusShift && matches
      ? matches.map((m) => {
          const c = chefById.get(m.chefId);
          return {
            id: m.chefId,
            fullName: m.fullName,
            niveau: c?.niveau ?? null,
            skills: c?.skills ?? [],
            city: c?.city ?? null,
            score: m.score,
            reason: m.reason,
            warning: m.warning,
            travelKm: m.travelKm,
            marginCents: m.marginCents,
            marginTone: m.marginTone,
          };
        })
      : chefPool;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setActiveChef(chefById.get(String(e.active.id)) ?? null)}
      onDragEnd={onDragEnd}
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-ui text-[11px] uppercase tracking-[0.2em] text-burgundy">Planbord</p>
            <h1 className="mt-1 font-serif text-3xl text-ink-900">Maak het rooster</h1>
            <p className="mt-0.5 font-serif text-base text-ink-700">
              {fmtDay(weekStartKey, { day: "numeric", month: "short" })} –{" "}
              {fmtDay(weekDays[6], { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/business/roster"
              className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy"
            >
              Overzicht
            </Link>
            <span className="mx-0.5 hidden text-ink-200 sm:inline">|</span>
            <div className="flex overflow-hidden rounded-full border border-ink-200 bg-white">
              {(["day", "chef"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLens(l)}
                  className={`px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${lens === l ? "bg-burgundy text-white" : "text-ink-600 hover:bg-bg-gray"}`}
                >
                  {l === "day" ? "Per dag" : "Per chef"}
                </button>
              ))}
            </div>
            <Link href={`/admin/business/roster/planbord?week=${prevWeek}`} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy">←</Link>
            <Link href="/admin/business/roster/planbord" className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy">Deze week</Link>
            <Link href={`/admin/business/roster/planbord?week=${nextWeek}`} className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy">→</Link>
            {draftCount > 0 && (
              <button
                onClick={clearDrafts}
                disabled={pending}
                className="font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-500 underline hover:text-burgundy disabled:opacity-40"
              >
                Wis concepten
              </button>
            )}
            <button
              onClick={copyPrevWeek}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy hover:text-burgundy disabled:opacity-40"
            >
              <Icon name="copy" className="h-3.5 w-3.5" />
              Kopieer vorige week
            </button>
            <button
              onClick={autofill}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-burgundy/30 bg-white px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5 disabled:opacity-40"
            >
              <Icon name="refresh-cw" className="h-3.5 w-3.5" />
              Vul de week
            </button>
            <button
              onClick={publish}
              disabled={pending || draftCount === 0}
              className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-burgundy px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90 disabled:opacity-40"
            >
              <Icon name="upload" className="h-3.5 w-3.5" />
              Publiceer{draftCount > 0 ? ` (${draftCount})` : ""}
            </button>
            {acceptedCount > 0 && (
              <button
                onClick={confirmWeek}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Icon name="check-circle" className="h-3.5 w-3.5" />
                Bevestig {acceptedCount}
              </button>
            )}
          </div>
        </div>

        {msg && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-burgundy/20 bg-burgundy/[0.03] px-4 py-2.5 text-sm text-ink-800">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-burgundy" />
            <span>{msg}</span>
            <button onClick={() => setMsg(null)} className="ml-auto shrink-0 text-ink-400 hover:text-ink-700">
              ✕
            </button>
          </div>
        )}

        {proposedCount + acceptedCount + confirmedCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-ui text-[11px] text-ink-500">
            <span>
              <span className="font-medium text-blue-700">{proposedCount}</span> voorgesteld
            </span>
            <span>
              <span className="font-medium text-indigo-700">{acceptedCount}</span> geaccepteerd
            </span>
            <span>
              <span className="font-medium text-emerald-700">{confirmedCount}</span> bevestigd
            </span>
          </div>
        )}

        {lens === "chef" && (
          <div className="mt-6">
            <ChefWeekGrid weekDays={weekDays} todayKey={todayKey} chefPool={chefPool} byDay={byDay} blockedByChef={blockedByChef} />
          </div>
        )}
        {lens === "day" && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
            {weekDays.map((d) => {
              const dayShifts = byDay[d] ?? [];
              return (
                <div
                  key={d}
                  className={`rounded-lg border ${d === todayKey ? "border-burgundy/40" : "border-ink-200"} bg-bg-gray/30 p-2`}
                >
                  <p
                    className={`mb-2 text-center font-ui text-[10px] uppercase tracking-wider ${d === todayKey ? "text-burgundy" : "text-ink-500"}`}
                  >
                    {fmtDay(d, { weekday: "short", day: "numeric" })}
                  </p>
                  <div className="space-y-2">
                    {dayShifts.length === 0 ? (
                      <p className="py-4 text-center text-[11px] text-ink-300">—</p>
                    ) : (
                      dayShifts.map((s) => (
                        <ShiftCard
                          key={s.id}
                          shift={s}
                          focused={focusShift?.id === s.id}
                          onFocus={() => focusOnShift(s)}
                          onRemoveDraft={removeDraft}
                          disabled={pending}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-lg border border-ink-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-ui text-[11px] uppercase tracking-[0.16em] text-burgundy">
                  {focusShift ? "Beste matches" : "Chefs"}
                </h2>
                {focusShift && (
                  <button
                    onClick={() => {
                      setFocusShift(null);
                      setMatches(null);
                    }}
                    className="font-ui text-[10px] text-ink-500 underline hover:text-burgundy"
                  >
                    alle
                  </button>
                )}
              </div>
              {focusShift && (
                <p className="mb-2 text-[11px] text-ink-500">
                  {focusShift.companyName} · {focusShift.role} · {hhmm(focusShift.startsAt)}
                </p>
              )}
              {loadingMatches ? (
                <p className="py-6 text-center text-[11px] text-ink-400">Laden…</p>
              ) : (
                <div className="max-h-[70vh] space-y-1.5 overflow-y-auto">
                  {railChefs.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-ink-400">Geen passende chefs.</p>
                  ) : (
                    railChefs.map((c) => <ChefCard key={c.id} chef={c} />)
                  )}
                </div>
              )}
              <p className="mt-2 border-t border-ink-100 pt-2 text-[10px] leading-snug text-ink-400">
                Sleep een chef op een dienst → concept. Niemand krijgt bericht tot je publiceert.
              </p>
            </div>
          </aside>
        </div>
        )}
      </div>

      <DragOverlay>
        {activeChef ? (
          <div className="rounded-lg border border-burgundy bg-white px-2.5 py-1.5 shadow-lg">
            <span className="font-ui text-[12px] font-medium text-ink-900">{activeChef.fullName}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ChefWeekGrid({
  weekDays,
  todayKey,
  chefPool,
  byDay,
  blockedByChef,
}: {
  weekDays: string[];
  todayKey: string;
  chefPool: PlanbordChef[];
  byDay: Record<string, PlanbordShift[]>;
  blockedByChef: Record<string, string[]>;
}) {
  const isBlocked = (chefId: string, day: string) => (blockedByChef[chefId] ?? []).includes(day);
  // chefId → dayKey → what they're doing that day
  const pivot = new Map<string, Map<string, Array<{ shift: PlanbordShift; status: string }>>>();
  for (const day of weekDays) {
    for (const shift of byDay[day] ?? []) {
      for (const slot of shift.slots) {
        const days = pivot.get(slot.chefId) ?? new Map<string, Array<{ shift: PlanbordShift; status: string }>>();
        const arr = days.get(day) ?? [];
        arr.push({ shift, status: slot.status });
        days.set(day, arr);
        pivot.set(slot.chefId, days);
      }
    }
  }
  const loadOf = (chefId: string) => {
    let n = 0;
    const days = pivot.get(chefId);
    if (days) for (const arr of days.values()) n += arr.length;
    return n;
  };
  const freeDaysOf = (chefId: string) =>
    weekDays.filter((d) => (pivot.get(chefId)?.get(d)?.length ?? 0) === 0 && !isBlocked(chefId, d)).length;
  const rows = [...chefPool].sort(
    (a, b) => loadOf(b.id) - loadOf(a.id) || a.fullName.localeCompare(b.fullName),
  );
  const available = rows.filter((c) => freeDaysOf(c.id) > 0).length;

  return (
    <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
      {available > 0 && (
        <p className="border-b border-ink-100 px-3 py-2 font-ui text-[11px] text-ink-500">
          {available} {available === 1 ? "chef heeft" : "chefs hebben"} nog vrije dagen deze week.
        </p>
      )}
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-ink-200">
            <th className="px-3 py-2 text-left font-ui text-[10px] uppercase tracking-[0.14em] text-ink-500">Chef</th>
            {weekDays.map((d) => (
              <th
                key={d}
                className={`px-2 py-2 text-center font-ui text-[10px] uppercase tracking-wider ${d === todayKey ? "text-burgundy" : "text-ink-500"}`}
              >
                {fmtDay(d, { weekday: "short", day: "numeric" })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((chef) => {
            const load = loadOf(chef.id);
            return (
              <tr key={chef.id} className={`border-b border-ink-100 last:border-0 ${load === 0 ? "bg-bg-gray/30" : ""}`}>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate font-ui text-[12px] ${load === 0 ? "text-ink-400" : "text-ink-900"}`}>{chef.fullName}</span>
                    {load > 0 ? (
                      <span className="shrink-0 rounded-full bg-burgundy/10 px-1.5 py-0.5 font-ui text-[9px] font-medium text-burgundy">{load}</span>
                    ) : freeDaysOf(chef.id) > 0 ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 font-ui text-[9px] font-medium text-emerald-700">vrij</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-bg-gray px-1.5 py-0.5 font-ui text-[9px] font-medium text-ink-400">geen ruimte</span>
                    )}
                  </span>
                  {chef.niveau && <span className="block truncate text-[10px] text-ink-400">{chef.niveau}</span>}
                </td>
                {weekDays.map((d) => {
                  const entries = pivot.get(chef.id)?.get(d) ?? [];
                  return (
                    <td key={d} className="px-2 py-1.5 align-top">
                      {entries.length === 0 ? (
                        isBlocked(chef.id, d) ? (
                          <span className="block rounded bg-bg-gray px-1.5 py-0.5 text-center text-[9px] uppercase tracking-wide text-ink-400">
                            niet beschikbaar
                          </span>
                        ) : (
                          <span className="block text-center text-[11px] text-ink-200">·</span>
                        )
                      ) : (
                        <div className="space-y-1">
                          {entries.map((e, i) => {
                            const meta = SLOT_META[e.status] ?? { cls: "bg-bg-gray text-ink-600" };
                            return (
                              <div
                                key={i}
                                className={`rounded px-1.5 py-0.5 text-[10px] leading-tight ${meta.cls}`}
                                title={`${e.shift.companyName} · ${e.shift.role}`}
                              >
                                <span className="block font-ui font-medium">{hhmm(e.shift.startsAt)}</span>
                                <span className="block truncate">{e.shift.companyName}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChefCard({ chef }: { chef: RailChef }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: chef.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      className="cursor-grab touch-none rounded-md border border-ink-200 bg-white p-2 hover:border-burgundy/40 active:cursor-grabbing"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-ui text-[12px] font-medium text-ink-900">{chef.fullName}</span>
        <span className="flex shrink-0 items-center gap-1">
          {chef.marginCents != null && chef.marginTone && (
            <span
              title="Geschatte marge bij deze chef (omzet − loon − reis)"
              className={`rounded-full px-1.5 py-0.5 font-ui text-[9px] font-medium ${MARGIN_TONE[chef.marginTone]}`}
            >
              €{Math.round(chef.marginCents / 100)}
            </span>
          )}
          {typeof chef.score === "number" && (
            <span className="rounded-full bg-burgundy/10 px-1.5 py-0.5 font-ui text-[9px] font-medium text-burgundy">
              {chef.score}
            </span>
          )}
        </span>
      </div>
      <p className="truncate text-[10px] text-ink-500">
        {[chef.niveau, chef.city, chef.travelKm != null ? `${chef.travelKm} km` : null]
          .filter(Boolean)
          .join(" · ") || "—"}
      </p>
      {chef.reason && <p className="truncate text-[10px] text-emerald-700">✓ {chef.reason}</p>}
      {chef.warning && <p className="truncate text-[10px] text-amber-700">⚠ {chef.warning}</p>}
    </div>
  );
}

function ShiftCard({
  shift,
  focused,
  onFocus,
  onRemoveDraft,
  disabled,
}: {
  shift: PlanbordShift;
  focused: boolean;
  onFocus: () => void;
  onRemoveDraft: (placementId: string) => void;
  disabled: boolean;
}) {
  const open = Math.max(0, shift.headcount - shift.slots.length);
  const { setNodeRef, isOver } = useDroppable({ id: shift.id, disabled: open <= 0 });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md border bg-white p-2 transition-colors ${
        focused ? "border-burgundy" : isOver ? "border-burgundy bg-burgundy/[0.04]" : "border-ink-200"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate font-ui text-[11px] font-medium text-ink-900">{shift.companyName}</p>
          <p className="truncate text-[10px] text-ink-500">
            {shift.role} · {hhmm(shift.startsAt)}
          </p>
        </div>
        <button
          onClick={onFocus}
          disabled={disabled}
          title="Zoek chef"
          className="shrink-0 rounded-full p-1 text-ink-400 hover:bg-bg-gray hover:text-burgundy disabled:opacity-40"
        >
          <Icon name="search" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 space-y-1">
        {shift.slots.map((sl) => {
          const meta = SLOT_META[sl.status] ?? { label: sl.status, cls: "bg-bg-gray text-ink-600" };
          return (
            <div
              key={sl.placementId}
              className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 ${meta.cls}`}
            >
              <span className="truncate font-ui text-[10px] font-medium">
                {sl.chefName}
                {sl.status === "draft" && sl.matchScore != null ? ` · ${sl.matchScore}` : ""}
              </span>
              {sl.status === "draft" ? (
                <button
                  onClick={() => onRemoveDraft(sl.placementId)}
                  disabled={disabled}
                  title="Concept verwijderen"
                  className="shrink-0 opacity-60 hover:opacity-100 disabled:opacity-30"
                >
                  ✕
                </button>
              ) : (
                <span className="shrink-0 text-[8px] uppercase tracking-wide opacity-70">{meta.label}</span>
              )}
            </div>
          );
        })}
        {Array.from({ length: open }).map((_, i) => (
          <div
            key={i}
            className={`rounded border border-dashed px-1.5 py-1 text-center text-[10px] ${
              isOver ? "border-burgundy text-burgundy" : "border-ink-300 text-ink-400"
            }`}
          >
            + sleep chef
          </div>
        ))}
        {shift.rejectedCount > 0 ? (
          <p
            className="rounded bg-amber-50 px-1.5 py-0.5 text-center text-[9px] font-medium text-amber-700"
            title="Een eerder voorgestelde chef heeft afgewezen — sleep een nieuwe chef op de open plek."
          >
            ↩ {shift.rejectedCount} afgewezen
          </p>
        ) : null}
      </div>
    </div>
  );
}
