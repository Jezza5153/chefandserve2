/**
 * Operational status language (Phase 3 Track C) — ONE owner-facing status per shift, the
 * "line between chaos and structure". Mirrors getClientShiftLabel's shape
 * ({ label, nextStep }) but for the OWNER's fill/lifecycle view: it composes the shift
 * status + the placement counts (confirmed / accepted / proposed-pending) into a single
 * legible state + a "wat gebeurt er nu?" next step.
 *
 * Pure + migration-free — derived entirely from data that already exists. The day-of /
 * in-shift states (Onderweg · Ingeklokt · Uitgeklokt) depend on clock-in/arrival data owned
 * by the chef-side lane; when that lands, the `running` branch splits into them. This helper
 * deliberately does NOT claim those states (it never asserts a chef physically arrived) —
 * `running` means "in progress per the planning", schedule-based and honest.
 */
export type OpsStatusKey =
  | "requested" // klant-aanvraag, nog niet open
  | "open" // open, nog geen levende plaatsing
  | "awaiting_reply" // chef(s) voorgesteld, wacht op antwoord
  | "chef_found" // chef accepteerde, nog niet bevestigd
  | "partly_staffed" // deels bemand (confirmed < headcount)
  | "staffed" // volledig bevestigd, dienst nog te gaan
  | "running" // dienst loopt (volgens planning)
  | "done" // afgerond
  | "cancelled"; // geannuleerd

export type OpsTone = "neutral" | "progress" | "good" | "warn" | "muted";

export type OpsStatus = { key: OpsStatusKey; label: string; nextStep: string; tone: OpsTone };

export type ShiftOpsInput = {
  shiftStatus: "request" | "open" | "filled" | "completed" | "cancelled";
  headcount: number;
  confirmed: number; // placements in 'confirmed'
  accepted: number; // accepted but NOT yet confirmed
  proposedPending: number; // 'proposed', awaiting a chef reply
  startsAt: Date | string;
  now?: number; // injectable clock for tests
};

export function shiftOpsStatus(s: ShiftOpsInput): OpsStatus {
  const now = s.now ?? Date.now();
  const headcount = Math.max(s.headcount || 0, 1);
  const started = new Date(s.startsAt).getTime() <= now;

  if (s.shiftStatus === "cancelled") {
    return { key: "cancelled", label: "Geannuleerd", nextStep: "Deze dienst is geannuleerd — geen actie nodig.", tone: "muted" };
  }
  if (s.shiftStatus === "completed") {
    return { key: "done", label: "Afgerond", nextStep: "De dienst is geweest — controleer en keur de uren.", tone: "muted" };
  }
  if (s.shiftStatus === "request") {
    return { key: "requested", label: "Aangevraagd", nextStep: "Zet de aanvraag om naar een open dienst om te kunnen matchen.", tone: "muted" };
  }

  // open / filled — the live fill lifecycle
  const confirmed = Math.max(s.confirmed, 0);
  const openSlots = Math.max(headcount - confirmed, 0);

  if (confirmed >= headcount) {
    return started
      ? { key: "running", label: "Dienst loopt", nextStep: "De dienst is bezig (volgens planning).", tone: "good" }
      : { key: "staffed", label: "Bemand", nextStep: "Bevestigd en compleet — niets te doen, tenzij er iets wijzigt.", tone: "good" };
  }
  if (started && confirmed > 0) {
    return { key: "running", label: "Dienst loopt", nextStep: `De dienst is bezig (volgens planning) — let op: nog ${openSlots} plek(ken) onbemand.`, tone: "warn" };
  }
  if (confirmed > 0) {
    return { key: "partly_staffed", label: "Deels bemand", nextStep: `Nog ${openSlots} plek(ken) open — stel meer chefs voor.`, tone: "warn" };
  }
  if (s.accepted > 0) {
    return { key: "chef_found", label: "Chef gevonden", nextStep: "Bevestig de chef om de plek vast te zetten.", tone: "progress" };
  }
  if (s.proposedPending > 0) {
    return { key: "awaiting_reply", label: "Wacht op reactie", nextStep: "Chef(s) voorgesteld — wacht op antwoord of verbreed de zoektocht.", tone: "progress" };
  }
  return { key: "open", label: "Open", nextStep: "Stel een chef voor — die krijgt direct de aanvraag.", tone: "neutral" };
}
