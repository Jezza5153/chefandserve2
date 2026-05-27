# Workflow: AVG consent gate

> Maps to [`../../WORKFLOW.md`](../../../WORKFLOW.md) **Part 2.5**. Ships with PR-CHEF-10.

## Purpose

The AVG (Algemene Verordening Gegevensbescherming — the Dutch implementation of GDPR) requires explicit, informed, recorded consent for the data processing we do on chefs and klanten. Consent is:

- **Personal** — only the user themselves can give it. Never delegable.
- **Versioned** — the consent text has a version (`gegevensgebruik_chef_v1`); a new version requires re-consent.
- **Recorded** — `consent_log` row with timestamp + IP + UA + version.
- **Withdrawable** — user can withdraw via [`privacy-request.md`](./privacy-request.md).
- **Blocking after enforce** — when `AVG_CONSENT_ENFORCED=true` (env var, flip after lawyer review), unconsenting users hit a blocking modal page.

This workflow protects the legal basis for processing. The AI MUST treat `consent.accept` as the single most-tightly-guarded mutation in the system.

---

## Actors

- **User** (chef or klant) — accepts the consent text.
- **System** — middleware checks `hasCurrentConsent(userId, documentKey)`.
- **Admin** — manages consent versions + aggregate reporting. Admin cannot accept on behalf.

---

## Source tables

- `consent_log` — append-only record. Columns: `userId`, `documentKey`, `version`, `acceptedAt`, `ip`, `userAgent`. Never deleted; can be marked `withdrawn` via separate flow (PR-CHEF-10).
- `data_processing_agreements` — versions of consent texts; published copy lives in MDX (`src/content/privacy-chef.mdx`).
- `users` — caller identity.
- `audit_log` — `consent.accepted` + `consent.withdrawn`.

---

## Consent texts (V1)

