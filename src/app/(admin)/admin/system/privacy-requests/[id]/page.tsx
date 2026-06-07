/**
 * /admin/system/privacy-requests/[id] — fulfillment detail.
 * super_admin works the request through a stepper:
 *   1 identity → 2 correspondence → 3 export / correction / erasure → 4 decide.
 *
 * PR-AVG-1: identity, correspondence, SLA extension, decide, withdraw.
 * PR-AVG-2: preview-before-execute export package (short-lived link), art.16
 * correction (allow-listed field + before/after audit), art.17 erasure
 * (identity-gated, legal-hold-aware, typed-confirm "VERWIJDER <NAAM>", tombstone).
 */

import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { privacyRequestMessages, privacyRequests, users } from "@/lib/db/schema";
import {
  applyCorrection,
  claimPrivacyRequest,
  correctableFields,
  decidePrivacyRequest,
  extendSla,
  logRequestMessage,
  previewCorrection,
  setIdentityVerification,
  withdrawRequest,
  type CorrectableTable,
} from "@/lib/domain/privacy";
import {
  buildUserDataExport,
  previewUserDataExport,
} from "@/lib/domain/privacy-export";
import { eraseUserData, previewUserErasure } from "@/lib/domain/privacy-erasure";
import { resolveSubject } from "@/lib/domain/privacy-subject";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Privacyverzoek" };
export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const labelCls = "mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy";
const OPEN = ["pending", "in_progress"];

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("nl-NL", { dateStyle: "long" });
}

