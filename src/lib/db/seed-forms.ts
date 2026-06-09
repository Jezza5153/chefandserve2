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

/** Stage-1: the public klant staff-request form (PR-K2-1). The native replacement
 *  for the Jotform "Horecapersoneel aanvragen". Fully admin-editable (custom
 *  fields). Lands in client_submissions (source 'native_request'); the office
 *  triages it in the inbox and converts it to a client + shift. */
const CLIENT_REQUEST_FORM: FormDef = {
  id: "form_client_request",
  idPrefix: "cr",
  slug: "client-request",
  title: "Horecapersoneel aanvragen",
  description:
    "Laat weten wat je zoekt — we koppelen je binnen 4 werkuren aan de juiste chefs, koks of bediening.",
  audience: "client",
  status: "published",
  version: 1,
};

const CLIENT_REQUEST_SECTIONS: SeedSection[] = [
  {
    id: "sec_cr_1",
    title: "Jouw aanvraag",
    fields: [
      { key: "full_name", type: "text", label: "Naam", required: true },
      { key: "company", type: "text", label: "Bedrijf / locatie", required: true },
      { key: "email", type: "email", label: "E-mailadres", required: true },
      { key: "phone", type: "phone", label: "Telefoonnummer", required: true },
      { key: "city", type: "text", label: "Plaats", placeholder: "Bijv. Amsterdam" },
      {
        key: "role_sought",
        type: "select",
        label: "Wat zoek je?",
        required: true,
        options: [
          { value: "chef", label: "Chef / kok" },
          { value: "sous_chef", label: "Sous-chef" },
          { value: "chef_de_partie", label: "Chef de partie" },
          { value: "commis", label: "Commis" },
          { value: "bediening", label: "Bediening / service" },
          { value: "runner", label: "Runner" },
          { value: "recruitment", label: "Werving & selectie" },
          { value: "anders", label: "Anders / weet ik nog niet" },
        ],
      },
      {
        key: "segment",
        type: "select",
        label: "Type horeca",
        options: [
          { value: "casual", label: "Casual / brasserie" },
          { value: "fine_dining", label: "Fine dining" },
          { value: "hotel", label: "Hotel" },
          { value: "catering", label: "Catering" },
          { value: "event", label: "Evenement" },
          { value: "corporate", label: "Corporate / bedrijfsrestaurant" },
        ],
      },
      { key: "date_needed", type: "date", label: "Wanneer heb je iemand nodig?" },
      {
        key: "headcount",
        type: "number",
        label: "Hoeveel personen?",
        validation: { min: 1, max: 999 },
      },
      {
        key: "message",
        type: "textarea",
        label: "Toelichting",
        placeholder: "Vertel kort wat je zoekt, voor welke dagen/uren, en eventuele wensen.",
      },
    ],
  },
];

/** Stage-2: the native CLIENT onboarding (PR-CLIENT-ONBOARDING) — replaces the Jotform
 *  "BEDRIJFSGEGEVENS". All SYSTEM fields bound to typed clients / client_contacts /
 *  client_documents columns via client-system-bindings.ts. Billing/facturatie is EXCLUDED
 *  (invoicing team owns it); judgment ("Maarten brein") lives in clients.intel (intel team). */
const CLIENT_ONBOARDING_FORM: FormDef = {
  id: "form_client_onboarding",
  idPrefix: "clo",
  slug: "client-onboarding",
  title: "Bedrijfsgegevens — onboarding",
  description:
    "Vul de gegevens van je organisatie in zodat we de samenwerking correct en veilig kunnen inrichten.",
  audience: "client",
  status: "published",
  version: 1,
};

const WORK_TYPE_OPTS: FieldOption[] = [
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "catering", label: "Catering" },
  { value: "eventlocatie", label: "Eventlocatie" },
  { value: "zorginstelling", label: "Zorginstelling" },
  { value: "productiekeuken", label: "Productiekeuken" },
  { value: "anders", label: "Anders" },
];
const ROLE_OPTS: FieldOption[] = [
  { value: "zelfstandig_kok", label: "Zelfstandig werkend kok" },
  { value: "sous_chef", label: "Sous-chef" },
  { value: "chef_de_partie", label: "Chef de partie" },
  { value: "ontbijtkok", label: "Ontbijtkok" },
  { value: "banqueting_chef", label: "Banqueting chef" },
  { value: "afwasser", label: "Afwasser / steward" },
  { value: "bediening", label: "Bedieningsmedewerker" },
  { value: "anders", label: "Anders" },
];
const SHIFT_OPTS: FieldOption[] = [
  { value: "ontbijt", label: "Ontbijt" },
  { value: "lunch", label: "Lunch" },
  { value: "diner", label: "Diner" },
  { value: "banqueting", label: "Banqueting" },
  { value: "events", label: "Events" },
  { value: "weekend", label: "Weekend" },
  { value: "last_minute", label: "Last-minute inval" },
];
const BRING_OPTS: FieldOption[] = [
  { value: "messen", label: "Messen" },
  { value: "koksbuis", label: "Koksbuis" },
  { value: "veiligheidsschoenen", label: "Veiligheidsschoenen" },
  { value: "anders", label: "Anders" },
];

