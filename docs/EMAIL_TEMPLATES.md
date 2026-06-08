# Chef & Serve — E-mailtemplates (copywriter-gids)

> Alle **28** transactionele e-mails die het systeem stuurt: wat ze zijn, wanneer
> ze afgaan, naar wie, en de exacte tekst. Bedoeld zodat copywriters de teksten
> kunnen nalezen en aanscherpen.

## Zo bekijk je hoe een mail eruitziet

Elke template is gerenderd naar een los HTML-bestand. Open in je browser:

- **`previews/emails/index.html`** — overzicht met alle 28, klik door naar elke mail.
- **`previews/emails/<Naam>.html`** — één specifieke mail, exact zoals de ontvanger hem ziet.

Na het aanpassen van een tekst regenereer je de previews met:

```bash
npx tsx scripts/render-emails.mts
```

(De previews gebruiken nep-voorbeelddata — echte namen/bedragen vult het systeem live in.)

---

## Hoe onze e-mails werken (lees dit eerst)

1. **Eén huisstijl-omslag.** Iedere mail zit in `src/emails/_layout.tsx`: de bordeauxrode
   **Chef & Serve**-kop, een witte kaart met de inhoud, en een footer. Tekststijlen
   (kop, alinea, knop, detailregel) staan gedeeld in `styles` — niet per mail aanpassen.
2. **De tekst staat in `src/emails/<Naam>.tsx`.** Dat is wat je als copywriter bewerkt:
   de zinnen tussen de bouwblokken. **Structuur en variabelen niet wijzigen.**
3. **Variabelen (props)** zijn de gegevens die het systeem invult, bv. `{chefName}`,
   `{shiftWhen}`, `{companyName}`. Laat ze staan; verwijderen/hernoemen breekt de mail.
4. **Het onderwerp (subject) staat NIET in de template** maar in de code die de mail
   verstuurt (de "trigger"-functie hieronder). Onderwerp wijzigen = code-wijziging →
   geef het door aan een developer. De template bepaalt alleen de **inhoud**.
5. **Verzenden + tracking** loopt altijd via `sendEmail()` + `recordEmailMessage()`
   (bezorging/bounces worden gelogd). Daar hoef je niets mee.
6. **Klant-ontvangers** worden bepaald via `recipientsForClient(klant, gebeurtenis)` —
   per klant instelbaar welk contact welke mail krijgt, nooit een hard adres.
   (Uitzondering: de facturatie-wijziging gaat bewust naar het **oude** adres.)
7. **Toon & AVG-regels** (huisregels):
   - Gewoon, vriendelijk Nederlands. Geen jargon, geen ruwe statuscodes.
   - Bij ratings altijd **"feedback"**, nooit "review" of "beoordeling".
   - Chef-instructies komen alleen uit **chef-zichtbare** velden, nooit interne notities.
   - Elke statusmail eindigt met een duidelijke **vervolgstap** ("wat gebeurt er nu?").

---

## De 28 e-mails

Per mail: **wanneer** hij afgaat (+ de functie die hem stuurt), **naar wie**, een
**voorbeeld-onderwerp**, de **variabelen** die erin voorkomen, en links naar de
**preview** + het **bronbestand**.

### 👨‍🍳 Naar de chef

#### ShiftProposedEmail
- **Wat:** Aanbieding dat we de chef voor een shift hebben voorgesteld — met klant, rol, tijd, locatie, tarief en notitie, plus een knop om te accepteren/afwijzen.
- **Wanneer:** Admin stelt een chef voor (of een concept wordt gepubliceerd) — `sendProposalNotifications()` in `src/lib/domain/matching.ts`.
- **Naar:** `chef.email` · **Onderwerp:** *Nieuwe shift bij Hotel Okura Amsterdam — Souschef*
- **Variabelen:** chefName, clientName, shiftWhen, shiftRole, shiftCity, shiftRateEur, shiftNotes, placementUrl
- [Preview](../previews/emails/ShiftProposedEmail.html) · [Bron](../src/emails/ShiftProposedEmail.tsx)

#### ShiftConfirmedChefEmail
- **Wat:** Bevestiging dat de shift definitief is ingepland — klant, rol, tijd, locatie, contactpersoon + instructie bij verhindering.
- **Wanneer:** Admin bevestigt een plaatsing — `confirmPlacement()` in `src/lib/domain/placement-transition.ts`.
- **Naar:** `chef.email` · **Onderwerp:** *Shift bevestigd: Souschef bij Hotel Okura Amsterdam*
- **Variabelen:** chefName, clientName, shiftWhen, shiftLocation, shiftRole, clientContactName, clientContactPhone
- [Preview](../previews/emails/ShiftConfirmedChefEmail.html) · [Bron](../src/emails/ShiftConfirmedChefEmail.tsx)

