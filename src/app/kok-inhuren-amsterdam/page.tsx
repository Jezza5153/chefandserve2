import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "kok-inhuren-amsterdam";
const TITLE = "Kok Inhuren Amsterdam — 100% Loondienst";
const DESCRIPTION =
  "Kok inhuren in Amsterdam in loondienst. 200+ gescreende koks via payroll, geen ZZP-risico. Levering binnen 24 uur mogelijk.";

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
        heroImage: "/images/chef-portrait.jpg",
        heroEyebrow: "Kok inhuren Amsterdam",
        title: "Kok Inhuren in Amsterdam — Direct Inzetbaar, In Loondienst",
        breadcrumbLabel: "Kok inhuren Amsterdam",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Kok inhuren in Amsterdam zonder ZZP-risico:</strong> 200+ professionele koks in actief netwerk, volledig in loondienst via payroll. Voor spoedopdrachten levering binnen 24 uur in Amsterdam en de Randstad.` }} />
        ),
        body: (
          <>
            <h2>Welke koks levert Chef &amp; Serve?</h2>
            <ul>
            <li><strong>Commis de cuisine</strong> — instapniveau, vakopleiding afgerond, HACCP</li>
            <li><strong>Chef de partie</strong> — postspecialist (saucier, entremetier, garde manger)</li>
            <li><strong>Zelfstandig werkend kok</strong> — ervaren, direct inzetbaar zonder begeleiding</li>
            <li><strong>Sous chef en hoger</strong> — voor leidinggevende rollen, zie <a href="/chef-inhuren/">chef inhuren</a></li>
            </ul>
            <h2>Tarieven kok inhuren Amsterdam (2026)</h2>
            <ul>
            <li>Commis de cuisine — vanaf €32 per uur all-in</li>
            <li>Chef de partie — vanaf €38 per uur all-in</li>
            <li>Zelfstandig werkend kok — vanaf €42 per uur all-in</li>
            </ul>
            <h2>Hoe snel kunnen wij leveren?</h2>
            <p>Voor spoedopdrachten in Amsterdam streven wij naar inzet binnen 24 uur. Met 200+ actieve koks in het netwerk is beschikbaarheid vrijwel altijd geregeld.</p>
          </>
        ),
        offers: [
          { name: "Commis de cuisine", pricePerHour: 32 },
          { name: "Chef de partie", pricePerHour: 38 },
          { name: "Zelfstandig werkend kok", pricePerHour: 42 },
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
