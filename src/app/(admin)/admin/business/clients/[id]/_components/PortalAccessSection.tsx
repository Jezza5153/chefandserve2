import type { clients, users } from "@/lib/db/schema";

/**
 * Klant-portaal toegang — invite / activate / disable the client's portal user.
 * ACTION-BEARING: the `doInviteToPortal`, `doActivatePortal` and
 * `doDisablePortal` server actions stay in clients/[id]/page.tsx (they close
 * over `id`/`client`) and are passed in as props. The section markup is
 * relocated verbatim from page.tsx; closures (`client`, `portalUser`) are now
 * same-name props.
 */
type Client = typeof clients.$inferSelect;
type PortalUser = typeof users.$inferSelect;

export function PortalAccessSection({
  client,
  portalUser,
  doInviteToPortal,
  doActivatePortal,
  doDisablePortal,
}: {
  client: Client;
  portalUser: PortalUser | null;
  doInviteToPortal: () => Promise<void>;
  doActivatePortal: () => Promise<void>;
  doDisablePortal: () => Promise<void>;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-ink-900">
            Klant-portaal toegang
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            Geef deze klant toegang om zelf hun bookings te zien en aanvragen
            in te dienen.
          </p>
        </div>
        {!client.email ? (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Vul eerst een e-mailadres in.
          </p>
        ) : !portalUser ? (
          <form action={doInviteToPortal}>
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Nodig uit voor portaal
            </button>
          </form>
        ) : portalUser.status === "invited" ? (
          <form action={doActivatePortal}>
            <button
              type="submit"
              className="rounded-full bg-emerald-600 px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-emerald-700"
            >
              Activeer (stuur welkom-mail)
            </button>
          </form>
        ) : portalUser.status === "active" ? (
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-emerald-700">
              Actief
            </span>
            <form action={doDisablePortal}>
              <button
                type="submit"
                className="rounded-full border border-red-300 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
              >
                Toegang intrekken
              </button>
            </form>
          </div>
        ) : (
          <span className="rounded-full bg-bg-gray px-3 py-1 font-ui text-[9px] font-medium uppercase tracking-wider text-ink-500">
            {portalUser.status}
          </span>
        )}
      </div>
      {portalUser && (
        <p className="mt-4 text-xs text-ink-500">
          Portal user: {portalUser.email} · status: {portalUser.status}
        </p>
      )}
    </section>
  );
}
