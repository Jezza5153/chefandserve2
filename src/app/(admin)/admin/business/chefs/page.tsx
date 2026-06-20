import { and, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/lib/db/client";
import { chefs, vakniveauEnum } from "@/lib/db/schema";
import { formatChefRole } from "@/lib/labels";
import { requirePermission } from "@/lib/permissions";
import { listSavedSearches } from "@/lib/domain/saved-searches";
import { saveCurrentSearch, removeSavedSearch } from "./_actions";

export const metadata = { title: "Chefs" };

type FilterStatus =
  | "all"
  | "onboarding"
  | "active"
  | "paused"
  | "inactive"
  | "archived";

export default async function ChefsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: FilterStatus;
    q?: string;
    transport?: string;
    pref?: string;
    employment?: string;
    data?: string;
    niveau?: string;
    segment?: string;
    rating?: string;
    spoed?: string;
    ownertag?: string;
  }>;
}) {
  const session = await requirePermission("chefs", "read");
  const params = await searchParams;
  const status: FilterStatus = params.status ?? "active";
  const q = params.q?.trim() ?? "";
  const transport = params.transport ?? "";
  const pref = params.pref ?? "";
  const employment = params.employment ?? "";
  const dataFilter = params.data ?? "";
  const niveau = params.niveau ?? "";
  const segment = params.segment ?? "";
  const rating = params.rating ?? ""; // "4" / "4.5" → minimum average ★
  const spoed = params.spoed ?? ""; // "1" → availableForEmergency
  const ownertag = params.ownertag?.trim() ?? ""; // C1: one of Maarten's free labels

  // PR-2.1: preserve every active filter across pill clicks.
  const cur = { status, q, transport, pref, employment, data: dataFilter, niveau, segment, rating, spoed, ownertag };
  const toHref = (over: Partial<typeof cur>): string => {
    const m = { ...cur, ...over };
    const sp = new URLSearchParams();
    if (m.status !== "active") sp.set("status", m.status);
    if (m.q) sp.set("q", m.q);
    if (m.transport) sp.set("transport", m.transport);
    if (m.pref) sp.set("pref", m.pref);
    if (m.employment) sp.set("employment", m.employment);
    if (m.data) sp.set("data", m.data);
    if (m.niveau) sp.set("niveau", m.niveau);
    if (m.segment) sp.set("segment", m.segment);
    if (m.rating) sp.set("rating", m.rating);
    if (m.spoed) sp.set("spoed", m.spoed);
    if (m.ownertag) sp.set("ownertag", m.ownertag);
    const s = sp.toString();
    return `/admin/business/chefs${s ? `?${s}` : ""}`;
  };

  // B2: the current filter set as a querystring (to pin) + the owner's saved buttons.
  const currentQuery = toHref({}).split("?")[1] ?? "";
  const savedSearchList = await listSavedSearches(session.user.id, "chef_search");

  // Build WHERE
  const whereParts = [isNull(chefs.deletedAt)];
  if (status !== "all") whereParts.push(eq(chefs.status, status));
  if (q) {
    whereParts.push(
      or(
        like(chefs.fullName, `%${q}%`),
        like(chefs.email, `%${q}%`),
        like(chefs.city, `%${q}%`),
      )!,
    );
  }
  if (transport) whereParts.push(eq(chefs.transportMode, transport as "car" | "motorbike" | "ebike" | "none"));
  if (pref) whereParts.push(sql`${pref} = ANY(${chefs.preferences})`);
  if (employment) whereParts.push(eq(chefs.employmentType, employment as "payroll" | "zzp" | "both"));
  if (dataFilter === "incomplete") whereParts.push(or(isNull(chefs.postcode), isNull(chefs.transportMode))!);
  // B1: precise chef-search dimensions (Maarten's repeated ways of hunting).
  if (niveau) whereParts.push(eq(chefs.vakniveau, niveau as (typeof vakniveauEnum.enumValues)[number]));
  if (segment) whereParts.push(sql`${segment} = ANY(${chefs.segments})`);
  const ratingMin = Number(rating);
  if (Number.isFinite(ratingMin) && ratingMin > 0) {
    // numeric(3,2), nullable — unrated chefs (NULL) correctly drop out of "★N+".
    whereParts.push(sql`${chefs.averageRating} >= ${ratingMin}`);
  }
  if (spoed === "1") whereParts.push(eq(chefs.availableForEmergency, true));
  if (ownertag) whereParts.push(sql`${ownertag} = ANY(${chefs.ownerTags})`); // C1: filter by an owner label

  const rows = await db
    .select({
      id: chefs.id,
      fullName: chefs.fullName,
      email: chefs.email,
      phone: chefs.phone,
      city: chefs.city,
      vakniveau: chefs.vakniveau,
      segments: chefs.segments,
      yearsExperience: chefs.yearsExperience,
      status: chefs.status,
      joinedAt: chefs.joinedAt,
      transportMode: chefs.transportMode,
      preferences: chefs.preferences,
      postcode: chefs.postcode,
      averageRating: chefs.averageRating,
      ratingCount: chefs.ratingCount,
      availableForEmergency: chefs.availableForEmergency,
      ownerTags: chefs.ownerTags,
    })
    .from(chefs)
    .where(and(...whereParts))
    .orderBy(desc(chefs.joinedAt))
    .limit(200);

  // Counts per status (for the filter pills)
  const counts = await db
    .select({
      status: chefs.status,
      n: sql<number>`count(*)::int`,
    })
    .from(chefs)
    .where(isNull(chefs.deletedAt))
    .groupBy(chefs.status);

  const countByStatus = (s: FilterStatus): number => {
    if (s === "all") return counts.reduce((a, c) => a + c.n, 0);
    return counts.find((c) => c.status === s)?.n ?? 0;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
            Operations
          </p>
          <h1 className="mt-3 font-serif text-4xl text-ink-900 md:text-5xl">
            Chefs
          </h1>
        </div>
        <span className="rounded-full bg-burgundy/10 px-3 py-1 font-ui text-[11px] font-medium text-burgundy">
          {countByStatus("all")} totaal
        </span>
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {(["active", "onboarding", "paused", "inactive", "archived", "all"] as FilterStatus[]).map(
          (s) => (
            <FilterPill
              key={s}
              label={`${statusLabel(s)} (${countByStatus(s)})`}
              active={status === s}
              href={toHref({ status: s })}
            />
          ),
        )}
        <form
          action="/admin/business/chefs"
          className="ml-auto flex items-center gap-2"
        >
          {status !== "active" && (
            <input type="hidden" name="status" value={status} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Zoek op naam, email, stad…"
            className="rounded border border-ink-200 bg-white px-3 py-2 text-sm placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
          />
          <button
            type="submit"
            className="rounded-full bg-burgundy px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
          >
            Zoek
          </button>
        </form>
      </div>

      {/* PR-2.1: smart views */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Snelweergaven</span>
        <FilterPill
          label="Ontbijt + auto"
          active={pref === "breakfast" && transport === "car"}
          href={
            pref === "breakfast" && transport === "car"
              ? toHref({ pref: "", transport: "" })
              : toHref({ pref: "breakfast", transport: "car" })
          }
        />
        <FilterPill label="Mist profieldata" active={dataFilter === "incomplete"} href={toHref({ data: dataFilter === "incomplete" ? "" : "incomplete" })} />
        <FilterPill label="ZZP" active={employment === "zzp"} href={toHref({ employment: employment === "zzp" ? "" : "zzp" })} />
        <FilterPill label="Payroll" active={employment === "payroll"} href={toHref({ employment: employment === "payroll" ? "" : "payroll" })} />
      </div>

      {/* C1: active owner-label filter (set by clicking a chef's label chip). */}
      {ownertag && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Label</span>
          <FilterPill label={`${ownertag} ✕`} active href={toHref({ ownertag: "" })} />
        </div>
      )}

      {/* B2: Maarten's own pinned searches + "bewaar als knop" (captures the active filters). */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Mijn knoppen</span>
        {savedSearchList.length === 0 ? (
          <span className="text-[11px] text-ink-400">Nog geen — bewaar hieronder een filtercombinatie.</span>
        ) : (
          savedSearchList.map((sv) => (
            <span
              key={sv.id}
              className="inline-flex items-center gap-1 rounded-full border border-burgundy/30 bg-burgundy/5 py-1 pl-3 pr-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy"
            >
              <Link href={`/admin/business/chefs${sv.query ? `?${sv.query}` : ""}`} className="hover:underline">
                {sv.label}
              </Link>
              <form action={removeSavedSearch} className="inline">
                <input type="hidden" name="id" value={sv.id} />
                <input type="hidden" name="query" value={currentQuery} />
                <button
                  type="submit"
                  aria-label={`Verwijder knop ${sv.label}`}
                  title="Verwijder knop"
                  className="rounded-full px-1 leading-none text-ink-400 hover:bg-burgundy/10 hover:text-burgundy"
                >
                  ×
                </button>
              </form>
            </span>
          ))
        )}
        <form action={saveCurrentSearch} className="ml-2 inline-flex items-center gap-1">
          <input type="hidden" name="query" value={currentQuery} />
          <input
            name="label"
            placeholder="Knopnaam…"
            maxLength={60}
            className="w-28 rounded border border-ink-200 bg-white px-2 py-1 text-[11px] placeholder-ink-400 focus:border-burgundy focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-full border border-burgundy/40 bg-white px-2.5 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy hover:bg-burgundy/5"
          >
            Bewaar als knop
          </button>
        </form>
      </div>

      {/* PR-2.1: verfijn — vervoer + voorkeur */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Vervoer</span>
        {(["car", "motorbike", "ebike", "none"] as const).map((tt) => (
          <FilterPill key={tt} label={TRANSPORT_FILTER_LABELS[tt]} active={transport === tt} href={toHref({ transport: transport === tt ? "" : tt })} />
        ))}
        <span className="ml-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Voorkeur</span>
        {(["breakfast", "bbq", "hotels", "banqueting", "michelin"] as const).map((pp) => (
          <FilterPill key={pp} label={PREF_FILTER_LABELS[pp]} active={pref === pp} href={toHref({ pref: pref === pp ? "" : pp })} />
        ))}
      </div>

      {/* B1: precise chef-search — vakniveau */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Niveau</span>
        {(["commis", "chef_de_partie", "sous_chef", "chef_de_cuisine", "patissier"] as const).map((nv) => (
          <FilterPill key={nv} label={formatChefRole(nv)} active={niveau === nv} href={toHref({ niveau: niveau === nv ? "" : nv })} />
        ))}
        <span className="ml-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Segment</span>
        {(["hotel", "fine_dining", "michelin", "banqueting", "event"] as const).map((sg) => (
          <FilterPill key={sg} label={SEGMENT_FILTER_LABELS[sg]} active={segment === sg} href={toHref({ segment: segment === sg ? "" : sg })} />
        ))}
      </div>

      {/* B1: kwaliteit + spoed */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Beoordeling</span>
        <FilterPill label="★ 4+" active={rating === "4"} href={toHref({ rating: rating === "4" ? "" : "4" })} />
        <FilterPill label="★ 4,5+" active={rating === "4.5"} href={toHref({ rating: rating === "4.5" ? "" : "4.5" })} />
        <span className="ml-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Inzet</span>
        <FilterPill label="Spoed-inzetbaar" active={spoed === "1"} href={toHref({ spoed: spoed === "1" ? "" : "1" })} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-ink-200 bg-white p-10 text-center">
          <p className="font-serif text-xl text-ink-900">Geen chefs gevonden</p>
          <p className="mt-2 text-sm text-ink-500">
            Chefs verschijnen hier zodra een aanmelding wordt geconverteerd in de{" "}
            <Link href="/admin/business/inbox" className="text-burgundy hover:underline">
              inbox
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full">
            <thead className="bg-bg-gray text-left">
              <tr>
                <Th>Naam</Th>
                <Th>Vakniveau</Th>
                <Th>Stad</Th>
                <Th>Vervoer / voorkeur</Th>
                <Th>Ervaring</Th>
                <Th>Beoordeling</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={i < rows.length - 1 ? "border-b border-ink-200" : ""}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/business/chefs/${r.id}`}
                      className="font-serif text-sm text-ink-900 hover:text-burgundy hover:underline"
                    >
                      {r.fullName}
                    </Link>
                    {(r.ownerTags ?? []).length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(r.ownerTags ?? []).slice(0, 4).map((t) => (
                          <Link
                            key={t}
                            href={toHref({ ownertag: ownertag === t ? "" : t })}
                            title={`Filter op label “${t}”`}
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ownertag === t ? "bg-burgundy text-white" : "bg-burgundy/10 text-burgundy hover:bg-burgundy/20"}`}
                          >
                            {t}
                          </Link>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {formatChefRole(r.vakniveau)}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.city ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.transportMode ? TRANSPORT_FILTER_LABELS[r.transportMode] : "—"}
                    {(r.preferences ?? []).length > 0
                      ? ` · ${(r.preferences ?? [])
                          .slice(0, 2)
                          .map((p) => PREF_FILTER_LABELS[p as keyof typeof PREF_FILTER_LABELS] ?? p)
                          .join(", ")}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.yearsExperience ? `${r.yearsExperience}j` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.averageRating != null && (r.ratingCount ?? 0) > 0 ? (
                      <span className="text-amber-700">
                        ★ {Number(r.averageRating).toFixed(1)}
                        <span className="text-ink-400"> ({r.ratingCount})</span>
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-700">
                    {r.email ?? r.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 font-ui text-[10px] uppercase tracking-[0.2em] text-burgundy">
      {children}
    </th>
  );
}

function FilterPill({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] transition-colors ${
        active
          ? "bg-burgundy text-white"
          : "bg-bg-gray text-ink-700 hover:bg-burgundy/10 hover:text-burgundy"
      }`}
    >
      {label}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-100 text-emerald-700"
      : status === "onboarding"
        ? "bg-amber-100 text-amber-700"
        : status === "paused"
          ? "bg-blue-100 text-blue-700"
          : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {statusLabel(status as FilterStatus)}
    </span>
  );
}

function statusLabel(s: FilterStatus): string {
  return (
    ({
      all: "Alle",
      active: "Actief",
      onboarding: "Onboarding",
      paused: "Gepauzeerd",
      inactive: "Inactief",
      archived: "Gearchiveerd",
    } as const)[s] ?? s
  );
}

const TRANSPORT_FILTER_LABELS: Record<string, string> = {
  car: "Auto",
  motorbike: "Motor",
  ebike: "E-bike",
  none: "OV/geen",
};
const PREF_FILTER_LABELS: Record<string, string> = {
  breakfast: "Ontbijt",
  bbq: "BBQ",
  hotels: "Hotels",
  banqueting: "Banqueting",
  michelin: "Michelin",
};
const SEGMENT_FILTER_LABELS: Record<string, string> = {
  hotel: "Hotel",
  fine_dining: "Fine dining",
  michelin: "Michelin",
  banqueting: "Banqueting",
  event: "Event",
};
