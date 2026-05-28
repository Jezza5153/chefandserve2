"use client";

/**
 * ClientRequestChangeFormSection — the finance + structural fields that flow
 * through admin approval (PR-KLANT-1):
 *
 *   companyName · kvk · btw · paymentTermsDays · billingAddress · authEmail
 *
 * These can't be self-served: they change what appears on offertes, facturen
 * and the legal afspraak, and paymentTermsDays is a negotiated finance term.
 * Each "Verzoek wijziging" opens a small inline form → INSERT
 * client_change_requests → admin reviews in the Wijzigingsverzoeken tab.
 */

import { useState } from "react";

type Field =
  | "companyName"
  | "kvk"
  | "btw"
  | "paymentTermsDays"
  | "billingAddress"
  | "authEmail"
  | null;

type Props = {
  client: {
    companyName: string;
    kvk: string | null;
    btw: string | null;
    paymentTermsDays: number | null;
    billingAddress: string | null;
    /** The login/auth email (lives on users, shown read-only here). */
    authEmail: string | null;
  };
  requestAction: (formData: FormData) => Promise<void> | void;
};

const ROWS: Array<{ field: Exclude<Field, null>; label: string }> = [
  { field: "companyName", label: "Bedrijfsnaam" },
  { field: "kvk", label: "KvK-nummer" },
  { field: "btw", label: "BTW-nummer" },
  { field: "paymentTermsDays", label: "Betaaltermijn" },
  { field: "billingAddress", label: "Factuuradres" },
  { field: "authEmail", label: "Inlog-e-mail" },
];

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder-ink-500 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";

export function ClientRequestChangeFormSection({ client, requestAction }: Props) {
  const [open, setOpen] = useState<Field>(null);

  function currentFor(field: Exclude<Field, null>): string {
    switch (field) {
      case "companyName":
        return client.companyName;
      case "kvk":
        return client.kvk ?? "—";
      case "btw":
        return client.btw ?? "—";
      case "paymentTermsDays":
        return client.paymentTermsDays
          ? `${client.paymentTermsDays} dagen`
          : "14 dagen";
      case "billingAddress":
        return client.billingAddress ?? "—";
      case "authEmail":
        return client.authEmail ?? "—";
    }
  }

  return (
    <section className="mt-10 rounded-lg border border-burgundy/20 bg-burgundy/5 p-5">
      <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
        Aanpassen via verzoek
      </h2>
      <p className="mt-1 text-xs text-ink-700">
        Bedrijfs- en facturatiegegevens controleren we eerst, zodat offertes,
        facturen en afspraken blijven kloppen. Stuur een verzoek; Maarten of
        Gina bevestigt en past het aan.
      </p>

      <ul className="mt-4 space-y-3">
        {ROWS.map((r) => (
          <Row
            key={r.field}
            label={r.label}
            current={currentFor(r.field)}
            onOpen={() => setOpen(r.field)}
          />
        ))}
      </ul>

      {open !== null ? (
        <form
          action={requestAction}
          className="mt-4 rounded-lg border border-ink-200 bg-white p-4"
        >
          <input type="hidden" name="field" value={open} />
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Wijziging voor {labelFor(open)}
          </p>

          {open === "paymentTermsDays" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">
                Gewenste betaaltermijn (dagen)
              </span>
              <input
                type="number"
                name="proposed"
                min={0}
                max={120}
                step={1}
                required
                defaultValue={client.paymentTermsDays ?? 14}
                className={`${inputCls} font-mono`}
              />
            </label>
          ) : open === "billingAddress" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">
                Nieuw factuuradres
              </span>
              <textarea
                name="proposed"
                rows={3}
                required
                defaultValue={client.billingAddress ?? ""}
                placeholder="Straat 1, 1011 AB Amsterdam"
                className={inputCls}
              />
            </label>
          ) : open === "authEmail" ? (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">
                Nieuw inlog-e-mailadres
              </span>
              <input
                type="email"
                name="proposed"
                required
                defaultValue={client.authEmail ?? ""}
                className={inputCls}
              />
            </label>
          ) : (
            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-ink-500">
                Nieuwe waarde voor {labelFor(open)}
              </span>
              <input
                type="text"
                name="proposed"
                required
                defaultValue={currentFor(open) === "—" ? "" : currentFor(open)}
                className={inputCls}
              />
            </label>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink-500">
              Toelichting (min 5 tekens)
            </span>
            <textarea
              name="reason"
              rows={3}
              required
              minLength={5}
              placeholder="Bijv. ‘nieuw KvK na overname’ of ‘betaaltermijn naar 30 dagen i.v.m. interne administratie’"
              className={inputCls}
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
            >
              Verzoek versturen
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded-full border border-ink-200 bg-white px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-ink-700 hover:bg-bg-gray"
            >
              Annuleer
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Row({
  label,
  current,
  onOpen,
}: {
  label: string;
  current: string;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-ink-200 bg-white px-4 py-3">
      <div>
        <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
          {label}
        </p>
        <p className="text-sm text-ink-900">{current}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 rounded-full border border-burgundy/40 bg-white px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
      >
        Verzoek wijziging
      </button>
    </li>
  );
}

function labelFor(field: Exclude<Field, null>): string {
  return (
    {
      companyName: "bedrijfsnaam",
      kvk: "KvK-nummer",
      btw: "BTW-nummer",
      paymentTermsDays: "betaaltermijn",
      billingAddress: "factuuradres",
      authEmail: "inlog-e-mailadres",
    } as const
  )[field];
}
