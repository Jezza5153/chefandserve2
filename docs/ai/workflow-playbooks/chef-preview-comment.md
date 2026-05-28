# Workflow: Chef preview + klant comment (view + comment, no veto)

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2** (klant-side). Ships with PR-KLANT-3 (uses `placement_comments` from PR-KLANT-0; no new schema).

## Purpose

When Chef & Serve proposes a chef for a klant's shift, the klant sees the proposal on the hub: the chef's `clientVisible` details, a **"Waarom voorgesteld?"** rationale, and a way to send a comment ("Heeft Daniel HACCP?"). The klant has **view + comment only — no veto**. The proposal is the match Chef & Serve is about to confirm; the klant's comment is input Maarten/Gina weigh before final confirmation.

The hard design rule: klant comments go into the structured `placement_comments` table with an explicit `visibility`, **never** appended to `placements.notes` (which mixes admin/matching/klant/chef scopes and would leak). Admin replies that should reach the klant are posted with `visibility='client_visible'` into the same thread.

---

## Actors

- **Klant** — views the proposed chef card; sends comments (`author_kind='client'`, `visibility='client_visible'`).
- **Admin (`owner`+)** — reads all comments; replies with `visibility='client_visible'` (to klant) or `visibility='chef_visible'` / `'internal'` (kept away from the klant).
- **Chef** — not part of this thread unless admin explicitly posts `visibility='chef_visible'`.

---

## Source tables

- `placement_comments` — the comment store. Columns: `placement_id`, `author_user_id`, `author_kind` enum (`client`/`admin`/`chef`/`system`), `visibility` enum (`internal`/`client_visible`/`chef_visible`), `body` (1–1000 chars, trimmed, plain text), `metadata jsonb`.
- `placements` — the proposal being commented on; its `notes` field is NOT used here.
- `chefs` — source of the `clientVisible` fields on the card (name, vakniveau, ervaring, languages; photo only if `clientVisible+verified`).
- `notifications`, `email_messages` — proposal + comment routing.
- `audit_log`.

Match rationale comes from `src/lib/domain/matching.ts` → `getMatchReasons(placementId)` (labelled bullets).

---

## Human status labels

This flow does not introduce its own status enum; it operates while the placement is `proposed` (hub label "Chef voorgesteld"). Comment rows themselves carry no status — only `visibility`, which the AI must respect but never display as a status to the klant.

---

## Visibility model (the core rule)

`listVisibleComments(placementId, { kind })` from [`src/lib/domain/comments.ts`](../../../src/lib/domain/comments.ts) filters in the query, not the component:

| Viewer kind | Visibility scopes returned |
|---|---|
| `admin` | `internal` + `client_visible` + `chef_visible` (all) |
| `client` | `client_visible` only |
| `chef` | `chef_visible` only |
| `system` | all |

Ownership (does this viewer own this placement/shift?) is verified by the caller BEFORE the query — never trusting an id from form data. `addPlacementComment()` trims, rejects empty / >1000 chars (DB CHECK is the backstop), and stores plain text; renderers never use `dangerouslySetInnerHTML`.

---

## Allowed transitions

There is no state machine; the operations are append + read:

| Operation | Actor | Preconditions | Tool / action |
|---|---|---|---|
| Add klant comment | klant (own shift) | placement on caller's shift; body 1–1000 chars | `addPlacementComment({ placementId, authorKind:'client', visibility:'client_visible', body })` |
| Add admin reply (to klant) | admin (`owner`+) | placement exists | `addPlacementComment({ authorKind:'admin', visibility:'client_visible', body })` |
| Add admin note (hidden from klant) | admin (`owner`+) | placement exists | `addPlacementComment({ authorKind:'admin', visibility:'internal' \| 'chef_visible', body })` |
| Read thread | any (own scope) | ownership verified | `listVisibleComments(placementId, viewer)` |

A klant comment cannot be a veto: there is no transition from a comment to `placement.rejected`. The placement lifecycle is admin-driven.

---

## AI can read

Through `client.read` + the proposed `ai_client_shift_summary_view`:

- The proposed chef's `clientVisible` fields (name, vakniveau, ervaring, languages; photo flag).
- The `getMatchReasons(placementId)` bullets ("Waarom voorgesteld?").
- For klant: `listVisibleComments(placementId, { kind:'client' })` → `client_visible` rows only.
- For admin: the full thread including `internal` notes.

