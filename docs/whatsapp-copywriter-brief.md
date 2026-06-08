# WhatsApp templates — copywriter brief

> Hand this to the copywriters. It explains **the rules** every WhatsApp template must follow to
> get approved + actually send, and **what each template is for** (who gets it, when, the goal,
> and the variables you can use). Write the Dutch body for each within the rules. The dev has
> locked the **template names + variable names** — keep those exactly; only the wording is yours.
>
> Platform: **sent.dm** (which submits to WhatsApp/Meta for approval). Language: **Nederlands (nl)**.

---

## Part A — The rules (read first)

WhatsApp does not allow free-form business messages. Every message we send is a **pre-approved
template**. Meta reviews each one. Follow these or it gets rejected:

### 1. Category = UTILITY
All of ours are **UTILITY** (transactional: reminders, status updates, alerts tied to something
the person is already doing with us). This means:
- ✅ Allowed: appointment/shift updates, "fill in your hours", "your hours are approved", account/onboarding nudges, internal alerts.
- ❌ **No marketing or promotional language.** No selling, no offers, no "ontdek onze…", no upsell, no "volg ons". A single promo word can get it re-classified as MARKETING (slower approval + requires opt-in). Keep it purely informational/transactional.

### 2. Variables (the `{...}` placeholders)
- Use **exactly the variable names the dev specified** for each template (e.g. `{voornaam}`, `{klant}`). The app fills these at send time.
- **A variable may NOT be the very first or very last thing** in the body — there must be normal text before and after it. (e.g. start with "Hoi {voornaam}," ✅, not "{voornaam}, …" ❌)
- **Two variables may not sit next to each other** — put words between them.
- At submission you must give an **example value** for each variable (examples are listed per template below) — Meta checks the sentence reads correctly with them filled in.
- Don't invent new variables. If you need a value that isn't in the list, ask the dev.

### 3. Length & structure
- **Body:** keep it short — aim 1–3 sentences (hard max 1024 characters).
- **Header** (optional, max 60 chars) and **Footer** (optional, max 60 chars). A footer like
  "Chef & Serve" is a nice touch; if you put it in the footer, don't repeat it in the body.
- Formatting allowed: `*vet*`, `_cursief_`. Emojis are fine but **sparingly** (0–1 per message).
- No ALL-CAPS shouting, no excessive punctuation (!!!), no placeholder/lorem text.

### 4. Tone (brand voice)
- Warm, human, kort — Nederlands, je-vorm voor chefs, u-of-je-vorm voor klanten (consistent per template).
- Clear single purpose +, where relevant, a gentle call to action ("…in je portaal").
- Sign off as **Chef & Serve** (in the footer or end of body) for chef/klant messages. Internal alerts to Maarten don't need a sign-off.

### 5. Button (optional, recommended for chef/klant)
Most chef/klant templates can have ONE **URL button** labelled e.g. **"Open portaal"** that links
to the portal. If you want a button, just note it — the dev wires the actual link. Don't put a
raw URL in the body.

### 6. What you deliver per template
For each template below: the **Dutch body** (+ optional header/footer/button label), staying within
the rules. Keep the template **name** and **variable names** exactly as given.

---

## Part B — The templates to write

Each entry: **what it's for**, **who receives it**, **when it fires**, the **goal**, and the
**variables** (with example values for Meta submission). A starter draft is included — refine it.

### 👨‍🍳 Chef-facing (je-vorm)

| Template name | What it's for / when | Variables (example) | Starter draft |
|---|---|---|---|
| `chef_nieuwe_dienst` | A new shift has been proposed to this chef; we want them to open the app and respond. | voornaam (Lisa), klant (Hotel Okura), datum (vr 13 jun) | Hoi {voornaam}, er staat een nieuwe dienst voor je klaar bij {klant} op {datum}. Bekijk 'm in je portaal. |
| `chef_dienst_bevestigd` | Their shift is now confirmed; reassure + remind. | voornaam (Lisa), klant (Hotel Okura), datum (vr 13 jun) | Top {voornaam}! Je dienst bij {klant} op {datum} is bevestigd. Tot dan! |
| `chef_dienst_geannuleerd` | A shift they were on got cancelled; inform, point to details. | voornaam (Lisa), klant (Hotel Okura), datum (vr 13 jun) | Hoi {voornaam}, de dienst bij {klant} op {datum} is helaas geannuleerd. Details staan in je portaal. |
| `chef_beschikbaarheid_herinnering` | Weekly nudge to submit availability so we can plan them. | voornaam (Lisa) | Hoi {voornaam}, geef je je beschikbaarheid voor de komende weken even door in je portaal? Dan kunnen we je inplannen. |
| `chef_uren_herinnering` | After a shift, nudge them to fill in worked hours (so they get paid). | voornaam (Lisa), klant (Hotel Okura) | Hoi {voornaam}, je dienst bij {klant} zit erop! Vul je gewerkte uren even in je portaal in. |
| `chef_uren_ondertekend` | The klant signed off their hours; status update. | voornaam (Lisa), klant (Hotel Okura) | Goed nieuws {voornaam}: {klant} heeft je uren ondertekend. Wij controleren ze nu. |
| `chef_uren_goedgekeurd` | Hours fully approved → will be paid; positive confirmation. | voornaam (Lisa) | Top {voornaam}, je uren zijn goedgekeurd en worden uitbetaald. |
| `chef_uren_teruggezet` | We reset their hours for a correction; ask them to adjust. | voornaam (Lisa) | Hoi {voornaam}, we hebben je uren teruggezet voor een correctie. Pas ze even aan in je portaal. |
| `chef_uren_afgekeurd` | The klant rejected the hours they entered; ask to correct. | voornaam (Lisa), klant (Hotel Okura) | Hoi {voornaam}, {klant} heeft je ingevulde uren afgekeurd. Bekijk en corrigeer ze in je portaal. |
| `chef_weekplanning` | Their planning for the week is ready; point to it. | voornaam (Lisa), week (week 24) | Hoi {voornaam}, je planning voor {week} staat klaar in je portaal. |
| `chef_gegevens_aanvullen` | Profile is incomplete (e.g. missing IBAN/ID); nudge to complete so we can plan + pay. | voornaam (Lisa) | Hoi {voornaam}, er ontbreken nog wat gegevens in je profiel. Vul ze aan in je portaal zodat we je kunnen inplannen en uitbetalen. |
| `chef_portaal_uitnodiging` | First-time access to the chef portal; welcome + invite to log in. | voornaam (Lisa) | Welkom bij Chef & Serve, {voornaam}! Je toegang tot het portaal staat klaar — open de link om in te loggen. |

