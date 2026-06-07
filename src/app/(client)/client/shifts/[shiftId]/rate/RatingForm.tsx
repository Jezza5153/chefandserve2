"use client";

/**
 * RatingForm — stars + positive/negative tags + optional comment (PR-KLANT-5).
 * Copy is "feedback", never "review"/"beoordeling"/"score". Feedback is
 * internal-only.
 */

import { useState } from "react";

import { fieldClass } from "@/components/forms/Fields";
import {
  NEGATIVE_TAGS,
  POSITIVE_TAGS,
  RATING_TAG_LABELS,
  type RatingTag,
} from "@/lib/rating-tags";

export function RatingForm({
  placementId,
  chefName,
  action,
}: {
  placementId: string;
  chefName: string;
  action: (formData: FormData) => Promise<void> | void;
}) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<Set<RatingTag>>(new Set());

  function toggle(tag: RatingTag) {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="stars" value={stars} />
      {[...tags].map((t) => (
        <input key={t} type="hidden" name="tags" value={t} />
      ))}

      <div>
        <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Hoe ging het met {chefName}?
        </p>
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              aria-label={`${n} ${n === 1 ? "ster" : "sterren"}`}
              className={`text-3xl leading-none transition-colors ${
                n <= stars ? "text-burgundy" : "text-ink-200 hover:text-burgundy/40"
              }`}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <TagGroup
        title="Wat viel positief op?"
        tags={POSITIVE_TAGS}
        selected={tags}
        onToggle={toggle}
      />
      <TagGroup
        title="Wat kon beter?"
        tags={NEGATIVE_TAGS}
        selected={tags}
        onToggle={toggle}
      />

      <label className="block">
        <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
          Opmerking (optioneel)
        </span>
        <textarea
          name="comment"
          rows={3}
          placeholder="Iets dat je wilt delen met Chef & Serve…"
          className={`${fieldClass} placeholder-ink-500`}
        />
      </label>

      <button
        type="submit"
        disabled={stars === 0}
        className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Feedback versturen
      </button>
      {stars === 0 ? (
        <p className="text-xs text-ink-500">Kies eerst een aantal sterren.</p>
      ) : null}
    </form>
  );
}

function TagGroup({
  title,
  tags,
  selected,
  onToggle,
}: {
  title: string;
  tags: readonly RatingTag[];
  selected: Set<RatingTag>;
  onToggle: (t: RatingTag) => void;
}) {
  return (
    <div>
      <p className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => {
          const on = selected.has(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => onToggle(t)}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                on
                  ? "bg-burgundy text-white"
                  : "border border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
              }`}
            >
              {on ? "✓ " : ""}
              {RATING_TAG_LABELS[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
