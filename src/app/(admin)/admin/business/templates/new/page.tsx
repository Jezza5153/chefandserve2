/**
 * /admin/business/templates/new — create a recurring shift template
 * (PR-KLANT-4). Needs a client: with ?clientId=, renders the form; without,
 * shows a client picker.
 */

import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { TemplateForm } from "../TemplateForm";
import { db } from "@/lib/db/client";
import { recordAuditFromRequest } from "@/lib/audit";
import { clients, shiftTemplates } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Nieuwe template" };
export const dynamic = "force-dynamic";

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  await requireRole("owner");
  const { clientId } = await searchParams;

  async function createTemplate(formData: FormData) {
    "use server";
    const session = await requireRole("owner");
    const cid = String(formData.get("clientId") ?? "");
    if (!cid) redirect("/admin/business/templates/new");

    const roleNeeded = String(formData.get("roleNeeded") ?? "sous_chef");
    const segmentRaw = String(formData.get("segment") ?? "");
    const dayOfWeek = Number(formData.get("dayOfWeek") ?? 5);
    const startsAtTime = String(formData.get("startsAtTime") ?? "17:00");
    const endsAtTime = String(formData.get("endsAtTime") ?? "23:00");
    // endsNextDay: explicit toggle OR end <= start.
    const endsNextDay =
      formData.get("endsNextDay") === "on" || endsAtTime <= startsAtTime;
    const headcount = Math.max(1, Number(formData.get("headcount") ?? 1));
    const chefRateEur = formData.get("chefRateEur");
    const clientRateEur = formData.get("clientRateEur");
    const horizonDays = Math.min(120, Math.max(7, Number(formData.get("horizonDays") ?? 28)));
    const notes = String(formData.get("notes") ?? "").trim() || null;

    const [row] = await db
      .insert(shiftTemplates)
      .values({
        clientId: cid,
        roleNeeded: roleNeeded as never,
        segment: (segmentRaw || null) as never,
        dayOfWeek,
        startsAtTime,
        endsAtTime,
        endsNextDay,
        headcount,
        chefRateCents: chefRateEur ? Math.round(Number(chefRateEur) * 100) : null,
        clientRateCents: clientRateEur ? Math.round(Number(clientRateEur) * 100) : null,
        generateHorizonDays: horizonDays,
        notes,
        createdBy: session.user.id,
      })
      .returning({ id: shiftTemplates.id });

    await recordAuditFromRequest({
      userId: session.user.id,
      action: "shift_templates.created",
      resource: "shift_templates",
      resourceId: row.id,
      after: { clientId: cid, roleNeeded, dayOfWeek, startsAtTime, endsAtTime, endsNextDay },
    });

    redirect(`/admin/business/templates/${row.id}?ok=created`);
  }

  // No client chosen → picker.
  if (!clientId) {
    const list = await db
      .select({ id: clients.id, companyName: clients.companyName })
      .from(clients)
      .orderBy(asc(clients.companyName))
      .limit(200);
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink />
        <h1 className="mt-2 font-serif text-3xl text-ink-900">Voor welke klant?</h1>
        <p className="mt-2 text-sm text-ink-500">
          Kies de klant waarvoor je een vaste shift wilt instellen.
        </p>
        <ul className="mt-6 space-y-2">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/business/templates/new?clientId=${c.id}`}
                className="block rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-900 hover:border-burgundy/40"
              >
                {c.companyName}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) redirect("/admin/business/templates/new");

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />
      <h1 className="mt-2 font-serif text-3xl text-ink-900">
        Vaste shift voor {client.companyName}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Stel een wekelijks patroon in. De worker maakt elke dag nieuwe shifts
        aan binnen de horizon. Locatie wordt overgenomen uit het klantprofiel.
      </p>
      <div className="mt-6">
        <TemplateForm clientId={client.id} action={createTemplate} />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/business/templates"
      className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
    >
      ← Alle templates
    </Link>
  );
}
