/**
 * /chef/availability — heartbeat-simple availability + preferred-work (CHEF-PR1).
 *
 * Three layers, calm front:
 *   1. Quick blocks — one tap to mark vandaag / morgen / dit weekend / deze week
 *      NOT available, plus "herhaal vorige week" (copy last week's blocks forward).
 *   2. Calendar — fine-grained block/unblock (the existing AvailabilityCalendar).
 *   3. Voorkeuren — travel radius, spoed-bereikbaar, vroegste starttijd, wat je
 *      wél/niet wil, payroll/zzp, vrije notitie. Feeds matching (enforcement later).
 *
 * Model unchanged: chef_availability "no row = available"; blocks write
 * available=false rows. Preferences write the CHEF-PR1 chefs columns.
 *
 * Security: server actions resolve the chef via session.user.id → chefs.userId.
 * The user can NEVER write to a different chefId — the lookup IS the auth.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { chefAvailability, chefs } from "@/lib/db/schema";
import { recordAuditFromRequest } from "@/lib/audit";
import { recordChefEvent } from "@/lib/chef-events";
import { sanitizeSkillTags, skillTagsByCategory } from "@/lib/domain/skill-tags";
import { getI18n } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/locales";
import { requireAuth } from "@/lib/permissions";

import { AvailabilityCalendar } from "./_components/AvailabilityCalendar";

export const metadata = { title: "Beschikbaarheid" };
export const dynamic = "force-dynamic";

const WEEKS_AHEAD = 8;

/** What you LIKE — keys align with matching's PREFERENCE_SIGNALS so they score. Labels via dict. */
const LIKE_KEYS = [
  "breakfast",
  "hotels",
  "restaurants",
  "banqueting",
  "beachclub",
  "early_shifts",
  "michelin",
  "bbq",
] as const;
/** What you'd rather NOT do (matching enforcement lands in a later PR). */
const AVOID_KEYS = ["zorg", "ontbijt", "late_night", "banqueting", "events"] as const;
/** Earliest-start option values; "" = no preference, else the hour (label via dict). */
const START_HOURS = ["", "6", "7", "8", "9", "10", "12"] as const;

/** Resolve the chef record bound to the current session. Throws on mismatch. */
async function requireChefSelf(): Promise<{ chefId: string }> {
  const session = await requireAuth("/chef/availability");
  const [chef] = await db
    .select({ id: chefs.id })
    .from(chefs)
    .where(eq(chefs.userId, session.user.id))
    .limit(1);
  if (!chef) {
    // User is kind=chef in session but no chef record — admin needs to link
    // them. Send them home.
    redirect("/chef");
  }
  return { chefId: chef.id };
}

function parseIsoDate(iso: string): Date {
  // Build a UTC midnight Date — chef_availability column is `date` mode.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date;
}

/** UTC-midnight Date for "today" in Amsterdam (matches the calendar's day keys). */
function amsTodayUtcMidnight(): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // en-CA → "YYYY-MM-DD"
  return parseIsoDate(key);
}

function isoOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function toggleDate(isoDate: string, blocked: boolean): Promise<void> {
  "use server";
  const { chefId } = await requireChefSelf();
  const date = parseIsoDate(isoDate);
  // Guard: past dates are read-only.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (date < today) return;

  if (blocked) {
    await db
      .insert(chefAvailability)
      .values({ chefId, date, available: false })
      .onConflictDoUpdate({
        target: [chefAvailability.chefId, chefAvailability.date],
        set: { available: false },
      });
  } else {
    // Unblock = delete the row (no row = available, our default).
    await db
      .delete(chefAvailability)
      .where(
        and(eq(chefAvailability.chefId, chefId), eq(chefAvailability.date, date)),
      );
  }

  await recordAuditFromRequest({
    action: "chef.availability_updated",
    resource: "chef_availability",
    resourceId: chefId,
    after: { date: isoDate, blocked },
  });
  await recordChefEvent({
    chefId,
    eventType: "availability_updated",
    entityType: "chef_availability",
    entityId: chefId,
    payload: { mode: "day", date: isoDate, blocked },
  });
}

