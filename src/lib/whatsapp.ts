/**
 * WhatsApp/SMS send via sent.dm (https://docs.sent.dm/reference/api).
 *
 * Messaging/notifications channel — NOT an AI channel. Mirrors sendEmail(): a thin, structured
 * sender callers pair with a log + a notification. The transport is INJECTABLE so the send
 * shape is unit-tested with no network (scripts/smoke-whatsapp.mts).
 *
 * IMPORTANT — WhatsApp business-initiated messages REQUIRE a pre-approved template (Meta rule;
 * sent.dm enforces it). So we never send free-form text: a caller passes a template id/name +
 * parameter values. Create + get templates approved in the sent.dm dashboard, then wire their
 * names here / in the reminder workers.
 *
 *   POST {base}/v3/messages   header: x-api-key: <SENT_DM_API_KEY>
 *   body: { to: ["+E164"], channel: ["whatsapp"], template: { name, parameters }, sandbox }
 */
import { env } from "@/lib/env";
import { missingParams, WA_TEMPLATES, type WaTemplateKey } from "@/lib/whatsapp-templates";

const DEFAULT_BASE_URL = "https://api.sent.dm";

export type WhatsAppChannel = "whatsapp" | "sms" | "sent";

export type WhatsAppTransport = (req: {
  url: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; json: unknown }>;

export type SendWhatsAppArgs = {
  /** Recipients in E.164 format, e.g. "+31612345678". At least one. */
  to: string[];
  /** A pre-approved sent.dm/WhatsApp template — by id or name — plus its parameter values. */
  template: { id?: string; name?: string; parameters?: Record<string, string | number> };
  /** Defaults to ["whatsapp"]. */
  channel?: WhatsAppChannel[];
  /** sent.dm sandbox = validate + simulate, no real send. */
  sandbox?: boolean;
  /** Test seam — defaults to a real fetch. */
  transport?: WhatsAppTransport;
};

export type WhatsAppRecipientResult = { messageId: string; to: string; channel: string };

export type SendWhatsAppResult =
  | { ok: true; status: string; recipients: WhatsAppRecipientResult[]; requestId?: string }
  | { ok: false; error: string; code?: string; details?: unknown };

/** True when the send key is configured. UI/callers use this to gate WhatsApp options. */
export function whatsAppConfigured(): boolean {
  return Boolean(env.SENT_DM_API_KEY);
}

const E164 = /^\+[1-9]\d{6,14}$/;

const defaultTransport: WhatsAppTransport = async (req) => {
  const r = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
};

export async function sendWhatsApp(args: SendWhatsAppArgs): Promise<SendWhatsAppResult> {
  // cheap validation first (key-free)
  const to = (args.to ?? []).map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "Geen ontvanger opgegeven." };
  const bad = to.find((t) => !E164.test(t));
  if (bad) return { ok: false, error: `Ongeldig telefoonnummer (E.164 verwacht, bijv. +31612345678): ${bad}` };
  if (!args.template?.id && !args.template?.name) {
    return { ok: false, error: "Een goedgekeurde template (id of naam) is verplicht voor WhatsApp." };
  }

  const apiKey = env.SENT_DM_API_KEY;
  if (!apiKey) return { ok: false, error: "SENT_DM_API_KEY niet ingesteld — WhatsApp staat uit." };

  const base = env.SENT_DM_BASE_URL || DEFAULT_BASE_URL;
  const body = JSON.stringify({
    to,
    channel: args.channel ?? ["whatsapp"],
    template: args.template,
    sandbox: args.sandbox ?? false,
  });

  const transport = args.transport ?? defaultTransport;
  let res: { status: number; json: unknown };
  try {
    res = await transport({
      url: `${base}/v3/messages`,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verbinding met sent.dm mislukt." };
  }

  const j = res.json as {
    success?: boolean;
    data?: { status?: string; recipients?: Array<{ message_id?: string; to?: string; channel?: string }> };
    meta?: { request_id?: string };
    error?: { code?: string; message?: string; details?: unknown };
  };

  if (res.status >= 200 && res.status < 300 && j?.success) {
    return {
      ok: true,
      status: String(j.data?.status ?? "QUEUED"),
      recipients: (j.data?.recipients ?? []).map((r) => ({
        messageId: String(r.message_id ?? ""),
        to: String(r.to ?? ""),
        channel: String(r.channel ?? ""),
      })),
      requestId: j.meta?.request_id,
    };
  }
  return {
    ok: false,
    error: j?.error?.message ?? `sent.dm gaf status ${res.status}`,
    code: j?.error?.code,
    details: j?.error?.details,
  };
}

/**
 * Send one of the catalog templates (src/lib/whatsapp-templates.ts) by key. Validates every
 * required param is present BEFORE calling sent.dm, so a missing variable surfaces as a clear
 * error in our code rather than a Meta send-time failure. The template name sent to sent.dm is
 * the key itself (we keep them identical).
 */
export async function sendWhatsAppTemplate(args: {
  key: WaTemplateKey;
  to: string[];
  params: Record<string, string | number>;
  channel?: WhatsAppChannel[];
  sandbox?: boolean;
  transport?: WhatsAppTransport;
}): Promise<SendWhatsAppResult> {
  if (!(args.key in WA_TEMPLATES)) return { ok: false, error: `Onbekende WhatsApp-template: ${args.key}` };
  const missing = missingParams(args.key, args.params);
  if (missing.length > 0) {
    return { ok: false, error: `Ontbrekende template-variabele(n) voor ${args.key}: ${missing.join(", ")}` };
  }
  return sendWhatsApp({
    to: args.to,
    template: { name: args.key, parameters: args.params },
    channel: args.channel,
    sandbox: args.sandbox,
    transport: args.transport,
  });
}
