import type { Metadata } from "next";
import {
  ServicePage,
} from "@/components/ServicePage";

const SLUG = "werken-als-chef-kok-tophotels-restaurants";
const TITLE = "Werken als Chef-kok in Tophotels en Restaurants";
const DESCRIPTION =
  "Werken als chef-kok in Amsterdam? Chef & Serve plaatst bij tophotels en fine-dining restaurants. Loondienst-zekerheid, persoonlijke matching.";

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
        heroEyebrow: "Werken als chef-kok",
        title: "Werken als Chef-kok bij Tophotels en Restaurants in Amsterdam",
        breadcrumbLabel: "Werken als chef-kok",
        description: DESCRIPTION,
        intro: (
          <p dangerouslySetInnerHTML={{ __html: `<strong>Werken als chef-kok bij Amsterdamse tophotels en restaurants:</strong> Chef &amp; Serve plaatst gescreende chefs bij premium opdrachtgevers. Loondienst-zekerheid, geen ZZP-onzekerheid, persoonlijke matching door ervaren chef-eigenaar.` }} />
        ),
        body: (
          <>
            <h2>Wat bieden wij chefs?</h2>
            <ul>
            <li><strong>Loondienst-zekerheid</strong> — vakantiegeld, pensioenopbouw, ziekterisico afgedekt</li>
            <li><strong>Premium opdrachten</strong> — Amsterdamse tophotels en fine-dining</li>
            <li><strong>Flexibele inzet</strong> — kies opdrachten die bij u passen</li>
            <li><strong>Persoonlijke matching</strong> — geen anoniem platform, Maarten kent zijn chefs</li>
            </ul>
            <h2>Hoe meld ik mij aan?</h2>
            <p>Stuur uw CV naar <a href="mailto:info@chefandserve.nl">info@chefandserve.nl</a> of bel direct. Wij plannen een persoonlijk kennismakingsgesprek.</p>
          </>
        ),
        
        
      }}
    />
  );
}