export default async function PrivacyRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  await requirePermission("privacy", "read", "/admin/system/privacy-requests");
  const { id } = await params;
  const sp = await searchParams;

  const r = await db.query.privacyRequests.findFirst({ where: eq(privacyRequests.id, id) });
  if (!r) notFound();
  const [account] = r.userId
    ? await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, r.userId)).limit(1)
    : [];
  const messages = await db
    .select()
    .from(privacyRequestMessages)
    .where(eq(privacyRequestMessages.privacyRequestId, id))
    .orderBy(asc(privacyRequestMessages.createdAt));

  const requesterLabel = r.requesterName ?? account?.name ?? r.requesterEmail ?? account?.email ?? "onbekend";
  const open = OPEN.includes(r.status);
  const identityVerified = r.identityStatus === "verified";

  // Resolve the data subject (drives export / correction / erasure panels).
  const subject = await resolveSubject(r);
  const subjectName = subject.displayName ?? requesterLabel;
  const confirmPhrase = `VERWIJDER ${subjectName}`;

  const showExport = r.type === "access" || r.type === "export";
  const showCorrection = r.type === "correction";
  const showErasure = r.type === "deletion";

  const exportPreview = showExport && open ? await previewUserDataExport(subject) : null;
  const erasurePreview = showErasure && open ? await previewUserErasure(subject) : null;
  const correctionTable: CorrectableTable | null =
    subject.kind === "chef" ? "chefs" : subject.kind === "klant" ? "clients" : null;
  const correctionEntityId = subject.kind === "chef" ? subject.chefId : subject.clientId;
  const correctionCurrent =
    showCorrection && open && correctionTable && correctionEntityId
      ? await Promise.all(
          correctableFields(correctionTable).map(async (f) => {
            const pv = await previewCorrection({
              table: correctionTable,
              entityId: correctionEntityId,
              field: f,
            });
            return { field: f, value: pv.ok ? String(pv.oldValue ?? "—") : "—" };
          }),
        )
      : [];

  /* ----- server actions (super_admin) ----- */
  async function doClaim() {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    await claimPrivacyRequest({ requestId: id, actorId: s.user.id });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doSetIdentity(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    await setIdentityVerification({
      requestId: id,
      actorId: s.user.id,
      status: String(formData.get("status") ?? "verified") as never,
      method: String(formData.get("method") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doLogMessage(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    await logRequestMessage({
      requestId: id,
      actorId: s.user.id,
      direction: String(formData.get("direction") ?? "outbound") as never,
      channel: String(formData.get("channel") ?? "email") as never,
      body: String(formData.get("body") ?? ""),
    });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doExtendSla(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    const dateStr = String(formData.get("newDueDate") ?? "");
    const reason = String(formData.get("reason") ?? "");
    if (dateStr && reason.trim()) {
      await extendSla({ requestId: id, actorId: s.user.id, reason, newDueDate: new Date(dateStr) });
    }
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doWithdraw(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    await withdrawRequest({ requestId: id, actorId: s.user.id, notes: String(formData.get("notes") ?? "").trim() || null });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doDecide(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    await decidePrivacyRequest({
      requestId: id,
      actorId: s.user.id,
      outcome: String(formData.get("outcome") ?? "fulfilled") as never,
      decisionNotes: String(formData.get("decisionNotes") ?? "").trim() || null,
    });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doBuildExport() {
    "use server";
    const s = await requirePermission("privacy", "export", "/admin/system/privacy-requests");
    const res = await buildUserDataExport({ requestId: id, actorId: s.user.id, handlerName: s.user.name ?? null });
    redirect(
      res.ok
        ? `/admin/system/privacy-requests/${id}?ok=export`
        : `/admin/system/privacy-requests/${id}?err=${encodeURIComponent(res.error)}`,
    );
  }
  async function doApplyCorrection(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    const table = String(formData.get("table") ?? "") as CorrectableTable;
    const entityId = String(formData.get("entityId") ?? "");
    const field = String(formData.get("field") ?? "");
    const newValue = String(formData.get("newValue") ?? "");
    if (!table || !entityId || !field) {
      redirect(`/admin/system/privacy-requests/${id}?err=${encodeURIComponent("Onvolledig correctieverzoek")}`);
    }
    const res = await applyCorrection({ requestId: id, actorId: s.user.id, table, entityId, field, newValue });
    redirect(
      res.ok
        ? `/admin/system/privacy-requests/${id}`
        : `/admin/system/privacy-requests/${id}?err=${encodeURIComponent(res.error ?? "Correctie mislukt")}`,
    );
  }
  async function doErase(formData: FormData) {
    "use server";
    const s = await requirePermission("privacy", "process", "/admin/system/privacy-requests");
    const fresh = await db.query.privacyRequests.findFirst({ where: eq(privacyRequests.id, id) });
    if (!fresh) notFound();
    const subj = await resolveSubject(fresh);
    const expected = `VERWIJDER ${subj.displayName ?? "ONBEKEND"}`;
    const typed = String(formData.get("confirm") ?? "");
    const idConfirmed = formData.get("idconfirm") === "on";
    if (!idConfirmed || typed !== expected) {
      redirect(`/admin/system/privacy-requests/${id}?err=${encodeURIComponent("Bevestiging klopt niet — niets verwijderd.")}`);
    }
    const res = await eraseUserData({
      requestId: id,
      actorId: s.user.id,
      reason: String(formData.get("reason") ?? "").trim() || "Verzoek tot verwijdering (art. 17)",
    });
    redirect(
      res.ok
        ? `/admin/system/privacy-requests/${id}?ok=erased`
        : `/admin/system/privacy-requests/${id}?err=${encodeURIComponent(res.error)}`,
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/system/privacy-requests" className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
        ← Alle verzoeken
      </Link>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">{requesterLabel}</h1>
      <p className="mt-1 text-sm text-ink-700">
        {TYPE_LABELS[r.type] ?? r.type} · kanaal {r.originalChannel} · status {r.status}
      </p>
      <p className="mt-1 text-xs text-ink-500">
        Uiterlijk: {fmtDate(r.dueDate)}
        {r.slaExtendedAt ? " (verlengd)" : ""} · aangevraagd {fmtDate(r.createdAt)}
      </p>
      {r.requesterEmail || account?.email ? (
        <p className="mt-1 text-xs text-ink-500">Contact: {r.requesterEmail ?? account?.email} {r.requesterPhone ? `· ${r.requesterPhone}` : ""}</p>
      ) : null}
      {r.rawRequestText ? (
        <p className="mt-3 rounded border border-ink-200 bg-bg-gray p-3 text-sm text-ink-700 whitespace-pre-wrap">{r.rawRequestText}</p>
      ) : null}
      {r.reason && !r.rawRequestText ? (
        <p className="mt-3 rounded border border-ink-200 bg-bg-gray p-3 text-sm text-ink-700 whitespace-pre-wrap">{r.reason}</p>
      ) : null}

      {sp.err ? (
        <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{sp.err}</p>
      ) : null}
      {sp.ok === "export" ? (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Exportpakket gegenereerd. Maak hieronder een tijdelijke downloadlink.
        </p>
      ) : null}
      {sp.ok === "erased" ? (
        <p className="mt-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Verwijdering uitgevoerd. Zie de afhandeling hieronder.
        </p>
      ) : null}

      {/* 1. Identity */}
      <Section title="1 · Identiteit verifiëren">
        <p className="text-sm">
          Status:{" "}
          <strong className={identityVerified ? "text-emerald-700" : "text-amber-700"}>
            {IDENTITY_LABELS[r.identityStatus] ?? r.identityStatus}
          </strong>
          {r.identityMethod ? <span className="text-ink-500"> · {r.identityMethod}</span> : null}
        </p>
        {r.identityNotes ? <p className="mt-1 text-xs text-ink-500">{r.identityNotes}</p> : null}
        {open ? (
          <form action={doSetIdentity} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Conclusie</span>
                <select name="status" defaultValue="verified" className={inputCls}>
                  <option value="verified">Geverifieerd</option>
                  <option value="requested">Bewijs gevraagd</option>
                  <option value="failed">Mislukt / twijfel</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Methode</span>
                <select name="method" defaultValue="logged_in_session" className={inputCls}>
                  <option value="logged_in_session">Ingelogde portal-sessie</option>
                  <option value="known_email_confirmation">E-mail matcht account</option>
                  <option value="phone_call_known_number">Telefonisch (bekend nummer)</option>
                  <option value="document_check">Documentcontrole</option>
                  <option value="admin_manual_check">Handmatige controle</option>
                </select>
              </label>
            </div>
            <textarea name="notes" rows={2} placeholder="Notities over de verificatie" className={inputCls} />
            <button type="submit" className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
              Identiteit vastleggen
            </button>
          </form>
        ) : null}
      </Section>

      {/* 2. Correspondence */}
      <Section title="2 · Correspondentie">
        {messages.length === 0 ? (
          <p className="text-xs text-ink-500">Nog geen berichten gelogd.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded border border-ink-200 bg-white px-3 py-2 text-sm">
                <p className="text-ink-900 whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {m.direction} · {m.channel} · {new Date(m.createdAt).toLocaleString("nl-NL")}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={doLogMessage} className="mt-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="direction" defaultValue="outbound" className={inputCls}>
              <option value="outbound">Uitgaand</option>
              <option value="inbound">Inkomend</option>
              <option value="internal_note">Interne notitie</option>
            </select>
            <select name="channel" defaultValue="email" className={inputCls}>
              <option value="email">E-mail</option>
              <option value="phone">Telefoon</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="letter">Brief</option>
              <option value="portal">Portaal</option>
            </select>
          </div>
          <textarea name="body" rows={2} required placeholder="Bericht / notitie" className={inputCls} />
          <button type="submit" className="rounded-full border border-burgundy/40 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5">
            Bericht loggen
          </button>
        </form>
      </Section>

      {/* 3a. Export package (access / export) */}
      {showExport && open ? (
        <Section title="3 · Exportpakket (art. 15 / 20)">
          <p className="text-xs text-ink-500">
            Onderwerp: {subjectName} ({SUBJECT_KIND_LABELS[subject.kind]})
          </p>
          {exportPreview ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className={labelCls}>Inhoud (voorbeeld)</p>
                <ul className="list-disc pl-5 text-ink-700">
                  {exportPreview.tablesIncluded.length === 0 ? (
                    <li className="text-ink-500">Geen gekoppelde gegevens gevonden.</li>
                  ) : (
                    exportPreview.tablesIncluded.map((t) => (
                      <li key={t}>{t}: {exportPreview.rowCounts[t] ?? 0}</li>
                    ))
                  )}
                </ul>
              </div>
              {exportPreview.legalHolds.length > 0 ? (
                <div>
                  <p className={labelCls}>Wordt bewaard (wettelijke plicht)</p>
                  <ul className="list-disc pl-5 text-ink-700">
                    {exportPreview.legalHolds.map((h) => (
                      <li key={h.entityType}>{h.entityType} ({h.count}) — tot {fmtDate(h.retainUntil)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <details>
                <summary className="cursor-pointer text-xs text-burgundy">Redacties ({exportPreview.redactions.length})</summary>
                <ul className="mt-1 list-disc pl-5 text-xs text-ink-500">
                  {exportPreview.redactions.map((red, i) => <li key={i}>{red}</li>)}
                </ul>
              </details>
              {exportPreview.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
              ))}
            </div>
          ) : null}

          {!identityVerified ? (
            <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Verifieer eerst de identiteit (stap 1) — export is geblokkeerd.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <form action={doBuildExport}>
                <button type="submit" className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
                  {r.responseFileKey ? "Pakket opnieuw genereren" : "Exportpakket genereren"}
                </button>
              </form>
              {r.responseFileKey ? (
                <a
                  href={`/admin/system/privacy-requests/${id}/download`}
                  className="rounded-full border border-burgundy/40 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
                >
                  Download (tijdelijke link, ~7d)
                </a>
              ) : null}
            </div>
          )}
        </Section>
      ) : null}

      {/* 3b. Correction (art. 16) */}
      {showCorrection && open ? (
        <Section title="3 · Correctie (art. 16)">
          {!correctionTable || !correctionEntityId ? (
            <p className="text-sm text-amber-800">Geen gekoppeld chef-/klantprofiel gevonden om te corrigeren.</p>
          ) : (
            <>
              <div className="text-sm">
                <p className={labelCls}>Huidige waarden ({correctionTable})</p>
                <ul className="list-disc pl-5 text-ink-700">
                  {correctionCurrent.map((c) => (
                    <li key={c.field}><span className="text-ink-500">{c.field}:</span> {c.value}</li>
                  ))}
                </ul>
              </div>
              <form action={doApplyCorrection} className="mt-3 space-y-2">
                <input type="hidden" name="table" value={correctionTable} />
                <input type="hidden" name="entityId" value={correctionEntityId} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelCls}>Veld</span>
                    <select name="field" className={inputCls}>
                      {correctableFields(correctionTable).map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelCls}>Nieuwe waarde</span>
                    <input type="text" name="newValue" className={inputCls} />
                  </label>
                </div>
                <button type="submit" className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
                  Corrigeren + aanvrager mailen
                </button>
              </form>
            </>
          )}
        </Section>
      ) : null}

      {/* 3c. Erasure (art. 17) */}
      {showErasure && open ? (
        <Section title="3 · Verwijdering (art. 17)">
          {erasurePreview ? (
            <div className="space-y-3 text-sm">
              <div>
                <p className={labelCls}>Wordt verwijderd / geanonimiseerd</p>
                <ul className="list-disc pl-5 text-ink-700">
                  {erasurePreview.willErase.length === 0 ? (
                    <li className="text-ink-500">Niets gevonden om te verwijderen.</li>
                  ) : (
                    erasurePreview.willErase.map((it) => (
                      <li key={it.table}>{it.table} ({it.count}) — {it.action}</li>
                    ))
                  )}
                </ul>
              </div>
              {erasurePreview.willRetain.length > 0 ? (
                <div>
                  <p className={labelCls}>Blijft bewaard (wettelijke plicht)</p>
                  <ul className="list-disc pl-5 text-ink-700">
                    {erasurePreview.willRetain.map((h) => (
                      <li key={h.entityType}>{h.entityType} ({h.count}) — {h.reason} (tot {fmtDate(h.retainUntil)})</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {erasurePreview.warnings.map((w, i) => (
                <p key={i} className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>
              ))}
            </div>
          ) : null}

          {!identityVerified ? (
            <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Verifieer eerst de identiteit (stap 1) — verwijdering is geblokkeerd.
            </p>
          ) : (
            <form action={doErase} className="mt-4 space-y-2 rounded border border-red-200 bg-red-50/40 p-3">
              <p className="text-xs text-red-800">
                Onomkeerbaar. Type ter bevestiging exact: <code className="rounded bg-white px-1">{confirmPhrase}</code>
              </p>
              <input type="text" name="confirm" required placeholder={confirmPhrase} className={inputCls} />
              <input type="text" name="reason" placeholder="Reden / referentie (optioneel)" className={inputCls} />
              <label className="flex items-center gap-2 text-xs text-ink-700">
                <input type="checkbox" name="idconfirm" /> Ik heb de identiteit gecontroleerd en bevestig de verwijdering.
              </label>
              <button type="submit" className="rounded-full bg-red-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-red-700">
                Definitief verwijderen
              </button>
            </form>
          )}
        </Section>
      ) : null}

      {/* 4. Decision / SLA / withdraw */}
      {open ? (
        <Section title="4 · Afhandelen">
          {r.status === "pending" ? (
            <form action={doClaim} className="mb-4">
              <button type="submit" className="rounded-full bg-blue-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-blue-700">
                In behandeling nemen
              </button>
            </form>
          ) : null}

          {/* SLA extension */}
          <form action={doExtendSla} className="mb-4 rounded border border-ink-200 p-3">
            <p className={labelCls}>Termijn verlengen (art. 12(3) — aanvrager wordt geïnformeerd)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="date" name="newDueDate" required className={inputCls} />
              <input type="text" name="reason" required placeholder="Reden (verplicht)" className={inputCls} />
            </div>
            <button type="submit" className="mt-2 rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray">
              Verleng + stuur bericht
            </button>
          </form>

          {/* Decide */}
          <form action={doDecide} className="rounded border border-ink-200 p-3">
            <p className={labelCls}>Beslissing</p>
            {(r.type === "deletion" || r.type === "export" || r.type === "access") && !identityVerified ? (
              <p className="mb-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Verifieer eerst de identiteit voordat je gegevens vrijgeeft of verwijdert.
              </p>
            ) : null}
            <select name="outcome" defaultValue="fulfilled" className={inputCls}>
              <option value="fulfilled">Afgehandeld</option>
              <option value="partially_fulfilled">Deels afgehandeld</option>
              <option value="rejected">Afgewezen</option>
            </select>
            <textarea name="decisionNotes" rows={2} placeholder="Toelichting (gedeeld met de aanvrager)" className={`${inputCls} mt-2`} />
            <button type="submit" className="mt-2 rounded-full bg-emerald-600 px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700">
              Beslissing vastleggen + aanvrager mailen
            </button>
          </form>

          {/* Withdraw */}
          <form action={doWithdraw} className="mt-4">
            <input type="hidden" name="notes" value="Ingetrokken door aanvrager" />
            <button type="submit" className="rounded-full border border-ink-200 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-500 hover:border-red-300 hover:text-red-700">
              Markeer als ingetrokken
            </button>
          </form>
        </Section>
      ) : (
        <Section title="Afgesloten">
          <p className="text-sm text-ink-700">
            Status: {r.status}. {r.decisionNotes ? `Toelichting: ${r.decisionNotes}` : ""}
          </p>
          {r.responseFileKey ? (
            <a
              href={`/admin/system/privacy-requests/${id}/download`}
              className="mt-3 inline-block rounded-full border border-burgundy/40 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-burgundy hover:bg-burgundy/5"
            >
              Download exportpakket (tijdelijke link)
            </a>
          ) : null}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const TYPE_LABELS: Record<string, string> = {
  access: "Inzage", export: "Export", correction: "Correctie", deletion: "Verwijdering", other: "Overig",
};
const IDENTITY_LABELS: Record<string, string> = {
  not_started: "Niet gestart", requested: "Bewijs gevraagd", verified: "Geverifieerd", failed: "Mislukt",
};
const SUBJECT_KIND_LABELS: Record<string, string> = {
  chef: "chef", klant: "klant-contact", unknown: "onbekend profiel",
};
