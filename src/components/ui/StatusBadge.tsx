/**
 * StatusBadge — UX foundation. ONE renderer for the status pill used across the app
 * (hours, submissions, clients, privacy requests, profile-change requests). It centralizes
 * only the tone→class vocabulary + pill geometry; each domain keeps its own status→tone +
 * label mapping (the enums genuinely differ). Server- and client-safe (no "use client").
 *
 * The tone vocabulary is verbatim from components/hours/HumanStatusBadge, so adopting it
 * there — and at the other call sites that already use this exact palette — is a
 * zero-pixel-change refactor.
 */
import type { ReactNode } from "react";

export type StatusTone = "green" | "amber" | "blue" | "burgundy" | "red" | "gray";

/** The canonical tone → Tailwind class map (matches HumanStatusBadge + the inline badges). */
export const statusToneClass: Record<StatusTone, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-700",
  burgundy: "bg-burgundy/10 text-burgundy",
  red: "bg-red-100 text-red-700",
  gray: "bg-bg-gray text-ink-500",
};

type Size = "sm" | "md";
const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[9px]", // matches HumanStatusBadge
  md: "px-3 py-1 text-[10px]",
};

export function StatusBadge({
  tone,
  label,
  size = "sm",
  className = "",
}: {
  tone: StatusTone;
  label: ReactNode;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      className={`rounded-full font-ui font-medium uppercase tracking-wider ${SIZE[size]} ${statusToneClass[tone]} ${className}`}
    >
      {label}
    </span>
  );
}
