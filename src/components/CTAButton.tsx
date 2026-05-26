import Link from "next/link";

type Variant = "primary" | "secondary" | "outline";

export function CTAButton({
  href,
  variant = "primary",
  children,
  className = "",
}: {
  href: string;
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded px-6 py-3 text-sm font-medium uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

  const variants = {
    primary: "bg-burgundy text-white hover:bg-burgundy-900 focus-visible:ring-burgundy",
    secondary:
      "bg-white text-burgundy border border-burgundy hover:bg-burgundy hover:text-white focus-visible:ring-burgundy",
    outline:
      "bg-transparent text-white border border-white hover:bg-white hover:text-ink-900 focus-visible:ring-white",
  } as const;

  const isExternal = href.startsWith("http") || href.startsWith("tel:") || href.startsWith("mailto:");

  if (isExternal) {
    return (
      <a
        href={href}
        className={`${base} ${variants[variant]} ${className}`}
        {...(href.startsWith("http") && !href.includes("chefandserve.nl")
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
