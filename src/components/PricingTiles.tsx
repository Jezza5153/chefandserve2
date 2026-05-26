import { SectionLabel } from "@/components/PageHero";

export type ServiceOffer = {
  name: string;
  pricePerHour?: number;
};

/**
 * Visual pricing tiles for service pages. Renders below the body text
 * when `offers` are provided in the ServicePage data.
 *
 * Each tile: role name in Prata + price in burgundy + "all-in" note.
 */
export function PricingTiles({ offers }: { offers: ServiceOffer[] }) {
  if (!offers || offers.length === 0) return null;

  return (
    <section className="bg-bg-gray py-20 md:py-28">
      <div className="mx-auto max-w-container px-4">
        <div className="mb-12 text-center">
          <SectionLabel>Transparante tarieven</SectionLabel>
          <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
            All-in, inclusief loonheffing
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-ink-700">
            Onze tarieven omvatten loonheffing, sociale lasten, vakantiegeld en
            ziekterisico. Geen ZZP-administratie, geen verborgen kosten.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2 lg:grid-cols-3">
          {offers.map((o) => (
            <div
              key={o.name}
              className="group rounded border border-gray-200 bg-white p-8 transition-shadow hover:shadow-lg"
            >
              <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
                Rol
              </p>
              <h3 className="mt-2 font-serif text-xl text-ink-900 md:text-2xl">
                {o.name}
              </h3>
              {o.pricePerHour && (
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-serif text-3xl text-burgundy md:text-4xl">
                    €{o.pricePerHour}
                  </span>
                  <span className="font-ui text-sm text-ink-700">/uur</span>
                </div>
              )}
              <p className="mt-2 text-xs text-ink-500">all-in payroll-tarief</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
