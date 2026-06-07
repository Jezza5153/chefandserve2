/**
 * Hours tools — read the approval queue, and approve a row (the first real financial
 * action). `hours.approve` wraps the existing atomic+audited `approveHoursRow`, so the
 * executor's `ai.tool_*` row pairs with the domain's `shift_hours.admin_approved` row.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { approveHoursRow } from "@/lib/domain/hours";
import { listHoursAwaitingApproval } from "@/lib/ai/read-model/hours";

export const hoursListAwaitingApproval = defineTool({
  name: "hours.list_awaiting_approval",
  title: "Uren die op goedkeuring wachten",
  description:
    "Lijst van urenregels die de klant heeft getekend en die nu op jouw goedkeuring wachten (status client_signed).",
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
    "Keurt één getekende urenregel goed (client_signed → admin_approved). Daarna gaat de regel mee in de eerstvolgende payroll-batch.",
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
