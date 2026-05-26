import type { Metadata } from "next";
import {
  ServicePage,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "horeca-freelancer";
const TITLE = "Horeca Freelancer Alternatief — Payroll";
const DESCRIPTION =
  "Horeca freelancer alternatief: 100% payroll via Chef & Serve. Zelfde flexibiliteit, geen ZZP-risico. Compliant met Wet DBA 2026.";

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
        heroEyebrow: "Horeca-pro op aanvraag",
        title: "Horeca Freelancer Alternatief — 100% Payroll Compliant",
        breadcrumbLabel: "Horeca freelancer",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Op zoek naar een compliant alternatief voor een horeca freelancer?</strong> Sinds 2025 handhaaft de Belastingdienst weer actief op schijnzelfstandigheid. Onze payroll-route biedt zelfde flexibiliteit zonder juridisch risico.` }} />
        ),
        body: (
          <>
            <h2>Waarom geen ZZP/freelance meer voor uw horecaopdracht?</h2>
            <p>Een freelancer die op uw rooster staat, in uw keuken werkt, met uw planning en standaarden — dat is juridisch geen zelfstandige, ongeacht wat de overeenkomst zegt. Risico: naheffing + boete + werknemersclaim.</p>
            <h2>Payroll-alternatief</h2>
            <p>Chef &amp; Serve is de juridische werkgever. Zelfde flexibiliteit als freelance (losse diensten, week, seizoen), zonder het risico. Tarieven all-in.</p>
            <h2>Voor wie?</h2>
            <ul>
            <li>Restaurants die nu met ZZP-koks werken en willen overstappen</li>
            <li>Hotels met fluctuerende bezetting</li>
            <li>Cateringbedrijven met event-pieken</li>
            </ul>
          </>
        ),
        offers: [
          { name: "Horeca flex-kracht", pricePerHour: 28 },
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
