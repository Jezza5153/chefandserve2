/**
 * BenchStrip — "wie kan ik NU bellen?" (DASH-PEOPLE).
 *
 * The inverse roster: active chefs who are NOT placed today and have NOT blocked today.
 * This existed only as a buried table on Rooster-Dag; in a 09:40 panic the call list
 * belongs on the control room itself, phone-first. "No row = available" semantics mean
 * an empty chef_availability table excludes nobody — the strip says "niet ingepland",
 * it never promises "confirmed free".
 *
 * Sort order is the panic order: spoed-ready first, then most proven (lifetime hours,
 * oude-systeem historie counts). Capped — 204 real chefs must not become a 10.000px
 * rail; the counter links to the full directory.
 */
import Link from "next/link";

import { Icon } from "@/components/admin/icons";
import { ChefCard } from "@/components/ChefCard";
import { formatChefRole } from "@/lib/labels";
import type { ChefCardData } from "@/lib/domain/chef-cards";

export type BenchRow = {
  id: string;
  fullName: string;
  vakniveau: string | null;
  city: string | null;
  phone: string | null;
  spoed: boolean;
  /** FINAL new-system hours. */
  totalHours: number;
  /** Oude-systeem historie — always labelled as such, never mixed into totalHours. */
  legacyHours: number;
};

/** wa.me needs digits with country code; Dutch 06… becomes 316…. */
function waHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("06") ? `31${digits.slice(1)}` : digits.replace(/^00/, "");
  return `https://wa.me/${intl}`;
}

const BENCH_CAP = 8;

export function BenchStrip({ rows, cards }: { rows: BenchRow[]; cards: Map<string, ChefCardData> }) {
  const shown = rows.slice(0, BENCH_CAP);
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg text-ink-900">Vrij vandaag</h2>
        <Link
          href="/admin/business/chefs"
          className="font-ui text-[11px] text-ink-500 underline-offset-4 hover:text-burgundy hover:underline"
        >
          {rows.length} {rows.length === 1 ? "chef" : "chefs"} niet ingepland →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">
          Iedereen is vandaag ingepland of heeft geblokkeerd — bij uitval helpt de assistent
          met alternatieven.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-100">
          {shown.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <CardOrLink card={cards.get(c.id)} chefId={c.id}>
                <span className="flex items-center gap-1.5 truncate text-sm text-ink-900">
                  {c.fullName}
                  {c.spoed && (
                    <span
                      className="rounded-full bg-amber-100 px-1.5 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-800"
                      title="Beschikbaar voor spoed"
                    >
                      spoed
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-500">
                  {[
                    c.vakniveau ? formatChefRole(c.vakniveau) : null,
                    c.city,
                    c.totalHours > 0 ? `${c.totalHours} u gewerkt` : null,
                    c.legacyHours > 0 ? `±${c.legacyHours} u (oude systeem)` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </CardOrLink>
              {c.phone && (
                <span className="flex shrink-0 items-center gap-1">
                  <a
                    href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                    className="rounded-full border border-ink-200 p-1.5 text-ink-700 hover:border-burgundy hover:text-burgundy"
                    title={`Bel ${c.fullName}`}
                  >
                    <Icon name="phone" className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={waHref(c.phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-ink-200 p-1.5 text-ink-700 hover:border-emerald-600 hover:text-emerald-700"
                    title={`WhatsApp ${c.fullName}`}
                  >
                    <Icon name="message-circle" className="h-3.5 w-3.5" />
                  </a>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The name opens the hover card when we have its data; plain profile link otherwise. */
function CardOrLink({
  card,
  chefId,
  children,
}: {
  card: ChefCardData | undefined;
  chefId: string;
  children: React.ReactNode;
}) {
  if (card) {
    return (
      <span className="min-w-0 flex-1">
        <ChefCard data={card}>{children}</ChefCard>
      </span>
    );
  }
  return (
    <Link href={`/admin/business/chefs/${chefId}`} className="min-w-0 flex-1 hover:text-burgundy">
      {children}
    </Link>
  );
}
