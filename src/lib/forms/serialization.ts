/**
 * Value coercion (PR-FB-2). PURE. Turns a submitted FormSubmitValue into the
 * shape stored in either a typed chefs column (system field) or the EAV typed
 * columns (custom field). Encryption is applied separately in the writeback
 * (after coercion) so this module stays pure + client-safe.
 */

import type { FieldDTO, FieldType, FormSubmitValue } from "./types";

/**
 * Coerce a value for a system-bound `chefs` column (pre-encryption).
 * Returns the scalar to `.set()`, or null when empty.
 */
export function toColumnValue(type: FieldType, value: FormSubmitValue): string | number | boolean | null {
  if (value === null || value === undefined || value === "") return null;
  switch (type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "boolean":
    case "checkbox":
      return typeof value === "boolean" ? value : value === "true" || value === "on";
    case "iban":
      return String(value).replace(/\s+/g, "").toUpperCase();
    case "bsn":
      return String(value).replace(/\D/g, "");
    case "postcode":
      return String(value).replace(/\s+/g, " ").trim().toUpperCase();
    case "date":
      // store the YYYY-MM-DD string (drizzle `date` default mode is string)
      return String(value).slice(0, 10);
    default:
      return String(value).trim();
  }
}

export type EavValue = {
  valueText: string | null;
  valueNumber: string | null; // numeric column ⇒ drizzle expects a string
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
};

const EMPTY_EAV: EavValue = {
  valueText: null,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
};

/** Map a submitted custom-field value to the EAV typed columns. */
export function toEavValue(field: FieldDTO, value: FormSubmitValue): EavValue {
  if (value === null || value === undefined || value === "") return { ...EMPTY_EAV };
  switch (field.type) {
    case "number":
      return { ...EMPTY_EAV, valueNumber: String(typeof value === "number" ? value : Number(value)) };
    case "boolean":
    case "checkbox":
      return {
        ...EMPTY_EAV,
        valueBoolean: typeof value === "boolean" ? value : value === "true" || value === "on",
      };
    case "date":
      return { ...EMPTY_EAV, valueDate: String(value).slice(0, 10) };
    case "multiselect":
      return { ...EMPTY_EAV, valueJson: Array.isArray(value) ? value : [value] };
    default:
      return { ...EMPTY_EAV, valueText: String(value).trim() };
  }
}

/** Mask an encrypted PII plaintext for client echo — e.g. "•••• •••• 4300". */
export function maskPiiHint(plaintext: string | null): string | null {
  if (!plaintext) return null;
  const trimmed = plaintext.replace(/\s+/g, "");
  if (trimmed.length <= 4) return "••••";
  return `•••• ${trimmed.slice(-4)}`;
}
