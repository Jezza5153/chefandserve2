import { MAARTEN_PHONE } from "@/lib/cancellation-severity";

/**
 * CHEF-PR7 (R2#22) — contextual Help / FAQ. A tiny, embeddable "Veelgestelde
 * vragen" block (not a top-level tab) answering the repeat operational questions,
 * with "Bel Maarten" always one tap away. Server component; pure content, no flag.
 * `topics` lets a surface show only the relevant subset (e.g. money page → money Qs).
 */
type FaqItem = { q: string; a: string; topic: "shift" | "geld" | "algemeen" };

const FAQ: FaqItem[] = [
  {
    topic: "shift",
    q: "Hoe dien ik mijn uren in?",
    a: "Na je shift: ga naar Uren, open de dienst en vul je start- en eindtijd + pauze in. De klant tekent, daarna keurt het kantoor goed.",
  },
  {
    topic: "shift",
    q: "Ik ben ziek of kan niet komen — wat nu?",
    a: "Geef het zo snel mogelijk door: open de shift en gebruik 'Shift annuleren' met een reden. Is het vlak voor de shift? Bel Maarten direct.",
  },
  {
    topic: "shift",
    q: "Ik kon geen pauze nemen of werk langer door — moet ik iets doen?",
    a: "Ja, tik tijdens je shift op 'Ik werk langer door' of 'Geen pauze mogelijk' op het shift-scherm. Zo weet het kantoor het op tijd voor de uitbetaling.",
  },
  {
    topic: "shift",
    q: "Ik sta op locatie maar kan niet beginnen — wat doe ik?",
    a: "Gebruik 'Ik ben er, maar kan niet starten' op het shift-scherm (contactpersoon afwezig, ingang dicht, enz.). Maarten krijgt direct bericht.",
  },
  {
    topic: "geld",
    q: "Wanneer word ik betaald?",
    a: "Je ziet de status van elke dienst onder Geld → 'Wanneer word ik betaald?'. Zodra de klant tekent en het kantoor goedkeurt, gaat het mee in de eerstvolgende payroll-run.",
  },
  {
    topic: "geld",
    q: "Hoe vraag ik mijn vakantiegeld of onkosten aan?",
    a: "Onder Declaraties kun je je vakantiegeld laten uitbetalen of kosten (reiskosten, parkeren) declareren — met een bon erbij. Het kantoor beoordeelt het.",
  },
  {
    topic: "algemeen",
    q: "Wie bel ik bij een probleem?",
    a: `Bel of app Maarten op ${MAARTEN_PHONE}. Voel je je niet veilig of niet correct behandeld? Gebruik die knop op het shift-scherm — dat komt meteen binnen.`,
  },
];

export function ChefHelp({
  topics,
  title = "Veelgestelde vragen",
}: {
  topics?: Array<"shift" | "geld" | "algemeen">;
  title?: string;
}) {
  const items = topics ? FAQ.filter((f) => topics.includes(f.topic)) : FAQ;
  if (items.length === 0) return null;

  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-5">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{title}</p>
      <div className="mt-3 divide-y divide-ink-100">
        {items.map((f) => (
          <details key={f.q} className="group py-2">
            <summary className="cursor-pointer list-none text-sm font-medium text-ink-900 marker:hidden">
              <span className="mr-1 text-ink-400 group-open:hidden">▸</span>
              <span className="mr-1 hidden text-ink-400 group-open:inline">▾</span>
              {f.q}
            </summary>
            <p className="mt-1.5 pl-4 text-sm leading-relaxed text-ink-700">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-600">
        Er niet uit?{" "}
        <a href={`tel:${MAARTEN_PHONE}`} className="font-medium text-burgundy hover:underline">
          Bel Maarten · {MAARTEN_PHONE}
        </a>
      </p>
    </section>
  );
}
