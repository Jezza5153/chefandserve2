/**
 * /admin/business/board — "Prikbord" admin compose (BOARD-1).
 *
 * Owner/planner posts announcements for the team; chefs read on /chef/board
 * (PR-9) once BOARD_ENABLED is on. RBAC-gated (board.write). Bodies render as
 * escaped text (whitespace-pre-wrap) — never dangerouslySetInnerHTML.
 */
import { boardEnabled, listAdminPosts } from "@/lib/domain/board";
import { requirePermission } from "@/lib/permissions";

import { createPostAction, deletePostAction, togglePinAction } from "./actions";

export const metadata = { title: "Prikbord", robots: { index: false } };
export const dynamic = "force-dynamic";

const FLASH: Record<string, string> = {
  created: "✓ Bericht geplaatst.",
  deleted: "✓ Bericht verwijderd.",
  pinned: "✓ Bijgewerkt.",
  empty: "Bericht is leeg.",
};

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  await requirePermission("board", "write", "/admin/business");
  const sp = await searchParams;
  const posts = await listAdminPosts();
  const flash = sp.ok ? FLASH[sp.ok] : sp.err ? FLASH[sp.err] : null;

  return (
    <div className="max-w-3xl">
      <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy">Beheer</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900">Prikbord</h1>
      <p className="mt-2 text-sm text-ink-600">
        Plaats een bericht voor het team.{" "}
        {boardEnabled()
          ? "Chefs zien dit op hun prikbord."
          : "Het chef-prikbord staat nog uit (BOARD_ENABLED) — je kunt alvast berichten klaarzetten."}
      </p>

      {flash ? (
        <p className="mt-4 rounded bg-bg-gray px-3 py-2 text-sm text-ink-700">{flash}</p>
      ) : null}

      <form action={createPostAction} className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <textarea
          name="body"
          rows={4}
          required
          maxLength={4000}
          placeholder="Wat wil je delen met het team? (aankondiging, weetje, iets leuks…)"
          className="w-full rounded border border-ink-200 p-3 text-sm placeholder-ink-400"
        />
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" name="pinned" /> Vastpinnen
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            Zichtbaar voor:
            <select name="audience" className="rounded border border-ink-200 px-2 py-1 text-sm">
              <option value="chefs">Chefs</option>
              <option value="all">Iedereen</option>
            </select>
          </label>
          <button
            type="submit"
            className="ml-auto rounded-full bg-burgundy px-5 py-2 font-ui text-[11px] font-medium uppercase tracking-[0.18em] text-white hover:bg-burgundy/90"
          >
            Plaatsen
          </button>
        </div>
      </form>

      <div className="mt-6 space-y-3">
        {posts.length === 0 ? (
          <p className="rounded-lg border border-ink-200 bg-white p-6 text-center text-sm text-ink-500">
            Nog geen berichten.
          </p>
        ) : (
          posts.map((p) => (
            <div key={p.id} className="rounded-lg border border-ink-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {p.pinned ? (
                    <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                      Vastgepind
                    </span>
                  ) : null}
                  <span className="font-ui text-[10px] uppercase tracking-wider text-ink-400">
                    {p.audience === "all" ? "Iedereen" : "Chefs"}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-900">{p.body}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <form action={togglePinAction}>
                    <input type="hidden" name="postId" value={p.id} />
                    <input type="hidden" name="pinned" value={p.pinned ? "false" : "true"} />
                    <button className="rounded-full border border-ink-200 px-3 py-1 text-xs text-ink-600 hover:bg-bg-gray">
                      {p.pinned ? "Losmaken" : "Pin"}
                    </button>
                  </form>
                  <form action={deletePostAction}>
                    <input type="hidden" name="postId" value={p.id} />
                    <button className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">
                      Verwijder
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
