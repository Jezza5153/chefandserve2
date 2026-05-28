/**
 * /admin/system/retention — PR-AVG-3. super_admin views + edits the
 * bewaartermijn matrix (retention_policies) and sees the live-purge safety
 * state. The actual purge runs on Railway (workers/retention.ts), DOUBLE-GATED
 * by RETENTION_ENABLED + RETENTION_DRY_RUN.
 */

import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { auditLog, retentionPolicies } from "@/lib/db/schema";
import { requireRole } from "@/lib/permissions";

export const metadata = { title: "Retentiebeleid" };
export const dynamic = "force-dynamic";

const inputCls =
  "w-full rounded border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-900 focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy";

export default async function RetentionAdminPage() {
  await requireRole("super_admin", "/admin/system", { strict: true });

  const policies = await db
    .select()
    .from(retentionPolicies)
    .orderBy(asc(retentionPolicies.entityType));

  // The app server's view of the flags. The WORKER (Railway) reads its own copy.
  const enabled = process.env.RETENTION_ENABLED === "true";
  const dryRun = process.env.RETENTION_DRY_RUN !== "false";
  const livePurgeOn = enabled && !dryRun;

  async function updatePolicy(formData: FormData) {
    "use server";
    const s = await requireRole("super_admin", "/admin/system", { strict: true });
    const entityType = String(formData.get("entityType") ?? "");
    if (!entityType) return;
    const period = String(formData.get("retentionPeriod") ?? "").trim();
    const basis = String(formData.get("legalBasis") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!period || !basis) {
      redirect("/admin/system/retention?err=required");
    }

    const [before] = await db
      .select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.entityType, entityType))
      .limit(1);

    await db
      .update(retentionPolicies)
      .set({ retentionPeriod: period, legalBasis: basis, description, updatedAt: new Date() })
      .where(eq(retentionPolicies.entityType, entityType));

    await db.insert(auditLog).values({
      userId: s.user.id,
      action: "retention_policies.updated",
      resource: "retention_policies",
      resourceId: entityType,
      before: before ? { retentionPeriod: before.retentionPeriod, legalBasis: before.legalBasis } : null,
      after: { retentionPeriod: period, legalBasis: basis },
    });
    redirect("/admin/system/retention");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-serif text-3xl text-ink-900">Retentiebeleid</h1>
      <p className="mt-2 text-sm text-ink-500">
        Bewaartermijnen per gegevenssoort (opslagbeperking, art. 5(1)(e) AVG). De
        wekelijkse retention-worker verwijdert alleen <strong>soft-deleted</strong> rijen
        die hun termijn voorbij zijn én niet onder een wettelijke bewaarplicht vallen.
      </p>

      {/* ----- risk banner ----- */}
      <section
        className={`mt-6 rounded-lg border p-5 ${
          livePurgeOn
            ? "border-red-300 bg-red-50"
            : "border-emerald-300 bg-emerald-50"
        }`}
      >
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em]">
          {livePurgeOn ? (
            <span className="text-red-800">⚠ Live purge staat AAN</span>
          ) : (
            <span className="text-emerald-800">Live purge staat UIT (veilig)</span>
          )}
        </h2>
        <p className="mt-2 text-sm text-ink-700">
          App-server ziet: <code className="rounded bg-white px-1">RETENTION_ENABLED={String(enabled)}</code>{" "}
          <code className="rounded bg-white px-1">RETENTION_DRY_RUN={String(dryRun)}</code>
        </p>
        <p className="mt-1 text-xs text-ink-500">
          De worker draait op Railway en leest zijn eigen kopie van deze variabelen — controleer ze daar voordat je live gaat.
        </p>
        <div className="mt-3">
          <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-burgundy">
            Checklist vóór live purge
          </p>
          <ul className="mt-1 space-y-1 text-sm text-ink-700">
            <li>☐ Dry-run gecontroleerd (kandidaten kloppen)</li>
            <li>☐ Recente backup bestaat (Mac Mini / Neon branch)</li>
            <li>☐ Restore + tombstone-replay getest (`scripts/replay-erasure-tombstones.mjs`)</li>
            <li>☐ Retentiematrix juridisch goedgekeurd</li>
          </ul>
        </div>
      </section>

      {/* ----- policies table ----- */}
      <section className="mt-6">
        <h2 className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">
          Beleidsregels ({policies.length})
        </h2>
        {policies.length === 0 ? (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Nog geen beleidsregels. Voer <code>node scripts/seed-retention-policies.mjs</code> uit om de standaardmatrix te laden.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {policies.map((p) => (
              <form
                key={p.entityType}
                action={updatePolicy}
                className="grid grid-cols-1 gap-2 rounded border border-ink-200 bg-white p-3 md:grid-cols-[180px_120px_1fr_auto] md:items-center"
              >
                <input type="hidden" name="entityType" value={p.entityType} />
                <code className="text-sm text-ink-900">{p.entityType}</code>
                <input name="retentionPeriod" defaultValue={p.retentionPeriod} className={inputCls} aria-label="bewaartermijn" />
                <div className="grid gap-1">
                  <input name="legalBasis" defaultValue={p.legalBasis} className={inputCls} aria-label="grondslag" />
                  <input name="description" defaultValue={p.description ?? ""} placeholder="omschrijving" className={inputCls} aria-label="omschrijving" />
                </div>
                <button
                  type="submit"
                  className="rounded-full border border-burgundy/40 bg-white px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-burgundy hover:bg-burgundy/5"
                >
                  Opslaan
                </button>
              </form>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-500">
          Bewaartermijn als Postgres-interval, bv. <code>7 years</code>, <code>90 days</code>. Volledige uitleg: <code>docs/privacy/retention-matrix.md</code>.
        </p>
      </section>
    </div>
  );
}
