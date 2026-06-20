/**
 * /chef/hours — chef's hours queue.
 *
 * PR-CHEF-1. Replaces the stub. Three sections:
 *   1. Actie nodig — shift_hours in 'draft' or 'client_rejected'/'admin_rejected'
 *      that the chef needs to fill or fix.
 *   2. Wachten op anderen — submitted (waiting on klant) or client_signed
 *      (waiting on admin). Shows the trust timeline so chef knows where it is.
 *   3. Afgerond — admin_approved or exported, this month.
 *
 * Server component. Loads three queries by status bucket.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";

import { HumanStatusBadge } from "@/components/hours/HumanStatusBadge";
import { TrustTimeline } from "@/components/hours/TrustTimeline";
import { db } from "@/lib/db/client";
import {
  chefs,
  clients,
  shiftHours,
  shifts,
} from "@/lib/db/schema";
import { formatShiftRole } from "@/lib/labels";
import {
  formatEuro,
  formatWorkedMinutes,
  humanNextAction,
  timelineDots,
  computeChefAmountCents,
} from "@/lib/hours-labels";
import { getI18n } from "@/lib/i18n/server";
import { INTL_TAG, type Locale } from "@/lib/i18n/locales";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Uren" };
export const dynamic = "force-dynamic";

export default async function ChefHoursPage() {
  const session = await requireAuth("/chef/hours");
  const { locale, dict: t } = await getI18n();
  if (session.user.kind !== "chef" && !session.user.roles.includes("super_admin")) {
    return <p>{t.hours.accessDenied}</p>;
  }
  const chef = await db.query.chefs.findFirst({
    where: eq(chefs.userId, session.user.id),
  });
  if (!chef) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
        <h1 className="font-serif text-2xl text-ink-900">{t.hours.profileNotFound}</h1>
        <p className="mt-2 text-sm text-ink-700">{t.hours.profileNotFoundBody}</p>
      </div>
    );
  }

  const actieNodig = await db
    .select({
      h: shiftHours,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(
      and(
        eq(shiftHours.chefId, chef.id),
        inArray(shiftHours.status, ["draft", "client_rejected", "admin_rejected"]),
      ),
    )
    .orderBy(shifts.startsAt);

  const wachtend = await db
    .select({
      h: shiftHours,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(
      and(
        eq(shiftHours.chefId, chef.id),
        inArray(shiftHours.status, ["submitted", "client_signed"]),
      ),
    )
    .orderBy(desc(shifts.startsAt));

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const afgerond = await db
    .select({
      h: shiftHours,
      shift: shifts,
      clientName: clients.companyName,
    })
    .from(shiftHours)
    .innerJoin(shifts, eq(shifts.id, shiftHours.shiftId))
    .innerJoin(clients, eq(clients.id, shiftHours.clientId))
    .where(
      and(
        eq(shiftHours.chefId, chef.id),
        inArray(shiftHours.status, ["admin_approved", "exported"]),
        gte(shifts.startsAt, startOfMonth),
      ),
    )
    .orderBy(desc(shifts.startsAt));

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        {t.hours.eyebrow}
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {t.hours.heading}
      </h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-700">
        {t.hours.intro}
      </p>

      {/* Actie nodig */}
      {actieNodig.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            {t.hours.actionNeeded} ({actieNodig.length})
          </h2>
          <ul className="mt-4 space-y-3">
            {actieNodig.map(({ h, shift, clientName }) => (
              <li
                key={h.id}
                className="rounded-lg border-2 border-burgundy/40 bg-burgundy/5 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-serif text-lg text-ink-900">
                      {clientName} ·{" "}
                      <span className="text-ink-500">{formatShiftRole(shift.roleNeeded)}</span>
                    </h3>
                    <p className="mt-1 text-sm text-ink-700">
                      {formatShiftDate(shift.startsAt, locale)}
                    </p>
                    <p className="mt-2 text-sm text-ink-900">
                      {humanNextAction(h.status, "chef")}
                    </p>
                  </div>
                  <HumanStatusBadge status={h.status} />
                </div>
                <div className="mt-4">
                  <Link
                    href={`/chef/hours/${h.placementId}`}
                    className="inline-block rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
                  >
                    {h.status === "draft" ? t.hours.buttonFill : t.hours.buttonEdit}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Wachten op anderen */}
      {wachtend.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            {t.hours.waitingOnOthers} ({wachtend.length})
          </h2>
          <ul className="mt-4 space-y-4">
            {wachtend.map(({ h, shift, clientName }) => (
              <li
                key={h.id}
                className="rounded-lg border border-ink-200 bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-base text-ink-900">
                      {clientName} ·{" "}
                      <span className="text-ink-500">{formatShiftRole(shift.roleNeeded)}</span>
                    </h3>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatShiftDate(shift.startsAt, locale)} ·{" "}
                      {formatWorkedMinutes(h.workedMinutes)} ·{" "}
                      {formatEuro(computeChefAmountCents(h.workedMinutes, h.chefRateCents))}
                    </p>
                  </div>
                  <HumanStatusBadge status={h.status} />
                </div>
                <div className="mt-4">
                  <TrustTimeline steps={timelineDots(h)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Afgerond */}
      {afgerond.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl text-ink-900">
            {t.hours.completedThisMonth} ({afgerond.length})
          </h2>
          <ul className="mt-4 space-y-2">
            {afgerond.map(({ h, shift, clientName }) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded border border-ink-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="font-serif text-sm text-ink-900">
                    {clientName} ·{" "}
                    <span className="text-ink-500">{formatShiftRole(shift.roleNeeded)}</span>
                  </p>
                  <p className="text-xs text-ink-500">
                    {formatShiftDate(shift.startsAt, locale)} ·{" "}
                    {formatWorkedMinutes(h.workedMinutes)} ·{" "}
                    {formatEuro(computeChefAmountCents(h.workedMinutes, h.chefRateCents))}
                  </p>
                </div>
                <HumanStatusBadge status={h.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {actieNodig.length === 0 && wachtend.length === 0 && afgerond.length === 0 && (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-8 text-center">
          <p className="font-serif text-lg text-ink-900">{t.hours.emptyHeading}</p>
          <p className="mt-2 text-sm text-ink-500">{t.hours.emptyDescription}</p>
        </div>
      )}
    </div>
  );
}

function formatShiftDate(d: Date, locale: Locale): string {
  return new Date(d).toLocaleDateString(INTL_TAG[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
