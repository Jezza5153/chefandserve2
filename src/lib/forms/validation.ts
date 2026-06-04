/**
 * Field validation (PR-FB-2). PURE — the SAME module runs client-side (instant
 * UX) and server-side (authoritative, never trust the client). No db / next imports.
 *
 * All messages are Dutch (chef-facing).
 */

import type { FieldDTO, FormSubmitValue } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NL_POSTCODE_RE = /^[1-9][0-9]{3}\s?[A-Za-z]{2}$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

export function isNlPostcode(s: string): boolean {
  return NL_POSTCODE_RE.test(s.trim());
}

/** Dutch BSN 11-proef. Accepts 8–9 digits (leading zero may be dropped). */
export function bsnElfproef(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 9) return false;
  const padded = digits.padStart(9, "0");
  if (padded === "000000000") return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const weight = i === 8 ? -1 : 9 - i;
    sum += Number(padded[i]) * weight;
  }
  return sum % 11 === 0;
}

/** IBAN mod-97 (ISO 13616). Length-checks NL specifically (18). */
export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(s)) return false;
  if (s.startsWith("NL") && s.length !== 18) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let numeric = "";
  for (const ch of rearranged) {
    numeric += ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
  }
  try {
    return BigInt(numeric) % 97n === 1n;
  } catch {
    return false;
  }
}

function isEmpty(value: FormSubmitValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Validate one field's submitted value. Returns a Dutch error string, or null
 * when valid. File fields are validated by document-presence elsewhere (the
 * value carried here is not the file).
 */
export function validateField(field: FieldDTO, value: FormSubmitValue): string | null {
  if (field.type === "heading") return null;

  // Single checkbox (e.g. an explicit agreement): required ⇒ must be true.
  if (field.type === "checkbox") {
    if (field.required && value !== true) return "Dit veld is verplicht.";
    return null;
  }

  if (isEmpty(value)) {
    if (field.required && field.type !== "file") return "Dit veld is verplicht.";
    return null;
  }

  const v = field.validation;

  switch (field.type) {
    case "file":
      return null; // presence enforced via the uploaded documentId
    case "email":
      return isValidEmail(String(value)) ? null : "Vul een geldig e-mailadres in.";
    case "bsn":
      return bsnElfproef(String(value)) ? null : "Ongeldig BSN (klopt niet met de 11-proef).";
    case "iban":
      return isValidIban(String(value)) ? null : "Ongeldig IBAN-nummer.";
    case "postcode":
      return isNlPostcode(String(value)) ? null : "Ongeldige postcode (bijv. 1011 AB).";
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) return "Vul een getal in.";
      if (v?.min != null && n < v.min) return `Minimaal ${v.min}.`;
      if (v?.max != null && n > v.max) return `Maximaal ${v.max}.`;
      return null;
    }
    case "date": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return "Ongeldige datum.";
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (v?.notFuture && d.getTime() > today.getTime()) return "Datum mag niet in de toekomst liggen.";
      if (v?.notPast && d.getTime() < today.getTime()) return "Datum mag niet in het verleden liggen.";
      return null;
    }
    case "select":
      return field.options?.some((o) => o.value === value) ? null : "Maak een geldige keuze.";
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [value];
      const ok = arr.every((x) => field.options?.some((o) => o.value === x));
      return ok ? null : "Maak een geldige keuze.";
    }
    case "boolean":
      return null;
    default: {
      // text / textarea / phone / country
      const s = String(value);
      if (v?.minLen != null && s.length < v.minLen) return `Minimaal ${v.minLen} tekens.`;
      if (v?.maxLen != null && s.length > v.maxLen) return `Maximaal ${v.maxLen} tekens.`;
      if (v?.pattern) {
        try {
          if (!new RegExp(v.pattern).test(s)) return "Ongeldige invoer.";
        } catch {
          /* ignore a malformed pattern rather than block the user */
        }
      }
      return null;
    }
  }
}

/**
 * Validate a whole form's submitted values. `documentIds` lists the field keys
 * that have an uploaded file (so required file fields can be enforced).
 * Returns a map of fieldKey → error for every invalid field.
 */
export function validateForm(
  fields: FieldDTO[],
  values: Record<string, FormSubmitValue>,
  documentIds: Record<string, string | null> = {},
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "file") {
      if (f.required && !documentIds[f.key]) errors[f.key] = "Upload een bestand.";
      continue;
    }
    const err = validateField(f, values[f.key] ?? null);
    if (err) errors[f.key] = err;
  }
  return errors;
}