#### ChefWeekPlanningEmail
- **Wat:** Wekelijkse planning na publicatie van een week — één mail met alle diensten (adres, contactpersoon, telefoon, details) + een `.ics`-agendabijlage.
- **Wanneer:** Planner publiceert een week — `publishDraftsForPeriod()` in `src/lib/domain/roster-publish.ts`.
- **Naar:** `chef.email` · **Onderwerp:** *Je planning — week 25 (2 diensten)*
- **Variabelen:** chefName, weekLabel, shifts[] (when, klant, role, location, contactName, contactPhone, details), portalUrl
- [Preview](../previews/emails/ChefWeekPlanningEmail.html) · [Bron](../src/emails/ChefWeekPlanningEmail.tsx)

#### HoursReminderChefEmail
- **Wat:** Herinnering om uren in te dienen na een afgeronde dienst (fase 24u/72u).
- **Wanneer:** Cron/AI als uren openstaan — `sendHoursReminder()` in `src/lib/ai/actions/send-hours-reminder.ts`.
- **Naar:** `chef.email` · **Onderwerp:** *Herinnering: vul je uren in*
- **Variabelen:** recipientName, clientName, shiftDate, stage ("24h"/"72h"), submitUrl
- [Preview](../previews/emails/HoursReminderChefEmail.html) · [Bron](../src/emails/HoursReminderChefEmail.tsx)

#### HoursSignedChefEmail
- **Wat:** Info dat de klant de uren heeft ondertekend; geen actie nodig.
- **Wanneer:** Klant ondertekent uren — sign-action in `src/app/(client)/client/shifts/[shiftId]/hours/page.tsx`.
- **Naar:** `chef.email` · **Onderwerp:** *Je uren zijn ondertekend door Hotel Okura Amsterdam*
- **Variabelen:** recipientName, clientName, shiftDate, workedHoursLabel, expectedAmountEur
- [Preview](../previews/emails/HoursSignedChefEmail.html) · [Bron](../src/emails/HoursSignedChefEmail.tsx)

#### HoursApprovedChefEmail
- **Wat:** Uren definitief goedgekeurd — wordt uitbetaald.
- **Wanneer:** Admin keurt uren goed — `approveHours()` in `src/lib/domain/hours.ts`.
- **Naar:** `chef.email` · **Onderwerp:** *Uren goedgekeurd — wordt uitbetaald*
- **Variabelen:** recipientName, clientName, shiftDate, workedHoursLabel, expectedAmountEur
- [Preview](../previews/emails/HoursApprovedChefEmail.html) · [Bron](../src/emails/HoursApprovedChefEmail.tsx)

#### HoursRejectedByKlantChefEmail
- **Wat:** De klant gaf de ingediende uren terug, met de opmerking erbij zodat de chef corrigeert.
- **Wanneer:** Klant keurt uren af — reject-action in `src/app/(client)/client/shifts/[shiftId]/hours/page.tsx`.
- **Naar:** `chef.email` · **Onderwerp:** *Uren-correctie nodig — Hotel Okura Amsterdam*
- **Variabelen:** recipientName, clientName, shiftDate, klantNote, editUrl
- [Preview](../previews/emails/HoursRejectedByKlantChefEmail.html) · [Bron](../src/emails/HoursRejectedByKlantChefEmail.tsx)

#### ProfileDataRequestEmail
- **Wat:** Verzoek aan een chef om ontbrekende profielgegevens aan te vullen via het formulier.
- **Wanneer:** Admin vraagt ontbrekende gegevens op — `createProfileDataRequest()` in `src/lib/domain/profile-data-requests.ts`.
- **Naar:** `chef.email` · **Onderwerp:** *Vul je gegevens aan — Chef & Serve*
- **Variabelen:** chefName, missingLabels[], formUrl
- [Preview](../previews/emails/ProfileDataRequestEmail.html) · [Bron](../src/emails/ProfileDataRequestEmail.tsx)

### 🏨 Naar de klant

#### ChefProposedKlantEmail
- **Wat:** Melding dat we een chef hebben voorgesteld; klant kan reageren met een opmerking (geen vetorecht).
- **Wanneer:** Admin stelt een chef voor — `sendProposalNotifications()` in `src/lib/domain/matching.ts`.
- **Naar:** `recipientsForClient(klant, 'chef_proposed')` · **Onderwerp:** *Voorgestelde chef voor Souschef — maandag 15 juni 2026, 18:00–23:00*
- **Variabelen:** contactName, companyName, chefName, chefVakniveau, chefYears, shiftWhen, shiftRole, hubUrl
- [Preview](../previews/emails/ChefProposedKlantEmail.html) · [Bron](../src/emails/ChefProposedKlantEmail.tsx)

