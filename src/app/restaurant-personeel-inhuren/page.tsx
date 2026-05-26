import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "restaurant-personeel-inhuren";
const TITLE = "Restaurant Personeel Inhuren";
const DESCRIPTION =
  "Restaurant personeel inhuren Amsterdam, 100% payroll. Koks, bediening en management, Wet DBA compliant, direct inzetbaar.";

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
        heroEyebrow: "Restaurant personeel",
        title: "Restaurant Personeel Inhuren Amsterdam — Compleet Team, In Loondienst",
        breadcrumbLabel: "Restaurant personeel inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Restaurant personeel inhuren:</strong> compleet team voor casual tot fine dining. Koks, bediening en management — allemaal in loondienst.` }} />
        ),
        body: (
          <>
            <h2>Welke restaurant-rollen?</h2>
            <ul>
            <li>Bediening — vanaf €28/uur</li>
            <li>Chef de partie — vanaf €38/uur</li>
            <li>Sous chef — vanaf €45/uur</li>
            <li>Chef de cuisine — vanaf €55/uur</li>
            </ul>
            <h2>Voor welke segmenten?</h2>
            <p>Van casual dining tot fine dining en Michelin-niveau. Voor de hogere segmenten werken wij met chefs uit ons premium-netwerk.</p>
          </>
        ),
        offers: [
          { name: "Bediening", pricePerHour: 28 },
          { name: "Chef de partie", pricePerHour: 38 },
          { name: "Sous chef", pricePerHour: 45 },
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
