/**
 * dossier tools — "wat weten we eigenlijk over X?"
 *
 * The findability audit's core gap: 213 chef- and 47 klant-notities (the migrated
 * ShiftManager cards: intakes, voorkeuren, karakter, tarief-historie, favorieten en
 * blacklists mét reden) were reachable ONLY through `knowledge.search`, i.e. only when
 * embeddings exist. They did not. This pair reads the notes column straight off the row —
 * no index, no OpenAI, always available.
 *
 * OWNER SURFACE ONLY. The notes blob is Maarten's internal judgment layer: it names other
 * klanten, quotes conflicts, and records rates. `permission` is chefs.read / clients.read
 * (owner + planner in the RBAC catalogue) and neither tool is exposed in the chef- or
 * klant-portal registries. PII inside the text is redacted before it leaves this module —
 * the model never needs the phone number that happens to sit in an old note (contact
 * details have their own tools: chefs.reachability / clients.reachability).
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { chefs, clients } from "@/lib/db/schema";
import { defineTool } from "@/lib/ai/tools/registry";
import { redact } from "@/lib/ai/rag/redact";

/** Notes blobs run to a few KB; the tool-result truncator would cut mid-sentence. */
const MAX_CHARS = 4000;

function shape(notes: string | null): { text: string; truncated: boolean; newestDate: string | null } {
  const raw = (notes ?? "").trim();
  if (!raw) return { text: "", truncated: false, newestDate: null };
  const { text } = redact(raw); // redact the FULL text, then truncate — never the reverse
  // The injected blocks list notes newest-first, so the first date in the text is the
  // most recent one. Handing it back lets the model age its answer ("uit juni 2023")
  // instead of being told to date a note it has no date for.
  const newestDate =
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ??
    text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] ??
    null;
  return text.length > MAX_CHARS
    ? { text: `${text.slice(0, MAX_CHARS)}\n…(ingekort — de nieuwste notities staan bovenaan)`, truncated: true, newestDate }
    : { text, truncated: false, newestDate };
}

export const chefsDossier = defineTool({
  name: "chefs.dossier",
  title: "Wat weten we over deze chef",
  description:
    'Alles wat we INTERN over één chef genoteerd hebben: de gespreksnotities uit het oude systeem (intakes, voorkeuren, karakter, wie hem aandroeg, tarief-afspraken) plus latere notities. Gebruik dit bij "wat weet je over X", "wie is X", "waarom werkt X niet bij Y", "hoeveel vroeg X ook alweer". Werkt altijd — dit leest het dossier zelf, niet de zoekindex. Voor cijfers gebruik chefs.work_summary, voor bereikbaarheid chefs.reachability. Gebruik chefs.find voor het chefId. Read-only, intern.',
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const [row] = await db
      .select({ name: chefs.fullName, notes: chefs.notes, vakniveau: chefs.vakniveau, city: chefs.city })
      .from(chefs)
      // deletedAt guard: an AVG-erased chef must stay erased for the assistant too.
      .where(and(eq(chefs.id, input.chefId), isNull(chefs.deletedAt)))
      .limit(1);
    if (!row) throw new Error("deze chef bestaat niet (meer)");
    const { text, truncated, newestDate } = shape(row.notes);
    return {
      data: { name: row.name, vakniveau: row.vakniveau, city: row.city, notes: text, truncated, newestNoteDate: newestDate },
      summary: text
        ? `Dossier van ${row.name}${truncated ? " (ingekort)" : ""} — vat samen wat relevant is voor de vraag en zeg erbij hoe oud een notitie is.`
        : `Over ${row.name} is nog niets genoteerd. Zeg dat eerlijk in plaats van te gokken.`,
    };
  },
});

export const clientsDossier = defineTool({
  name: "clients.dossier",
  title: "Wat weten we over deze klant",
  description:
    'Alles wat we INTERN over één klant genoteerd hebben: relatie-historie en evaluaties uit het oude systeem, briefings (kleding, parkeren, eigen messen), tarieven, en de favorieten- en blacklist-namen mét reden. Gebruik dit bij "wat moet ik weten voor ik naar X bel", "waarom staat Y op hun blacklist", "wat zijn de afspraken bij X". Werkt altijd — leest het dossier zelf, niet de zoekindex. Gebruik clients.find voor het clientId. Read-only, intern.',
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ clientId: z.string().min(1, "clientId is verplicht") }),
  run: async (input) => {
    const [row] = await db
      .select({ name: clients.companyName, notes: clients.notes, city: clients.city, segment: clients.segment })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
      .limit(1);
    if (!row) throw new Error("deze klant bestaat niet (meer)");
    const { text, truncated, newestDate } = shape(row.notes);
    return {
      data: { name: row.name, city: row.city, segment: row.segment, notes: text, truncated, newestNoteDate: newestDate },
      summary: text
        ? `Dossier van ${row.name}${truncated ? " (ingekort)" : ""} — vat samen wat relevant is voor de vraag; noem blacklist-redenen alleen als er naar gevraagd wordt.`
        : `Over ${row.name} is nog niets genoteerd. Zeg dat eerlijk in plaats van te gokken.`,
    };
  },
});
