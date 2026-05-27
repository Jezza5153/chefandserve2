/**
 * Hours labels — PR-CHEF-1.
 *
 * THE ONE place that maps backend shift_hours statuses to human Dutch labels.
 * Every chef/klant/admin UI imports from here; nothing else stringifies a
 * raw status. UX rule: "no raw backend statuses in UI".
 *
 * Also exposes timelineDots() + nextActor() + humanNextAction() so the
 * trust-timeline component is fully data-driven.
 */

import type { ShiftHours } from "@/lib/db/schema";

export type HoursStatus = ShiftHours["status"];

/** Map status → Dutch user-facing label. Used as a pill + as inline copy. */
export function humanStatus(status: HoursStatus): string {
  switch (status) {
    case "draft":
      return "Concept";
    case "submitted":
      return "Wacht op klant";
    case "client_signed":
      return "Door klant akkoord";
    case "client_rejected":
      return "Afgekeurd door klant";
    case "admin_approved":
      return "Goedgekeurd voor uitbetaling";
    case "admin_rejected":
      return "Teruggezet door Chef & Serve";
    case "exported":
      return "Geëxporteerd naar payroll";
    case "void":
      return "Vervallen";
  }
}

/** Pill background tone — used by HumanStatusBadge.tsx. */
export function statusTone(status: HoursStatus): "amber" | "green" | "burgundy" | "blue" | "gray" {
  switch (status) {
    case "draft":
      return "gray";
    case "submitted":
      return "amber";
    case "client_signed":
      return "blue";
    case "client_rejected":
      return "burgundy";
    case "admin_approved":
      return "green";
    case "admin_rejected":
      return "burgundy";
    case "exported":
      return "green";
    case "void":
      return "gray";
  }
}

/**
 * Who is the chain currently waiting on?
 * - 'chef'  — needs chef action (draft to submit, or rejected to fix)
 * - 'klant' — needs klant action (submitted, awaiting sign)
 * - 'admin' — needs admin action (client_signed, awaiting approval)
 * - 'none'  — chain is done (approved/exported/void)
 */
export type NextActor = "chef" | "klant" | "admin" | "none";

export function nextActor(status: HoursStatus): NextActor {
  switch (status) {
    case "draft":
    case "client_rejected":
    case "admin_rejected":
      return "chef";
    case "submitted":
      return "klant";
    case "client_signed":
      return "admin";
    case "admin_approved":
    case "exported":
    case "void":
      return "none";
  }
}

/**
 * Per-viewer "wat moet ik nu doen?" line. The viewer's role contextualizes
 * the message so /chef shows action-for-chef, /client shows action-for-klant, etc.
 */
export type Viewer = "chef" | "klant" | "admin";

export function humanNextAction(status: HoursStatus, viewer: Viewer): string {
  const actor = nextActor(status);
  if (actor === "none") {
    if (status === "admin_approved")
      return "Goedgekeurd. Wacht op uitbetaling via payroll.";
    if (status === "exported")
      return "Geëxporteerd naar payroll.";
    return "Vervallen.";
  }
  // Viewer == actor → "actie voor jou"
  if (viewer === actor) {
    if (actor === "chef") {
      return status === "client_rejected"
        ? "De klant heeft je uren teruggegeven — pas aan en dien opnieuw in."
        : status === "admin_rejected"
          ? "Chef & Serve heeft je uren teruggezet — pas aan en dien opnieuw in."
          : "Vul je uren in en dien in.";
    }
    if (actor === "klant") {
      return "Controleer en geef akkoord (of niet).";
    }
    return "Controleer en keur goed.";
  }
  // Viewer waits on someone else
  if (actor === "chef") return "Wacht op de chef.";
  if (actor === "klant") return "Wacht op de klant.";
  return "Wacht op Chef & Serve.";
}

/**
 * Five-dot timeline state used by TrustTimeline.tsx.
 *
 * Steps: Chef · Klant · Chef&Serve · Payroll · Uitbetaling
 * Each step has a state: done | current | future | rejected
 */
export type TimelineState = "done" | "current" | "future" | "rejected";
export type TimelineStep = {
  key: "chef_submit" | "client_sign" | "admin_approve" | "exported" | "paid";
  label: string;
  state: TimelineState;
  /** When it happened (or null if not yet). */
  at: Date | null;
};

export function timelineDots(row: {
  status: HoursStatus;
  submittedAt: Date | null;
  clientSignedAt: Date | null;
  clientRejectedAt: Date | null;
  adminApprovedAt: Date | null;
  adminRejectedAt: Date | null;
  payingitExportedAt: Date | null;
}): TimelineStep[] {
  const s = row.status;
  return [
    {
      key: "chef_submit",
      label: "Ingevuld door chef",
      state:
        s === "draft"
          ? "current"
          : ["client_rejected", "admin_rejected"].includes(s)
            ? "rejected"
            : "done",
      at: row.submittedAt,
    },
    {
      key: "client_sign",
      label: "Akkoord klant",
      state:
        s === "submitted"
          ? "current"
          : s === "client_rejected"
            ? "rejected"
            : ["draft"].includes(s)
              ? "future"
              : "done",
      at: row.clientSignedAt ?? row.clientRejectedAt,
    },
    {
      key: "admin_approve",
      label: "Goedkeuring Chef & Serve",
      state:
        s === "client_signed"
          ? "current"
          : s === "admin_rejected"
            ? "rejected"
            : ["admin_approved", "exported"].includes(s)
              ? "done"
              : "future",
      at: row.adminApprovedAt ?? row.adminRejectedAt,
    },
    {
      key: "exported",
      label: "Uitbetaling klaarzetten",
      state:
        s === "admin_approved"
          ? "current"
          : s === "exported"
            ? "done"
            : "future",
      at: row.payingitExportedAt,
    },
    {
      key: "paid",
      label: "Uitbetaald",
      state: s === "exported" ? "current" : "future",
      at: null,
    },
  ];
}

/** Worked-minutes → "5 uur 45 min" */
export function formatWorkedMinutes(workedMinutes: number): string {
  const h = Math.floor(workedMinutes / 60);
  const m = workedMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} uur`;
  return `${h} uur ${m} min`;
}

/** Cents → "€230,00" (NL formatting). */
export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** Helper: hours × rate → cents (for "verwachte vergoeding"). */
export function computeChefAmountCents(
  workedMinutes: number,
  chefRateCents: number,
): number {
  return Math.round((workedMinutes / 60) * chefRateCents);
}
