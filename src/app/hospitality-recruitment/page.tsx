import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "hospitality-recruitment";
const TITLE = "Hospitality Recruitment Nederland";
const DESCRIPTION =
  "Hospitality recruitment Nederland. Werving en selectie voor hotels en restaurants. 20+ jaar netwerk, premium kandidaten.";

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
        heroImage: "/images/maarten-portrait.jpg",
        heroEyebrow: "Hospitality recruitment",
        title: "Hospitality Recruitment — Werving en Selectie voor Hotels en Restaurants",
        breadcrumbLabel: "Hospitality recruitment",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Hospitality recruitment voor vaste posities:</strong> werving en selectie voor hotels, restaurants en catering. Premium kandidaten uit ons 20+-jaar opgebouwde netwerk.` }} />
        ),
        body: (
          <>
            <h2>Voor welke rollen?</h2>
            <ul>
            <li>Executive chef, chef de cuisine, sous chef</li>
            <li>F&amp;B manager, general manager</li>
            <li>Specialisten — patissier, sommelier, banqueting manager</li>
            </ul>
            <h2>Onze aanpak</h2>
            <p>Vaak start een vaste positie met een tijdelijke payroll-inzet — zo kunnen beide partijen de match checken voordat er een lange verbintenis is. Daarna overname in vast dienstverband bij het hotel of restaurant.</p>
          </>
        ),
        
        pillarLink: (
          <>
                        <PayrollPillarLink />
          </>
        ),
      }}
    />
  );
}
