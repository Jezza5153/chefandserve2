import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FAQAccordion } from "@/components/FAQAccordion";
import { JsonLd } from "@/components/JsonLd";
import { homepageFaqs } from "@/lib/faqs";
import {
  breadcrumbNode,
  buildGraph,
  faqPageNode,
  webpageNode,
} from "@/lib/schema";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
  description:
    "100% loondienst horeca uitzendbureau Amsterdam. 200+ koks en chefs in netwerk, geen ZZP-risico, Wet DBA 2026 compliant. Binnen 24 uur inzetbaar.",
  alternates: { canonical: "/" },
};

const serviceTiles = [
  {
    title: "Chefs op aanvraag",
    body:
      "Of je nu een chef-kok nodig hebt voor een exclusief evenement of een sous-chef die je keukenbrigade versterkt, wij leveren de professional die naadloos aansluit bij jouw keuken. In vakmanschap, werkhouding én uitstraling.",
    image: "/images/service-chefs.jpg",
    href: "/chef-inhuren/",
  },
  {
    title: "Werving & selectie",
    body:
      "Wij verbinden ambitieuze horecaprofessionals met toonaangevende locaties voor vaste of parttime functies. Altijd met persoonlijke begeleiding en oog voor de juiste match.",
    image: "/images/service-werving.jpg",
    href: "/hospitality-recruitment/",
  },
  {
    title: "Teamoplossingen",
    body:
      "Van privé-dinerevenementen tot seizoenspieken, wij stellen complete serviceteams samen van chefs, hosts en bedieningsmedewerkers die naadloos samenwerken om het hoogste niveau van hospitaliteit te waarborgen.",
    image: "/images/service-teams.jpg",
    href: "/catering-personeel-inhuren/",
  },
] as const;

const offerLinks = [
  { label: "Horeca personeel inhuren", href: "/horeca-personeel-inhuren/" },
  { label: "Horeca freelancer", href: "/horeca-freelancer/" },
  { label: "Chef inhuren", href: "/chef-inhuren/" },
  { label: "Keuken personeel inhuren", href: "/keuken-personeel-inhuren/" },
  { label: "Restaurant personeel inhuren", href: "/restaurant-personeel-inhuren/" },
  { label: "Hotel personeel inhuren", href: "/hotel-personeel-inhuren/" },
  { label: "Catering personeel inhuren", href: "/catering-personeel-inhuren/" },
  { label: "Evenementen personeel inhuren", href: "/evenement-personeel-inhuren/" },
  { label: "Bediening inhuren", href: "/bediening-inhuren/" },
  { label: "Kok inhuren in Amsterdam", href: "/kok-inhuren-amsterdam/" },
] as const;

const processSteps = [
  {
    n: "01",
    title: "Briefing",
    body:
      "Stuur ons rol, periode, segment en eventuele bijzonderheden — mail, telefoon of formulier.",
  },
  {
    n: "02",
    title: "Persoonlijke match",
    body:
      "Wij selecteren handmatig uit ons netwerk van 200+ pros — geen algoritme, wel vakmanschap.",
  },
  {
    n: "03",
    title: "Bevestiging",
    body: "Binnen 4-24 uur weet u wie er komt, wanneer en onder welke voorwaarden.",
  },
  {
    n: "04",
    title: "Inzet & vangnet",
    body:
      "Wij blijven juridisch werkgever. Bij ziekte of uitval lossen wij het op — niet u.",
  },
] as const;

