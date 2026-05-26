import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
} from "@/components/ServicePage";

const SLUG = "premium-kok-inhuren-hotel-restaurant";
const TITLE = "Premium Kok Inhuren voor Hotel of Restaurant";
const DESCRIPTION =
  "Premium kok inhuren voor hotel of restaurant. 100% payroll, 20+ jaar Amsterdams topniveau ervaring. Geen ZZP-risico.";

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
        title: "Premium Kok Inhuren voor Hotel of Restaurant",
        breadcrumbLabel: "Premium kok inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Premium kok inhuren voor uw hotel of fine-dining restaurant:</strong> 10+ jaar ervaring vereist, references uit topkeukens, beheersing van complexe bereidingen. Elke premium-match persoonlijk beoordeeld.` }} />
        ),
        body: (
          <>
            <h2>Wat maakt een &quot;premium&quot; kok?</h2>
            <p>Premium betekent: minimaal 10 jaar ervaring in fine dining of 4-/5-sterrenhotels, referenties uit topkeukens, aantoonbare beheersing van complexe bereidingen en servicestandaarden.</p>
            <h2>Tarieven premium koks</h2>
            <ul>
            <li>Sous chef premium — vanaf €45 per uur</li>
            <li>Chef de cuisine — vanaf €55 per uur</li>
            <li>Executive chef — op aanvraag (afhankelijk van hotel-segment)</li>
            </ul>
            <h2>Michelin-niveau beschikbaar</h2>
            <p>Oprichter Maarten Hogeveen heeft 20+ jaar Amsterdamse topkeuken-ervaring (Lute, Vijff Vlieghen, Mario, Chefstable). Ons premium-netwerk komt uit exact die sector.</p>
            <h2>Interim posities</h2>
            <p>Interim executive chef en chef de cuisine voor hotels in transitieperiodes of fine-dining restaurants tussen chefs door — vanaf 2-4 weken.</p>
          </>
        ),
        offers: [
          { name: "Sous chef", pricePerHour: 45 },
          { name: "Chef de cuisine", pricePerHour: 55 },
          { name: "Executive chef (op aanvraag)" },
        ],
        pillarLink: (
          <>
                        <HotelPillarLink />
          </>
        ),
      }}
    />
  );
}
