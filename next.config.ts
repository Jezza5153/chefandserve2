import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Image optimization — fixes the WebP issue from the old WP site
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 31536000,
    // Allow legacy WP CDN while we transition; remove once everything is in /public/images
    remotePatterns: [
      { protocol: "https", hostname: "chefandserve.nl", pathname: "/wp-content/uploads/**" },
    ],
  },
  // 301 redirects from the old WP site (preserves SEO equity)
  async redirects() {
    return [
      { source: "/blog", destination: "/", permanent: true },
      { source: "/blog/:path*", destination: "/", permanent: true },
      { source: "/horecapersoneel-amsterdam", destination: "/horeca-personeel-inhuren", permanent: true },
      { source: "/tijdelijk-personeel-horeca", destination: "/tijdelijk-horeca-personeel", permanent: true },
      // Legacy WP /index.php/ paths
      { source: "/index.php/:path*", destination: "/:path*", permanent: true },
    ];
  },
  async headers() {
    // PR-S1D — security headers, AVG/AP-aligned.
    //
    // HSTS: 1-year max-age, includeSubDomains. NO preload yet — preload is
    // painful to reverse and requires every current+future subdomain to be
    // HTTPS-safe. Audit subdomains before adding preload (deferred PR).
    //
    // CSP: ships as REPORT-ONLY first. Violations land on /api/csp-report
    // → error_log. After 48h of clean reports across /login, /, /our-offer,
    // /work-with-us, /admin/system, /chef, /client we flip the header name
    // to "Content-Security-Policy" (enforce mode — separate PR).
    //
    // unsafe-inline scripts are required by current Next.js inline runtime.
    // TODO: migrate to nonce-based CSP after Next.js 16 nonce support.
    const csp = [
      "default-src 'self'",
      // Cloudflare Turnstile widget loads from challenges.cloudflare.com
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      // Legacy WP CDN for image transition + data URLs for inline icons
      "img-src 'self' data: https://chefandserve.nl",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "media-src 'self'",
      // PWA: service worker (/sw.js) + web app manifest, both same-origin.
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "report-uri /api/csp-report",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Content-Security-Policy-Report-Only", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Tightened to DENY — was SAMEORIGIN. We never frame our own admin.
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
