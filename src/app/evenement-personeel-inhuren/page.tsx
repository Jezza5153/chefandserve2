import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "evenement-personeel-inhuren";
const TITLE = "Evenement Personeel Inhuren";
const DESCRIPTION =
  "Evenement personeel inhuren in loondienst. 200+ event-pros, 100% payroll, geen ZZP-risico. Festivals, corporate events, private.";

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
        heroImage: "/images/catering-event.jpg",
        heroEyebrow: "Evenement personeel",
        title: "Evenement Personeel Inhuren — Voor Festivals, Corporate en Private Events",
        breadcrumbLabel: "Evenement personeel inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Evenement personeel inhuren:</strong> event-brigades voor festivals, corporate events en private parties. Flexibele inzet, alles compliant.` }} />
        ),
        body: (
          <>
            <h2>Wat leveren wij voor events?</h2>
            <ul>
            <li><strong>Event host</strong> — vanaf €30 per uur</li>
            <li><strong>Event kok</strong> — vanaf €34 per uur</li>
            <li><strong>Brigade-coördinatie</strong> — op aanvraag</li>
            </ul>
            <h2>Schaal</h2>
            <p>Van kleine private dinners (10-30 gasten) tot festivals (1000+). Voor grote events leveren wij complete brigades inclusief management.</p>
          </>
        ),
        offers: [
          { name: "Event host", pricePerHour: 30 },
          { name: "Event kok", pricePerHour: 34 },
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
