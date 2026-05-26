import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
} from "@/components/ServicePage";

const SLUG = "bediening-inhuren";
const TITLE = "Bediening Inhuren Amsterdam — Loondienst";
const DESCRIPTION =
  "Bediening inhuren Amsterdam in loondienst. Gekwalificeerde hosts/hostesses, 100% payroll, geen ZZP-risico. Direct beschikbaar.";

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
        title: "Bediening Inhuren in Amsterdam — Gekwalificeerd, In Loondienst",
        breadcrumbLabel: "Bediening inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Bediening inhuren in Amsterdam:</strong> gekwalificeerde bedieningsmedewerkers in loondienst. Voor restaurants, hotels en events. Geen ZZP-constructies, alles compliant.` }} />
        ),
        body: (
          <>
            <h2>Welke bedieningsrollen?</h2>
            <ul>
            <li><strong>Bediening runner</strong> — vanaf €26 per uur</li>
            <li><strong>Ervaren bediening</strong> — vanaf €28 per uur</li>
            <li><strong>Host / hostess</strong> — vanaf €30 per uur</li>
            </ul>
            <p>All-in tarieven, inclusief alle werkgeverslasten.</p>
            <h2>Kwalificaties</h2>
            <p>Minimaal SVH-niveau-2 (sociale hygiëne), ervaring met à la carte service, HACCP-kennis, en waar van toepassing SVA-certificaat voor alcohol-schenkwetgeving.</p>
            <h2>Talen</h2>
            <p>Een substantieel deel van ons netwerk werkt tweetalig Nederlands-Engels, passend bij internationale hotels en fine-dining restaurants.</p>
          </>
        ),
        offers: [
          { name: "Bediening runner", pricePerHour: 26 },
          { name: "Ervaren bediening", pricePerHour: 28 },
          { name: "Host / hostess", pricePerHour: 30 },
        ],
        pillarLink: (
          <>
                        <HotelPillarLink />
          </>
        ),
      }}
    />
  );
}
