import Link from "next/link";

import { fieldClass } from "@/components/forms/Fields";
import { listVisibleComments } from "@/lib/domain/comments";
import type { Chef, Placement } from "@/lib/db/schema";

type PlacementComment = Awaited<ReturnType<typeof listVisibleComments>>[number];

/**
 * "Voorgestelde chefs" — existing placements list with status actions + a
 * per-placement comment thread. Action-bearing: the `setPlacementStatus` and
 * `replyComment` "use server" actions stay in page.tsx; this component receives
 * them as props (same names → moved JSX stays character-identical). The
 * `{existingPlacements.length > 0 && (...)}` guard stays in the page.
 */
export function ExistingPlacements({
  existingPlacements,
  commentsByPlacement,
  setPlacementStatus,
  replyComment,
}: {
  existingPlacements: { placement: Placement; chef: Chef }[];
  commentsByPlacement: Map<string, PlacementComment[]>;
  setPlacementStatus: (formData: FormData) => Promise<void>;
  replyComment: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-xl text-ink-900">
        Voorgestelde chefs ({existingPlacements.length})
      </h2>
      <ul className="mt-4 space-y-2">
        {existingPlacements.map(({ placement, chef }) => (
          <li
            key={placement.id}
            className="rounded-lg border border-ink-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/business/chefs/${chef.id}`}
                  className="font-serif text-base text-ink-900 hover:text-burgundy hover:underline"
                >
                  {chef.fullName}
                </Link>
                <p className="mt-0.5 text-xs text-ink-500">
                  {chef.vakniveau ?? "—"} · {chef.city ?? "—"}
                  {placement.matchScore && ` · match-score: ${placement.matchScore}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <PlacementStatusBadge status={placement.status} />
                {placement.status === "proposed" && (
                  <>
                    <PlacementAction
                      action={setPlacementStatus}
                      placementId={placement.id}
                      newStatus="accepted"
                      label="✓ Accepteer"
                      tone="green"
                    />
                    <PlacementAction
                      action={setPlacementStatus}
                      placementId={placement.id}
                      newStatus="rejected"
                      label="✗ Wijs af"
                      tone="red"
                    />
                  </>
                )}
                {placement.status === "accepted" && (
                  <PlacementAction
                    action={setPlacementStatus}
                    placementId={placement.id}
                    newStatus="confirmed"
                    label="Bevestig"
                    tone="green"
                  />
                )}
              </div>
            </div>

            {/* PR-KLANT-3: comment thread (all visibilities) + reply */}
            <div className="mt-3 border-t border-ink-100 pt-3">
              <p className="font-ui text-[10px] uppercase tracking-[0.18em] text-ink-500">
                Berichten
              </p>
              {(commentsByPlacement.get(placement.id) ?? []).length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {(commentsByPlacement.get(placement.id) ?? []).map((c) => (
                    <li key={c.id} className="text-sm">
                      <span className="text-ink-900">{c.body}</span>
                      <span className="ml-2 text-[11px] text-ink-500">
                        {c.authorKind === "client"
                          ? "Klant"
                          : c.authorKind === "chef"
                            ? "Chef"
                            : c.authorKind === "admin"
                              ? "Chef & Serve"
                              : "Systeem"}{" "}
                        · <CommentVisibilityTag visibility={c.visibility} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-ink-500">Nog geen berichten.</p>
              )}

              <form action={replyComment} className="mt-2">
                <input type="hidden" name="placementId" value={placement.id} />
                <textarea
                  name="body"
                  rows={2}
                  required
                  maxLength={1000}
                  placeholder="Reageer op de klant / chef…"
                  className={`${fieldClass} placeholder-ink-500`}
                />
                <div className="mt-2 flex items-center gap-2">
                  <select
                    name="visibility"
                    defaultValue="client_visible"
                    className="rounded border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900 focus:border-burgundy focus:outline-none"
                  >
                    <option value="client_visible">Zichtbaar voor klant</option>
                    <option value="chef_visible">Zichtbaar voor chef</option>
                    <option value="internal">Interne notitie</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded-full bg-burgundy px-4 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-white hover:bg-burgundy-900"
                  >
                    Plaats bericht
                  </button>
                </div>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlacementAction({
  action,
  placementId,
  newStatus,
  label,
  tone,
}: {
  action: (formData: FormData) => Promise<void>;
  placementId: string;
  newStatus: string;
  label: string;
  tone: "green" | "red";
}) {
  const c =
    tone === "green"
      ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      : "border-red-300 text-red-700 hover:bg-red-50";
  return (
    <form action={action}>
      <input type="hidden" name="placementId" value={placementId} />
      <input type="hidden" name="newStatus" value={newStatus} />
      <button
        type="submit"
        className={`rounded-full border px-3 py-1.5 font-ui text-[10px] font-medium uppercase tracking-[0.15em] ${c}`}
      >
        {label}
      </button>
    </form>
  );
}

function PlacementStatusBadge({ status }: { status: string }) {
  const tone =
    status === "confirmed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "accepted"
        ? "bg-blue-100 text-blue-700"
        : status === "proposed"
          ? "bg-amber-100 text-amber-700"
          : status === "rejected" || status === "cancelled" || status === "no_show"
            ? "bg-red-100 text-red-700"
            : "bg-bg-gray text-ink-500";
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-ui text-[9px] font-medium uppercase tracking-wider ${tone}`}
    >
      {status}
    </span>
  );
}

function CommentVisibilityTag({ visibility }: { visibility: string }) {
  const label =
    visibility === "client_visible"
      ? "klant ziet dit"
      : visibility === "chef_visible"
        ? "chef ziet dit"
        : "intern";
  return (
    <span className="italic">{label}</span>
  );
}
