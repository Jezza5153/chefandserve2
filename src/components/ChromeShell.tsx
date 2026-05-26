"use client";

import { usePathname } from "next/navigation";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";

/**
 * ChromeShell — conditional marketing chrome.
 *
 * Wraps the root layout's children. On marketing routes (everything that
 * isn't /admin, /login, /verify) it renders the public Header + Footer and
 * emits the site-wide JSON-LD. On app routes it passes children through
 * untouched — the (admin) and (auth) route groups have their own layouts.
 *
 * Why client-side?
 *   - Using `headers()` server-side would force every route into dynamic
 *     rendering, killing static prerendering on the 29 marketing pages.
 *   - A tiny client-side path check preserves SSG. Both branches render the
 *     same HTML structure at build time (Header+Footer for marketing,
 *     nothing for app); hydration only confirms what the build already did.
 *   - During SSR/build, `usePathname` returns the route segment correctly,
 *     so the prerendered HTML is correct from the first byte.
 */
const APP_PATH_PREFIXES = ["/admin", "/login", "/verify"];

export function ChromeShell({
  jsonLd,
  children,
}: {
  jsonLd: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const isAppRoute = APP_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (isAppRoute) {
    return <>{children}</>;
  }

  return (
    <>
      {jsonLd}
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
