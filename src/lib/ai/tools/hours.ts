/**
 * Hours tools — read the approval queue, approve a row (first real financial action),
 * and remind the blocking party (first real outbound action). The mutating tools wrap
 * existing helpers so the AI's meta-audit row pairs with the domain's business row.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { approveHoursRow, rejectHoursRow } from "@/lib/domain/hours";
import { listHoursAwaitingApproval } from "@/lib/ai/read-model/hours";
import { sendHoursReminder } from "@/lib/ai/actions/send-hours-reminder";

export const hoursListAwaitingApproval = defineTool({
  name: "hours.list_awaiting_approval",
  title: "Uren die op goedkeuring wachten",
  description:
    "Lijst van urenregels die de klant heeft getekend ('Door klant akkoord') en die nu op jouw goedkeuring wachten. Elke regel heeft een Nederlandse statuslabel — gebruik die, nooit een technische code.",
  risk: "read",
  permission: { resource: "hours", action: "read" },
  input: z.object({}),
  run: async () => {
    const rows = await listHoursAwaitingApproval();
    const summary =
      rows.length === 0
        ? "Er wachten geen uren op goedkeuring."
        : `${rows.length} urenregel(s) wachten op je goedkeuring.`;
    return { data: { count: rows.length, rows }, summary };
  },
});

export const hoursApprove = defineTool({
  name: "hours.approve",
  title: "Uren goedkeuren",
  description:
    "Keurt één getekende urenregel definitief goed (van 'Door klant akkoord' naar 'Goedgekeurd voor uitbetaling'). Daarna gaat de regel mee in de eerstvolgende payroll-batch.",
  risk: "financial",
  permission: { resource: "hours", action: "approve" },
  input: z.object({ hoursId: z.string().min(1, "hoursId is verplicht") }),
  describeAction: (input) => `Urenregel ${input.hoursId} definitief goedkeuren (gaat mee in payroll).`,
  run: async (input, ctx) => {
    const res = await approveHoursRow({
      hoursId: input.hoursId,
      approverUserId: ctx.actor.requestedByUserId,
    });
    if (!res.ok) {
      throw new Error(res.reason === "stale" ? "deze urenregel is alweer veranderd" : res.reason);
    }
    return { data: { id: input.hoursId }, summary: "Uren goedgekeurd." };
  },
});

export const hoursReject = defineTool({
  name: "hours.reject",
  title: "Uren afkeuren",
  description:
    "Keurt een urenregel af met een korte reden. De chef (of klant) krijgt bericht om het te corrigeren en opnieuw in te dienen.",
  risk: "financial",
  permission: { resource: "hours", action: "approve" },
  input: z.object({
    hoursId: z.string().min(1, "hoursId is verplicht"),
    reason: z.string().min(5, "geef een korte reden (min. 5 tekens)"),
  }),
  describeAction: (input) => `Urenregel ${input.hoursId} afkeuren met reden: "${input.reason}".`,
  run: async (input, ctx) => {
    const res = await rejectHoursRow({
      hoursId: input.hoursId,
      rejecterUserId: ctx.actor.requestedByUserId,
      adminNotes: input.reason,
    });
    if (!res.ok) {
      throw new Error(res.reason === "reason-too-short" ? "de reden is te kort" : res.reason);
    }
    return { data: { id: input.hoursId }, summary: "Uren afgekeurd — de chef is op de hoogte gebracht." };
  },
});

export const hoursSendReminder = defineTool({
  name: "hours.send_reminder",
  title: "Herinnering sturen over uren",
  description:
    "Stuurt een vriendelijke herinnering over één urenregel naar de partij die nog aan zet is: de chef (moet indienen) of de klant (moet goedkeuren). Doet niets als de regel op jou wacht of al klaar is.",
  risk: "outbound",
  permission: { resource: "reminders", action: "write" },
  input: z.object({ hoursId: z.string().min(1, "hoursId is verplicht") }),
  describeAction: (input) => `Een herinnering sturen over urenregel ${input.hoursId} aan de partij die nog aan zet is.`,
  run: async (input) => {
    const res = await sendHoursReminder(input.hoursId);
    if (!res.ok) throw new Error(res.reason);
    return {
      data: { hoursId: input.hoursId, party: res.party, recipients: res.recipients },
      summary: `Herinnering gestuurd naar de ${res.party} (${res.recipients.join(", ")}).`,
    };
  },
});
