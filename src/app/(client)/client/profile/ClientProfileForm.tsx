"use client";

/**
 * ClientProfileForm — the klant's directly-editable fields (PR-KLANT-1).
 *
 * Three sections, one save:
 *   Contactpersoon  — contactName · phone · email (communicatie)
 *   Shiftlocatie    — shiftAddress · city · shiftArrivalNotes
 *   Facturatie      — billingEmail (changing it emails the OLD address)
 *
 * Editing shiftAddress/city here affects only FUTURE requests + templates —
 * existing shifts snapshot their own location and are never rewritten.
 *
 * Native HTML form posting to the server action. No client state needed;
 * kept as a component so the page stays readable and the file is reusable.
 */

type Props = {
  client: {
    contactName: string | null;
    phone: string | null;
    email: string | null;
    shiftAddress: string | null;
    city: string | null;
    shiftArrivalNotes: string | null;
    billingEmail: string | null;
  };
  saveAction: (formData: FormData) => Promise<void> | void;
};

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";
const labelCls =
  "mb-1 block font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy";

export function ClientProfileForm({ client, saveAction }: Props) {
  return (
    <form action={saveAction} className="mt-6 space-y-8">
      {/* Contactpersoon */}
      <fieldset className="rounded-lg border border-ink-200 bg-white p-5">
        <legend className="px-1 font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Contactpersoon
        </legend>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className={labelCls}>Naam contactpersoon</span>
            <input
              type="text"
              name="contactName"
              defaultValue={client.contactName ?? ""}
              placeholder="Voor- en achternaam"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Telefoon</span>
            <input
              type="tel"
              name="phone"
              defaultValue={client.phone ?? ""}
              placeholder="020-1234567"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>E-mail voor communicatie</span>
            <input
              type="email"
              name="email"
              defaultValue={client.email ?? ""}
              placeholder="planning@hotel.nl"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-ink-500">
              Waar we shift-updates naartoe sturen. Dit is niet je inlog-e-mail.
            </span>
          </label>
        </div>
      </fieldset>

      {/* Shiftlocatie */}
      <fieldset className="rounded-lg border border-ink-200 bg-white p-5">
        <legend className="px-1 font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Shiftlocatie
        </legend>
        <p className="mt-2 text-xs text-ink-500">
          Waar chefs zich melden. Wijzigingen gelden voor nieuwe aanvragen —
          al ingeplande shifts houden hun eigen locatie.
        </p>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className={labelCls}>Adres waar chefs zich melden</span>
            <input
              type="text"
              name="shiftAddress"
              defaultValue={client.shiftAddress ?? ""}
              placeholder="Straat 1, Amsterdam"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Plaats</span>
            <input
              type="text"
              name="city"
              defaultValue={client.city ?? ""}
              placeholder="Amsterdam"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Extra aankomstinfo</span>
            <textarea
              name="shiftArrivalNotes"
              rows={3}
              defaultValue={client.shiftArrivalNotes ?? ""}
              placeholder="Bijv. ‘personeelsingang achterzijde’, ‘vraag naar de souschef’, gate-code 1234"
              className={inputCls}
            />
          </label>
        </div>
      </fieldset>

      {/* Facturatie (editable part) */}
      <fieldset className="rounded-lg border border-ink-200 bg-white p-5">
        <legend className="px-1 font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Facturatie e-mailadres
        </legend>
        <div className="mt-3 space-y-4">
          <label className="block">
            <span className={labelCls}>Facturatie e-mailadres</span>
            <input
              type="email"
              name="billingEmail"
              defaultValue={client.billingEmail ?? ""}
              placeholder="facturen@hotel.nl"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-ink-500">
              Bij wijziging sturen we ook een bevestiging naar je vorige
              facturatie-adres.
            </span>
          </label>
        </div>
      </fieldset>

      <button
        type="submit"
        className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
      >
        Wijzigingen opslaan
      </button>
    </form>
  );
}
