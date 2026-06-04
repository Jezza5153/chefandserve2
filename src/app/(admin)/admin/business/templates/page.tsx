/**
 * /admin/business/templates — list all recurring shift templates (PR-KLANT-4).
 */

import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { clients, shiftTemplates } from "@/lib/db/schema";
import { formatPattern } from "@/lib/shift-template-format";
import { requireAnyRole } from "@/lib/permissions";

export const metadata = { title: "Templates" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireAnyRole(["owner", "planner"]);

  const rows = await db
    .select({
      t: shiftTemplates,
      companyName: clients.companyName,
    })
    .from(shiftTemplates)
    .innerJoin(clients, eq(clients.id, shiftTemplates.clientId))
    .orderBy(desc(shiftTemplates.active), desc(shiftTemplates.createdAt))
    .limit(200);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Operations
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
            Vaste shifts (templates)
          </h1>
        </div>
        <Link
          href="/admin/business/templates/new"
          className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          + Nieuwe template
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-500">
        Wekelijkse patronen die automatisch shifts aanmaken. Een dagelijkse
        worker materialiseert nieuwe shifts binnen de horizon.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-10 text-center text-sm text-ink-500">
          Nog geen templates. Maak er een aan met &ldquo;Nieuwe template&rdquo;.
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map(({ t, companyName }) => (
            <li key={t.id}>
              <Link
                href={`/admin/business/templates/${t.id}`}
                className="block rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-serif text-base text-ink-900">
                      {companyName}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-700">
                      {formatPattern({
                        dayOfWeek: t.dayOfWeek,
                        startsAtTime: t.startsAtTime,
                        endsAtTime: t.endsAtTime,
                        endsNextDay: t.endsNextDay,
                      })}{" "}
                      · {t.roleNeeded} · {t.headcount} chef{t.headcount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${
                      t.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-bg-gray text-ink-500"
                    }`}
                  >
                    {t.active ? "Actief" : "Gepauzeerd"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