Cites `placement_comments.id` / `placement.id`.

---

## AI can draft

- A klant comment ("Heeft Daniel HACCP-certificaat? En spreekt hij Frans aan tafel?").
- A neutral explanation of the "Waarom voorgesteld?" reasons in plain Dutch.
- For admin: a draft reply to a klant comment (to be posted `client_visible`).

---

## AI can execute only after explicit human confirmation

- **`client.add_comment`** — klant clicks "Stuur opmerking" after the AI drafts the body. The tool always writes `author_kind='client'`, `visibility='client_visible'` for klant callers — the AI cannot widen visibility. Audit: `ai.client.add_comment`.
- Admin posting a reply is likewise a confirmed action via admin tooling; the AI may draft, the admin sets the visibility and clicks.

---

## AI must never do

- **Write to `placements.notes`.** Comments only ever go through `placement_comments`. (Hard rule — `rag-source-catalog.md`.)
- **Approve or reject the proposed chef** for the klant. The klant has no veto; the AI offers "Stuur opmerking" / "Voorbeeld profiel" only — never "Akkoord?", "Goedkeuren?", "Beoordelen?".
- **Reveal `internal` or `chef_visible` comments to the klant.** Visibility filtering is in the query; the AI must not reconstruct hidden rows from other context.
- **Expose a non-`clientVisible` chef field or an unverified/`!clientVisible` photo** on the card.
- **Surface the chef's internal ratings** on the preview card (ratings are internal-only V1).
- **Escalate a klant comment's visibility** to `chef_visible`/`internal` — only an admin chooses that.

---

## Audit keys

System:

- `placement_comments.created` (the actual `addPlacementComment` audit, written inside the helper)

AI-assisted:

- `ai.client.add_comment` (paired with `placement_comments.created`)

---

## Notifications

| Event | In-app type | Email template | Recipients via |
|---|---|---|---|
| Admin proposes chef | `chef_proposed` to klant | `ChefProposedKlantEmail` | `recipientsForClient(clientId, 'chef_proposed')` |
| Klant sends a comment | `placement_client_comment` to admin recipients | (fold into existing klant-comment routing) | admin routing |
| Admin posts `client_visible` reply | (in-app) the klant sees on next hub load | — | — |

---

## Edge cases

- **Chef photo not `clientVisible+verified`**: card shows no photo; AI must not describe or link the image.
- **Klant asks "is hij goed?"**: AI may relay the `getMatchReasons` bullets but must NOT cite internal ratings or admin `internal` notes. If pushed, "Chef & Serve stelt deze chef voor op basis van niveau, ervaring en beschikbaarheid."
- **Admin posts an `internal` note that looks like a klant reply**: visibility governs — the klant's `listVisibleComments` excludes it. AI never leaks it.
- **Klant tries to "reject" via a comment** ("ik wil hem niet"): the AI records it as a `client_visible` comment (input for Maarten) but does NOT change the placement. It explains Chef & Serve weighs the feedback.
- **Body > 1000 chars**: `addPlacementComment` returns `{ ok:false, error:'too-long' }`; AI shortens the draft.

---

## Example user commands

### Klant (own)

- "Vraag of Daniel HACCP heeft." → AI drafts the comment, asks the klant to click "Stuur opmerking".
- "Waarom stellen jullie deze chef voor?" → AI relays `getMatchReasons` bullets in plain Dutch.
- "Ik keur deze chef goed." → AI: "Je hoeft niet goed te keuren — Chef & Serve bevestigt de match. Wil je een opmerking meesturen?"

### Admin

- "Wat heeft de klant gevraagd over Daniel?" → AI reads the `client_visible` thread.
- "Beantwoord de HACCP-vraag richting de klant." → AI drafts a reply; admin posts it `client_visible`.

---

## Expected AI answer style

- **Never imply a veto.** Only "opmerking" / "voorbeeld profiel".
- **Use only `clientVisible` chef fields** + match reasons.
- **Respect the visibility filter** absolutely — no hidden rows.
- **Cite**: "Bron: opmerking `pc #abc-123` op voorstel `placement #...`."
- **Plain Dutch**, no ratings, no admin notes to the klant.
