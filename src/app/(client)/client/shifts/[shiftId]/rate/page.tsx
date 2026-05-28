/**
 * /client/shifts/[shiftId]/rate — klant gives feedback on the chef (PR-KLANT-5).
 *
 * Feedback is INTERNAL-ONLY (visible to Chef & Serve). One rating per
 * placement (ratings.placement_id UNIQUE → double-submit guarded). Rateable
 * once the placement is completed.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RatingForm } from "./RatingForm";
import { db } from "@/lib/db/client";
import { chefs, clients, placements, shifts } from "@/lib/db/schema";
import { submitRating } from "@/lib/domain/ratings";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Feedback", robots: { index: false } };
export const dynamic = "force-dynamic";

async function getOwnClient(userId: string) {
  const [c] = await db
    .select({ id: clients.id, companyName: clients.companyName })
    .from(clients)
    .where(eq(clients.userId, userId))
    .limit(1);
  return c ?? null;
}

export default async function RateShiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ shiftId: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const session = await requireAuth();
  const { shiftId } = await params;
  const sp = await searchParams;
  const client = await getOwnClient(session.user.id);
  if (!client) redirect("/client");

  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);
  if (!shift || shift.clientId !== client.id) notFound();

  // The placement to rate: a completed placement on this shift.
  const [placement] = await db
    .select({ id: placements.id, chefName: chefs.fullName })
    .from(placements)
    .innerJoin(chefs, eq(chefs.id, placements.chefId))
    .where(
      and(
        eq(placements.shiftId, shiftId),
        inArray(placements.status, ["completed", "confirmed"]),
      ),
    )
    .orderBy(desc(placements.confirmedAt))
    .limit(1);

  async function submitRatingAction(formData: FormData) {
    "use server";
    const s = await requireAuth();
    const c = await getOwnClient(s.user.id);
    if (!c) redirect("/client");
    const placementId = String(formData.get("placementId") ?? "");
    const stars = Number(formData.get("stars") ?? 0);
    const tags = formData.getAll("tags").map((t) => String(t));
    const comment = String(formData.get("comment") ?? "");
    const res = await submitRating({
      placementId,
      clientId: c.id,
      createdBy: s.user.id,
      stars,
      tags,
      comment,
    });
    redirect(
      res.ok
        ? `/client/shifts/${shiftId}?ok=rated`
        : `/client/shifts/${shiftId}/rate?err=${res.error}`,
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href={`/client/shifts/${shiftId}`}
        className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy hover:underline"
      >
        ← Terug naar shift
      </Link>

      <h1 className="mt-2 font-serif text-3xl text-ink-900">
        Feedback geven{placement ? ` over ${placement.chefName}` : ""}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Je feedback is alleen zichtbaar voor Chef &amp; Serve. We gebruiken het
        om volgende matches beter te maken.
      </p>

      {sp.err === "already_rated" ? (
        <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Je hebt al feedback gegeven voor deze shift. Bedankt!
        </p>
      ) : sp.err ? (
        <p className="mt-6 rounded border border-burgundy/30 bg-burgundy/5 px-4 py-3 text-sm text-burgundy">
          Er ging iets mis. Probeer het opnieuw.
        </p>
      ) : null}

      {!placement ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-bg-gray p-6 text-sm text-ink-500">
          Deze shift is nog niet afgerond. Je kunt feedback geven zodra de chef
          de shift heeft gewerkt.
        </p>
      ) : (
        <RatingForm
          placementId={placement.id}
          chefName={placement.chefName}
          action={submitRatingAction}
        />
      )}
    </div>
  );
}
