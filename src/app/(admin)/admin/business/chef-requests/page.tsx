/**
 * /admin/business/chef-requests — CHEF-PR9b. The owner's queue of chef vacation +
 * expense requests, with one-tap approve/reject. Owner/ops only (cockpit.read).
 * Decisions are atomic (guarded on status='pending'), audited under the actor, and
 * notify the chef. Reached from the "chef_request" notification's deep link.
 */
import { revalidatePath } from "next/cache";

import { Icon } from "@/components/admin/icons";
import {
  decideExpenseClaim,
  decideVacationRequest,
  listPendingChefRequests,
} from "@/lib/domain/chef-requests";
import { formatEuro } from "@/lib/hours-labels";
import { requirePermission } from "@/lib/permissions";
import { getDownloadUrl, r2IsConfigured } from "@/lib/r2";

export const metadata = { title: "Chef-verzoeken" };
export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  reiskosten: "Reiskosten",
  parkeren: "Parkeren",
  ov: "OV",
  kilometers: "Kilometers",
  overig: "Overig",
};

async function decideVacation(formData: FormData) {
  "use server";
  const session = await requirePermission("cockpit", "read");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || (decision !== "approved" && decision !== "rejected")) return;
  await decideVacationRequest({ id, decidedBy: session.user.id, decision });
  revalidatePath("/admin/business/chef-requests");
}

async function decideExpense(formData: FormData) {
  "use server";
  const session = await requirePermission("cockpit", "read");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || (decision !== "approved" && decision !== "rejected")) return;
  await decideExpenseClaim({ id, decidedBy: session.user.id, decision });
  revalidatePath("/admin/business/chef-requests");
}

function DecideButtons({
  id,
  action,
}: {
  id: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="approved" />
        <button className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">
          Goedkeuren
        </button>
      </form>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="rejected" />
        <button className="rounded-full border border-burgundy/30 px-3 py-1 text-xs font-medium text-burgundy hover:bg-burgundy/10">
          Afwijzen
        </button>
      </form>
    </div>
  );
}

export default async function AdminChefRequestsPage() {
  await requirePermission("cockpit", "read");
  const { vacation, expenses } = await listPendingChefRequests();
  const total = vacation.length + expenses.length;

  // Presign receipt downloads (short-lived) for claims that attached a bon.
  const receiptUrls = new Map<string, string>();
  if (r2IsConfigured()) {
    await Promise.all(
      expenses
        .filter((c) => c.receiptR2Key)
        .map(async (c) => {
          try {
            receiptUrls.set(c.id, await getDownloadUrl(c.receiptR2Key!));
          } catch {
            /* skip a broken key — the claim still shows */
          }
        }),
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Chef-verzoeken</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Vakantie &amp; declaraties</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">
        Openstaande verzoeken van chefs. Goedkeuren of afwijzen wordt vastgelegd en de chef
        krijgt een melding. Payroll verwerkt de uiteindelijke uitbetaling.
      </p>

      {total === 0 ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Geen openstaande chef-verzoeken.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {vacation.length > 0 ? (
            <section className="rounded-lg border border-ink-200 bg-white p-5">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                Vakantie ({vacation.length})
              </p>
              <ul className="mt-3 divide-y divide-ink-100">
                {vacation.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{r.chefName}</p>
                      <p className="text-xs text-ink-500">
                        {r.kind === "payout"
                          ? `Uitbetaling ${r.amountCents != null ? formatEuro(r.amountCents) : "—"}`
                          : `Vrij ${r.startDate ?? "?"}${r.endDate ? ` – ${r.endDate}` : ""}`}
                        {r.note ? ` · ${r.note}` : ""}
                      </p>
                    </div>
                    <DecideButtons id={r.id} action={decideVacation} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {expenses.length > 0 ? (
            <section className="rounded-lg border border-ink-200 bg-white p-5">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                Declaraties ({expenses.length})
              </p>
              <ul className="mt-3 divide-y divide-ink-100">
                {expenses.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">{c.chefName}</p>
                      <p className="text-xs text-ink-500">
                        {CATEGORY_LABEL[c.category] ?? c.category} · {formatEuro(c.amountCents)}
                        {c.description ? ` · ${c.description}` : ""}
                        {receiptUrls.has(c.id) ? (
                          <>
                            {" · "}
                            <a
                              href={receiptUrls.get(c.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-burgundy hover:underline"
                            >
                              📎 Bon bekijken
                            </a>
                          </>
                        ) : c.receiptR2Key ? (
                          " · bon bijgevoegd"
                        ) : null}
                      </p>
                    </div>
                    <DecideButtons id={c.id} action={decideExpense} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-400">
        <Icon name="info" className="h-3.5 w-3.5" />
        Beslissingen zijn definitief in de wachtrij — de chef ziet de uitkomst direct.
      </p>
    </div>
  );
}
