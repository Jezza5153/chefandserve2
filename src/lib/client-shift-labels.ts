/**
 * Client shift labels — PR-KLANT-0.
 *
 * THE single source of klant-facing status copy. Maps backend statuses
 * (placement + hours) to `{ humanStatus, nextStep, allowedActions }`.
 * Used by the shift hub, the dashboard cards, and the requests list so
 * the wording is identical everywhere and NO raw backend status reaches
 * the UI (hard rule).
 *
 * "Wat gebeurt er nu?" = nextStep — rendered on every klant surface.
 */

export type ClientAllowedAction =
  | "comment" // send a comment on the proposed chef
  | "change_request" // request a change to the shift
  | "cancel_request" // request a cancellation
  | "sign_hours" // approve submitted hours
  | "reject_hours" // dispute submitted hours
  | "rate_chef" // leave feedback after approval
  | "contact"; // contact card available

export type ClientShiftLabel = {
  humanStatus: string;
  nextStep: string;
  allowedActions: ClientAllowedAction[];
};

/**
 * Inputs are the raw backend statuses. `placementStatus` is the best
 * (most-progressed) placement on the shift; `hoursStatus` is its
 * shift_hours row status if one exists. `hasPlacement=false` means the
 * shift is still open with no chef proposed.
 */
export function getClientShiftLabel(args: {
  shiftStatus: string;
  hasPlacement: boolean;
  placementStatus?: string | null;
  hoursStatus?: string | null;
}): ClientShiftLabel {
  const { hasPlacement, placementStatus, hoursStatus } = args;

  // Hours lifecycle takes precedence once a chef worked the shift.
  if (hoursStatus) {
    switch (hoursStatus) {
      case "submitted":
        return {
          humanStatus: "Uren wachten op jouw akkoord",
          nextStep: "Controleer de ingediende uren en geef akkoord (of niet).",
          allowedActions: ["sign_hours", "reject_hours", "contact"],
        };
      case "client_signed":
        return {
          humanStatus: "Door jou akkoord",
          nextStep: "Chef & Serve controleert de uren nu.",
          allowedActions: ["contact"],
        };
      case "client_rejected":
        return {
          humanStatus: "Uren teruggegeven aan chef",
          nextStep: "De chef past de uren aan en dient opnieuw in.",
          allowedActions: ["contact"],
        };
      case "admin_approved":
        return {
          humanStatus: "Goedgekeurd voor uitbetaling",
          nextStep: "Dit gaat mee in de administratie. Geef je chef feedback.",
          allowedActions: ["rate_chef", "contact"],
        };
      case "admin_rejected":
        return {
          humanStatus: "Uren in correctie",
          nextStep: "Chef & Serve stemt de uren af met de chef.",
          allowedActions: ["contact"],
        };
      case "exported":
        return {
          humanStatus: "Afgerond",
          nextStep: "Uitbetaald en gefactureerd.",
          allowedActions: ["rate_chef"],
        };
      case "draft":
        // hours row exists but chef hasn't submitted
        return {
          humanStatus: "Uren nog niet ingediend",
          nextStep: "De chef vult de uren in na de shift.",
          allowedActions: ["contact"],
        };
    }
  }

  // No hours yet — placement lifecycle.
  if (hasPlacement && placementStatus) {
    switch (placementStatus) {
      case "proposed":
        return {
          humanStatus: "Chef voorgesteld",
          nextStep: "Chef & Serve bevestigt de match. Je kunt een opmerking meesturen.",
          allowedActions: ["comment", "change_request", "cancel_request"],
        };
      case "accepted":
        return {
          humanStatus: "Chef heeft toegezegd",
          nextStep: "Chef & Serve bevestigt de shift definitief.",
          allowedActions: ["change_request", "cancel_request"],
        };
      case "confirmed":
        return {
          humanStatus: "Shift bevestigd",
          nextStep: "De chef komt op de afgesproken tijd.",
          allowedActions: ["change_request", "cancel_request", "contact"],
        };
      case "cancelled":
        return {
          humanStatus: "Geannuleerd",
          nextStep: "Wij zoeken een nieuwe chef of een vervangend voorstel.",
          allowedActions: [],
        };
      case "rejected":
        return {
          humanStatus: "Chef niet beschikbaar",
          nextStep: "Chef & Serve zoekt een andere passende chef.",
          allowedActions: ["cancel_request"],
        };
      case "no_show":
        return {
          humanStatus: "Chef niet verschenen",
          nextStep: "Chef & Serve neemt direct contact met je op.",
          allowedActions: ["contact"],
        };
      case "completed":
        return {
          humanStatus: "Shift afgerond",
          nextStep: "Wacht op de uren van de chef.",
          allowedActions: ["contact"],
        };
    }
  }

  // No placement — shift still open / being planned.
  if (args.shiftStatus === "cancelled") {
    return {
      humanStatus: "Geannuleerd",
      nextStep: "Deze shift is geannuleerd.",
      allowedActions: [],
    };
  }
  return {
    humanStatus: "Wacht op planning",
    nextStep: "Chef & Serve zoekt een passende chef voor je.",
    allowedActions: ["cancel_request"],
  };
}

/** Convenience: is a given action allowed for a label? */
export function actionAllowed(
  label: ClientShiftLabel,
  action: ClientAllowedAction,
): boolean {
  return label.allowedActions.includes(action);
}