async function setRange(
  startIso: string,
  endIso: string,
  blocked: boolean,
): Promise<void> {
  "use server";
  const { chefId } = await requireChefSelf();
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (end < start) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const effectiveStart = start < today ? today : start;
  if (effectiveStart > end) return;

  const dates: Date[] = [];
  const cursor = new Date(effectiveStart);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (dates.length === 0) return;

  if (blocked) {
    await db
      .insert(chefAvailability)
      .values(dates.map((d) => ({ chefId, date: d, available: false })))
      .onConflictDoUpdate({
        target: [chefAvailability.chefId, chefAvailability.date],
        set: { available: false },
      });
  } else {
    await db
      .delete(chefAvailability)
      .where(
        and(
          eq(chefAvailability.chefId, chefId),
          gte(chefAvailability.date, effectiveStart),
          lte(chefAvailability.date, end),
        ),
      );
  }

  await recordAuditFromRequest({
    action: "chef.availability_range_updated",
    resource: "chef_availability",
    resourceId: chefId,
    after: { startIso, endIso, blocked, affectedDates: dates.length },
  });
  await recordChefEvent({
    chefId,
    eventType: "availability_updated",
    entityType: "chef_availability",
    entityId: chefId,
    payload: { mode: "range", startIso, endIso, blocked, affectedDates: dates.length },
  });
}

/** CHEF-PR1: one-tap "ik ben niet beschikbaar" for a named scope. */
async function quickBlock(fd: FormData): Promise<void> {
  "use server";
  const scope = String(fd.get("scope") ?? "");
  const base = amsTodayUtcMidnight();
  const dow = base.getUTCDay(); // 0=Sun … 6=Sat
  const add = (n: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  };
  let start = base;
  let end = base;
  if (scope === "today") {
    start = base;
    end = base;
  } else if (scope === "tomorrow") {
    start = add(1);
    end = add(1);
  } else if (scope === "weekend") {
    const toSat = (6 - dow + 7) % 7;
    start = add(toSat);
    end = add(toSat + 1);
  } else if (scope === "week") {
    const toSun = (7 - dow) % 7;
    start = base;
    end = add(toSun);
  } else {
    return;
  }
  await setRange(isoOf(start), isoOf(end), true);
  revalidatePath("/chef/availability");
}

/** CHEF-PR1: copy last week's blocks (today-7 … yesterday) forward 7 days. */
async function repeatLastWeek(): Promise<void> {
  "use server";
  const { chefId } = await requireChefSelf();
  const base = amsTodayUtcMidnight();
  const weekAgo = new Date(base);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const yesterday = new Date(base);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const prev = await db
    .select({ date: chefAvailability.date })
    .from(chefAvailability)
    .where(
      and(
        eq(chefAvailability.chefId, chefId),
        eq(chefAvailability.available, false),
        gte(chefAvailability.date, weekAgo),
        lte(chefAvailability.date, yesterday),
      ),
    );

  const newDates = prev
    .map((r) => {
      const d = new Date(r.date);
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    })
    .filter((d) => d >= base);

  if (newDates.length > 0) {
    await db
      .insert(chefAvailability)
      .values(newDates.map((d) => ({ chefId, date: d, available: false })))
      .onConflictDoUpdate({
        target: [chefAvailability.chefId, chefAvailability.date],
        set: { available: false },
      });
    await recordAuditFromRequest({
      action: "chef.availability_repeat_week",
      resource: "chef_availability",
      resourceId: chefId,
      after: { affectedDates: newDates.length },
    });
  }
  revalidatePath("/chef/availability");
}

