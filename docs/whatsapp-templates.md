# WhatsApp templates (sent.dm) — full catalog

> Every transactional email Chef & Serve sends, mapped to a WhatsApp template. Create these in
> the **sent.dm dashboard**, get them **Meta-approved** (category **UTILITY** unless noted), then
> tell the dev the final **name + param names** and they'll wire each to its trigger.
>
> - **Category:** UTILITY (transactional) — easiest to approve, no marketing opt-in needed.
> - **Params are NAMED** (sent.dm sends `template: { name, parameters: { voornaam: "Lisa", … } }`).
>   Keep the param names below; the app fills them.
> - **Portal CTA:** add a "Open portaal" URL **button** to chef/klant templates (optional but nice).
> - **Taal:** Nederlands. Keep bodies short.
> - Sender helper: `src/lib/whatsapp.ts` `sendWhatsApp({ to, template, parameters })`.

---

## 1. Chef-facing (sent to the chef's WhatsApp)

| Template name | Params | Body (NL) | Trigger / replaces email |
|---|---|---|---|
| `chef_nieuwe_dienst` | voornaam, klant, datum | Hoi {voornaam}, er staat een nieuwe dienst voor je klaar bij {klant} op {datum}. Bekijk 'm en reageer in je Chef & Serve portaal. 👨‍🍳 | ShiftProposedEmail |
| `chef_dienst_bevestigd` | voornaam, klant, datum | Top {voornaam}! Je dienst bij {klant} op {datum} is bevestigd. Tot dan! — Chef & Serve | ShiftConfirmedChefEmail |
| `chef_dienst_geannuleerd` | voornaam, klant, datum | Hoi {voornaam}, de dienst bij {klant} op {datum} is helaas geannuleerd. Details in je portaal. — Chef & Serve | ShiftCancelledByChefClientEmail |
| `chef_beschikbaarheid_herinnering` | voornaam | Hoi {voornaam}, geef je je beschikbaarheid voor de komende weken even door in je Chef & Serve portaal? Dan kunnen we je inplannen. 👨‍🍳 | availability-reminder worker |
| `chef_uren_herinnering` | voornaam, klant | Hoi {voornaam}, je dienst bij {klant} zit erop! Vul je gewerkte uren even in je portaal in, dan verwerken we ze. — Chef & Serve | HoursReminderChefEmail |
| `chef_uren_ondertekend` | voornaam, klant | Goed nieuws {voornaam}: {klant} heeft je uren ondertekend. Wij controleren ze nu. — Chef & Serve | HoursSignedChefEmail |
| `chef_uren_goedgekeurd` | voornaam | Top {voornaam}, je uren zijn goedgekeurd en worden uitbetaald. 🎉 — Chef & Serve | HoursApprovedChefEmail |
| `chef_uren_teruggezet` | voornaam | Hoi {voornaam}, we hebben je uren teruggezet voor een correctie. Pas ze even aan in je portaal. — Chef & Serve | HoursRejectedByAdminEmail |
| `chef_uren_afgekeurd` | voornaam, klant | Hoi {voornaam}, {klant} heeft je ingevulde uren afgekeurd. Bekijk en corrigeer ze in je portaal. — Chef & Serve | HoursRejectedByKlantChefEmail |
| `chef_weekplanning` | voornaam, week | Hoi {voornaam}, je planning voor {week} staat klaar in je Chef & Serve portaal. 📅 | ChefWeekPlanningEmail |
| `chef_gegevens_aanvullen` | voornaam | Hoi {voornaam}, er ontbreken nog wat gegevens in je profiel. Vul ze aan in je portaal zodat we je kunnen inplannen en uitbetalen. — Chef & Serve | ProfileDataRequestEmail |
| `chef_portaal_uitnodiging` | voornaam | Welkom bij Chef & Serve, {voornaam}! Je toegang tot het medewerker-portaal staat klaar — open de link om in te loggen. 👨‍🍳 | PortalInviteEmail (chef) |

## 2. Klant-facing (sent to the klant contact's WhatsApp)