#### ShiftConfirmedClientEmail
- **Wat:** Bevestiging dat de chef definitief is ingepland, met vakniveau + ervaring.
- **Wanneer:** Admin bevestigt een plaatsing — `confirmPlacement()` in `src/lib/domain/placement-transition.ts`.
- **Naar:** `recipientsForClient(klant, 'generic')` · **Onderwerp:** *Chef bevestigd voor Hotel Okura Amsterdam — Souschef*
- **Variabelen:** clientContactName, companyName, chefName, chefVakniveau, chefYears, shiftWhen, shiftLocation, shiftRole
- [Preview](../previews/emails/ShiftConfirmedClientEmail.html) · [Bron](../src/emails/ShiftConfirmedClientEmail.tsx)

#### KlantWeekPlanningEmail
- **Wat:** Wekelijkse planning na publicatie — de diensten met de voorgestelde chef + telefoonnummer + `.ics`-bijlage. (AVG: alleen klant-veilige velden.)
- **Wanneer:** Planner publiceert een week — `publishDraftsForPeriod()` in `src/lib/domain/roster-publish.ts`.
- **Naar:** `recipientsForClient(klant, 'chef_proposed')` · **Onderwerp:** *Jullie planning — week 25 (2 diensten)*
- **Variabelen:** contactName, companyName, weekLabel, shifts[] (when, role, chefName, chefPhone), hubUrl
- [Preview](../previews/emails/KlantWeekPlanningEmail.html) · [Bron](../src/emails/KlantWeekPlanningEmail.tsx)

#### ShiftCancelledByChefClientEmail
- **Wat:** Een chef moest een bevestigde shift annuleren — reden + geruststelling dat we vervanging zoeken (urgenter naarmate de shift dichterbij is).
- **Wanneer:** Chef annuleert — cancel-action in `src/app/(chef)/chef/shifts/[placementId]/page.tsx`.
- **Naar:** `recipientsForClient(klant, 'generic')` · **Onderwerp:** *Chef heeft geannuleerd — maandag 15 juni*
- **Variabelen:** clientContactName, companyName, chefName, shiftWhen, reason, hoursUntilShift
- [Preview](../previews/emails/ShiftCancelledByChefClientEmail.html) · [Bron](../src/emails/ShiftCancelledByChefClientEmail.tsx)

#### HoursSubmittedKlantEmail
- **Wat:** Een chef diende uren in — geplande vs. ingevulde tijden; klant kan akkoord/afkeuren.
- **Wanneer:** Chef dient uren in — submit-action in `src/app/(chef)/chef/hours/[placementId]/page.tsx`.
- **Naar:** klant-contact · **Onderwerp:** *Uren te ondertekenen — Sander Bakker op 15 juni*
- **Variabelen:** recipientName, chefName, shiftDate, scheduledStart/End, actualStart/End, breakMinutes, workedHoursLabel, expectedAmountEur, signUrl
- [Preview](../previews/emails/HoursSubmittedKlantEmail.html) · [Bron](../src/emails/HoursSubmittedKlantEmail.tsx)

#### HoursReminderKlantEmail
- **Wat:** Herinnering om de uren van de chef te ondertekenen.
- **Wanneer:** Cron/AI als uren wachten op handtekening — `sendHoursReminder()` in `src/lib/ai/actions/send-hours-reminder.ts`.
- **Naar:** `recipientsForClient(klant, 'hours_ready_to_sign')` · **Onderwerp:** *Herinnering: keur de uren goed*
- **Variabelen:** recipientName, chefName, shiftDate, signUrl
- [Preview](../previews/emails/HoursReminderKlantEmail.html) · [Bron](../src/emails/HoursReminderKlantEmail.tsx)

#### HoursApprovedKlantEmail
- **Wat:** Uren afgerond — factuur volgt binnen 5 werkdagen.
- **Wanneer:** Admin keurt uren goed — `approveHours()` in `src/lib/domain/hours.ts`.
- **Naar:** klant-contact · **Onderwerp:** *Uren afgerond voor maandag 15 juni — factuur volgt*
- **Variabelen:** recipientName, chefName, shiftDate, workedHoursLabel, clientAmountEur
- [Preview](../previews/emails/HoursApprovedKlantEmail.html) · [Bron](../src/emails/HoursApprovedKlantEmail.tsx)

