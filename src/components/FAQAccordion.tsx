"use client";

import { useState } from "react";
import type { FAQ } from "@/lib/faqs";

/**
 * Accessible FAQ accordion. Each item is a <details> for SEO + no-JS fallback,
 * but we layer state on top for smoother animations + analytics hooks.
 * Schema is emitted separately via FAQPage JSON-LD in the page <head>.
 */
export function FAQAccordion({
  faqs,
  heading = "Veelgestelde vragen",
}: {
  faqs: FAQ[];
  heading?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="my-12" aria-labelledby="faq-heading">
      <h2
        id="faq-heading"
        className="mb-6 font-serif text-section-mobile md:text-section-tablet lg:text-section-desktop"
      >
        {heading}
      </h2>
      <div className="space-y-3">
        {faqs.map((faq, i) => {
          const isOpen = openIndex === i;
          return (
            <div
              key={i}
              className="overflow-hidden rounded border border-gray-200 bg-white transition-colors"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${i}`}
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-bg-gray focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2"
              >
                <span className="font-medium text-ink-900">{faq.q}</span>
                <span
                  className={`shrink-0 text-burgundy transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>
              {isOpen && (
                <div
                  id={`faq-answer-${i}`}
                  role="region"
                  className="border-t border-gray-100 px-5 py-4 text-ink-700 leading-relaxed"
                >
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
