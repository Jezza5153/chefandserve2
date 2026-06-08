/**
 * WhatsApp template catalog — the code source-of-truth that MUST match the approved templates
 * in the sent.dm dashboard (docs/whatsapp-templates.md + docs/whatsapp-copywriter-brief.md hold
 * the bodies; this holds the contract: template name → required named params).
 *
 * The template NAME equals the key here (we named them identically). `sendWhatsAppTemplate()`
 * validates that every param the template needs is supplied before it hits sent.dm, so a
 * missing variable is caught in our code, not as a Meta send-time error.
 */
export type WaAudience = "chef" | "klant" | "intern";

export const WA_TEMPLATES = {
  // ── chef ──
  chef_nieuwe_dienst: { audience: "chef", params: ["voornaam", "klant", "datum"] },
  chef_dienst_bevestigd: { audience: "chef", params: ["voornaam", "klant", "datum"] },
  chef_dienst_geannuleerd: { audience: "chef", params: ["voornaam", "klant", "datum"] },
  chef_beschikbaarheid_herinnering: { audience: "chef", params: ["voornaam"] },
  chef_uren_herinnering: { audience: "chef", params: ["voornaam", "klant"] },
  chef_uren_ondertekend: { audience: "chef", params: ["voornaam", "klant"] },
  chef_uren_goedgekeurd: { audience: "chef", params: ["voornaam"] },
  chef_uren_teruggezet: { audience: "chef", params: ["voornaam"] },
  chef_uren_afgekeurd: { audience: "chef", params: ["voornaam", "klant"] },
  chef_weekplanning: { audience: "chef", params: ["voornaam", "week"] },
  chef_gegevens_aanvullen: { audience: "chef", params: ["voornaam"] },
  chef_portaal_uitnodiging: { audience: "chef", params: ["voornaam"] },
  // ── klant ──
  klant_chef_voorgesteld: { audience: "klant", params: ["contact", "rol", "datum"] },
  klant_dienst_bevestigd: { audience: "klant", params: ["contact", "chef", "datum"] },
  klant_uren_tekenen: { audience: "klant", params: ["contact", "chef"] },
  klant_uren_afgerond: { audience: "klant", params: ["contact", "chef", "datum"] },
  klant_feedback_gevraagd: { audience: "klant", params: ["contact", "chef"] },
  klant_weekplanning: { audience: "klant", params: ["contact", "week"] },
  klant_wijziging_uitkomst: { audience: "klant", params: ["contact", "uitkomst"] },
  klant_portaal_uitnodiging: { audience: "klant", params: ["contact"] },
  // ── intern (→ Maarten/office) ──
  intern_uren_niet_gevuld: { audience: "intern", params: ["chef", "klant"] },
  intern_uren_keuren: { audience: "intern", params: ["chef", "klant"] },
  intern_chef_annulering: { audience: "intern", params: ["chef", "klant", "datum"] },
  intern_nieuwe_chef: { audience: "intern", params: ["naam"] },
  intern_nieuwe_klant: { audience: "intern", params: ["bedrijf"] },
  intern_contact: { audience: "intern", params: ["naam"] },
  intern_wijzigingsverzoek: { audience: "intern", params: ["wie", "veld"] },
} as const satisfies Record<string, { audience: WaAudience; params: readonly string[] }>;

export type WaTemplateKey = keyof typeof WA_TEMPLATES;

export const WA_TEMPLATE_KEYS = Object.keys(WA_TEMPLATES) as WaTemplateKey[];

/** All param names a template needs. Throws on an unknown key. */
export function templateParams(key: WaTemplateKey): readonly string[] {
  const def = WA_TEMPLATES[key];
  if (!def) throw new Error(`Onbekende WhatsApp-template: ${key}`);
  return def.params;
}

/**
 * Validate that `params` supplies every variable the template needs (non-empty). Returns the
 * missing param names (empty = ok). Catches a mistake in OUR code before sent.dm/Meta would.
 */
export function missingParams(key: WaTemplateKey, params: Record<string, string | number>): string[] {
  return templateParams(key).filter((p) => {
    const v = params[p];
    return v === undefined || v === null || String(v).trim() === "";
  });
}