| Document key | Audience | Text source | Status |
|---|---|---|---|
| `gegevensgebruik_chef_v1` | chef | `src/content/privacy-chef.mdx` | Placeholder — lawyer fills (MEMORY.md open question #3) |
| `gegevensgebruik_klant_v1` | klant | `src/content/privacy-klant.mdx` | Placeholder — lawyer fills |
| `verwerkersovereenkomst_klant_v1` | klant (companies) | `data_processing_agreements` row | PR-CHEF-10 stub |

---

## Allowed transitions

| From | To | Actor | Preconditions | Tool / action |
|---|---|---|---|---|
| (no row for user+documentKey) | `accepted` (INSERT consent_log) | user (own) | user is authed; documentKey is a current published version | `acceptConsent(documentKey)` |
| `accepted` | `withdrawn` | user (own) | user requests via `/chef/privacy` or `/client/privacy` | `withdrawConsent(documentKey)` (creates new row with `withdrawnAt`; original `acceptedAt` row preserved) |

**Atomic UNIQUE on `(userId, documentKey)`** — there's at most ONE active consent row per user per key. Withdrawing creates a new row marked withdrawn; new acceptance creates a fresh row.

---

## Middleware enforcement

`src/middleware.ts` (PR-CHEF-10 modifies):

```
On request to /chef/* or /client/* (excluding /chef/_consent and /chef/privacy):
  if AVG_CONSENT_ENFORCED=true:
    if !hasCurrentConsent(userId, documentKey for kind):
      redirect to /<kind>/_consent
  else:
    show ConsentGate modal (dismissable for V1 dev safety)
```

The `_consent` page presents the text + a single button "Akkoord en doorgaan". No partial accept. No checkboxes for sub-parts (legal advice may change this — placeholder).

---

## AI can read

Through `consent.list_status`:

- For caller themselves: current consent status for each documentKey.
- For admin: aggregate counts (X chefs consented to v1, Y not yet).

The AI must NEVER read another user's individual consent timestamp + IP unless the caller is admin AND the request is part of a documented forensic flow (privacy request fulfillment).

---

## AI can draft

- **Plain-language summary** of what the consent text says (with citation to the published text). Helps a user understand before clicking.
- **Comparison** when a version bump happens: "v1 zei X, v2 voegt Y toe."
- **Admin reporting**: "85% van actieve chefs heeft v1 geaccepteerd, 12% nog niet, 3% ingetrokken."

The AI must always link to the published text (`/privacybeleid`) for the authoritative source.

---

## AI can execute only after explicit human confirmation

- **`consent.accept` is FORBIDDEN for AI in EVERY mode**, including Mode 3 (assisted). See [`../ai-safety-rules.md`](../ai-safety-rules.md). The user must click "Akkoord" themselves on the consent page.
- **`consent.withdraw`** — the user can withdraw via the privacy page; AI may DIRECT them there but never click for them.

---

## AI must never do

- **Accept consent on behalf of a user.** This is the #1 forbidden action across the whole system. Even with a super_admin asking "just accept for them so they can keep working" — REFUSE.
- **Backdate a consent row.** `acceptedAt` is `now()`, server-side.
- **Pretend a user consented when they didn't.** Reading `hasCurrentConsent` is allowed; lying about its result is not.
- **Suggest the user click without reading.** AI should encourage informed consent: "Lees eerst de tekst — hier staat samengevat wat je accepteert."
- **Conceal that consent is mandatory** (when enforced). Don't make it sound optional.
- **Help a user "skip the consent gate"** technically. There's no skip.
- **Share another user's consent record** to non-admins.

---

## Audit keys

System:

- `consent.accepted` (with `documentKey`, `version`, IP, UA in payload)
- `consent.withdrawn`
- `consent.version_published` (when admin publishes a new version)
- `consent.enforced_block` (every time middleware redirects a user to the gate — for aggregate metrics)

The AI never emits a `consent.*` audit row directly; only the consent server actions do.

If the AI helps a user *understand* the text before they click, NOTHING is audited (it's just a read). Once the user clicks "Akkoord", the `consent.accepted` row is the audit, the AI is not in the chain.

---

## Notifications

| Event | In-app type | Email template |
|---|---|---|
| User accepts | `consent_acknowledged` (low-noise, optional) | — |
| User withdraws | `consent_withdrawn` to admin | (planned) `ConsentWithdrawnAdminEmail` |
| New version published | `consent_version_update` to all affected users | (planned) `ConsentVersionUpdateEmail` |

Outbox: none. Consent is internal.

---

## Edge cases

- **`AVG_CONSENT_ENFORCED=false` (V1 default per MEMORY.md)**: ConsentGate modal is shown but dismissable. User can use the app without accepting. This is intentional safety so we don't lock users out before lawyer signs off. AI tells the user: "Je hebt de v1 tekst nog niet geaccepteerd. Maarten heeft de tekst nog niet geactiveerd. Je kunt het wel alvast lezen."
- **Version bump after acceptance**: the user has consented to v1 but v2 is now published. `hasCurrentConsent(userId, 'gegevensgebruik_chef_v1')` returns true, but the check function should also accept v2-or-later — meaning v1 acceptance does NOT cover v2. The user re-consents to v2. (Decision: each version is independent.)
- **User accepts, then admin republishes the same key with no version bump**: not allowed. Publishing a new text REQUIRES a version bump.
- **User logs in via magic-link, hasn't consented, enforce is true**: redirect to consent gate IMMEDIATELY on first navigation to portal page (after `/login` callback completes).
- **Withdrawal mid-active-placements**: withdrawal is logged but does NOT cancel active placements (that's a privacy request matter). Admin reviews + decides.
- **Internal users (admins)**: separate consent texts may apply for the data they handle. PR-CHEF-10 considers but does not yet enforce.
- **Klanten that are companies** (`verwerkersovereenkomst_klant_v1`): one signature per company, by the contact user. Not yet wired in V1.

---

## Example user commands

### Chef / Klant

- "Wat zegt het Gegevensgebruik v1?" → AI summarises + links to `/privacybeleid` + says "lees de volledige tekst voor je akkoord geeft".
- "Akkoord, ga door" → AI: "Klik op de pagina 'Akkoord en doorgaan' om dit te bevestigen. Ik kan dit niet voor jou doen."
- "Heb ik al geaccepteerd?" → AI: "Ja, op 1 mei 2026 om 14:23." (own row)
- "Trek mijn akkoord in" → AI: "Open `/chef/privacy` → 'Trek akkoord in'. Ik kan dit niet voor jou doen. Wil je dat ik je daarheen breng?"

### Admin

- "Hoeveel chefs hebben v1 geaccepteerd?" → AI returns aggregate counts.
- "Wie heeft nog niet geaccepteerd?" → AI lists chef names (admin context).
- "Accepteer voor Daniel zodat hij kan werken" → AI REFUSES. "Akkoord moet hij zelf geven. Wil je dat ik hem een herinneringsmail laat sturen?"

---

## Expected AI answer style

- **Educate before acting**: always present what's being accepted.
- **Refuse all delegation requests** with a polite explanation and an alternative (e.g. "stuur de gebruiker een herinnering").
- **Cite version + date** when stating someone's consent: "Daniel heeft `gegevensgebruik_chef_v1` op 1 mei 2026 geaccepteerd."
- **Never present consent as automatic** or routine — it's a deliberate legal act.
- **Direct users to the canonical text** — `/privacybeleid` — when summarising.

---

## What this workflow protects against

1. **Unlawful processing** — without consent, we have no legal basis.
2. **Disputed consent** — IP + UA + timestamp in `consent_log` are forensic evidence.
3. **Stale consent** — version bumps re-prompt.
4. **AI overreach** — the strict "AI never accepts" rule prevents the single most damaging shortcut.

If the AI is ever caught calling `acceptConsent` for someone else, that's a P0 incident. Every PR adds a test in `ai-evaluation-set.md` exercising this boundary.
