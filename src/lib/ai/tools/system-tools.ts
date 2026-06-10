/**
 * Platform-eyes tools (audit: the watchdog and the error/metrics workers produced data the
 * assistant could not read).
 *
 *   watchdog.findings — run the §6 decision-point detectors ON DEMAND ("wat ziet je watchdog?").
 *   system.health     — errors last 24h (counts + truncated top messages, never stacks) +
 *                       the latest metrics-snapshot date.
 */
import { z } from "zod";

import { getSystemHealth } from "@/lib/ai/read-model/system-health";
import { runWatchdog } from "@/lib/ai/read-model/watchdog";
import { defineTool } from "@/lib/ai/tools/registry";

export const watchdogFindings = defineTool({
  name: "watchdog.findings",
  title: "Watchdog-bevindingen",
  description:
    "Draai de waakhond-detectors NU en zie wat er speelt: (1) diensten die >24u open staan met open plekken, (2) actieve chefs die 30+ dagen stil zijn, (3) lage beoordelingen (≤2★) van de laatste 7 dagen. Zelfde detectors als de dagelijkse watchdog-notificaties, maar on-demand — gebruik dit voor 'wat ziet je watchdog / waar moet ik vandaag achteraan?'. Read-only.",
  risk: "read",
  permission: { resource: "cockpit", action: "read" },
  input: z.object({}),
  run: async () => {
    const f = await runWatchdog(new Date());
    const total = f.staleOpenShifts.length + f.silentChefs.length + f.lowRatings.length;
    if (total === 0) {
      return { data: f, summary: "Watchdog ziet niets urgents: geen stale diensten, stille chefs of lage beoordelingen. 👍" };
    }
    const parts: string[] = [];
    if (f.staleOpenShifts.length)
      parts.push(
        `${f.staleOpenShifts.length} dienst(en) lang open (bv. ${f.staleOpenShifts[0].role} bij ${f.staleOpenShifts[0].client}, ${f.staleOpenShifts[0].openForHours}u)`,
      );
    if (f.silentChefs.length) parts.push(`${f.silentChefs.length} stille chef(s) (bv. ${f.silentChefs[0].chef})`);
    if (f.lowRatings.length) parts.push(`${f.lowRatings.length} lage beoordeling(en)`);
    return { data: f, summary: `Watchdog: ${parts.join(" · ")}.` };
  },
});

export const systemHealth = defineTool({
  name: "system.health",
  title: "Systeemgezondheid",
  description:
    "Hoe draait het platform zelf? Fouten van de laatste 24 uur (aantal, onopgelost, top-3 foutmeldingen ingekort — nooit stacktraces) en wanneer de laatste nachtelijke metrics-snapshot draaide. Gebruik dit bij 'gaat alles goed / zijn er storingen / bouncen er mails?'. Read-only.",
  risk: "read",
  permission: { resource: "integrations", action: "read" },
  input: z.object({ windowHours: z.number().int().min(1).max(168).optional() }),
  run: async (input) => {
    const h = await getSystemHealth({ now: new Date(), windowHours: input.windowHours });
    if (h.errorsTotal === 0) {
      return {
        data: h,
        summary: `Geen fouten in de laatste ${h.windowHours} uur. Laatste metrics-snapshot: ${h.lastMetricsSnapshot ?? "nog nooit"}.`,
      };
    }
    const top = h.topErrors.map((e) => `"${e.message.slice(0, 60)}…" (${e.count}×)`).join("; ");
    return {
      data: h,
      summary: `${h.errorsTotal} fout(en) in ${h.windowHours}u (${h.errorsUnresolved} onopgelost). Meest voorkomend: ${top}. Laatste metrics-snapshot: ${h.lastMetricsSnapshot ?? "nog nooit"}.`,
    };
  },
});
