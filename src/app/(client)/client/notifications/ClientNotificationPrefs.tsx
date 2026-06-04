"use client";

/**
 * Klant mail-preferences (PR-K2-7). Dumb client component — the server page
 * passes the category list (from client-recipients.ts) + current values, so this
 * never imports server-only modules. Toggles map to notification_prefs via the
 * page's setPref server action.
 */

type Category = { event: string; label: string; description: string };

export function ClientNotificationPrefs({
  categories,
  current,
  saveAction,
}: {
  categories: Category[];
  current: Record<string, boolean>;
  saveAction: (formData: FormData) => Promise<void> | void;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Mail-voorkeuren
      </h2>
      <p className="mt-2 max-w-xl text-xs text-ink-500">
        Kies welke mails je van ons wilt ontvangen. Je meldingen hier in het
        portaal blijven altijd staan. Belangrijke berichten over facturatie en
        beveiliging sturen we altijd.
      </p>
      <form
        action={saveAction}
        className="mt-3 space-y-4 rounded-lg border border-ink-200 bg-white p-5"
      >
        {categories.map((c) => (
          <label key={c.event} className="flex items-start gap-3">
            <input
              type="checkbox"
              name={`pref_${c.event}`}
              defaultChecked={current[c.event] !== false}
              className="mt-1 accent-burgundy"
            />
            <span>
              <span className="block text-sm text-ink-900">{c.label}</span>
              <span className="block text-xs text-ink-500">{c.description}</span>
            </span>
          </label>
        ))}
        <button
          type="submit"
          className="mt-1 rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
        >
          Voorkeuren opslaan
        </button>
      </form>
    </section>
  );
}
