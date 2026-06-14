import type { MetadataRoute } from "next";

/**
 * PWA manifest (Next 15 App Router) — served at /manifest.webmanifest.
 *
 * Scope is /chef so installing the app pins the chef portal (chefs live on
 * their phones); the public marketing site + admin/client portals stay normal
 * browser tabs. theme_color is the house burgundy. Icons are generated from
 * public/logo.svg by scripts/gen-pwa-icons.mjs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chef & Serve",
    short_name: "Chef&Serve",
    description:
      "Jouw shifts, uren, verdiensten en beschikbaarheid — altijd bij de hand.",
    lang: "nl",
    scope: "/chef",
    start_url: "/chef",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#801B2B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
