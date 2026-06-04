/**
 * Idempotent seed for the native form-builder forms (PR-FB-3).
 *
 * Run with: npm run db:seed:forms
 *
 * Seeds the "chef-onboarding" form — the native replacement for the Jotform
 * "Personal data onboarding". Every field here is a SYSTEM field bound to a
 * typed chefs/chef_documents column via its `system_key` (see
 * src/lib/forms/system-bindings.ts). Planners can relabel/reorder/toggle them
 * and ADD custom fields in the builder; they cannot delete/retype system fields.
 *
 * Idempotency: deterministic text IDs + onConflictDoNothing on the PK. Re-running
 * never duplicates and never clobbers planner edits made in the builder.
 */

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

import { formFields, formSections, forms } from "./schema";
import type { FieldOption, FieldType, FieldValidation } from "@/lib/forms/types";

type SeedField = {
  key: string;
  systemKey?: string;
  type: FieldType;
  label: string;
  required?: boolean;
  isSensitive?: boolean;
  helpText?: string;
  placeholder?: string;
  options?: FieldOption[];
  validation?: FieldValidation;
  documentType?: string;
};

type SeedSection = { id: string; title: string; description?: string; fields: SeedField[] };

const FORM = {
  id: "form_chef_onboarding",
  idPrefix: "co",
  slug: "chef-onboarding",
  title: "Onboarding — jouw gegevens",
  description:
    "Vul je gegevens in zodat we je correct kunnen inplannen en uitbetalen. Gevoelige gegevens (BSN, IBAN, ID) worden versleuteld opgeslagen.",
  audience: "chef",
  status: "published" as const,
  version: 1,
};

