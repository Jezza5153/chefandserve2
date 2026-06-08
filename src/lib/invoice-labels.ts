/**
 * Invoice status → human label + "wat gebeurt er nu?" next step.
 *
 * Hard rule (CLAUDE.md): no raw backend status ever reaches the UI, and every
 * status carries a clear next step. Admin and klant get DIFFERENT framing — the
 * admin acts on the invoice, the klant pays it — so audience is explicit.
 *
 * Klant never sees draft/void: those invoices are filtered out before render,
 * so the klant labels for them are defensive fallbacks only.
 */
/** Mirror of invoiceStatusEnum — a pure type, safe to import from client code. */
export type InvoiceStatus = "draft" | "sent" | "paid" | "void" | "credit";

export type InvoiceTone = "neutral" | "info" | "success" | "warning";

export type InvoiceStatusView = {
  label: string;
  tone: InvoiceTone;
  /** The "wat gebeurt er nu?" line. */
  next: string;
};

export function invoiceStatusView(
  status: InvoiceStatus,
  audience: "admin" | "klant",
): InvoiceStatusView {
  if (audience === "klant") {
    switch (status) {
      case "sent":
        return {
          label: "Te voldoen",
          tone: "info",
          next: "Betaal vóór de vervaldatum onder vermelding van het factuurnummer.",
        };
      case "paid":
        return { label: "Betaald", tone: "success", next: "Bedankt — er is verder niets te doen." };
      case "credit":
        return {
          label: "Creditfactuur",
          tone: "neutral",
          next: "Dit bedrag is met je verrekend.",
        };
      case "draft":
      case "void":
      default:
        return { label: "—", tone: "neutral", next: "" };
    }
  }
  // admin
  switch (status) {
    case "draft":
      return {
        label: "Concept",
        tone: "neutral",
        next: "Controleer de regels en verstuur de factuur naar de klant.",
      };
    case "sent":
      return {
        label: "Verstuurd",
        tone: "info",
        next: "Wachten op betaling. Markeer als betaald zodra het binnen is.",
      };
    case "paid":
      return { label: "Betaald", tone: "success", next: "Afgerond — geen actie nodig." };
    case "void":
      return {
        label: "Geannuleerd",
        tone: "warning",
        next: "Telt niet mee. De uren zijn weer vrij om opnieuw te factureren.",
      };
    case "credit":
      return {
        label: "Creditfactuur",
        tone: "neutral",
        next: "Verrekend met een eerdere factuur.",
      };
    default:
      return { label: status, tone: "neutral", next: "" };
  }
}

/** Tailwind class set for a tone badge (matches the burgundy/ink palette). */
export function invoiceToneClasses(tone: InvoiceTone): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "neutral":
    default:
      return "border-ink-200 bg-bg-gray text-ink-700";
  }
}
