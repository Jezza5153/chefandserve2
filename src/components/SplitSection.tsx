import Image from "next/image";

/**
 * Two-column editorial split: text on one side, full-bleed photo on the other.
 * Matches the live site's "Built on people, driven by purpose" pattern.
 */
export function SplitSection({
  eyebrow,
  title,
  body,
  image,
  imageAlt,
  reverse = false,
  bg = "white",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  body: React.ReactNode;
  image: string;
  imageAlt: string;
  reverse?: boolean;
  bg?: "white" | "gray" | "ink";
}) {
  const bgClass =
    bg === "ink"
      ? "bg-ink-900 text-white"
      : bg === "gray"
        ? "bg-bg-gray text-ink-900"
        : "bg-white text-ink-900";

  const eyebrowClass = bg === "ink" ? "text-cream" : "text-burgundy";
  const titleClass = bg === "ink" ? "text-white" : "text-ink-900";
  const bodyClass =
    bg === "ink" ? "text-white/80" : "text-ink-700";

  return (
    <section className={`${bgClass} py-20 md:py-28`}>
      <div className="mx-auto grid max-w-container items-center gap-12 px-4 md:grid-cols-2 md:gap-16 lg:gap-20">
        <div className={reverse ? "md:order-2" : ""}>
          {eyebrow && (
            <p
              className={`mb-4 font-ui text-[11px] uppercase tracking-[0.3em] ${eyebrowClass}`}
            >
              {eyebrow}
            </p>
          )}
          <h2
            className={`font-serif text-3xl leading-tight md:text-4xl lg:text-5xl ${titleClass}`}
          >
            {title}
          </h2>
          <div
            className={`prose-cs mt-6 text-base leading-relaxed md:text-lg ${bodyClass}`}
          >
            {body}
          </div>
        </div>

        <div
          className={`relative aspect-[4/5] overflow-hidden md:aspect-[3/4] ${reverse ? "md:order-1" : ""}`}
        >
          <Image
            src={image}
            alt={imageAlt}
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </section>
  );
}