#### RatingPendingKlantEmail
- **Wat:** Uitnodiging om feedback over de chef te geven (bewust "feedback", alleen intern zichtbaar).
- **Wanneer:** Uren admin-goedgekeurd — `approveHours()` in `src/lib/domain/hours.ts`.
- **Naar:** `recipientsForClient(klant, 'rating_pending')` · **Onderwerp:** *Geef feedback over Sander Bakker*
- **Variabelen:** companyName, chefName, shiftDate, rateUrl
- [Preview](../previews/emails/RatingPendingKlantEmail.html) · [Bron](../src/emails/RatingPendingKlantEmail.tsx)

#### ClientChangeRequestOutcomeKlantEmail
- **Wat:** Uitkomst van een wijzigings-/annuleringsverzoek van de klant (doorgevoerd of niet).
- **Wanneer:** Chef & Serve beslist — `decideClientShiftChangeRequest()` in `src/lib/domain/shift-change-requests.tsx`.
- **Naar:** `recipientsForClient(klant, 'client_shift_change_requested')` · **Onderwerp:** *Annulering doorgevoerd*
- **Variabelen:** contactName, companyName, kind, outcome, shiftWhen, shiftRole, decisionNotes, shiftUrl
- [Preview](../previews/emails/ClientChangeRequestOutcomeKlantEmail.html) · [Bron](../src/emails/ClientChangeRequestOutcomeKlantEmail.tsx)

#### BillingEmailChangedKlantEmail
- **Wat:** Beveiligingsmelding naar het **oude** facturatie-adres bij een adreswijziging (binnen 7 dagen terug te draaien).
- **Wanneer:** Klant past billingEmail aan — save-action in `src/app/(client)/client/profile/page.tsx`.
- **Naar:** het **oude** billing-adres rechtstreeks · **Onderwerp:** *Facturatie-e-mail gewijzigd — Hotel Okura Amsterdam*
- **Variabelen:** companyName, oldEmail, newEmail
- [Preview](../previews/emails/BillingEmailChangedKlantEmail.html) · [Bron](../src/emails/BillingEmailChangedKlantEmail.tsx)

### 🛠️ Naar kantoor (admin/owner)

#### HoursSignedAdminEmail
- **Wat:** Klant ondertekende uren; toont chef-kosten, klant-omzet en marge + vraagt finale goedkeuring.
- **Wanneer:** Klant ondertekent uren — sign-action in `src/app/(client)/client/shifts/[shiftId]/hours/page.tsx`.
- **Naar:** `recipientsFor('hours_signed')` · **Onderwerp:** *Uren goedgekeurd door Hotel Okura Amsterdam — keuren?*
- **Variabelen:** chefName, clientName, shiftDate, workedHoursLabel, chefAmountEur, clientAmountEur, marginEur, approveUrl
- [Preview](../previews/emails/HoursSignedAdminEmail.html) · [Bron](../src/emails/HoursSignedAdminEmail.tsx)

#### ClientChangeRequestAdminEmail
- **Wat:** Interne melding dat een klant een wijzigings-/annuleringsverzoek heeft ingediend.
- **Wanneer:** `createClientShiftChangeRequest()` in `src/lib/domain/shift-change-requests.tsx`.
- **Naar:** `recipientsFor('client_portal_request')` · **Onderwerp:** *Annuleringsverzoek van Restaurant De Kas*
- **Variabelen:** companyName, kind, shiftWhen, shiftRole, reason, adminUrl
- [Preview](../previews/emails/ClientChangeRequestAdminEmail.html) · [Bron](../src/emails/ClientChangeRequestAdminEmail.tsx)

#### HoursRejectedByAdminEmail
- **Wat:** We zetten al-ondertekende uren terug. **Eén template, twee ontvangers**: de chef (met aanpas-knop) en de klant (ter info) — geschakeld via `recipientRole`.
- **Wanneer:** `rejectSignedHours()` in `src/lib/domain/hours.ts` (twee sends).
- **Naar:** chef.email óf klant-contact · **Onderwerp:** *Chef & Serve heeft je uren teruggezet*
- **Variabelen:** recipientName, recipientRole ("chef"/"klant"), chefName, clientName, shiftDate, adminNote, editUrl
- [Preview](../previews/emails/HoursRejectedByAdminEmail.html) · [Bron](../src/emails/HoursRejectedByAdminEmail.tsx)

#### HoursSignedAdminEmail / HoursSignedChefEmail
*(Chef-variant staat hierboven onder "Naar de chef".)*

