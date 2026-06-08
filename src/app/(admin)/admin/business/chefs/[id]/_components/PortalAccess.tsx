import { chefs, users } from "@/lib/db/schema";

type ChefRow = typeof chefs.$inferSelect;
type PortalUser = typeof users.$inferSelect;

/**
 * Chef-portaal toegang. Action-bearing — the three portal actions stay in page.tsx
 * (they close over the route `id` / chef) and arrive as props. The original
 * `<section className="mt-8 ... p-6">` card is kept as-is (DetailSection hardcodes
 * `mt-6 ... p-5`, which would not be pixel-identical here), so only the inner markup
 * is relocated verbatim.
 */
export function PortalAccess({
  chef,
  portalUser,
  doInviteToPortal,
  doInviteAndActivate,
  doActivatePortal,
  doDisablePortal,
}: {
  chef: ChefRow;
  portalUser: PortalUser | null | undefined;
  doInviteToPortal: () => Promise<void>;
  doInviteAndActivate: () => Promise<void>;
  doActivatePortal: () => Promise<void>;
  doDisablePortal: () => Promise<void>;
}) {
  return (
    /* @verbatim-start */
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg text-ink-900">
            Chef-portaal toegang
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            Geef deze chef toegang tot het portaal om zelf shifts te bekijken
            en te accepteren.
          </p>
        </div>
        {!chef.email ? (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Vul eerst een e-mailadres in.
          </p>
        ) : !portalUser ? (
          <div className="flex flex-col items-end gap-2">
            <form action={doInviteAndActivate}>
              <button
                type="submit"
                className="rounded-full bg-burgundy px-5 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
              >
                Uitnodigen &amp; activeren
              </button>
            </form>
            <form action={doInviteToPortal}>
              <button
                type="submit"
                className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline"
              >
                alleen uitnodigen (geen mail)
              </button>
            </form>
          </div>
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
    /* @verbatim-end */
  );
}
