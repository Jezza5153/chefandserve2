"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Test-webhook button. POSTs a sample Jotform payload to /api/intake/[kind]
 * so super_admin can verify the inbox + conversion flow works without
 * needing Jotform to actually be wired up yet.
 *
 * The payload is JSON (the handler accepts both form-encoded and JSON).
 * `submissionID` carries a `test-` prefix so real Jotform submissions
 * never collide.
 */
export function TestWebhookButton({
  kind,
  endpoint,
}: {
  kind: "chef" | "client";
  endpoint: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function send() {
    setStatus({ kind: "loading" });
    const submissionId = `test-${kind}-${Date.now()}`;
    const payload =
      kind === "chef"
        ? {
            submissionID: submissionId,
            q3_naam: "Test · Sander Bakker",
            q4_email: `test-${kind}@example.com`,
            q5_telefoon: "+31612345678",
            q6_stad: "Amsterdam",
            q7_vakniveau: "souschef",
            q8_segmenten: "fine_dining, hotel",
            q9_ervaring: "8",
            q10_specialiteiten: "patisserie, Frans, banketkok",
            q11_talen: "nl, en, fr",
            q12_notes: `[Webhook test van /admin/system/webhooks · ${new Date().toLocaleString("nl-NL")}]`,
          }
        : {
            submissionID: submissionId,
            q3_bedrijfsnaam: "Test · Restaurant De Voorbeeld",
            q4_contactpersoon: "Eva van der Berg",
            q5_email: `test-${kind}@example.com`,
            q6_telefoon: "+31612345678",
            q7_stad: "Amsterdam",
            q8_segment: "fine_dining",
            q9_aanvraag: "Souschef nodig voor zaterdagavond, brigade van 4.",
            q10_notes: `[Webhook test van /admin/system/webhooks · ${new Date().toLocaleString("nl-NL")}]`,
          };

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        id?: string;
      };

      if (r.ok && data.ok) {
        setStatus({
          kind: "ok",
          message: `✓ Test ${kind}-submission #${submissionId.slice(-6)} aangemaakt`,
        });
        startTransition(() => {
          router.refresh();
          setTimeout(() => setStatus({ kind: "idle" }), 5000);
        });
      } else {
        setStatus({
          kind: "error",
          message: data.error ?? `HTTP ${r.status}`,
        });
      }
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Netwerkfout",
      });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={send}
        disabled={status.kind === "loading"}
        className="rounded-full border border-burgundy/30 bg-white px-4 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5 disabled:opacity-50"
      >
        {status.kind === "loading"
          ? "Versturen…"
          : `Test ${kind === "chef" ? "chef" : "klant"} webhook`}
      </button>
      {status.kind === "ok" && (
        <p className="text-xs text-emerald-700">{status.message}</p>
      )}
      {status.kind === "error" && (
        <p className="text-xs text-red-700">⚠ {status.message}</p>
      )}
    </div>
  );
}
