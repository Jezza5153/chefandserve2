import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "keuken-personeel-inhuren";
const TITLE = "Keuken Personeel Inhuren";
const DESCRIPTION =
  "Keuken personeel inhuren in loondienst. Commis, chef de partie, sous chef, patissier. Payroll-only, geen ZZP-risico.";

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
        title: "Keuken Personeel Inhuren Amsterdam — Volledig in Loondienst",
        breadcrumbLabel: "Keuken personeel inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Keuken personeel inhuren:</strong> commis, chef de partie, sous chef, afwashulp, patissier — allemaal in loondienst.` }} />
        ),
        body: (
          <>
            <h2>Welke keukenrollen?</h2>
            <ul>
            <li>Afwashulp — vanaf €22/uur</li>
            <li>Commis de cuisine — vanaf €32/uur</li>
            <li>Chef de partie — vanaf €38/uur</li>
            <li>Patissier — vanaf €38/uur</li>
            <li>Sous chef en hoger — zie <a href="/chef-inhuren/">chef inhuren</a></li>
            </ul>
          </>
        ),
        offers: [
          { name: "Afwashulp", pricePerHour: 22 },
          { name: "Commis de cuisine", pricePerHour: 32 },
          { name: "Chef de partie", pricePerHour: 38 },
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
