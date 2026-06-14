/**
 * /chef/board — "Prikbord" chef feed (BOARD-2). Read + react. Gated by
 * boardEnabled(); audience filter happens in listBoardFeed. Bodies render as
 * escaped text (whitespace-pre-wrap), never dangerouslySetInnerHTML. Reactions
 * are plain <form> submits (no client JS) → toggle server action → revalidate.
 */
import { eq } from "drizzle-orm";
import Link from "next/link";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import { BOARD_EMOJI, boardEnabled, listBoardFeed, toggleReaction } from "@/lib/domain/board";
import { requireAuth } from "@/lib/permissions";

export const metadata = { title: "Prikbord" };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

async function toggleReactionAction(fd: FormData) {
  "use server";
  const session = await requireAuth();
  const postId = String(fd.get("postId") ?? "");
  const emoji = String(fd.get("emoji") ?? "");
  if (!postId || !emoji) return;
  await toggleReaction({ postId, userId: session.user.id, emoji });
  revalidatePath("/chef/board");
}

export default async function ChefBoardPage() {
  const session = await requireAuth("/chef/board");
  // Auth-is-the-lookup: confirm a chef profile exists for this account.
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });

  if (!boardEnabled() || !chef) {
    return (
      <div>
        <p className={LABEL}>Team</p>
        <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Prikbord</h1>
        <p className="mt-6 rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
          Het prikbord is er binnenkort.
        </p>
      </div>
    );
  }

  const feed = await listBoardFeed({ userId: session.user.id });

  return (
    <div>
      <p className={LABEL}>Team</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">Prikbord</h1>
      <p className="mt-2 text-sm text-ink-600">Nieuws en weetjes van Chef &amp; Serve.</p>

      <div className="mt-6 space-y-4">
        {feed.length === 0 ? (
          <p className="rounded-lg border border-ink-200 bg-white p-8 text-center text-sm text-ink-500">
            Nog geen berichten. Kijk later nog eens.
          </p>
        ) : (
          feed.map((post) => (
            <article key={post.id} className="rounded-lg border border-ink-200 bg-white p-4">
              {post.pinned ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 font-ui text-[9px] uppercase tracking-wider text-amber-800">
                  Vastgepind
                </span>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-900">{post.body}</p>

              {post.imageUrls.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt=""
                  className="mt-3 max-h-80 w-full rounded-lg object-cover"
                />
              ))}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {BOARD_EMOJI.map((emoji) => {
                  const r = post.reactions.find((x) => x.emoji === emoji);
                  const count = r?.count ?? 0;
                  const mine = r?.mine ?? false;
                  return (
                    <form key={emoji} action={toggleReactionAction}>
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="emoji" value={emoji} />
                      <button
                        type="submit"
                        className={`rounded-full border px-2.5 py-1 text-sm ${
                          mine ? "border-burgundy bg-burgundy/10" : "border-ink-200 hover:bg-bg-gray"
                        }`}
                      >
                        {emoji}
                        {count > 0 ? <span className="ml-1 text-xs text-ink-600">{count}</span> : null}
                      </button>
                    </form>
                  );
                })}
              </div>
            </article>
          ))
        )}
      </div>

      <p className="mt-6 text-xs text-ink-500">
        Terug naar je{" "}
        <Link href="/chef" className="text-burgundy hover:underline">
          dashboard
        </Link>
        .
      </p>
    </div>
  );
}
