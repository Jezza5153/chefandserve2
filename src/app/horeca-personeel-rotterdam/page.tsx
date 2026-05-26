import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "horeca-personeel-rotterdam";
const TITLE = "Horeca Personeel Rotterdam";
const DESCRIPTION =
  "Horeca personeel Rotterdam, 100% payroll. Netwerk van 200+ pros in loondienst. Wet DBA 2026 compliant, 24-uurs levering.";

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
        heroEyebrow: "Horeca personeel — Rotterdam",
        title: "Horeca Personeel Rotterdam — Premium koks en bediening",
        breadcrumbLabel: "Horeca personeel Rotterdam",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Horeca personeel inhuren in Rotterdam:</strong> Chef &amp; Serve breidt haar premium dienstverlening uit naar de Maasstad. Dezelfde kwaliteit die ons het vertrouwen van Amsterdamse tophotels gaf.` }} />
        ),
        body: (
          <>
            <h2>Welk personeel voor Rotterdam?</h2>
            <ul>
            <li>Bediening — vanaf €28/uur</li>
            <li>Chef de partie — vanaf €38/uur</li>
            <li>Sous chef en hoger — zie <a href="/chef-inhuren/">chef inhuren</a></li>
            </ul>
            <h2>Rotterdam focus</h2>
            <p>Specifieke ervaring met Rotterdam: haven-restaurants, hotels Wilhelminapier, fine dining op de Erasmusbrug, banqueting in Kop van Zuid.</p>
            <h2>Ook regio Den Haag?</h2>
            <p>Ja — wij leveren ook <a href="/horeca-personeel-den-haag/">horeca personeel in Den Haag</a> voor de Haagse hospitality-sector.</p>
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
