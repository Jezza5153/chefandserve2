/* TEMPORARY visual-QA harness — real components + fixtures, no auth. DELETE before commit. */
import {
  buildRosterView,
  dienstLabel,
  dayToneOf,
  type AvailableChefRow,
  type RosterShiftRow,
} from "@/lib/domain/roster-intel";

import { Icon } from "@/components/admin/icons";
import { BeschikbareChefsTable, type ChefRow } from "../(admin)/admin/business/roster/_components/BeschikbareChefsTable";
import { OpenDienstenTable, type OpenDienstRow } from "../(admin)/admin/business/roster/_components/OpenDienstenTable";
import { RosterDayTimeline } from "../(admin)/admin/business/roster/_components/RosterDayTimeline";
import { RosterKpiStrip, type KpiTile } from "../(admin)/admin/business/roster/_components/RosterKpiStrip";

export const dynamic = "force-static";

const D = "2026-05-29";
const NOW = new Date(`${D}T09:24:00Z`); // 11:24 Amsterdam
const at = (h: number, m = 0) => new Date(`${D}T${String(h - 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

let n = 0;
const mk = (clientId: string, companyName: string, city: string, sh: number, sm: number, eh: number, hc: number, conf: number, acc = 0): RosterShiftRow => ({
  id: `s${n++}`,
  startsAt: at(sh, sm),
  endsAt: at(eh),
  roleNeeded: "chef_de_partie",
  headcount: hc,
  status: conf >= hc ? "filled" : "open",
  location: companyName,
  city,
  clientId,
  companyName,
  confirmedCount: conf,
  acceptedCount: acc,
  proposedCount: 0,
});

const rows: RosterShiftRow[] = [
  mk("a", "Grand Hotel Amstel", "Amsterdam", 7, 0, 15, 2, 2),
  mk("a", "Grand Hotel Amstel", "Amsterdam", 11, 0, 19, 3, 3),
  mk("a", "Grand Hotel Amstel", "Amsterdam", 17, 0, 22, 3, 2),
  mk("b", "Hotel Vondelpark", "Amsterdam", 6, 30, 14, 2, 2),
  mk("b", "Hotel Vondelpark", "Amsterdam", 10, 0, 18, 3, 2),
  mk("b", "Hotel Vondelpark", "Amsterdam", 16, 0, 22, 3, 3),
  mk("c", "The Harbour Hotel", "Rotterdam", 7, 0, 15, 2, 1),
  mk("c", "The Harbour Hotel", "Rotterdam", 12, 0, 20, 2, 2),
  mk("c", "The Harbour Hotel", "Rotterdam", 18, 0, 22, 2, 1),
  mk("d", "Parklane Den Haag", "Den Haag", 6, 0, 14, 2, 1),
  mk("d", "Parklane Den Haag", "Den Haag", 11, 0, 19, 3, 2),
  mk("d", "Parklane Den Haag", "Den Haag", 17, 0, 21, 2, 0),
  mk("e", "Boutique Hotel Breda", "Breda", 7, 30, 15, 2, 2),
  mk("e", "Boutique Hotel Breda", "Breda", 12, 0, 20, 2, 2),
  mk("e", "Boutique Hotel Breda", "Breda", 18, 0, 22, 2, 2),
];

const availableChefs: AvailableChefRow[] = [
  { id: "1", fullName: "Jasper de Wit", city: "Amsterdam", skills: ["Allround", "Ontbijt"] },
  { id: "2", fullName: "Noor Bakker", city: "Amsterdam", skills: ["Allround", "Avond"] },
  { id: "3", fullName: "Milan Vermeer", city: "Rotterdam", skills: ["Allround"] },
  { id: "4", fullName: "Sofia Karim", city: "Den Haag", skills: ["Patisserie"] },
];
const chefNamesByShift: Record<string, string[]> = {
  s0: ["Marco Rossi", "Jelle Koster"],
  s2: ["Lars Hendriks", "Naomi Peters"],
  s3: ["Yassin El", "Tom Doorn"],
  s6: ["Kevin Roos"],
  s11: [],
};

const chefTableRows: ChefRow[] = [
  { id: "1", fullName: "Jasper de Wit", skills: ["Allround", "Ontbijt"], locatie: "Amsterdam", voorkeur: "Voorkeur dag" },
  { id: "2", fullName: "Noor Bakker", skills: ["Allround", "Avond"], locatie: "Amsterdam", voorkeur: "Avond" },
  { id: "3", fullName: "Milan Vermeer", skills: ["Allround"], locatie: "Rotterdam", voorkeur: "Dag" },
  { id: "4", fullName: "Sofia Karim", skills: ["Patisserie"], locatie: "Den Haag", voorkeur: "Avond" },
];

export default function Preview() {
  const vm = buildRosterView({ view: "day", dateKey: D, rows, availableChefs, now: NOW });
  const kpiTiles: KpiTile[] = vm.kpis.map((k) => ({ key: k.key, label: k.label, value: k.value, pct: k.pct, detail: k.detail, tone: k.tone, href: "#" }));

  const openRows: OpenDienstRow[] = [];
  for (const hotel of vm.dayHotels ?? []) {
    for (const s of hotel.shifts) {
      const tone = dayToneOf(s.fill.confirmed, s.fill.headcount);
      if (tone === "vol") continue;
      openRows.push({
        shiftId: s.row.id,
        hotel: hotel.companyName,
        start: `${new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.row.startsAt))} – ${new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.row.endsAt))}`,
        dienst: dienstLabel(s.row.startsAt),
        nodig: Math.max(0, s.fill.headcount - s.fill.confirmed),
        reden: tone === "leeg" ? "kritiek" : "open",
      });
    }
  }

  return (
    <div className="min-h-screen bg-bg-gray p-6">
      <div className="mx-auto max-w-6xl">
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Operations</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-3xl text-ink-900 md:text-4xl">Rooster</h1>
            <p className="mt-0.5 font-serif text-base text-ink-700">Donderdag 29 mei 2026</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-full border border-ink-200 bg-white">
              {["Dag", "Week", "Maand"].map((v, i) => (
                <span key={v} className={`px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${i === 0 ? "bg-burgundy text-white" : "text-ink-600"}`}>{v}</span>
              ))}
            </div>
            <span className="mx-0.5 hidden text-ink-200 sm:inline">|</span>
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700">←</span>
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-700">Vandaag</span>
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 font-ui text-[11px] text-ink-700">→</span>
            <span className="ml-1 flex items-center gap-1 rounded-full bg-burgundy px-3.5 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white">
              <Icon name="plus-circle" className="h-3.5 w-3.5" />
              Nieuwe shift
            </span>
          </div>
        </div>

        <RosterKpiStrip items={kpiTiles} />

        <div className="mt-4 space-y-4">
          <RosterDayTimeline hotels={vm.dayHotels ?? []} nowHour={11.4} chefNamesByShift={chefNamesByShift} />
          <div className="grid gap-4 lg:grid-cols-2">
            <OpenDienstenTable rows={openRows} total={openRows.length} />
            <BeschikbareChefsTable rows={chefTableRows} total={chefTableRows.length} />
          </div>
        </div>
      </div>
    </div>
  );
}
