/**
 * /admin/system/inboxen — inbox-access beheer (PR-INBOX-ACCESS). Roles ≠ inboxes:
 * super_admin defines the captured mailboxes (planning@, de owners' eigen adressen, …) and maps
 * which staff member sees which. Berichten filters on this; inbound notifications route to the
 * matched inbox's members. No inboxes configured → everyone with toegang sees everything.
 *
 * super_admin-only: requirePermission("system","write") (super_admin bypasses the catalog;
 * nobody else holds system.write).
 */
import { redirect } from "next/navigation";

import { fieldClass } from "@/components/forms/Fields";
import {
  createInbox,
  deleteInbox,
  grantInboxAccess,
  listInboxesWithMembers,
  revokeInboxAccess,
} from "@/lib/domain/inboxes";
import { requirePermission } from "@/lib/permissions";

export const metadata = { title: "Inboxen" };
export const dynamic = "force-dynamic";

export default async function InboxenPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  await requirePermission("system", "write");
  const sp = await searchParams;
  const boxes = await listInboxesWithMembers();

  async function createAction(formData: FormData) {
    "use server";
    const session = await requirePermission("system", "write");
    const res = await createInbox({
      address: String(formData.get("address") ?? ""),
      label: String(formData.get("label") ?? ""),
      actorId: session.user.id,
    });
    redirect(`/admin/system/inboxen${res.ok ? "" : `?err=${encodeURIComponent(res.error)}`}`);
  }

  async function deleteAction(formData: FormData) {
    "use server";
    const session = await requirePermission("system", "write");
    const inboxId = String(formData.get("inboxId") ?? "");
    if (inboxId) await deleteInbox({ inboxId, actorId: session.user.id });
    redirect("/admin/system/inboxen");
  }

  async function grantAction(formData: FormData) {
    "use server";
    const session = await requirePermission("system", "write");
    const inboxId = String(formData.get("inboxId") ?? "");
    const userEmail = String(formData.get("userEmail") ?? "");
    const res = inboxId && userEmail
      ? await grantInboxAccess({ inboxId, userEmail, actorId: session.user.id })
      : ({ ok: false, error: "Inbox en e-mail zijn verplicht." } as const);
    redirect(`/admin/system/inboxen${res.ok ? "" : `?err=${encodeURIComponent(res.error)}`}`);
  }

  async function revokeAction(formData: FormData) {
    "use server";
    const session = await requirePermission("system", "write");
    const inboxId = String(formData.get("inboxId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    if (inboxId && userId) await revokeInboxAccess({ inboxId, userId, actorId: session.user.id });
    redirect("/admin/system/inboxen");
  }

  return (
    <div>
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Systeem</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Inboxen & toegang</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        Rollen ≠ inboxen: koppel hier wie welke gevangen mailbox ziet (Berichten filtert erop, en
        notificaties van nieuwe mail gaan naar de leden van die inbox). Geen inboxen ingesteld =
        iedereen met toegang ziet alles.
      </p>

      {sp.err ? (
        <p className="mt-4 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-2 text-sm text-burgundy">{sp.err}</p>
      ) : null}

      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Nieuwe inbox</h2>
        <form action={createAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Label</span>
            <input name="label" placeholder="Planning" className={fieldClass} required />
          </label>
          <label className="block">
            <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Adres</span>
            <input name="address" type="email" placeholder="planning@chefandserve.nl" className={fieldClass} required />
          </label>
          <button type="submit" className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900">
            Toevoegen
          </button>
        </form>
      </section>

      {boxes.length === 0 ? (
        <div className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Nog geen inboxen — iedereen met toegang ziet nu alle berichten.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {boxes.map((b) => (
            <section key={b.id} className="rounded-lg border border-ink-200 bg-white p-5">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-serif text-lg text-ink-900">{b.label}</h3>
                <span className="font-ui text-[11px] text-ink-500">{b.address}</span>
                <form action={deleteAction} className="ml-auto">
                  <input type="hidden" name="inboxId" value={b.id} />
                  <button type="submit" className="rounded-full border border-ink-200 px-3 py-1 font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:border-burgundy/40 hover:text-burgundy">
                    Verwijder inbox
                  </button>
                </form>
              </div>

              <div className="mt-3">
                <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">Toegang</p>
                {b.members.length === 0 ? (
                  <p className="mt-1 text-sm italic text-ink-400">Nog niemand — alleen super_admin ziet deze inbox.</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {b.members.map((u) => (
                      <li key={u.userId} className="flex items-center gap-2 rounded-full border border-ink-200 bg-ink-50/60 px-3 py-1">
                        <span className="text-sm text-ink-800">{u.name ?? u.email}</span>
                        <form action={revokeAction}>
                          <input type="hidden" name="inboxId" value={b.id} />
                          <input type="hidden" name="userId" value={u.userId} />
                          <button type="submit" aria-label={`Verwijder ${u.name ?? u.email}`} className="font-ui text-[11px] text-ink-400 hover:text-burgundy">✕</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                <form action={grantAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="inboxId" value={b.id} />
                  <input name="userEmail" type="email" placeholder="login-e-mail van medewerker" className={fieldClass} required />
                  <button type="submit" className="rounded-full border border-ink-200 bg-white px-4 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-ink-700 hover:border-burgundy/40">
                    Geef toegang
                  </button>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
