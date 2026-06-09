/**
 * Client system-field binding registry (PR-CLIENT-ONBOARDING) — the parallel of
 * system-bindings.ts for the `client-onboarding` form. The form-builder owns labels/order/
 * required/visibility; TYPE + WRITE TARGET are owned here in code.
 *
 * - target "clients"          → writes the typed clients column `column` (Drizzle camelCase prop).
 * - target "client_documents" → a file field; the upload creates a client_documents row of `docType`.
 * - target "client_contacts"  → fans out into ONE client_contacts row per `contactRole`; the
 *                               `contactField` says which column (name/title/email/phone).
 *
 * NO field-level encryption here: this form has no BSN/IBAN/ID/health/special-category data.
 * (Contact names/emails/phones + the RI&E file are STILL AVG personal/company-sensitive data —
 * never log, expose, or audit-dump them. "B2B" ≠ "not privacy-sensitive".)
 *
 * Pure module — safe to import client + server (just data). Never bind billing/facturatie or
 * `intel` (invoicing + intel teams own those).
 */

import type { FieldType } from "./types";

export type ClientContactField = "name" | "title" | "email" | "phone";

export type ClientSystemBinding = {
  target: "clients" | "client_documents" | "client_contacts";
  /** clients column (Drizzle camelCase prop) — required when target = "clients". */
  column?: string;
  type: FieldType;
  /** client_documents.type — required when target = "client_documents". */
  docType?: string;
  /** Allowed values for enum-backed columns (writeback/validation reject off-list). */
  enumValues?: readonly string[];
  /** client_contacts role + which field — required when target = "client_contacts". */
  contactRole?: string;
  contactField?: ClientContactField;
};

export const CLIENT_SYSTEM_BINDINGS: Record<string, ClientSystemBinding> = {
  // ----- Bedrijfsgegevens (NAW) — companyName/email/phone reused from existing columns -----
  "client.company_name": { target: "clients", column: "companyName", type: "text" },
  "client.handelsnaam": { target: "clients", column: "handelsnaam", type: "text" },
  "client.website": { target: "clients", column: "website", type: "text" },
  "client.email": { target: "clients", column: "email", type: "email" },
  "client.phone": { target: "clients", column: "phone", type: "phone" },
  "client.visit_street": { target: "clients", column: "visitStreet", type: "text" },
  "client.visit_house_number": { target: "clients", column: "visitHouseNumber", type: "text" },
  "client.visit_postcode": { target: "clients", column: "visitPostcode", type: "postcode" },
  "client.visit_city": { target: "clients", column: "visitCity", type: "text" },
  "client.visit_country": { target: "clients", column: "visitCountry", type: "country" },

  // ----- Juridisch -----
  "client.rechtsvorm": {
    target: "clients",
    column: "rechtsvorm",
    type: "select",
    enumValues: ["bv", "nv", "eenmanszaak", "ander"],
  },
  "client.kvk": { target: "clients", column: "kvk", type: "text" },
  "client.btw": { target: "clients", column: "btw", type: "text" },
  "client.rsin": { target: "clients", column: "rsin", type: "text" },
  "client.part_of_holding": { target: "clients", column: "partOfHolding", type: "boolean" },
  "client.holding_name": { target: "clients", column: "holdingName", type: "text" },

  // ----- Contactpersonen (1-to-many → client_contacts rows, one per role) -----
  "client.contact_general_name": { target: "client_contacts", type: "text", contactRole: "general_contact", contactField: "name" },
  "client.contact_general_title": { target: "client_contacts", type: "text", contactRole: "general_contact", contactField: "title" },
  "client.contact_general_phone": { target: "client_contacts", type: "phone", contactRole: "general_contact", contactField: "phone" },
  "client.contact_general_email": { target: "client_contacts", type: "email", contactRole: "general_contact", contactField: "email" },
  "client.contact_finance_name": { target: "client_contacts", type: "text", contactRole: "finance", contactField: "name" },
  "client.contact_finance_title": { target: "client_contacts", type: "text", contactRole: "finance", contactField: "title" },
  "client.contact_finance_phone": { target: "client_contacts", type: "phone", contactRole: "finance", contactField: "phone" },
  "client.contact_finance_email": { target: "client_contacts", type: "email", contactRole: "finance", contactField: "email" },
  "client.contact_signing_name": { target: "client_contacts", type: "text", contactRole: "signing_authority", contactField: "name" },
  "client.contact_signing_title": { target: "client_contacts", type: "text", contactRole: "signing_authority", contactField: "title" },
  "client.contact_signing_phone": { target: "client_contacts", type: "phone", contactRole: "signing_authority", contactField: "phone" },
  "client.contact_signing_email": { target: "client_contacts", type: "email", contactRole: "signing_authority", contactField: "email" },

  // ----- Werkcontext (light operational facts) -----
  "client.primary_work_types": { target: "clients", column: "primaryWorkTypes", type: "multiselect" },
  "client.usual_needed_roles": { target: "clients", column: "usualNeededRoles", type: "multiselect" },
  "client.main_shift_types": { target: "clients", column: "mainShiftTypes", type: "multiselect" },
  "client.kitchen_language": { target: "clients", column: "kitchenLanguage", type: "select" },
  "client.chef_must_bring": { target: "clients", column: "chefMustBring", type: "multiselect" },
  "client.parking_available": { target: "clients", column: "parkingAvailable", type: "boolean" },
  "client.meal_included": { target: "clients", column: "mealIncluded", type: "boolean" },
  "client.work_clothing_required": { target: "clients", column: "workClothingRequired", type: "text" },

  // ----- CAO & arbeidsvoorwaarden -----
  "client.cao_applicable": { target: "clients", column: "caoApplicable", type: "boolean" },
  "client.cao_name": { target: "clients", column: "caoName", type: "text" },
  "client.own_work_regulations": { target: "clients", column: "ownWorkRegulations", type: "boolean" },
  "client.inlenersbeloning": { target: "clients", column: "inlenersbeloning", type: "boolean" },
  "client.pension_scheme": { target: "clients", column: "pensionScheme", type: "boolean" },
  "client.travel_cost_policy": { target: "clients", column: "travelCostPolicy", type: "textarea" },
  "client.overtime_policy": { target: "clients", column: "overtimePolicy", type: "textarea" },

  // ----- RI&E / veiligheid & overeenkomst -----
  "client.rie_available": { target: "clients", column: "rieAvailable", type: "boolean" },
  "client.rie_date": { target: "clients", column: "rieDate", type: "date" },
  "client.workplace_safe": { target: "clients", column: "workplaceSafe", type: "boolean" },
  "client.safety_instructions": { target: "clients", column: "safetyInstructions", type: "textarea" },
  "client.pbm_required": { target: "clients", column: "pbmRequired", type: "boolean" },
  "client.vog_required": { target: "clients", column: "vogRequired", type: "boolean" },
  "client.contract_start_date": { target: "clients", column: "contractStartDate", type: "date" },
  "client.doc_rie": { target: "client_documents", type: "file", docType: "rie_document" },
};

export function getClientSystemBinding(systemKey: string | null | undefined): ClientSystemBinding | null {
  if (!systemKey) return null;
  return CLIENT_SYSTEM_BINDINGS[systemKey] ?? null;
}

/** Contact roles this form collects (used to group contact fields in the writeback). */
export const CLIENT_CONTACT_ROLES = ["general_contact", "finance", "signing_authority"] as const;

/** No encrypted columns on this form (no special-category data) — kept for AVG-lane symmetry. */
export const ENCRYPTED_CLIENT_COLUMNS: string[] = [];
