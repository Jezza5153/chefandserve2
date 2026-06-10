/**
 * Inbox-ACL tools (wave PR-7) — the inbox-access mapping (/admin/system/inboxen) via the
 * assistant: "wie heeft toegang tot welke inbox?" (read) and "geef Lisa toegang tot planning@"
 * (confirm-gated grant/revoke; permission system.write → the perms-ceiling limits execution to
 * super_admin — owners/planners get a clean "geen rechten" from the executor).
 */
import { z } from "zod";

import {
  grantInboxAccess,
  listInboxesWithMembers,
  revokeInboxAccess,
} from "@/lib/domain/inboxes";
import { defineTool } from "@/lib/ai/tools/registry";

export const inboxesList = defineTool({
  name: "inboxes.list",
  title: "Inboxen & toegang",
  description:
    "Welke gevangen mailboxen (inboxen) zijn er en wie heeft tot welke toegang? Toont per inbox het label, adres en de leden. Gebruik dit vóór inboxes.grant_access/revoke_access (je hebt het inboxId nodig) en bij 'wie ziet de planning-inbox?'. Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({}),
  run: async () => {
    const boxes = await listInboxesWithMembers();
    if (boxes.length === 0) {
      return {
        data: { count: 0, inboxes: [] },
        summary: "Nog geen inboxen ingesteld — iedereen met toegang ziet nu alle berichten. Instellen kan op /admin/system/inboxen.",
      };
    }
    const head = boxes
      .map((b) => `${b.label} (${b.address}): ${b.members.length ? b.members.map((m) => m.name ?? m.email).join(", ") : "alleen super_admin"}`)
      .join(" · ");
    return { data: { count: boxes.length, inboxes: boxes }, summary: `${boxes.length} inbox(en): ${head}.` };
  },
});

export const inboxesGrantAccess = defineTool({
  name: "inboxes.grant_access",
  title: "Inbox-toegang geven",
  description:
    "Geef een medewerker toegang tot een inbox (die ziet dan de berichten ervan in Berichten én via de AI). Vereist het inboxId (via inboxes.list) en het LOGIN-e-mailadres van de medewerker. Alleen super_admin kan dit uitvoeren; bevestiging vereist.",
  risk: "outbound",
  permission: { resource: "system", action: "write" },
  input: z.object({
    inboxId: z.string().min(1, "inboxId is verplicht (zie inboxes.list)"),
    userEmail: z.string().email("login-e-mailadres van de medewerker"),
  }),
  describeAction: (i) => `Toegang tot inbox ${i.inboxId} geven aan ${i.userEmail}.`,
  run: async (input, ctx) => {
    const res = await grantInboxAccess({
      inboxId: input.inboxId,
      userEmail: input.userEmail,
      actorId: ctx.actor.requestedByUserId,
    });
    if (!res.ok) return { data: res, summary: `Niet gelukt: ${res.error}` };
    return { data: res, summary: `${input.userEmail} heeft nu toegang tot deze inbox.` };
  },
});

export const inboxesRevokeAccess = defineTool({
  name: "inboxes.revoke_access",
  title: "Inbox-toegang intrekken",
  description:
    "Trek de toegang van een medewerker tot een inbox in. Vereist het inboxId en het LOGIN-e-mailadres van het lid (beide via inboxes.list). Alleen super_admin; bevestiging vereist.",
  risk: "outbound",
  permission: { resource: "system", action: "write" },
  input: z.object({
    inboxId: z.string().min(1, "inboxId is verplicht (zie inboxes.list)"),
    userEmail: z.string().email("login-e-mailadres van het lid"),
  }),
  describeAction: (i) => `Toegang tot inbox ${i.inboxId} intrekken voor ${i.userEmail}.`,
  run: async (input, ctx) => {
    const boxes = await listInboxesWithMembers();
    const box = boxes.find((b) => b.id === input.inboxId);
    if (!box) return { data: { ok: false }, summary: "Deze inbox bestaat niet (meer) — check inboxes.list." };
    const member = box.members.find((m) => m.email.toLowerCase() === input.userEmail.toLowerCase());
    if (!member) return { data: { ok: false }, summary: `${input.userEmail} is geen lid van ${box.label}.` };
    await revokeInboxAccess({ inboxId: input.inboxId, userId: member.userId, actorId: ctx.actor.requestedByUserId });
    return { data: { ok: true }, summary: `Toegang van ${input.userEmail} tot ${box.label} ingetrokken.` };
  },
});
