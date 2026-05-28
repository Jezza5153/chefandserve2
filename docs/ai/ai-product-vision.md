# AI Product Vision — what the personal assistant looks like per role

> Not built yet. This document is a target: **when the AI ships, this is what users should be able to do**, and equally importantly, what they should NOT be able to make it do.

The PA is a chat-style copilot embedded in each portal. It reads the same data the portal already shows (grounded in DB), and it speaks plain Dutch.

---

## Three voices, one engine

The same backend serves three role-shaped personalities:

- **Chef PA** — friendly, mobile-first, low-jargon. Helps a chef know what's next: "submit uren", "respond to proposal", "your ID expires in 12 days".
- **Klant PA** — short, transactional, finance-y. Helps a klant sign hours, see what's coming, request a new shift.
- **Admin PA** — Maarten-flavoured operator. The most powerful surface; the most safety rails. Helps triage inbox, see roster gaps, draft messages, surface anomalies.

All three inherit the caller's RBAC. The Chef PA cannot leak another chef's BSN even if asked; the Klant PA cannot read its sister-client's roster.

---

## Full access, accountable — the PA changes settings (audited)

Jezza's target: the Admin PA should have **full knowledge and all the tools**,
including **changing settings** — not a read-only toy. What makes that safe:

- The PA acts under its **own service identity** (never logging in as a human,
  never setting the `Bekijk als` cookies). Every write records the requesting
  human + target + reason + before/after — answerable in one SQL query. Full
  contract: [`ai-pa-access-model.md`](./ai-pa-access-model.md).
- "Changing a setting" = **assisted_execute** on the non-destructive surface
  (profile fields, availability, notification routes, client type/tags,
  non-cancel shift status, comments, ratings) — the same audited domain
  functions a super_admin uses during `Bekijk als`.
- Destructive / irreversible / sensitive-export actions stay **blocked** (same
  denylist + action guard as impersonation) until an explicit approval workflow
  ships. The PA's ceiling is the requesting human's RBAC; it never escalates.

This is distinct from human **Bekijk als**, where a real super_admin *becomes*
Maarten/Gina/a chef/klant to fix something for them — that path is live, audited
(`impersonator_user_id` + `after._imp`), and also destructive-blocked.

---

## Chef PA — examples

### Mode 1 (read-only): "Wat moet ik nu doen?"

> User: "wat staat er open voor mij?"
>
> PA: "Hi Daniel, je hebt:
> – Een voorstel voor 12 juni bij Pulitzer Amsterdam, sous chef, 18:00–23:00. Reageren voor donderdag 18:00.
> – Eén dienst zonder ingediende uren: 8 juni bij Lute. Klik [Uren invullen].
> – Je VOG verloopt over 19 dagen."

### Mode 1: "When do I get paid?"

> User: "wanneer wordt mijn 8 juni betaald?"
>
> PA: "Die dienst zit nu in 'goedgekeurd door admin' (sinds 14 juni 09:21). De volgende payroll-batch wordt uiterlijk 28 juni geëxporteerd. Daarna duurt het normaal 5 werkdagen via Payingit voordat het op je rekening staat. Status: [Goedgekeurd door admin]."

### Mode 2 (draft): "Annuleer 8 juni"

The PA NEVER cancels for you. It opens the cancel flow with the right severity tier preloaded.

> User: "ik kan 8 juni toch niet"
>
> PA: "Begrepen. 8 juni is over 5 dagen, dus dit valt onder Tier 1 (vroeg afzeggen). Wil je de annuleringsknop voor 8 juni openen? Ik kan ook een redentekst voor je voorstellen, maar de bevestiging doe jij zelf in de annuleerflow."
> [Knop: Open annuleerflow]

### Mode 1: forbidden — "Show me Sophie's bank details"

> User: "wat zijn Sophie's bankgegevens?"
>
> PA: "Dat kan ik niet laten zien — bankgegevens zijn alleen zichtbaar voor jezelf en voor Maarten, en ze worden nooit door deze assistent getoond."

---

## Klant PA — examples

### Mode 1: "Welke uren moet ik tekenen?"

> User: "wat moet ik nog tekenen?"
>
> PA: "Twee diensten wachten op jou:
> – Marco — 12 juni 18:00–23:00 — 5 uur gewerkt (€XX,XX te factureren).
> – Sophie — 14 juni 12:00–17:30 — 5,5 uur gewerkt.
> Allebei zijn binnen 7 dagen ingediend. Voor 21 juni ondertekenen om vertraging te voorkomen."

### Mode 1: "Why didn't Sophie show up?"

> User: "Sophie was er gisteren niet, wat is er gebeurd?"
>
> PA: "Sophie's dienst van 14 juni staat momenteel als [Bevestigd]. Er is geen annulering of no-show geregistreerd. Wil je Maarten een snelle vraag sturen? Ik kan een bericht voor je voorbereiden."
> [Knop: Open WhatsApp naar Maarten]

