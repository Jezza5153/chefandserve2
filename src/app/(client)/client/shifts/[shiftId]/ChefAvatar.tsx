"use client";

/**
 * ChefAvatar — proposed-chef photo on the hub (PR-KLANT-3 / photo authz).
 * Renders the chef's clientVisible+verified photo via /api/chef-photo/[id];
 * falls back to initials if there's no photo or the image fails to load.
 */

import { useState } from "react";

export function ChefAvatar({
  photoId,
  name,
}: {
  photoId: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (!photoId || failed) {
    return (
      <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-bg-gray font-serif text-lg text-ink-300">
        {initials}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/chef-photo/${photoId}`}
      alt={name}
      onError={() => setFailed(true)}
      className="size-14 shrink-0 rounded-full object-cover"
    />
  );
}
