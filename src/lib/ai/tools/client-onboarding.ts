/**
 * Client onboarding-completeness tool — the B2B read sibling of onboarding.missing (chefs).
 *
 *   client_onboarding.missing  (read) — which klanten still miss which required company data.
 *
 * Returns only WHICH fields are missing (labels) — never contact PII or any value (AVG-safe).
 * Read-only; the proactive nudge (messaging the klant) is a separate, gated follow-up.
 */
import { z } from "zod";

import { clientOnboardingStatus, sweepClientOnboarding } from "@/lib/ai/read-model/client-onboarding";
import { defineTool } from "@/lib/ai/tools/registry";

export const clientOnboardingMissing = defineTool({
  name: "client_onboarding.missing",
  title: "Ontbrekende klant-onboarding",
  description:
    "Welke klanten hebben hun onboarding (bedrijfsnaam, bezoekadres, KvK/BTW, rechtsvorm, algemeen contactpersoon, tekenbevoegde, RI&E/veiligheid) nog niet compleet? ZONDER clientId: een overzicht van álle prospect/actieve klanten die nog niet compleet zijn (minst compleet eerst). MÉT clientId: die ene klant. Geeft alléén WELKE velden ontbreken (labels) — NOOIT contactgegevens of andere waarden (AVG). Read-only.",
  risk: "read",
  permission: { resource: "clients", action: "read" },
  input: z.object({ clientId: z.string().optional() }),
  run: async (input) => {
    if (input.clientId) {
      const st = await clientOnboardingStatus(input.clientId);
      if (!st) throw new Error("deze klant bestaat niet (meer)");
      return {
        data: st,
        summary: st.ready
          ? `${st.client} is compleet — alle verplichte bedrijfsgegevens aanwezig.`
          : `${st.client} mist nog: ${st.missing.join(", ")}${st.submitted ? "" : " · onboarding nog niet ingediend"}.`,
      };
    }
    const sweep = await sweepClientOnboarding();
    return {
      data: { count: sweep.length, clients: sweep },
      summary:
        sweep.length === 0
          ? "Alle prospect/actieve klanten hebben hun bedrijfsgegevens compleet. 👍"
          : `${sweep.length} klant(en) missen nog gegevens (minst compleet eerst): ${sweep
              .slice(0, 4)
              .map((c) => `${c.client} (${c.missing.length} velden)`)
              .join(", ")}${sweep.length > 4 ? " …" : ""}.`,
    };
  },
});
