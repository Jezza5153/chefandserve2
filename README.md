# Chef & Serve — v2.0

Premium horeca uitzendbureau Amsterdam. Marketing site + operations platform on Next.js 15, TypeScript, Tailwind, Neon Postgres, Auth.js.

> **For contributors / devs:** start with [`BUILD_PLAN.md`](./BUILD_PLAN.md) — environments, URLs, tokens, the 6 Phase 0 PRs in detail.
>
> **Strategic 12-week roadmap:** [`ROADMAP.md`](./ROADMAP.md)

**Staging:** https://chefandserve2.vercel.app
**Production (post-launch):** https://chefandserve.nl (marketing) + https://app.chefandserve.nl (admin/portal)

## Stack

- **Next.js 15.0.3** (App Router, React Server Components)
- **React 19**
- **TypeScript 5.6** (strict)
- **Tailwind CSS 3.4** with custom design tokens (burgundy/ink palette, Prata serif + Roboto + Poppins)
- **next/image** for automatic WebP/AVIF (no more ShortPixel)
- **next/font** for self-hosted Google Fonts
- JSON-LD schema via lib/schema.ts (EmploymentAgency+LocalBusiness dual-class, FAQPage, Service with pricing offers)
- Native App Router `robots.ts` and `sitemap.ts`
- Vercel-native deployment

## Local dev

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Build

```bash
npm run build
npm run start  # serve the production build locally on :3000
```

## Project structure

```
src/
├── app/
│   ├── layout.tsx                          Root layout (fonts, site-wide JSON-LD)
│   ├── page.tsx                            Homepage
│   ├── globals.css                         Tailwind + .prose-cs typography
│   ├── robots.ts                           robots.txt generator
│   ├── sitemap.ts                          sitemap.xml generator
│   ├── chef-inhuren-hotel-amsterdam/       Pillar 1 — Hotel
│   ├── payroll-chef-inhuren/               Pillar 2 — Payroll
│   ├── horeca-personeel-inhuren/           Main service page
│   ├── {15 other service pages}/           Auto-generated via ServicePage component
│   ├── our-offer/                          Services overview
│   ├── who-we-are/                         About company
│   ├── work-with-us/                       Careers
│   ├── contact-us/                         Contact + form
│   ├── over-maarten/                       Founder bio
│   ├── ik-ben-maarten-chef-and-serve/      Founder voice (legacy URL)
│   ├── over-chef-and-serve-…/              Legacy URL preserved
│   ├── privacybeleid/                      AVG privacy policy
│   └── algemene-voorwaarden/               Terms of service
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── TrustBanner.tsx                     Burgundy compliance banner
│   ├── FAQAccordion.tsx                    Client component, accessible
│   ├── ComparisonTable.tsx                 Payroll vs ZZP vs Uitzendbureau vs Vast
│   ├── PillarLinkBlock.tsx                 Cross-link blocks
│   ├── CTAButton.tsx                       Primary/secondary/outline variants
│   ├── JsonLd.tsx                          Renders @graph JSON-LD blocks
│   └── ServicePage.tsx                     Reusable template for service pages
├── lib/
│   ├── site.ts                             Business facts (single source of truth)
│   ├── schema.ts                           JSON-LD builders
│   └── faqs.ts                             Dutch FAQ data (homepage + pillars)
└── public/
    └── images/                             Brand media (logo, hero, etc.)
```

## Environment variables

Create a `.env.local` file (optional — sensible defaults built in):

```bash
# Production URL — used in metadata + sitemap + schema
NEXT_PUBLIC_SITE_URL=https://chefandserve.nl

# Google Search Console verification token (optional)
GOOGLE_SITE_VERIFICATION=your-token-here
```

Set the same variables in Vercel project settings.

## Deploy to Vercel

1. Push the repo to GitHub (or any Git provider Vercel supports).
2. Import the project in Vercel → it auto-detects Next.js.
3. Add env vars in Vercel project settings.
4. Hit deploy. First build takes ~1–2 minutes.

### Connecting the chefandserve.nl domain

1. In Vercel: project → Settings → Domains → add `chefandserve.nl` and `www.chefandserve.nl`.
2. Update DNS at your registrar to point to Vercel (Vercel shows the exact records).
3. Vercel auto-issues a Let's Encrypt SSL cert.

## Editing content

All business facts are in **`src/lib/site.ts`**. Change once, ripples through:
- JSON-LD schema (organization, services, contact)
- Footer (address, phone, email)
- All pricing tables on service pages
- Contact form recipient

FAQ content is in **`src/lib/faqs.ts`** (homepage, hotel pillar, payroll pillar).

Service pages share the `<ServicePage>` template in `src/components/ServicePage.tsx` — to add a new service, copy `src/app/horeca-personeel-inhuren/page.tsx` and adjust the slug + content.

## Images

Drop image files into `public/images/`. Reference them as `/images/filename.ext` in `<Image>` components or `<img>` tags.

Required images:
- `public/images/logo.png` — 512×512 (used in JSON-LD, OG, header)
- `public/images/hero.jpg` — large hero image (used on homepage)

Next.js will automatically generate WebP/AVIF variants on first request.

## SEO / GEO compliance

- ✅ Yoast-equivalent JSON-LD on every page (organization, person, website, webpage, breadcrumb, FAQ, service)
- ✅ Wet DBA 2026 framing (no ZZP-claims, 100% loondienst)
- ✅ AI bot allowlist in `robots.ts` (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.)
- ✅ Sitemap with priorities + lastModified
- ✅ Metadata API (title template, OG, Twitter, robots)
- ✅ Canonical URLs on every page
- ✅ hreflang for nl-NL + x-default

## License

Proprietary. © Chef &amp; Serve {new Date().getFullYear()}.