const SECTIONS: SeedSection[] = [
  {
    id: "sec_co_1",
    title: "Persoonsgegevens",
    fields: [
      { key: "first_name", systemKey: "chef.first_name", type: "text", label: "Voornaam", required: true },
      { key: "infix", systemKey: "chef.infix", type: "text", label: "Tussenvoegsel" },
      { key: "surname", systemKey: "chef.surname", type: "text", label: "Achternaam", required: true },
      { key: "initials", systemKey: "chef.initials", type: "text", label: "Voorletters", placeholder: "A.B." },
      {
        key: "date_of_birth",
        systemKey: "chef.date_of_birth",
        type: "date",
        label: "Geboortedatum",
        required: true,
        validation: { notFuture: true },
      },
      {
        key: "gender",
        systemKey: "chef.gender",
        type: "select",
        label: "Geslacht",
        required: true,
        options: [
          { value: "man", label: "Man" },
          { value: "vrouw", label: "Vrouw" },
          { value: "anders", label: "Anders" },
          { value: "zeg_ik_liever_niet", label: "Zeg ik liever niet" },
        ],
      },
      { key: "nationality", systemKey: "chef.nationality", type: "text", label: "Nationaliteit", required: true, placeholder: "Nederlandse" },
      { key: "email", systemKey: "chef.email", type: "email", label: "E-mailadres", required: true },
      { key: "phone", systemKey: "chef.phone", type: "phone", label: "Telefoonnummer", required: true },
    ],
  },
  {
    id: "sec_co_2",
    title: "Adres",
    fields: [
      { key: "street", systemKey: "chef.street", type: "text", label: "Straat", required: true },
      { key: "house_number", systemKey: "chef.house_number", type: "text", label: "Huisnummer", required: true },
      { key: "postcode", systemKey: "chef.postcode", type: "postcode", label: "Postcode", required: true, placeholder: "1011 AB" },
      { key: "place_of_residence", systemKey: "chef.place_of_residence", type: "text", label: "Woonplaats", required: true },
      { key: "country", systemKey: "chef.country", type: "country", label: "Land", required: true, placeholder: "Nederland" },
    ],
  },
  {
    id: "sec_co_3",
    title: "Identiteitsbewijs",
    fields: [
      {
        key: "bsn",
        systemKey: "chef.bsn",
        type: "bsn",
        label: "BSN-nummer",
        required: true,
        isSensitive: true,
        helpText: "Je BSN staat op je ID-bewijs en loonstrook. Wordt versleuteld opgeslagen.",
      },
      {
        key: "id_type",
        systemKey: "chef.id_type",
        type: "select",
        label: "Type ID-bewijs",
        required: true,
        options: [
          { value: "passport", label: "Paspoort" },
          { value: "id_card", label: "ID-kaart" },
          { value: "residence_permit", label: "Verblijfsvergunning" },
        ],
      },
      { key: "id_number", systemKey: "chef.id_number", type: "text", label: "Documentnummer", required: true, isSensitive: true },
      {
        key: "id_expires_at",
        systemKey: "chef.id_expires_at",
        type: "date",
        label: "Vervaldatum ID-bewijs",
        required: true,
        validation: { notPast: true },
      },
      { key: "doc_id_front", systemKey: "chef.doc_id_front", type: "file", label: "Kopie ID — voorkant", required: true, documentType: "id_copy_front" },
      { key: "doc_id_back", systemKey: "chef.doc_id_back", type: "file", label: "Kopie ID — achterkant", required: true, documentType: "id_copy_back" },
      {
        key: "doc_bsn_registration",
        systemKey: "chef.doc_bsn_registration",
        type: "file",
        label: "Uittreksel inschrijving gemeente",
        documentType: "bsn_registration",
        helpText: "Alleen nodig als je niet in Nederland geboren bent.",
      },
    ],
  },
  {
    id: "sec_co_4",
    title: "Bankgegevens",
    fields: [
      { key: "iban", systemKey: "chef.iban", type: "iban", label: "IBAN", required: true, isSensitive: true, placeholder: "NL00 BANK 0000 0000 00" },
      { key: "bank_account_holder", systemKey: "chef.bank_account_holder", type: "text", label: "Naam rekeninghouder", required: true },
      {
        key: "doc_bank_card",
        systemKey: "chef.doc_bank_card",
        type: "file",
        label: "Kopie bankpas",
        documentType: "bank_card",
        helpText: "Ter controle van je IBAN. Je mag het pasnummer afschermen.",
      },
    ],
  },
  {
    id: "sec_co_5",
    title: "Loonheffing & pensioen",
    fields: [
      {
        key: "loonheffingskorting",
        systemKey: "chef.loonheffingskorting",
        type: "boolean",
        label: "Loonheffingskorting toepassen?",
        required: true,
        helpText: "Pas dit maar bij één werkgever tegelijk toe.",
      },
      {
        key: "worked_for_client_6mo",
        systemKey: "chef.worked_for_client_6mo",
        type: "boolean",
        label: "Heb je de afgelopen 6 maanden rechtstreeks voor deze opdrachtgever gewerkt?",
        required: true,
      },
      {
        key: "stipp_participated",
        systemKey: "chef.stipp_participated",
        type: "boolean",
        label: "Neem je al deel aan het StiPP-pensioenfonds?",
        required: true,
        helpText: "StiPP is het pensioenfonds voor uitzendkrachten. Twijfel je? Kies 'Nee'.",
      },
      {
        key: "stipp_months",
        systemKey: "chef.stipp_months",
        type: "number",
        label: "Zo ja, hoeveel maanden neem je al deel?",
        validation: { min: 0, max: 600 },
      },
    ],
  },
  {
    id: "sec_co_6",
    title: "Werkprofiel & documenten",
    fields: [
      {
        key: "applying_as",
        systemKey: "chef.applying_as",
        type: "select",
        label: "Ik werk als",
        required: true,
        options: [
          { value: "chef", label: "Chef / keuken" },
          { value: "front_of_house", label: "Bediening / front of house" },
        ],
      },
      {
        key: "employment_type",
        systemKey: "chef.employment_type",
        type: "select",
        label: "Payroll, ZZP of allebei?",
        required: true,
        options: [
          { value: "payroll", label: "Payroll" },
          { value: "zzp", label: "ZZP" },
          { value: "both", label: "Allebei" },
        ],
      },
      { key: "own_transport", systemKey: "chef.own_transport", type: "boolean", label: "Heb je eigen vervoer?", required: true },
      { key: "likes_most", systemKey: "chef.likes_most", type: "textarea", label: "Wat doe je het liefst?", placeholder: "Bijv. fine dining, banqueting, ontbijt…" },
      { key: "bio", systemKey: "chef.bio", type: "textarea", label: "Vertel iets over jezelf" },
      { key: "recent_venues", systemKey: "chef.recent_venues", type: "textarea", label: "Bij welke restaurants/hotels heb je recent gewerkt?" },
      { key: "doc_cv", systemKey: "chef.doc_cv", type: "file", label: "CV", documentType: "cv" },
      { key: "doc_photo", systemKey: "chef.doc_photo", type: "file", label: "Profielfoto", documentType: "photo", helpText: "Een professionele foto helpt bij het voorstellen." },
    ],
  },
];

