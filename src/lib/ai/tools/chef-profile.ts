/**
 * Chef deep-dive tools — the assistant's "tell me about this chef" reads. They wrap the
 * hardened Chef-360 domain readers (via the chef-profile read-model), so every number is
 * real and matches the admin chef page. Read-only, no confirmation. The brain resolves a
 * name to a chefId with chefs.find first, then drills in here.
 */
import { z } from "zod";

import { cvProfilingEnabled } from "@/lib/ai/config";
import { extractChefProfileFromCv } from "@/lib/ai/read-model/chef-cv-extract";
import { defineTool } from "@/lib/ai/tools/registry";
import {
  chefWorkSummary,
  chefFeedback,
  chefTrends,
  chefProfileCompleteness,
  chefReachability,
} from "@/lib/ai/read-model/chef-profile";
import {
  SUGGESTION_FIELD_LABEL,
  listPendingSuggestions,
  writeCvSuggestions,
} from "@/lib/domain/profile-suggestions";

export const chefsWorkSummary = defineTool({
  name: "chefs.work_summary",
  title: "Trackrecord van een chef",
  description:
    "Het werkelijke trackrecord van één chef: gewerkte uren, afgeronde + komende diensten, betrouwbaarheid (voorgesteld/geaccepteerd/afgewezen/geannuleerd/no-show), gemiddelde beoordeling, en bij welke klanten, segmenten en kantypes hij het meest werkt. Alleen echte cijfers (nooit verzonnen). Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefWorkSummary(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const rating =
      data.averageRating != null ? `${data.averageRating}★ (${data.ratingCount})` : "nog geen beoordeling";
    return {
      data,
      summary: `${data.chef.name}: ${data.totalHoursWorked} uur gewerkt over ${data.completedShifts} afgeronde dienst(en), ${data.upcomingShifts} komend, ${rating}.`,
    };
  },
});

export const chefsFeedback = defineTool({
  name: "chefs.feedback",
  title: "Beoordelingen van een chef",
  description:
    "De beoordelingen die klanten aan één chef gaven: sterren, tags en eventuele opmerkingen (de meest recente) plus de meest voorkomende tags. Intern — alleen jij ziet dit (ratings zijn intern in V1). Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefFeedback(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const summary =
      data.recent.length === 0
        ? `Nog geen beoordelingen voor ${data.chef.name}.`
        : `${data.recent.length} recente beoordeling(en) voor ${data.chef.name}${
            data.topTags.length ? ` — vaakst: ${data.topTags.slice(0, 3).map((t) => t.tag).join(", ")}` : ""
          }.`;
    return { data, summary };
  },
});

export const chefsTrends = defineTool({
  name: "chefs.trends",
  title: "Trend & churn-risico van een chef",
  description:
    "Hoe een chef zich de laatste weken ontwikkelt: churn-risico (geen/laag/let-op/verhoogd) met concrete redenen, dagen sinds laatst gewerkt, acceptatiegraad + gemiddelde beoordeling (28d), en week-op-week verandering in uren/marge/diensten. Deterministisch en uitlegbaar — nooit een verzonnen score. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefTrends(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const churnNl: Record<string, string> = {
      none: "geen signaal",
      low: "laag",
      watch: "let op",
      elevated: "verhoogd",
    };
    return {
      data,
      summary: `${data.chef.name}: churn-risico ${churnNl[data.churn.level] ?? data.churn.level}${
        data.churn.reasons.length ? ` (${data.churn.reasons.join(", ")})` : ""
      }.`,
    };
  },
});

export const chefsProfileCompleteness = defineTool({
  name: "chefs.profile_completeness",
  title: "Profielvolledigheid van een chef",
  description:
    "Hoe compleet een chef-profiel is: score (0-100) + label (compleet/bruikbaar/mist data/onbruikbaar) + welke kritieke en optionele velden ontbreken (vakniveau, stad, tarief, contact, segmenten, ervaring, ...). Handig om te zien waarom een chef nog niet goed te matchen of voor te stellen is. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const data = await chefProfileCompleteness(input.chefId);
    if (!data) throw new Error("deze chef bestaat niet (meer)");
    const miss = data.missingCritical.length ? ` Mist nog: ${data.missingCritical.join(", ")}.` : "";
    return { data, summary: `${data.chef.name}: profiel ${data.score}% (${data.label}).${miss}` };
  },
});

