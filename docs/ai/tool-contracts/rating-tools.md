# Tool contracts: Ratings (internal-only feedback)

> Tools wrapping [`../workflow-playbooks/client-rating-feedback.md`](../workflow-playbooks/client-rating-feedback.md). Ratings are **internal-only V1**: admin sees all; chef sees own average at N≥5; klanten never see another chef's ratings.

---

## Tool: `rating.summarize_for_admin`

### Purpose
Summarise a chef's feedback (average, count, tag frequencies, comments) for an admin matching decision.

### Inputs
- chefId: text
- includeComments: bool (default true)

### Required role
owner | super_admin (admins ONLY)

### Allowed user kinds
internal

### Read scope
`getChefAverageForAdmin(chefId)` → `ratings` (all rows for the chef) + `chefs.average_rating` + `chefs.rating_count`, joined for tag/comment context, via the proposed `ai_client_feedback_view`.

### Write scope
None.

### Preconditions
Caller is `owner`+. (A non-admin caller is refused — RBAC inherited, never escalated.)

### Side effects
`ai.tool_invoked` audit `action='rating.summarize_for_admin'`.

### Dry-run result shape
n/a (read-only).

### Result shape
```jsonc
{
  "chefId": "...",
  "averageRating": 4.6,
  "ratingCount": 9,
  "topTags": [{ "tag": "punctueel", "count": 7 }, { "tag": "zelfstandig", "count": 5 }],
  "negativeTags": [{ "tag": "te_laat", "count": 1, "needsHumanReview": true }],
  "recentComments": ["..."]
}
```

### Confirmation requirement
`read`.

### Audit events
`ai.rating.summarize_for_admin`

### Rollback
n/a.

---

## Tool: `rating.read_own_summary`

### Purpose
Return a chef's own feedback summary, honouring the N≥5 rule.

### Inputs
- (none — resolved from the caller's session)

### Required role
chef (own)

### Allowed user kinds
chef

### Read scope
`getChefSummaryForChef(chefId)` → `{ ratingCount, hasFeedback, averageRating }` where `averageRating` is **NULL until ratingCount ≥ 5**. Individual comments are NEVER included.

### Write scope
None.

### Preconditions
Caller is the chef themselves.

### Side effects
`ai.tool_invoked` audit `action='rating.read_own_summary'`.

### Result shape
```jsonc
{ "ratingCount": 3, "hasFeedback": true, "averageRating": null }
```

### Confirmation requirement
`read`.

### Audit events
`ai.rating.read_own_summary`

### Rollback
n/a.

---

## Tool: `rating.draft_feedback` (klant-side helper)

### Purpose
Draft a star + tag + comment suggestion for the klant to confirm on the rate form. Does not submit.

### Inputs
- placementId: text (caller's own, hours `admin_approved`)
- freeText: text (the klant's words)

### Required role
client (own)

### Allowed user kinds
client

### Read scope
`placements` + `shifts` (ownership) + `RATING_TAGS` vocabulary.

### Write scope
None (draft only).

### Dry-run result shape
```jsonc
{ "suggestedStars": 4, "suggestedTags": ["kwaliteit_eten", "te_laat"], "draftComment": "..." }
```

### Confirmation requirement
`draft`. Submitting is the klant's click on the rate form (`ai.client.submit_rating` + `ratings.created`); the AI never submits on the klant's behalf.

### Audit events
`ai.rating.draft_feedback`

### Rollback
n/a.

---

## Forbidden / boundaries

- **`rating.expose_to_other_klant` — FORBIDDEN.** The AI must never reveal a chef's ratings (average, tags, or comments) to any klant. `getChefPreviewForKlant(chefId)` returns no rating data. (Hard rule — `ai-safety-rules.md`.)
- **`rating.submit_on_behalf` — FORBIDDEN.** The AI never submits a rating for the klant; the klant clicks "Feedback versturen" themselves.
- **Chef average below N=5** is never shown to the chef — `rating.read_own_summary` returns `averageRating: null` until the threshold.
- **No comments to the chef** in V1 — only the count, and the average at N≥5.
- **Tags are soft matching hints only.** The AI must not let `average_rating` act as a strong signal below N=5, must not let a single rating dominate, and must surface negative tags (`te_laat`, `tempo_te_langzaam`, `communicatie_kon_beter`) for **human review** rather than auto-deranking a chef.
