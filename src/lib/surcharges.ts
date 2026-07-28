/**
 * The surcharge calculation — pure, no database.
 *
 * Kept free of imports from `@/lib/db` so it can be unit-smoked in isolation, and kept out
 * of `src/lib/ai/**` on purpose: the CI eval only triggers on that path and the OpenAI
 * account is out of quota, so a pure helper living there would burn a run for nothing.
 *
 * WHY THE TIMEZONE WORK. A surcharge window like "00:00–06:00" is a LOCAL clock window,
 * but shifts are stored as instants. Doing the arithmetic in UTC quietly shifts every
 * window by an hour for half the year, and on the two DST nights a shift is 23 or 25 hours
 * long — the October night has two 02:00–03:00 hours and both of them are worked. Splitting
 * the shift into local-day segments first is the only way those hours are paid.
 *
 * V1 DOES NOT STACK. Per minute the highest-priority matching rule wins. Cao surcharges are
 * normally alternatives — a Sunday night is paid at the Sunday rate, not Sunday plus night —
 * and a stacking engine nobody asked for is a lot of surface to get wrong.
 */

export type ToeslagRegel = {
  id: string;
  code: string;
  label: string;
  kind: "time_window" | "weekday" | "holiday" | "spoed";
  startMinuteOfDay: number | null;
  endMinuteOfDay: number | null;
  weekdays: number[] | null;
  leadTimeHours: number | null;
  clientPctBps: number;
  chefPctBps: number;
  priority: number;
};

export type ToeslagUitkomst = {
  regelId: string;
  code: string;
  label: string;
  minuten: number;
  clientPctBps: number;
  chefPctBps: number;
  clientAmountCents: number;
  chefAmountCents: number;
};

/** Local wall-clock parts of an instant, in Amsterdam. */
function amsterdamDelen(t: Date): { jaar: number; maand: number; dag: number; minuutVanDag: number; isoWeekdag: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  });
  const d = Object.fromEntries(f.formatToParts(t).map((p) => [p.type, p.value])) as Record<string, string>;
  const WEEK: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const uur = Number(d.hour) % 24; // en-GB renders midnight as 24 in some runtimes
  return {
    jaar: Number(d.year),
    maand: Number(d.month),
    dag: Number(d.day),
    minuutVanDag: uur * 60 + Number(d.minute),
    isoWeekdag: WEEK[d.weekday] ?? 1,
  };
}

/** "2026-07-28" for an instant, in Amsterdam. */
export function amsterdamDagSleutel(t: Date): string {
  const p = amsterdamDelen(t);
  return `${p.jaar}-${String(p.maand).padStart(2, "0")}-${String(p.dag).padStart(2, "0")}`;
}

/**
 * Dutch public holidays for a year, as "YYYY-MM-DD" keys.
 *
 * Easter drives four of them, so it is computed (anonymous Gregorian algorithm) rather
 * than hard-coded — a table would silently go stale and start under-paying.
 */
export function nlFeestdagen(jaar: number): Set<string> {
  const a = jaar % 19, b = Math.floor(jaar / 100), c = jaar % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maand = Math.floor((h + l - 7 * m + 114) / 31);
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  const pasen = new Date(Date.UTC(jaar, maand - 1, dag));

  const sleutel = (d0: Date) => d0.toISOString().slice(0, 10);
  const plus = (n: number) => new Date(pasen.getTime() + n * 86_400_000);

  const dagen = new Set<string>([
    `${jaar}-01-01`,                    // Nieuwjaarsdag
    sleutel(plus(1)),                   // Tweede Paasdag
    sleutel(plus(39)),                  // Hemelvaartsdag
    sleutel(plus(50)),                  // Tweede Pinksterdag
    `${jaar}-12-25`,
    `${jaar}-12-26`,
  ]);

  // Koningsdag: 27 april, maar op zaterdag 26 april als de 27e een zondag is.
  const kon = new Date(Date.UTC(jaar, 3, 27));
  dagen.add(kon.getUTCDay() === 0 ? `${jaar}-04-26` : `${jaar}-04-27`);
  // Bevrijdingsdag is alleen in lustrumjaren een vrije dag; laat finance dat zelf bepalen.
  return dagen;
}

type Segment = { vanMs: number; totMs: number; dagSleutel: string; isoWeekdag: number; startMinuut: number };

/**
 * Split a worked span into segments that each sit inside one local day.
 *
 * Walks forward from the start, cutting at every local midnight. Because each cut is
 * recomputed from the actual local parts, a DST jump lands where it really is instead of
 * where a fixed 24-hour step would put it.
 */