const CLIENT_ONBOARDING_SECTIONS: SeedSection[] = [
  {
    id: "sec_clo_1",
    title: "Bedrijfsgegevens",
    fields: [
      { key: "company_name", systemKey: "client.company_name", type: "text", label: "Bedrijfsnaam", required: true },
      { key: "handelsnaam", systemKey: "client.handelsnaam", type: "text", label: "Handelsnaam (indien afwijkend)" },
      { key: "email", systemKey: "client.email", type: "email", label: "E-mailadres (algemeen)", required: true },
      { key: "phone", systemKey: "client.phone", type: "phone", label: "Telefoonnummer (algemeen)" },
      { key: "website", systemKey: "client.website", type: "text", label: "Website", placeholder: "https://" },
      { key: "visit_street", systemKey: "client.visit_street", type: "text", label: "Bezoekadres — straat" },
      { key: "visit_house_number", systemKey: "client.visit_house_number", type: "text", label: "Huisnummer" },
      { key: "visit_postcode", systemKey: "client.visit_postcode", type: "postcode", label: "Postcode", placeholder: "1011 AB" },
      { key: "visit_city", systemKey: "client.visit_city", type: "text", label: "Stad" },
      { key: "visit_country", systemKey: "client.visit_country", type: "country", label: "Land", placeholder: "Nederland" },
    ],
  },
  {
    id: "sec_clo_2",
    title: "Juridische gegevens",
    fields: [
      {
        key: "rechtsvorm", systemKey: "client.rechtsvorm", type: "select", label: "Rechtsvorm", required: true,
        options: [
          { value: "bv", label: "BV" },
          { value: "nv", label: "NV" },
          { value: "eenmanszaak", label: "Eenmanszaak" },
          { value: "ander", label: "Anders" },
        ],
      },
      { key: "kvk", systemKey: "client.kvk", type: "text", label: "KVK-nummer", required: true },
      { key: "btw", systemKey: "client.btw", type: "text", label: "BTW-nummer" },
      { key: "rsin", systemKey: "client.rsin", type: "text", label: "RSIN (indien van toepassing)" },
      { key: "part_of_holding", systemKey: "client.part_of_holding", type: "boolean", label: "Onderdeel van een holding?" },
      { key: "holding_name", systemKey: "client.holding_name", type: "text", label: "Zo ja, naam van de holding" },
    ],
  },
  {
    id: "sec_clo_3",
    title: "Contactpersonen",
    description: "Eén algemeen contact is verplicht. Financieel + tekenbevoegde mogen hetzelfde zijn — vul ze alleen in als ze afwijken.",
    fields: [
      { key: "contact_general_name", systemKey: "client.contact_general_name", type: "text", label: "Algemeen contact — naam", required: true },
      { key: "contact_general_title", systemKey: "client.contact_general_title", type: "text", label: "Functie" },
      { key: "contact_general_phone", systemKey: "client.contact_general_phone", type: "phone", label: "Telefoonnummer" },
      { key: "contact_general_email", systemKey: "client.contact_general_email", type: "email", label: "E-mailadres", required: true },
      { key: "contact_finance_name", systemKey: "client.contact_finance_name", type: "text", label: "Financieel contact — naam" },
      { key: "contact_finance_title", systemKey: "client.contact_finance_title", type: "text", label: "Functie" },
      { key: "contact_finance_phone", systemKey: "client.contact_finance_phone", type: "phone", label: "Telefoonnummer" },
      { key: "contact_finance_email", systemKey: "client.contact_finance_email", type: "email", label: "E-mailadres" },
      { key: "contact_signing_name", systemKey: "client.contact_signing_name", type: "text", label: "Tekenbevoegde — naam" },
      { key: "contact_signing_title", systemKey: "client.contact_signing_title", type: "text", label: "Functie" },
      { key: "contact_signing_phone", systemKey: "client.contact_signing_phone", type: "phone", label: "Telefoonnummer" },
      { key: "contact_signing_email", systemKey: "client.contact_signing_email", type: "email", label: "E-mailadres" },
    ],
  },
  {
    id: "sec_clo_4",
    title: "Werkcontext",
    description: "Een paar praktische vragen zodat we meteen de juiste mensen kunnen sturen.",
    fields: [
      { key: "primary_work_types", systemKey: "client.primary_work_types", type: "multiselect", label: "Type bedrijf", options: WORK_TYPE_OPTS },
      { key: "usual_needed_roles", systemKey: "client.usual_needed_roles", type: "multiselect", label: "Welke rollen heb je meestal nodig?", options: ROLE_OPTS },
      { key: "main_shift_types", systemKey: "client.main_shift_types", type: "multiselect", label: "Welke diensten vooral?", options: SHIFT_OPTS },
      {
        key: "kitchen_language", systemKey: "client.kitchen_language", type: "select", label: "Voertaal in de keuken",
        options: [
          { value: "nederlands", label: "Nederlands" },
          { value: "engels", label: "Engels" },
          { value: "beide", label: "Beide" },
          { value: "anders", label: "Anders" },
        ],
      },
      { key: "chef_must_bring", systemKey: "client.chef_must_bring", type: "multiselect", label: "Wat moet de chef zelf meenemen?", options: BRING_OPTS },
      { key: "parking_available", systemKey: "client.parking_available", type: "boolean", label: "Is er parkeergelegenheid?" },
      { key: "meal_included", systemKey: "client.meal_included", type: "boolean", label: "Wordt een maaltijd verzorgd?" },
      { key: "work_clothing_required", systemKey: "client.work_clothing_required", type: "text", label: "Werkkleding-eisen", placeholder: "Bijv. zwarte schoenen, eigen koksbuis" },
    ],
  },
  {
    id: "sec_clo_5",
    title: "CAO & arbeidsvoorwaarden",
    fields: [
      { key: "cao_applicable", systemKey: "client.cao_applicable", type: "boolean", label: "Is er een CAO van toepassing?" },
      { key: "cao_name", systemKey: "client.cao_name", type: "text", label: "Zo ja, welke CAO?" },
      { key: "own_work_regulations", systemKey: "client.own_work_regulations", type: "boolean", label: "Eigen arbeidsreglement aanwezig?" },
      { key: "inlenersbeloning", systemKey: "client.inlenersbeloning", type: "boolean", label: "Inlenersbeloning van toepassing?" },
      { key: "pension_scheme", systemKey: "client.pension_scheme", type: "boolean", label: "Pensioenregeling van toepassing?" },
      { key: "travel_cost_policy", systemKey: "client.travel_cost_policy", type: "textarea", label: "Reiskostenregeling" },
      { key: "overtime_policy", systemKey: "client.overtime_policy", type: "textarea", label: "Overwerkregeling" },
    ],
  },
  {
    id: "sec_clo_6",
    title: "RI&E, veiligheid & overeenkomst",
    fields: [
      { key: "rie_available", systemKey: "client.rie_available", type: "boolean", label: "Is er een actuele RI&E beschikbaar?" },
      // documentType is the chef-typed form_fields enum; leave null — the upload's docType comes
      // from the client binding (client.doc_rie → rie_document) in client-system-bindings.ts.
      { key: "doc_rie", systemKey: "client.doc_rie", type: "file", label: "RI&E-document (upload)", validation: { accept: ".pdf,.jpg,.jpeg,.png", maxFileMb: 10 } },
      { key: "rie_date", systemKey: "client.rie_date", type: "date", label: "Datum laatste RI&E", validation: { notFuture: true } },
      { key: "workplace_safe", systemKey: "client.workplace_safe", type: "boolean", label: "Werkplek veilig en conform Arbo-eisen?" },
      { key: "safety_instructions", systemKey: "client.safety_instructions", type: "textarea", label: "Specifieke veiligheidsinstructies" },
      { key: "pbm_required", systemKey: "client.pbm_required", type: "boolean", label: "PBM (persoonlijke beschermingsmiddelen) vereist?" },
      { key: "vog_required", systemKey: "client.vog_required", type: "boolean", label: "VOG (verklaring omtrent gedrag) vereist?" },
      { key: "contract_start_date", systemKey: "client.contract_start_date", type: "date", label: "Startdatum overeenkomst" },
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
  await seedFormDef(dbClient, CLIENT_REQUEST_FORM, CLIENT_REQUEST_SECTIONS, "custom");
  await seedFormDef(dbClient, CLIENT_ONBOARDING_FORM, CLIENT_ONBOARDING_SECTIONS, "system");
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
  const dbClient = drizzle(neon(url));
  console.log("🌱 Seeding forms…");
  await seedForms(dbClient);
  const onb = SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  const app = APPLY_SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  const req = CLIENT_REQUEST_SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  console.log(`✓ chef-onboarding: ${SECTIONS.length} sections, ${onb} system fields.`);
  console.log(`✓ chef-apply: ${APPLY_SECTIONS.length} section(s), ${app} fields.`);
  console.log(`✓ client-request: ${CLIENT_REQUEST_SECTIONS.length} section(s), ${req} fields.`);
  const clo = CLIENT_ONBOARDING_SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  console.log(`✓ client-onboarding: ${CLIENT_ONBOARDING_SECTIONS.length} sections, ${clo} system fields.`);
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
