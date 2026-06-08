/**
 * Availability tool — the on-demand counterpart to the weekly availability-reminder worker.
 * Lets the assistant nudge chefs to fill in their availability for next week: all active
 * chefs at once, or a single chef by id. Confirm-gated (outbound): it e-mails chefs.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { sendAvailabilityReminder } from "@/lib/ai/actions/send-availability-reminder";

export const chefsSendAvailabilityReminder = defineTool({
  name: "chefs.send_availability_reminder",
  title: "Beschikbaarheidsherinnering sturen",
  description:
    "Stuurt chefs een herinnering om hun beschikbaarheid voor volgende week in te vullen (e-mail + melding in de app). Zonder chefId gaat het naar álle actieve chefs; geef een chefId mee om alleen die ene chef te herinneren (gebruik chefs.find voor het id).",
  risk: "outbound",
  permission: { resource: "reminders", action: "write" },
  input: z.object({
    chefId: z.string().min(1).optional(),
  }),
  describeAction: (input) =>
    input.chefId
      ? `Eén chef (${input.chefId}) een herinnering sturen om z'n beschikbaarheid voor volgende week in te vullen.`
      : "ALLE actieve chefs een herinnering sturen om hun beschikbaarheid voor volgende week in te vullen.",
  run: async (input) => {
    const res = await sendAvailabilityReminder(input.chefId ? { chefId: input.chefId } : {});
    if (!res.ok) throw new Error(res.reason);
    return {
      data: { sent: res.sent, skipped: res.skipped },
      summary:
        res.sent === 0
          ? "Geen herinneringen verstuurd — geen geschikte ontvanger gevonden."
          : `Beschikbaarheidsherinnering verstuurd naar ${res.sent} chef(s)${res.skipped ? ` (${res.skipped} overgeslagen)` : ""}.`,
    };
  },
});
