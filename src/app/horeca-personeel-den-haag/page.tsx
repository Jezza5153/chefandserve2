import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "horeca-personeel-den-haag";
const TITLE = "Horeca Personeel Den Haag";
const DESCRIPTION =
  "Horeca personeel Den Haag, 100% loondienst. 200+ koks, chefs en bediening via payroll. Geen ZZP-risico, direct inzetbaar.";

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
        heroEyebrow: "Horeca personeel — Den Haag",
        title: "Horeca Personeel Den Haag — 100% Loondienst",
        breadcrumbLabel: "Horeca personeel Den Haag",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Horeca personeel inhuren in Den Haag:</strong> Chef &amp; Serve breidt premium hospitality-staffing uit naar de Haagse hospitality-sector — van ambassaderesidenties tot strandpaviljoens.` }} />
        ),
        body: (
          <>
            <h2>Welk personeel voor Den Haag?</h2>
            <ul>
            <li>Bediening — vanaf €28/uur</li>
            <li>Chef de partie — vanaf €38/uur</li>
            <li>Sous chef en hoger — zie <a href="/chef-inhuren/">chef inhuren</a></li>
            </ul>
            <h2>Den Haag focus</h2>
            <p>Specifieke ervaring met Haagse hospitality: ambassaderesidenties, strandpaviljoens (Scheveningen), 4-sterren hotels, fine-dining restaurants.</p>
            <h2>Ook regio Rotterdam?</h2>
            <p>Ja — zoekt u <a href="/horeca-personeel-rotterdam/">horeca personeel in Rotterdam</a>? Dezelfde payroll-structuur, dezelfde kwaliteit.</p>
          </>
        ),
        offers: [
          { name: "Bediening", pricePerHour: 28 },
          { name: "Chef de partie", pricePerHour: 38 },
        ],
        pillarLink: (
          <>
                        <PayrollPillarLink />
          </>
        ),
      }}
    />
  );
}