### 🏨 Klant-facing

| Template name | What it's for / when | Variables (example) | Starter draft |
|---|---|---|---|
| `klant_chef_voorgesteld` | We proposed a chef for their request; want them to review. | contact (Jeroen), rol (sous-chef), datum (vr 13 jun) | Hallo {contact}, we hebben een chef voorgesteld voor de {rol} op {datum}. Bekijk 'm in je portaal. |
| `klant_dienst_bevestigd` | A chef is confirmed for their shift; reassure. | contact (Jeroen), chef (Lisa de Vries), datum (vr 13 jun) | Hallo {contact}, {chef} is bevestigd voor je dienst op {datum}. Tot dan! |
| `klant_uren_tekenen` | Submitted hours are waiting for the klant to approve/sign. | contact (Jeroen), chef (Lisa de Vries) | Hallo {contact}, de uren van {chef} staan klaar om te bevestigen in je portaal. Even tekenen en we ronden af. |
| `klant_uren_afgerond` | Hours approved & finalised; invoice follows. | contact (Jeroen), chef (Lisa de Vries), datum (vr 13 jun) | Hallo {contact}, de uren van {chef} ({datum}) zijn afgerond — de factuur volgt. Bedankt! |
| `klant_feedback_gevraagd` | Ask the klant to rate the chef after a completed shift. | contact (Jeroen), chef (Lisa de Vries) | Hallo {contact}, hoe was {chef}? Geef even je feedback in je portaal — dat helpt ons de juiste match te maken. |
| `klant_weekplanning` | Their week's planning is ready. | contact (Jeroen), week (week 24) | Hallo {contact}, jullie planning voor {week} staat klaar in je portaal. |
| `klant_wijziging_uitkomst` | Outcome of a change request they submitted. | contact (Jeroen), uitkomst (goedgekeurd) | Hallo {contact}, je wijzigingsverzoek is {uitkomst}. Details staan in je portaal. |
| `klant_portaal_uitnodiging` | First-time access to the klant portal. | contact (Jeroen) | Welkom bij Chef & Serve, {contact}! Je toegang tot het portaal staat klaar — open de link om in te loggen. |

### 🔔 Internal — to Maarten/office (short, direct, no sign-off; no marketing tone)

| Template name | What it's for / when | Variables (example) | Starter draft |
|---|---|---|---|
| `intern_uren_niet_gevuld` | Alert Maarten that a chef still hasn't filled hours after a shift. | chef (Lisa de Vries), klant (Hotel Okura) | Let op: {chef} heeft de uren voor de dienst bij {klant} nog niet ingevuld. |
| `intern_uren_keuren` | A klant approved hours → ready for office to do the final check. | chef (Lisa de Vries), klant (Hotel Okura) | {klant} heeft de uren van {chef} goedgekeurd — klaar om te keuren in het portaal. |
| `intern_chef_annulering` | A chef cancelled a shift; needs action. | chef (Lisa de Vries), klant (Hotel Okura), datum (vr 13 jun) | {chef} heeft geannuleerd bij {klant} op {datum}. Actie nodig. |
| `intern_nieuwe_chef` | A new chef signed up via the site. | naam (Lisa de Vries) | Nieuwe chef-aanmelding: {naam}. Bekijk in het portaal. |
| `intern_nieuwe_klant` | A new klant request came in. | bedrijf (Hotel Okura) | Nieuwe klant-aanvraag: {bedrijf}. Bekijk in het portaal. |
| `intern_contact` | Someone sent a message via the website contact form. | naam (Jeroen Bakker) | Nieuw bericht via de site van {naam}. Bekijk in het portaal. |
| `intern_wijzigingsverzoek` | A chef or klant requested a change to their data. | wie (Hotel Okura), veld (facturatie-e-mail) | Wijzigingsverzoek van {wie}: {veld}. Bekijk in het portaal. |

---

## Not in scope (don't write these — they stay on email)
- **Login / 2FA links** (magic link, recovery) — security; never over WhatsApp.
- **Billing-email-change confirmation** — intentionally emailed to the old address.
- **AVG / privacy-request outcomes** — legal record stays on email.

## Submission checklist (per template)
- [ ] Category set to **UTILITY**
- [ ] Name = exactly as in the table; variable names = exactly as listed
- [ ] No variable at the very start/end; no two variables adjacent
- [ ] Example value filled for every variable
- [ ] No marketing/promotional wording
- [ ] Short, clear, Dutch; sign-off "Chef & Serve" (chef/klant) via footer or body
- [ ] (Optional) "Open portaal" URL button noted for the dev
