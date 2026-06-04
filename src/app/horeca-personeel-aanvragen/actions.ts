"use server";

import { headers } from "next/headers";

import { submitClientRequest } from "@/lib/domain/client-requests";
import type { FormSubmitValue } from "@/lib/forms/types";
import { checkRateLimit, extractClientIp } from "@/lib/rate-limit";

export async function submitClientRequestAction(
  values: Record<string, FormSubmitValue>,
): Promise<
  | { ok: true; submissionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
> {
  // Honeypot: bots fill hidden fields. Pretend success, persist nothing.
  if (typeof values.__hp === "string" && values.__hp.trim() !== "") {
    return { ok: true, submissionId: "ok" };
  }

  const h = await headers();
  const rl = await checkRateLimit("client_request_ip", extractClientIp(h));
  if (!rl.ok) return { ok: false, error: "rate_limited" };

  const clean: Record<string, FormSubmitValue> = {};
  for (const [k, v] of Object.entries(values)) if (k !== "__hp") clean[k] = v;

  return submitClientRequest({ values: clean });
}
