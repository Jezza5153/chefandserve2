/**
 * /admin/business/chef-invoices — CHEF-PR7. The office queue for ZZP chef
 * self-bills: submitted → approve/reject, approved → mark paid. Owner/ops only
 * (cockpit.read). Decisions are atomic (guarded on status), audited, and notify the
 * chef. Distinct from klant-billing (/admin/business/invoices, invoicing-chat lane).
 */
import { revalidatePath } from "next/cache";

import {
  decideChefInvoice,
  listPendingChefInvoices,
} from "@/lib/domain/chef-invoices";
import { formatEuro } from "@/lib/hours-labels";
import { requirePermission } from "@/lib/permissions";
import { getDownloadUrl, r2IsConfigured } from "@/lib/r2";

export const metadata = { title: "ZZP-facturen" };
export const dynamic = "force-dynamic";

async function decide(formData: FormData) {
  "use server";
  const session = await requirePermission("cockpit", "read");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || !["approved", "rejected", "paid"].includes(decision)) return;
  await decideChefInvoice({
    id,
    decidedBy: session.user.id,
    decision: decision as "approved" | "rejected" | "paid",
  });
  revalidatePath("/admin/business/chef-invoices");
}

function Btn({ id, decision, label, tone }: { id: string; decision: string; label: string; tone: "go" | "no" }) {
  return (
    <form action={decide}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <button
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          tone === "go"
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "border border-burgundy/30 text-burgundy hover:bg-burgundy/10"
        }`}
      >
        {label}
      </button>
    </form>
  );
}

export default async function AdminChefInvoicesPage() {
  await requirePermission("cockpit", "read");
  const rows = await listPendingChefInvoices();

  const pdf = new Map<string, string>();
  if (r2IsConfigured()) {
    await Promise.all(
      rows.filter((r) => r.invoiceR2Key).map(async (r) => {
        try {
          pdf.set(r.id, await getDownloadUrl(r.invoiceR2Key!));
        } catch {
          /* skip a broken key */
        }
      }),
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">ZZP-facturen</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Facturen van ZZP-chefs</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">
        Zelf-facturen van ZZP-chefs voor gewerkte uren. Goedkeuren → daarna markeren als
        betaald. Dit staat los van de klant-facturatie.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Geen openstaande ZZP-facturen.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-ink-100 rounded-lg border border-ink-200 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">
                  {r.chefName} · {formatEuro(r.amountCents)}
                  <span className="ml-2 font-ui text-[10px] uppercase tracking-[0.15em] text-ink-500">
                    {r.status === "approved" ? "goedgekeurd" : "ingediend"}
                  </span>
                </p>
                <p className="text-xs text-ink-500">
                  {r.periodFrom ? `${r.periodFrom}${r.periodTo ? ` – ${r.periodTo}` : ""}` : "geen periode"}
                  {r.reference ? ` · ${r.reference}` : ""}
                  {pdf.has(r.id) ? (
                    <>
                      {" · "}
                      <a href={pdf.get(r.id)} target="_blank" rel="noopener noreferrer" className="text-burgundy hover:underline">
                        📎 PDF
                      </a>
                    </>
                  ) : r.invoiceR2Key ? " · PDF bijgevoegd" : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {r.status === "submitted" ? (
                  <>
                    <Btn id={r.id} decision="approved" label="Goedkeuren" tone="go" />
                    <Btn id={r.id} decision="rejected" label="Afwijzen" tone="no" />
                  </>
                ) : (
                  <Btn id={r.id} decision="paid" label="Markeer betaald" tone="go" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
