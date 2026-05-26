import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "horeca-uitzendbureau-amsterdam";
const TITLE = "Horeca Uitzendbureau Amsterdam — 100% Payroll";
const DESCRIPTION =
  "Horeca uitzendbureau Amsterdam, 100% payroll. Netwerk van 200+ koks, chefs en bediening. Geen ZZP-risico. Direct inzetbaar.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/${SLUG}/` },
};

export default function Page() {
  return (
    <ServicePage
      data={{
        slug: SLUG,
        heroImage: "/images/restaurant-interior.jpg",
        heroEyebrow: "Horeca uitzendbureau",
        title: "Horeca Uitzendbureau Amsterdam — Premium, 100% Loondienst",
        breadcrumbLabel: "Horeca uitzendbureau Amsterdam",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Horeca uitzendbureau Amsterdam:</strong> premium uitzendbureau dat uitsluitend met loondienst werkt. 200+ pros in netwerk, persoonlijke matching, Wet DBA 2026 compliant.` }} />
        ),
        body: (
          <>
            <h2>Wat maakt Chef &amp; Serve een ander horeca uitzendbureau?</h2>
            <ol>
            <li><strong>100% payroll</strong> — geen ZZP-constructies, geen Wet DBA-risico</li>
            <li><strong>Oprichter Maarten Hogeveen</strong> — 20+ jaar Amsterdamse topkeuken-ervaring</li>
            <li><strong>Persoonlijke matching</strong> — geen anoniem platform, elke plaatsing handmatig beoordeeld</li>
            <li><strong>Premium niveau</strong> — voor 4- en 5-sterren hotels en fine-dining restaurants</li>
            </ol>
            <h2>Hoe werkt het juridisch?</h2>
            <p>Alle medewerkers zijn bij Chef &amp; Serve in loondienst. Wij dragen loonheffing, sociale lasten, vakantiegeld en ziekte af. U factureert een all-in uurtarief. Geen Wet DBA-risico, geen naheffingen.</p>
            <h2>Beide modellen mogelijk</h2>
            <p>Flexibele payroll-inzet (losse diensten tot seizoenen) én werving en selectie voor vaste posities — zie <a href="/hospitality-recruitment/">hospitality recruitment</a>.</p>
          </>
        ),
        offers: [
          { name: "Horeca personeel all-in", pricePerHour: 28 },
        ],
        pillarLink: (
          <>
                        <HotelPillarLink />
            <PayrollPillarLink />
          </>
        ),
      }}
    />
  );
}
