import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { webhooksReceived } from "@/lib/db/schema";
import { handleJotformWebhook } from "@/lib/intake/handler";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Webhook detail" };

export default async function WebhookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin");
  const { id } = await params;

  const row = await db.query.webhooksReceived.findFirst({
    where: eq(webhooksReceived.id, id),
  });
  if (!row) notFound();

  const payload = (row.payload ?? {}) as {
    kind?: "chef" | "client";
    body?: Record<string, string | string[] | undefined>;
  };
  const kind = payload.kind;
  const body = payload.body ?? {};

  async function replay() {
    "use server";
    const session = await requireRole("super_admin");
    if (kind !== "chef" && kind !== "client") {
      throw new Error("Webhook missing kind metadata, cannot replay");
    }

    // Reconstruct a Request from the saved body, call the same handler
    const formData = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) formData.append(k, item);
      } else {
        formData.append(k, v);
      }
    }
    const synthetic = new Request("https://internal/replay", {
      method: "POST",
      body: formData,
    });

    const response = await handleJotformWebhook(synthetic, kind);

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "webhook.replay",
      resource: "webhooks_received",
      resourceId: id,
      after: { kind, status: response.status },
    });

    redirect("/admin/system/webhooks");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link
          href="/admin/system/webhooks"
          className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
        >
          ← Alle webhooks
        </Link>
      </div>

      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Webhook detail
      </p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">
        {row.source} · {kind ?? "—"}
      </h1>
      <p className="mt-2 text-xs text-ink-500">
        Ontvangen {new Date(row.createdAt).toLocaleString("nl-NL")} ·{" "}
        {row.processedAt
          ? `verwerkt ${new Date(row.processedAt).toLocaleTimeString("nl-NL")}`
          : "niet verwerkt"}
        {row.signatureValid !== null &&
          (row.signatureValid ? " · ✓ signature OK" : " · ✗ signature INVALID")}
      </p>

      {row.processingError && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Verwerkingsfout:</strong> {row.processingError}
        </div>
      )}

      {kind && (
        <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-lg text-ink-900">Opnieuw verwerken</h2>
              <p className="mt-1 text-sm text-ink-700">
                Stuur deze payload nogmaals door de intake-handler. De handler
                is idempotent — als er al een chef/client-submission bestaat
                voor deze submissionID, wordt die geüpdatet (niet gedupliceerd).
              </p>
            </div>
            <form action={replay}>
              <button
                type="submit"
                className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
              >
                Replay
              </button>
            </form>
          </div>
        </section>
      )}

      <details open className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
        <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
          Raw payload
        </summary>
        <pre className="mt-4 max-h-[60vh] overflow-auto rounded bg-bg-gray p-4 text-[11px] leading-relaxed text-ink-700">
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </details>

      {row.headers ? (
        <details className="mt-4 rounded-lg border border-ink-200 bg-white p-6">
          <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
            Request headers (PR-S1C — used to decide HMAC vs URL-secret)
          </summary>
          <pre className="mt-4 max-h-[40vh] overflow-auto rounded bg-bg-gray p-4 text-[11px] leading-relaxed text-ink-700">
            {JSON.stringify(row.headers, null, 2)}
          </pre>
          <p className="mt-3 text-xs text-ink-500">
            Look for any <code>x-jotform-*</code>, <code>x-signature</code>, or
            <code>x-hub-signature</code> header. If none is present on real
            submissions, fall back to URL-secret path or IP-allowlist.
          </p>
        </details>
      ) : null}
    </div>
  );
}