export const chefsEnrichFromCv = defineTool({
  name: "chefs.enrich_from_cv",
  title: "Profiel verrijken uit CV",
  description:
    "Leest het door de chef geüploade CV en stelt gestructureerde profielverbeteringen voor (vakniveau, segmenten, specialiteiten, talen, ervaring) die JIJ daarna nakijkt en goedkeurt op de chef-pagina. Voert NIETS automatisch door en mailt niemand. Gebruik chefs.find voor het chefId.",
  // 'self': writes only internal staging rows for review — no third-party send,
  // no money, no chef-visible change. Nothing is applied until the owner accepts.
  risk: "self",
  permission: { resource: "chefs", action: "write" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input, ctx) => {
    if (!cvProfilingEnabled()) {
      return {
        data: { enabled: false },
        summary: "CV-profielverrijking staat nog uit (CV_AI_PROFILING_ENABLED).",
      };
    }
    const extract = await extractChefProfileFromCv(input.chefId);
    if (!extract) {
      return {
        data: { cvFound: false },
        summary: "Geen leesbaar CV gevonden voor deze chef (of het model staat uit).",
      };
    }
    const { written, diffs } = await writeCvSuggestions(
      input.chefId,
      extract,
      ctx.actor.requestedByUserId,
    );
    if (written === 0) {
      return {
        data: { written: 0, confidence: extract.confidence },
        summary: "CV gelezen — geen nieuwe profielsuggesties (alles is al ingevuld).",
      };
    }
    const fields = diffs.map((d) => SUGGESTION_FIELD_LABEL[d.field] ?? d.field).join(", ");
    return {
      data: { written, diffs, confidence: extract.confidence },
      summary: `${written} voorstel(len) klaar voor review (${fields}). Bekijk en keur goed op de chef-pagina.`,
    };
  },
});

export const chefsReachability = defineTool({
  name: "chefs.reachability",
  title: "Bereikbaarheid van een chef",
  description:
    "Hoe je een chef kunt bereiken: in-app (bel), web push, WhatsApp (door de owner aan/uit gezet) en e-mail — als booleans. Voor 'kan ik chef X via WhatsApp of push bereiken?'. Read-only; geeft géén telefoonnummer of e-mailadres terug. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const r = await chefReachability(input.chefId);
    if (!r) throw new Error("deze chef bestaat niet (meer)");
    const channels =
      [r.inApp && "in-app", r.push && "push", r.whatsapp && "WhatsApp", r.email && "e-mail"]
        .filter(Boolean)
        .join(", ") || "geen kanaal";
    return { data: r, summary: `${r.chef.name} bereikbaar via: ${channels}.` };
  },
});

export const chefsPendingCvSuggestions = defineTool({
  name: "chefs.pending_cv_suggestions",
  title: "Openstaande CV-profielsuggesties",
  description:
    "De openstaande AI-profielsuggesties uit de CV van een chef (vakniveau/segmenten/specialiteiten/talen/ervaring) die nog op jouw review wachten. Voor 'welke CV-voorstellen wachten nog voor chef X?'. Read-only — goedkeuren of negeren doe je op de chef-pagina. Gebruik chefs.find voor het chefId.",
  risk: "read",
  permission: { resource: "chefs", action: "read" },
  input: z.object({ chefId: z.string().min(1, "chefId is verplicht") }),
  run: async (input) => {
    const list = await listPendingSuggestions(input.chefId);
    const summary =
      list.length === 0
        ? "Geen openstaande CV-suggesties voor deze chef."
        : `${list.length} openstaande suggestie(s): ${list.map((s) => SUGGESTION_FIELD_LABEL[s.field] ?? s.field).join(", ")}. Keur goed op de chef-pagina.`;
    return {
      data: {
        count: list.length,
        suggestions: list.map((s) => ({
          veld: SUGGESTION_FIELD_LABEL[s.field] ?? s.field,
          voorstel: s.proposedValue,
          vertrouwen: s.confidence,
        })),
      },
      summary,
    };
  },
});