#### OwnerMessageEmail
- **Wat:** Vrije-tekst mail die de eigenaar via de AI-assistent verstuurt (vooraf goedgekeurd, weergegeven als alinea's).
- **Wanneer:** Eigenaar laat via de assistent een mail versturen — `sendOwnerEmail()` in `src/lib/ai/actions/send-owner-email.ts`.
- **Naar:** het opgegeven adres (replyTo = Maarten) · **Onderwerp:** *(vrij door de eigenaar bepaald)*
- **Variabelen:** title, body
- [Preview](../previews/emails/OwnerMessageEmail.html) · [Bron](../src/emails/OwnerMessageEmail.tsx)

### 🔐 Inloggen, uitnodigen & privacy

#### MagicLinkEmail
- **Wat:** Inloglink zonder wachtwoord (15 min geldig, eenmalig).
- **Wanneer:** Iemand vraagt magic-link login aan — Auth.js in `src/lib/auth.ts`.
- **Naar:** het ingevoerde e-mailadres · **Onderwerp:** *Je inloglink voor Chef & Serve*
- **Variabelen:** url, host, recipientEmail
- [Preview](../previews/emails/MagicLinkEmail.html) · [Bron](../src/emails/MagicLinkEmail.tsx)

#### PortalInviteEmail
- **Wat:** Welkomstmail bij toegang tot het portaal (chef/klant/medewerker, geschakeld via `recipientKind`).
- **Wanneer:** Gebruiker geactiveerd/uitgenodigd — `src/lib/domain/portal-invites.ts`.
- **Naar:** `user.email` · **Onderwerp:** *Welkom bij Chef & Serve — toegang tot je chef-portaal*
- **Variabelen:** recipientName, recipientKind ("chef"/"client"/"internal"), loginUrl
- [Preview](../previews/emails/PortalInviteEmail.html) · [Bron](../src/emails/PortalInviteEmail.tsx)

#### RecoveryEmail
- **Wat:** Accountherstel voor interne medewerkers (wachtwoord óf 2FA), eenmalige link (15 min).
- **Wanneer:** `requestRecovery()` in `src/lib/domain/recovery.ts`.
- **Naar:** `user.email` · **Onderwerp:** *Herstel je wachtwoord voor Chef & Serve*
- **Variabelen:** recipientName, intent ("password"/"totp"), recoveryUrl
- [Preview](../previews/emails/RecoveryEmail.html) · [Bron](../src/emails/RecoveryEmail.tsx)

#### PrivacyRequestReceivedAdminEmail
- **Wat:** Interne melding dat een AVG-verzoek binnenkwam (type, kanaal, wettelijke deadline).
- **Wanneer:** `createPrivacyRequest()` in `src/lib/domain/privacy.ts`.
- **Naar:** `recipientsFor('privacy_request')` · **Onderwerp:** *Privacyverzoek (inzage) — Lotte Jansen*
- **Variabelen:** requesterLabel, type, channel, dueDate, adminUrl
- [Preview](../previews/emails/PrivacyRequestReceivedAdminEmail.html) · [Bron](../src/emails/PrivacyRequestReceivedAdminEmail.tsx)

#### PrivacyRequestExtensionEmail
- **Wat:** Melding aan de betrokkene dat de behandeltermijn wordt verlengd (AVG art. 12(3)).
- **Wanneer:** `extendPrivacyRequest()` in `src/lib/domain/privacy.ts`.
- **Naar:** de aanvrager · **Onderwerp:** *Verlenging behandeltermijn privacyverzoek*
- **Variabelen:** requesterName, newDueDate, reason
- [Preview](../previews/emails/PrivacyRequestExtensionEmail.html) · [Bron](../src/emails/PrivacyRequestExtensionEmail.tsx)

#### PrivacyRequestOutcomeEmail
- **Wat:** Eindbericht over de uitkomst van een privacyverzoek (afgehandeld/deels/afgewezen) + uitleg over wat bewaard blijft.
- **Wanneer:** `fulfillPrivacyRequest()` / `rejectPrivacyRequest()` in `src/lib/domain/privacy.ts`.
- **Naar:** de aanvrager · **Onderwerp:** *Privacyverzoek (inzage) — uitkomst*
- **Variabelen:** requesterName, type, outcome, decisionNotes, retainedExplanation
- [Preview](../previews/emails/PrivacyRequestOutcomeEmail.html) · [Bron](../src/emails/PrivacyRequestOutcomeEmail.tsx)

---

## Snelle index (machine-leesbaar)

Alle bovenstaande gegevens (incl. voorbeeld-props per template) staan ook als JSON in
**`previews/emails/_inventory.json`** — handig om previews te regenereren of een
overzicht te genereren.