/** CHEF-PR1: save chef-authored work preferences (feeds matching later). */
async function savePreferences(fd: FormData): Promise<void> {
  "use server";
  const { chefId } = await requireChefSelf();
  const num = (k: string): number | null => {
    const v = String(fd.get(k) ?? "").trim();
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  // Clamp to sane bounds so a fat-fingered or hostile value can't poison matching.
  const clamp = (n: number | null, lo: number, hi: number): number | null =>
    n == null ? null : Math.min(hi, Math.max(lo, n));
  const likes = fd.getAll("preferences").map(String).filter(Boolean);
  const avoid = fd.getAll("avoid").map(String).filter(Boolean);
  const skills = sanitizeSkillTags(fd.getAll("skillTags").map(String));
  const empRaw = String(fd.get("employmentType") ?? "");
  const employmentType = ["payroll", "zzp", "both"].includes(empRaw)
    ? (empRaw as "payroll" | "zzp" | "both")
    : null;
  const notes = String(fd.get("availabilityNotes") ?? "").trim().slice(0, 1000) || null;

  await db
    .update(chefs)
    .set({
      travelRadiusKm: clamp(num("travelRadiusKm"), 0, 500),
      minStartHour: clamp(num("minStartHour"), 0, 23),
      availableForEmergency: fd.get("availableForEmergency") === "on",
      preferences: likes.length ? likes : null,
      avoidPreferences: avoid.length ? avoid : null,
      skillTags: skills.length ? skills : null,
      employmentType,
      availabilityNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(chefs.id, chefId));

  await recordAuditFromRequest({
    action: "chef.work_preferences_updated",
    resource: "chefs",
    resourceId: chefId,
    after: { likes: likes.length, avoid: avoid.length, travelRadiusKm: num("travelRadiusKm") },
  });
  revalidatePath("/chef/availability");
}

const QUICK_SCOPES = ["today", "tomorrow", "weekend", "week"] as const;

export default async function ChefAvailabilityPage() {
  const { chefId } = await requireChefSelf();
  const { dict: t } = await getI18n();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.id, chefId) });

  // Load blocked rows for the next 8 weeks (anything else = available).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + WEEKS_AHEAD * 7);

  const rows = await db
    .select({ date: chefAvailability.date })
    .from(chefAvailability)
    .where(
      and(
        eq(chefAvailability.chefId, chefId),
        gte(chefAvailability.date, today),
        lte(chefAvailability.date, horizon),
        eq(chefAvailability.available, false),
      ),
    );
  const blockedDates = rows.map((r) => isoOf(new Date(r.date)));

  const likes = new Set(chef?.preferences ?? []);
  const avoid = new Set(chef?.avoidPreferences ?? []);
  const skills = new Set(chef?.skillTags ?? []);
  const emp = chef?.employmentType ?? "";

  const sectionLabel = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";
  const card = "rounded-lg border border-ink-200 bg-white p-4 md:p-6";

  return (
    <div className="space-y-8">
      <div>
        <p className={sectionLabel}>{t.availability.eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.availability.heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          {t.availability.introA}
          <strong>{t.availability.introNot}</strong>
          {t.availability.introB}
        </p>
      </div>

      {/* 1 — Quick blocks */}
      <section className={card}>
        <p className={sectionLabel}>{t.availability.quickTitle}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_SCOPES.map((scope) => (
            <form action={quickBlock} key={scope}>
              <input type="hidden" name="scope" value={scope} />
              <button className="rounded-full border border-burgundy/40 bg-burgundy/5 px-4 py-2 font-ui text-[11px] font-medium text-burgundy hover:bg-burgundy/10">
                {t.availability.quick[scope]}
              </button>
            </form>
          ))}
          <form action={repeatLastWeek}>
            <button className="rounded-full border border-ink-200 bg-bg-gray px-4 py-2 font-ui text-[11px] font-medium text-ink-700 hover:bg-ink-100">
              {t.availability.repeatLastWeek}
            </button>
          </form>
        </div>
        <p className="mt-2 text-xs text-ink-500">{t.availability.unblockHint}</p>
      </section>

      {/* 2 — Calendar */}
      <section>
        <AvailabilityCalendar
          weeks={WEEKS_AHEAD}
          initialBlockedDates={blockedDates}
          toggleDate={toggleDate}
          setRange={setRange}
        />
      </section>

      {/* 3 — Preferred work */}
      <section className={card}>
        <p className={sectionLabel}>{t.availability.prefsTitle}</p>
        <p className="mt-1 text-xs text-ink-500">{t.availability.prefsSubtext}</p>
        <form action={savePreferences} className="mt-4 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-ink-900">{t.availability.likeLegend}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LIKE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs text-ink-700 has-[:checked]:border-emerald-300 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-800"
                >
                  <input type="checkbox" name="preferences" value={key} defaultChecked={likes.has(key)} className="accent-emerald-600" />
                  {t.availability.like[key]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-ink-900">{t.availability.avoidLegend}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {AVOID_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs text-ink-700 has-[:checked]:border-burgundy/40 has-[:checked]:bg-burgundy/5 has-[:checked]:text-burgundy"
                >
                  <input type="checkbox" name="avoid" value={key} defaultChecked={avoid.has(key)} className="accent-burgundy" />
                  {t.availability.avoid[key]}
                </label>
              ))}
            </div>
          </fieldset>

          {/* CHEF-PR5: structured skill tags — what je goed kunt (helpt bij matching).
              group/tag labels come from the skill-tags domain helper (still NL) — deferred. */}
          <fieldset>
            <legend className="text-sm font-medium text-ink-900">{t.availability.skillLegend}</legend>
            <p className="mt-0.5 text-xs text-ink-500">{t.availability.skillSubtext}</p>
            <div className="mt-2 space-y-3">
              {skillTagsByCategory().map((group) => (
                <div key={group.category}>
                  <p className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-400">
                    {group.label}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {group.tags.map((t) => (
                      <label
                        key={t.key}
                        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-xs text-ink-700 has-[:checked]:border-emerald-500/50 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-800"
                      >
                        <input
                          type="checkbox"
                          name="skillTags"
                          value={t.key}
                          defaultChecked={skills.has(t.key)}
                          className="accent-emerald-600"
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink-900">{t.availability.travelRadius}</span>
              <input
                type="number"
                name="travelRadiusKm"
                min={0}
                max={300}
                defaultValue={chef?.travelRadiusKm ?? ""}
                placeholder={t.availability.travelRadiusPlaceholder}
                className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-900">{t.availability.earliestStart}</span>
              <select
                name="minStartHour"
                defaultValue={chef?.minStartHour != null ? String(chef.minStartHour) : ""}
                className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
              >
                {START_HOURS.map((v) => (
                  <option key={v} value={v}>
                    {v === ""
                      ? t.availability.startHourNone
                      : fill(t.availability.startHourBefore, { time: `${v.padStart(2, "0")}:00` })}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink-900">{t.availability.employment}</legend>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-700">
              {(["payroll", "zzp", "both"] as const).map((v) => (
                <label key={v} className="flex cursor-pointer items-center gap-1.5">
                  <input type="radio" name="employmentType" value={v} defaultChecked={emp === v} className="accent-burgundy" />
                  {t.availability.employmentOpts[v]}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" name="availableForEmergency" defaultChecked={chef?.availableForEmergency ?? false} className="accent-burgundy" />
            {t.availability.emergencyOptIn}
          </label>

          <label className="block">
            <span className="text-sm font-medium text-ink-900">{t.availability.noteLabel}</span>
            <textarea
              name="availabilityNotes"
              rows={2}
              maxLength={1000}
              defaultValue={chef?.availabilityNotes ?? ""}
              placeholder={t.availability.notePlaceholder}
              className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
            />
          </label>

          <button className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy/90">
            {t.availability.savePrefs}
          </button>
        </form>
      </section>
    </div>
  );
}