type DbClient = ReturnType<typeof drizzle>;

type FormDef = {
  id: string;
  idPrefix: string;
  slug: string;
  title: string;
  description: string;
  audience: string;
  status: "draft" | "published" | "archived";
  version: number;
};

/** Stage-1: the SHORT public apply form. Fully admin-editable (custom fields).
 *  Lands in chef_submissions; after a human chat, the office sends the full
 *  onboarding form (Stage 2). */
const APPLY_FORM: FormDef = {
  id: "form_chef_apply",
  idPrefix: "ca",
  slug: "chef-apply",
  title: "Werken bij Chef & Serve",
  description:
    "Laat je gegevens achter — we nemen binnen één werkdag contact op. Daarna sturen we (bij een match) het volledige onboardingformulier.",
  audience: "chef",
  status: "published",
  version: 1,
};

const APPLY_SECTIONS: SeedSection[] = [
  {
    id: "sec_ca_1",
    title: "Aanmelden",
    fields: [
      { key: "full_name", type: "text", label: "Naam", required: true },
      { key: "email", type: "email", label: "E-mailadres", required: true },
      { key: "phone", type: "phone", label: "Telefoonnummer", required: true },
      { key: "city", type: "text", label: "Woonplaats" },
      {
        key: "applying_as",
        type: "select",
        label: "Ik werk als",
        required: true,
        options: [
          { value: "chef", label: "Chef / keuken" },
          { value: "front_of_house", label: "Bediening / front of house" },
        ],
      },
      {
        key: "employment_type",
        type: "select",
        label: "Payroll, ZZP of allebei?",
        options: [
          { value: "payroll", label: "Payroll" },
          { value: "zzp", label: "ZZP" },
          { value: "both", label: "Allebei" },
        ],
      },
      {
        key: "message",
        type: "textarea",
        label: "Vertel kort over je ervaring",
        placeholder: "Waar heb je gewerkt, wat zoek je?",
      },
    ],
  },
];

async function seedFormDef(
  dbClient: DbClient,
  def: FormDef,
  sections: SeedSection[],
  kind: "system" | "custom",
): Promise<void> {
  await dbClient
    .insert(forms)
    .values({
      id: def.id,
      slug: def.slug,
      title: def.title,
      description: def.description,
      audience: def.audience,
      status: def.status,
      version: def.version,
    })
    .onConflictDoNothing({ target: forms.id });

  let sectionOrder = 0;
  for (const section of sections) {
    await dbClient
      .insert(formSections)
      .values({
        id: section.id,
        formId: def.id,
        title: section.title,
        description: section.description ?? null,
        sortOrder: sectionOrder++,
      })
      .onConflictDoNothing({ target: formSections.id });

    let fieldOrder = 0;
    for (const f of section.fields) {
      await dbClient
        .insert(formFields)
        .values({
          id: `fld_${def.idPrefix}_${f.key}`,
          formId: def.id,
          sectionId: section.id,
          kind,
          systemKey: kind === "system" ? (f.systemKey ?? null) : null,
          type: f.type,
          key: f.key,
          label: f.label,
          helpText: f.helpText ?? null,
          placeholder: f.placeholder ?? null,
          required: f.required ?? false,
          isVisible: true,
          isSensitive: f.isSensitive ?? false,
          sortOrder: fieldOrder++,
          options: f.options ?? null,
          validation: f.validation ?? null,
          documentType: (f.documentType ?? null) as never,
        })
        .onConflictDoNothing({ target: formFields.id });
    }
  }
}

export async function seedForms(dbClient: DbClient): Promise<void> {
  await seedFormDef(dbClient, FORM, SECTIONS, "system");
  await seedFormDef(dbClient, APPLY_FORM, APPLY_SECTIONS, "custom");
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
  const dbClient = drizzle(neon(url));
  console.log("🌱 Seeding forms…");
  await seedForms(dbClient);
  const onb = SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  const app = APPLY_SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  console.log(`✓ chef-onboarding: ${SECTIONS.length} sections, ${onb} system fields.`);
  console.log(`✓ chef-apply: ${APPLY_SECTIONS.length} section(s), ${app} fields.`);
}

// Run when invoked directly (tsx src/lib/db/seed-forms.ts), not when imported.
if (process.argv[1] && process.argv[1].includes("seed-forms")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("✗ seed-forms failed:", err);
      process.exit(1);
    });
}
