/**
 * /admin/system/privacy-requests/[id] — fulfillment detail (PR-AVG-1).
 * super_admin works the request: verify identity → correspond → extend SLA →
 * decide / withdraw. Export + erasure execution land in PR-AVG-2.
 */

import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { privacyRequestMessages, privacyRequests, users } from "@/lib/db/schema";
import {
  claimPrivacyRequest,
  decidePrivacyRequest,
  extendSla,
  logRequestMessage,
  setIdentityVerification,
  withdrawRequest,
} from "@/lib/domain/privacy";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Privacyverzoek" };
export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const labelCls = "mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy";
const OPEN = ["pending", "in_progress"];

export default async function PrivacyRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
  const { id } = await params;

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

  /* ----- server actions (super_admin) ----- */
  async function doClaim() {
    "use server";
    const s = await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
    await claimPrivacyRequest({ requestId: id, actorId: s.user.id });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doSetIdentity(formData: FormData) {
    "use server";
    const s = await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
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
    const s = await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
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
    const s = await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
    const dateStr = String(formData.get("newDueDate") ?? "");
    const reason = String(formData.get("reason") ?? "");
    if (dateStr && reason.trim()) {
      await extendSla({ requestId: id, actorId: s.user.id, reason, newDueDate: new Date(dateStr) });
    }
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doWithdraw(formData: FormData) {
    "use server";
    const s = await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
    await withdrawRequest({ requestId: id, actorId: s.user.id, notes: String(formData.get("notes") ?? "").trim() || null });
    redirect(`/admin/system/privacy-requests/${id}`);
  }
  async function doDecide(formData: FormData) {
    "use server";
    const s = await requireRole("super_admin", "/admin/system/privacy-requests", { strict: true });
    await decidePrivacyRequest({
      requestId: id,
      actorId: s.user.id,
      outcome: String(formData.get("outcome") ?? "fulfilled") as never,
      decisionNotes: String(formData.get("decisionNotes") ?? "").trim() || null,
    });
    redirect(`/admin/system/privacy-requests/${id}`);
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
        Uiterlijk: {new Date(r.dueDate).toLocaleDateString("nl-NL", { dateStyle: "long" })}
        {r.slaExtendedAt ? " (verlengd)" : ""} · aangevraagd{" "}
        {new Date(r.createdAt).toLocaleDateString("nl-NL", { dateStyle: "long" })}
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

      {/* 3. Decision / SLA / withdraw */}
      {open ? (
        <Section title="3 · Afhandelen">
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
                (Export- en verwijder-uitvoering komt in de volgende update.)
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
