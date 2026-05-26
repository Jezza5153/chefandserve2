import type { Metadata } from "next";
import {
  ServicePage,
  HotelPillarLink,
  PayrollPillarLink,
} from "@/components/ServicePage";

const SLUG = "hotel-personeel-inhuren";
const TITLE = "Hotel Personeel Inhuren Amsterdam";
const DESCRIPTION =
  "Hotel personeel inhuren Amsterdam, 100% loondienst. Banqueting, breakfast, F&B, front office. Geen ZZP-risico, compliant.";

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
        title: "Hotel Personeel Inhuren in Amsterdam — Hospitality Staffing voor Hotels",
        breadcrumbLabel: "Hotel personeel inhuren",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Hotel personeel inhuren in Amsterdam:</strong> gespecialiseerd in 4- en 5-sterren hotels. Banqueting chefs, breakfast koks, roomservice, F&amp;B en front office — allemaal via 100% payroll, Wet DBA 2026 compliant.` }} />
        ),
        body: (
          <>
            <h2>Welk hotelpersoneel levert Chef &amp; Serve?</h2>
            <ul>
            <li><strong>Keuken (F&amp;B)</strong> — banqueting chef, breakfast chef, roomservice kok, à la carte koks van commis tot executive chef</li>
            <li><strong>Bediening</strong> — restaurant service, banqueting service, hosts en hostesses</li>
            <li><strong>Front office</strong> — receptionisten, concierge (op aanvraag)</li>
            <li><strong>Housekeeping</strong> — specialisten op aanvraag</li>
            </ul>
            <h2>Specifieke ervaring voor hotels</h2>
            <p>Onze premium-pool is geselecteerd op ervaring met internationale hotels, banqueting voor grote volumes, en service-standaarden passend bij hotels in het hogere segment. Wij ondersteunen 24/7-hotelrotaties: ontbijtbrigade, lunchteam, dinerservice en roomservice.</p>
            <h2>Tarieven hotelpersoneel</h2>
            <ul>
            <li>Breakfast chef — vanaf €32 per uur</li>
            <li>Banqueting chef — vanaf €38 per uur</li>
            <li>Bediening — vanaf €28 per uur</li>
            <li>Executive chef — op aanvraag</li>
            </ul>
          </>
        ),
        offers: [
          { name: "Breakfast chef", pricePerHour: 32 },
          { name: "Banqueting chef", pricePerHour: 38 },
          { name: "Executive chef (op aanvraag)" },
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
