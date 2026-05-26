/**
 * Trust banner — the burgundy-bordered strip on every service post.
 * Communicates: 100% payroll, Wet DBA 2026, 200+ chefs, 24-hour delivery.
 *
 * Used at the very top of service / pillar pages.
 */
export function TrustBanner() {
  return (
    <div
      className="rounded mb-6 border-l-4 border-burgundy bg-bg-gray px-5 py-4 text-sm leading-relaxed"
      role="complementary"
      aria-label="Belangrijkste pluspunten"
    >
      <span className="font-semibold">✓ 100% Loondienst</span> — geen ZZP-risico voor uw hotel,
      restaurant of evenement · <span className="font-semibold">Wet DBA 2026 compliant</span> ·{" "}
      <span className="font-semibold">200+ koks &amp; chefs</span> in actief netwerk, wekelijks
      groeiend · <span className="font-semibold">Binnen 24 uur</span> inzetbaar in Amsterdam en
      de Randstad
    </div>
  );
}
