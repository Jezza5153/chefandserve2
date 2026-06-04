"use server";

import { headers } from "next/headers";

import { submitContactMessage, type ContactInput } from "@/lib/domain/contact-messages";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";

export async function submitContactAction(
  input: ContactInput & { __hp?: string },
): Promise<
  | { ok: true; submissionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
> {
  // Honeypot: bots fill hidden fields. Pretend success, persist nothing.
  if (typeof input.__hp === "string" && input.__hp.trim() !== "") {
    return { ok: true, submissionId: "ok" };
  }

  const h = await headers();
  const rl = await checkRateLimit("client_request_ip", extractClientIp(h));
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  const { __hp: _hp, ...rest } = input;
  void _hp;
  return submitContactMessage(rest);
}
