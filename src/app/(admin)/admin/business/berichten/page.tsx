/**
 * /admin/business/berichten — inbound e-mail triage (PR-AI-INBOUND UI).
 *
 * The human half of the inbound pipeline: every chef/klant e-mail captured by
 * /api/webhooks/resend-inbound lands here — classified (klacht/spoed/vraag/overig), matched to
 * the chef/klant, with the body readable and a "afgehandeld" toggle. The AI's inbound.list tool
 * deliberately never returns bodies; THIS page is where Maarten reads them.
 *
 * SECURITY: bodyPreview is untrusted sender text — rendered as escaped plain text only
 * (React default), never as HTML.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { listInboundAdmin, setInboundHandled, type InboundCategory } from "@/lib/domain/inbound";
import { inboxLabelFor, listInboxesWithMembers, matchesViewer, viewerInboxFilter } from "@/lib/domain/inboxes";
import { hasRole, requireAuth, requirePermission } from "@/lib/permissions";

export const metadata = { title: "Berichten" };
export const dynamic = "force-dynamic";

const CATEGORY_BADGE: Record<InboundCategory, { label: string; cls: string }> = {
  complaint: { label: "⚠ Klacht", cls: "border-red-200 bg-red-50 text-red-800" },
  urgent: { label: "⏱ Spoed", cls: "border-amber-300 bg-amber-50 text-amber-800" },
  question: { label: "Vraag", cls: "border-ink-200 bg-white text-ink-700" },
  other: { label: "Overig", cls: "border-ink-200 bg-ink-50 text-ink-500" },
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "Alles" },
  { value: "complaint", label: "Klachten" },
  { value: "urgent", label: "Spoed" },
  { value: "question", label: "Vragen" },
  { value: "other", label: "Overig" },
];

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default async function BerichtenPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; kat?: string }>;
}) {
  const session = await requirePermission("clients", "read");
  const sp = await searchParams;
  const showAll = sp.filter === "alles";
  const kat = CATEGORIES.some((c) => c.value === sp.kat) && sp.kat !== "all" ? (sp.kat as InboundCategory) : undefined;

  // Inbox access (roles ≠ inboxes): super_admin sees all; otherwise only the viewer's inboxes
  // (owners also see mail matching no configured inbox — the stray-mail safety net).
  const [filter, allInboxes] = await Promise.all([
    viewerInboxFilter(session.user.id, {
      superAdmin: hasRole(session, "super_admin"),
      owner: hasRole(session, "owner", "super_admin"),
    }),
    listInboxesWithMembers(),
  ]);
  const rows = (await listInboundAdmin({ unhandledOnly: !showAll, category: kat })).filter((r) =>
    matchesViewer(r.toEmail, filter),
  );

  async function toggleHandled(formData: FormData) {
    "use server";
    const session = await requireAuth();
    await requirePermission("clients", "write");
    const id = String(formData.get("id") ?? "");
    const handled = String(formData.get("handled") ?? "") === "true";
    if (id) await setInboundHandled({ id, handled, actorId: session.user.id });
    const qs = new URLSearchParams();
    const f = String(formData.get("f") ?? "");
    const k = String(formData.get("k") ?? "");
    if (f) qs.set("filter", f);
    if (k) qs.set("kat", k);
    redirect(`/admin/business/berichten${qs.size ? `?${qs}` : ""}`);
  }

  const filterHref = (filter: "open" | "alles", k?: string) => {
    const qs = new URLSearchParams();
    if (filter === "alles") qs.set("filter", "alles");
    if (k && k !== "all") qs.set("kat", k);
    return `/admin/business/berichten${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Inkomende e-mail</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Berichten</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        E-mail van chefs en klanten, automatisch herkend en geclassificeerd. De berichttekst is
        afzender-inhoud — links erin niet zomaar vertrouwen.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {(["open", "alles"] as const).map((f) => (
          <Link
            key={f}
            href={filterHref(f, sp.kat)}
            className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] ${
              (f === "alles") === showAll
                ? "bg-burgundy text-white"
                : "border border-ink-200 bg-white text-ink-700 hover:border-burgundy/40"
            }`}
          >
            {f === "open" ? "Onafgehandeld" : "Alles"}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-ink-200" />
        {CATEGORIES.map((c) => (
          <Link
            key={c.value}
            href={filterHref(showAll ? "alles" : "open", c.value)}
            className={`rounded-full px-3 py-1.5 font-ui text-[11px] font-medium ${
              (kat ?? "all") === c.value
                ? "bg-ink-900 text-white"
                : "border border-ink-200 bg-white text-ink-600 hover:border-burgundy/40"
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          {showAll ? "Nog geen binnengekomen berichten." : "Niets onafgehandeld. 👍"}
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((m) => {
            const badge = CATEGORY_BADGE[m.category];
            const who = m.fromName ? `${m.fromName} · ${m.fromEmail}` : m.fromEmail;
            const inboxLabel = inboxLabelFor(m.toEmail, allInboxes);
            return (
              <li key={m.id} className={`rounded-lg border bg-white p-4 ${m.handledAt ? "border-ink-100 opacity-70" : "border-ink-200"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] ${badge.cls}`}>
                    {badge.label}
                  </span>
                  {inboxLabel ? (
                    <span className="rounded-full border border-burgundy/20 bg-burgundy/5 px-2.5 py-0.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-burgundy">
                      {inboxLabel}
                    </span>
                  ) : null}
                  {m.matchedChefId ? (
                    <Link href={`/admin/business/chefs/${m.matchedChefId}`} className="font-ui text-[11px] text-burgundy underline-offset-4 hover:underline">
                      Chef: {m.chefName ?? "bekijk"}
                    </Link>
                  ) : null}
                  {m.matchedClientId ? (
                    <Link href={`/admin/business/clients/${m.matchedClientId}`} className="font-ui text-[11px] text-burgundy underline-offset-4 hover:underline">
                      Klant: {m.clientName ?? "bekijk"}
                    </Link>
                  ) : null}
                  {m.matchedUserId ? (
                    <span className="rounded-full border border-ink-200 bg-ink-50 px-2.5 py-0.5 font-ui text-[10px] font-medium uppercase tracking-[0.12em] text-ink-600">
                      Intern{m.userName ? `: ${m.userName}` : ""}
                    </span>
                  ) : null}
                  {!m.matchedChefId && !m.matchedClientId && !m.matchedUserId ? (
                    <span className="font-ui text-[11px] text-ink-400">Onbekende afzender</span>
                  ) : null}
                  <span className="ml-auto font-ui text-[11px] text-ink-400">{fmtTime(m.createdAt)}</span>
                </div>

                <p className="mt-2 text-sm font-medium text-ink-900">{m.subject || "(geen onderwerp)"}</p>
                <p className="mt-0.5 text-xs text-ink-500">{who}{m.toEmail ? ` → ${m.toEmail}` : ""}</p>

                {m.bodyPreview ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-ui text-[11px] uppercase tracking-[0.15em] text-ink-500 hover:text-burgundy">
                      Bericht lezen
                    </summary>
                    {/* Untrusted sender text — escaped plain text, never HTML. */}
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-ink-100 bg-ink-50/50 p-3 font-sans text-sm text-ink-800">
                      {m.bodyPreview}
                    </pre>
                  </details>
                ) : (
                  <p className="mt-2 text-xs italic text-ink-400">
                    Geen tekst beschikbaar — open de mail in je mailbox voor de inhoud.
                  </p>
                )}

                <form action={toggleHandled} className="mt-3">
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="handled" value={m.handledAt ? "false" : "true"} />
                  <input type="hidden" name="f" value={showAll ? "alles" : ""} />
                  <input type="hidden" name="k" value={kat ?? ""} />
                  <button
                    type="submit"
                    className={`rounded-full px-4 py-1.5 font-ui text-[11px] font-medium uppercase tracking-[0.15em] ${
                      m.handledAt
                        ? "border border-ink-200 bg-white text-ink-600 hover:border-burgundy/40"
                        : "bg-burgundy text-white hover:bg-burgundy-900"
                    }`}
                  >
                    {m.handledAt ? "Heropen" : "Markeer afgehandeld"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
