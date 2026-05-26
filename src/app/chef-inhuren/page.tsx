import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "chef-inhuren";
const TITLE = "Chef Inhuren — Ervaren chefs in loondienst";
const DESCRIPTION =
  "Chef inhuren in loondienst. Ervaren chefs en sous chefs, 100% payroll, Wet DBA 2026 compliant. 20+ jaar Amsterdamse topkeukens.";

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
        title: "Chef Inhuren in Amsterdam — 100% Loondienst, Geen ZZP-risico",
        breadcrumbLabel: "Chef inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Chef inhuren in Amsterdam zonder ZZP-risico:</strong> Chef &amp; Serve levert ervaren chefs en sous chefs volledig in loondienst. Oprichter Maarten Hogeveen heeft 20+ jaar gewerkt in Amsterdamse topkeukens — wij weten welke chef past in welk type keuken.` }} />
        ),
        body: (
          <>
            <h2>Welke chef-niveaus levert Chef &amp; Serve?</h2>
            <p>Het volledige keukenspectrum: <strong>commis de cuisine, chef de partie, sous chef, chef de cuisine, executive chef</strong>, plus specialismen zoals <strong>patissier, banqueting chef, breakfast chef en roomservice kok</strong>.</p>
            <h2>Wat kost een chef inhuren per uur?</h2>
            <ul>
            <li>Chef de partie — vanaf €38 per uur all-in</li>
            <li>Sous chef — vanaf €45 per uur all-in</li>
            <li>Chef de cuisine — vanaf €55 per uur all-in</li>
            <li>Executive chef — op aanvraag</li>
            </ul>
            <p>All-in tarieven inclusief loonheffing, sociale lasten, vakantiegeld en ziekterisico. Geen verborgen werkgeverslasten.</p>
            <h2>Waarom payroll en geen ZZP?</h2>
            <p>Sinds januari 2025 handhaaft de Belastingdienst weer actief op schijnzelfstandigheid. Voor een chef die op uw rooster staat, in uw keuken, met uw planning — is een ZZP-constructie juridisch praktisch niet meer houdbaar. Payroll neemt het risico volledig over.</p>
          </>
        ),
        offers: [
          { name: "Chef de partie", pricePerHour: 38 },
          { name: "Sous chef", pricePerHour: 45 },
          { name: "Chef de cuisine", pricePerHour: 55 },
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
