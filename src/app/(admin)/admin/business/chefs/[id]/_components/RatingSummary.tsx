import { DetailSection } from "@/components/ui/DetailShell";
import { RATING_TAG_LABELS, type RatingTag } from "@/lib/rating-tags";
import { getChefAverageForAdmin } from "@/lib/domain/ratings";

/**
 * PR-KLANT-5: rating summary (internal — admin only). Pure-presentational.
 * Extracted verbatim from chefs/[id]/page.tsx; the card chrome is now the shared
 * <DetailSection> (its wrapper className is character-identical to the original
 * `mt-6 rounded-lg border border-ink-200 bg-white p-5` section), and the original
 * burgundy <h2> heading is kept inside `children` so heading classes are unchanged.
 */
export function RatingSummary({
  rating,
}: {
  rating: Awaited<ReturnType<typeof getChefAverageForAdmin>>;
}) {
  return (
    <DetailSection className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
      {/* @verbatim-start */}
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Klant-feedback (intern)
      </h2>
      {rating.ratingCount === 0 ? (
        <p className="mt-2 text-sm text-ink-500">Nog geen feedback ontvangen.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-900">
            <span className="font-serif text-2xl">
              {rating.averageRating?.toFixed(2) ?? "—"}
            </span>{" "}
            gemiddeld · {rating.ratingCount} feedback
            {rating.ratingCount === 1 ? "" : "s"}
            {rating.ratingCount < 5 ? (
              <span className="ml-2 text-xs text-ink-500">
                (chef ziet eigen gemiddelde pas vanaf 5)
              </span>
            ) : null}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {rating.recent.map((r, i) => (
              <li key={i} className="border-b border-ink-100 pb-1.5">
                <span className="text-burgundy">{"★".repeat(r.stars)}</span>
                <span className="text-ink-200">{"★".repeat(5 - r.stars)}</span>
                {r.tags.length > 0 ? (
                  <span className="ml-2 text-xs text-ink-500">
                    {r.tags
                      .map((t) => RATING_TAG_LABELS[t as RatingTag] ?? t)
                      .join(" · ")}
                  </span>
                ) : null}
                {r.comment ? (
                  <p className="mt-0.5 text-xs text-ink-700">{r.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {/* @verbatim-end */}
    </DetailSection>
  );
}
