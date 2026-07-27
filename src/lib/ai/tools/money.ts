/**
 * Money read tools — the assistant's window on cash (AI-CHECK fix).
 *
 * The full-AI audit's sharpest coverage finding: money was the worst-covered domain.
 * Zero tools touched the invoices table (the moment an invoice was created it left the
 * assistant's field of view), the ZZP-facturen/vakantiegeld/onkosten queues were
 * model-blind, and "welke klant is stil geworden" lived on exactly one page component.
 * All three are wrappers over domain functions that already exist.
 *
 * All read-only. Amounts in whole euros in summaries (owner-facing), cents in data.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { defineTool } from "@/lib/ai/tools/registry";
import { listPendingChefInvoices } from "@/lib/domain/chef-invoices";
import { listPendingChefRequests } from "@/lib/domain/chef-requests";
import { getQuietClients } from "@/lib/domain/intel";

const eur = (c: number) => `€${Math.round(c / 100).toLocaleString("nl-NL")}`;

export const invoicingOpen = defineTool({
  name: "invoicing.open",
  title: "Openstaande klantfacturen",
  description:
    'Welke klantfacturen staan open (verstuurd, nog niet betaald) en hoe lang al? Voor "welke facturen staan open / heeft [klant] al betaald / hoeveel geld staat er uit". Toont per factuur: nummer, klant, bedrag, dagen sinds verzending. Ook concepten die nog verstuurd moeten worden. Read-only — versturen/afboeken gaat via de facturatie-pagina.',
  risk: "read",
  permission: { resource: "invoices", action: "read" },
  input: z.object({
    includeDrafts: z.boolean().optional().describe("Ook concept-facturen tonen (standaard ja)."),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  run: async (input) => {
    const statuses = input.includeDrafts === false ? ["sent"] : ["sent", "draft"];
    const rows = await db
      .select({
        number: invoices.number,
        client: clients.companyName,
        status: invoices.status,
        totalCents: invoices.totalCents,
        sentAt: invoices.sentAt,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .leftJoin(clients, eq(clients.id, invoices.clientId))
      .where(inArray(invoices.status, statuses as ("sent" | "draft")[]))
      .orderBy(desc(invoices.createdAt))
      .limit(Math.min(input.limit ?? 25, 50));

    const now = Date.now();
    const shaped = rows.map((r) => ({
      number: r.number,
      client: r.client,
      status: r.status === "sent" ? "verstuurd" : "concept",
      totalCents: r.totalCents,
      daysOpen: r.sentAt ? Math.floor((now - new Date(r.sentAt).getTime()) / 864e5) : null,
    }));
    const sent = shaped.filter((r) => r.status === "verstuurd");
    const outstanding = sent.reduce((a, r) => a + r.totalCents, 0);
    const drafts = shaped.length - sent.length;
    return {
      data: { count: shaped.length, outstandingCents: outstanding, invoices: shaped },
      summary:
        shaped.length === 0
          ? "Geen openstaande of concept-facturen."
          : `${sent.length} verstuurde factuur/facturen open (${eur(outstanding)} uitstaand)${drafts > 0 ? ` · ${drafts} concept(en) nog te versturen` : ""}. Oudste eerst benoemen als er iets lang open staat.`,
    };
  },
});

export const chefsUitbetalingen = defineTool({
  name: "chefs.uitbetalingen",
  title: "Wachtende chef-uitbetalingen",
  description:
    'Wat wacht er op uitbetaling of goedkeuring richting chefs: ingediende ZZP-facturen, vakantiegeld-verzoeken en onkosten-declaraties. Voor "wie wacht er op geld / welke chef-facturen moet ik nog goedkeuren / openstaande declaraties". Read-only — beslissen gaat via de admin-pagina\'s.',
  risk: "read",
  permission: { resource: "payroll", action: "read" },
  input: z.object({}),
  run: async () => {
    const [invoicesPending, requests] = await Promise.all([
      listPendingChefInvoices(),
      listPendingChefRequests(),
    ]);
    const invTotal = invoicesPending.reduce((a, r) => a + r.amountCents, 0);
    const expTotal = requests.expenses.reduce((a, r) => a + r.amountCents, 0);
    const parts: string[] = [];
    if (invoicesPending.length) parts.push(`${invoicesPending.length} ZZP-factuur/facturen (${eur(invTotal)})`);
    if (requests.vacation.length) parts.push(`${requests.vacation.length} vakantiegeld-verzoek(en)`);
    if (requests.expenses.length) parts.push(`${requests.expenses.length} declaratie(s) (${eur(expTotal)})`);
    return {
      data: {
        chefInvoices: invoicesPending.map((r) => ({ chefName: r.chefName, amountCents: r.amountCents, status: r.status, submittedAt: r.submittedAt })),
        vacation: requests.vacation.map((r) => ({ chefName: r.chefName, kind: r.kind, amountCents: r.amountCents, startDate: r.startDate, endDate: r.endDate })),
        expenses: requests.expenses.map((r) => ({ chefName: r.chefName, category: r.category, amountCents: r.amountCents })),
      },
      summary: parts.length === 0 ? "Niets wacht op uitbetaling of goedkeuring richting chefs. 👍" : `Wacht op jou: ${parts.join(" · ")}.`,
    };
  },
});

export const clientsStil = defineTool({
  name: "clients.stil",
  title: "Stille klanten",
  description:
    'Welke klanten zijn stil geworden: boekten eerder, maar hebben al X dagen (standaard 30) geen dienst meer gepland. Voor "welke klant heeft het langst niet geboekt / wie moet ik weer eens bellen / slapende klanten". Read-only.',
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({
    thresholdDays: z.number().int().min(7).max(365).optional().describe("Stil sinds hoeveel dagen (standaard 30)."),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  run: async (input) => {
    const rows = await getQuietClients({ thresholdDays: input.thresholdDays, limit: input.limit ?? 10 });
    return {
      data: { count: rows.length, clients: rows },
      summary:
        rows.length === 0
          ? "Geen stille klanten — iedereen die eerder boekte heeft recent nog gepland."
          : `${rows.length} stille klant(en) — stel voor om de stilste te bellen en leg het gesprek vast met contacts.log.`,
    };
  },
});
