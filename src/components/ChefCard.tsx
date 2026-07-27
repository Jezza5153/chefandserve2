"use client";
/**
 * ChefCard — the "never a number" primitive (DASH-PEOPLE).
 *
 * Wrap any chef name in <ChefCard data={…}> and Maarten gets the person on
 * hover/focus (desktop) or first tap (touch): face, tenure, lifetime hours,
 * rating, last worked, "best ingezet voor", birthday-soon, and tap-to-call.
 * One design, used everywhere — so whether the roster has 8 names or 500,
 * every one of them opens into a person he recognises.
 *
 * No portal/library (repo rule: no new deps): a positioned popover inside a
 * relative wrapper. Hover opens with a small delay-free enter/leave pair;
 * click toggles for touch; Escape and blur close. INTERNAL surfaces only —
 * the data carries rating + intel (see chef-cards.ts).
 */
import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { Icon } from "@/components/admin/icons";
import { formatChefRole } from "@/lib/labels";
import type { ChefCardData } from "@/lib/domain/chef-cards";

/** wa.me needs digits with country code; Dutch 06… becomes 316…. */
function waHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("06") ? `31${digits.slice(1)}` : digits.replace(/^00/, "");
  return `https://wa.me/${intl}`;
}

function dayWord(n: number): string {
  return n === 0 ? "vandaag" : n === 1 ? "morgen" : `over ${n} dagen`;
}

export function ChefCard({
  data,
  align = "left",
  children,
}: {
  data: ChefCardData;
  /** Which edge the popover hugs; use "right" near the right viewport edge. */
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const leave = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Small grace so the pointer can travel into the card without it vanishing.
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  const sub = [data.vakniveau ? formatChefRole(data.vakniveau) : null, data.city].filter(Boolean).join(" · ");
  const facts: string[] = [];
  if (data.totalHours > 0) facts.push(`${data.totalHours} u gewerkt`);
  if (data.legacyHours) facts.push(`±${data.legacyHours} u (oude systeem)`);
  if (data.totalShifts > 0) facts.push(`${data.totalShifts} diensten`);
  if (data.rating) facts.push(`★ ${Number(data.rating.average).toFixed(1)} (${data.rating.count})`);
  if (data.tenureYears >= 1) facts.push(`${data.tenureYears} jaar bij ons`);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className="cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </span>

      {open && (
        <span
          className={`absolute top-full z-50 mt-1.5 block w-72 rounded-xl border border-ink-200 bg-white p-4 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <span className="flex items-start gap-3">
            {data.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- authz-gated API route, not a static asset
              <img
                src={data.photoUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-burgundy/10 font-serif text-base text-burgundy">
                {data.fullName
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <Link
                href={`/admin/business/chefs/${data.id}`}
                className="block truncate font-serif text-base text-ink-900 hover:text-burgundy"
              >
                {data.fullName}
              </Link>
              {sub && <span className="block truncate text-xs text-ink-500">{sub}</span>}
            </span>
          </span>

          {facts.length > 0 && (
            <span className="mt-3 flex flex-wrap gap-1.5">
              {facts.map((f) => (
                <span key={f} className="rounded-full bg-bg-gray px-2 py-0.5 font-ui text-[10px] text-ink-700">
                  {f}
                </span>
              ))}
            </span>
          )}
          {data.totalShifts === 0 && !data.legacyHours && (
            <span className="mt-3 block text-xs text-ink-500">Nog geen afgeronde diensten — nieuw in het bestand.</span>
          )}
          {data.totalShifts === 0 && data.legacyHours ? (
            <span className="mt-3 block text-xs text-ink-500">Nog geen diensten in het nieuwe systeem — wél historie hierboven.</span>
          ) : null}

          {data.bestUsedFor && (
            <span className="mt-2.5 block rounded-lg bg-burgundy/[0.04] px-2.5 py-2 text-xs text-ink-700">
              <span className="font-ui text-[9px] uppercase tracking-[0.15em] text-burgundy">Best ingezet voor</span>
              <span className="mt-0.5 block">{data.bestUsedFor}</span>
            </span>
          )}

          {data.birthdayInDays != null && (
            <span className="mt-2.5 flex items-center gap-1.5 text-xs text-ink-700">
              <Icon name="gift" className="h-3.5 w-3.5 text-burgundy" />
              Jarig {dayWord(data.birthdayInDays)}
            </span>
          )}

          {data.lastWorkedDaysAgo != null && (
            <span className="mt-1.5 block text-[11px] text-ink-500">
              Laatst gewerkt: {data.lastWorkedDaysAgo === 0 ? "vandaag" : `${data.lastWorkedDaysAgo} dagen geleden`}
            </span>
          )}

          {data.phone && (
            <span className="mt-3 flex items-center gap-2">
              <a
                href={`tel:${data.phone.replace(/[^+\d]/g, "")}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-ink-200 py-1.5 font-ui text-[11px] text-ink-700 hover:border-burgundy hover:text-burgundy"
              >
                <Icon name="phone" className="h-3.5 w-3.5" /> Bel
              </a>
              <a
                href={waHref(data.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-ink-200 py-1.5 font-ui text-[11px] text-ink-700 hover:border-emerald-600 hover:text-emerald-700"
              >
                <Icon name="message-circle" className="h-3.5 w-3.5" /> App
              </a>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