export function lokaleSegmenten(van: Date, tot: Date): Segment[] {
  const uit: Segment[] = [];
  let cursor = van.getTime();
  const eind = tot.getTime();
  let bewaking = 0;

  while (cursor < eind && bewaking++ < 400) {
    const p = amsterdamDelen(new Date(cursor));
    // Minutes left until local midnight — from the local clock, so DST is included.
    const totMiddernacht = (1440 - p.minuutVanDag) * 60_000;
    const segEind = Math.min(cursor + totMiddernacht, eind);
    uit.push({
      vanMs: cursor,
      totMs: segEind,
      dagSleutel: `${p.jaar}-${String(p.maand).padStart(2, "0")}-${String(p.dag).padStart(2, "0")}`,
      isoWeekdag: p.isoWeekdag,
      startMinuut: p.minuutVanDag,
    });
    if (segEind <= cursor) break; // paranoia: never loop on a zero-length segment
    cursor = segEind;
  }
  return uit;
}

/** Does this rule cover the given local minute of the given local day? */
function regelDektMinuut(regel: ToeslagRegel, seg: Segment, minuutVanDag: number, feestdagen: Set<string>, spoed: boolean): boolean {
  switch (regel.kind) {
    case "time_window": {
      const s = regel.startMinuteOfDay, e = regel.endMinuteOfDay;
      if (s == null || e == null) return false;
      // e <= s means the window wraps past midnight (22:00-06:00).
      return e > s ? minuutVanDag >= s && minuutVanDag < e : minuutVanDag >= s || minuutVanDag < e;
    }
    case "weekday":
      return (regel.weekdays ?? []).includes(seg.isoWeekdag);
    case "holiday":
      return feestdagen.has(seg.dagSleutel);
    case "spoed":
      return spoed;
  }
}

export type BerekenInvoer = {
  van: Date;
  tot: Date;
  /** Unpaid break, deducted proportionally across the segments — see the note below. */
  pauzeMinuten: number;
  baseClientRateCents: number;
  baseChefRateCents: number;
  /** Hours between booking and start; drives the `spoed` rule. Null = unknown, no spoed. */
  leadTimeHours: number | null;
  regels: ToeslagRegel[];
};

/**
 * Which rule wins each minute, and what that is worth.
 *
 * The break is spread PROPORTIONALLY over the segments rather than taken off one end.
 * Taking it off the front would hand the whole break to the evening and pay the full night
 * at the night rate; taking it off the back does the reverse. Proportional is the only
 * split that does not quietly pick a side, and if the cao says otherwise this is the one
 * place to change it.
 */
export function berekenToeslagen(inv: BerekenInvoer): ToeslagUitkomst[] {
  const actief = inv.regels.filter((r) => r.clientPctBps > 0 || r.chefPctBps > 0);
  if (actief.length === 0) return [];

  const segmenten = lokaleSegmenten(inv.van, inv.tot);
  if (segmenten.length === 0) return [];

  const jaren = new Set(segmenten.map((s) => Number(s.dagSleutel.slice(0, 4))));
  const feestdagen = new Set<string>();
  for (const j of jaren) for (const d of nlFeestdagen(j)) feestdagen.add(d);

  const spoed = inv.leadTimeHours != null;
  const perCode = new Map<string, { regel: ToeslagRegel; minuten: number }>();
  let totaalMinuten = 0;

  for (const seg of segmenten) {
    const lengte = Math.round((seg.totMs - seg.vanMs) / 60_000);
    for (let i = 0; i < lengte; i++) {
      const minuutVanDag = (seg.startMinuut + i) % 1440;
      let winnaar: ToeslagRegel | null = null;
      for (const r of actief) {
        const spoedMatch = r.kind !== "spoed" || (spoed && inv.leadTimeHours! < (r.leadTimeHours ?? 0));
        if (!spoedMatch) continue;
        if (!regelDektMinuut(r, seg, minuutVanDag, feestdagen, spoed)) continue;
        if (!winnaar || r.priority > winnaar.priority) winnaar = r;
      }
      totaalMinuten++;
      if (!winnaar) continue;
      const bestaand = perCode.get(winnaar.code);
      if (bestaand) bestaand.minuten++;
      else perCode.set(winnaar.code, { regel: winnaar, minuten: 1 });
    }
  }

  if (totaalMinuten === 0) return [];
  const betaaldeFactor = Math.max(0, (totaalMinuten - Math.max(0, inv.pauzeMinuten)) / totaalMinuten);

  return [...perCode.values()]
    .map(({ regel, minuten }) => {
      const betaaldeMinuten = minuten * betaaldeFactor;
      const clientAmountCents = Math.round((betaaldeMinuten / 60) * inv.baseClientRateCents * (regel.clientPctBps / 10_000));
      const chefAmountCents = Math.round((betaaldeMinuten / 60) * inv.baseChefRateCents * (regel.chefPctBps / 10_000));
      return {
        regelId: regel.id,
        code: regel.code,
        label: regel.label,
        minuten: Math.round(betaaldeMinuten),
        clientPctBps: regel.clientPctBps,
        chefPctBps: regel.chefPctBps,
        clientAmountCents,
        chefAmountCents,
      };
    })
    .filter((u) => u.clientAmountCents !== 0 || u.chefAmountCents !== 0)
    .sort((a, b) => b.clientAmountCents - a.clientAmountCents);
}
