/**
 * Onboarding-completeness tools — the AVG-safe proactive pair:
 *   onboarding.missing          (read)  — who still misses which required fields (LABELS only).
 *   onboarding.request_missing  (act)   — message chef(s) listing exactly what to fill in.
 *
 * Neither ever reads or sends a sensitive VALUE (BSN/IBAN/ID) — only WHICH fields are missing.
 * The chase wraps the tested createProfileDataRequest (email + contact-log). Bulk chase mirrors
 * chefs.send_availability_reminder: owner-triggered + confirm-gated.
 */
import { z } from "zod";

import { defineTool } from "@/lib/ai/tools/registry";
import { chefOnboardingStatus, sweepChefOnboarding } from "@/lib/ai/read-model/onboarding";
import { createProfileDataRequest } from "@/lib/domain/profile-data-requests";

export const onboardingMissing = defineTool({
  name: "onboarding.missing",
  title: "Ontbrekende onboarding-gegevens",
  description:
    "Wie mist nog verplichte onboarding-/AVG-gegevens (BSN, IBAN, ID-kopie, adres, rekeninghouder, dienstverband, …) om ingezet én uitbetaald te kunnen worden? ZONDER chefId: een overzicht van álle actieve chefs die nog niet compleet zijn (minst compleet eerst). MÉT chefId: die ene chef. Geeft alléén WELKE velden ontbreken (labels) — NOOIT de gevoelige waarden zelf (AVG). Read-only. Gebruik daarna onboarding.request_missing om ze te laten aanvullen.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().optional() }),
  run: async (input) => {
    if (input.chefId) {
      const st = await chefOnboardingStatus(input.chefId);
      if (!st) throw new Error("deze chef bestaat niet (meer)");
      return {
        data: st,
        summary: st.ready
          ? `${st.chef} is compleet — alle verplichte gegevens aanwezig.`
          : `${st.chef} mist nog: ${st.missing.join(", ")}${st.idExpired ? " · ⚠ ID verlopen" : st.idExpiringSoon ? " · ⚠ ID verloopt binnenkort" : ""}.`,
      };
    }
    const sweep = await sweepChefOnboarding();
    return {
      data: { count: sweep.length, chefs: sweep },
      summary:
        sweep.length === 0
          ? "Alle actieve chefs hebben hun verplichte gegevens compleet. 👍"
          : `${sweep.length} chef(s) missen nog verplichte gegevens (minst compleet eerst): ${sweep.slice(0, 4).map((c) => `${c.chef} (${c.missing.length} velden)`).join(", ")}${sweep.length > 4 ? " …" : ""}.`,
    };
  },
});

export const onboardingRequestMissing = defineTool({
  name: "onboarding.request_missing",
  title: "Ontbrekende gegevens opvragen",
  description:
    "Stuur chef(s) een verzoek met PRECIES welke onboarding-/AVG-gegevens ze nog moeten aanvullen (per chef hun eigen lijstje). MÉT chefId: alleen die chef. ZONDER chefId: álle actieve chefs die nog iets missen krijgen ieder een eigen verzoek. Bevat NOOIT gevoelige waarden — alleen welke velden nodig zijn. Confirm-gated.",
  risk: "outbound",
  permission: { resource: "chefs", action: "write" },
  input: z.object({ chefId: z.string().optional() }),
  describeAction: (i) =>
    i.chefId
      ? `Verzoek om ontbrekende gegevens sturen naar chef ${i.chefId}.`
      : "Naar ÁLLE actieve chefs met ontbrekende gegevens een verzoek sturen (ieder met hun eigen lijstje).",
  run: async (input, ctx) => {
    const targets = input.chefId
      ? await (async () => {
          const st = await chefOnboardingStatus(input.chefId!);
          if (!st) throw new Error("deze chef bestaat niet (meer)");
          return st.ready ? [] : [st];
        })()
      : await sweepChefOnboarding();

    if (targets.length === 0) {
      return { data: { sent: 0 }, summary: input.chefId ? "Deze chef is al compleet — geen verzoek nodig." : "Geen chefs met ontbrekende gegevens — niets te versturen." };
    }

    let sent = 0;
    const failed: string[] = [];
    for (const t of targets) {
      const res = await createProfileDataRequest({
        chefId: t.chefId,
        requestedFields: t.missing,
        createdBy: ctx.actor.requestedByUserId,
      });
      if (res.ok) sent++;
      else failed.push(t.chef);
    }
    return {
      data: { sent, failed: failed.length },
      summary: `${sent} chef(s) een verzoek gestuurd met hun ontbrekende gegevens${failed.length ? ` (${failed.length} mislukt: ${failed.join(", ")})` : ""}.`,
    };
  },
});