| Template name | Params | Body (NL) | Trigger / replaces email |
|---|---|---|---|
| `klant_chef_voorgesteld` | contact, rol, datum | Hallo {contact}, we hebben een chef voorgesteld voor de {rol} op {datum}. Bekijk 'm in je Chef & Serve portaal. | ChefProposedKlantEmail |
| `klant_dienst_bevestigd` | contact, chef, datum | Hallo {contact}, {chef} is bevestigd voor je dienst op {datum}. Tot dan! — Chef & Serve | ShiftConfirmedClientEmail |
| `klant_uren_tekenen` | contact, chef | Hallo {contact}, de uren van {chef} staan klaar om te bevestigen in je Chef & Serve portaal. Even tekenen en we ronden af. Bedankt! | HoursSubmittedKlantEmail + HoursReminderKlantEmail |
| `klant_uren_afgerond` | contact, chef, datum | Hallo {contact}, de uren van {chef} ({datum}) zijn afgerond — de factuur volgt. Bedankt! — Chef & Serve | HoursApprovedKlantEmail |
| `klant_feedback_gevraagd` | contact, chef | Hallo {contact}, hoe was {chef}? Geef even je feedback in je Chef & Serve portaal — dat helpt ons de juiste match te maken. | RatingPendingKlantEmail |
| `klant_weekplanning` | contact, week | Hallo {contact}, jullie planning voor {week} staat klaar in je Chef & Serve portaal. 📅 | KlantWeekPlanningEmail |
| `klant_wijziging_uitkomst` | contact, uitkomst | Hallo {contact}, je wijzigingsverzoek is {uitkomst}. Details in je Chef & Serve portaal. | ClientChangeRequestOutcomeKlantEmail |
| `klant_portaal_uitnodiging` | contact | Welkom bij Chef & Serve, {contact}! Je toegang tot het klant-portaal staat klaar — open de link om in te loggen. | PortalInviteEmail (klant) |

## 3. Intern / naar Maarten (alerts to the operator's WhatsApp)

| Template name | Params | Body (NL) | Trigger / replaces email |
|---|---|---|---|
| `intern_uren_niet_gevuld` | chef, klant | ⚠️ Let op: {chef} heeft de uren voor de dienst bij {klant} nog niet ingevuld. | hours-reminders (admin tier) — the "ik krijg er een appje van" trigger |
| `intern_uren_keuren` | chef, klant | {klant} heeft de uren van {chef} goedgekeurd — klaar om te keuren in het admin-portaal. | HoursApprovedKlantEmail (admin "keuren?") |
| `intern_chef_annulering` | chef, klant, datum | ⚠️ {chef} heeft geannuleerd bij {klant} op {datum}. Actie nodig. | Chef-annulering admin email |
| `intern_nieuwe_chef` | naam | 🍳 Nieuwe chef-aanmelding: {naam}. Bekijk in het admin-portaal. | "Nieuwe chef-aanmelding" |
| `intern_nieuwe_klant` | bedrijf | 🏨 Nieuwe klant-aanvraag: {bedrijf}. Bekijk in het admin-portaal. | "Nieuwe klant-aanvraag" |
| `intern_contact` | naam | ✉️ Nieuw bericht via de site van {naam}. Bekijk in het admin-portaal. | Contact-form email |
| `intern_wijzigingsverzoek` | wie, veld | Wijzigingsverzoek van {wie}: {veld}. Bekijk in het admin-portaal. | ClientChangeRequestAdminEmail / chef profile-change |

## 4. Owner ad-hoc (for the "stuur X een appje" AI tool)

| Template name | Params | Body (NL) | Note |
|---|---|---|---|
| `owner_bericht` | bericht | {bericht} | ⚠️ A single free-text param is often **rejected by Meta** for UTILITY (too open). If it's rejected, drop it and rely on the specific templates above; the AI tool can still pick the right specific template. |

---

## Email-only — do NOT create WhatsApp templates for these

| Email | Why it stays email |
|---|---|
| `MagicLinkEmail`, `RecoveryEmail` | **Login / 2FA links.** Never send auth links over WhatsApp (security). If you ever want WhatsApp login codes, that's a Meta **AUTHENTICATION**-category template — a separate, stricter flow. |
| `BillingEmailChangedKlantEmail` | Confirmation of a billing-email change, sent **to the OLD address on purpose** as a security tripwire. Email only. |
| `PrivacyRequestReceivedAdminEmail`, `PrivacyRequestOutcomeEmail`, `PrivacyRequestExtensionEmail` | **AVG legal records** (art. 12 timelines) — keep the formal outcome on email for the paper trail. (An optional WhatsApp "we've received your request" nudge is fine, but the formal answer = email.) |

---

## Wiring plan (once templates are approved)

1. You create the templates above in sent.dm → tell the dev the **final approved names + exact param names**.
2. Dev adds a worker-side `sendWhatsAppTemplate()` (workers can't import `src/lib`) so the reminder workers can send.
3. Dev wires each trigger to send the WhatsApp template **alongside/instead of email**, gated per-recipient (a chef/klant who prefers WhatsApp), reusing the `recipientsForClient` + notification-prefs seam.
4. Dev adds a confirm-gated **`whatsapp.send` owner AI tool** so Maarten can fire any of these from the assistant ("stuur Lisa een appje om haar uren in te vullen").
5. Each send is logged (`contact_logs` channel='whatsapp' + `recordEmailMessage`-style) + paired with a `createNotification`.
