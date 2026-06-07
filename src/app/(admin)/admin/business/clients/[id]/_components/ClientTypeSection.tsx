import Link from "next/link";

import { fieldClass } from "@/components/forms/Fields";
import {
  CLIENT_TAG_OPTIONS,
  CLIENT_TYPE_OPTIONS,
} from "@/lib/domain/client-taxonomy";
import type { clients } from "@/lib/db/schema";

/**
 * Klanttype & voorkeuren — the "wat voor klant" editor + favorite/blocked chef
 * lists. ACTION-BEARING: both the `updateClientType` form action and the
 * `removeClientChef` action (used by each ClientChefList) stay in
 * clients/[id]/page.tsx (they close over `id`/`client`) and are passed in as
 * props (`updateClientType`, `removeClientChef`). The form + section markup is
 * relocated verbatim from page.tsx; closures (`client`, `chefNameById`) are now
 * same-name props.
 */
type Client = typeof clients.$inferSelect;

export function ClientTypeSection({
  client,
  chefNameById,
  updateClientType,
  removeClientChef,
}: {
  client: Client;
  chefNameById: Map<string, string>;
  updateClientType: (formData: FormData) => Promise<void>;
  removeClientChef: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">Klanttype &amp; voorkeuren</h2>
      <p className="mt-1 text-sm text-ink-700">
        Bepaalt &quot;wat voor klant&quot; — voedt Chef 360 (&quot;welk klanttype
        doet deze chef&quot;), de filters en de matching-redenen.
      </p>
      <form action={updateClientType} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
            Klanttype
          </span>
          <select
            name="clientType"
            defaultValue={client.clientType ?? ""}
            className={fieldClass}
          >
            <option value="">— kies —</option>
            {CLIENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 font-ui text-[10px] uppercase tracking-[0.2em] text-ink-500">
            Tags
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {CLIENT_TAG_OPTIONS.map((t) => (
              <label key={t.value} className="flex items-center gap-1.5 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name="clientTags"
                  value={t.value}
                  defaultChecked={(client.clientTags ?? []).includes(t.value)}
                  className="accent-burgundy"
                />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2 flex justify-end">
          <button
            type="submit"
            className="rounded-full bg-burgundy px-6 py-2.5 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy-900"
          >
            Opslaan
          </button>
        </div>
      </form>

      <div className="mt-6 grid gap-6 border-t border-ink-100 pt-6 md:grid-cols-2">
        <ClientChefList
          tone="favorite"
          heading="★ Favoriete chefs"
          chefIds={client.favoriteChefIds ?? []}
          chefNameById={chefNameById}
          action={removeClientChef}
          emptyHint="Nog geen favorieten. Markeer een chef vanaf een shift."
        />
        <ClientChefList
          tone="blocked"
          heading="⊘ Geblokkeerde chefs"
          chefIds={client.blockedChefIds ?? []}
          chefNameById={chefNameById}
          action={removeClientChef}
          emptyHint="Geen geblokkeerde chefs. Blokkeer een chef vanaf een shift."
        />
      </div>
    </section>
  );
}

function ClientChefList({
  tone,
  heading,
  chefIds,
  chefNameById,
  action,
  emptyHint,
}: {
  tone: "favorite" | "blocked";
  heading: string;
  chefIds: string[];
  chefNameById: Map<string, string>;
  action: (formData: FormData) => Promise<void>;
  emptyHint: string;
}) {
  const headTone = tone === "favorite" ? "text-emerald-700" : "text-red-700";
  return (
    <div>
      <p className={`font-ui text-[10px] uppercase tracking-[0.2em] ${headTone}`}>
        {heading}
      </p>
      {chefIds.length === 0 ? (
        <p className="mt-2 text-xs text-ink-500">{emptyHint}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {chefIds.map((cid) => (
            <li key={cid} className="flex items-center justify-between gap-2 text-sm">
              <Link
                href={`/admin/business/chefs/${cid}`}
                className="text-ink-900 hover:text-burgundy hover:underline"
              >
                {chefNameById.get(cid) ?? cid}
              </Link>
              <form action={action}>
                <input type="hidden" name="chefId" value={cid} />
                <input type="hidden" name="kind" value={tone} />
                <button
                  type="submit"
                  className="font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500 hover:text-red-600"
                >
                  verwijderen
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
