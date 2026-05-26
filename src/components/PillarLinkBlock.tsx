import Link from "next/link";

/**
 * Cross-link block for related-pillar references in body content.
 * Lighter visual than the trust banner. Used to send equity to pillar pages.
 */
export function PillarLinkBlock({
  variant = "default",
  children,
}: {
  variant?: "default" | "burgundy";
  children: React.ReactNode;
}) {
  const icon = variant === "burgundy" ? "💼" : "📖";
  return (
    <div className="my-6 rounded border-l-[3px] border-burgundy bg-bg-warm px-5 py-4 text-sm leading-relaxed">
      <span aria-hidden className="mr-1">
        {icon}
      </span>
      <span className="font-semibold">Lees ook:</span> {children}
    </div>
  );
}

/**
 * Convenience: typed link inside a pillar block.
 */
export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  const isExternal = href.startsWith("http") && !href.includes("chefandserve.nl");
  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-burgundy underline-offset-4 hover:underline"
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className="text-burgundy underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
