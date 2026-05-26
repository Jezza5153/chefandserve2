import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "tijdelijk-horeca-personeel";
const TITLE = "Tijdelijk Horeca Personeel";
const DESCRIPTION =
  "Tijdelijk horeca personeel in loondienst. Flexibele inzet zonder ZZP-risico, Wet DBA 2026 compliant. Spoedklus of seizoen.";

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
        heroImage: "/images/service-chefs.jpg",
        heroEyebrow: "Tijdelijk horeca personeel",
        title: "Tijdelijk Horeca Personeel Inhuren — Flexibel, In Loondienst",
        breadcrumbLabel: "Tijdelijk horeca personeel",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Tijdelijk horeca personeel inhuren:</strong> flexibele inzet zonder ZZP-risico. Voor spoedklussen, piekperiodes en seizoensdrukte. Vanaf 4 uur per dienst.` }} />
        ),
        body: (
          <>
            <h2>Minimum opdrachtduur</h2>
            <p>Minimum 4 uur per dienst. Losse diensten (spoedvervanging, weekend piek), weekinzet, seizoenen — alles mogelijk.</p>
            <h2>Hoe snel beschikbaar?</h2>
            <p>Voor spoedklussen in Amsterdam binnen 24 uur. Voor geplande piekperiodes raden wij 2-3 weken vooruitplanning aan voor maximale keuze.</p>
            <h2>Tarieven</h2>
            <ul>
            <li>Bediening — vanaf €28 per uur</li>
            <li>Keuken — vanaf €32 per uur</li>
            </ul>
            <p>Spoedklussen (&lt;24 uur) en nacht-/weekenddiensten kennen een toeslag conform horeca-cao.</p>
          </>
        ),
        offers: [
          { name: "Bediening", pricePerHour: 28 },
          { name: "Keuken", pricePerHour: 32 },
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
