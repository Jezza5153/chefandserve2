import Image from "next/image";

/**
 * PageHero — cinematic hero used on all non-home pages.
 *
 * Pattern:
 *   - Full-bleed dark photo background (object-cover) with subtle gradient overlay
 *   - Optional eyebrow (small caps, cream)
 *   - Prata serif H1
 *   - Optional intro paragraph
 *   - Optional children slot (e.g. CTAs)
 *
 * Heights tuned so the hero is always presentable but doesn't dominate scroll.
 */
export function PageHero({
  eyebrow,
  title,
  intro,
  image,
  imageAlt,
  children,
  size = "default",
  align = "left",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
  image: string;
  imageAlt: string;
  children?: React.ReactNode;
  size?: "compact" | "default" | "tall";
  align?: "left" | "center";
}) {
  const heightClass =
    size === "compact"
      ? "h-[48vh] min-h-[380px] md:h-[52vh]"
      : size === "tall"
        ? "h-[70vh] min-h-[520px]"
        : "h-[60vh] min-h-[440px] md:h-[64vh]";

  const alignClass =
    align === "center" ? "items-center text-center" : "items-start text-left";

  return (
    <section
      className={`relative w-full overflow-hidden bg-ink-900 text-white ${heightClass}`}
    >
      <Image
        src={image}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      {/* Layered overlay: dark bottom for legibility, brand-tint at top */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/75" />

      <div
        className={`relative z-10 mx-auto flex h-full max-w-container flex-col justify-end px-4 pb-12 md:pb-20 ${alignClass}`}
      >
        <div
          className={align === "center" ? "mx-auto max-w-3xl" : "max-w-3xl"}
        >
          {eyebrow && (
            <p className="mb-4 font-ui text-[11px] uppercase tracking-[0.3em] text-cream">
              {eyebrow}
            </p>
          )}
          <h1 className="font-serif text-3xl leading-[1.1] text-white md:text-5xl lg:text-6xl">
            {title}
          </h1>
          {intro && (
            <div className="mt-6 max-w-2xl text-base leading-relaxed text-white/85 md:text-lg">
              {intro}
            </div>
          )}
          {children && <div className="mt-8 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/** Small caps section label (cream-on-burgundy or burgundy-on-white) */
export function SectionLabel({
  children,
  tone = "burgundy",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "burgundy" | "cream";
  className?: string;
}) {
  const toneClass = tone === "cream" ? "text-cream" : "text-burgundy";
  return (
    <p
      className={`font-ui text-[11px] uppercase tracking-[0.3em] ${toneClass} ${className}`}
    >
      {children}
    </p>
  );
}