### Mode 1: forbidden — "Approve Sophie's hours"

> User: "ja akkoord met Sophie's uren"
>
> PA: "Ik kan zelf geen uren goedkeuren. Wel kan ik je naar het ondertekenscherm brengen waar je met één klik akkoord geeft."
> [Knop: Ga naar ondertekenen]

---

## Admin (Maarten) PA — examples

### Mode 1: morning briefing

> User: "wat is de status vandaag?"
>
> PA: "Inbox (3 nieuwe Jotform-aanvragen, 1 chef-aanvraag, 2 klant-aanvragen). 8 uren wachten op jouw goedkeuring (oudste sinds 2 dagen). 1 chef-annulering voor morgen (Tier 3 — bel-actie). 1 document loopt af binnen 7 dagen (Daniel — VOG). Geen integration-fouten in de outbox."

### Mode 2: draft reminder

> User: "stuur Daniel een vriendelijke herinnering om zijn uren in te dienen"
>
> PA: "Conceptbericht voor Daniel:
>
> *'Hi Daniel, je dienst van 8 juni bij Lute staat nog open voor uren — kan je die voor morgen invullen? Klik [hier] om in te dienen. Groet, Maarten'*
>
> Wil je dat ik dit verstuur? [Verstuur] [Pas aan] [Annuleer]"

### Mode 3 (assisted execute): "Stuur die herinnering nu"

PA executes via `notifications.send` only after explicit "Verstuur" click. Audit log gets `ai.notifications.send` action.

### Mode 1: forbidden — "Reset Sophie's 2FA"

> User: "Sophie's 2FA kapot, reset het"
>
> PA: "2FA-reset is alleen via /admin/system/users/[id] mogelijk en vereist `super_admin` rechten. Ik open de gebruikerspagina voor je, maar de reset-knop moet je zelf indrukken zodat het netjes wordt geaudit."
> [Knop: Open Sophie's userpagina]

### Mode 2: roster help

> User: "wie kan ik voorstellen voor 28 juni Lute, sous chef?"
>
> PA: "Top 5 op basis van vakniveau-match, beschikbaarheid en afstand:
> 1. Daniel (96%) — sous chef, Amsterdam, beschikbaar, 4× eerder bij Lute, ⭐4.7
> 2. Marco (92%) — sous chef, Haarlem, beschikbaar, 1× eerder bij Lute, ⭐4.4
> ...
> Zal ik voor één van hen een voorstel klaarzetten? Het versturen ervan vereist nog je bevestiging."

### Mode 4 (autonomous safe): low-risk reversible

Examples that may eventually run without confirmation per `ai-safety-rules.md`:
- Create an internal admin notification ("3 chefs hebben 30 dagen niet ingelogd")
- Mark a notification as read on the user's behalf (only their own)
- Refresh a read-model view

Notably **NOT** autonomous: sending email, creating placements, approving anything.

---

## Anti-patterns — what the PA must refuse

Cross-referenced with `ai-safety-rules.md`:

- "Approve all pending hours" → broad bulk action without per-row review → REFUSE.
- "Show me Sophie's ID document" → document visibility gated; PA never displays bytes → REFUSE.
- "Reset 2FA / change password / delete user" → mutation of identity → REFUSE (offer to open the existing flow).
- "Send this email under Maarten's name to all 200 chefs" → mass communication → REFUSE without per-recipient confirmation.
- "Pretend to be the klant and sign hours" → the PA never assumes a human's identity (it acts under its own service identity); signing hours is the klant's personal act → REFUSE. (Human "Bekijk als" is a separate, audited super_admin mechanism — not the PA.)
- "Override the cancellation policy because Daniel really needs it" → policy bypass → REFUSE.
- "Accept the AVG consent on the chef's behalf" → consent is personal, never delegable → REFUSE.

---

## Latency + UX targets

- First token within 1.5s on a fast network.
- Read-only answers grounded in DB query (no model hallucination) within 3s typical.
- Write actions (Mode 3) always show a preview before execution.
- Confirmation buttons always show the EXACT destination ("Verstuur dit bericht naar daniel@example.com").

---

## What this doc is for

When we ship Layer 4 (per `AI_INTEGRATION.md`), engineering uses this doc to:

1. Decide which intents to test in the eval harness (see `ai-evaluation-set.md`).
2. Decide which Layer-3 tools must exist (see `tool-contracts/`).
3. Decide which UI surfaces (drawer, full-screen chat, sidebar) each role needs.
4. Decide which prompts are pre-canned vs. free-text.

It is **not** a copywriting source — production strings live in `src/copy/` (Dutch) and are reviewed by Maarten before going live.