export default function HomePage() {
  const url = `${site.url}/`;
  const pageGraph = buildGraph(
    webpageNode({
      url,
      name: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
      description: site.description,
    }),
    breadcrumbNode([{ name: site.name, url }]),
    faqPageNode({ url, faqs: homepageFaqs }),
  );

  return (
    <>
      <JsonLd data={pageGraph} />

      {/* ============ HERO — full-bleed video ============ */}
      <section className="relative h-[78vh] min-h-[560px] w-full overflow-hidden bg-ink-900 text-white">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src="/images/hero-video.mp4"
          poster="/images/hero-poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/70" />

        <div className="relative z-10 mx-auto flex h-full max-w-container flex-col items-start justify-end px-4 pb-16 md:pb-24">
          <p className="mb-4 font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
            Premium hospitality staffing — Amsterdam
          </p>
          <h1 className="max-w-4xl font-serif text-4xl leading-[1.1] text-white md:text-6xl lg:text-[72px]">
            Serving the people,
            <br />
            making the moment.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
            200+ gescreende koks en chefs in actief netwerk. 100% loondienst,
            geen ZZP-risico, Wet DBA 2026 compliant. Binnen 24 uur inzetbaar in
            Amsterdam en de Randstad.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/contact-us/"
              className="rounded-full bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:bg-cream"
            >
              Plan een gesprek
            </Link>
            <Link
              href="/our-offer/"
              className="rounded-full border border-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-white hover:text-ink-900"
            >
              Bekijk ons aanbod
            </Link>
          </div>
        </div>
      </section>

      {/* ============ Burgundy band — tagline ============ */}
      <section className="bg-burgundy py-12 text-white md:py-16">
        <div className="mx-auto max-w-container px-4 text-center">
          <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
            Onze belofte
          </p>
          <h2 className="mx-auto mt-3 max-w-3xl font-serif text-2xl leading-snug text-white md:text-4xl">
            100% loondienst. Persoonlijke match. Premium kwaliteit. Geen
            ZZP-risico.
          </h2>
        </div>
      </section>

      {/* ============ Two doorways — full-bleed photos ============ */}
      <section className="grid grid-cols-1 md:grid-cols-2">
        <Link
          href="/contact-us/"
          className="group relative flex h-[60vh] min-h-[480px] items-end overflow-hidden"
        >
          <Image
            src="/images/doorway-chef.jpg"
            alt="Op zoek naar een chef"
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="relative z-10 w-full px-8 pb-12 text-center md:px-12 md:pb-16">
            <h3 className="font-serif text-4xl leading-[1.1] text-white md:text-5xl lg:text-6xl">
              <span className="block">Op zoek naar</span>
              <span className="block underline decoration-1 underline-offset-8 group-hover:decoration-cream">
                een chef?
              </span>
            </h3>
            <p className="mt-4 font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
              Binnen 24 uur op locatie →
            </p>
          </div>
        </Link>

        <Link
          href="/work-with-us/"
          className="group relative flex h-[60vh] min-h-[480px] items-end overflow-hidden"
        >
          <Image
            src="/images/doorway-werk.jpg"
            alt="Op zoek naar werk"
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="relative z-10 w-full px-8 pb-12 text-center md:px-12 md:pb-16">
            <h3 className="font-serif text-4xl leading-[1.1] text-white md:text-5xl lg:text-6xl">
              <span className="block">Op zoek naar</span>
              <span className="block underline decoration-1 underline-offset-8 group-hover:decoration-cream">
                werk?
              </span>
            </h3>
            <p className="mt-4 font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
              Loondienst &amp; flexibele inzet →
            </p>
          </div>
        </Link>
      </section>

      {/* ============ 3-up service tiles with photos + captions ============ */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-16 text-center">
            <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-burgundy">
              Wat wij doen
            </p>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Drie manieren waarop wij uw team versterken
            </h2>
          </div>

          <div className="grid gap-10 md:grid-cols-3 md:gap-8">
            {serviceTiles.map((s) => (
              <Link key={s.href} href={s.href} className="group block">
                <div className="relative aspect-[3/4] overflow-hidden">
                  <Image
                    src={s.image}
                    alt={s.title}
                    fill
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                </div>
                <h3 className="mt-6 text-center font-serif text-xl text-ink-900 md:text-2xl">
                  {s.title}
                </h3>
                <p className="mt-3 text-center text-sm leading-relaxed text-ink-700">
                  {s.body}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ============ Procesnummering — donker ============ */}
      <section className="bg-bg-gray py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12">
            <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-burgundy">
              Processtappen Chef &amp; Serve
            </p>
            <h2 className="mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Hoe wij werken — van briefing tot inzet
            </h2>
          </div>

          <ol className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {processSteps.map((step) => (
              <li key={step.n}>
                <div className="font-serif text-5xl text-burgundy md:text-6xl">
                  {step.n}
                </div>
                <h3 className="mt-4 font-serif text-xl text-ink-900">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-700">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ============ "WAT WIJ BIEDEN" — typographic service list ============ */}
      <section className="bg-white py-20 md:py-28">
        <div className="mx-auto max-w-container px-4 text-center">
          <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-burgundy">
            Wat wij bieden
          </p>
          <h2 className="mx-auto mt-3 mb-12 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
            Volledige horecateams, één partner
          </h2>

          <ul className="mx-auto grid max-w-3xl gap-y-5 gap-x-12 text-center md:grid-cols-3">
            {offerLinks.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="group inline-block font-serif text-lg leading-tight text-ink-900 transition-colors hover:text-burgundy md:text-xl"
                >
                  {s.label}
                  <span className="ml-2 text-burgundy transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ============ Two pillar callouts — photo backed ============ */}
      <section className="grid grid-cols-1 md:grid-cols-2">
        <Link
          href="/chef-inhuren-hotel-amsterdam/"
          className="group relative flex h-[420px] items-end overflow-hidden bg-ink-900 md:h-[500px]"
        >
          <Image
            src="/images/service-chefs.jpg"
            alt="Chef inhuren hotel Amsterdam"
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover opacity-50 transition-all duration-700 group-hover:scale-105 group-hover:opacity-70"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />
          <div className="relative z-10 p-10 md:p-14">
            <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
              Pillar — Hotels
            </p>
            <h3 className="mt-3 font-serif text-2xl leading-snug text-white md:text-3xl">
              Chef inhuren voor uw hotel in Amsterdam
            </h3>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
              Complete gids met chef-rollen, banqueting &amp; breakfast,
              transparante tarieven (€32-55/uur) en de payroll-route voor hotels.
            </p>
            <span className="mt-6 inline-block font-ui text-[11px] uppercase tracking-[0.18em] text-cream group-hover:underline">
              Lees de complete gids →
            </span>
          </div>
        </Link>

        <Link
          href="/payroll-chef-inhuren/"
          className="group relative flex h-[420px] items-end overflow-hidden bg-burgundy md:h-[500px]"
        >
          <Image
            src="/images/service-werving.jpg"
            alt="Payroll chef inhuren"
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover opacity-30 transition-all duration-700 group-hover:scale-105 group-hover:opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-burgundy via-burgundy/70 to-transparent" />
          <div className="relative z-10 p-10 md:p-14">
            <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
              Pillar — Payroll
            </p>
            <h3 className="mt-3 font-serif text-2xl leading-snug text-white md:text-3xl">
              Payroll chef inhuren — zonder ZZP-risico
            </h3>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
              Waarom payroll het standaard-model is in 2026. De JUSTHORECA-les,
              vergelijkingstabel en de Wet DBA-compliance route.
            </p>
            <span className="mt-6 inline-block font-ui text-[11px] uppercase tracking-[0.18em] text-cream group-hover:underline">
              Lees de payroll-gids →
            </span>
          </div>
        </Link>
      </section>

      {/* ============ FAQ ============ */}
      <section className="bg-bg-gray py-20 md:py-28">
        <div className="mx-auto max-w-container px-4">
          <div className="mb-12 text-center">
            <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-burgundy">
              Veelgestelde vragen
            </p>
            <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-ink-900 md:text-5xl">
              Wat hotels en restaurants vaak vragen
            </h2>
          </div>
          <div className="mx-auto max-w-3xl">
            <FAQAccordion faqs={homepageFaqs} heading="" />
          </div>
        </div>
      </section>

      {/* ============ Closing CTA — dark cinematic ============ */}
      <section className="bg-ink-900 py-20 text-center text-white md:py-28">
        <div className="mx-auto max-w-container px-4">
          <p className="font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
            De juiste mensen, op het juiste moment
          </p>
          <h2 className="mx-auto mt-3 max-w-3xl font-serif text-3xl text-white md:text-5xl">
            Klaar om uw team te versterken?
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-white/75">
            Stuur een mail of bel direct — Maarten of het team reageert binnen
            een uur tijdens werkdagen.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={`mailto:${site.email}`}
              className="rounded-full bg-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-900 transition-colors hover:bg-cream"
            >
              Mail ons
            </a>
            <a
              href={`tel:${site.phone}`}
              className="rounded-full border border-white px-6 py-3 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-white hover:text-ink-900"
            >
              Bel {site.phoneDisplay}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
