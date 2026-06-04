/**
 * Form-builder shared types (PR-FB-2). Pure — safe to import from client + server.
 *
 * The engine renders a FormDTO (sections → fields). System-bound fields write to
 * typed chefs/chef_documents columns via the binding registry (system-bindings.ts);
 * custom fields write to the chef_field_values EAV table.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "boolean"
  | "file"
  | "iban"
  | "bsn"
  | "postcode"
  | "country"
  | "heading";

export type FieldOption = { value: string; label: string };

export type FieldValidation = {
  minLen?: number;
  maxLen?: number;
  min?: number;
  max?: number;
  pattern?: string;
  /** date fields */
  notFuture?: boolean;
  notPast?: boolean;
  /** file fields */
  maxFileMb?: number;
  accept?: string;
};

/** A form field hydrated for the renderer. */
export type FieldDTO = {
  id: string;
  key: string;
  kind: "system" | "custom";
  systemKey: string | null;
  type: FieldType;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  required: boolean;
  isSensitive: boolean;
  options: FieldOption[] | null;
  validation: FieldValidation | null;
  /** chef_documents.type for file fields. */
  documentType: string | null;
};

export type SectionDTO = {
  id: string;
  title: string;
  description: string | null;
  fields: FieldDTO[];
};

export type FormDTO = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  version: number;
  sections: SectionDTO[];
};

/**
 * A value submitted from the client for one field. File fields are NOT carried
 * here — they're uploaded out-of-band and referenced by their chef_documents id.
 */
export type FormSubmitValue = string | string[] | boolean | number | null;

/** Hydrated current value for resume / masked display in the renderer. */
export type FieldValueDTO =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "multi"; value: string[] }
  // encrypted PII: never send plaintext to the client, only "filled" + a hint
  | { kind: "masked"; filled: boolean; hint: string | null }
  | { kind: "file"; documentId: string | null; filename: string | null; status: string | null };
