/**
 * Payroll vs ZZP vs Uitzendbureau vs Vast — comparison table.
 * Used on both pillar pages. Burgundy header, alternating row backgrounds.
 */

type Row = {
  model: string;
  flexibility: string;
  risk: string;
  bestFor: string;
  highlight?: boolean;
};

export function ComparisonTable({ rows }: { rows: Row[] }) {
  return (
    <div className="my-8 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm md:text-base">
        <thead>
          <tr className="bg-burgundy text-white">
            <th className="border border-burgundy px-3 py-3 font-medium md:px-4">Model</th>
            <th className="border border-burgundy px-3 py-3 font-medium md:px-4">
              Flexibiliteit
            </th>
            <th className="border border-burgundy px-3 py-3 font-medium md:px-4">
              Juridisch risico
            </th>
            <th className="border border-burgundy px-3 py-3 font-medium md:px-4">
              Beste inzetbaar voor
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.model}
              className={`${
                row.highlight
                  ? "bg-burgundy-50 font-medium"
                  : i % 2 === 0
                    ? "bg-white"
                    : "bg-bg-gray"
              }`}
            >
              <td className="border border-gray-200 px-3 py-3 md:px-4">
                <strong>{row.model}</strong>
              </td>
              <td className="border border-gray-200 px-3 py-3 md:px-4">{row.flexibility}</td>
              <td className="border border-gray-200 px-3 py-3 md:px-4">{row.risk}</td>
              <td className="border border-gray-200 px-3 py-3 md:px-4">{row.bestFor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Standard 4-row comparison used on both pillar pages.
 * Same data as old WP site.
 */
export const standardComparisonRows: Row[] = [
  {
    model: "Payroll (Chef & Serve)",
    flexibility: "Hoog — per dienst, week of seizoen",
    risk: "Geen — wij dragen het",
    bestFor:
      "Standaard horecapersoneel, flexibele roosters, spoed, seizoenspieken",
    highlight: true,
  },
  {
    model: "ZZP / freelance kok",
    flexibility: "Hoog in theorie",
    risk: "Hoog — naheffing + boete + werknemersclaim",
    bestFor:
      "Alleen echt projectmatige, afgebakende opdrachten met aantoonbaar zelfstandige ondernemer",
  },
  {
    model: "Uitzendbureau (klassiek)",
    flexibility: "Hoog",
    risk: "Laag (mits SNA-gecertificeerd)",
    bestFor: "Vergelijkbaar met payroll, soms goedkoper, kwalitatief wisselend",
  },
  {
    model: "Vast dienstverband",
    flexibility: "Laag",
    risk: "Geen",
    bestFor: "Kernbezetting die u lang wilt houden en ontwikkelen",
  },
];
