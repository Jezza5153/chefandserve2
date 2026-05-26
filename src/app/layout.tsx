import type { Metadata } from "next";
import { Prata, Roboto, Poppins } from "next/font/google";
import { ChromeShell } from "@/components/ChromeShell";
import { JsonLd } from "@/components/JsonLd";
import {
  buildGraph,
  organizationNode,
  personMaartenNode,
  websiteNode,
} from "@/lib/schema";
import { site } from "@/lib/site";
import "./globals.css";

const prata = Prata({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-prata",
});

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});

const poppins = Poppins({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords: [
    "horeca personeel inhuren",
    "chef inhuren amsterdam",
    "kok inhuren",
    "horeca uitzendbureau amsterdam",
    "payroll horeca",
    "wet dba 2026",
    "loondienst horeca",
  ],
  authors: [{ name: site.founder.name }],
  creator: site.name,
  publisher: site.name,
  alternates: {
    canonical: "/",
    languages: {
      "nl-NL": "/",
      "x-default": "/",
    },
  },
  openGraph: {
    type: "website",
    locale: site.locale,
    url: site.url,
    siteName: site.name,
    title: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
    description: site.description,
    images: [
      {
        url: "/images/logo.png",
        width: 1200,
        height: 630,
        alt: site.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — Premium Horeca Uitzendbureau Amsterdam`,
    description: site.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Site-wide @graph: organization + founder + website.
  // Rendered server-side on every route; suppressed via a `<head>` directive
  // inside ChromeShell when on an app route (so app routes never leak
  // public marketing schema). ChromeShell is a tiny client component that
  // reads the pathname and conditionally renders Header/Footer — this keeps
  // marketing pages STATICALLY pre-rendered.
  const siteGraph = buildGraph(
    organizationNode(),
    personMaartenNode(),
    websiteNode(),
  );

  return (
    <html
      lang={site.language}
      className={`${prata.variable} ${roboto.variable} ${poppins.variable}`}
    >
      <body className="flex min-h-screen flex-col">
        <ChromeShell jsonLd={<JsonLd data={siteGraph} />}>{children}</ChromeShell>
      </body>
    </html>
  );
}
