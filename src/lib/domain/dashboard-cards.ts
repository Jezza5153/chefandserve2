/**
 * Dashboard card contract — the spine of the v2 "Dashboard" control room.
 *
 * Every dashboard signal becomes a DashboardCard that answers Signal → Context →
 * Action → Confirmation. Pure + deterministic (no DB, no React) so the mapping is
 * unit-smoke-able and the "no dead cards" rule is enforceable.
 *
 * This module defines the contract + the `toCard` adapter that lifts the existing
 * ranked AttentionItem queue (dashboard-intel.ts) into cards WITHOUT changing the
 * ranking. The drawer routes + real form actions are attached by the dashboard
 * page in later waves (DASH-2+); here every card carries a single honest
 * link action so the foundation is testable in isolation.
 */

import {
  priorityOf,
  type AttentionItem,
  type AttentionKind,
  type AttentionTone,
} from "@/lib/domain/dashboard-intel";

/** How safe is it to fire this action straight from the card/drawer? */
export type ActionSafety = "one_click" | "review_required" | "link_only";

export type DashboardActionVia =
  | { type: "form"; action: "propose" | "confirm" | "approveHours" | "snooze" | "dismiss" | "assign" | "remind" | "escalate" }
  | { type: "ai"; prompt: string }
  | { type: "link"; href: string };

export type DashboardAction = {
  label: string;
  kind: "primary" | "secondary";
  safety: ActionSafety;
  /** review_required actions confirm-with-reason (audited) before firing. */
  reasonRequired?: boolean;
  via: DashboardActionVia;
};

/** The five card families the page groups by. */
export type CardType = "fire" | "risk" | "money" | "task" | "opportunity";

/** Why a card can't be fixed instantly — shown so the operator knows where to push. */
export type Blocker = "chef" | "client" | "system" | "money" | "compliance" | "timing";

export type DrawerRoute = "shift" | "open-shift" | "hours" | "queue" | "timeline" | "fill";

export type DashboardCard = {
  kind: AttentionKind;
  cardType: CardType;
  /** Lower = more urgent (mirrors dashboard-intel's PRIORITY). */
  priority: number;
  /** WHAT is wrong (the title). */
  signal: string;
  /** WHY it matters (the "wat gebeurt er nu?" line). */
  why: string;
  /** The suggested concrete next step. */
  nextAction: string;
  blocker?: Blocker;
  entities: { shiftId?: string; placementId?: string; hoursId?: string; clientName?: string };
  drawer: { route: DrawerRoute; id: string };
  actions: DashboardAction[];
  tone: AttentionTone;
  icon: AttentionItem["icon"];
  /** Audit key for any mutation fired from this card, e.g. "dashboard.card.open_shift". */
  auditKey: string;
};

/** Which card family each attention kind belongs to. */
const CARD_TYPE: Record<AttentionKind, CardType> = {
  critical_shift: "fire",
  open_shift: "risk",
  underfilled_shift: "risk",
  accepted_unconfirmed: "risk",
  proposed_no_response: "risk",
  hours_to_approve: "task",
  change_request: "task",
  inbox: "task",
  missing_data: "task",
  system: "task",
};

/** Where a kind's drawer opens (DASH-2 builds these routes; DASH-1 only declares them). */
const DRAWER_ROUTE: Record<AttentionKind, DrawerRoute> = {
  critical_shift: "fill",
  open_shift: "fill",
  underfilled_shift: "fill",
  accepted_unconfirmed: "shift",
  proposed_no_response: "shift",
  hours_to_approve: "hours",
  change_request: "shift",
  inbox: "queue",
  missing_data: "queue",
  system: "queue",
};

/** A sensible default next-step per kind (DASH-4 enriches with shift-specific specifics). */
const NEXT_ACTION: Record<AttentionKind, string> = {
  critical_shift: "Vul deze dienst — stel direct een chef voor",
  open_shift: "Vul deze dienst — stel een chef voor",
  underfilled_shift: "Vul de resterende plek(ken)",
  accepted_unconfirmed: "Bevestig de dienst met de klant",
  proposed_no_response: "Volg de voorgestelde chef(s) op",
  hours_to_approve: "Keur de getekende uren",
  change_request: "Beoordeel het wijzigingsverzoek",
  inbox: "Behandel de nieuwe aanmelding(en)",
  missing_data: "Vul de ontbrekende profielgegevens aan",
  system: "Bekijk de systeemmelding",
};

/**
 * Lift a ranked AttentionItem into a DashboardCard. Ranking is unchanged — callers
 * still `rankAttentionItems()` first, then map. In DASH-1 every card carries one
 * `link_only` action (the existing href + cta); DASH-2 promotes the four high-value
 * kinds to real in-drawer form actions and the rest stay honest links.
 */
export function toCard(item: AttentionItem): DashboardCard {
  return {
    kind: item.kind,
    cardType: CARD_TYPE[item.kind],
    priority: priorityOf(item.kind),
    signal: item.title,
    why: item.detail ?? "",
    nextAction: NEXT_ACTION[item.kind],
    entities: {},
    drawer: { route: DRAWER_ROUTE[item.kind], id: "" },
    actions: [
      {
        label: item.cta ?? "Bekijk",
        kind: "primary",
        safety: "link_only",
        via: { type: "link", href: item.href },
      },
    ],
    tone: item.tone,
    icon: item.icon,
    auditKey: `dashboard.card.${item.kind}`,
  };
}
