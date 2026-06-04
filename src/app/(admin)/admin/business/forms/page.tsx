import { asc } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { forms } from "@/lib/db/schema";
import { requireAnyRole } from "@/lib/permissions";

export const metadata = { title: "Formulieren", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Concept",
  published: "Gepubliceerd",
  archived: "Gearchiveerd",
};

export default async function FormsListPage() {
  await requireAnyRole(["owner", "planner"], "/admin/business");
  const rows = await db.select().from(forms).orderBy(asc(forms.slug));

  return (
    <div className="max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Beheer</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Formulieren</h1>
      <p className="mt-2 text-sm text-ink-600">
        Bouw en bewerk de intake- en onboardingformulieren. Systeemvelden (BSN, IBAN, ID…) staan vast — je past
        labels aan, verbergt of herordent velden, en voegt eigen velden toe.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Nog geen formulieren. Draai <code>npm run db:seed:forms</code>.
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((f) => (
            <li key={f.id}>
              <Link
                href={`/admin/business/forms/${f.slug}`}
                className="block rounded-lg border border-ink-200 bg-white p-4 hover:border-burgundy/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-serif text-base text-ink-900">{f.title}</p>
                    <p className="mt-0.5 font-ui text-[10px] uppercase tracking-[0.14em] text-ink-400">
                      /{f.slug} · v{f.version} · {f.audience}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${
                      f.status === "published"
                        ? "bg-emerald-100 text-emerald-700"
                        : f.status === "draft"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-bg-gray text-ink-500"
                    }`}
                  >
                    {STATUS_LABEL[f.status] ?? f.status}
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
