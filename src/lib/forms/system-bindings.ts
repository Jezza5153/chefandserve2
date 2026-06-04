/**
 * System-field binding registry (PR-FB-2). The form-builder lets planners edit
 * labels/order/required/visibility of these fields, but their TYPE and where they
 * WRITE is owned here in code — payroll + typed KPIs depend on it, so a DB edit can
 * never repoint BSN at the wrong column.
 *
 * - target "chefs"          → writes to the typed chefs column `column` (camelCase
 *                             Drizzle prop). `encrypted` ⇒ AES-256-GCM via piiCipher.
 * - target "chef_documents" → a file field; the upload creates a chef_documents row
 *                             of `docType`. No chefs column.
 *
 * `enumValues` lists the allowed values for columns backed by a pg enum (applyingAs,
 * employmentType) so the writeback/validation can reject anything off-list.
 *
 * Pure module — safe to import from client + server (it's just data).
 */

import type { FieldType } from "./types";

export type SystemBinding = {
  target: "chefs" | "chef_documents";
  /** chefs column (Drizzle camelCase prop) — required when target = "chefs". */
  column?: string;
  type: FieldType;
  /** Encrypt before storing (special-category PII). */
  encrypted?: boolean;
  /** chef_documents.type — required when target = "chef_documents". */
  docType?: string;
  /** Allowed values for enum-backed columns. */
  enumValues?: readonly string[];
};

export const SYSTEM_BINDINGS: Record<string, SystemBinding> = {
  // ----- name (fullName is recomputed from these in the writeback) -----
  "chef.first_name": { target: "chefs", column: "firstName", type: "text" },
  "chef.infix": { target: "chefs", column: "infix", type: "text" },
  "chef.surname": { target: "chefs", column: "surname", type: "text" },
  "chef.initials": { target: "chefs", column: "initials", type: "text" },

  // ----- contact -----
  "chef.email": { target: "chefs", column: "email", type: "email" },
  "chef.phone": { target: "chefs", column: "phone", type: "phone" },

  // ----- demographics / identity -----
  "chef.bsn": { target: "chefs", column: "bsnEncrypted", type: "bsn", encrypted: true },
  "chef.date_of_birth": { target: "chefs", column: "dateOfBirth", type: "date" },
  "chef.gender": { target: "chefs", column: "gender", type: "select" },
  "chef.nationality": { target: "chefs", column: "nationality", type: "text" },

  // ----- address -----
  "chef.street": { target: "chefs", column: "street", type: "text" },
  "chef.house_number": { target: "chefs", column: "houseNumber", type: "text" },
  "chef.postcode": { target: "chefs", column: "postcode", type: "postcode" },
  "chef.place_of_residence": { target: "chefs", column: "placeOfResidence", type: "text" },
  "chef.country": { target: "chefs", column: "country", type: "country" },

  // ----- ID document -----
  "chef.id_type": { target: "chefs", column: "idType", type: "select" },
  "chef.id_number": { target: "chefs", column: "idNumberEncrypted", type: "text", encrypted: true },
  "chef.id_expires_at": { target: "chefs", column: "idExpiresAt", type: "date" },

  // ----- banking -----
  "chef.iban": { target: "chefs", column: "ibanEncrypted", type: "iban", encrypted: true },
  "chef.bank_account_holder": { target: "chefs", column: "bankAccountHolderName", type: "text" },

  // ----- payroll flags -----
  "chef.loonheffingskorting": { target: "chefs", column: "loonheffingskorting", type: "boolean" },
  "chef.worked_for_client_6mo": { target: "chefs", column: "workedForClientLast6mo", type: "boolean" },
  "chef.stipp_participated": { target: "chefs", column: "stippParticipated", type: "boolean" },
  "chef.stipp_months": { target: "chefs", column: "stippMonths", type: "number" },
  "chef.own_transport": { target: "chefs", column: "ownTransport", type: "boolean" },

  // ----- role / employment (enum-backed columns) -----
  "chef.applying_as": {
    target: "chefs",
    column: "applyingAs",
    type: "select",
    enumValues: ["chef", "front_of_house"],
  },
  "chef.employment_type": {
    target: "chefs",
    column: "employmentType",
    type: "select",
    enumValues: ["payroll", "zzp", "both"],
  },

  // ----- narrative -----
  "chef.likes_most": { target: "chefs", column: "likesMost", type: "textarea" },
  "chef.bio": { target: "chefs", column: "bio", type: "textarea" },
  "chef.recent_venues": { target: "chefs", column: "recentVenues", type: "textarea" },

  // ----- document uploads (target chef_documents) -----
  "chef.doc_bsn_registration": { target: "chef_documents", type: "file", docType: "bsn_registration" },
  "chef.doc_id_front": { target: "chef_documents", type: "file", docType: "id_copy_front" },
  "chef.doc_id_back": { target: "chef_documents", type: "file", docType: "id_copy_back" },
  "chef.doc_bank_card": { target: "chef_documents", type: "file", docType: "bank_card" },
  "chef.doc_photo": { target: "chef_documents", type: "file", docType: "photo" },
  "chef.doc_cv": { target: "chef_documents", type: "file", docType: "cv" },
};

export function getSystemBinding(systemKey: string | null | undefined): SystemBinding | null {
  if (!systemKey) return null;
  return SYSTEM_BINDINGS[systemKey] ?? null;
}

/** Columns that hold encrypted PII — used by the AVG export/erasure lanes. */
export const ENCRYPTED_CHEF_COLUMNS = Object.values(SYSTEM_BINDINGS)
  .filter((b) => b.target === "chefs" && b.encrypted && b.column)
  .map((b) => b.column as string);
