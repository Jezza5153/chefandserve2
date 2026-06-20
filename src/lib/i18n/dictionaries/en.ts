/**
 * CHEF-PR11 — English dictionary. Typed as `Dict` (defined by nl.ts), so the
 * compiler fails the build if a key is missing or misspelled. Keep keys in the
 * same order as nl.ts for easy diffing.
 */
import type { Dict } from "@/lib/i18n/dictionaries/nl";

export const en: Dict = {
  language: {
    label: "Language",
    dutch: "Nederlands",
    english: "English",
    switchToEnglish: "Switch to English",
    switchToDutch: "Switch to Dutch",
  },
  common: {
    more: "More",
    moreMenu: "More menu",
    close: "Close",
    back: "Back",
    save: "Save",
    cancel: "Cancel",
    loading: "Loading…",
    shift: "shift",
    shifts: "shifts",
    estimate: "estimate",
    noteOptional: "Note (optional)",
    amountError: "Something went wrong — check the amount and try again.",
    noChefProfile: "No chef profile linked to this account.",
    aClient: "a client",
  },
  status: {
    approved: "Approved",
    rejected: "Rejected",
    cancelled: "Cancelled",
    pending: "In review",
    concept: "Draft",
    paid: "Paid",
  },
  nav: {
    today: "Today",
    open: "Open",
    available: "Available",
    money: "Money",
    profile: "Profile",
    myShifts: "My shifts",
    hours: "Hours",
    moneyExplained: "Money explained",
    expenses: "Expenses",
    invoices: "Invoices",
    myDocuments: "My documents",
    notifications: "Notifications",
    board: "Board",
    calendarFeed: "Calendar feed",
    onboarding: "Onboarding",
    privacy: "Privacy",
  },
  earnings: {
    eyebrow: "Earnings",
    title: "Earnings & patterns",
    intro:
      "What you've earned from approved hours, and your work pattern. Questions about a payment? Call or email the office.",
    totalEarned: "Total earned",
    totalEarnedSub: "from all approved hours",
    last30: "Last 30 days",
    last30Sub: "recently approved",
    forecastLabel: "Expected · next {days} days",
    forecastEmpty:
      "No confirmed shifts scheduled yet. Once you're rostered, you'll see what you expect to earn here.",
    forecastDisclaimer:
      "Estimate based on your confirmed shifts. Clients can still cancel and breaks aren't deducted here yet — so the real amount may be lower.",
    whenPaid: "When do I get paid?",
    onTheWay: "On its way to you:",
    paymentsDisclaimer:
      "Estimate based on your submitted hours and your rate. The office and payroll confirm the final amount and the payout date.",
    andMore: "+ {n} more",
    vacationTitle: "Holiday pay (estimate)",
    vacationBodyA: "Roughly {pct}% on {basis} of approved hours. This is an ",
    vacationBodyB: " — payroll keeps the official accrual and payout.",
    assumptionsUpdated: "Assumptions updated: {date}",
    noData:
      "You don't have any completed shifts yet. Once you've worked and the hours are approved, you'll see your earnings and pattern here.",
    perClient: "Earned per client",
    workdays: "Your workdays",
    busiestOn: "You usually work on",
    roles: "Your roles",
    outstandingPre: "You can see your outstanding and in-progress amounts on your ",
    dashboardLink: "dashboard",
  },
  payments: {
    stages: {
      to_submit: {
        label: "Still to submit",
        nextStep: "Submit your hours so the client can sign off.",
      },
      awaiting_client: {
        label: "Waiting on client signature",
        nextStep:
          "The client needs to sign your hours. Taking a while? The office sends a reminder.",
      },
      awaiting_office: {
        label: "Waiting on office approval",
        nextStep: "Chef & Serve reviews and approves the signed hours.",
      },
      approved: {
        label: "Approved — being paid out",
        nextStep: "Your hours are approved and go into the next payroll run.",
      },
      paid_out: {
        label: "Sent for payout",
        nextStep: "Handed to payroll. The payout date depends on the pay run.",
      },
      rejected: {
        label: "Sent back — action needed",
        nextStep: "Something wasn't right. Adjust your hours or contact the office.",
      },
    },
  },
  expenses: {
    eyebrow: "Expenses",
    title: "Holiday pay & expenses",
    intro:
      "Request your holiday pay or claim expenses you've made. These are requests — the office reviews them and payroll confirms the final amounts.",
    okVacation: "✓ Your holiday-pay request has been submitted — the office is reviewing it.",
    okExpense: "✓ Your expense claim has been submitted — the office is reviewing it.",
    vacationPayout: "Pay out holiday pay",
    vacationEstimateA: "Estimated accrued: ",
    vacationEstimateB:
      " (estimate, ~{pct}% on your approved hours). Payroll confirms the real balance.",
    amountField: "Amount (€)",
    submitRequest: "Submit request",
    declareCosts: "Claim expenses",
    declareIntro:
      "Travel, parking, public transport or mileage for a shift? Claim them here.",
    kindField: "Type",
    descriptionOptional: "Description (optional)",
    submitClaim: "Submit claim",
    yourRequests: "Your requests",
    vacationItem: "Holiday pay",
    receiptLabel: "Receipt (photo, optional)",
    categories: {
      reiskosten: "Travel costs",
      parkeren: "Parking",
      ov: "Public transport",
      kilometers: "Mileage",
      overig: "Other",
    },
  },
  invoices: {
    eyebrow: "Invoices",
    title: "Your invoices",
    intro:
      "As a freelancer you send Chef & Serve an invoice for your approved hours. Below you see what's ready, submit your invoice and track its status.",
    okSubmitted: "✓ Your invoice has been submitted — the office is reviewing it.",
    nonZzpBody:
      "Invoices are for freelancers. Work via payroll? Then Chef & Serve handles your payout — you don't need to invoice. Doesn't match your situation? Adjust your preference under Availability or call the office.",
    readyTitle: "Ready to invoice",
    readyBody: " of approved hours ({count} {unit}). This is an estimate — put the amount on your own invoice.",
    readyEmpty: "No approved hours ready to invoice yet.",
    submitTitle: "Submit invoice",
    amountField: "Amount incl. or excl. VAT (€)",
    amountPlaceholder: "e.g. 540.00",
    periodFrom: "Period from",
    periodTo: "to",
    referenceField: "Your invoice number (optional)",
    submitInvoice: "Submit invoice",
    yourInvoices: "Your invoices",
    uploadLabel: "Invoice (PDF, optional)",
  },
};
