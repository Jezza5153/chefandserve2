/**
 * /admin/system/privacy-requests/new — super_admin logs an off-portal AVG
 * request (email/phone/WhatsApp/letter) so it gets an SLA clock + audit trail
 * even when the requester can't (or won't) use the portal (PR-AVG-1).
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { createPrivacyRequest } from "@/lib/domain/privacy";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Handmatig privacyverzoek" };
export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const labelCls = "mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy";

export default async function NewPrivacyRequestPage() {
  await requirePermission("privacy", "read", "/admin/system/privacy-requests");

  async function create(formData: FormData) {
    "use server";
    const session = await requirePermission("privacy", "read", "/admin/system/privacy-requests");
    const type = String(formData.get("type") ?? "access") as
      | "access" | "export" | "correction" | "deletion" | "other";
    const requesterKind = String(formData.get("requesterKind") ?? "unknown") as
      | "chef" | "klant" | "unknown" | "external";
    const originalChannel = String(formData.get("originalChannel") ?? "email") as
      | "portal" | "email" | "phone" | "whatsapp" | "letter";
    const res = await createPrivacyRequest({
      type,
      requesterKind,
      requesterName: String(formData.get("requesterName") ?? "").trim() || null,
      requesterEmail: String(formData.get("requesterEmail") ?? "").trim() || null,
      requesterPhone: String(formData.get("requesterPhone") ?? "").trim() || null,
      originalChannel,
      rawRequestText: String(formData.get("rawRequestText") ?? "").trim() || null,
      reason: String(formData.get("rawRequestText") ?? "").trim() || null,
      identityStatus: "not_started", // off-portal → must verify identity
      actorId: session.user.id,
    });
    redirect(res.ok ? `/admin/system/privacy-requests/${res.id}` : "/admin/system/privacy-requests/new");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/admin/system/privacy-requests" className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline">
        ← Alle verzoeken
      </Link>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Handmatig privacyverzoek</h1>
      <p className="mt-2 text-sm text-ink-500">
        Leg een verzoek vast dat buiten het portaal binnenkwam (e-mail, telefoon,
        WhatsApp, brief). De 30-dagen termijn start nu. Identiteit staat op
        &ldquo;niet gestart&rdquo; — verifieer die eerst op de detailpagina.
      </p>

      <form action={create} className="mt-6 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Type verzoek</span>
          <select name="type" className={inputCls}>
            <option value="access">Inzage</option>
            <option value="export">Export</option>
            <option value="correction">Correctie</option>
            <option value="deletion">Verwijdering</option>
            <option value="other">Anders / overig</option>
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Aanvrager-type</span>
          <select name="requesterKind" className={inputCls}>
            <option value="chef">Chef</option>
            <option value="klant">Klant</option>
            <option value="external">Externe partij</option>
            <option value="unknown">Onbekend</option>
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Naam</span>
          <input name="requesterName" type="text" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Origineel kanaal</span>
          <select name="originalChannel" className={inputCls}>
            <option value="email">E-mail</option>
            <option value="phone">Telefoon</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="letter">Brief</option>
            <option value="portal">Portaal</option>
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>E-mail</span>
          <input name="requesterEmail" type="email" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Telefoon</span>
          <input name="requesterPhone" type="tel" className={inputCls} />
        </label>
        <label className="block md:col-span-2">
          <span className={labelCls}>Verzoek (letterlijk, zoals ontvangen)</span>
          <textarea name="rawRequestText" rows={4} className={inputCls} />
        </label>
        <div className="md:col-span-2">
          <button type="submit" className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
            Verzoek vastleggen
          </button>
        </div>
      </form>
    </div>
  );
}
