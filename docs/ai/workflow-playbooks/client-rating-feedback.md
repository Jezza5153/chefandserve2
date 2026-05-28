# Workflow: Client rating / feedback (internal-only, tags + stars)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2** (klant-side). Ships with PR-KLANT-5 (`migration 0024_ratings.sql`).

## Purpose

After a shift's hours reach `admin_approved`, the klant is invited to give **feedback** on the chef: a star rating (1–5) plus multi-select tags (`punctueel`, `werkt_netjes`, `te_laat`, …) and an optional comment. The data is **internal-only in V1**: it improves Chef & Serve's future matching. The chef sees only their *average*, and only once `rating_count >= 5` (so one bad night doesn't demoralise). Other klanten never see a chef's ratings. Tags are **soft matching hints**, never a hard signal; negative tags require human review before they can penalise a chef.

The copy is "feedback", never "review" / "beoordeling" / "score".

---

## Actors

- **Klant** — submits feedback on `/client/shifts/[shiftId]/rate`.
- **Admin (`owner`+)** — sees full ratings (average, count, tags, comments) on the chef detail page; uses them for matching decisions.
- **Chef** — sees only `{ ratingCount, hasFeedback, averageRating }` where `averageRating` is NULL until N≥5; never sees individual comments in V1.
- **System** — recomputes `chefs.averageRating` + `chefs.rating_count` in the same transaction as the insert; fires the rating-pending invite when hours are approved.

---

## Source tables

- `ratings` — `placement_id` (UNIQUE — one rating per placement), `chef_id`, `client_id`, `stars` (1–5 CHECK), `tags text[]`, `comment`, `created_by`.
- `chefs` — denormalised `average_rating numeric(3,2)`, `rating_count integer`.
- `placements` — the rated shift link (the join from shift → chef).
- Tag vocabulary: `src/lib/rating-tags.ts` (`RATING_TAGS` + `RATING_TAG_LABELS`) — a versioned constant, not an enum, so admins can extend.
- `notifications`, `email_messages`.
- `audit_log`.

---

## Human status labels

Ratings have no lifecycle enum. The klant-facing "is feedback due?" derives from the hours status:

| Condition | Klant-facing label |
|---|---|
| `shift_hours.admin_approved` AND no `ratings` row for the placement | "Geef je chef feedback" |
| `ratings` row exists | "Feedback gegeven" |

The tag list splits into positive (`punctueel`, `communicatie_goed`, `past_bij_team`, `werkt_netjes`, `tempo_goed`, `zelfstandig`, `kwaliteit_eten`, `zou_opnieuw_boeken`) and negative-leaning (`te_laat`, `communicatie_kon_beter`, `tempo_te_langzaam`).

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row) | `ratings` row inserted | klant (own) | placement belongs to caller's client; hours `admin_approved`; no existing rating (`placement_id` UNIQUE); stars 1–5; tags ⊆ `RATING_TAGS` | `submitRating(placementId, stars, tags, comment)` |

In the same transaction: recompute `chefs.average_rating = round(avg(stars),2)` and `chefs.rating_count = count(*)` for that chef. The `placement_id` UNIQUE constraint prevents double-submit.

There is no edit/withdraw path in V1 — a mistaken rating is handled by admin.

---

## Visibility rules (encoded in helpers, not just docs)

From `src/lib/domain/ratings.ts`:

| Helper | Returns | To whom |
|---|---|---|
| `getChefAverageForAdmin(chefId)` | full average + count + comments + tags | admin always |
| `getChefSummaryForChef(chefId)` | `{ ratingCount, hasFeedback, averageRating }` where `averageRating` is **NULL until ratingCount ≥ 5**; comments never included | the chef themselves |
| `getChefPreviewForKlant(chefId)` | **no rating data at all** (V1) | klant preview cards |

---

## AI can read

Through `rating.summarize_for_admin`, `rating.read_own_summary` (see [`../tool-contracts/rating-tools.md`](../tool-contracts/rating-tools.md)):

- **Admin**: full ratings for any chef (average, count, tag frequencies, comments) via `getChefAverageForAdmin`.
- **Chef (own)**: `getChefSummaryForChef` — count always; average only at N≥5; never comments.
- **Klant**: nothing about a chef's ratings — `getChefPreviewForKlant` returns no rating data.

