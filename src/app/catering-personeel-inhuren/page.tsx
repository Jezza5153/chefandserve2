import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "catering-personeel-inhuren";
const TITLE = "Catering Personeel Inhuren";
const DESCRIPTION =
  "Catering personeel inhuren in loondienst. Compleet cateringteam via payroll, Wet DBA compliant. Voor bruiloften en events.";

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
        heroEyebrow: "Catering personeel",
        title: "Catering Personeel Inhuren — Volledige Brigades in Loondienst",
        breadcrumbLabel: "Catering personeel inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Catering personeel inhuren:</strong> complete brigades voor bruiloften, corporate events en festivals. Alles via payroll, alles compliant.` }} />
        ),
        body: (
          <>
            <h2>Wat leveren wij voor catering?</h2>
            <ul>
            <li><strong>Catering bediening</strong> — vanaf €28 per uur</li>
            <li><strong>Catering kok</strong> — vanaf €34 per uur</li>
            <li><strong>Banqueting chef</strong> — vanaf €38 per uur</li>
            <li><strong>Event coördinator</strong> — op aanvraag</li>
            </ul>
            <h2>Type events</h2>
            <p>Bruiloften, corporate events, festivals, private parties, bedrijfsrestaurants, bankcatering, inflight catering.</p>
          </>
        ),
        offers: [
          { name: "Catering bediening", pricePerHour: 28 },
          { name: "Catering kok", pricePerHour: 34 },
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
