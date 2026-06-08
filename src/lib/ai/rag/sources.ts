/**
 * RAG source catalog (V1) — the indexer's allowlist. ONLY the sources here get vectorized;
 * everything else (financials, identity docs, contact methods, auth secrets) is Restricted or
 * NEVER per docs/ai/rag-source-catalog.md. Adding a row here is the ONLY way content enters
 * ai_embeddings, and smoke-ai-rag-retrieval.mts asserts the live corpus contains nothing else.
 *
 * Each source declares: the SELECT (raw — chunked notes-RAG lives outside the Drizzle schema),
 * how to build the chunkable text for a row (with a context prefix per the contract so the
 * embedding captures who/what), the tenant_scope, and the visibility tier. PURE (text builders
 * + scope are deterministic); the SELECT is just a constant string. The DB I/O is in ingest.ts.
 *
 * Visibility choices (conservative — the assistant is owner-only in V1, so admin sees all;
 * these tags make the FUTURE chef/klant PAs safe-by-construction):
 *   - chefs.notes / clients.notes / shifts / contact_logs → admin_only
 *     (notes blobs mix Maarten's tribal knowledge — "pairs poorly with Wim" — so treat as
 *      internal; never surface to a chef/klant PA. Reclassify if we ever split authorship.)
 *   - chefs.profile (specialties/languages/segments/city) → chef_own_and_admin
 *     (descriptive bio the chef themselves may eventually search; carries no tribal notes).
 */
import { formatChefRole, formatSegment } from "@/lib/labels";
import type { Visibility } from "@/lib/ai/rag/access";

export type RagSourceDef = {
  /** Unique id, also the human label seed. */
  id: string;
  sourceTable: string;
  field: string;
  visibility: Visibility;
  /** Raw SELECT; must return `id` plus the columns buildText/tenantScope read. */
  select: string;
  /** Build the chunkable text (prefix + body). Return "" to skip the row. */
  buildText: (row: Record<string, unknown>) => string;
  /** tenant_scope for the row (e.g. `chefId:<uuid>`). */
  tenantScope: (row: Record<string, unknown>) => string;
};

const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(s).filter(Boolean) : []);
const dateNl = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("nl-NL");
};

export const RAG_SOURCES: RagSourceDef[] = [
  {
    id: "chefs.notes",
    sourceTable: "chefs",
    field: "notes",
    visibility: "admin_only",
    select: `
      SELECT id, full_name, vakniveau, segments, notes
      FROM chefs
      WHERE deleted_at IS NULL AND notes IS NOT NULL AND length(trim(notes)) > 0`,
    tenantScope: (r) => `chefId:${s(r.id)}`,
    buildText: (r) => {
      const seg = arr(r.segments).map(formatSegment).join(", ");
      const head = `Chef ${s(r.full_name)}, vakniveau ${formatChefRole(s(r.vakniveau) || null)}${seg ? `, segmenten ${seg}` : ""}`;
      return `${head}. Notitie: ${s(r.notes)}`.trim();
    },
  },
  {
    id: "chefs.profile",
    sourceTable: "chefs",
    field: "profile",
    visibility: "chef_own_and_admin",
    select: `
      SELECT id, full_name, vakniveau, segments, specialties, languages, city
      FROM chefs
      WHERE deleted_at IS NULL
        AND (specialties IS NOT NULL OR array_length(segments, 1) > 0 OR array_length(languages, 1) > 0)`,
    tenantScope: (r) => `chefId:${s(r.id)}`,
    buildText: (r) => {
      const seg = arr(r.segments).map(formatSegment).join(", ");
      const langs = arr(r.languages).join(", ");
      const parts = [
        `Chef ${s(r.full_name)}, vakniveau ${formatChefRole(s(r.vakniveau) || null)}`,
        seg ? `segmenten ${seg}` : "",
        s(r.specialties) ? `specialiteiten ${s(r.specialties)}` : "",
        langs ? `talen ${langs}` : "",
        s(r.city) ? `stad ${s(r.city)}` : "",
      ].filter(Boolean);
      return parts.join(". ");
    },
  },
  {
    id: "clients.notes",
    sourceTable: "clients",
    field: "notes",
    visibility: "admin_only",
    select: `
      SELECT id, company_name, segment, city, notes
      FROM clients
      WHERE deleted_at IS NULL AND notes IS NOT NULL AND length(trim(notes)) > 0`,
    tenantScope: (r) => `clientId:${s(r.id)}`,
    buildText: (r) => {
      const head = `Klant ${s(r.company_name)}${s(r.segment) ? `, segment ${formatSegment(s(r.segment))}` : ""}${s(r.city) ? `, locatie ${s(r.city)}` : ""}`;
      return `${head}. Notitie: ${s(r.notes)}`.trim();
    },
  },
  {
    id: "shifts.notes",
    sourceTable: "shifts",
    field: "notes",
    visibility: "admin_only",
    select: `
      SELECT sh.id, sh.role_needed, sh.starts_at, sh.when_description, sh.notes, sh.client_id,
             c.company_name AS client_name
      FROM shifts sh
      LEFT JOIN clients c ON c.id = sh.client_id
      WHERE sh.status != 'cancelled'
        AND ((sh.notes IS NOT NULL AND length(trim(sh.notes)) > 0)
          OR (sh.when_description IS NOT NULL AND length(trim(sh.when_description)) > 0))`,
    tenantScope: (r) => (s(r.client_id) ? `clientId:${s(r.client_id)}` : "internal"),
    buildText: (r) => {
      const when = dateNl(r.starts_at);
      const head = `Dienst${s(r.client_name) ? ` bij ${s(r.client_name)}` : ""}${when ? ` op ${when}` : ""}, rol ${formatChefRole(s(r.role_needed) || null)}`;
      const body = [s(r.when_description), s(r.notes)].filter(Boolean).join(". ");
      return `${head}: ${body}`.trim();
    },
  },
  {
    id: "contact_logs.note",
    sourceTable: "contact_logs",
    field: "contact_log",
    visibility: "admin_only",
    select: `
      SELECT cl.id, cl.target_type, cl.target_id, cl.channel, cl.outcome, cl.note, cl.created_at,
             COALESCE(ch.full_name, cli.company_name) AS target_name
      FROM contact_logs cl
      LEFT JOIN chefs ch ON cl.target_type = 'chef' AND ch.id = cl.target_id
      LEFT JOIN clients cli ON cl.target_type = 'client' AND cli.id = cl.target_id
      WHERE cl.note IS NOT NULL AND length(trim(cl.note)) > 0`,
    tenantScope: (r) =>
      `${s(r.target_type) === "chef" ? "chefId" : "clientId"}:${s(r.target_id)}`,
    buildText: (r) => {
      const channelNl: Record<string, string> = {
        phone: "telefonisch",
        whatsapp: "via WhatsApp",
        email: "per e-mail",
        in_person: "persoonlijk",
      };
      const ch = channelNl[s(r.channel)] ?? s(r.channel);
      const when = dateNl(r.created_at);
      const who = s(r.target_name) || (s(r.target_type) === "chef" ? "een chef" : "een klant");
      const head = `Contact ${ch}${when ? ` op ${when}` : ""} met ${who}${s(r.outcome) ? ` (${s(r.outcome)})` : ""}`;
      return `${head}: ${s(r.note)}`.trim();
    },
  },
];

/** The allowlisted source tables — smoke asserts the live corpus contains ONLY these. */
export const ALLOWED_SOURCE_TABLES = [...new Set(RAG_SOURCES.map((d) => d.sourceTable))];