Cites `ratings.id` / `chefs.id` (admin context only).

---

## AI can draft

- **Klant-side**: a feedback comment ("Daniel was punctueel en werkte netjes; tempo mocht iets sneller") + a suggested tag set, for the klant to confirm on the rate form.
- **Admin-side**: a summary of a chef's feedback for a matching decision ("⭐4.6 over 9 shifts; tags vaak: punctueel, zelfstandig; 1× te_laat — even checken").

---

## AI can execute only after explicit human confirmation

- **Submitting a rating** — klant clicks "Feedback versturen" on the rate form after the AI optionally drafts the comment/tags. The AI does NOT submit on the klant's behalf. Audit: `ai.client.submit_rating` (the AI's prep) paired with `ratings.created`.

There is no AI tool that submits a rating autonomously, and none that lets a non-admin read another chef's ratings.

---

## AI must never do

- **Expose a chef's internal ratings to another klant** — never, under any phrasing. (Hard rule — `ai-safety-rules.md`.)
- **Show a chef their own average before N≥5**, or show a chef any individual comment in V1. Respect `getChefSummaryForChef`.
- **Submit a rating on the klant's behalf.**
- **Let a single rating dominate matching** — one bad klant must not poison a chef's matchability.
- **Use a negative tag (`te_laat`, `tempo_te_langzaam`, `communicatie_kon_beter`) to auto-derank a chef.** Negative tags are surfaced to admin for **human review** only; the AI never penalises automatically.
- **Treat `average_rating` as a strong signal below N=5.** Tags are soft hints; the average is weak until the threshold.
- **Call the feature "beoordeling" / "review" / "score"** — it is "feedback".

---

## Audit keys

System:

- `ratings.created` (with stars + tags in payload; recompute happens in the same tx)

AI-assisted:

- `ai.client.submit_rating` (paired with `ratings.created`)
- `ai.rating.summarize_for_admin` (read; admin only)

---

## Notifications

| Event | In-app type | Email template | Recipients via |
|---|---|---|---|
| Hours `admin_approved` | `rating_pending` to klant + dashboard "Beoordeel je chef" card | `RatingPendingKlantEmail` | `recipientsForClient(clientId, 'rating_pending')` |

The invite fires from `approveHoursRow()` in `src/lib/domain/hours.ts`.

---

## Edge cases

- **Chef below N=5**: chef profile shows "X klanten hebben feedback gegeven"; the number (average) appears only at N≥5. AI honours this for chef queries.
- **1-star + scathing comment**: internal-only; admin mediates. The AI surfaces the tag signal to admin without forcing the chef to read the comment.
- **Klant tries to rate before approval**: no "Beoordeel je chef" affordance until `admin_approved`; `submitRating` would fail its precondition. AI explains feedback opens after Chef & Serve approves the hours.
- **Double-submit attempt**: `placement_id` UNIQUE blocks it; AI reports "je hebt al feedback gegeven voor deze shift".
- **Klant asks "wat vinden anderen van deze chef?"**: AI refuses — ratings are internal; other klanten never see them.
- **Admin asks the AI to derank a chef on one `te_laat` tag**: AI surfaces it for review, does not auto-penalise.

---

## Example user commands

### Klant (own)

- "Geef Daniel 5 sterren, hij was top." → AI drafts stars + positive tags + optional comment, asks the klant to click "Feedback versturen".
- "Hij kwam te laat maar kookte goed." → AI suggests `kwaliteit_eten` + `te_laat`, notes feedback is internal-only.
- "Wat hebben anderen over deze chef gezegd?" → AI refuses (internal-only).

### Chef (own)

- "Wat is mijn gemiddelde?" → AI: count always; if N<5, "X klanten hebben feedback gegeven; je gemiddelde tonen we vanaf 5 beoordelingen."

### Admin

- "Vat Daniel's feedback samen." → AI returns average + count + tag frequencies + flags negative tags for review.

---

## Expected AI answer style

- **"Feedback", always** — never "review"/"score".
- **Internal-only**: never leak a chef's ratings to another klant; never show a chef their average below N=5.
- **Tags = soft hints**; negative tags → human review, never auto-penalty.
- **Cite (admin only)**: "Bron: ratings voor chef `#abc-123`, 9 beoordelingen."
- **Emotionally safe** framing for the chef.
