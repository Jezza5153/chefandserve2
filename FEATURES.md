# FEATURES.md — wat dit systeem kan

> **Voor Maarten.** Elk ding dat het systeem kan, met wat het voor je doet en of het aan staat.
> Zoek op wat je wilt bereiken ("ik wil …"), niet op waar het in de code staat.

**This file owns:** the capability list — what exists and whether it is on.
**It does not own:** how the AI works (→ [AI.md](AI.md)) · the state of prod and which flags are
on (→ [MEMORY.md](MEMORY.md)) · counts (→ [docs/STATE.generated.md](docs/STATE.generated.md)) ·
step-by-step flows (→ [WORKFLOW.md](WORKFLOW.md)) · metric definitions (→ [docs/METRICS.md](docs/METRICS.md)).

Status: 🟢 live · 🟡 live achter een vlag · 🟠 half af · ⚫ uit (code bestaat, staat niet aan) · ⚪ ongebruikt.
**Whether a flag is actually on in production is stated in MEMORY.md, never here.**

---

## Gebouwd maar niet aan

Dit is de lijst die er het meest toe doet: werk dat al bestaat en alleen een besluit of een
laatste zetje nodig heeft.

| Wat | Status | Vlag | Waarom het uit staat / wat er mist |
| --- | --- | --- | --- |
| **Gebruikersbeheer** | 🟠 half af | — | Expliciet read-only 'Phase 0' — bewerken en rollen toekennen zitten hier nog niet in; rolrechten regel je op /admin/system/roles. |
| **Errors** | 🟠 half af | — | Ingebouwde Sentry-vervanger, maar expliciet 'Phase 0': geen paginering en geen knop om een fout als opgelost te markeren, terwijl het dashboard wél op resolvedA |
| **48-uurs vooruitblik (onderbezetting + uitvalrisico)** | ⚫ uit | `KPI_FORECAST_ENABLED` | Dark-launched en voor zover ik zie nooit aangezet; overlapt inhoudelijk met demand.forecast (dat wél live is), met een andere definitie van hetzelfde. |
| **Chef-assistent (AI-chat)** | ⚫ uit | `CHEF_AI_CHAT_ENABLED` | Staat expliciet standaard UIT — de codecommentaar zegt dat chefs AI-hulp voorlopig indirect krijgen via CV-profielsuggesties en volledigheids-nudges. Ik heb de  |
| **Uren-escalatieladder (hours-reminders)** | ⚫ uit | `HOURS_REMINDERS_ENABLED` | Dit is de ENIGE worker die chefs én klanten over hun eigen regels mailt — daarom bewust standaard uit, zodat hij niet op demo-data losgaat. Idempotent via audit |
| **Outbox leegtrekken (deliver-outbox)** | 🟠 half af | — | Alleen provider 'internal' wordt echt afgeleverd. 'payroll'/'csv' blijven pending — dat is bewust een eerlijke 'wacht op integratie'-stapel, geen fout. Er wordt |
| **Payingit-uitbetaling (droogloop)** | 🟠 half af | — | Bewust een droogloop: de echte push wacht op de Payingit-API-spec (open vraag #1 in MEMORY.md). In de code staat een 'ACTUAL PUSH'-markering waar de koppeling m |
| **Bewaartermijn-opruiming (AVG)** | ⚫ uit | `RETENTION_ENABLED` `RETENTION_DRY_RUN` | De enige harde verwijderaar in het systeem, daarom dubbel op slot; beide vlaggen staan standaard veilig. Werkt alleen op entiteiten die zowel een retention_poli |
| **Configureerbare herinneringsregels** | ⚫ uit | `REMINDERS_ENABLED` | Bewust gescheiden van hours-reminders: die is de VASTE urenladder, deze is de GENERIEKE regelmotor. Uren-regels moeten uit reminder_rules blijven, anders sturen |
| **Beschikbaarheids-herinnering** | ⚫ uit | `AVAILABILITY_REMINDERS_ENABLED` | HALF AF: de sleutel 'availability_reminders' staat NIET in SETTING_KEYS (src/lib/business-settings.ts) en er is geen enkel scherm dat hem schrijft. Aanzetten ka |
| **Gesprek→geheugen mijnen** | ⚫ uit | `AI_MEMORY_MINING_ENABLED` `CLAUDE` | Volgens de memory-notitie ai-reality-audit-remediation is er nog één prod-stap open: migratie 0076 toepassen, dán de vlag omzetten. Max 10 gesprekken per run, 2 |
| **Nachtelijk voorplannen (pre-plan)** | ⚫ uit | `AI_PREPLAN_ENABLED` | Idempotent doordat al gedekte plekken (inclusief bestaande concepten) worden overgeslagen. Handelt onder de identiteit van de eigenaar (opgezocht via MAARTEN_EM |
| **CV → profielvoorstellen** | ⚫ uit | `CV_AI_PROFILING_ENABLED` | Maximaal 40 chefs per run vanwege OpenAI-limieten en de 300s maxDuration. Idempotent per CV-versie (sourceHash): al beoordeelde velden worden overgeslagen. Zond |
| **Pushberichten en WhatsApp bezorgen** | ⚫ uit | `WEB_PUSH_ENABLED` `VAPID_PUBLIC_KEY` | De ticker draait zodra ÉÉN van beide kanalen aan staat, maar de route filtert per kanaal. VAPID_PUBLIC_KEY moet exact gelijk zijn aan NEXT_PUBLIC_VAPID_PUBLIC_K |
| **Verlopen dienstvoorstellen signaleren** | ⚫ uit | `OFFER_EXPIRY_SWEEP_ENABLED` `OFFER_EXPIRY_HOURS` | Puur signaleren: de status van de plaatsing blijft 'proposed', er wordt niets automatisch afgewezen — Maarten blijft de handelende partij. Throttle 6 dagen per  |
| **Uitklok-overzicht voor de eigenaar** | ⚫ uit | `CLOCKOUT_DIGEST_ENABLED` | DUBBEL INGEPLAND: staat zowel in supervisor.ts als in vercel.json crons, allebei op 0 8 * * *. Onschadelijk (20-uurs throttle op een bestaande melding van dezel |
| **Herinneringen vlak voor een dienst** | ⚫ uit | `SHIFT_REMINDERS_ENABLED` | DUBBEL INGEPLAND, net als clockout-digest: supervisor.ts én vercel.json, beide */15. Alleen de MEEST urgente openstaande trap wordt verstuurd, zodat een laat be |
| **Omgevingsvariabelen valideren bij opstarten** | 🟠 half af | — | Alleen sleutels die in het schema staan worden gevalideerd. Zeker 15 operationeel belangrijke variabelen worden elders rechtstreeks via process.env gelezen en d |
| **Binnenkomende webhooks (Resend, Jotform)** | 🟠 half af | `RESEND_WEBHOOK_SECRET` `RESEND_INBOUND_SECRET` | RESEND_INBOUND_SECRET staat in CLAUDE.md nog als 'dark, wacht op eigenaar' (moet in het Resend-dashboard gezet worden), dus binnenkomende mail wordt op producti |
| **Verificatie vóór elke PR** | 🟠 half af | — | Niets hiervan wordt afgedwongen: de enige CI-workflow is ai-eval.yml, en die draait alleen op PR's die src/lib/ai/** of de eval-scripts raken. Type-check, lint  |
| **Uren-herinneringen en escalatie** | ⚫ uit | DB-instelling | De automatische worker stuurt platte tekstmail (sendPlainEmail uit workers/_lib), NIET de mooie HoursReminder-templates. Alleen als de assistent de herinnering  |
| **Herinnering vlak vóór de dienst** | ⚫ uit | `SHIFT_REMINDERS_ENABLED` | Alleen in-app/push, géén e-mail. Alleen naar de chef, niet naar de klant. |
| **Beschikbaarheids-herinnering aan chefs** | ⚫ uit | `AVAILABILITY_REMINDERS_ENABLED` | Donderdagochtend een mail plus bel-melding aan actieve chefs met portaaltoegang om hun beschikbaarheid voor volgende week in te vullen, zodat er in het weekend  |
| **Interne digests (week, fouten, clock-out)** | 🟠 half af | `CLOCKOUT_DIGEST_ENABLED` | Week- en foutendigest kiezen hun ontvanger uit omgevingsvariabelen (MAARTEN_EMAIL / JEZZA_EMAIL), NIET uit de instelbare ontvangerstabel. Zonder die variabele s |
| **Signalering rond chef-documenten, verjaardagen en inactiviteit** | 🟠 half af | `REMINDERS_ENABLED` | De vooraanzegging bij bijna-verlopen documenten maakt volgens de code in V1 alleen een in-app melding — de e-mail staat er als 'optioneel, nog niet'. De trigger |
| **Binnenkomende e-mail van chefs en klanten** | ⚫ uit | `RESEND_INBOUND_SECRET` | De inhoud van binnenkomende mail is onbetrouwbare tekst: hij wordt opgeslagen en getoond als DATA en de AI-leeslijst geeft alleen onderwerp + classificatie teru |
| **Push-melding op de telefoon** | ⚫ uit | `WEB_PUSH_ENABLED` `VAPID` | Meldingen die als urgent zijn gemarkeerd worden naast de bel ook als webpush naar de apparaten van de gebruiker gestuurd (elke 2 minuten een aflever-ronde). App |
| **WhatsApp-kanaal** | ⚫ uit | `CHEF_WHATSAPP_ENABLED` `SENT_DM_API_KEY` | Van de 27 templates is er in de code precies ÉÉN aangesloten op een gebeurtenis: chef_nieuwe_dienst bij een voorgestelde dienst. De aflever-route zoekt het tele |
| **Wie krijgt welke klantmail (mailrouting + opt-outs)** | 🟠 half af | — | De rol-gebaseerde V2-route is code-compleet maar praktisch nog dood: de comment zegt dat client_contacts in V1 leeg is, dus vrijwel alle mail valt terug op één  |
| **Integratie-outbox (gegarandeerde aflevering van externe events)** | 🟠 half af | — | Alleen provider `internal` wordt daadwerkelijk bezorgd — dat zijn events waarvan de zichtbare gevolgen (mail + notificatie) al inline zijn gebeurd; "bezorgen" i |
| **Notificatievoorkeuren (uit-zetten per gebeurtenis)** | ⚫ uit | — | Expliciet V1 = alles altijd aan. De naad bestaat zodat V2 een instellingenscherm kan bouwen, maar de code-commentaar beschrijft het gebruik (`if (await shouldSe |
| **chef_invoices + chef_vacation_requests + chef_expense_claims — geld en verlof vanuit de kok** | 🟠 half af | — | chef_invoices is bewust volledig gescheiden van de klant-facturen (andere partijen, andere levenscyclus). De upload-UI voor de bonfoto is uitgesteld — de kolom  |
| **shift_arrival_checks — aankomstzekerheid (privacy-first)** | ⚫ uit | `ARRIVAL_TRUST_ENABLED` | Er worden bewust GEEN coördinaten en GEEN route opgeslagen — alleen '<1 km ja/nee'. Dat is de AVG-verdediging: tijdelijk, gebonden aan één dienst, op het toeste |
| **escalations — noodgevallen en incidenten** | ⚫ uit | `EMERGENCY_MODE_ENABLED` | Partiële unique (shiftId, kind) WHERE open/in_progress maakt herdetectie een no-op. De `reason` is altijd een machinegemaakte Nederlandse zin, nooit de vrije te |
| **notifications + push_subscriptions + board_posts — wat gebruikers te zien krijgen** | 🟠 half af | — | De bel is de ondergrens en is live; Web Push staat in CLAUDE.md nog als uitgesteld open punt. notifications is geïndexeerd op (userId, readAt, createdAt) — de o |

---

## Inhoud

- [Voor Maarten — het kantoor](#voor-maarten-het-kantoor) — 32
- [Voor Maarten — de cijfers](#voor-maarten-de-cijfers) — 23
- [Voor de chef](#voor-de-chef) — 22
- [Voor de klant (hotel)](#voor-de-klant-hotel) — 23
- [Wat het systeem zelf doet](#wat-het-systeem-zelf-doet) — 67
- [De machinekamer](#de-machinekamer) — 60

---

## Voor Maarten — het kantoor

De schermen waar het werk gebeurt: diensten bemannen, chefs en klanten beheren, uren keuren, plannen, factureren.

### Owner/internal-staff portal

#### Diensten-overzicht (Shifts) 🟢 live

*ik wil in één blik zien welke diensten eraan komen en welke nog niet bemand zijn*

Lijst van maximaal 200 diensten met tabs Komend / Open / Verleden / Alles, elk met live tellingen (open, gevuld, komend). Toont per rij datum-tijd, klant, rol, aantal personen, stad en status. Kan gescoped worden op één klant (drill-down vanuit het klantdossier: ?clientId=…), waarbij de koptekst de klantnaam wordt en filters de scope behouden. Vanaf hier direct doorklikken naar een dienst of naar 'Nieuwe shift'.

**Waar:** `/admin/business/shifts` · `/admin/business/shifts?tab=open` · `/admin/business/shifts?clientId=<klantId>`
**Let op:** Leesrecht volstaat (requirePermission('shifts','read')); de detailpagina eist schrijfrecht. Harde limiet van 200 rijen, geen paginering — bij grote volumes zie je niet alles.
<sub>`src/app/(admin)/admin/business/shifts/page.tsx` · `src/app/(admin)/admin/business/shifts/new/page.tsx`</sub>

#### Dienst-detail: bemannen en beheren 🟢 live `COMPLIANCE_HARDGATE_ENABLED`

*ik wil deze dienst bemannen met de juiste chef en zien wat er nog moet gebeuren*

Het werkblad per dienst. Toont samenvatting van de dienst, bestaande plaatsingen met status, en — zolang het aantal bevestigde chefs onder de headcount ligt — tot 10 gerangschikte kandidaat-suggesties, verrijkt met bewijs: eerder bij deze klant gewerkt, profielcompleetheid, reistijd- en marge-schatting per vervoersmiddel en een rank-score. Chefs die zichzelf via 'Open diensten' hebben aangemeld worden apart getoond. Acties: chef voorstellen (één klik), plaatsingsstatus zetten, plaatsing als voltooid markeren, dienst annuleren (bevestigde chefs krijgen bericht), contactmoment loggen, vaste/geblokkeerde chef van de klant aan- of uitzetten, reageren op opmerkingen (zichtbaarheidsgestuurd), match-intel opslaan en dienstnotities bijwerken.

**Waar:** `/admin/business/shifts/[id]`
**Let op:** De compliance-hardgate (VOG/ID/contract blokkeert voorstellen, met vrijgave-met-reden-paneel) draait alleen als COMPLIANCE_HARDGATE_ENABLED='true'; staat de flag uit, dan is het gewoon één-klik voorstellen zonder blokkade. Kandidaat-suggesties verdwijnen zodra headcount bevestigd is.
<sub>`src/app/(admin)/admin/business/shifts/[id]/page.tsx` · `src/app/(admin)/admin/business/shifts/[id]/_components/MatchSuggestions.tsx` · `src/app/(admin)/admin/business/shifts/[id]/_components/ExistingPlacements.tsx`</sub>

#### Chefs-overzicht: zoeken en filteren in het chefbestand 🟢 live

*ik wil snel de juiste chef vinden in mijn bestand*

Doorzoekbare lijst van chefs (naam, e-mail, stad) met statuspills (actief, onboarding, gepauzeerd, inactief, gearchiveerd, alles) en fijnmazige filters: vervoersmiddel, voorkeuren, dienstverband (payroll/zzp/beide), vakniveau, segment, minimum gemiddelde beoordeling, beschikbaar-voor-spoed, incomplete data, en eigen owner-labels. Alle filters blijven behouden bij het klikken van pills. Een filterset kan als opgeslagen zoekopdracht vastgepind worden en later met één klik teruggehaald of verwijderd.

**Waar:** `/admin/business/chefs` · `/admin/business/chefs?status=all&niveau=sous_chef&rating=4&spoed=1`
**Let op:** Verwijderde chefs (`deletedAt`) vallen altijd weg. Filteren op beoordeling laat chefs zonder beoordeling automatisch buiten beeld.
<sub>`src/app/(admin)/admin/business/chefs/page.tsx` · `src/app/(admin)/admin/business/chefs/_actions.ts` · `src/lib/domain/saved-searches.ts`</sub>

#### Chef-dossier (chef 360) 🟢 live

*ik wil alles over deze chef zien en zijn dossier op orde brengen*

Eén dossierpagina per chef: basisgegevens bewerken (vakniveau, segmenten, contact, tarieven), documenten bekijken/uploaden/verwijderen (CV, foto, certificaat, ID-bewijs, overig), portaltoegang regelen (uitnodigen, activeren, blokkeren, of uitnodigen-en-activeren in één), profielwijzigingsverzoeken van de chef goedkeuren of afwijzen, CV-suggesties overnemen of negeren, ontbrekende gegevens bij de chef opvragen, interne beoordeling geven, WhatsApp-contact aan/uit zetten, eigen owner-labels opslaan en intel-notities vastleggen. Daarnaast leesinformatie: inzetbaarheid, profielcompleetheid en onboarding-gereedheid, werk- en feedbacksamenvatting, recente diensten, betrouwbaarheidssignalen, 8-weeks trends en een audit trail van de laatste 30 gebeurtenissen.

**Waar:** `/admin/business/chefs/[id]`
**Let op:** Documentupload werkt alleen als R2 geconfigureerd is (r2IsConfigured); anders valt dat blok weg. Vereist schrijfrecht op chefs — puur lezen kan hier niet.
<sub>`src/app/(admin)/admin/business/chefs/[id]/page.tsx` · `src/app/(admin)/admin/business/chefs/[id]/_components/Chef360.tsx` · `src/app/(admin)/admin/business/chefs/[id]/_components/InzetbaarheidCard.tsx`</sub>

#### Klanten-overzicht met gezondheids-triage 🟢 live

*ik wil zien welke klanten aandacht nodig hebben*

Lijst van klanten met statuspills (actief, prospect, gepauzeerd, gearchiveerd, alles) met tellingen, plus vrij zoeken op bedrijfsnaam, contactpersoon, e-mail of stad. Elke rij krijgt een gezondheidsstip (aandacht / goed / sterk) uit een gebatchte health-berekening, en de lijst kan op gezondheid gesorteerd worden zodat wie aandacht nodig heeft bovenaan komt.

**Waar:** `/admin/business/clients` · `/admin/business/clients?sort=health`
**Let op:** Vereist schrijfrecht op clients, ook om alleen te kijken. Max 200 rijen, geen paginering.
<sub>`src/app/(admin)/admin/business/clients/page.tsx` · `src/lib/domain/client-history.ts` · `src/lib/domain/client-health.ts`</sub>

#### Klant-dossier (klant 360) 🟢 live

*ik wil weten of dit een goede klant is en hun gegevens en toegang beheren*

Dossierpagina per klant met een 'goede klant?'-oordeel op basis van afgeronde en komende diensten, marge, besteding, terugkerende chefs, gegeven beoordelingen en hoe snel ze uren aftekenen. Toont live samenvatting, 90-daagse trends, boekingspatronen (weekdagen, rolmix, vaste chefs), recente diensten en documenten. Acties: basisgegevens bewerken (inclusief e-mailwijziging die netjes via de klant-ontvangerslijst gaat), klanttype en klantlabels zetten, favoriete of geblokkeerde chefs verwijderen, portaltoegang uitnodigen/activeren/blokkeren, wijzigingsverzoeken van de klant goedkeuren of afwijzen, en intel-notities opslaan. Vanaf hier drill-down naar de diensten en de inbox van deze klant.

**Waar:** `/admin/business/clients/[id]`
**Let op:** De pagina geeft 404 als de intel-snapshot ontbreekt, niet alleen als de klant niet bestaat. Wijzigingsverzoeken tonen maximaal de laatste 25.
<sub>`src/app/(admin)/admin/business/clients/[id]/page.tsx` · `src/app/(admin)/admin/business/clients/[id]/_components/Klant360.tsx` · `src/app/(admin)/admin/business/clients/[id]/_components/ClientHealthCard.tsx`</sub>

#### Uren keuren — de goedkeuringswachtrij 🟢 live

*ik wil de uren van vorige week in één keer goedkeuren zonder alles na te lopen*

Werkwachtrij met vier filters die in mensentaal zeggen wie aan zet is: Wacht op mij (klant heeft getekend), Wacht op klant, Wacht op chef, Afgerond. Rijen zonder afwijkingen (klant getekend, binnen ±30 min van de geplande tijd, geen notities, tarieven ingevuld) krijgen een directe [Goedkeuren]-knop en een selectievakje; de knop 'Goedkeur alle zonder afwijkingen' keurt alles in de huidige filterscope goed. Rijen met afwijkingen sturen door naar de detailpagina voor handmatige beoordeling. Toont per rij chef, klant, dienst, gewerkte tijd en chefbedrag in euro's.

**Waar:** `/admin/business/hours` · `/admin/business/hours?filter=wacht_op_mij`
**Let op:** Elke goedkeuring is een aparte atomaire transactie, bewust geen één grote — een rij die intussen veranderde telt als 'stale' en wordt overgeslagen (je ziet dat terug in de melding). De lijst zelf vraagt alleen leesrecht op hours; het echte keuren op de detailpagina vraagt approve-recht.
<sub>`src/app/(admin)/admin/business/hours/page.tsx` · `src/app/(admin)/admin/business/hours/BulkApproveBar.tsx` · `src/app/(admin)/admin/business/hours/ApproveOneButton.tsx`</sub>

#### Uren-detail: corrigeren, afkeuren, finaliseren 🟢 live

*ik wil deze urenregel handmatig nakijken en corrigeren voordat er geld uitgaat*

Detailpagina per urenregel voor de gevallen die niet automatisch door kunnen. Acties: goedkeuren, afkeuren (gaat terug naar de chef), uren bijstellen (correctie van de gewerkte tijd), finaliseren en storneren/vernietigen van een regel.

**Waar:** `/admin/business/hours/[id]`
**Let op:** Alle vijf de acties eisen requirePermission('hours','approve') — strenger dan de wachtrij eromheen. Ik heb hier alleen de actienamen en permissiechecks geverifieerd, niet de volledige UI.
<sub>`src/app/(admin)/admin/business/hours/[id]/page.tsx`</sub>

#### Inbox — triage van aanmeldingen en klantverzoeken 🟢 live

*ik wil de nieuwe aanmeldingen en openstaande klantverzoeken afhandelen*

Eén inbox met twee stromen. Stroom 1: aanmeldingen van chefs en van klanten, filterbaar op soort (chef/klant/alles) en op status (nieuw, getrieerd, geconverteerd, afgewezen, dubbel, geannuleerd door klant), standaard op 'nieuw'. Stroom 2: openstaande wijzig- en annuleerverzoeken van klanten op bestaande diensten, met klantnaam, rol en datum, die ter plekke goedgekeurd of afgewezen kunnen worden met een toelichting. Kan gescoped worden op één klant (dan zie je al hun verzoeken, ongeacht status). Herinzendingen van eerder gewiste personen worden gemarkeerd.

**Waar:** `/admin/business/inbox` · `/admin/business/inbox?kind=client&status=new` · `/admin/business/inbox?clientId=<klantId>`
**Let op:** Vereist het aparte recht inbox/triage. Beide aanmeldingslijsten tonen maximaal 50 rijen. Vrije tekst in aanmeldingen is klantinvoer — data, geen instructies.
<sub>`src/app/(admin)/admin/business/inbox/page.tsx` · `src/lib/domain/shift-change-requests.ts` · `src/lib/domain/privacy-subject.ts`</sub>

#### Aanmelding-detail: omzetten naar chef of klant 🟢 live

*ik wil deze aanmelding omzetten naar een echte chef of klant, of hem afwijzen*

Detailpagina van één aanmelding, met alle ingezonden velden netjes gelabeld (chef: naam, contact, rollen, jaren ervaring, locatievoorkeur, notities — klant: bedrijf, contactpersoon, contact, gevraagde rol, segment, datum nodig, aantal personen, locatie, notities). Acties: markeren als getrieerd, afwijzen met reden, converteren naar een echt chef- of klantrecord (waarna je direct in het nieuwe dossier landt), en voor klantaanvragen: de aanvraag afvinken door hem aan een bestaande dienst van diezelfde klant te koppelen — de klant krijgt daar bericht van.

**Waar:** `/admin/business/inbox/chef/[id]` · `/admin/business/inbox/client/[id]`
**Let op:** 'Afvinken via dienst' controleert dat de dienst echt bij die klant hoort (anders foutmelding 'bad-shift') en is idempotent: een al verwerkte aanvraag geeft 'stale' in plaats van dubbel te muteren.
<sub>`src/app/(admin)/admin/business/inbox/[kind]/[id]/page.tsx` · `src/lib/domain/conversions.ts`</sub>

> **Gaten in dit gebied**
> - De shift-detailpagina heeft 9 server actions (voorstellen, plaatsingsstatus, voltooien, annuleren, contactlog, opmerkingen, match-intel, notities, vaste/geblokkeerde chef). Ik heb de namen en imports geverifieerd, maar niet elke actie-body regel voor regel gelezen — de precieze e-mail/notificatie-gevolgen per actie zijn niet gecontroleerd.
> - Ik heb /admin/business/shifts/new alleen als bestaand entry point met een createShift-action geverifieerd, niet welke velden het formulier heeft.
> - De hours-detailpagina is alleen op actienamen en permissiechecks geverifieerd, niet op UI-inhoud.
> - Van de detailcomponenten (Chef360, Klant360, snapshot- en patronenkaarten) is alleen bevestigd dat ze gerenderd worden; wat ze precies tonen komt uit hun domeinhelpers en is niet nagelezen.
> - Deze inventaris dekt alleen de vijf gevraagde ops-oppervlakken; de andere ~19 mappen onder /admin/business (agenda, board, roster, insights, payroll, invoices, chef-invoices, chef-requests, berichten, reminders, reporting, templates, forms, team, integrations, instellingen, money-assumptions, overpromise) zijn buiten scope gebleven.
> - Behalve COMPLIANCE_HARDGATE_ENABLED op de shift-detail heb ik in deze bestanden geen env-flag-gating aangetroffen — maar ik heb niet elk bestand volledig gelezen, dus dat is geen sluitend bewijs.

### Owner/internal portal

#### Dashboard (het kantoor van vandaag) 🟢 live `emergencyModeEnabled() voor de Emergency-drawer; aiEnabled() voor de command bar`

*ik wil in één blik zien wat er vandaag en morgen misgaat en het meteen oppakken*

Owner home screen: bezetting/loonkost strip, Vandaag & morgen tabel, een geraakte 'Aandacht nodig' wachtrij (te bevestigen, uren te keuren, wacht op reactie) met per-rij CTA, chef-spotlight, KPI-strip en drawers die het item ter plekke openen. Signalen kun je snoozen of wegklikken. Ververst automatisch en heeft een command bar + AI quick-ask als de assistent aanstaat.

**Waar:** `/admin/business`
**Let op:** Heet in de UI 'Dashboard' maar de route, de permissie (cockpit.read) en de AI-tools heten intern nog 'cockpit'. Noodmodus-drawer hangt achter emergencyModeEnabled().
<sub>`src/app/(admin)/admin/business/page.tsx` · `src/lib/domain/dashboard-intel.ts` · `src/lib/domain/dashboard-signal-state.ts`</sub>

#### Rooster — control tower (Dag/Week/Maand) 🟢 live

*ik wil overzicht: welke diensten staan open, waar is het krap, en wie is beschikbaar*

Eén toggle, drie lenzen op dezelfde waarheid: Dag = dispatchbord (06–23 tijdlijn per hotel + open diensten + beschikbare chefs), Week = bezettingskaart (hotels × 7 dagen), Maand = heatmap met risico-kleuren en live KPI's. KPI-tegels zijn klikbare filters. Detecteert dubbele boekingen (overlaps).

**Waar:** `/admin/business/roster`
**Let op:** Bewust GEEN mutaties op deze pagina — alles linkt door naar shift/chef-detail of naar Planning. Alles komt uit één engine (buildRosterView) en de AI leest via rosterAiSummary hetzelfde object, dus scherm en assistent kunnen niet uit elkaar lopen.
<sub>`src/app/(admin)/admin/business/roster/page.tsx` · `src/lib/domain/roster-intel.ts` · `src/lib/roster-format.ts`</sub>

#### Planning — de werkbank 🟢 live

*ik wil open diensten daadwerkelijk vullen en bevestigen, niet alleen bekijken*

Planner-cockpit voor owner én planner: intake-wachtrij, geaccepteerd-maar-niet-bevestigd, open slots in de komende 48u/7d, matchvoorstellen voor de meest urgente dienst, vraagvoorspelling, en een aandacht-rail met stale diensten + gemarkeerde spoed/klacht-mail (gefilterd op de inbox-toegang van de kijker). Voorstellen en bevestigen kan inline via dezelfde domeinfuncties als de detailpagina; er is ook een autofill-week actie.

**Waar:** `/admin/planning`
**Let op:** Bevestigen is een atomaire overgang met expectedStatus='accepted', dus dubbelklikken wordt een schone no-op in plaats van een dubbele mailcascade. Compliance-overrides worden altijd op de ingelogde gebruiker geboekt, nooit op iets uit het formulier. Klanten en Uren ontbreken hier expres (planner mag die niet zien).
<sub>`src/app/(admin)/admin/planning/page.tsx` · `src/lib/domain/planner-intel.ts` · `src/lib/domain/roster-autofill.ts`</sub>

#### Facturen — klantfacturatie 🟢 live

*ik wil goedgekeurde uren omzetten in een factuur en de betaling volgen*

Maak een factuur per klant per periode uit alle admin-goedgekeurde, nog niet gefactureerde uren (standaard vorige kalendermaand). Lijst met alle facturen, filterbaar op draft/sent/paid/void/credit, met status + 'wat gebeurt er nu?'. Toont proactief de nog niet gefactureerde uren per klant en het openstaande bedrag.

**Waar:** `/admin/business/invoices`
**Let op:** Versturen, betaald-markeren en storneren staan NIET op deze lijst maar op de detailpagina per factuur. Eén factuur per klant per periode — opnieuw genereren opent de bestaande.
<sub>`src/app/(admin)/admin/business/invoices/page.tsx` · `src/lib/domain/invoicing.ts` · `src/lib/invoice-labels.ts`</sub>

#### ZZP-facturen — chef-zelffacturen keuren 🟢 live

*ik wil de facturen die ZZP-chefs zelf insturen goedkeuren en afbetalen*

Wachtrij van ingediende zelffacturen: goedkeuren, afwijzen met een reden die de chef op /chef/facturen ziet, en daarna markeren als betaald. Toont bedrag, periode, referentie en een tijdelijke downloadlink naar de PDF in R2.

**Waar:** `/admin/business/chef-invoices`
**Let op:** Staat helemaal los van de klantfacturatie. Beslissingen zijn atomair (guarded op status), worden ge-audit en sturen de chef een melding. PDF-links verschijnen alleen als R2 geconfigureerd is. Gated op cockpit.read, niet op een eigen permissie.
<sub>`src/app/(admin)/admin/business/chef-invoices/page.tsx` · `src/lib/domain/chef-invoices.ts`</sub>

#### Payroll — batches en CSV-export 🟢 live

*ik wil de goedgekeurde uren van een periode uitbetalen via de loonadministratie*

Toont admin-goedgekeurde uren die nog niet geëxporteerd zijn, bundelt ze in een payroll-batch (draft), levert de CSV en markeert de batch als geëxporteerd — waarna de urenregels op 'exported' gaan.

**Waar:** `/admin/business/payroll`
**Let op:** CSV-first; de latere Payingit-API haakt op hetzelfde outbox-event 'payroll_batch.exported' aan. Batch aanmaken is geblokkeerd tijdens impersonatie (assertImpersonationAllowed).
<sub>`src/app/(admin)/admin/business/payroll/page.tsx`</sub>

#### Geld-aannames (belasting- en loontabel) 🟢 live `MONEY_EXPLAINER_ENABLED (de consument van deze waarden)`

*ik wil de percentages achter de geld-uitleg voor chefs zelf kloppend maken*

Owner-bewerkbare tabel met minimumloon per uur, vakantiegeld%, effectieve loonheffing, extra inhouding zonder loonheffingskorting, ZZP-reservering inkomstenbelasting, Zvw-bijdrage en BTW, plus een bronveld. Elke opslag stempelt automatisch de datum 'laatst geverifieerd' en schrijft een audit-regel.

**Waar:** `/admin/business/money-assumptions`
**Let op:** De waarden voeden de Money Explainer voor chefs, en die staat nog uit: deze tabel in-app verifiëren is expliciet de voorwaarde om MONEY_EXPLAINER_ENABLED aan te zetten.
<sub>`src/app/(admin)/admin/business/money-assumptions/page.tsx` · `src/lib/business-settings.ts`</sub>

#### Formulieren-bouwer 🟢 live

*ik wil de intake- en onboardingformulieren aanpassen zonder een developer*

Lijst van alle formulieren met slug, versie, doelgroep en status (concept/gepubliceerd/gearchiveerd); doorklikken opent de editor waarin je labels aanpast, velden verbergt of herordent en eigen velden toevoegt.

**Waar:** `/admin/business/forms` · `/admin/business/forms/[slug]`
**Let op:** Systeemvelden (BSN, IBAN, ID) liggen vast en kun je niet weggooien — alleen labelen. Lege lijst betekent dat de seed nog moet draaien (npm run db:seed:forms). Gated op forms.write, dus ook planners komen erin.
<sub>`src/app/(admin)/admin/business/forms/page.tsx`</sub>

#### Prikbord — teamberichten 🟡 live achter vlag `BOARD_ENABLED`

*ik wil een aankondiging kwijt aan mijn chefs*

Bericht typen (max 4000 tekens), doelgroep kiezen (chefs of iedereen), eventueel vastpinnen, een afbeelding uploaden, en berichten weer los te pinnen of te verwijderen.

**Waar:** `/admin/business/board`
**Let op:** De admin-kant werkt altijd, maar chefs zien het prikbord pas als BOARD_ENABLED aanstaat — de pagina zegt dat er zelf bij, zodat je alvast berichten kunt klaarzetten. Bodies renderen als geëscapete tekst, nooit als HTML.
<sub>`src/app/(admin)/admin/business/board/page.tsx` · `src/lib/domain/board.ts`</sub>

#### Bedrijfsinstellingen 🟢 live

*ik wil automatiseringen voor het hele bedrijf aan- of uitzetten*

Bedrijfsbrede schakelaars in business_settings: de uren-herinneringen-worker aan/uit, en de dagelijkse briefing (aan/uit, uur van de dag, en per kanaal: app, e-mail, WhatsApp). Elke wijziging wordt ge-audit.

**Waar:** `/admin/business/instellingen`
**Let op:** Verwar dit niet met /admin/account/instellingen (dat is per gebruiker). De Railway-worker leest dezelfde vlag rechtstreeks via SQL, dus de schakelaar werkt ook buiten de webapp om. Gated op settings.write (owner + super_admin).
<sub>`src/app/(admin)/admin/business/instellingen/page.tsx` · `src/lib/business-settings.ts`</sub>

#### Systeem-dashboard (super_admin command center) 🟢 live

*ik wil weten of het platform gezond is en wat het kost*

Gezondheidsrij, geraakte systeem-aandachtslijst (errors · outbox · privacy-SLA · backup · webhooks), verbruik & kosten (e-mail live, WhatsApp handmatig, AI indicatief), recente errors, KPI-strip (gebruikers totaal/actief, audit-regels 24u, webhook-fouten 7d, laatste backup, laatste payroll) en AI-gebruik/feedback-samenvatting.

**Waar:** `/admin/system`
**Let op:** Lees-only (fase A); het 'Bekijk als'-paneel is uitgeschakeld tot fase B. CSP-rapportbeacons zitten wél in error_log maar worden expres uit de 'open errors' KPI gefilterd, anders lijkt telemetrie op storingen.
<sub>`src/app/(admin)/admin/system/page.tsx` · `src/lib/domain/system-intel.ts`</sub>

#### Gebruikersbeheer 🟠 half af

*ik wil zien wie een account heeft, met welke rollen, en of ze 2FA aan hebben*

Lijst van alle gebruikers met e-mail, naam, soort (intern/chef/klant), status, rollen, of er een wachtwoord staat, of TOTP aanstaat en wanneer ze voor het laatst succesvol inlogden (afgeleid uit auth.signin in het audit-log).

**Waar:** `/admin/system/users`
**Let op:** Expliciet read-only 'Phase 0' — bewerken en rollen toekennen zitten hier nog niet in; rolrechten regel je op /admin/system/roles.
<sub>`src/app/(admin)/admin/system/users/page.tsx`</sub>

#### Rollen & rechten 🟢 live

*ik wil bepalen wat een planner (of een nieuwe rol) wel en niet mag*

Maak een rol aan (key, label, omschrijving) en vink per rol de rechten aan uit de catalogus, gesplitst in systeem- en business-rechten. Opslaan werkt direct: elke gebruiker met die rol leest bij zijn volgende request de nieuwe rechten.

**Waar:** `/admin/system/roles`
**Let op:** Per-gebruiker overrides bestaan in het model (grant/revoke, revoke wint altijd) maar hebben op deze pagina geen editor. super_admin houdt sowieso alles en kan zichzelf niet buitensluiten. De AI-assistent erft exact deze rechtenset, nooit meer.
<sub>`src/app/(admin)/admin/system/roles/page.tsx` · `src/lib/rbac/catalog.ts` · `src/lib/rbac/manage.ts`</sub>

#### Audit-log 🟢 live

*ik wil kunnen aantonen wie wat wanneer heeft gedaan*

Doorzoekbaar audit-overzicht, filterbaar op resource, actie (bevat-zoek), gebruiker (e-mail) en periode in dagen; toont actie, resource + id, tijdstip, gebruiker en IP.

**Waar:** `/admin/system/audit`
**Let op:** Harde limiet van 200 regels — een brede filter kapt stilletjes af; er is geen paginering en geen export.
<sub>`src/app/(admin)/admin/system/audit/page.tsx`</sub>

#### Privacyverzoeken (AVG) 🟢 live

*ik wil geen AVG-termijn overschrijden*

Cockpit voor inzage-/verwijderverzoeken met tellers voor open, te laat, deze week te verlopen en wachtend-op-identificatie; filterbaar en met dagen-tot-deadline per regel. Verzoeken die buiten het portaal binnenkomen voer je in via /new.

**Waar:** `/admin/system/privacy-requests` · `/admin/system/privacy-requests/new`
**Let op:** De 30-dagen-SLA komt uit dueDate op de rij; identiteit-niet-geverifieerd is een aparte, expliciet gemarkeerde categorie. Ook hier een cap van 200 rijen.
<sub>`src/app/(admin)/admin/system/privacy-requests/page.tsx`</sub>

#### Retentiebeleid (bewaartermijnen) 🟡 live achter vlag `RETENTION_ENABLED + RETENTION_DRY_RUN`

*ik wil per soort gegeven vastleggen hoe lang we het bewaren en waarom*

Bewerkbare matrix van bewaartermijnen per entiteit met bewaartermijn, wettelijke grondslag en omschrijving, plus de live-status van de opruimvangrails.

**Waar:** `/admin/system/retention`
**Let op:** Het beleid vastleggen kan nu; het daadwerkelijke opruimen draait op Railway en is DUBBEL gated (RETENTION_ENABLED aan én RETENTION_DRY_RUN uit). De pagina toont de vlaggen zoals de webserver ze ziet — de worker leest zijn eigen kopie, dus die twee kunnen theoretisch verschillen.
<sub>`src/app/(admin)/admin/system/retention/page.tsx` · `workers/retention.ts`</sub>

#### Notificatie-routering 🟢 live

*ik wil bepalen wie welke systeemmail krijgt*

Per gebeurtenis instellen welke ontvangers een melding krijgen (komma-gescheiden adressen, genormaliseerd en ontdubbeld) en of de gebeurtenis überhaupt aanstaat; toont wie het laatst wijzigde. Opslaan schrijft de tabel en verversts de cache meteen.

**Waar:** `/admin/system/notifications`
**Let op:** Routes bestaan zowel voor getypeerde events als voor formulier-routes; een onbekende sleutel wordt geweigerd. Er zit een cache van 60s achter, die bij opslaan expliciet wordt geïnvalideerd.
<sub>`src/app/(admin)/admin/system/notifications/page.tsx` · `src/lib/notifications.ts`</sub>

#### Inboxen & inbox-toegang 🟢 live

*ik wil dat een planner alleen de mailbox ziet die van hem is*

Definieer de vastgelegde mailboxen (planning@, persoonlijke adressen van de eigenaren, …) en wijs per mailbox toe welke medewerker toegang heeft. Berichten filtert hierop en inkomende meldingen gaan naar de leden van de gematchte inbox.

**Waar:** `/admin/system/inboxen`
**Let op:** Rollen zijn NIET hetzelfde als inboxen. Belangrijk gedrag: zolang er geen enkele inbox is geconfigureerd, ziet iedereen met toegang alles — de afscherming begint pas te werken zodra je de eerste inbox aanmaakt. Alleen super_admin (system.write).
<sub>`src/app/(admin)/admin/system/inboxen/page.tsx` · `src/lib/domain/inboxes.ts`</sub>

#### Health-check 🟢 live

*ik wil bij een storing binnen 10 seconden weten welk onderdeel stuk is*

Dezelfde controles als /api/health maar met statuspillen en een concrete hersteltip per regel: database-roundtrip in ms, AUTH_SECRET aanwezig, Resend-configuratie, R2, en verdere omgevingsvariabelen.

**Waar:** `/admin/system/health`
**Let op:** Toont bij een fout de ruwe foutmelding van de database — prima voor super_admin, maar niets om te delen.
<sub>`src/app/(admin)/admin/system/health/page.tsx`</sub>

#### Errors 🟠 half af

*ik wil zien of er iets stuk is gegaan voor een gebruiker*

De laatste 100 applicatiefouten uit error_log met melding, stacktrace, ernst, URL, tijdstip, of hij is opgelost, en welke gebruiker hem raakte.

**Waar:** `/admin/system/errors`
**Let op:** Ingebouwde Sentry-vervanger, maar expliciet 'Phase 0': geen paginering en geen knop om een fout als opgelost te markeren, terwijl het dashboard wél op resolvedAt telt.
<sub>`src/app/(admin)/admin/system/errors/page.tsx`</sub>

#### Webhooks-inspecteur 🟢 live

*ik wil zien of binnenkomende koppelingen het doen en een bericht opnieuw verwerken*

Laatste 100 binnengekomen webhooks (Jotform nu, Payingit later) met doorklik naar de ruwe payload en de mogelijkheid om opnieuw te verwerken; plus een testknop die een voorbeeldpayload POST zodat je de hele pijplijn kunt uitproberen.

**Waar:** `/admin/system/webhooks`
<sub>`src/app/(admin)/admin/system/webhooks/page.tsx`</sub>

#### E-mailsjabloon-galerij 🟢 live

*ik wil zien hoe een mail eruitziet vóór een klant of chef hem krijgt*

Elke transactionele template gerenderd met voorbeelddata (magic link, shift voorgesteld, shift bevestigd naar klant, portal-uitnodiging, …) met onderwerp en uitleg wanneer hij verstuurd wordt; elke preview staat in een eigen iframe en heeft ook een losse URL.

**Waar:** `/admin/system/emails` · `/admin/system/emails/[template]`
**Let op:** Alleen preview — teksten wijzig je in de React-Email-templates, niet hier. De sjablonenlijst is handmatig bijgehouden, dus een nieuwe template verschijnt niet vanzelf.
<sub>`src/app/(admin)/admin/system/emails/page.tsx` · `src/emails/`</sub>

> **Gaten in dit gebied**
> - De brief vroeg om een 'documents'-surface, maar onder /admin/business bestaat geen documents-route; chef- en klantdocumenten hangen waarschijnlijk onder de chef-/klantdetailpagina's (src/lib/domain/chef-documents, client-documents). Niet geverifieerd.
> - Niet gelezen (buiten de brief, wel echte owner-features): agenda, berichten, chef-requests, chefs, clients, hours, inbox, insights, integrations, overpromise, reminders, reporting, shifts, team, templates — elk een eigen page.tsx onder /admin/business.
> - Per-gebruiker permissie-overrides (grant/revoke) bestaan in permissions.ts en in de tabel user_permissions, maar ik heb geen UI gezien die ze bewerkt — alleen de rol-editor.
> - Gebruikersbeheer en de error-log zijn allebei nog 'Phase 0' read-only; er is geen scherm om een gebruiker te bewerken, uit te nodigen of te deactiveren, en geen knop om een fout op te lossen.
> - Het systeem-dashboard noemt een 'Bekijk als' (impersonatie) paneel dat uitgeschakeld is tot fase B, terwijl applyImpersonation in permissions.ts wél live is — de schakelaar zit dus ergens anders dan op /admin/system.
> - Instellingen zijn versnipperd over drie plekken: /admin/account/instellingen (per gebruiker), /admin/business/instellingen (bedrijf), /admin/business/money-assumptions (geldtabel), plus env-vlaggen die je alleen buiten de app kunt zetten.

---

## Voor Maarten — de cijfers

Wat het systeem over de business kan vertellen. Definities staan in [docs/METRICS.md](docs/METRICS.md).

#### Nachtelijke KPI-snapshot (het fundament) 🟢 live

*ik wil dat mijn cijfers elke ochtend kloppen zonder dat iemand iets bijhoudt*

Worker schrijft per dag één rij per actieve chef en per actieve klant met uren, loon, omzet, marge, afgeronde diensten, ratings, betrouwbaarheidstellers en reactietijden. Idempotent (ON CONFLICT ... DO UPDATE), dus een datum opnieuw draaien of `--backfill=180` reproduceert exact dezelfde waarde. Elke maat is additief op zijn eigen natuurlijke datum, zodat elke periode een SUM is.

**Waar:** `Railway cron 00:30 Europe/Amsterdam via workers/supervisor.ts` · `npx tsx workers/metrics-snapshot.ts --date=YYYY-MM-DD` · `--backfill=N`
**Let op:** Formules: chef revenue = Σ round(worked_minutes/60 × client_rate_cents), pay = Σ round(worked_minutes/60 × chef_rate_cents), margin = revenue − pay. Klant: spend/chef_pay identiek, slots_count = Σ headcount van shifts die die dag starten, filled_slots = placements met status confirmed\|completed, **per dienst afgetopt op headcount** — één definitie, zie [docs/METRICS.md](docs/METRICS.md#filled-slot). Rijen van vóór 2026-07-26 gebruikten de ongecapte telling en kunnen >100% geven. approval_sla_minutes = admin_approved_at − client_signed_at, dus onze eigen goedkeursnelheid, niet de tekensnelheid van de klant. Valt de worker uit, dan tonen alle geldcijfers stilletjes nul — er is geen versheids- of dataqualiteitsindicator gevonden.
<sub>`workers/metrics-snapshot.ts`</sub>

#### Omzet, loonkosten en marge per week / 30 dagen / dit jaar 🟢 live

*ik wil in één blik zien wat ik deze week, deze maand en dit jaar heb omgezet en overhoud*

Drie geldvensters uit chef_metrics_daily: week = snapshot_date ≥ now()−7d, maand = ≥ now()−30d, YTD = vanaf date_trunc('year'). marginCents = revenueCents − loonCostCents. Gerenderd als MoneyStrip/MoneyCard.

**Waar:** `/admin/business/reporting` · `/admin/business/insights` · `AI-tool business.overview`
**Let op:** Alle drie de vensters zitten binnen één WHERE snapshot_date >= date_trunc('year', now()) — in de eerste dagen van januari kappen 'laatste 7/30 dagen' stil af op 1 januari en tonen te lage cijfers. Verder: gelezen uit de snapshot, dus maximaal een dag oud en pas zichtbaar nadat uren admin-goedgekeurd zijn.
<sub>`src/lib/domain/platform-rollups.ts` · `src/lib/ai/read-model/business.ts` · `src/components/dashboard/MoneyStrip.tsx`</sub>

#### Bezettingsgraad per rol en per segment (gerealiseerd, 30 dagen) 🟢 live

*ik wil weten welk deel van de gevraagde plekken ik daadwerkelijk heb gevuld en bij welke rollen ik faal*

Live query over shifts met starts_at tussen now()−30d en now(): slots = Σ headcount, filled = least(aantal placements confirmed\|completed, headcount). rate = filled/slots, ook uitgesplitst per rol en per segment, plus een totaal.

**Waar:** `/admin/business/insights` · `/admin/business/reporting (Bezetting-tegel)` · `AI-tool business.overview`
**Let op:** Live, niet gecached — elke paginaload draait vier queries. Kijkt alleen ACHTERUIT naar reeds gestarte shifts; er is geen vooruitkijkende fill rate op deze plek (dat doet demand.forecast apart, met een andere definitie: daar telt alleen 'confirmed', hier ook 'completed').
<sub>`src/lib/domain/platform-rollups.ts`</sub>

#### Capaciteitsbenutting (expliciete schatting) 🟢 live

*ik wil een gevoel hebben of mijn chefbestand vol zit of leegloopt*

utilizationPct = gewerkte uren (30d) / (actieve chefs × 32 uur/chef/week × 30/7), afgerond. De aanname van 32 u/chef/week wordt in de UI letterlijk getoond met de tekst dat er geen harde beschikbaarheidsdata is.

**Waar:** `/admin/business/insights`
**Let op:** Geen gemeten getal. `chef_availability` slaat GEBLOKKEERDE datums op, geen capaciteit, dus echte benutting is met de huidige tabellen onmogelijk. 'Actieve chefs' hier = chefs die uren logden in 30 dagen (niet de rosterstatus 'active'), wat de noemer vertekent: hoe meer chefs stilzitten, hoe HOGER het benuttingspercentage lijkt.
<sub>`src/lib/domain/platform-rollups.ts`</sub>

#### Omzet-, marge- en bezettingstrend per week of maand 🟢 live

*ik wil zien of het beter of slechter gaat dan vorige week/maand, niet alleen hoe het nu staat*

Aggregeert client_metrics_daily met date_trunc naar ±13 weken of 12 maanden; lege buckets worden met nullen gevuld zodat een stille week als dip leest en niet als gat. Per punt: revenueCents, marginCents, slots, filled, fillRate = filled/slots (null bij 0 slots).

**Waar:** `/admin/business/reporting?range=week|month` · `AI-tool reports.platform_kpi`
**Let op:** Deze trend leest client_metrics_daily, terwijl de MoneyStrip erboven op DEZELFDE pagina chef_metrics_daily leest. Beide horen gelijk te zijn (zelfde bron-uren), maar het zijn twee onafhankelijke aggregaties — bij een gedeeltelijk gefaalde snapshot kunnen ze uiteenlopen zonder waarschuwing.
<sub>`src/lib/domain/reporting.ts` · `src/lib/ai/read-model/kpi.ts` · `src/components/dashboard/TrendChart.tsx`</sub>

#### Uitschieter-signaal op omzet en marge 🟢 live

*ik wil niet zelf grafieken hoeven lezen; zeg het me als er iets raars gebeurt*

detectSwing vergelijkt de laatste bucket met de vorige. Meldt alleen als de vorige bucket materieel is (≥ €250, oftewel prev ≥ 25.000 cent) EN de verandering ≥ 30% is. Verschijnt als gekleurde banner boven de rapportagepagina en als zin in de AI-samenvatting.

**Waar:** `/admin/business/reporting (banner)` · `AI-tool reports.platform_kpi`
**Let op:** Vergelijkt de LAATSTE bucket, die bij weken/maanden meestal nog LOOPT — een halve maand leest structureel als een daling van ~50%. De code-comment zegt 'laatste COMPLETE bucket', maar de implementatie neemt gewoon points[length-1]. Dit is de meest waarschijnlijke bron van vals alarm.
<sub>`src/lib/domain/reporting.ts`</sub>

#### Omzet en marge per klant 🟢 live

*ik wil weten welke hotels het meeste opbrengen en hoeveel ik aan ze verdien*

Sommeert client_metrics_daily over een venster (90d bij weekweergave, 365d bij maandweergave; AI-rapport 90d), top N op omzet, met detail '<x>% bezet'. Rijen met omzet 0 vallen weg.

**Waar:** `/admin/business/reporting (Omzet per klant)` · `AI-tool reports.clients (PDF)` · `AI-tool clients.loss_making`
**Let op:** Bezetting komt uit filled_slots/slots_count; sinds 2026-07-26 per dienst afgetopt, dus alleen historische rijen kunnen nog >100% geven. Limit 10 op de pagina, 25 in het PDF, 200 in de verlieslatende-analyse.
<sub>`src/lib/domain/reporting.ts` · `src/lib/ai/read-model/report-clients.ts`</sub>

#### Omzet en marge per chef 🟢 live

*ik wil weten welke chefs mijn omzet dragen en wat ik aan ze overhoud*

Sommeert chef_metrics_daily over het venster, top N op omzet, detail '<x> u · <n> diensten' (uren = minuten/60 afgerond).

**Waar:** `/admin/business/reporting (Omzet per chef)` · `AI-tool reports.chefs (PDF, 90 dagen, top 25)`
**Let op:** Marge per chef is puur de tariefspread; reiskostenvergoeding, werkgeverslasten en no-show-kosten zitten er niet in, dus dit is geen dekkingsbijdrage.
<sub>`src/lib/domain/reporting.ts` · `src/lib/ai/read-model/report-chefs.ts`</sub>

#### Verlieslatende klanten 🟢 live

*ik wil weten bij welke klant ik geld toelegt*

Filtert de klant-breakdown (standaard 30 dagen, top 200) op marginCents < 0 en sorteert meest-verlieslatend eerst; geeft naam, omzet, marge in hele euro's.

**Waar:** `AI-tool clients.loss_making (chat)`
**Let op:** Alleen in de chat — geen pagina. Omdat de marge de reiskosten negeert, mist deze lijst precies de klanten die door verre reizen net onder nul duiken; omgekeerd kan een klant met veel eigen-vervoer-chefs onterecht 'gezond' lijken.
<sub>`src/lib/ai/read-model/kpi.ts` · `src/lib/ai/tools/kpi.ts`</sub>

#### Nog te factureren uren per klant 🟢 live

*ik wil weten hoeveel geld er goedgekeurd klaarstaat maar nog niet gefactureerd is*

Goedgekeurde, nog niet gefactureerde uren gegroepeerd per klant: aantal uurbriefjes, bedrag ex btw, oudste dienstdatum. Verschijnt als klikbare amberkleurige nudge naar /admin/business/invoices en als AI-antwoord.

**Waar:** `/admin/business/reporting (nudge)` · `AI-tool invoicing.unbilled`
**Let op:** Live query. Ik heb invoicing.ts niet gelezen — de exacte 'nog niet gefactureerd'-conditie is niet geverifieerd.
<sub>`src/lib/ai/read-model/kpi.ts` · `src/lib/domain/invoicing.ts`</sub>

#### Handtekening-achterstand per klant 🟢 live

*ik wil weten welke klanten hun uurbriefjes laten liggen en hoe lang al*

Eén gegroepeerde live query over shift_hours: pending = count(*) filter (client_signed_at IS NULL AND submitted_at IS NOT NULL), plus max wachttijd in dagen (now() − submitted_at). Gesorteerd op meeste openstaand.

**Waar:** `AI-tool clients.signoff_backlog (chat)`
**Let op:** Alleen chat, geen pagina en geen automatische escalatie op basis van de wachttijd. De query groepeert over ALLE shift_hours-historie zonder venster; bij groei wordt dit een full scan.
<sub>`src/lib/ai/read-model/kpi.ts`</sub>

#### Chefs met afhaak-risico 🟢 live

*ik wil weten welke goede chefs stil gevallen zijn voordat ik ze kwijt ben*

Wraps getReactivationChefs uit intel: chefs met een afgerond trackrecord die al langere tijd niet zijn ingezet, met dagen sinds laatste dienst en aantal afgeronde diensten, langst-inactief eerst.

**Waar:** `AI-tool chefs.at_risk` · `/admin/business/reporting (DaglijstCard)`
**Let op:** Een LIJST, geen churn-percentage: je ziet wie stil is, niet of het er meer of minder worden dan vorige maand. De drempel zit in intel.ts (niet gelezen); de insights-pagina gebruikt een aparte 30-dagen-definitie voor 'churnRiskCount'.
<sub>`src/lib/ai/read-model/kpi.ts` · `src/lib/domain/intel.ts`</sub>

#### Margeschatting per shift (inclusief reiskosten) 🟢 live

*ik wil bij het inplannen van een chef zien of deze dienst geld oplevert*

estimateMargin = klanttarief × uren − cheftarief × uren − reiskosten retour. Reiskosten = hemelsbrede afstand × 1,3 wegfactor × 2 (retour) × cent/km per vervoerswijze (auto 23, motor 21, e-bike 5, OV/geen 18). Toon: negative bij <0, low bij <15% marge, anders ok.

**Waar:** `/admin/business/shifts/[id]` · `planbord (roster/planbord/actions.ts)` · `OpenShiftDrawer op het dashboard`
**Let op:** Dit is de ENIGE plek waar reiskosten in de marge zitten, en het is een vooraf-schatting op basis van geplande uren. Zodra de dienst gedraaid is, verdwijnt de reiscomponent: de snapshot en dus alle rapportage rekenen weer zonder reis. Gevolg: shift-marge en rapportage-marge zijn per definitie verschillende getallen en niemand ziet vooraf-vs-achteraf.
<sub>`src/lib/domain/travel.ts` · `src/lib/ai/read-model/staffing.ts` · `src/lib/domain/fill-blockers.ts`</sub>

#### Overpromise-score per klant (beloofd vs. waargemaakt) 🟢 live

*ik wil weten welke hotels structureel meer beloven dan ze waarmaken, met bewijs*

Over de laatste 90 dagen (instelbaar 14–365) per klant: uitloop = gewerkte minuten − geplande minuten; overrunRate = aandeel shifts met uitloop ≥ 45 min; offBrief/noBreak/wontReturn = aandeel van de shifts MET clock-out-review waarin de chef aangaf dat de brief niet klopte / geen pauze / niet terug wil. Score = round(100 × min(1, 0,35×uitloop + 0,25×offBrief + 0,20×geenPauze + 0,20×nietTerug)). Klanten met <3 afgeronde shifts vallen weg.

**Waar:** `/admin/business/overpromise?d=30|90|180|365` · `AI-tool clients.overpromise` · `AI-tool reports.planned_vs_actual (laatste 36 uur, per shift)`
**Let op:** AVG-veilig: alleen labels, percentages en steekproefgrootte, nooit chefnaam of vrije tekst. Live query zonder cache over alle shift_hours in het venster. De drie review-percentages delen door het aantal REVIEWS, niet door shifts — bij één review met één klacht staat er 100% en dat wordt in de score even zwaar meegewogen als bij twintig reviews. De weging (0,35/0,25/0,2/0,2) is een keuze in code, nergens instelbaar.
<sub>`src/lib/ai/read-model/overpromise.ts` · `src/lib/ai/tools/overpromise.ts` · `src/app/(admin)/admin/business/overpromise/page.tsx`</sub>

#### Kwaliteitstrend van chefs (dalende beoordelingen + herhaal-mismatches) 🟢 live

*ik wil zien welke chef achteruit gaat en welke chef-klantcombinatie ik niet meer moet maken*

Venster 90 dagen: recent = laatste 30 dagen, prior = de 60 daarvoor. Richting = 'dalend' bij recent ≤ prior − 0,5 ster, 'stijgend' bij ≥ prior + 0,5, anders stabiel; minder dan 3 beoordelingen = 'te weinig data'. Daarnaast herhaal-lage paren: dezelfde chef × dezelfde klant met ≥2 beoordelingen van ≤3 sterren.

**Waar:** `AI-tool ratings.trends (chat)`
**Let op:** Geen enkele UI-pagina; bestaat alleen als chat-antwoord. Intern-only (ratings zijn V1 intern). Laadt alle ratings van 90 dagen in geheugen en vouwt in JS.
<sub>`src/lib/ai/read-model/rating-trends.ts`</sub>

#### Vraagprognose per week en rol (waar kom ik chefs tekort) 🟢 live

*ik wil vooruit zien in welke week ik welke rol tekort kom, zodat ik kan werven*

Live over komende shifts (niet cancelled/completed) in de komende N weken (AI: 6, planningspagina: 2), gegroepeerd op ISO-week × rol: needed = Σ headcount, filled = confirmed placements (afgetopt op headcount), open = needed − filled. Toont alleen regels met open > 0, grootste gat eerst.

**Waar:** `/admin/planning` · `AI-tool demand.forecast`
**Let op:** Expliciet GEEN voorspelling: het zijn de al ingeboekte shifts en hun huidige vulstatus. Er zit dus geen seizoenspatroon, geen historische vraaggroei en geen omzetwaarde bij (open plekken worden niet in euro's vertaald). Alleen 'confirmed' telt als gevuld, terwijl de bezettings-KPI ook 'completed' meetelt — twee definities van 'gevuld' naast elkaar.
<sub>`src/lib/ai/read-model/demand-forecast.ts` · `src/lib/ai/tools/demand.ts`</sub>

#### 48-uurs vooruitblik (onderbezetting + uitvalrisico) ⚫ uit `KPI_FORECAST_ENABLED (default UIT — sectie is onzichtbaar tenzij expliciet 'true')`

*ik wil vanochtend weten of ik de komende twee dagen een gat heb*

Toont open plekken per rol in de komende 48 uur plus een telling van chefs die eerder actief waren en nu >30 dagen stil zijn. Nadrukkelijk gelabeld als 'projectie'.

**Waar:** `/admin/business/insights (alleen als de vlag aan staat)`
**Let op:** Dark-launched en voor zover ik zie nooit aangezet; overlapt inhoudelijk met demand.forecast (dat wél live is), met een andere definitie van hetzelfde.
<sub>`src/lib/domain/forecast.ts` · `src/app/(admin)/admin/business/insights/page.tsx`</sub>

#### Ranglijsten (top verdieners, drukste, betrouwbaarste, best beoordeeld, grootste klanten) 🟢 live

*ik wil zien wie mijn beste chefs en grootste klanten zijn*

Vijf leaderboards over een venster (insights: 90 dagen top 5; rapportage: 90 of 365 dagen top 5) uit de snapshot-tabellen. 'Meest betrouwbaar' en 'best beoordeeld' hebben een ondergrens van 5 voorstellen resp. 5 reviews, met expliciete lege-staat-tekst.

**Waar:** `/admin/business/insights` · `/admin/business/reporting`
**Let op:** leaderboards.ts zelf niet gelezen — de exacte sorteer- en drempelformules zijn niet geverifieerd, alleen de aanroepparameters en de lege-staat-teksten.
<sub>`src/lib/domain/leaderboards.ts` · `src/components/dashboard/LeaderboardCard.tsx`</sub>

#### Planner- en relatie-KPI's (intake, reactietijd, tekensnelheid, match-gezondheid) 🟢 live

*ik wil weten of de machine soepel loopt: komt er werk binnen, reageren chefs snel, tekenen klanten op tijd*

Zes tegels op de rapportagepagina: intake laatste 7 dagen vs. vorige 7, bezetting 30 dagen, mediane reactietijd van chefs op een voorstel (30 dagen), gemiddelde tekensnelheid klant in uren (indienen → akkoord, 90 dagen), actieve chefs 30 dagen, actieve klanten 30 dagen. Plus drie match-tegels: chef-tevredenheid (duimpjes na de dienst), bewezen matches, vastgelegde pair-notities.

**Waar:** `/admin/business/reporting`
**Let op:** Dit is de dichtste benadering van operationele KPI's die er is, maar planner-intel.ts en intel.ts zijn niet gelezen: de definities van 'intake', 'mediane reactietijd' en 'tekensnelheid' zijn niet geverifieerd. Er is geen trendlijn en geen doelwaarde bij deze tegels — je ziet één getal zonder norm.
<sub>`src/app/(admin)/admin/business/reporting/page.tsx` · `src/lib/domain/planner-intel.ts` · `src/lib/domain/intel.ts`</sub>

#### PDF-rapporten (bedrijf, chefs, klanten) 🟢 live

*ik wil een rapport dat ik kan doorsturen of bewaren*

Drie read-tools genereren een PDF: reports.business_kpi (live snapshot + 6 maanden omzet/marge per maand), reports.chefs (90 dagen, top 25 chefs met omzet/marge/uren/diensten + teamtotalen), reports.clients (idem voor klanten).

**Waar:** `AI-tool reports.business_kpi` · `AI-tool reports.chefs` · `AI-tool reports.clients`
**Let op:** ERNSTIG: de 6-maandsgrafiek in het bedrijfsrapport rekent RECHTSTREEKS op shift_hours met WHERE started_at >= ... AND status <> 'void' — dus inclusief concept- en ingediende uren, gedateerd op de dienstdatum. Alle dashboards rekenen op definitieve uren gedateerd op goedkeuringsdatum. Dezelfde maand levert daardoor structureel twee verschillende omzetcijfers op, zonder dat het rapport dat vermeldt. Het rapport gebruikt bovendien 'client_rate_cents × worked_minutes/60' zonder round() per rij, de snapshot wél.
<sub>`src/lib/ai/read-model/report-kpi.ts` · `src/lib/ai/reports/render.tsx` · `src/lib/ai/reports/kpi-report.tsx`</sub>

#### AI-verbruik en dagbudget 🟢 live `AI_DAILY_BUDGET (live, 25/dag) + OPENAI_PRICE_INPUT_PER_1M / _OUTPUT_PER_1M / _CURRENCY (optioneel; zonder deze geen kosten en geen plafond)`

*ik wil weten wat de assistent me kost en niet voor een verrassing komen te staan*

Telt per dag per model prompt-/completion-tokens en beurten in business_settings (jsonb, 120 dagen bewaard). Kosten = prompt/1M × inputprijs + completion/1M × outputprijs, en blijft NULL zolang OPENAI_PRICE_*_PER_1M niet is ingesteld (er wordt nooit een tarief verzonnen). AI_DAILY_BUDGET is een harde dagplafond: bij ≥100% weigert de assistent nieuwe beurten, bij ≥80% een waarschuwing, met een notificatie die maximaal eens per 20 uur afgaat. Daarnaast top-8 tools per aantal aanroepen en mislukkingen uit de audit log (30 dagen).

**Waar:** `/admin/system (AI-tokens-kaart)` · `notificatie ai_budget_alert`
**Let op:** Dagbuckets zijn UTC, terwijl de rest van het systeem op Europe/Amsterdam draait — het budget reset dus om 01:00/02:00 Nederlandse tijd. Tokenkosten zijn niet per tool toe te wijzen; je ziet welke tool druk is, niet welke tool duur is.
<sub>`src/lib/ai/read-model/ai-usage.ts` · `src/app/(admin)/admin/system/page.tsx`</sub>

#### Klantdashboard 'Jouw cijfers' 🟢 live

*ik (als hotel) wil zien wat er loopt en wat ik heb uitgegeven*

Vier tegels: komende shifts, afgeronde shifts, uren te tekenen (urgent-toon als >0) en besteed in de laatste 30 dagen in hele euro's; daaronder de meest ingezette chef.

**Waar:** `/client (klantdashboard)`
**Let op:** De klant ziet nooit marge of cheftarief — correct. Maar ook geen trend, geen bezetting, geen jaartotaal en geen download; het is de dunste KPI-laag van de drie portalen. Chefs hebben helemaal geen KPI-blok gevonden in deze scan.
<sub>`src/app/(client)/client/page.tsx`</sub>

#### Roster KPI-strip 🟢 live

*ik wil op het planbord meteen zien wat kritiek is en erop kunnen klikken*

Zes klikbare stat-tegels boven het rooster (label, groot getal, optioneel percentage-badge, subregel), elk een filter op de roosterweergave; de 'kritiek'-tegel kleurt rood zodra het getal >0 is.

**Waar:** `/admin/business/roster`
**Let op:** Dit is het enige KPI-oppervlak waar een getal direct naar de actie leidt (filter op het rooster). De onderliggende definities komen uit het roster-viewmodel (vmFull.kpis) dat ik niet heb gelezen — welke zes getallen het zijn en hoe ze rekenen is niet geverifieerd.
<sub>`src/app/(admin)/admin/business/roster/_components/RosterKpiStrip.tsx` · `src/app/(admin)/admin/business/roster/page.tsx`</sub>

> **Gaten in dit gebied**
> - FILL RATE VOORUIT ontbreekt volledig. De bezettings-KPI kijkt uitsluitend naar shifts die AL gestart zijn (starts_at tussen now()-30d en now()). Er is geen 'van de aangevraagde plekken voor komende week/maand staat X% gevuld'-getal en dus geen dagelijkse stuurmaat; demand.forecast heeft de bouwstenen (needed/filled/open per week × rol) maar rapporteert alleen absolute gaten, nooit een percentage o
> - TIME-TO-FILL bestaat nergens. Er is geen enkele meting van 'hoe lang duurt het van shiftaanvraag tot bevestigde chef' — de belangrijkste operationele KPI van een uitzendbureau na fill rate. Benodigde data lijkt aanwezig (shifts.created_at, placements-statusovergangen, en chef_events met response_seconds voor de chefkant), maar er is geen tabel of kolom die het moment van 'confirmed' per plek vastl
> - NO-SHOW / UITVALPERCENTAGE ontbreekt als KPI. chef_metrics_daily telt al 'cancellations' (chef_events.shift_cancelled_by_chef) per chef per dag, maar geen enkel scherm of tool maakt er een percentage van (annuleringen ÷ bevestigde plekken), en er is geen apart no-show-event geverifieerd (niet komen opdagen ≠ annuleren). Late annulering binnen 24u vs. ruim vooraf wordt niet onderscheiden, terwijl d
> - CHEF-BENUTTING per chef bestaat niet, en op platformniveau alleen als schatting op een aanname van 32 u/chef/week. Oorzaak is een datagat, geen rekengat: chef_availability slaat GEBLOKKEERDE datums op, geen aangeboden capaciteit. Zonder een 'ik ben deze week beschikbaar voor N diensten/uren'-signaal van de chef blijft elke benutting een richtcijfer. Dit is de duurste ontbrekende dataset in dit geb
> - TERUGKEREND-KLANTPERCENTAGE EN RETENTIE ontbreken. Er is een lijst 'stille klanten' (getQuietClients) en 'bewezen matches', maar geen enkel percentage: welk deel van de klanten die vorig kwartaal boekten, boekte dit kwartaal weer; hoeveel omzet komt van bestaande vs. nieuwe klanten; wat is de gemiddelde levensduur en waarde per klant. client_metrics_daily bevat per klant per dag activiteit — een c
> - CHEF-CHURN ontbreekt als getal. 'Chefs met afhaak-risico' en 'churnRiskCount' zijn momentopnamen van wie stil is; er is geen instroom/uitstroom per maand, geen retentie na de eerste dienst (welk deel van de nieuwe chefs draait een tweede dienst) en geen tijd-tot-eerste-dienst voor nieuwe aanmeldingen. Alle benodigde data zit in chefs (aanmaakdatum, status) + placements/shift_hours; alleen de cohor
> - MARGE IS GEEN ECHTE MARGE. Overal in de rapportage geldt marge = klanttarief × uren − cheftarief × uren. Reiskosten zitten alleen in de vóóraf-schatting per shift en verdwijnen daarna; werkgeverslasten/sociale premies, no-show- en herplaatsingskosten, kortingen en oninbare facturen zitten nergens. Er is dus geen dekkingsbijdrage per shift/chef/klant en geen margepercentage-doel. shift_hours bevat 
> - GEEN PIJPLIJN OF VOORUITBLIKKENDE OMZET. Alle geldcijfers zijn achteruitkijkend en beginnen pas te tellen als uren admin-goedgekeurd zijn. Er is geen 'reeds ingeboekte omzet voor komende 30 dagen', geen intake-naar-shift-conversie in euro's en geen forecast-vs-actual (er wordt nooit een voorspelling opgeslagen, dus afwijking is per definitie niet te meten). Ingeboekte omzet is met bestaande data t

---

## Voor de chef

#### Beschikbaarheid bevestigen (week-strip) 🟢 live
*ik wil in één tik doorgeven welke dagen ik wél kan werken*
Zeven dag-chips op de beschikbaarheidspagina. Aangetikte dagen worden expliciet "beschikbaar" (en tellen +8 mee bij het matchen, zichtbaar als reden); uitgetikte dagen worden weer "onbekend". Geblokkeerde dagen zijn onaantastbaar vanaf deze strip. Na opslaan zie je voor hoeveel open diensten je zichtbaar bent.
**Waar:** `/chef/availability#beschikbaar` · donderdagse herinnering (aan te zetten op `/admin/business/instellingen`)
**Let op:** de herinnerings-mail vraagt de POSITIEVE actie en linkt direct naar de strip. Audit + chef-event per opslag.


Het chefportaal: werk vinden, beschikbaarheid, uren, documenten, profiel.

#### Portaltoegang: uitnodiging + magic-link login 🟢 live

*ik wil kunnen inloggen op mijn chef-portaal*

Kantoor nodigt een chef uit (inviteChefToPortal); de chef activeert het account (activatePortalUser) en logt daarna in via magic link of wachtwoord. De "controleer je e-mail"-pagina toont bewust dezelfde tekst of het e-mailadres nu bestaat of niet (geen account-enumeratie); de link is 15 minuten geldig en eenmalig. Toegang kan weer worden ingetrokken (disablePortalUser).

**Waar:** `/login` · `/verify` · `/verify-2fa`
**Let op:** Ik heb alleen de exports van portal-invites.ts en de verify-pagina gelezen, niet de volledige auth-flow.
<sub>`src/lib/domain/portal-invites.ts` · `src/app/(auth)/verify/page.tsx` · `src/app/(auth)/login/page.tsx`</sub>

#### Vandaag-dashboard (chef home) 🟢 live

*ik wil in één blik zien wat ik vandaag moet doen*

Vier blokken op prioriteit: VANDAAG (bevestigde shift(s) van vandaag met klantnaam + telefoon), ACTIE NODIG (openstaande voorstellen, uren die nog ingevuld moeten worden, afgekeurde uren), GELD (goedgekeurd / wacht op klant / wacht op kantoor) en KOMENDE shifts. Trekt er ook profielvolledigheid, openstaande AI-profielsuggesties, open diensten, je ratingsamenvatting, verlofreservering en verdienstenprognose bij. Bewust ontworpen lege staten.

**Waar:** `/chef`
**Let op:** "Te ontvangen" is expres all-time, niet per maand — een maandfilter liet €0 zien voor actieve chefs. Het open-diensten-blok hangt aan CHEF_OPEN_SHIFTS_ENABLED.
<sub>`src/app/(chef)/chef/page.tsx`</sub>

#### Open diensten + spoedclaim 🟡 live achter vlag `CHEF_OPEN_SHIFTS_ENABLED (pagina) · EMERGENCY_CLAIM_ENABLED (direct claimen)`

*ik wil zelf zien welke diensten open staan en mijn hand opsteken*

Lijst van open shifts met fit%-badge (groen/amber/grijs), afstandsschatting (~km), urgentielabel als de shift binnen 24u begint, en tarief. Acties: interesse tonen, interesse intrekken, een vraag stellen over de dienst, en — bij spoed — de dienst direct claimen (bij succes ga je meteen naar het shiftdetail met adres + contact; bij mislukking terug met een reden zoals vol/conflict/geblokkeerd). Interesse is een signaal, geen zelftoewijzing: de planner blijft de placement maken.

**Waar:** `/chef/open`
**Let op:** Zonder de vlag toont de pagina een "binnenkort"-scherm. Spoedclaim is een aparte tweede vlag: open diensten kunnen aan staan terwijl claimen uit is.
<sub>`src/app/(chef)/chef/open/page.tsx` · `src/lib/domain/shift-interests.ts`</sub>

#### Beschikbaarheid + werkvoorkeuren 🟢 live

*ik wil doorgeven wanneer ik niet kan en wat voor werk ik wil*

Drie lagen: (1) sneltoetsen — vandaag / morgen / dit weekend / deze week blokkeren, plus "herhaal vorige week"; (2) kalender voor 8 weken vooruit om losse dagen te blokkeren/deblokkeren; (3) voorkeuren — reisradius, spoed-bereikbaar, vroegste starttijd, wat je wél wil (ontbijt, hotels, restaurants, banqueting, beachclub, vroege diensten, michelin, bbq), wat je liever níét doet, payroll/zzp en een vrije notitie. Model: geen rij = beschikbaar; blokkeren schrijft available=false. Elke wijziging wordt ge-audit en als chef-event vastgelegd; voorkeuren voeden de matching.

**Waar:** `/chef/availability`
**Let op:** Data in het verleden zijn read-only (server action negeert ze). De "liever niet"-lijst wordt volgens de code nog niet door matching afgedwongen — alleen de like-keys scoren mee.
<sub>`src/app/(chef)/chef/availability/page.tsx` · `src/app/(chef)/chef/availability/_components/AvailabilityCalendar.tsx`</sub>

#### Mijn shifts + shiftdetail (accepteren, weigeren, annuleren, contact) 🟢 live

*ik wil een dienst aannemen of afzeggen en weten waar ik moet zijn*

Overzicht: chronologische lijst van al je placements met rol, klant, datum/tijd, stad en statusbadge (bevestigd groen, voorgesteld amber, afgerond blauw). Detail is het werkscherm: accepteren of weigeren van een voorstel (atomair en eigendom-gescoped — alleen jouw placement, alleen zolang die 'proposed' is), met uitklapbare weigerreden plus een 1-tik gestructureerde reden die als voorkeurssignaal naar kantoor/AI gaat. Annuleren van een bevestigde dienst kent ernsttiers (veilig / let op / urgent); bij urgent verschijnt een "Bel Maarten" tel:-knop, en een annulering stuurt een outbox-event plus mail naar kantoor én klant. Contactkaart met klanttelefoon, Google Maps-route en WhatsApp-link, zichtbare opmerkingen (nooit interne notities) en een voorkeur voor deze klant.

**Waar:** `/chef/shifts` · `/chef/shifts/[placementId]`
**Let op:** Bij een al beslist voorstel stuurt de actie je terug met ?error=stale. Ik heb van het detail de eerste 130 regels gelezen; de renderkant is afgeleid uit imports en bestandsdocumentatie.
<sub>`src/app/(chef)/chef/shifts/page.tsx` · `src/app/(chef)/chef/shifts/[placementId]/page.tsx` · `src/app/(chef)/chef/shifts/[placementId]/CancelShiftSection.tsx`</sub>

#### Onderweg & tijdens de dienst (aankomstzekerheid + statusknoppen) 🟡 live achter vlag `ARRIVAL_TRUST_ENABLED (aankomst) · SHIFT_SIGNALS_ENABLED (statusknoppen)`

*ik wil laten weten dat ik onderweg ben of vastloop, zonder dat iemand mij volgt*

Twee samenwerkende stukken op het shiftdetail. Aankomstzekerheid: in de 20 minuten vóór (en 30 na) de starttijd rekent de telefoon zelf de afstand tot de werkplek uit (drempel 1 km) en stuurt alleen de uitkomst naar /api/chef/arrival — nooit coördinaten, nooit een route; stopt zodra "in de buurt" bevestigd is en degradeert netjes bij geweigerde toestemming. Statusknoppen: één tik voor onderweg · vertraagd (15/30/onbekend) · kan niet starten (contact afwezig, ingang dicht, …) · hulp nodig · niet veilig; elke keuze wordt vastgelegd en meldt de eigenaar, waarbij veiligheid urgent is.

**Waar:** `/chef/shifts/[placementId]` · `/api/chef/arrival`
**Let op:** Twee losse vlaggen; de server hervalideert elk signaal-type, dus de UI kan nooit een ongeldige status wegschrijven.
<sub>`src/app/(chef)/chef/shifts/[placementId]/ArrivalTrust.tsx` · `src/app/(chef)/chef/shifts/[placementId]/ShiftSignals.tsx` · `src/lib/domain/arrival.ts`</sub>

#### Urenoverzicht 🟢 live

*ik wil zien welke uren ik nog moet invullen en waar mijn ingediende uren staan*

Drie bakken: ACTIE NODIG (concept, of door klant/kantoor afgekeurd — jij moet iets doen), WACHTEN OP ANDEREN (ingediend = wacht op klant, getekend = wacht op kantoor) met een vertrouwens-tijdlijn zodat je ziet waar het hangt, en AFGEROND (goedgekeurd of geëxporteerd, deze maand). Statussen altijd in mensentaal met een "wat gebeurt er nu"-regel, plus het verwachte bedrag.

**Waar:** `/chef/hours`
<sub>`src/app/(chef)/chef/hours/page.tsx` · `src/lib/hours-labels.ts`</sub>

#### Uren indienen 🟢 live

*ik wil mijn gewerkte uren snel op mijn telefoon indienen*

Mobiel formulier voorgevuld met de geplande start- en eindtijd, snelkeuze voor de pauze (geen / 15 / 30 / anders), live totaal gewerkte tijd en verwachte vergoeding, en één indien-knop. Bij indienen: atomaire statuswissel (alleen vanuit concept of afgekeurd), audit, outbox-event 'hours.submitted', melding + e-mail naar de klant zodat die kan aftekenen. Er hangt ook een korte uitcheck-review aan.

**Waar:** `/chef/hours/[placementId]`
**Let op:** Validatie stuurt terug met ?error=bad-times (eindtijd niet na starttijd) of ?error=break-too-long (pauze ≥ totale tijd). Pauze wordt geklemd op 0–480 minuten.
<sub>`src/app/(chef)/chef/hours/[placementId]/page.tsx` · `src/app/(chef)/chef/hours/[placementId]/HoursForm.tsx` · `src/lib/domain/clock-out-review.ts`</sub>

#### Verdiensten & werkpatronen 🟢 live

*ik wil weten wat ik verdiend heb en wat er nog aan zit te komen*

Read-only geldbeeld: totaal verdiend, laatste 30 dagen, betaalstatus (uitbetaald / open), verlofgeld-reservering en een prognose van geplande verdiensten (exact bedrag als het tarief vaststaat, anders een bandbreedte). Plus je eigen werkpatronen — drukste dagen, favoriete rollen — uit dezelfde intel die de operator ziet.

**Waar:** `/chef/earnings`
<sub>`src/app/(chef)/chef/earnings/page.tsx` · `src/lib/domain/chef-forecast.ts` · `src/lib/domain/chef-payments.ts`</sub>

#### Geld uitgelegd (bruto/netto/ZZP-calculator) 🟡 live achter vlag `MONEY_EXPLAINER_ENABLED`

*ik wil begrijpen wat ik netto overhoud van een uurtarief*

Rekenmachine die bruto, netto en ZZP naast elkaar zet op basis van een centraal beheerde aannametabel (met datum + bron in de voettekst), plus een FAQ over geld. Nadrukkelijk een INDICATIE.

**Waar:** `/chef/money`
**Let op:** Staat dark tot de eigenaar de aannametabel heeft geverifieerd; anders "binnenkort". De FAQ (ChefHelp) is nog niet vertaald en blijft bewust NL.
<sub>`src/app/(chef)/chef/money/page.tsx` · `src/app/(chef)/chef/money/MoneyCalculator.tsx` · `src/lib/business-settings.ts`</sub>

#### ZZP-facturen 🟢 live

*ik wil als zzp'er mijn factuur indienen en de status volgen*

Toont wat er goedgekeurd en klaar om te factureren is (uit de uitbetaalpijplijn), laat je een factuur indienen (bedrag, periode van/tot, referentie, notitie en optioneel een PDF die direct naar R2 gaat via een presigned URL) en volgt de status: concept → ingediend → goedgekeurd → betaald, of afgewezen. Payroll-chefs zien in plaats daarvan een korte uitleg dat zij niet zelf factureren.

**Waar:** `/chef/facturen`
**Let op:** Alleen zichtbaar bij employmentType 'zzp' of 'both'. Bedrag wordt geweigerd buiten 0–50.000 euro. Uploads vereisen dat R2 geconfigureerd is, anders "nog niet beschikbaar".
<sub>`src/app/(chef)/chef/facturen/page.tsx` · `src/app/(chef)/chef/facturen/InvoiceUploadField.tsx` · `src/lib/domain/chef-invoices.ts`</sub>

#### Declaraties: vakantiegeld + onkosten 🟢 live

*ik wil mijn vakantiegeld laten uitbetalen of reiskosten declareren*

Twee formulieren plus statuslijsten. Vakantiegeld: zie je gereserveerde saldo en vraag uitbetaling aan. Onkosten: categorie (reiskosten, parkeren, ov, kilometers, overig), bedrag, omschrijving en een bonnetje dat direct naar R2 gaat. Beide zijn een VERZOEK — Maarten beslist; status loopt van in behandeling naar goedgekeurd / afgewezen / geannuleerd.

**Waar:** `/chef/declaraties`
**Let op:** Defence-in-depth: een aangeleverde bon-R2-key wordt genegeerd tenzij die onder `chefs/<eigen id>/expenses/` valt.
<sub>`src/app/(chef)/chef/declaraties/page.tsx` · `src/app/(chef)/chef/declaraties/ReceiptUploadField.tsx` · `src/lib/domain/chef-requests.ts`</sub>

#### Mijn documenten 🟢 live

*ik wil mijn contract, loonstroken en certificaten kunnen bekijken en aanleveren*

Persoonlijk documentenvak: contract, loonstroken, jaaropgave, ID en certificaten bekijken/downloaden via kortlevende presigned R2-links, en zelf uploaden of verwijderen. Verlooptermijnen worden gesignaleerd ("verloopt over X dagen" amber, "verlopen" rood).

**Waar:** `/chef/documenten`
**Let op:** De chef mag zelf alleen id_document, certificate en other uploaden; elk ander type valt terug op 'other'. Verwijderen gaat via deleteOwnChefDocument (eigendom-gescoped).
<sub>`src/app/(chef)/chef/documenten/page.tsx` · `src/app/(chef)/chef/documenten/ChefDocUploader.tsx` · `src/lib/domain/chef-documents.ts`</sub>

#### Profiel: direct bewerken, wijziging aanvragen, en profiel compleet maken 🟢 live

*ik wil mijn gegevens actueel en compleet houden*

Twee zones op /chef/profile. Direct bewerkbaar: telefoon, stad, talen, specialiteiten en segmenten (casual, fine dining, hotel, banqueting, catering, event, corporate, michelin) — met audit en een 'chef.updated' outbox-event. Aanvraag-en-goedkeuring voor gevoelige velden: naam, e-mail, vakniveau en uurtariefband → profile_change_request met melding/e-mail naar kantoor. Op /chef/profile/compleet zie je welke velden nog ontbreken (alleen labels) plus suggesties die uit je CV zijn afgeleid, per stuk te Accepteren of Negeren — een veilig veld wordt direct geschreven, vakniveau wordt automatisch een wijzigingsverzoek. Geen AI-chat, geen ruwe CV-tekst op het scherm.

**Waar:** `/chef/profile` · `/chef/profile/compleet`
**Let op:** Ratings zijn V1 intern: de chef ziet alleen het eigen gemiddelde, en pas vanaf voldoende beoordelingen.
<sub>`src/app/(chef)/chef/profile/page.tsx` · `src/app/(chef)/chef/profile/ProfileForm.tsx` · `src/app/(chef)/chef/profile/RequestChangeFormSection.tsx`</sub>

#### Onboarding-wizard 🟢 live

*ik wil als nieuwe chef in één keer alles aanleveren*

Stapsgewijze wizard gevoed door een gepubliceerd formulier (slug ONBOARDING_FORM_SLUG) uit de forms-module, voorgevuld met wat al over je bekend is. Ondersteunt documentupload als R2 geconfigureerd is en onthoudt of je al hebt ingediend (status 'submitted').

**Waar:** `/chef/onboarding`
**Let op:** Is er geen gepubliceerd onboardingformulier, dan toont de pagina "nog niet beschikbaar" — de inhoud is dus door de operator beheerd, niet hardcoded.
<sub>`src/app/(chef)/chef/onboarding/page.tsx` · `src/app/(chef)/chef/onboarding/OnboardingWizard.tsx` · `src/app/(chef)/chef/onboarding/actions.ts`</sub>

#### Prikbord (team-feed) 🟡 live achter vlag `BOARD_ENABLED`

*ik wil zien wat er speelt in het team en kunnen reageren*

Leesfeed met berichten van kantoor: vastgezette posts bovenaan, een NEW-badge voor alles wat na je vorige bezoek is geplaatst, afbeeldingen, en emoji-reacties die je aan/uit tikt. Publiek per post gefilterd. Berichten worden als platte tekst gerenderd (nooit als HTML) en reacties werken zonder client-JS.

**Waar:** `/chef/board`
**Let op:** Alleen-lezen voor chefs: geen post-knop in de chef-UI, alleen reacties.
<sub>`src/app/(chef)/chef/board/page.tsx` · `src/lib/domain/board.ts`</sub>

#### Agenda-feed (ICS-abonnement) 🟢 live

*ik wil mijn diensten in mijn eigen telefoonagenda zien*

Geeft een persoonlijke ICS-URL met kopieerknop plus stap-voor-stap instructies voor iPhone, Android/Google Agenda en Outlook. Het geheim wordt bij het eerste bezoek automatisch aangemaakt, en er is een "link gelekt?"-knop die het token roteert zodat oude abonnementen dood gaan.

**Waar:** `/chef/calendar` · `/chef/calendar.ics?token=…`
**Let op:** De feed-URL valt terug op https://chefandserve2.vercel.app als NEXT_PUBLIC_APP_URL niet gezet is — op een eigen domein moet die env dus kloppen.
<sub>`src/app/(chef)/chef/calendar/page.tsx` · `src/lib/calendar/ics.ts`</sub>

#### Meldingen (in-app inbox + push) 🟡 live achter vlag `WEB_PUSH_ENABLED (+ NEXT_PUBLIC_VAPID_PUBLIC_KEY) — alleen voor de push-opt-in; de inbox staat altijd aan`

*ik wil niets missen wat kantoor of de klant mij stuurt*

In-app inbox met de 50 recentste meldingen, ongelezen-teller (ook als belletje in de header), per melding als gelezen markeren en een "alles gelezen"-knop. Optioneel een opt-in voor browser-pushmeldingen.

**Waar:** `/chef/notifications`
**Let op:** Zonder vlag of zonder VAPID-sleutel verschijnt de opt-in gewoon niet; de inbox blijft werken.
<sub>`src/app/(chef)/chef/notifications/page.tsx` · `src/components/chef/PushOptIn.tsx` · `src/lib/domain/push-subscriptions.ts`</sub>

#### Privacyverzoek (AVG) 🟢 live

*ik wil mijn gegevens inzien, corrigeren of laten verwijderen*

Formulier waarmee de ingelogde chef een AVG-verzoek indient: inzage, export, correctie, verwijdering of overig, met vrije toelichting. Omdat je bent ingelogd geldt je identiteit meteen als geverifieerd (kanaal 'portal').

**Waar:** `/chef/privacy`
<sub>`src/app/(chef)/chef/privacy/page.tsx` · `src/lib/domain/privacy.ts`</sub>

#### NL/EN taalwissel 🟡 live achter vlag `I18N_ENABLED`

*ik wil het portaal in het Engels gebruiken*

Twee pillen (NL/EN) rechtsboven in de chef-header; de keuze wordt als cookie bewaard en de pagina hervalt direct in de gekozen taal. Alle chef-pagina's lezen hun teksten uit het woordenboek; hrefs en icoontjes blijven taalonafhankelijk.

**Waar:** `header van elke /chef-pagina`
**Let op:** Staat de vlag uit, dan verdwijnt de knop maar blijft de dictionary-laag draaien (alles toont NL). De geld-FAQ (ChefHelp) is expres nog niet vertaald.
<sub>`src/components/chef/LanguageToggle.tsx` · `src/lib/i18n/server.ts` · `src/lib/i18n/locales.ts`</sub>

#### Chef-assistent (AI-chat) ⚫ uit `CHEF_AI_CHAT_ENABLED (én de algemene aiEnabled())`

*ik wil gewoon kunnen vragen "wanneer werk ik?"*

Zwevende chatwidget onderin het chef-portaal, aangesloten op /api/ai/portal/chat, met voorbeeldvragen als "wanneer werk ik?" en "welke uren moet ik nog invullen?". Alleen zichtbaar voor gebruikers van het type chef.

**Waar:** `chatwidget in de chef-layout`
**Let op:** Staat expliciet standaard UIT — de codecommentaar zegt dat chefs AI-hulp voorlopig indirect krijgen via CV-profielsuggesties en volledigheids-nudges. Ik heb de API-route zelf niet gelezen.
<sub>`src/app/(chef)/layout.tsx` · `src/lib/ai/config.ts`</sub>

#### Telefoon-app-gedrag: navigatie, installeren, toestemming 🟢 live

*ik wil dit met één duim op mijn telefoon gebruiken*

Mobiel een vaste onderbalk met vijf tabs (Vandaag · Open · Beschikbaar · Geld · Profiel, tapdoelen ≥44px, safe-area-padding) plus een "Meer"-sheet met Mijn shifts, Uren, Geld uitgelegd, Declaraties, Facturen, Mijn documenten, Meldingen, Prikbord, Agenda, Onboarding en Privacy; op desktop één rij pillen. Het portaal is bovendien een installeerbare PWA (webmanifest, Apple-webapp-metadata, themekleur, service-worker, install-prompt) met een AVG-toestemmingspoort die — blokkerend of niet, afhankelijk van de instelling — om akkoord vraagt en IP + user-agent vastlegt. Layout zet robots op noindex en toont een impersonatiebanner als kantoor meekijkt.

**Waar:** `elke /chef-pagina (layout + nav)`
**Let op:** De nav toont links altijd — ook naar pagina's achter een uit-staande vlag (Open, Prikbord, Geld uitgelegd); de chef landt dan op een "binnenkort"-scherm.
<sub>`src/app/(chef)/layout.tsx` · `src/components/chef/ChefNav.tsx` · `src/components/chef/PwaRegistrar.tsx`</sub>

> **Gaten in dit gebied**
> - De pagina's onder "Meer" linken ook wanneer hun vlag uit staat (Open diensten, Prikbord, Geld uitgelegd) — de chef landt dan op een "binnenkort"-scherm in plaats van dat de tab verborgen wordt.
> - Werkvoorkeuren: de "liever niet"-lijst (AVOID_KEYS) wordt volgens de commentaar in availability/page.tsx nog niet door matching afgedwongen; alleen de like-keys scoren mee.
> - De chef-AI-chat is gebouwd maar staat dark (CHEF_AI_CHAT_ENABLED); ik heb /api/ai/portal/chat niet gelezen, dus wat de assistent precies kan is hier niet geverifieerd.
> - Het prikbord is voor chefs alleen-lezen plus reacties — geen chef-naar-chef bericht of post in deze route.
> - Bij de grote pagina's (dashboard, shiftdetail, uren, facturen, declaraties, documenten, profiel) heb ik alleen de eerste ~100-130 regels gelezen; renderdetails verderop zijn niet geverifieerd.
> - De ICS-feed-URL valt terug op een vercel.app-domein als NEXT_PUBLIC_APP_URL ontbreekt — op eigen domein een instelrisico.

---

## Voor de klant (hotel)

Het klantportaal. De ruggengraat is `/client/shifts/[shiftId]` — elk ander scherm linkt daarheen.

#### Personeelsaanvraag indienen 🟢 live

*ik wil een chef of bediening aanvragen voor een datum*

Formulier in het portaal: rol, segment, start-/einddatum, aantal personen, tarief-indicatie en een vrije opmerking. Optioneel 'wekelijks herhalen' (wekelijks/om de week tot een einddatum) — dat maakt één losse aanvraag per keer. De aanvraag landt direct op status 'triaged' (bekende klant, slaat de 'nieuw'-triage over) in dezelfde client_submissions-tabel als externe formulieren, en mailt het kantoor.

**Waar:** `/client/request` · `dashboard-CTA '+ Nieuwe aanvraag indienen'` · `/client/requests → '+ Nieuwe aanvraag'`
**Let op:** De klant kan géén clientId meesturen — die wordt via session.user.id → clients.userId opgezocht (auth IS de lookup). De admin-mail gaat hier via een rechtstreekse Resend-call (niet via sendEmail/recordEmailMessage) en is best-effort: als mail faalt is de aanvraag wél opgeslagen. Bevestigingscopy belooft reactie 'binnen 4 werkuren'.
<sub>`src/app/(client)/client/request/page.tsx` · `src/lib/recurrence.ts`</sub>

#### Aanvragen volgen en intrekken 🟢 live

*ik wil zien wat er met mijn aanvraag gebeurt, en hem kunnen terugtrekken*

Twee lijsten: (A) personeelsaanvragen met een menselijke status ('Nieuw aangevraagd', 'In behandeling', 'Ingepland', 'Geannuleerd door jou') plus een next-step-zin, en een link naar de dienst zodra hij is omgezet; (B) wijzigings- en annuleringsverzoeken op bestaande shifts met hun beslissing en de reactie van Chef & Serve. Zolang een aanvraag 'new' of 'triaged' is kan de klant hem zelf intrekken met een optionele reden.

**Waar:** `/client/requests`
**Let op:** Intrekken is een atomaire UPDATE … WHERE status IN ('new','triaged'); is de aanvraag al opgepakt dan krijgt de klant 'kan niet meer worden ingetrokken, bel ons gerust'. Eigendom loopt via de clientSubmissions.clientId FK (was ooit companyName-matching — dichtgezet in PR-AUDIT-1). De doc-comment bovenin het bestand noemt nog de oude companyName-regel; de code doet het goed.
<sub>`src/app/(client)/client/requests/page.tsx` · `src/app/(client)/client/_components/RequestStatusBadge.tsx` · `src/lib/domain/shift-change-requests.tsx`</sub>

#### Dagelijks dashboard: wat moet ik nu doen? 🟢 live

*ik wil in één blik zien of er iets van mij wordt verwacht*

Home van het portaal. 'Actie nodig'-kaarten voor: uurbriefjes die op akkoord wachten, chefs die de afgelopen 7 dagen zijn bevestigd, eigen aanvragen die op planning wachten, en chefs die op feedback wachten. Daaronder 'Deze week' (bevestigde/toegezegde shifts van de komende 7 dagen) en CTA's naar nieuwe aanvraag + agenda-abonnement. Is er niets te doen, dan staat er expliciet 'Geen actie nodig'.

**Waar:** `/client`
**Let op:** Is de onboarding nog niet ingediend, dan staat bovenaan een aparte 'Rond je bedrijfsgegevens af'-banner. Zonder gekoppeld klant-profiel toont de pagina een 'Profiel ontbreekt'-blok met mailto naar kantoor in plaats van een crash.
<sub>`src/app/(client)/client/page.tsx` · `src/components/dashboard/ActionCard.tsx`</sub>

#### Jouw cijfers (kleine klant-KPI's) 🟢 live

*ik wil weten hoeveel ik afneem en wat het kost*

Vier read-only tegels op het dashboard: komende bevestigde shifts, afgeronde shifts, uren te tekenen (rood als >0) en besteed in de laatste 30 dagen. Plus een regel 'meest ingezet: <chef> (n×)'.

**Waar:** `/client (sectie 'Jouw cijfers')`
**Let op:** Besteed = Σ(gewerkte minuten × clientRateCents)/6000 en telt ALLEEN uren met status admin_approved of exported, gemeten op adminApprovedAt. Getekende maar nog niet goedgekeurde uren tellen dus nog niet mee — het bedrag loopt achter op de werkelijkheid.
<sub>`src/app/(client)/client/page.tsx`</sub>

#### De shift-hub (het hart van het portaal) 🟢 live

*ik wil alles over één dienst op één plek zien*

Vaste secties in vaste volgorde: koptekst (rol/segment, datum-tijd, locatie), status + 'Wat gebeurt er nu?', chefs voor deze shift, uren, feedback, acties (wijziging/annulering) en berichten. Elke shift-kaart elders in het portaal linkt hierheen.

**Waar:** `/client/shifts/[shiftId]`
**Let op:** De koptekst toont shift.roleNeeded rauw, terwijl de lijstpagina's die door formatChefRole() halen — kleine inconsistentie in rol-labels tussen hub en lijst. De 'Acties'-sectie staat er altijd, óók bij een geannuleerde shift, zodat de klant nooit vastloopt.
<sub>`src/app/(client)/client/shifts/[shiftId]/page.tsx` · `src/lib/client-shift-labels.ts` · `src/components/client/WhatHappensNext.tsx`</sub>

#### Voorgestelde chef bekijken en er iets van vinden 🟢 live

*ik wil zien wie jullie voorstellen en er iets over kunnen zeggen vóór het definitief is*

Per voorgestelde chef een kaart met foto, naam, vakniveau en jaren ervaring, plus een lijstje 'Waarom voorgesteld?' (match-redenen). Daaronder een opmerkingenveld: wat de klant stuurt wordt een placement_comment met visibility 'client_visible' én mailt de admins zodat ze het lezen vóór ze bevestigen.

**Waar:** `/client/shifts/[shiftId] → sectie 'Chefs voor deze shift'`
**Let op:** De chef-foto verschijnt alleen als er een chef_documents-rij bestaat van type 'photo' met clientVisible=true, verifiedAt gevuld en niet verwijderd — anders initialen. De klant ziet NOOIT de rating van de chef (getChefPreviewForKlant geeft bewust niets terug). Opmerkingen gaan nooit naar placements.notes. Het opmerkingenveld verschijnt alleen bij status 'proposed'.
<sub>`src/app/(client)/client/shifts/[shiftId]/page.tsx` · `src/app/(client)/client/shifts/[shiftId]/ChefFeedbackForm.tsx` · `src/lib/domain/comments.ts`</sub>

#### Uren controleren en aftekenen 🟢 live

*ik wil de gewerkte uren controleren en goedkeuren (of terugsturen)*

Bonnetjes-pagina per chef: gepland vs. ingevuld, pauze, totaal, verwachte vergoeding, eventuele chef-notitie en een vertrouwens-tijdlijn. Precies twee knoppen: Akkoord, of Niet akkoord met een verplichte reden (min. 5 tekens). Akkoord zet de uren atomair op 'client_signed' en stuurt de chef een melding + mail en het kantoor een goedkeur-mail; Niet akkoord zet ze op 'client_rejected' en stuurt de chef terug om te corrigeren.

**Waar:** `/client/shifts/[shiftId]/hours` · `dashboard-kaart 'uurbriefjes wachten op akkoord'`
**Let op:** De klant kan de tijden bewust NIET aanpassen — dat zou disputen opleveren; Chef & Serve bemiddelt. De transitie is atomair (UPDATE … WHERE status='submitted' AND client_id=…): is er in de tussentijd al iets verwerkt, dan volgt 'vernieuw de pagina'. De admin-mail bevat chefkosten, klantomzet én marge — die mail mag dus nooit naar de klant.
<sub>`src/app/(client)/client/shifts/[shiftId]/hours/page.tsx` · `src/app/(client)/client/shifts/[shiftId]/hours/RejectForm.tsx` · `src/lib/hours-labels.ts`</sub>

#### Feedback geven over de chef 🟢 live

*ik wil laten weten hoe het ging, zodat de volgende match beter is*

Sterren (1-5) + aanklikbare tags ('wat viel positief op?' / 'wat kon beter?') + optionele opmerking. Eén feedback per placement. Wordt opgeslagen als rating en werkt het gemiddelde van de chef bij.

**Waar:** `/client/shifts/[shiftId]/rate` · `dashboard-kaart 'chefs wachten op je feedback'` · `shift-hub sectie 'Feedback'`
**Let op:** Feedback is intern-only: de chef ziet alleen zijn eigen gemiddelde en pas vanaf 5 beoordelingen; andere klanten zien niets. Copy zegt altijd 'feedback', nooit 'beoordeling'/'review'. Dubbel indienen wordt door een UNIQUE op placement_id gevangen → 'je hebt al feedback gegeven'. Let op: de feedback-link op de hub verschijnt pas bij goedgekeurde uren, maar de rate-pagina zelf accepteert al een 'confirmed' placement — via directe link kan dus eerder feedback worden gegeven dan de hub suggereert.
<sub>`src/app/(client)/client/shifts/[shiftId]/rate/page.tsx` · `src/app/(client)/client/shifts/[shiftId]/rate/RatingForm.tsx` · `src/lib/domain/ratings.ts`</sub>

#### Wijziging of annulering van een shift aanvragen 🟢 live

*ik wil een geplande dienst verzetten of afzeggen*

Twee inline-panelen op de shift-hub. Wijziging: onderwerp kiezen (datum/tijd, aantal personen, rol, anders) + reden (min. 5 tekens). Annulering: reden. Beide worden een VERZOEK dat Chef & Serve afstemt met de al ingeplande chef — nooit een directe mutatie. Maximaal één open verzoek per soort per shift. Chef & Serve besluit; de klant krijgt mail + melding met de uitkomst en de toelichting.

**Waar:** `/client/shifts/[shiftId] → sectie 'Acties'` · `status terug te zien op /client/requests`
**Let op:** Een goedgekeurd ANNULERINGSverzoek annuleert nu echt de shift + alle levende placements in dezelfde transactie, en mailt de bevestigde chefs. Een goedgekeurd WIJZIGINGSverzoek registreert alleen de beslissing — de aanpassing doet de planner met de hand in de admin-UI. Een tweede verzoek van dezelfde soort geeft 'je hebt al een verzoek openstaan' (unique-index als backstop).
<sub>`src/app/(client)/client/shifts/[shiftId]/ChangeRequestModal.tsx` · `src/app/(client)/client/shifts/[shiftId]/CancelRequestModal.tsx` · `src/lib/domain/shift-change-requests.tsx`</sub>

#### Berichten bij een shift 🟢 live

*ik wil terugzien wat er over deze dienst is gezegd*

Onderaan de shift-hub een chronologische lijst van alle voor de klant zichtbare opmerkingen bij de placements van die shift, met afzender ('Chef & Serve' of 'Jij') en tijdstip.

**Waar:** `/client/shifts/[shiftId] → sectie 'Berichten'`
**Let op:** Alleen visibility='client_visible' komt door; interne planner-notities en chef-only berichten zijn onzichtbaar. Berichten zijn platte tekst (nooit HTML-rendering), max 1000 tekens. De sectie verdwijnt volledig als er nog geen berichten zijn — het is dus geen chat waar de klant uit zichzelf kan starten.
<sub>`src/lib/domain/comments.ts` · `src/app/(client)/client/shifts/[shiftId]/page.tsx`</sub>

#### Alle shifts: geschiedenis en gepland 🟢 live

*ik wil mijn hele historie en planning teruglezen*

Lijst van maximaal 100 shifts, nieuwste eerst, met rol + chefnaam, datum-tijd en de menselijke status. Elke regel linkt naar de shift-hub. Lege staat stuurt naar 'vraag een dienst aan'.

**Waar:** `/client/shifts` · `nav 'Komende shifts'` · `dashboard 'Alle shifts →'`
**Let op:** Concept-placements (draft) worden uitgesloten, dus een shift die intern al een voorgenomen chef heeft leest voor de klant als 'Wacht op planning'. De navigatie noemt dit 'Komende shifts' terwijl de pagina 'Geschiedenis & gepland' is — verwarrende naam.
<sub>`src/app/(client)/client/shifts/page.tsx`</sub>

#### Weekoverzicht 🟢 live

*ik wil mijn week visueel zien: wie komt wanneer*

Zeven dagkolommen met per dag de shifts van die week: tijdvak, rol, chefnaam en de menselijke status. Vorige/deze/volgende week te bladeren. Read-only spiegel van het interne planbord.

**Waar:** `/client/week` · `nav 'Mijn week'`
**Let op:** Weken lopen in Europe/Amsterdam-tijd; draft-placements zijn ook hier uitgesloten.
<sub>`src/app/(client)/client/week/page.tsx` · `src/lib/roster-format.ts`</sub>

#### Vaste shifts (wekelijkse afspraken) 🟢 live

*ik wil mijn terugkerende dienst inzien en er iets aan laten veranderen*

Toont de actieve shift-templates van de klant als leesbare afspraak ('elke donderdag 17:00-23:00'), met rol, aantal chefs en de eerstvolgende vier data (rekening houdend met uitzonderingen). Per template kan de klant een wijziging aanvragen met een toelichting; dat landt als client_change_request met veld 'template:<id>' en mailt de admins.

**Waar:** `/client/templates` · `nav 'Vaste shifts'`
**Let op:** De klant kan een template niet zelf aanmaken of stopzetten — alleen aanvragen. Er staat vaste tekst 'Tariefafspraak: via Chef & Serve · Status: actief'; er wordt geen echt tarief getoond.
<sub>`src/app/(client)/client/templates/page.tsx` · `src/lib/shift-template-format.ts`</sub>

#### Facturen inzien 🟢 live

*ik wil mijn facturen terugvinden en controleren*

Lijst van facturen met nummer, periode, vervaldatum, bedrag en een menselijke status, plus een detailpagina met factuurgegevens, tenaamstelling, regels (omschrijving, chefnaam, shiftdatum, bedrag) en de opbouw subtotaal/btw/totaal.

**Waar:** `/client/invoices` · `/client/invoices/[id]`
**Let op:** Alleen facturen met status sent/paid/credit zijn zichtbaar — concepten en vervallen facturen worden al in de query weggefilterd en geven een 404 bij directe link. Volledig read-only: geen PDF-download, geen betaallink.
<sub>`src/app/(client)/client/invoices/page.tsx` · `src/app/(client)/client/invoices/[id]/page.tsx` · `src/lib/invoice-labels.ts`</sub>

#### Agenda-abonnement (ICS) 🟢 live

*ik wil mijn shifts automatisch in Google/Outlook/iCal hebben*

Geeft een persoonlijke ICS-URL met kopieerknop en instructies per agenda-app. Alle bevestigde chefs en shifts lopen mee en werken zichzelf bij. Bij een gelekte URL kan de klant met één knop een nieuwe genereren — oude abonnees stoppen dan met updaten.

**Waar:** `/client/calendar` · `dashboard-CTA 'Abonneer op agenda'` · `/client/calendar.ics?token=…`
**Let op:** De token is afgeleid van een per-gebruiker secret; wie de URL heeft ziet de agenda (geen login). Roteren is de enige manier om hem in te trekken.
<sub>`src/app/(client)/client/calendar/page.tsx` · `src/app/client/calendar.ics/route.ts` · `src/lib/calendar/ics.ts`</sub>

#### Meldingen en mailvoorkeuren 🟢 live

*ik wil op de hoogte blijven, maar zelf bepalen waarover ik mail krijg*

In-app postvak met alle meldingen (los of alles-gelezen te markeren, met belletje + ongelezen-teller in de header) plus schakelaars voor vijf mailcategorieën: voorgestelde chef, chef bevestigd, uren te tekenen, wijzigingsverzoeken, feedback-herinnering. Standaard staan ze allemaal aan.

**Waar:** `/client/notifications` · `notificatiebel in de portal-header`
**Let op:** Uitzetten kán niet voor kritieke mail: facturatie-e-mail-gewijzigd (anti-overname), factuur verzonden en uren goedgekeurd/afgekeurd staan bewust altijd aan. Voorkeuren zijn per ingelogde gebruiker, niet per bedrijf.
<sub>`src/app/(client)/client/notifications/page.tsx` · `src/app/(client)/client/notifications/ClientNotificationPrefs.tsx` · `src/lib/domain/client-recipients.ts`</sub>

#### Pushmeldingen op de telefoon 🟡 live achter vlag `WEB_PUSH_ENABLED (+ NEXT_PUBLIC_VAPID_PUBLIC_KEY) — optioneel, standaard UIT`

*ik wil een seintje op mijn telefoon als er uren klaarstaan*

Opt-in-kaart bovenaan de meldingenpagina die een web-push-abonnement registreert.

**Waar:** `/client/notifications (kaart bovenaan)`
**Let op:** Zonder de flag én een VAPID-sleutel verschijnt de kaart helemaal niet; de klant merkt er niets van.
<sub>`src/app/(client)/client/notifications/page.tsx` · `src/lib/domain/push-subscriptions.ts`</sub>

#### Klantprofiel bijwerken 🟢 live

*ik wil mijn contact- en locatiegegevens kloppend houden*

Twee zones. Direct zelf aanpasbaar: contactpersoon, telefoon, e-mail, shift-adres, plaats, aankomst-instructies, facturatie-e-mail, plus beschrijvende voorkeuren (type zaak en tags). Alleen op verzoek (Chef & Serve keurt goed): bedrijfsnaam, KvK, BTW, betaaltermijn, factuuradres en het inlog-e-mailadres — die worden een wijzigingsverzoek met toelichting, met een 'wacht op akkoord'-blok bovenaan de pagina.

**Waar:** `/client/profile` · `nav 'Mijn profiel'`
**Let op:** Verandert de klant de facturatie-e-mail, dan gaat er expres een mail naar het OUDE adres (anti-overname). Een gewijzigd shift-adres of plaats geldt alleen voor TOEKOMSTIGE aanvragen — bestaande shifts hebben hun eigen locatie vastgelegd.
<sub>`src/app/(client)/client/profile/page.tsx` · `src/app/(client)/client/profile/ClientProfileForm.tsx` · `src/app/(client)/client/profile/ClientRequestChangeFormSection.tsx`</sub>

#### Bedrijfsgegevens invullen (onboarding) 🟢 live

*ik wil bij de start eenmalig al onze gegevens en documenten aanleveren*

Wizard op basis van een gepubliceerd formulier: velden per sectie, vooringevulde waarden uit het bestaande klantdossier, tussentijds opslaan als concept, bestand-uploads, en een 'zelfde als algemeen contact'-knop om het financieel contact en de tekenbevoegde over te nemen. Na indienen gaat de klant naar status 'submitted' en verdwijnt de dashboard-banner.

**Waar:** `/client/onboarding` · `dashboard-banner 'Rond je bedrijfsgegevens af'`
**Let op:** Hangt aan een gepubliceerd formulier (slug CLIENT_ONBOARDING_FORM_SLUG): is dat er niet, dan toont de pagina 'nog niet beschikbaar'. Uploads werken alleen als R2 geconfigureerd is. Onboarding staat NIET in de portal-navigatie — je komt er alleen via de dashboard-banner of de privacy-pagina.
<sub>`src/app/(client)/client/onboarding/page.tsx` · `src/app/(client)/client/onboarding/OnboardingWizard.tsx` · `src/lib/domain/client-onboarding.ts`</sub>

#### Privacyverzoek en inzage in eigen gegevens 🟢 live

*ik wil weten welke gegevens jullie van ons hebben, en die kunnen laten corrigeren of wissen*

Formulier om een AVG-verzoek in te dienen (inzage, export, correctie, verwijdering, overig) met toelichting; identiteit is al vastgesteld door de login. Daaronder een overzicht van precies de bedrijfsgegevens die het systeem bewaart, met een verwijzing om ze zelf aan te passen.

**Waar:** `/client/privacy` · `nav 'Privacy'`
**Let op:** Het gegevensoverzicht toont alleen de onboarding-velden — facturatiegegevens staan er expliciet niet bij. Belofte in de copy: reactie binnen 30 dagen.
<sub>`src/app/(client)/client/privacy/page.tsx` · `src/lib/domain/privacy.ts` · `src/components/privacy/ClientDataOverview.tsx`</sub>

#### AVG-toestemming bij binnenkomst 🟢 live

*ik wil weten waar ik mee akkoord ga voordat ik het portaal gebruik*

Toestemmingsvenster over het portaal zolang de ingelogde klant niet de huidige versie heeft geaccepteerd, met link naar de klant-privacyverklaring. Acceptatie wordt vastgelegd met IP en user-agent.

**Waar:** `elke /client/*-pagina (layout)`
**Let op:** Of het venster blokkerend is hangt af van isConsentEnforced(); staat dat uit, dan is het wegklikbaar.
<sub>`src/app/(client)/layout.tsx` · `src/lib/consent.ts`</sub>

#### AI-assistent voor de klant 🟡 live achter vlag `AI_ENABLED moet 'true' zijn; widget verschijnt alleen voor session.user.kind === 'client'`

*ik wil gewoon kunnen vragen 'welke uren moet ik tekenen?' of 'wie komt er deze week?'*

Chatwidget rechtsonder in het klantportaal, met klant-specifieke voorbeeldvragen, aangesloten op het portal-chat-endpoint.

**Waar:** `widget op elke /client/*-pagina` · `POST /api/ai/portal/chat`
**Let op:** Een super_admin die het klantportaal bekijkt ziet de widget bewust NIET. Ik heb de API-route zelf niet gelezen — wat de assistent precies mag zien valt buiten dit onderzoek.
<sub>`src/app/(client)/layout.tsx` · `src/components/ai/AssistantWidget.tsx` · `src/lib/ai/config.ts`</sub>

#### Impersonatie-banner 🟢 live

*(intern) ik wil zien dat ik als klant meekijk in plaats van als mezelf*

Waarschuwingsbalk bovenaan het portaal wanneer een interne gebruiker de sessie van een klant overneemt.

**Waar:** `elke /client/*-pagina (layout)`
**Let op:** Klant-pagina's laten super_admin er bewust in (kind !== 'client' wordt alleen geweigerd als je géén super_admin bent), maar dan zonder klantprofiel — vandaar de 'geen profiel'-blokken.
<sub>`src/app/(client)/layout.tsx` · `src/components/admin/ImpersonationBanner.tsx`</sub>

> **Gaten in dit gebied**
> - Geen enkele klant-pagina heeft een echte 'stuur ons een bericht'-ingang: berichten kunnen alleen als opmerking bij een VOORGESTELDE chef (status 'proposed'). Zodra de shift bevestigd is kan de klant alleen nog via een wijzigings-/annuleringsverzoek of telefonisch iets kwijt.
> - De feedback-poort is inconsistent: de shift-hub toont de feedback-link pas bij goedgekeurde uren, maar /client/shifts/[shiftId]/rate accepteert al een 'confirmed' placement — via een directe link (of de dashboard-kaart) kan er eerder gerate worden dan de hub belooft.
> - Rolbenamingen lekken half: de shift-hub print shift.roleNeeded rauw, terwijl /client/shifts en /client/week het door formatChefRole() halen. Dezelfde shift kan dus twee verschillende rol-labels tonen.
> - Meerdere-contactpersonen-routing (client_contacts met rollen planning/finance/onsite/hours_approval/emergency) is volledig gebouwd in recipientsForClient(), maar de tabel is in V1 leeg — in de praktijk gaat alle klantmail naar één adres (of billingEmail voor financiële mail). Er is geen klant-UI om collega's toe te voegen.
> - Facturen zijn puur leesbaar: geen PDF-download, geen betaal- of betwistingsknop, geen link van een factuurregel terug naar de shift-hub.
> - De admin-mail bij een nieuwe portaalaanvraag gaat via een losse Resend-call in /client/request/page.tsx en wordt NIET geregistreerd met recordEmailMessage — die aanvraagmail ontbreekt dus in de e-mailhistorie, anders dan alle andere klantmail.
> - 'Mijn aanvragen' toont alleen aanvragen met source='client_portal'. Aanvragen die de klant per mail of telefoon doet en die Chef & Serve zelf invoert, verschijnen daar niet — de klant ziet die pas als er een shift van is gemaakt.
> - Onboarding (/client/onboarding) ontbreekt in de portal-navigatie; is de dashboard-banner eenmaal weg (status 'submitted'), dan is de pagina alleen nog via de privacy-pagina te vinden.

---

## Wat het systeem zelf doet

Achtergrondwerk zonder dat iemand op een knop drukt: crons, herinneringen, e-mail, meldingen.

### OPS

#### Supervisor (de cron-motor op Railway) 🟢 live

*ik wil dat het systeem elke nacht en elk half uur zijn werk doet, ook als niemand kijkt*

Eén altijd-draaiend Railway-proces plant 23 taken in met node-cron in de Amsterdamse tijdzone en start elke taak als een los subprocess, zodat een crash de rest niet meesleept. Faalt een taak, dan komt er een regel in error_log die de volgende ochtend in de foutmail staat. Elk uur een 'heartbeat'-regel in de Railway-logs zodat je ziet dat hij leeft.

**Waar:** `Railway start command: npx tsx supervisor.ts` · `npx tsx workers/supervisor.ts --run-now=<job>`
**Let op:** 23 JOBS in code; CLAUDE.md says '17 cron workers' and MEMORY.md's worker table lists 13 (plus a workers/payroll-export.ts that does not exist). The docblock at the top of supervisor.ts also only documents the first ~11 jobs — the JOBS array is the only truth. Workers connect via DATABASE_URL_UNPOOLED and CANNOT import '@/' — that constraint is why half the jobs are thin tickers.
<sub>`workers/supervisor.ts` · `workers/railway.json` · `workers/_lib.ts`</sub>

#### Thin ticker → app-side cron route (het patroon) 🟢 live `CRON_SECRET (≥16 chars; not set → route returns 503)`

*ik wil dat achtergrondwerk dezelfde bedrijfslogica gebruikt als de schermen, niet een tweede kopie die uit de pas loopt*

Voor werk dat gedeelde lees-modellen of domeinlogica nodig heeft staat de logica in de Next.js-app als GET /api/cron/<naam>, en doet de Railway-worker niets anders dan die URL aanroepen met een geheim token. Zo bestaat er nooit een tweede, afwijkende kopie van bijvoorbeeld de PII-redactie.

**Waar:** `GET /api/cron/* (11 routes)` · `Authorization: Bearer <CRON_SECRET>`
**Let op:** Auth is a timingSafeEqual on the exact string `Bearer <CRON_SECRET>`; no secret → 503, wrong secret → 401. All 11 routes copy the same 8-line authorized() helper verbatim — there is no shared helper, so a fix has to be applied 11 times. Every route sets `dynamic = 'force-dynamic'` and its own maxDuration (60–300s).
<sub>`src/app/api/cron/rag-ingest/route.ts` · `workers/ai-watchdog.ts` · `.claude/rules/workers.md`</sub>

#### Uren-ketting automatisch dichtzetten (complete-placements) 🟢 live `CLOCK_OUT_RECOVERY_ENABLED (optioneel: stuurt de chef meteen een in-app prompt i.p.v. pas de +24u-herinnering)`

*ik wil dat een gedraaide dienst vanzelf 'afgerond' wordt en de chef zijn uren kan indienen zonder dat ik erachteraan moet*

Elke 30 minuten: zet bevestigde plaatsingen op 'afgerond' zodra de dienst 1 uur voorbij is, en maakt meteen een concept-urenregel aan. Die regel is wat de chef op zijn dashboard ziet als 'uren in te dienen'.

**Waar:** `supervisor job: complete-placements (*/30 * * * *)`
**Let op:** Gebruikt de SQL-klok, niet Node's klok. Idempotent doordat shift_hours.placementId UNIQUE is. FOR UPDATE SKIP LOCKED, dus overlappende ticks kunnen niet dubbel draaien.
<sub>`workers/complete-placements.ts`</sub>

#### Uren-escalatieladder (hours-reminders) ⚫ uit `business_settings['hours_reminders'].enabled (DB-vlag, aan/uit in de UI) + HOURS_REMINDERS_ENABLED="false" als harde noodstop`

*ik wil niet zelf achter chefs en klanten aanbellen als uren blijven hangen*

Dagelijks om 09:00 drie trappen: chef die na 24u/72u nog niet indiende krijgt een duw, klant die na 5 dagen niet tekende krijgt een herinnering, en na 10 dagen krijgt de admin een 'forceer goedkeuring'-mail.

**Waar:** `supervisor job: hours-reminders (0 9 * * *)`
**Let op:** Dit is de ENIGE worker die chefs én klanten over hun eigen regels mailt — daarom bewust standaard uit, zodat hij niet op demo-data losgaat. Idempotent via audit_log-breadcrumbs per (urenregel, trap), geen schemawijziging. Ontvanger van de admin-mail komt uit notification_routes, met MAARTEN_EMAIL als fallback.
<sub>`workers/hours-reminders.ts` · `src/app/(admin)/admin/business/instellingen/page.tsx` · `src/lib/business-settings.ts`</sub>

#### Terugkerende diensten materialiseren 🟢 live

*ik wil vaste wekelijkse diensten één keer instellen en ze daarna vanzelf in het rooster zien verschijnen*

Dagelijks om 04:00 worden uit elke actieve dienst-sjabloon echte diensten gemaakt voor de komende horizon, met overslaan van uitzonderingsdatums. Nachtdiensten die over middernacht lopen komen correct op de volgende dag terecht.

**Waar:** `supervisor job: generate-recurring-shifts (0 4 * * *)`
**Let op:** Alle wandklok→tijdstip-omzetting gebeurt in Postgres via AT TIME ZONE 'Europe/Amsterdam', dus zomertijd klopt. Idempotent via ON CONFLICT (source_template_id, source_template_date). Het adres van de klant wordt bij aanmaak gekopieerd — latere adreswijzigingen herschrijven bestaande diensten niet.
<sub>`workers/generate-recurring-shifts.ts`</sub>

#### Documenten die verlopen bewaken 🟢 live

*ik wil niet ontdekken dat een chef met een verlopen ID op locatie staat*

Dagelijks om 06:00: documenten waarvan de geldigheid voorbij is gaan op 'verlopen' (chef + admin krijgen bericht), en documenten die binnen 30 dagen verlopen leveren een waarschuwing op.

**Waar:** `supervisor job: document-expiry (0 6 * * *)`
**Let op:** De 30-daagse waarschuwing wordt ontdubbeld op 'geen expiry-notificatie in de laatste 30 dagen' — de notificatie zelf is de dedupe-marker.
<sub>`workers/document-expiry.ts`</sub>

#### Outbox leegtrekken (deliver-outbox) 🟠 half af

*ik wil dat externe koppelingen nooit midden in een boeking of goedkeuring vastlopen*

Elke 5 minuten wordt de integratie-outbox geleegd. Interne gebeurtenissen worden afgevinkt (pending→sent); externe leveranciers blijven bewust in de wachtrij staan tot hun koppeling gebouwd is.

**Waar:** `supervisor job: deliver-outbox (*/5 * * * *)` · `/admin/business/integrations (toont outboxPending)`
**Let op:** Alleen provider 'internal' wordt echt afgeleverd. 'payroll'/'csv' blijven pending — dat is bewust een eerlijke 'wacht op integratie'-stapel, geen fout. Er wordt alleen een integration_runs-rij geschreven als er echt werk was, zodat de tabel niet volloopt bij lege ticks.
<sub>`workers/deliver-outbox.ts`</sub>

#### Dagelijkse KPI-momentopname 🟢 live

*ik wil trends per chef en per klant over maanden kunnen terugkijken zonder dat de dashboards traag worden*

Elke nacht om 00:30 wordt per actieve chef en klant één rij per dag weggeschreven met uren, geld, afgeronde diensten, ratings en betrouwbaarheid. Elke periode is daarna een simpele optelsom.

**Waar:** `supervisor job: metrics-snapshot (30 0 * * *)` · `npx tsx workers/metrics-snapshot.ts --backfill=180`
**Let op:** Geld en uren komen ALLEEN uit definitieve urenregels (admin_approved/exported) — nooit uit concepten. Elke maatstaf hangt aan zijn eigen natuurlijke datum, zodat opnieuw draaien exact dezelfde waarde geeft. Ondersteunt --date en een hervatbare --backfill.
<sub>`workers/metrics-snapshot.ts` · `scripts/smoke-metrics-snapshot.mts`</sub>

#### Maandagochtend-samenvatting + dagelijkse foutmail 🟢 live

*ik wil maandag in één mail weten hoe de week ervoor liep, en ik wil het weten als er iets stuk is*

Maandag 08:00 gaat er een weekoverzicht naar Maarten (nieuwe aanmeldingen, bevestigde diensten, open diensten, uren die wachten). Elke dag 07:00 gaat er een foutenoverzicht van de laatste 24 uur naar Jezza — en niets als er geen fouten waren.

**Waar:** `supervisor jobs: weekly-digest (0 8 * * 1), error-digest (0 7 * * *)`
**Let op:** Ontvangers komen rechtstreeks uit MAARTEN_EMAIL / JEZZA_EMAIL (niet uit notification_routes). Niet gezet → de worker slaat zichzelf over. Deze workers gebruiken kale HTML via Resend, geen React-Email-template (die kunnen ze niet importeren).
<sub>`workers/weekly-digest.ts` · `workers/error-digest.ts`</sub>

#### Payingit-uitbetaling (droogloop) 🟠 half af

*ik wil vrijdag weten wat er aan uitbetaling klaarstaat*

Vrijdag 17:00 worden goedgekeurde, nog niet geëxporteerde urenregels opgehaald en als mailsamenvatting naar Maarten gestuurd. Er wordt NIETS naar Payingit verstuurd.

**Waar:** `supervisor job: payingit-sync (0 17 * * 5)`
**Let op:** Bewust een droogloop: de echte push wacht op de Payingit-API-spec (open vraag #1 in MEMORY.md). In de code staat een 'ACTUAL PUSH'-markering waar de koppeling moet landen.
<sub>`workers/payingit-sync.ts`</sub>

#### Bewaartermijn-opruiming (AVG) ⚫ uit `RETENTION_ENABLED (default niet 'true' → doet niets) ÉN RETENTION_DRY_RUN (default niet 'false' → alleen rapporteren)`

*ik wil voldoen aan de bewaarplicht zonder per ongeluk iets weg te gooien wat ik moet bewaren*

Zondag 02:00: zacht-verwijderde chefs, klanten en documenten die hun bewaartermijn voorbij zijn worden echt verwijderd, inclusief de bestanden in R2. Alles met een wettelijke bewaarplicht (urenregels, plaatsingen, ratings) wordt overgeslagen.

**Waar:** `supervisor job: retention (0 2 * * 0)`
**Let op:** De enige harde verwijderaar in het systeem, daarom dubbel op slot; beide vlaggen staan standaard veilig. Werkt alleen op entiteiten die zowel een retention_policies-rij ALS een gecodeerde strategie hebben. Zonder R2-config draait hij alleen-DB. Geen van beide vlaggen staat in env.ts.
<sub>`workers/retention.ts` · `workers/_r2.ts` · `scripts/seed-retention-policies.mjs`</sub>

#### Configureerbare herinneringsregels ⚫ uit `REMINDERS_ENABLED (default uit, gedeclareerd in env.ts en .env.example)`

*ik wil zelf regels kunnen instellen zoals 'waarschuw me 30 dagen voor een verlopend certificaat'*

Dagelijks 06:30 worden alle ingeschakelde herinneringsregels doorgerekend (verjaardag, ID-verloop, certificaat-verloop, inactieve chef) en gaat er mail en/of een in-app bericht naar de ingestelde ontvangers.

**Waar:** `supervisor job: reminders (30 6 * * *)`
**Let op:** Bewust gescheiden van hours-reminders: die is de VASTE urenladder, deze is de GENERIEKE regelmotor. Uren-regels moeten uit reminder_rules blijven, anders sturen beide dubbel. Idempotent via het reminder_sends-grootboek (insert is de poort).
<sub>`workers/reminders.ts`</sub>

#### Beschikbaarheids-herinnering ⚫ uit `business_settings['availability_reminders'].enabled + AVAILABILITY_REMINDERS_ENABLED="false" als noodstop`

*ik wil donderdag automatisch chefs porren om hun beschikbaarheid voor volgende week door te geven*

Donderdag 09:00 krijgen actieve chefs met portaaltoegang een mail plus in-app bericht met de link naar hun beschikbaarheidspagina.

**Waar:** `supervisor job: availability-reminder (0 9 * * 4)`
**Let op:** HALF AF: de sleutel 'availability_reminders' staat NIET in SETTING_KEYS (src/lib/business-settings.ts) en er is geen enkel scherm dat hem schrijft. Aanzetten kan alleen door met de hand een business_settings-rij in de database te zetten. Ontdubbelt op 'geen availability_reminder-notificatie in 6 dagen'.
<sub>`workers/availability-reminder.ts`</sub>

#### Embeddings bijwerken (zoeken op betekenis) 🟢 live `OPENAI_API_KEY (ontbreekt → OBSERVE-modus: telt alleen wat verouderd is, schrijft niets)`

*ik wil kunnen zoeken op 'die chef die laatst bij Okura zat' in plaats van op exacte naam*

Elke nacht om 03:00 worden chefs, klanten en toekomstige diensten waarvan de inhoud veranderde opnieuw omgezet naar een vector, zodat semantisch zoeken actueel blijft.

**Waar:** `supervisor job: embedding-refresh (0 3 * * *)`
**Let op:** Onderhoudt de PER-RIJ embedding-kolommen (voor *.semantic_search) — NIET de gehakte notities-RAG (ai_embeddings), dat is de Vercel-cron rag-ingest. Slaat zacht-verwijderde rijen en diensten in het verleden over. Model text-embedding-3-small, 1536 dim, ~50ms tussen requests.
<sub>`workers/embedding-refresh.ts`</sub>

#### Notities-RAG nachtelijk herindexeren 🟢 live `CRON_SECRET (verplicht) + OPENAI_API_KEY (ontbreekt → 200 met 'embeddings disabled')`

*ik wil dat de assistent weet wat er in notities en feedback staat, zonder dat privacygevoelige gegevens in het model belanden*

Elke nacht om 03:00 (Vercel-cron) worden alle toegestane bronnen opnieuw geïndexeerd: eerst PII wegstrepen, dan in stukken hakken, dan vectoriseren. Slaat over wat inhoudelijk niet veranderde.

**Waar:** `GET /api/cron/rag-ingest (vercel.json cron 0 3 * * *)` · `npx tsx scripts/rag-ingest.mts`
**Let op:** Enige cron die app-side draait zonder Railway-ticker — bewust, want de redact/chunk-pijplijn mag niet gekopieerd worden (docs/ai/rag-ingestion-contract.md). De onderliggende tabel ai_embeddings komt uit drizzle/manual_ai_embeddings.sql en zit NIET in de drizzle-journaal: een verse Neon-branch mist hem stilzwijgend en de nachtelijke ingest faalt dan elke nacht.
<sub>`src/app/api/cron/rag-ingest/route.ts` · `vercel.json` · `scripts/rag-ingest.mts`</sub>

#### Dagstart voor de eigenaar 🟡 live achter vlag `business_settings['daily_briefing'].enabled + .hour (UI-instelbaar; volgens CLAUDE.md sinds 2026-06-10 aan op 07:00)`

*ik wil 's ochtends in één bericht weten wat er gisteren gebeurde en wat er vandaag speelt*

De Railway-taak draait ELK UUR, kijkt in de instellingen welk uur de eigenaar koos, en roept op dat moment de app aan om de dagstart te bouwen en te bezorgen (in-app + mail, met een WhatsApp-haak die klaarligt).

**Waar:** `supervisor job: daily-briefing (0 * * * *)` · `GET /api/cron/daily-briefing`
**Let op:** Het uur wordt DST-correct bepaald via Intl met timeZone Europe/Amsterdam. Dubbel versturen wordt geblokkeerd door lastSentDate in dezelfde instellingen-rij. De eigenaar wordt opgezocht via MAARTEN_EMAIL; geen match → nette no-op.
<sub>`workers/daily-briefing.ts` · `src/app/api/cron/daily-briefing/route.ts` · `scripts/smoke-briefing.mts`</sub>

#### Onboarding-achtervolging 🟡 live achter vlag `ONBOARDING_NUDGE_ENABLED (volgens CLAUDE.md sinds 2026-06-10 LIVE op prod)`

*ik wil dat half-ingevulde chef- en klantprofielen zichzelf achternazitten*

Maandag 09:00 wordt onvolledige onboarding doorgelopen: iedereen krijgt in-app een duwtje met alleen de ONTBREKENDE veldnamen, en Maarten krijgt één samenvatting 'wie mist wat'.

**Waar:** `supervisor job: onboarding-nudge (0 9 * * 1)` · `GET /api/cron/onboarding-nudge`
**Let op:** Alleen in-app berichten, geen uitgaande mail — daarom veilig om dark te lanceren. Throttle van 6 dagen per gebruiker. De lees-modellen geven LABELS terug, nooit de waarden zelf (AVG). De vlag staat niet in env.ts.
<sub>`workers/onboarding-nudge.ts` · `src/app/api/cron/onboarding-nudge/route.ts`</sub>

#### AI-waakhond (beslismomenten) 🟡 live achter vlag `AI_WATCHDOG_ENABLED (volgens CLAUDE.md sinds 2026-06-10 LIVE op prod)`

*ik wil dat het systeem me ongevraagd waarschuwt over dingen die dreigen mis te gaan*

Dagelijks 08:15 draaien drie vaste detectoren: diensten die te lang openstaan, chefs waar het al 30+ dagen stil is, en lage beoordelingen. Elke vondst wordt een melding MET een kant-en-klaar conceptbericht. Er wordt niets automatisch verstuurd.

**Waar:** `supervisor job: ai-watchdog (15 8 * * *)` · `GET /api/cron/ai-watchdog`
**Let op:** De detectoren zijn deterministisch — geen enkele LLM-aanroep, dus voorspelbaar en gratis. Throttle van 6 dagen per entiteit zodat dezelfde vondst niet dagelijks terugzeurt. Niet in env.ts gedeclareerd.
<sub>`workers/ai-watchdog.ts` · `src/app/api/cron/ai-watchdog/route.ts` · `src/lib/ai/read-model/watchdog.ts`</sub>

#### Gesprek→geheugen mijnen ⚫ uit `AI_MEMORY_MINING_ENABLED (nog DARK — CLAUDE.md noemt dit expliciet als 'wacht op eigenaar')`

*ik wil dat wat ik tussen neus en lippen door in de chat zeg niet verdwijnt*

Elke nacht 03:30 worden recente eigenaar-gesprekken door een goedkoop model gehaald om maximaal 3 blijvende feiten per gesprek te vinden. Die worden VOORGESTELD in één melding — nooit automatisch onthouden.

**Waar:** `supervisor job: ai-memory-mining (30 3 * * *)` · `GET /api/cron/ai-memory-mining`
**Let op:** Volgens de memory-notitie ai-reality-audit-remediation is er nog één prod-stap open: migratie 0076 toepassen, dán de vlag omzetten. Max 10 gesprekken per run, 20-uurs throttle per gebruiker. Gebruikt OPENAI_FALLBACK_MODEL of anders gpt-4.1-mini. Niet in env.ts.
<sub>`workers/ai-memory-mining.ts` · `src/app/api/cron/ai-memory-mining/route.ts` · `src/lib/domain/memory-proposals.ts`</sub>

#### Nachtelijk voorplannen (pre-plan) ⚫ uit `AI_PREPLAN_ENABLED (dark)`

*ik wil 's ochtends een rooster aantreffen dat al grotendeels is ingevuld, en alleen nog hoeven goedkeuren*

Dagelijks 05:30 vult de autofill de open plekken van de komende 7 dagen in als CONCEPT — onzichtbaar voor chef en klant. De planner beoordeelt en publiceert 's ochtends.

**Waar:** `supervisor job: ai-preplan (30 5 * * *)` · `GET /api/cron/ai-preplan`
**Let op:** Idempotent doordat al gedekte plekken (inclusief bestaande concepten) worden overgeslagen. Handelt onder de identiteit van de eigenaar (opgezocht via MAARTEN_EMAIL). Niet in env.ts gedeclareerd.
<sub>`workers/ai-preplan.ts` · `src/app/api/cron/ai-preplan/route.ts` · `src/lib/domain/roster-autofill.ts`</sub>

#### CV → profielvoorstellen ⚫ uit `CV_AI_PROFILING_ENABLED (dark; wél gedeclareerd in env.ts)`

*ik wil niet handmatig cv's overtypen in chefprofielen*

Dagelijks 04:30 wordt voor elke chef met een cv geprobeerd gestructureerde profielvelden te herkennen. Die komen als VOORSTELLEN klaar te staan voor beoordeling; er wordt niets toegepast.

**Waar:** `supervisor job: cv-profiling (30 4 * * *)` · `GET /api/cron/cv-profiling`
**Let op:** Maximaal 40 chefs per run vanwege OpenAI-limieten en de 300s maxDuration. Idempotent per CV-versie (sourceHash): al beoordeelde velden worden overgeslagen. Zonder OPENAI_API_KEY nette no-op.
<sub>`workers/cv-profiling.ts` · `src/app/api/cron/cv-profiling/route.ts` · `src/lib/domain/profile-suggestions.ts`</sub>

#### Pushberichten en WhatsApp bezorgen ⚫ uit `WEB_PUSH_ENABLED (+ VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT / NEXT_PUBLIC_VAPID_PUBLIC_KEY) OF CHEF_WHATSAPP_ENABLED (+ SENT_DM_API_KEY)`

*ik wil dat een chef een dienstvoorstel op zijn telefoon voelt, niet pas als hij toevallig inlogt*

Elke 2 minuten wordt de push-wachtrij geleegd naar de telefoons van chefs (VAPID-ondertekend), en dezelfde run bezorgt ook de WhatsApp-berichten. Dode aanmeldingen worden opgeruimd.

**Waar:** `supervisor job: push-deliver (*/2 * * * *)` · `GET /api/cron/deliver-push`
**Let op:** De ticker draait zodra ÉÉN van beide kanalen aan staat, maar de route filtert per kanaal. VAPID_PUBLIC_KEY moet exact gelijk zijn aan NEXT_PUBLIC_VAPID_PUBLIC_KEY. WhatsApp vereist een door Meta goedgekeurde template. Geen VAPID-sleutels in de prod-env-snapshot van 2026-06-09.
<sub>`workers/push-deliver.ts` · `src/app/api/cron/deliver-push/route.ts` · `src/lib/domain/push-subscriptions.ts`</sub>

#### Verlopen dienstvoorstellen signaleren ⚫ uit `OFFER_EXPIRY_SWEEP_ENABLED (dark) · OFFER_EXPIRY_HOURS (default 24) bepaalt wanneer iets 'verlopen' heet`

*ik wil weten wanneer een chef gewoon niet reageert op een voorstel*

Elke 6 uur wordt gekeken welke voorstellen zijn verlopen zonder reactie, op een dienst die nog moet plaatsvinden. De eigenaar krijgt daar één melding per voorstel over.

**Waar:** `supervisor job: offer-expiry (0 */6 * * *)` · `GET /api/cron/offer-expiry`
**Let op:** Puur signaleren: de status van de plaatsing blijft 'proposed', er wordt niets automatisch afgewezen — Maarten blijft de handelende partij. Throttle 6 dagen per plaatsing.
<sub>`workers/offer-expiry.ts` · `src/app/api/cron/offer-expiry/route.ts`</sub>

#### Uitklok-overzicht voor de eigenaar ⚫ uit `CLOCKOUT_DIGEST_ENABLED (dark; gedeclareerd in env.ts)`

*ik wil één keer per dag zien welke diensten uitliepen of een opmerking kregen*

Dagelijks 08:00 wordt gepland-versus-werkelijk en de uitklok-signalen (geen pauze, extra uren, komt niet terug, vrije opmerking) samengevat in ÉÉN melding voor de eigenaar.

**Waar:** `supervisor job: clockout-digest (0 8 * * *)` · `GET /api/cron/clockout-digest (ook als Vercel-cron in vercel.json)`
**Let op:** DUBBEL INGEPLAND: staat zowel in supervisor.ts als in vercel.json crons, allebei op 0 8 * * *. Onschadelijk (20-uurs throttle op een bestaande melding van dezelfde dag kort-sluit de tweede), maar het is dubbel werk en dubbele logs. Alleen-eigenaar, geen chef/klant-mail.
<sub>`workers/clockout-digest.ts` · `src/app/api/cron/clockout-digest/route.ts` · `src/lib/ai/read-model/clockout-signals.ts`</sub>

#### Herinneringen vlak voor een dienst ⚫ uit `SHIFT_REMINDERS_ENABLED (dark; gedeclareerd in env.ts)`

*ik wil dat een chef niet vergeet dat hij vanavond ergens moet staan*

Elke 15 minuten wordt gekeken welke bevestigde diensten binnen ~24 uur, ~2 uur of ~15 minuten starten; de chef krijgt per trap één herinnering (altijd in-app, push bij de twee urgente trappen).

**Waar:** `supervisor job: shift-reminders (*/15 * * * *)` · `GET /api/cron/shift-reminders (ook als Vercel-cron in vercel.json)`
**Let op:** DUBBEL INGEPLAND, net als clockout-digest: supervisor.ts én vercel.json, beide */15. Alleen de MEEST urgente openstaande trap wordt verstuurd, zodat een laat bevestigde dienst geen achterhaalde 24-uurs herinnering krijgt. Ontdubbeling via audit_log-breadcrumbs, geen schemawijziging.
<sub>`workers/shift-reminders.ts` · `src/app/api/cron/shift-reminders/route.ts` · `scripts/smoke-chef-shift-reminders.mjs`</sub>

#### Omgevingsvariabelen valideren bij opstarten 🟠 half af

*ik wil dat een vergeten instelling meteen luid stukgaat, niet stilletjes een 500 geeft op een dinsdagavond*

Bij het laden van de app worden alle serversleutels en publieke sleutels gecontroleerd op vorm (lengte, url, e-mail, prefix). Ontbreekt of klopt er iets niet, dan crasht de app met een leesbare lijst in plaats van later een raadselachtige fout te geven.

**Waar:** `import { env } from "@/lib/env"`
**Let op:** Alleen sleutels die in het schema staan worden gevalideerd. Zeker 15 operationeel belangrijke variabelen worden elders rechtstreeks via process.env gelezen en dus NIET gevalideerd of gecatalogiseerd: ONBOARDING_NUDGE_ENABLED, AI_WATCHDOG_ENABLED, AI_MEMORY_MINING_ENABLED, AI_PREPLAN_ENABLED, PLANNER_AI_ENABLED, AVG_CONSENT_ENFORCED, HOURS_REMINDERS_ENABLED, AVAILABILITY_REMINDERS_ENABLED, RETENTION_ENABLED, RETENTION_DRY_RUN, RESEND_WEBHOOK_SECRET, RESEND_INBOUND_SECRET, JOTFORM_WEBHOOK_SECRET, NEXT_PUBLIC_MAARTEN_PHONE, RAWPAYLOAD_REDACT_ENABLED/_DRY_RUN. Ook: het clientSchema kent maar 4 NEXT_PUBLIC_-sleutels; NEXT_PUBLIC_MAARTEN_PHONE zit er niet bij hoewel een client-component hem leest.
<sub>`src/lib/env.ts` · `.env.example`</sub>

#### Feature-vlaggen als dark-launch-mechanisme 🟢 live `~35 *_ENABLED vlaggen in env.ts + 3 DB-vlaggen in business_settings (hours_reminders, daily_briefing, money_assumptions)`

*ik wil nieuwe functies op productie kunnen zetten zonder dat ze meteen iets doen richting chefs of klanten*

Elke nieuwe functie met bijwerkingen komt met een eigen aan/uit-schakelaar die standaard uit staat, en de schakelaar wordt op twee plekken gecontroleerd (de planner én het eindpunt). Aanzetten is een instelling wijzigen, geen code deployen.

**Waar:** `Vercel project → Environment Variables` · `Railway service → Variables` · `/admin/business/instellingen (voor de DB-vlaggen)`
**Let op:** Er zijn DRIE soorten vlaggen door elkaar: env-vlaggen in env.ts, env-vlaggen die alleen via process.env gelezen worden, en DB-vlaggen in business_settings. Er bestaat geen enkel scherm of script dat laat zien wat er NU op productie aan staat — de enige bron is prozatekst in CLAUDE.md/MEMORY.md. Matching-vlaggen (MATCHING_PREFS/RELIABILITY/FAVORITES/TAGS/MARGIN_GUARD) staan allemaal uit, dus de live rangschikking van kandidaten is nog de kale versie.
<sub>`src/lib/env.ts` · `src/lib/business-settings.ts` · `CLAUDE.md`</sub>

#### Per-PR smoke-scripts (het handmatige testnet) 🟢 live

*ik wil bewijs dat een verandering werkt, ook zonder een testsuite*

Voor bijna elke geleverde PR staat er een script in scripts/ dat de kern-aannames narekent en '12/12 groen' afdrukt. Grofweg: pure logica-checks zonder database (labels, statussen, berekeningen), lees-model-checks tegen een Neon-kloon, en 'faithful refactor'-vergelijkingen die bewijzen dat een verplaatsing niets veranderde.

**Waar:** `npx tsx scripts/smoke-<naam>.mts` · `node scripts/smoke-<naam>.mjs` · `npx tsx --env-file=.env.local scripts/smoke-ai-*.mts`
**Let op:** ~100 scripts, geen van alle in CI — puur handwerk, en er is geen runner die ze allemaal draait. Sommige (smoke-extract-*, smoke-monolith-consolidation, smoke-form-adoption) vergelijken tegen een SMOKE_BASE-git-ref die default op een inmiddels gemergde feature-branch staat (bijv. origin/feat/monolith-consolidation) — die zijn effectief verlopen. Scripts die de DB importeren moeten .ts heten, niet .mts (tsx-bug, zie memory).
<sub>`scripts/smoke-tx-atomicity.mts` · `scripts/smoke-rbac-guards.ts` · `scripts/smoke-avg-erasure.mts`</sub>

#### AI-eval als vangnet tegen modelregressie 🟢 live `OPENAI_API_KEY (repo-secret) · OPENAI_MODEL wordt in CI vastgepind op gpt-5.4 · EVAL_DELAY_MS=2000 tegen TPM-limieten`

*ik wil dat de assistent niet stilletjes gevaarlijker wordt als het model of de prompt verandert*

Een harnas stelt het echte model realistische vragen en controleert twee dingen: kiest het het juiste gereedschap (ook bij typfouten en vage vragen), en weigert het gevaarlijke opdrachten zoals 'keur alles goed' of 'annuleer alle diensten'. Draait automatisch op elke PR die AI-code raakt.

**Waar:** `npx tsx --env-file=.env.local scripts/eval-ai.mts` · `GitHub Actions workflow 'ai-eval' (pull_request op src/lib/ai/**, scripts/eval-ai*.mts)`
**Let op:** AANTAL KLOPT NIET: CLAUDE.md en .claude/rules/ai-work.md zeggen '66-case eval'; de code heeft 100 cases (67 GOLDEN + 13 CHAOS + 4 MULTI + 16 SAFETY) en de workflow-comment zegt '~63'. Kosten en TPM-druk zijn dus 1,5x hoger dan gedocumenteerd. De eval draait alleen de PLANNING-stap (één modelaanroep per case, geen tool-uitvoering, geen DB) — daarom zijn alle env-waarden in CI vormgeldige dummy's behalve de OpenAI-sleutel. Faalt hij, dan wordt hij één keer opnieuw gedraaid (cases kunnen flakeren). Let op de quota-valkuil uit memory: 'exceeded quota' is een facturatieprobleem, geen regressie.
<sub>`scripts/eval-ai.mts` · `scripts/eval-ai-answers.mts` · `.github/workflows/ai-eval.yml`</sub>

#### AI-registry- en veiligheidssmokes 🟢 live

*ik wil zeker weten dat elk AI-gereedschap netjes gedefinieerd en correct afgeschermd is*

Drie scripts controleren zonder modelaanroepen dat elk gereedschap een unieke naam heeft, een bestaande rechtenregel, de juiste risicoklasse en bevestigingspoort, en dat de tokentelling en kostenberekening kloppen.

**Waar:** `npx tsx --env-file=.env.local scripts/smoke-ai-tools.mts` · `… scripts/smoke-ai-safety.mts` · `… scripts/smoke-ai-spine.mts`
**Let op:** Deze zijn de 'levende telling' van het aantal tools. In src/lib/ai/tools/*.ts staan 108 unieke tool-namen; CLAUDE.md zegt '~90 tools' en MEMORY.md noemt op verschillende plekken 34 en 76. Draaien ze niet in CI — alleen de eval doet dat.
<sub>`scripts/smoke-ai-tools.mts` · `scripts/smoke-ai-safety.mts` · `scripts/smoke-ai-spine.mts`</sub>

#### Productie-rooktest over HTTP 🟢 live

*ik wil na een deploy in 20 seconden weten of de site echt overeind staat*

Een shellscript vuurt 19 controles af op de live URL: renderen de publieke pagina's, blokkeren de auth-poorten ongeauthenticeerd verkeer, zijn de herstelroutes bereikbaar, en zegt /api/health dat de database ok is.

**Waar:** `bash scripts/smoke-prod.sh [BASE_URL]` · `GET /api/health`
**Let op:** MEMORY.md noemt '17 HTTP-level checks', het script doet er 19. Default-URL is https://chefandserve2.vercel.app. /api/health geeft geen geheimen of persoonsgegevens terug, alleen 'is bereikbaar + geconfigureerd'-booleans, en 503 als de database-ping faalt.
<sub>`scripts/smoke-prod.sh` · `src/app/api/health/route.ts`</sub>

#### Wekelijkse Neon-backup + maandelijkse herstel-oefening 🟢 live `AGE_PUBLIC_KEY (optioneel — zonder deze sleutel is de dump ONVERSLEUTELD op schijf)`

*ik wil niet ontdekken dat mijn backup niet werkt op het moment dat ik hem nodig heb*

Elke maandag 03:00 maakt de Mac Mini via launchd een pg_dump van de productiedatabase, gzipt hem, versleutelt hem optioneel, berekent een controlegetal, schrijft een backup_runs-rij en bewaart 12 weken. Een tweede script zet de nieuwste backup terug in een Neon-testbranch en legt het resultaat vast in restore_drills.

**Waar:** `bash scripts/backup-install.sh (eenmalig)` · `bash scripts/backup-neon.sh` · `bash scripts/restore-drill.sh`
**Let op:** Draait op een LOKALE Mac, niet in de cloud — staat de Mac uit, dan is er die week geen backup en merk je dat nergens. Leest de verbindingsgegevens uit .env.local (dus: de branch die daar staat, meestal DEV). Logt de connectiestring nooit. Vereist pg_dump (brew libpq) en voor de hersteloefening neonctl.
<sub>`scripts/backup-neon.sh` · `scripts/restore-drill.sh` · `scripts/backup-install.sh`</sub>

#### Nood-CLI's en eenmalige klussen 🟢 live `DEMO_OWNER_PASSWORD · CLEAN_ROSTER_DEMO_CONFIRM · ALLOW_PROD_DEMO_CLEANUP · RAWPAYLOAD_REDACT_ENABLED/_DRY_RUN`

*ik wil eruit kunnen als iemand zichzelf buitensluit of als er per ongeluk gevoelige data is binnengekomen*

Losse, bewust omslachtige scripts voor uitzonderingssituaties: 2FA resetten voor een interne gebruiker, demo-eigenaars aanmaken, testportalen zaaien, BSN-achtige velden uit ruwe formulierpayloads scannen en wissen, coördinaten bijwerken, en demo-rommel archiveren.

**Waar:** `tsx scripts/reset-internal-2fa.ts <email> --confirm` · `tsx scripts/provision-demo-owners.ts` · `npx tsx scripts/audit-rawpayload-pii.mts`
**Let op:** Allemaal droogloop-tenzij-bevestigd: zonder --confirm of de juiste omgevingsvariabele doen ze niets. clean-roster-demo weigert bij NODE_ENV=production tenzij ALLOW_PROD_DEMO_CLEANUP=1, en archiveert alleen (verwijdert nooit). 2FA-reset zet permissions_version op, wist de sleutel én de herstelcodes — alle apparaten vliegen eruit. replay-erasure-tombstones is het vangnet als een backup-restore verwijderde persoonsgegevens weer terugbrengt.
<sub>`scripts/reset-internal-2fa.ts` · `scripts/provision-demo-owners.ts` · `scripts/audit-rawpayload-pii.mts`</sub>

#### Binnenkomende webhooks (Resend, Jotform) 🟠 half af `RESEND_WEBHOOK_SECRET · RESEND_INBOUND_SECRET (nog niet gezet → route geeft 503) · JOTFORM_WEBHOOK_SECRET (optioneel)`

*ik wil dat mail-statussen en aanmeldformulieren vanzelf binnenkomen, zonder dat iemand kan doen alsof hij Resend is*

Drie externe ingangen: Resend meldt of een mail is afgeleverd/geopend, Resend levert BINNENKOMENDE mail af (svix-ondertekend), en Jotform levert chef-/klantaanmeldingen. De ondertekening wordt gecontroleerd vóórdat er iets verwerkt wordt; de ruwe payload wordt bewaard met een vlaggetje of de handtekening klopte.

**Waar:** `POST /api/webhooks/resend` · `POST /api/webhooks/resend-inbound` · `POST /api/intake/chef`
**Let op:** RESEND_INBOUND_SECRET staat in CLAUDE.md nog als 'dark, wacht op eigenaar' (moet in het Resend-dashboard gezet worden), dus binnenkomende mail wordt op productie nog niet verwerkt. Geen van deze drie geheimen staat in env.ts. Inhoud van binnenkomende mail is DATA, nooit instructies — inbound.list geeft bewust geen berichttekst terug.
<sub>`src/app/api/webhooks/resend/route.ts` · `src/app/api/webhooks/resend-inbound/route.ts` · `src/lib/intake/handler.ts`</sub>

#### Deploy-configuratie (Vercel) 🟢 live

*ik wil dat de site in Europa draait en standaard veilige headers meestuurt*

vercel.json pint de regio op Frankfurt, zet beveiligingsheaders op alle routes (clickjacking, MIME-sniffing, referrer, HSTS met preload), cachet afbeeldingen een jaar, en definieert drie native Vercel-crons.

**Waar:** `vercel.json`
**Let op:** HSTS staat op 2 jaar mét preload — dat is lastig terug te draaien. Twee van de drie Vercel-crons (shift-reminders, clockout-digest) staan óók in de Railway-supervisor, dus die vuren dubbel.
<sub>`vercel.json`</sub>

#### Productie-migraties toepassen 🟢 live

*ik wil een databasewijziging op productie zetten zonder per ongeluk de ontwikkelomgeving te migreren*

Een vast recept: eerst de productie-env ophalen, dan CONTROLEREN dat de databasehost 'ep-icy-scene' is (ontwikkel is 'ep-green-mouse'), dan pas migreren, en achteraf in information_schema verifiëren dat het object er echt is.

**Waar:** `npm run db:generate -- --name X` · `npm run db:migrate` · `npx vercel env pull /tmp/cs-prod.env --environment=production`
**Let op:** De voetangel: drizzle.config.ts laadt hard .env.local, en dotenv OVERSCHRIJFT geen shell-variabelen — alleen DATABASE_URL exporteren migreert stilletjes DEV. Bovendien kan drizzle-kit 'applied successfully' printen zonder de DDL echt aan te maken (zie memory-notitie); altijd via een rauwe verbinding verifiëren. drizzle/manual_*.sql zit NIET in het journaal en moet met de hand per branch worden toegepast.
<sub>`.claude/rules/db-and-migrations.md` · `drizzle/meta/_journal.json` · `scripts/apply-ai-embeddings.mts`</sub>

#### Verificatie vóór elke PR 🟠 half af

*ik wil niet dat er iets rood op productie belandt*

De afspraak is: type-check, lint en build lokaal groen; bij worker-wijzigingen ook een aparte TypeScript-controle in workers/; bij AI-wijzigingen de drie AI-smokes plus de eval. Daarna pas branchen, met pathspec committen, PR, squash-merge, en verifiëren dat Vercel prod op Ready staat.

**Waar:** `npm run type-check && npm run lint && npm run build` · `cd workers && npx tsc --noEmit`
**Let op:** Niets hiervan wordt afgedwongen: de enige CI-workflow is ai-eval.yml, en die draait alleen op PR's die src/lib/ai/** of de eval-scripts raken. Type-check, lint en build zijn puur handwerk. Aanvullend uit memory: de 'Vercel'-check op PR's faalt altijd (geen preview-env) — negeren; en een squash-merge kan leeg landen, dus na mergen grep je op origin/main naar een marker.
<sub>`package.json` · `workers/tsconfig.json` · `CLAUDE.md`</sub>

> **Gaten in dit gebied**
> - Worker-telling klopt nergens: workers/supervisor.ts heeft 23 JOBS, CLAUDE.md zegt '17 cron workers', en de tabel in MEMORY.md (regel ~511) noemt er 13 — inclusief een 'workers/payroll-export.ts' die niet bestaat, en zonder de 10 nieuwste (daily-briefing, onboarding-nudge, ai-watchdog, ai-memory-mining, ai-preplan, cv-profiling, push-deliver, offer-expiry, clockout-digest, shift-reminders). Ook de 
> - Eval-telling klopt niet: CLAUDE.md én .claude/rules/ai-work.md zeggen '66-case eval'; scripts/eval-ai.mts heeft 100 cases (GOLDEN 67 + CHAOS 13 + MULTI 4 + SAFETY 16) en .github/workflows/ai-eval.yml raamt '~63 plan calls'. De echte CI-kosten en TPM-druk liggen dus ~1,5x hoger dan gedocumenteerd.
> - Dubbele planning: shift-reminders en clockout-digest staan zowel in workers/supervisor.ts als in vercel.json crons, op exact hetzelfde schema. Beide eindpunten zijn idempotent/throttled dus het is niet schadelijk, maar het verdubbelt aanroepen en logregels en niemand documenteert welke van de twee de bedoelde is.
> - business_settings['availability_reminders'] is half af: workers/availability-reminder.ts leest die sleutel, maar hij staat niet in SETTING_KEYS in src/lib/business-settings.ts en geen enkel scherm schrijft hem. De worker kan alleen aan door met de hand een rij in de database te zetten.
> - ~15 operationeel belangrijke env-variabelen worden via rauwe process.env gelezen en staan NIET in src/lib/env.ts — waaronder vier van de AI-cron-poorten (ONBOARDING_NUDGE_ENABLED, AI_WATCHDOG_ENABLED, AI_MEMORY_MINING_ENABLED, AI_PREPLAN_ENABLED) plus PLANNER_AI_ENABLED, AVG_CONSENT_ENFORCED, HOURS_REMINDERS_ENABLED, AVAILABILITY_REMINDERS_ENABLED, RETENTION_ENABLED/_DRY_RUN en de drie webhook-geh
> - MEMORY.md's env-sectie (regel ~471) wijkt af van de code: hij noemt 'TURNSTILE_SECRET_KEY' (code leest TURNSTILE_SECRET, src/lib/turnstile.ts:31) en 'R2_ACCOUNT_ID' (env.ts kent alleen R2_ENDPOINT/R2_PUBLIC_URL), en noemt RESEND_WEBHOOK_SECRET + AVG_CONSENT_ENFORCED nog als 'coming with this plan' terwijl beide al in de code gelezen worden.
> - Er is geen enkele manier om te controleren welke vlaggen NU op productie aan staan. De prod-env-snapshot in het repo (.env.prod.pull, 2026-06-09) bevat GEEN enkele feature-vlag, geen TURNSTILE_SECRET, geen VAPID-sleutels, geen AI_DAILY_BUDGET en geen OPENAI_FALLBACK_MODEL — hij dateert van vóór de in CLAUDE.md geclaimde flip van 2026-06-10. De enige bron voor 'wat staat aan' is prozatekst. Aanbeve
> - CI dekt vrijwel niets: .github/workflows/ bevat alleen ai-eval.yml, dat alleen triggert op src/lib/ai/**, scripts/eval-ai*.mts en zichzelf. Type-check, lint, build, de ~100 smoke-scripts en de workers-tsc draaien nergens automatisch. Een PR die alleen src/app/** of workers/** raakt heeft geen enkele geautomatiseerde poort.

### Hoe het systeem met mensen praat

#### Chef voorgesteld voor een dienst 🟢 live `DND_DURING_SHIFT_ENABLED (niet-storen tijdens dienst) — default uit; WhatsApp-deel apart gated`

*ik wil dat een chef een aanbod krijgt én dat de klant ziet wie we voorstellen*

Zodra een plaatsing op 'proposed' komt (handmatig voorstellen óf een concept-week publiceren) krijgt de chef een aanbiedingsmail met klant, rol, tijd, plaats, tarief en notitie plus een accepteer-knop, én een bel-melding op de telefoon. De klant krijgt tegelijk de 'voorgestelde chef'-mail met vakniveau en ervaring en kan reageren met een opmerking (geen vetorecht). Als de chef op dat moment zelf midden in een dienst zit wordt hij niet gebuzzd (alleen de bel, geen push/WhatsApp).

**Waar:** `sendProposalNotifications() — aangeroepen bij proposePlacement en bij publishDraftsForPeriod` · `/admin/business/shifts/[id] (chef voorstellen)` · `planbord: week publiceren`
**Let op:** Dit is het ENIGE punt in de hele codebase waar een WhatsApp-bericht wordt aangevraagd (template chef_nieuwe_dienst). De klant-mail gaat via recipientsForClient(..., 'chef_proposed') en kan door de klant uitgezet worden — dan gaat er geen mail, alleen de bel.
<sub>`src/lib/domain/matching.ts` · `src/emails/ShiftProposedEmail.tsx` · `src/emails/ChefProposedKlantEmail.tsx`</sub>

#### Dienst definitief bevestigd 🟢 live

*ik wil dat chef én klant zwart-op-wit hebben dat het rond is*

Bij het bevestigen van een plaatsing krijgt de chef een bevestigingsmail met locatie, contactpersoon en telefoonnummer plus de instructie wat te doen bij verhindering; de klant krijgt een bevestiging met de naam, het vakniveau en de ervaring van de chef.

**Waar:** `confirmPlacement() in placement-transition.ts` · `/admin/business/shifts/[id] — bevestig-actie`
**Let op:** Er zijn TWEE plekken die deze mails versturen: de domeinfunctie confirmPlacement() en de shift-detailpagina zelf (met bijna identieke onderwerpregels). Bij tekstwijziging beide aanpassen.
<sub>`src/lib/domain/placement-transition.ts` · `src/emails/ShiftConfirmedChefEmail.tsx` · `src/emails/ShiftConfirmedClientEmail.tsx`</sub>

#### Weekplanning gepubliceerd 🟢 live

*ik wil dat iedereen in één mail de hele week ziet, met agenda-bestand*

Als de planner een week publiceert krijgt elke chef één mail met al zijn diensten (adres, contactpersoon, telefoon, details) en de klant één mail met de diensten plus de voorgestelde chef en diens telefoonnummer. Beide met een .ics-bijlage zodat het in de agenda kan.

**Waar:** `publishDraftsForPeriod() — planbord 'Publiceer week'`
**Let op:** De klantversie bevat bewust alleen klant-veilige velden (AVG) — geen interne notities. De klant-mail loopt via het 'chef_proposed'-kanaal, dus een klant die die categorie uitzet mist ook de weekplanning.
<sub>`src/lib/domain/roster-publish.ts` · `src/emails/ChefWeekPlanningEmail.tsx` · `src/emails/KlantWeekPlanningEmail.tsx`</sub>

#### Chef annuleert een bevestigde dienst 🟢 live

*ik wil dat de klant het meteen weet en dat kantoor in actie komt*

Annuleert een chef een al bevestigde dienst, dan gaat er direct een mail naar de klant met de reden en de geruststelling dat we vervanging zoeken (urgenter naarmate de dienst dichterbij is), plus een aparte interne mail naar kantoor.

**Waar:** `/chef/shifts/[placementId] — annuleer-actie`
**Let op:** De klant-mail gaat via het 'generic'-kanaal en is dus NIET uit te zetten door de klant — bewust, want dit is operationeel kritiek.
<sub>`src/app/(chef)/chef/shifts/[placementId]/page.tsx` · `src/emails/ShiftCancelledByChefClientEmail.tsx`</sub>

#### Uren ingediend — klant moet tekenen 🟢 live

*ik wil dat de klant weet dat er uren klaarstaan om af te tekenen*

Dient de chef zijn gewerkte uren in, dan krijgt het klantcontact een mail met de geplande tijden naast de daadwerkelijk ingevulde tijden, pauze, totaal en verwacht bedrag, plus een teken-knop.

**Waar:** `/chef/hours/[placementId] — uren indienen`
<sub>`src/app/(chef)/chef/hours/[placementId]/page.tsx` · `src/emails/HoursSubmittedKlantEmail.tsx`</sub>

#### Klant tekent de uren 🟢 live

*ik wil dat de chef gerustgesteld is en dat ik weet dat ik moet keuren*

Tekent de klant, dan krijgt de chef een 'je uren zijn ondertekend, wij controleren ze nu'-mail (geen actie nodig) en krijgt kantoor een mail met chefkosten, klantomzet én marge plus een keur-knop.

**Waar:** `/client/shifts/[shiftId]/hours — teken-actie`
**Let op:** De interne mail bevat marge-informatie — die ontvangerlijst loopt via recipientsFor('hours_signed'), instelbaar in /admin/system/notifications.
<sub>`src/app/(client)/client/shifts/[shiftId]/hours/page.tsx` · `src/emails/HoursSignedChefEmail.tsx` · `src/emails/HoursSignedAdminEmail.tsx`</sub>

#### Klant keurt de uren af 🟢 live

*ik wil dat de chef zijn uren corrigeert zonder dat ik ertussen hoef te zitten*

Keurt de klant de ingediende uren af, dan krijgt de chef een mail met de opmerking van de klant erbij en een knop om de uren aan te passen.

**Waar:** `/client/shifts/[shiftId]/hours — afkeur-actie`
<sub>`src/app/(client)/client/shifts/[shiftId]/hours/page.tsx` · `src/emails/HoursRejectedByKlantChefEmail.tsx`</sub>

#### Kantoor keurt de uren goed 🟢 live

*ik wil dat de chef weet dat hij betaald wordt, de klant dat de factuur komt, en dat ik feedback krijg*

Bij de definitieve goedkeuring gaan er drie mails uit: chef ('goedgekeurd — wordt uitbetaald'), klant ('afgerond — factuur volgt binnen 5 werkdagen') en een uitnodiging aan de klant om feedback over de chef te geven.

**Waar:** `approveHours() in hours.ts` · `/admin/business/hours/[id] — goedkeuren`
**Let op:** In de feedback-mail staat bewust altijd 'feedback', nooit 'review' of 'beoordeling'. Het feedbackverzoek is wél uitzetbaar door de klant ('rating_pending'), de goedkeuringsmail niet.
<sub>`src/lib/domain/hours.ts` · `src/emails/HoursApprovedChefEmail.tsx` · `src/emails/HoursApprovedKlantEmail.tsx`</sub>

#### Kantoor zet ondertekende uren terug 🟢 live

*ik wil een fout in al-getekende uren kunnen terugdraaien en beide partijen netjes informeren*

Eén template met twee ontvangers: de chef krijgt hem met een aanpas-knop, de klant ter informatie — de aanhef en de call-to-action schakelen op de rol van de ontvanger.

**Waar:** `rejectSignedHours() in hours.ts (twee sends)` · `/admin/business/hours/[id]`
<sub>`src/lib/domain/hours.ts` · `src/emails/HoursRejectedByAdminEmail.tsx`</sub>

#### Uren-herinneringen en escalatie ⚫ uit `DB-instelling business_settings['hours_reminders'] — default UIT (geen rij = uit)`

*ik wil niet zelf achter uren aan hoeven bellen*

Een dagelijkse ladder in drie tredes: +24u en +72u een (steeds stelliger) herinnering aan de chef die zijn uren niet invulde; +5 dagen een herinnering aan de klant om te tekenen; +10 dagen een alarm naar kantoor dat er geforceerd goedgekeurd moet worden. Elke trede vuurt hooguit één keer per urenregel.

**Waar:** `workers/hours-reminders.ts (dagelijks 09:00)` · `AI-tool hours.send_reminder (handmatig via de assistent)`
**Let op:** De automatische worker stuurt platte tekstmail (sendPlainEmail uit workers/_lib), NIET de mooie HoursReminder-templates. Alleen als de assistent de herinnering stuurt krijg je de huisstijl-mail. Twee verschillende looks voor hetzelfde bericht.
<sub>`workers/hours-reminders.ts` · `src/lib/ai/actions/send-hours-reminder.ts` · `src/emails/HoursReminderChefEmail.tsx`</sub>

#### Herinnering vlak vóór de dienst ⚫ uit `SHIFT_REMINDERS_ENABLED — default uit`

*ik wil dat een chef niet vergeet dat hij vanavond moet werken*

Kijkt elk kwartier naar bevestigde diensten en stuurt de chef een melding op ~24 uur, ~2 uur en ~15 minuten voor aanvang. Altijd in de app; bij de 2-uur- en start-trede ook een push naar de telefoon. Alleen de meest urgente openstaande trede vuurt, dus een laat bevestigde dienst krijgt geen achterhaalde 24-uursmelding.

**Waar:** `GET /api/cron/shift-reminders (ticker workers/shift-reminders.ts, elke 15 min)`
**Let op:** Alleen in-app/push, géén e-mail. Alleen naar de chef, niet naar de klant.
<sub>`src/app/api/cron/shift-reminders/route.ts`</sub>

#### Beschikbaarheids-herinnering aan chefs ⚫ uit `business_settings['availability_reminders'].enabled — default uit; AVAILABILITY_REMINDERS_ENABLED="false" is een harde noodstop`

*ik wil op tijd weten wie volgende week kan*

Donderdagochtend een mail plus bel-melding aan actieve chefs met portaaltoegang om hun beschikbaarheid voor volgende week in te vullen, zodat er in het weekend gepland kan worden. Slaat chefs over die de afgelopen 6 dagen al zo'n melding kregen.

**Waar:** `workers/availability-reminder.ts (donderdag 09:00)` · `AI-actie send-availability-reminder`
<sub>`workers/availability-reminder.ts` · `src/lib/ai/actions/send-availability-reminder.tsx`</sub>

#### Factuur naar de klant 🟢 live

*ik wil de factuur digitaal bij de juiste inbox krijgen*

Stuurt de factuurmail met factuurnummer, periode, factuur- en vervaldatum, alle regels, subtotaal, btw en totaal, plus een link naar de factuur in het klantportaal. Weigert te versturen als de factuur al betaald of vervallen is, of als er geen ontvanger bekend is.

**Waar:** `sendInvoiceEmail() in invoicing.ts — vanuit het facturatiescherm`
**Let op:** Gaat via recipientsForClient(..., 'invoice_sent') → dat kiest bij voorkeur het finance-contact, en anders het facturatie-adres van de klant in plaats van het algemene adres. Niet uitzetbaar door de klant.
<sub>`src/lib/domain/invoicing.ts` · `src/emails/InvoiceKlantEmail.tsx`</sub>

#### Wijzigings- of annuleringsverzoek van de klant 🟢 live

*ik wil dat een klant niet zomaar een bevestigde dienst kan omgooien, maar het wel kan aanvragen*

Vraagt een klant een wijziging of annulering aan op een bevestigde dienst, dan gaat er een interne mail naar kantoor (met reden en link naar het admin-scherm). Zodra Chef & Serve beslist krijgt de klant een uitkomst-mail (doorgevoerd of niet, met toelichting). Trekt de klant het verzoek zelf in, dan gaat daar ook een interne mail over. Bij een doorgevoerde annulering krijgt de ingeplande chef een 'shift geannuleerd'-mail.

**Waar:** `/client/shifts/[shiftId] — wijziging/annulering aanvragen` · `createClientShiftChangeRequest() / decideClientShiftChangeRequest()`
<sub>`src/lib/domain/shift-change-requests.tsx` · `src/emails/ClientChangeRequestAdminEmail.tsx` · `src/emails/ClientChangeRequestOutcomeKlantEmail.tsx`</sub>

#### Opmerking van de klant bij een voorgestelde chef 🟢 live

*ik wil weten wanneer een klant twijfelt over een voorgestelde chef, vóór ik bevestig*

Plaatst de klant op de shift-hub een opmerking bij de voorgestelde chef, dan krijgt kantoor daar een mail over. Zo hoor je bezwaren voordat de plaatsing definitief wordt.

**Waar:** `/client/shifts/[shiftId] — opmerking plaatsen`
**Let op:** Geen eigen template — de mail wordt inline opgebouwd, dus hij ziet er soberder uit dan de rest.
<sub>`src/app/(client)/client/shifts/[shiftId]/page.tsx`</sub>

#### Toegang tot het portaal — uitnodiging, inloglink, accountherstel 🟢 live

*ik wil dat mensen binnenkomen zonder wachtwoordgedoe*

Drie mails rond toegang: een welkomstmail met inloglink wanneer een chef, klant of medewerker portaaltoegang krijgt (de tekst schakelt op het type ontvanger); een magic-link inlogmail (15 minuten geldig, eenmalig); en een herstelmail voor interne medewerkers die hun wachtwoord of 2FA kwijt zijn.

**Waar:** `portal-invites.ts — gebruiker activeren/uitnodigen` · `Auth.js magic-link login` · `requestRecovery() + /auth herstelroute`
**Let op:** Deze drie gaan bewust NOOIT via WhatsApp — inlog- en 2FA-links horen op e-mail te blijven.
<sub>`src/lib/domain/portal-invites.ts` · `src/lib/auth.ts` · `src/lib/domain/recovery.ts`</sub>

#### Ontbrekende profielgegevens opvragen bij een chef 🟢 live

*ik wil een chef laten aanvullen wat ik mis, zonder zelf te bellen*

Kantoor vinkt aan welke gegevens ontbreken; de chef krijgt een mail met precies die lijst (alleen de labels, niet de waarden) en een link naar een invulformulier.

**Waar:** `createProfileDataRequest() — vanuit de chef-detailpagina in admin`
<sub>`src/lib/domain/profile-data-requests.ts` · `src/emails/ProfileDataRequestEmail.tsx`</sub>

#### Signalen vanuit formulieren en portalen naar kantoor 🟢 live

*ik wil dat er niets binnenkomt zonder dat ik het merk*

Verzamelbak van interne meldingen: een nieuwe chef-aanmelding, een nieuwe klant-aanvraag, een bericht via het contactformulier op de site, een chef die een profielwijziging aanvraagt, een klant die een profiel- of shift-template-wijziging aanvraagt. Allemaal een mail naar kantoor met een link naar het admin-scherm.

**Waar:** `publiek aanmeld-/contactformulier` · `/chef/profile — wijziging aanvragen` · `/client/profile en /client/templates — wijziging aanvragen`
**Let op:** Geen van deze heeft een eigen React-template; de inhoud wordt inline opgebouwd. Ze staan dus ook niet in de copywriter-gids en zijn niet centraal te herschrijven.
<sub>`src/lib/domain/applications.ts` · `src/lib/domain/client-requests.ts` · `src/lib/domain/contact-messages.ts`</sub>

#### Privacyverzoeken (AVG) 🟢 live

*ik wil een inzage- of verwijderverzoek netjes en binnen de wettelijke termijn afhandelen*

Drie mails: kantoor krijgt bericht dat er een verzoek binnenkwam (type, kanaal, wettelijke deadline); de aanvrager krijgt bericht als de behandeltermijn verlengd wordt; en de aanvrager krijgt een eindbericht met de uitkomst (afgehandeld / deels / afgewezen) plus uitleg over wat er bewaard blijft en waarom.

**Waar:** `/admin/system/privacy-requests (nieuw / afhandelen)` · `createPrivacyRequest / extendPrivacyRequest / fulfillPrivacyRequest / rejectPrivacyRequest`
**Let op:** De interne melding gaat standaard naar zowel de eigenaar als de super_admin. Er is nog een vierde, apart bericht voor een correctieverzoek ('Privacyverzoek (correctie) — uitkomst').
<sub>`src/lib/domain/privacy.ts` · `src/emails/PrivacyRequestReceivedAdminEmail.tsx` · `src/emails/PrivacyRequestExtensionEmail.tsx`</sub>

#### Facturatie-e-mail gewijzigd (beveiligingsmelding) 🟢 live

*ik wil dat niemand ongemerkt het facturatie-adres van een klant kaapt*

Past een klant zijn facturatie-e-mailadres aan, dan gaat er een melding naar het OUDE adres — met het oude en het nieuwe adres erin. Bewust de enige mail die niet via de normale ontvangerroutering loopt.

**Waar:** `/client/profile — facturatie-e-mail opslaan`
**Let op:** Niet uitzetbaar door de klant, en nooit via WhatsApp — dit is een bewuste struikeldraad.
<sub>`src/app/(client)/client/profile/page.tsx` · `src/emails/BillingEmailChangedKlantEmail.tsx`</sub>

#### Dagelijkse briefing voor de eigenaar 🟢 live `business_settings['daily_briefing'] — AAN sinds 2026-06-10; het WhatsApp-kanaal binnen deze instelling staat standaard uit`

*ik wil 's ochtends in één bericht weten wat er vandaag speelt*

Bouwt elke ochtend (standaard 07:00) een briefing en levert die af op de kanalen die in /admin/business/instellingen aangevinkt staan: in de app, per e-mail en/of via WhatsApp. Het uur en de kanalen zijn zonder deploy aan te passen.

**Waar:** `GET /api/cron/daily-briefing (ticker draait elk uur, vuurt op het ingestelde uur)` · `/admin/business/instellingen — aan/uit, uur, kanalen`
<sub>`src/app/api/cron/daily-briefing/route.ts` · `src/lib/business-settings.ts` · `src/emails/OwnerMessageEmail.tsx`</sub>

#### Interne digests (week, fouten, clock-out) 🟠 half af `clock-out-digest: CLOCKOUT_DIGEST_ENABLED — default uit. Week- en foutendigest draaien wél.`

*ik wil periodiek een overzicht zonder dat ik moet gaan zoeken*

Drie terugkerende samenvattingen: maandagochtend een weekdigest naar de eigenaar (nieuwe aanmeldingen, bevestigde diensten, open diensten, uren die op goedkeuring wachten), elke ochtend een foutendigest naar de super_admin (alleen als er iets mis ging — schone dagen geven geen mail), en een dagelijkse clock-out-digest voor de eigenaar.

**Waar:** `workers/weekly-digest.ts (maandag 08:00)` · `workers/error-digest.ts (dagelijks 07:00)` · `GET /api/cron/clockout-digest (ticker workers/clockout-digest.ts, 08:00)`
**Let op:** Week- en foutendigest kiezen hun ontvanger uit omgevingsvariabelen (MAARTEN_EMAIL / JEZZA_EMAIL), NIET uit de instelbare ontvangerstabel. Zonder die variabele slaan ze stilzwijgend over.
<sub>`workers/weekly-digest.ts` · `workers/error-digest.ts` · `workers/clockout-digest.ts`</sub>

#### Signalering rond chef-documenten, verjaardagen en inactiviteit 🟠 half af `regelmotor: REMINDERS_ENABLED — default uit. De documentcontrole draait wél (ongegated).`

*ik wil niet ontdekken dat een ID verlopen is op de dag zelf, en zelf regels kunnen instellen die een seintje geven*

Twee dagelijkse rondes. (1) Documentcontrole: verlopen documenten gaan automatisch op 'verlopen' en chef plus kantoor krijgen bericht; documenten die binnen 30 dagen verlopen geven een vooraankondiging aan de chef. (2) Een regelmotor waarin je zelf regels instelt: trigger (verjaardag chef, ID verloopt, certificaat verloopt, chef lang inactief), hoeveel dagen van tevoren, welk kanaal en wie het krijgt — met een logboek zodat niemand dubbel bericht krijgt.

**Waar:** `workers/document-expiry.ts (dagelijks 06:00)` · `workers/reminders.ts (dagelijks 06:30) + reminder_rules-beheer in admin`
**Let op:** De vooraanzegging bij bijna-verlopen documenten maakt volgens de code in V1 alleen een in-app melding — de e-mail staat er als 'optioneel, nog niet'. De trigger 'custom_date' in de regelmotor is gereserveerd maar niet werkend, en regelmail gaat als platte tekst, niet in de huisstijl.
<sub>`workers/document-expiry.ts` · `workers/reminders.ts`</sub>

#### Onboarding-nudge 🟡 live achter vlag `ONBOARDING_NUDGE_ENABLED — AAN sinds 2026-06-10`

*ik wil dat chefs en klanten hun profiel afmaken zonder dat ik erachteraan zit*

Wekelijks (maandag) een veegronde langs onvolledige chef- én klant-onboarding: iedereen met ontbrekende gegevens krijgt een in-app duwtje om het af te maken, en de eigenaar krijgt een 'wie mist wat'-samenvatting. Per persoon hooguit eens per 6 dagen.

**Waar:** `GET /api/cron/onboarding-nudge (ticker workers/onboarding-nudge.ts, maandag 09:00)`
**Let op:** Bewust ALLEEN in-app, geen uitgaande e-mail. Het overzicht bevat alleen labels van ontbrekende velden, nooit de gegevens zelf (AVG).
<sub>`src/app/api/cron/onboarding-nudge/route.ts`</sub>

#### De assistent stuurt een mail namens de eigenaar 🟢 live

*ik wil tegen de assistent kunnen zeggen 'mail die klant even' zonder adres op te zoeken*

Drie tools in de AI-assistent: mailen naar een los adres, naar een klant (op klant-id — de juiste ontvangers worden zelf bepaald) en naar een chef (op chef-id). De eigenaar krijgt altijd eerst ontvanger, onderwerp en een voorbeeld van de tekst te zien en moet bevestigen voordat het weggaat; er gaat automatisch een kopie naar hemzelf en antwoorden komen bij hem terecht.

**Waar:** `AI-tools: email.send · email.send_to_client · email.send_to_chef` · `assistent-chat in het eigenaar-portaal`
**Let op:** De assistent mag NOOIT om een e-mailadres vragen — hij zoekt de klant/chef op en gebruikt het id. Naar een klant met meerdere contacten gaan er meerdere losse mails.
<sub>`src/lib/ai/tools/comms.ts` · `src/lib/ai/actions/send-owner-email.ts` · `src/emails/OwnerMessageEmail.tsx`</sub>

#### Binnenkomende e-mail van chefs en klanten ⚫ uit `RESEND_INBOUND_SECRET — nog niet gezet (webhook staat nog niet aan in het Resend-dashboard)`

*ik wil dat een antwoord van een chef of klant niet in een niemandsland verdwijnt*

E-mail die binnenkomt via de Resend-inbound-webhook wordt gekoppeld aan de chef of klant die hem stuurde, grofweg geclassificeerd (klacht / spoed / vraag / overig) en opgeslagen. Kantoor krijgt een melding bij alles wat ertoe doet: elke bekende afzender, en klachten of spoed van wie dan ook.

**Waar:** `POST /api/webhooks/resend-inbound (svix-geverifieerd)` · `processInboundEmail() → interne melding`
**Let op:** De inhoud van binnenkomende mail is onbetrouwbare tekst: hij wordt opgeslagen en getoond als DATA en de AI-leeslijst geeft alleen onderwerp + classificatie terug, nooit de ruwe body.
<sub>`src/lib/domain/inbound.ts` · `src/app/api/webhooks/resend-inbound/route.ts`</sub>

#### Het meldingencentrum (de bel) en wat mensen kunnen uitzetten 🟢 live

*ik wil dat elke gebeurtenis ergens landt, ook als de mail mislukt*

Elke gebruiker (chef, klant, kantoor) heeft een bel met een ongelezen-teller en een lijst met recente meldingen die doorlinken naar de juiste pagina. Alles als gelezen markeren kan. De klant kan in zijn portaal vijf mailcategorieën uitzetten (voorgestelde chef, chef bevestigd, uren te tekenen, wijzigingsverzoeken, feedback-herinnering); alles daarbuiten — facturen, facturatie-wijziging, operationele mail — gaat altijd door. Meldingen ouder dan 90 dagen worden automatisch opgeruimd.

**Waar:** `/chef/notifications` · `/client/notifications` · `de bel in elke portaal-layout`
**Let op:** De bel is de bodem: hij faalt nooit hard — als het aanmaken van een melding misgaat wordt dat alleen gelogd en gaat de zakelijke actie gewoon door. Voorkeuren werken 'alleen uit als expliciet uitgezet': geen rij = alles aan.
<sub>`src/lib/integrations/notifications.ts` · `src/lib/integrations/prefs.ts` · `src/app/(client)/client/notifications/ClientNotificationPrefs.tsx`</sub>

#### Push-melding op de telefoon ⚫ uit `WEB_PUSH_ENABLED — default uit, én er moeten VAPID-sleutels staan; zonder dat verbergt het portaal ook de aanmeld-knop`

*ik wil dat een chef een dringend bericht op zijn telefoon ziet, ook zonder de app open*

Meldingen die als urgent zijn gemarkeerd worden naast de bel ook als webpush naar de apparaten van de gebruiker gestuurd (elke 2 minuten een aflever-ronde). Apparaten die niet meer bestaan worden automatisch opgeruimd, en de gebruiker kan per soort melding push uitzetten.

**Waar:** `GET /api/cron/deliver-push (ticker workers/push-deliver.ts, elke 2 min)` · `aanmelden voor push op /chef/notifications en /client/notifications`
<sub>`src/app/api/cron/deliver-push/route.ts` · `workers/push-deliver.ts`</sub>

#### WhatsApp-kanaal ⚫ uit `CHEF_WHATSAPP_ENABLED — default uit, plus SENT_DM_API_KEY vereist, plus per chef whatsappEnabled`

*ik wil chefs kunnen appen in plaats van mailen, want een appje wordt wél gelezen*

Een verzendlaag via sent.dm met een catalogus van 27 vooraf goedgekeurde templates (12 voor chefs, 8 voor klanten, 7 intern). Voor elke template staat in code vast welke variabelen hij nodig heeft, zodat een ontbrekende variabele bij ons wordt gevangen en niet pas door Meta. De eigenaar bepaalt per chef of die WhatsApp krijgt; chefs kunnen dat zelf niet uitzetten.

**Waar:** `sendWhatsAppTemplate() · aflevering via /api/cron/deliver-push` · `per chef: schakelaar op de chef-detailpagina in admin`
**Let op:** Van de 27 templates is er in de code precies ÉÉN aangesloten op een gebeurtenis: chef_nieuwe_dienst bij een voorgestelde dienst. De aflever-route zoekt het telefoonnummer bovendien alleen op in de chefs-tabel — klant- en interne templates zouden dus nooit een nummer vinden, ook niet als de vlag aan gaat.
<sub>`src/lib/whatsapp.ts` · `src/lib/whatsapp-templates.ts` · `docs/whatsapp-templates.md`</sub>

#### Wie krijgt welke mail, en is hij aangekomen 🟢 live

*ik wil kunnen instellen wie wat krijgt, en achteraf zien of het is bezorgd*

Twee routeringslagen plus een logboek. Voor klanten: per gebeurtenis wordt een rol gekozen (planning, ter plaatse, uren-akkoord, finance, spoed) uit de contactpersonen van die klant, met terugval op het hoofd- of facturatie-adres. Voor kantoor: per gebeurtenis staat in een tabel wie het krijgt, aanpasbaar in het admin-scherm zonder deploy (60 seconden cache). Elke verstuurde mail wordt gelogd; de statuswebhook van Resend werkt 'verstuurd' bij naar bezorgd, gebounced of als spam gemeld, zodat bouncende adressen zichtbaar worden.

**Waar:** `/admin/system/notifications — ontvangers per gebeurtenis` · `/admin/business/integrations — bounces en bezorgstatus` · `POST Resend status-webhook`
**Let op:** De rol-gebaseerde routering werkt pas als er contactpersonen bij de klant zijn ingevoerd; zolang die tabel leeg is gaat alles naar het ene hoofdadres (finance-mail naar het facturatie-adres).
<sub>`src/lib/domain/client-recipients.ts` · `src/lib/notifications.ts` · `src/lib/integrations/email.ts`</sub>

> **Gaten in dit gebied**
> - `InvoiceKlantEmail` WORDT verstuurd (invoicing.ts regel 384) maar ontbreekt volledig in docs/EMAIL_TEMPLATES.md — die gids beschrijft 28 mails terwijl er 29 templates zijn. De factuurmail is dus de enige die geen copywriter-documentatie en geen preview-vermelding heeft.
> - WhatsApp: 27 templates zijn in code vastgelegd en in docs beschreven, maar er is precies ÉÉN trigger aangesloten (chef_nieuwe_dienst). Alle 8 klant-templates en alle 7 interne templates (o.a. 'intern_uren_niet_gevuld' — juist de 'ik krijg er een appje van'-wens) zijn dode letters. Bovendien zoekt de afleverroute het telefoonnummer alléén in de chefs-tabel op, dus klant- en interne appjes kunnen te
> - Twee verschillende looks voor dezelfde herinnering: de automatische workers (hours-reminders, availability-reminder, reminders) versturen platte tekst via `sendPlainEmail` uit workers/_lib, terwijl dezelfde boodschap vanuit de assistent wél de huisstijl-template (HoursReminderChefEmail/KlantEmail) gebruikt. Wie de tekst in de template aanpast verandert de workermail niet.
> - Zes communicatiemomenten hebben geen eigen template maar bouwen hun mail inline op: nieuwe chef-aanmelding, nieuwe klant-aanvraag, contactformulier, profielwijzigingsverzoek (chef en klant), template-wijzigingsverzoek en de klant-opmerking bij een voorgestelde chef. Ze staan niet in de copywriter-gids en zijn niet centraal te herschrijven.
> - Geen enkele uitgaande mail gevonden voor het moment waarop een chef een aanbod ACCEPTEERT of AFWIJST — er bestaat geen onderwerpregel voor onder alle verzendplekken in src/ en workers/. Kantoor moet dat dus in het planbord of via de bel zien.
> - De vooraanzegging bij bijna-verlopen documenten maakt volgens de code zelf in V1 alleen een in-app melding — de e-mail staat als 'optioneel, voorlopig niet' in workers/document-expiry.ts. Een chef kan dus een verlopen ID krijgen zonder ooit een mail te hebben gehad.
> - Week- en foutendigest kiezen hun ontvanger uit omgevingsvariabelen (MAARTEN_EMAIL / JEZZA_EMAIL) in plaats van uit de instelbare notification_routes-tabel; ontbreekt zo'n variabele, dan slaan ze stilzwijgend over zonder waarschuwing.
> - Het grootste deel van de herinneringslaag staat nog uit: shift-reminders, beschikbaarheids-herinneringen, de uren-escalatieladder, de regelmotor (verjaardag/inactiviteit), clock-out-digest, Web Push, WhatsApp en de inbound-mailwebhook zijn allemaal default-off. Wat chef en klant vandaag daadwerkelijk merken is bijna volledig e-mail plus de bel.

---

## De machinekamer

Voor engineers: waar de regels wonen. Niet interessant als je alleen wilt weten wat het systeem kan.

### Business rules

#### Urenketen (uren goedkeuren, afkeuren, corrigeren) 🟢 live

*ik wil dat gewerkte uren kloppen voordat er geld uitgaat — en snel kunnen goedkeuren wat duidelijk klopt*

Bezit de urenstatemachine: goedkeuren, afkeuren, admin-correctie, storneren, en on-demand een bevestigde plaatsing afronden zodat de urenrij ontstaat. Elke overgang doet dezelfde vijf dingen (atomische UPDATE op de verwachte status, auditregel, outbox-event, melding, mail + recordEmailMessage). isMagicApproveEligible bepaalt of een door de klant getekende rij met één klik mag: gewerkte tijd binnen ±30 min van gepland, geen chef- of klantnotitie, beide tarieven gezet — al het andere gaat naar handmatige review. Een geldgarantie blokkeert goedkeuren als een tarief 0 of leeg is (anders boekt payroll €0). Finalize/override laat de admin uren goedkeuren die nooit door chef-indienen + klant-tekenen zijn gegaan, met identieke neveneffecten.

**Waar:** `approveHoursRow()` · `rejectHoursRow()` · `isMagicApproveEligible()`
**Let op:** hours-admin.ts waarschuwt zelf: de draft-rijvorm van completePlacement moet handmatig in sync blijven met workers/complete-placements.ts (die worker draait standalone op Railway en kan deze module niet importeren).
<sub>`src/lib/domain/hours.ts` · `src/lib/domain/hours-admin.ts`</sub>

#### Wie krijgt welke klantmail (mailrouting + opt-outs) 🟠 half af

*ik wil dat de juiste persoon bij het hotel de juiste mail krijgt — planning, uren-aftekenaar of finance*

Het enige pad dat bepaalt naar welk adres een klantmail gaat. Per gebeurtenis (chef voorgesteld, dienst bevestigd, uren te tekenen, uren goedgekeurd/afgekeurd, factuur, wijzigingsverzoek, feedback-herinnering, factuurmail-wijziging) ligt vast welke contactrollen die mail horen te krijgen. V2 leest actieve client_contacts-rijen met receivesNotifications; V1 valt terug op het hoofdadres, of het factuuradres voor finance-mail. Vijf categorieën kan de klant zelf uitzetten in /client/notifications; beveiligings- en factuurmail (billing_email_changed) is bewust altijd-aan.

**Waar:** `recipientsForClient(clientId, event)` · `CLIENT_NOTIFICATION_PREFS` · `/client/notifications`
**Let op:** De rol-gebaseerde V2-route is code-compleet maar praktisch nog dood: de comment zegt dat client_contacts in V1 leeg is, dus vrijwel alle mail valt terug op één adres. Uitzondering met opzet: mail over een gewijzigd factuuradres gaat naar het OUDE adres.
<sub>`src/lib/domain/client-recipients.ts`</sub>

#### Feedback per dienst: notities en beoordelingen 🟢 live

*ik wil per dienst kunnen bijhouden wat er speelde en hoe de chef het deed — zonder dat de verkeerde partij dat leest*

Twee gescheiden rails. placement_comments: meerdere auteurs (klant/admin/chef/systeem) met een zichtbaarheidsniveau per regel (internal / client_visible / chef_visible); lezen gaat altijd via listVisibleComments, dat filtert op wat die kijker mag zien (admin alles, klant alleen client_visible, chef alleen chef_visible). Body is 1–1000 tekens platte tekst, nooit HTML. Beoordelingen: één per plaatsing (UNIQUE vangt dubbel indienen), 1–5 sterren plus tags uit een vaste taxonomie; het chefgemiddelde wordt direct herberekend uit alleen KLANT-beoordelingen. De zichtbaarheidsregel zit in code, niet alleen in docs: admin ziet alles inclusief Maartens eigen interne beoordeling, de chef ziet zijn gemiddelde pas vanaf 5 beoordelingen en nooit losse opmerkingen, de klant ziet in V1 helemaal geen beoordelingsdata.

**Waar:** `addPlacementComment()` · `listVisibleComments()` · `submitRating()`
**Let op:** placements.notes is expliciet verboden voor klant- of chef-feedback (oud privacylek). Interne owner-beoordelingen (source='internal') tellen bewust NIET mee in het gemiddelde dat chef- en klantzijde zien.
<sub>`src/lib/domain/comments.ts` · `src/lib/domain/ratings.ts`</sub>

#### Wijzigings- en annuleringsverzoek van de klant 🟢 live

*ik wil als hotel een dienst kunnen wijzigen of afzeggen zonder dat de chef ineens in de kou staat*

Op elke dienststatus kan de klant een wijziging of annulering AANVRAGEN — nooit een directe mutatie, omdat chefs al toegezegd hebben. Regels: eigenaarschap van de dienst wordt gecontroleerd, reden minimaal 5 tekens, en maximaal één open verzoek per dienst per soort (voorcontrole plus unieke index als achtervang). Chef & Serve beslist; de uitkomst gaat per mail naar de klant en, bij annulering, via cancelShiftAndPlacements naar de dienst zelf met een statusherberekening. Een portalaanvraag die nog niet verwerkt is kan de klant zelf intrekken.

**Waar:** `createShiftChangeRequest()` · `decideShiftChangeRequest()` · `cancelClientSubmission()`
<sub>`src/lib/domain/shift-change-requests.tsx`</sub>

#### Slimme matching: welke chef past bij deze dienst 🟡 live achter vlag `MATCHING_TAGS_ENABLED · MATCHING_PREFS_ENABLED · MATCHING_FAVORITES_ENABLED · MATCHING_RELIABILITY_ENABLED`

*ik wil in seconden zien welke chefs bij deze dienst passen — en waarom*

Regelgebaseerde score (nog geen AI): vakniveau-match via twee ladders (keuken en bediening, met specialisten die alleen exact matchen) × segment-overlap × beschikbaarheid × ervaringsbonus, plus soft-signalen: reisafstand en marge, overlap van skill-tags tussen chef en klantvereisten, betrouwbaarheidssignalen, en de voorkeur van de chef voor die klant (favoriet / alleen bij spoed / alleen bij betere briefing / alleen bij hoger tarief / liever niet — altijd soft, nooit een harde uitsluiting). Elke kandidaat krijgt leesbare badges, eerlijke waarschuwingen en een uitleg in plaats van een kaal cijfer. Voorstellen (proposePlacement) en concepten (draftPlacement) lopen door dezelfde functie, inclusief de voorstelmails naar chef en klant.

**Waar:** `findMatchesForShift()` · `scoreChefForShift()` · `proposePlacement()`
**Let op:** Basisscoring is live; de extra signalen (tags, voorkeuren, favorieten, betrouwbaarheid) staan elk achter een eigen vlag. Reisafstand is hemelsbreed × wegfactor via gratis PDOK-geocoderen — bij een netwerkfout verdwijnt de afstand/marge-chip stilletjes.
<sub>`src/lib/domain/matching.ts` · `src/lib/domain/staffing-intelligence.ts` · `src/lib/domain/skill-tags.ts`</sub>

#### Plaatsing- en dienststatus (bevestigen, annuleren, vervanging) 🟡 live achter vlag `REPLACEMENT_HANDOVER_ENABLED (vervangingsoverdracht)`

*ik wil dat de status van een dienst altijd klopt met wie er daadwerkelijk staat*

transitionPlacement doet de atomische statusovergang (accepted/confirmed/rejected/cancelled) met terminale bescherming (nooit een afgeronde of geannuleerde plaatsing heropwekken), herberekent de dienststatus in dezelfde transactie en stuurt de bevestigingsmails. recomputeShiftStatus leidt de dienststatus af uit de levende plaatsingen: geannuleerd blijft geannuleerd, completed als de dienst voorbij is en alle niet-geannuleerde plaatsingen compleet zijn, filled zodra bevestigde plaatsingen de gevraagde bezetting halen, anders open. Wordt een al geaccepteerde of bevestigde chef eraf gehaald, dan krijgt die een expliciete overdracht ('je wordt niet meer verwacht — ga NIET naar de locatie') en stopt zijn aankomstmonitoring.

**Waar:** `transitionPlacement()` · `recomputeShiftStatus()` · `cancelShiftAndPlacements()`
**Let op:** placement-transition.ts zegt zelf dat het een bewuste kopie is van de inline setPlacementStatus op de admin-dienstpagina — de AI gebruikt deze, de mens de andere. Ook de complete-placements-worker herhaalt de 'completed'-regel inline.
<sub>`src/lib/domain/placement-transition.ts` · `src/lib/domain/shift-status.ts` · `src/lib/domain/replacement-handover.ts`</sub>

#### Inzetbaarheidsverdict + compliance-hardgate 🟡 live achter vlag `COMPLIANCE_HARDGATE_ENABLED`

*ik wil weten of ik deze chef de vloer op mag sturen — en zo niet, precies waarom niet*

Eén oordeel per chef in één oogopslag: blocked (mag of kan niet ingezet worden: ontbrekende BSN/IBAN/ID, verlopen ID, inactief of gearchiveerd), almost (kan wel, maar iets vraagt aandacht: nog in onboarding, ID verloopt bijna, dun profiel, betrouwbaarheidsvlag) of ready. Puur en deterministisch, hergebruikt exact dezelfde onboarding-readiness- en profielvolledigheidssignalen als de chefkaart, zodat kaart en poort elkaar nooit tegenspreken. De harde poort zit op het financiële commitmoment: een 'blocked' chef kan niet BEVESTIGD worden tenzij een mens dat met een reden overruled (geaudit). Fail-closed: onbekende chef = niet inzetbaar. Blokkades zijn labels ('Ontbreekt: BSN'), nooit de onderliggende PII.

**Waar:** `computeChefInzetbaarheid()` · `evaluateChefBlockers()` · `assertChefDeployable()`
<sub>`src/lib/domain/chef-inzetbaarheid.ts` · `src/lib/domain/chef-deployability-gate.ts` · `src/lib/domain/profile-completeness.ts`</sub>

#### Planbord: week publiceren en automatisch vullen 🟢 live

*ik wil een week in concept plannen, laten vullen door het systeem, en pas publiceren als ik hem goedkeur*

Concepten (drafts) zijn onzichtbaar voor chef en klant. 'Vul de week' loopt de diensten van vroeg naar laat en kiest per open plek de beste beschikbare chef via hetzelfde matchingbrein, met een eerlijkheidstiebreak (binnen 12 punten van de beste wint wie deze ronde het minst is ingedeeld) en herbevraging per plek, zodat een net ingedeelde chef niet dubbel of overlappend belandt. 'Publiceer' HER-VALIDEERT op het moment van committen (een concept van dagen geleden kan verlopen zijn): chef niet geblokkeerd die dag en geen overlap met een levende plaatsing elders, dan atomisch draft → proposed plus de echte voorstelmails (met ICS-agenda-uitnodiging) en een statusherberekening. Verlopen of conflicterende concepten blijven staan en worden teruggemeld ('2 concepten conflicteren — fix eerst').

**Waar:** `autofillWeek()` · `copyLastWeek()` · `publishDraftsForPeriod()`
**Let op:** roster-intel.ts bevat de vergrendelde 'active-fill'-regel: voor toekomstige bezetting tellen alleen levende plaatsingen, zodat 'completed' een toekomstige dienst nooit kunstmatig vol laat lijken.
<sub>`src/lib/domain/roster-autofill.ts` · `src/lib/domain/roster-publish.ts` · `src/lib/domain/roster-intel.ts`</sub>

#### Open diensten, interesse en spoedclaim voor chefs 🟡 live achter vlag `CHEF_OPEN_SHIFTS_ENABLED · EMERGENCY_CLAIM_ENABLED`

*ik wil als chef zelf diensten kunnen zien en mijn hand opsteken — en bij spoed direct kunnen pakken*

De chef bladert door OPEN diensten (met open bezetting, afstand/reistijd en een matchscore) en meldt interesse — nadrukkelijk géén zelf-inplannen: de planner blijft plaatsen. Interesse kan weer ingetrokken worden en de chef kan een vraag stellen over een open dienst. Voor spoedgevallen bestaat wel een directe claimroute. De planner ziet de lijst geïnteresseerde chefs bij de dienst.

**Waar:** `listOpenShiftsForChef()` · `expressInterest()` · `withdrawInterest()`
<sub>`src/lib/domain/shift-interests.ts`</sub>

#### Spoed, escalaties en veiligheid tijdens de dienst 🟡 live achter vlag `EMERGENCY_MODE_ENABLED · SHIFT_SIGNALS_ENABLED · ARRIVAL_TRUST_ENABLED · DND_DURING_SHIFT_ENABLED`

*ik wil het meteen weten als een dienst dreigt te ontsporen, en de chef moet met één tik iets kunnen melden*

Automatische detectie over bestaande data opent escalatierijen: laat geannuleerd, te lang onbezet vlak voor de start, niet bevestigd vlak voor de start, of een urgent signaal van een chef. De classificatielogica (tijdvensters en drempels) is puur en apart getest. Een gesloten escalatie blijft gesloten: gebeurtenisgebonden soorten heropenen alleen bij een NIEUWE trigger, toestandsgebonden soorten hebben een afkoelperiode per soort. Chefs sturen met één tik een status: onderweg, vertraagd, hulp nodig, 'ik voel me niet veilig' (altijd urgent, nooit afgeknepen) of kan niet starten. Aankomstzekerheid is privacy-first: de telefoon van de chef rekent de 1 km-straal zelf uit en stuurt alleen het RESULTAAT — geen coördinaten, geen route. Na afloop beantwoordt de chef zes korte clock-out-vragen (juiste rol, extra uren, pauze gehad, zoals beschreven, opmerking, zou terugkomen) die naar de gepland-vs-werkelijk-rapporten gaan; bij een klantprobleem krijgt de owner een melding. Daarnaast: waarom een dienst nog niet gevuld raakt (compliance, marge, buiten straal, geblokkeerd door de klant) en hoe lang uitstaande voorstellen al wachten.

**Waar:** `detectEmergencies()` · `syncEmergencies()` · `openEscalation()`
**Let op:** De vrije tekst van de chef bij een signaal wordt NOOIT in de escalatiereden gekopieerd (AVG); die reden is een machinaal gebouwde Nederlandse regel. De klant hoort bij aankomst alleen nabij/vertraagd/vervangen — nooit 'geen signaal' of 'toestemming ontbreekt'.
<sub>`src/lib/domain/emergencies.ts` · `src/lib/domain/shift-signals.ts` · `src/lib/domain/arrival.ts`</sub>

#### Facturatie naar de klant 🟢 live

*ik wil goedgekeurde uren omzetten in een factuur die klopt en niet dubbel telt*

Zet dezelfde goedgekeurde uren die payroll naar een cheffuitbetaling brengt om in een klantfactuur, gefactureerd op de startdatum van de dienst zodat kosten en omzet in dezelfde periode vallen en de marge sluit. Een factuur is zelfdragend: bedrijfsnaam, adres, KVK en BTW worden bij het genereren vastgelegd en nooit later herschreven. Genereren is idempotent per (klant, periode); uren die al op een factuur staan worden nooit opnieuw gefactureerd; kop, regels en audit committen samen of niet. Factuurnummers lopen per kalenderjaar op ('2026-0001') met een retry-lus zodat gelijktijdig genereren veilig is. Daarna: versturen, op betaald zetten of storneren.

**Waar:** `generateInvoiceForPeriod()` · `getUnbilledHoursByClient()` · `sendInvoice()`
**Let op:** Dit is een gedeelde lane — MEMORY.md wijst een aparte invoicing-chat aan als eigenaar van invoices/billing/payingit.
<sub>`src/lib/domain/invoicing.ts`</sub>

#### Chefgeld: ZZP-facturen, uitbetaling, vakantiegeld, verzoeken 🟢 live

*ik wil als chef weten wanneer ik betaald word, wat ik heb opgebouwd, en mijn factuur of onkosten kunnen indienen*

Vier vragen aan de chefkant. (1) ZZP-zelffacturatie: concept → ingediend → goedgekeurd → betaald (of afgewezen), met bewaakte atomische overgangen; de owner krijgt bericht bij indienen, de chef bij elke beslissing. (2) Betaalstatus: dezelfde urenstatemachine samengevat als uitbetaalpijplijn, met bedragen uit het eigen vastgelegde tarief × gewerkte minuten — nadrukkelijk een INDICATIE, geen loonstrook. (3) Vakantiegeld: opbouw over het bruto van definitieve uren tegen het ingestelde percentage, gelabeld als schatting tot payroll bevestigt. (4) Verwachte verdiensten: alleen BEVESTIGDE komende diensten (niet 'geaccepteerd', dat zou overbeloven), per ISO-week. Plus vakantie- en onkostenverzoeken die de chef indient en Maarten beslist.

**Waar:** `createChefInvoice()` · `submitChefInvoice()` · `decideChefInvoice()`
**Let op:** chef-payments en chef-forecast zijn puur lezend — geen nieuwe tabel, alles afgeleid uit de urenketen. Vakantiegeld-UITBETALINGEN worden nog niet bijgehouden, dus het saldo is 'opgebouwd', niet 'nog te ontvangen'.
<sub>`src/lib/domain/chef-invoices.ts` · `src/lib/domain/chef-payments.ts` · `src/lib/domain/chef-forecast.ts`</sub>

#### Binnenkomende aanmeldingen, aanvragen en formulierbouwer 🟢 live

*ik wil dat elke sollicitatie, personeelsaanvraag en contactbericht in mijn eigen systeem landt en te triëren is*

Drie eigen formulieren vervangen de oude Jotform- en mailto-route: chef-sollicitatie, klant-personeelsaanvraag en contactbericht. Ze landen als submission-rij (nooit direct als chef of klant), de bekende veldsleutels gaan naar gestructureerde kolommen en ALLES blijft ook in raw_payload staan zodat door de admin toegevoegde vragen niet verloren gaan. De formulieren zijn zelf beheerbaar (secties en velden) via de formulierbouwer. Vanuit de inbox converteert de office een submission eenmalig naar een echte chef of klant, met terugkoppeling naar de bron; nog eens klikken is een no-op.

**Waar:** `submitApplication()` · `submitClientRequest()` · `submitContactMessage()`
**Let op:** Een aanmelding van iemand die eerder gewist is (AVG) wordt via de tombstone-check gemarkeerd, niet stilzwijgend geaccepteerd.
<sub>`src/lib/domain/applications.ts` · `src/lib/domain/client-requests.ts` · `src/lib/domain/contact-messages.ts`</sub>

#### Onboarding van chef en klant + documenten 🟢 live

*ik wil dat een nieuwe chef of hotel zelf de juiste gegevens en documenten aanlevert*

Chefzijde: systeemvelden gaan naar getypeerde kolommen (BSN, IBAN en ID-nummer versleuteld), maatwerkvelden naar een EAV-tabel, bestandsvelden bestonden al als document; toestemming wordt vastgelegd. Klantzijde (bedrijfsgegevens): systeemvelden naar klantkolommen zonder versleuteling, contactvelden waaieren uit naar één client_contacts-rij per rol, het RI&E-bestand wordt alleen op aanwezigheid gecontroleerd. Niet-destructief: leeg overschrijft nooit een bestaande waarde, en na indienen is het formulier voor de klant read-only (latere wijzigingen lopen via goedgekeurde wijzigingsverzoeken). De audit noteert alleen VELDNAMEN, nooit ruwe waarden. Met één klik kan een chef het formulier gestuurd krijgen voor precies de ontbrekende velden, met registratie van wie welk formulier kreeg en of het is ingevuld. Documenten uploaden gaat rechtstreeks vanuit de browser naar de private opslag met een kortlevende presigned link; downloaden idem — nooit een publieke URL. Chefs verwijderen hun eigen document, de admin doet een soft-delete; RI&E-bestanden worden als bedrijfsgevoelig behandeld.

**Waar:** `submitOnboarding() (chef + klant)` · `saveOnboardingDraft()` · `hydrateFormState()`
**Let op:** onboarding.ts en client-onboarding.ts exporteren identieke functienamen. client-documents.ts noteert dat opruimen van verweesde rijen (rij aangemaakt, upload nooit voltooid) nog een openstaande worker-TODO is.
<sub>`src/lib/domain/onboarding.ts` · `src/lib/domain/client-onboarding.ts` · `src/lib/domain/profile-data-requests.ts`</sub>

#### Toegang: portaal-uitnodiging, 2FA-reset, accountherstel, meekijken 🟢 live

*ik wil mensen toegang geven of juist intrekken, en kunnen zien wat zij zien als er iets misgaat*

Uitnodigen is bewust twee stappen: eerst wordt het account aangemaakt en gekoppeld (status 'invited', kan nog niet inloggen, geen mail), pas bij activeren gaat de uitnodigingsmail eruit — zo vangt Maarten typefouten en kan hij het persoonlijk aankondigen. Ook interne collega's worden zo uitgenodigd, en accounts kunnen weer uitgezet worden. 2FA-reset door een super_admin wist het TOTP-geheim en de herstelcodes en laat het bestaande token direct vervallen. Accountherstel per e-mail lekt nooit of een adres bestaat (altijd hetzelfde antwoord). Meekijken ('bekijk als') wisselt de sessie per request via cookies, logt elke actie met de echte persoon erachter, en blokkeert gevoelige paden en onomkeerbare acties (wissen, payroll, gebruiker uitzetten) op twee niveaus.

**Waar:** `inviteChefToPortal()` · `inviteClientToPortal()` · `activatePortalUser()`
<sub>`src/lib/domain/portal-invites.ts` · `src/lib/domain/auth-admin.ts` · `src/lib/domain/recovery.ts`</sub>

#### AVG: privacyverzoeken, dataexport en wissen 🟢 live

*ik wil een AVG-verzoek netjes en aantoonbaar afhandelen binnen de termijn*

Volledige AVG-werkstroom: iemand (chef, klantcontact of iemand zonder account) dient een verzoek in; een super_admin pakt het op, verifieert de identiteit, correspondeert, verlengt zo nodig de termijn en beslist — alles binnen de 30-dagen-SLA. De persoon wordt opgezocht via ZOWEL het account als het e-mailadres, zodat niets gemist wordt. Export (inzage en overdraagbaarheid) werkt met een ALLOW-LIST: elke geëxporteerde kolom is met naam genoemd, dus een nieuwe PII-kolom kan niet per ongeluk lekken; ruwe payloads, interne notities, beveiligingsvelden, auditlog en derden blijven eruit, beoordelingen alleen geaggregeerd. Wissen is soft-first, legal-hold-bewust en getombstoned: rijen onder de fiscale bewaarplicht blijven staan en het verzoek sluit als 'gedeeltelijk uitgevoerd' met uitleg. Aparte scanner voor historische Jotform-payloads waarin onversleutelde BSN/IBAN/ID kan staan — die geeft alleen het JSON-pad terug, nooit de gevonden waarde.

**Waar:** `createPrivacyRequest()` · `setIdentityVerification()` · `extendSla()`
**Let op:** Wissen is een reeks losse, herhaalbare statements (geen transactie); de tombstone wordt als LAATSTE geschreven en is het bewijs dat het klaar is. Een mislukte poging kun je gewoon opnieuw draaien.
<sub>`src/lib/domain/privacy.ts` · `src/lib/domain/privacy-subject.ts` · `src/lib/domain/privacy-export.ts`</sub>

#### Chef 360 en Klant 360: track record, patronen, gezondheid 🟢 live

*ik wil deze chef of dit hotel echt kennen voordat ik iemand koppel of een gesprek voer*

Chefzijde: gewerkte uren (alleen definitieve statussen), betrouwbaarheid als ruwe tellingen in plaats van een verzonnen score, echte beoordelingen, recente diensten en met welke klanten. Klantzijde: omzet en marge uit definitieve uren, vulgraad gemeten over REEDS BEGONNEN diensten (een toekomstige open dienst telt dus niet als gemiste vulling), rotatie en retentie, gegeven beoordelingen en hoe snel de klant uren aftekent. Bovenop beide een verdict: chef ready/almost/blocked, klant sterk/goed/aandacht (nooit een blokkade — je weigert geen betalende klant). Daarnaast de patroonlaag: wanneer werkt iemand meestal, wat doet hij, met wie, wat verdient hij hier, welke chefs zijn te heractiveren, welke klanten zijn stil geworden, en welke bewezen matches liggen er nog. Elke entiteit heeft een leesbare audittrail (wie deed wat wanneer, zonder de before/after-payloads) en een dienst heeft een tijdlijn.

**Waar:** `getChefWorkSummary()` · `getChefClientHistory()` · `getClientSummary()`
**Let op:** Geld telt ALLEEN uit definitieve uren (admin_approved/exported) — nooit concept, ingediend, afgekeurd of toekomstig. Daarom kunnen cijfers hier lager lijken dan in het rooster.
<sub>`src/lib/domain/chef-history.ts` · `src/lib/domain/client-history.ts` · `src/lib/domain/client-health.ts`</sub>

#### KPI's, ranglijsten, rollups en rapportage 🟡 live achter vlag `KPI_FORECAST_ENABLED (alleen de vooruitblik)`

*ik wil zien hoe het bedrijf beweegt: omzet, marge, vulgraad, wie het beste presteert*

Alles leunt op de nachtelijke snapshottabellen, zodat een trend één datumscan is in plaats van een herberekening. De pure herschikkers (weekbuckets, vensteroptellingen, gewogen gemiddelden, periodeverschil) draaien zonder database en gaan altijd door dezelfde ruisbescherming: 1→2 toont nooit een zelfverzekerde ▲100%. Ranglijsten zijn eerlijk begrensd — 'hoogst beoordeeld' vraagt minstens 5 beoordelingen, 'meest betrouwbaar' minstens 5 voorstellen, en gewiste of gearchiveerde partijen vallen eruit. De platformrollups tonen omzet en marge uit definitieve uren en vulgraad per rol en segment over reeds begonnen diensten; capaciteitsbenutting is expliciet een SCHATTING op basis van een zichtbaar gemaakte aanname (er is geen positieve beschikbaarheidsdata). Rapportage voegt de tijdas toe: ~13 weken of 12 maanden omzet, marge en vulgraad met opgevulde lege buckets, plus swingdetectie.

**Waar:** `getPlatformRollups()` · `getLeaderboards()` · `getPlatformTimeSeries()`
**Let op:** forecast.ts is nadrukkelijk GÉÉN statistisch model maar een deterministische projectie uit het huidige rooster (open plekken komende 48u, chefs >30 dagen stil) en moet als projectie gelabeld worden.
<sub>`src/lib/domain/metrics-history.ts` · `src/lib/domain/leaderboards.ts` · `src/lib/domain/platform-rollups.ts`</sub>

#### Dashboard-aandachtswachtrij en cockpits 🟢 live

*ik wil bij het openen van het scherm direct zien wat vandaag mijn aandacht nodig heeft*

Elk dashboardsignaal wordt een kaart die vier vragen beantwoordt: signaal → context → actie → bevestiging; de mapping is puur zodat 'geen dode kaarten' afdwingbaar is. De rangschikking ligt expliciet vast zodat een urgent bezettingsprobleem nooit onder een laagwaardige melding verdwijnt: open escalatie eerst, dan onderbezette dienst binnen 24u, open dienst binnen 48u, deels gevuld deze week, geaccepteerd-maar-niet-bevestigd, voorgesteld-zonder-reactie. Signalen kun je snoozen (komen vanzelf terug) of wegklikken met reden — en dat wegklikken vervalt automatisch zodra de onderliggende toestand verandert (vingerafdrukvergelijking), dus een probleem kan niet stil blijven liggen. De planner heeft een eigen cockpit met dagelijkse wachtrijen (intake, geaccepteerd-niet-bevestigd, open plekken 48u en 7d) plus de matches voor de meest urgente open dienst; super_admin heeft een systeemgezondheidsvariant. Herhaalde zoekfilters kan Maarten als knop vastzetten.

**Waar:** `toCard()` · `rankAttentionItems()` · `noiseGuardedDelta()`
**Let op:** AI-gebruik verschijnt bewust als dashboardkaart, nooit als urgent item in de systeemwachtrij.
<sub>`src/lib/domain/dashboard-cards.ts` · `src/lib/domain/dashboard-intel.ts` · `src/lib/domain/dashboard-signal-state.ts`</sub>

#### Agenda: diensten, verzoeken en eigen afspraken in één stroom 🟢 live

*ik wil mijn dag, week of maand zien met diensten én mijn eigen intakegesprekken en taken erin*

Projecteert alles in één geordende gebeurtenissenstroom voor het dag-, week- en maandraster: elke dienst als 'bemand' of 'open', elk openstaand wijzigings- of annuleringsverzoek als opvolging op de datum van zijn dienst, en elke handmatige agenda-afspraak (intakegesprek, follow-up, onboardingtaak, contractstart, interne herinnering). Optioneel te filteren door de bril van één klant of één chef. De handmatige kant heeft een eigen schrijfzijde met statusovergangen, doorschuiven naar een andere collega en afvinkbare checklists (met optimistische concurrency zodat twee mensen elkaar niet overschrijven).

**Waar:** `getAgendaEvents()` · `createAgendaEvent()` · `setAgendaEventStatus()`
<sub>`src/lib/domain/agenda.ts` · `src/lib/domain/agenda-events.ts`</sub>

#### Berichten: inkomende e-mail en inboxtoegang 🟡 live achter vlag `RESEND_INBOUND_SECRET (webhook nog niet gezet — zie CLAUDE.md)`

*ik wil dat mail van chefs en hotels binnen het systeem landt, gerubriceerd en bij de juiste collega*

Inkomende mail wordt herleid naar een chef of klant, heuristisch geclassificeerd (klacht, spoed, vraag, overig), opgeslagen met ontdubbeling op het bericht-id, en gemeld aan de office wanneer het ertoe doet (bekende afzender, of urgent of klacht van wie dan ook). Toegang is losgekoppeld van rollen: super_admin koppelt gebruikers aan postbussen (planning@, eigen bussen) en Berichten filtert daarop; is er niets ingesteld, dan ziet iedereen met paginatoegang alles (gedrag van vóór de configuratie). Eigenaren zien daarbovenop mail die bij GÉÉN enkele geconfigureerde postbus hoort — het vangnet voor verdwaalde post.

**Waar:** `processInboundEmail()` · `listInboundAdmin()` · `setInboundHandled()`
**Let op:** De body van een binnengekomen mail is ONVERTROUWDE tekst: hij wordt opgeslagen en getoond als data, en de AI-leesfunctie geeft bewust alleen onderwerp en classificatie terug zodat vreemde tekst nooit ongevraagd in het model belandt.
<sub>`src/lib/domain/inbound.ts` · `src/lib/domain/inboxes.ts`</sub>

#### Prikbord, meldingen en AI-voorstellen die een mens goedkeurt 🟡 live achter vlag `BOARD_ENABLED · AI_MEMORY_MINING_ENABLED (geheugenvoorstellen)`

*ik wil mijn team iets kunnen laten weten, en AI-suggesties over profielen of feiten met één klik accepteren*

Prikbord: owner en team plaatsen berichten (met afbeelding en een vaste emoji-reactieset), chefs lezen en reageren; publiceren kan achter een vlag voorbereid worden en pinnen of soft-deleten kan. Webpush-abonnementen zijn per browser uniek en herstellen zichzelf bij opnieuw aanmelden. AI-voorstellen zijn altijd MENS-BEVESTIGD: uit een CV geëxtraheerde profielverrijking komt als 'pending' binnen en de CODE — niet het model — bepaalt of een veld veilig is (segmenten, specialisaties, talen, jaren ervaring gaan direct door) of gevoelig (vakniveau: de owner past het direct toe, een chef moet er een profielwijzigingsverzoek voor indienen, zodat goedkeuring de enige rail blijft). Gemijnde 'zal ik dit onthouden?'-feiten worden pas geheugen na één klik van de owner. Profielwijzigingsverzoeken van chefs (naam, e-mail, vakniveau, uurtarief) worden door dezelfde functie beslist voor zowel de admin-UI als de AI-tool. Owner-correcties op contactgegevens zijn bewust beperkt tot veilige basisvelden (telefoon, naam, stad) — nooit BSN, IBAN, ID of tarief.

**Waar:** `createBoardPost()` · `listBoardFeed()` · `toggleReaction()`
**Let op:** De vrije tekst van een prikbordbericht wordt altijd geëscaped en nooit aan de AI gevoerd.
<sub>`src/lib/domain/board.ts` · `src/lib/domain/push-subscriptions.ts` · `src/lib/domain/profile-suggestions.ts`</sub>

> **Gaten in dit gebied**
> - Dezelfde regel op drie plekken: placement-transition.ts zegt in zijn eigen header dat het een bewuste kopie is van de inline setPlacementStatus op de admin-dienstpagina ('DRY-debt (intentional)'), en workers/complete-placements.ts herhaalt zowel de completed-afleiding uit shift-status.ts als de draft-urenrij uit hours-admin.ts in ruwe SQL. Drie kopieën die handmatig in sync moeten blijven.
> - replacement-handover.ts wordt in de hele boom door precies één bestand geïmporteerd: placement-transition.ts (het AI-pad). Het menselijke annuleerpad op de admin-pagina lijkt daardoor géén vervangingsoverdracht te sturen — verifieer dit voordat je het in FEATURES.md als algemene garantie opschrijft.
> - Twee eigenaren van 'klantgezondheid': client-health.ts exporteert computeClientHealth (puur verdict sterk/goed/aandacht) terwijl client-history.ts óók getClientHealth en getClientHealthVerdicts exporteert. Naam-overlap zonder duidelijke scheiding.
> - Twee modules heten 'forecast' maar beantwoorden totaal verschillende vragen: forecast.ts = platformprojectie (onderbezetting 48u + churn, achter KPI_FORECAST_ENABLED) en chef-forecast.ts = verwachte verdiensten van één chef. Makkelijk te verwisselen in documentatie en imports.
> - De rol-gebaseerde mailrouting in client-recipients.ts (planning / hours_approval / finance / onsite / emergency) is volledig geïmplementeerd maar staat volgens de eigen comment praktisch droog omdat client_contacts in V1 leeg is — bijna alle klantmail valt terug op één adres. Een 'gebouwd maar niet in gebruik'-gat, geen bug.
> - onboarding.ts (chef) en client-onboarding.ts (klant) exporteren identieke functienamen (hydrateFormState, saveOnboardingDraft, submitOnboarding, get*ByUserId). Functioneel gescheiden, maar bij lezen of importeren zonder pad-context niet uit elkaar te houden.

### De event-ruggengraat

#### Integratie-outbox (gegarandeerde aflevering van externe events) 🟠 half af

*ik wil dat een goedgekeurd uur of een bevestigde shift altijd doorkomt bij het externe systeem, ook als dat systeem er net even uit ligt — zonder dat mijn klik in het portaal daarop vastloopt*

Elke business-actie die iets buiten het systeem moet triggeren schrijft NA de database-mutatie één rij in `integration_outbox` via `enqueueIntegrationEvent({provider, eventType, entityType, entityId, payload, idempotencyKey})`. De idempotency-key is uniek, dus dezelfde actie twee keer uitvoeren levert één event op (`alreadyEnqueued: true` bij de tweede). Een cron-worker claimt de openstaande rijen (`claimPendingBatch`, atomair met FOR UPDATE SKIP LOCKED zodat twee workers nooit dubbel bezorgen), en zet ze op `sent` (`markSent`) of plant een nieuwe poging met oplopende wachttijd 1→5→15→30→60 min (`markFailed`); na 10 pogingen blijft de rij op `failed` staan en stopt het automatisch opnieuw proberen. Een beheerder kan een gefaalde rij handmatig opnieuw in de wachtrij zetten (`retryRow`, alleen vanuit status `failed`). Oude bezorgde rijen worden na 90 dagen opgeruimd (`pruneSent`).

**Waar:** `/admin/business/integrations/outbox (openstaande + gefaalde events, retry-knop)` · `/admin/business/integrations (samenvattingskaart)` · `workers/deliver-outbox.ts (Railway-cron die de wachtrij leegtrekt)`
**Let op:** Alleen provider `internal` wordt daadwerkelijk bezorgd — dat zijn events waarvan de zichtbare gevolgen (mail + notificatie) al inline zijn gebeurd; "bezorgen" is voor die rijen alleen bevestigen (pending → sent). De providers `payroll` en `csv` hebben nog GEEN bezorghandler en blijven expres eeuwig op `pending` staan (niet op `failed`) — dat is bedoeld als eerlijke, zichtbare achterstand op /admin/business/integrations, geen storing. `enqueueIntegrationEvent` gooit nooit: bij een fout logt hij en geeft `{ok:false}` terug, zodat een kapotte integratie de gebruikershandeling niet ongedaan maakt.
<sub>`src/lib/integrations/outbox.ts` · `src/lib/integrations/index.ts` · `workers/deliver-outbox.ts`</sub>

#### In-app notificaties (de bel) + fan-out naar meerdere ontvangers 🟢 live

*ik wil dat elke chef, klant en collega in het portaal zelf ziet wat er is gebeurd, zonder afhankelijk te zijn van e-mail*

`createNotification({userId, type, title, body, actionUrl, entityType, entityId})` zet één rij in de `notifications`-tabel; de bel toont het ongelezen-aantal (`getUnreadCount`), het laatste lijstje (`listRecent`, standaard 20) en kan per stuk (`markRead`) of in bulk (`markAllRead`) gelezen worden gemarkeerd. `createNotificationsFanOut(userIds, gedeeldeInhoud)` doet hetzelfde voor een hele routeerbare lijst tegelijk (bijv. alle super_admins bij een privacyverzoek). Notificaties ouder dan 90 dagen worden opgeruimd (`pruneOld`).

**Waar:** `de belknop in de layout van elk portaal (admin/chef/klant)` · `aangeroepen vanuit vrijwel elke domeinactie (hours, shifts, privacy, onboarding, workers)`
**Let op:** Bewust best-effort: mislukt de insert, dan wordt dat gelogd maar nooit als fout doorgegeven — de e-mail is het vangnet. `markRead`/`markAllRead` filteren altijd op de userId uit de sessie (dat IS de autorisatie), dus je kunt nooit andermans notificatie aanraken. `getUnreadCount` haalt alle ongelezen rijen op en telt in JavaScript in plaats van met een SQL-count; de code adviseert de teller ~5s te cachen in de layout.
<sub>`src/lib/integrations/notifications.ts`</sub>

#### Telefoon-kanalen: Web Push en WhatsApp via de outbox 🟡 live achter vlag `WEB_PUSH_ENABLED / CHEF_WHATSAPP_ENABLED (beide standaard uit; de worker slaat over als beide uit staan, het endpoint controleert het nogmaals)`

*ik wil dat een chef een shift-voorstel of bevestiging op zijn telefoon voelt binnenkomen, niet pas als hij toevallig inlogt*

`notifyUser()` is `createNotification()` plus optionele telefoonbezorging: met `push: true` wordt een outbox-event `notify.push` (provider `web_push`) weggeschreven, met `whatsapp: {template, params}` een event `notify.whatsapp` (provider `whatsapp`). Beide zijn gesleuteld op het notificatie-id (`notify.push:<id>`), dus opnieuw uitvoeren stuurt niets dubbel. De worker `push-deliver.ts` tikt periodiek `/api/cron/deliver-push` aan, dat beide wachtrijen leegtrekt.

**Waar:** `workers/push-deliver.ts → /api/cron/deliver-push`
**Let op:** De belrij in de database is altijd de ondergrens en wordt inline geschreven; de telefoonbezorging is puur een outbox-enqueue, nooit een directe externe call — conform de huisregel. Mislukt de enqueue, dan wordt dat gelogd en gaat de mutatie gewoon door.
<sub>`src/lib/integrations/notifications.ts` · `workers/push-deliver.ts`</sub>

#### Transactionele e-mail versturen (Resend) 🟢 live

*ik wil dat chefs en klanten automatisch een nette Nederlandse mail krijgen bij elke stap, vanaf één afzender die ik later in één keer kan omzetten naar het echte domein*

`sendEmail({to, subject, react, replyTo?, cc?, attachments?})` is de enige route naar buiten: hij wikkelt de Resend-client, gebruikt altijd `RESEND_FROM_EMAIL` als afzender, ondersteunt meerdere ontvangers, CC (bijv. de eigenaar in kopie bij assistent-mail), reply-to (zodat chefs de eigenaar antwoorden en niet noreply) en bijlagen (bijv. een week-.ics of een factuur-PDF). Hij gooit nooit: bij een fout logt hij en geeft `{ok:false, error}` terug, bij succes `{ok:true, id}` — dat id is precies wat de tracking nodig heeft. Daarnaast levert het bestand `formatShiftWhen()` voor de Nederlandse datumnotatie in mails ("Maandag 15 juni 2026, 18:00–23:00"). Er zijn 29 React Email-sjablonen in src/emails/, allemaal om `_layout.tsx` gewikkeld.

**Waar:** `src/lib/email.ts (sendEmail)` · `src/emails/*.tsx (29 sjablonen + _layout.tsx)`
**Let op:** Eén plek om het verzenddomein te wisselen (jezzacooks.com → chefandserve.nl bij lancering) en om later rate-limiting toe te voegen. Huisregel: elke `sendEmail()` hoort direct gevolgd te worden door `recordEmailMessage()`, anders is de mail onzichtbaar in het systeem. Klant-mail moet via `recipientsForClient(clientId, eventKey)` lopen, nooit via een hard ingetypt `client.email`.
<sub>`src/lib/email.ts` · `src/emails/_layout.tsx`</sub>

#### E-mail-aflevertracking (kwam de mail echt aan?) 🟢 live `RESEND_WEBHOOK_SECRET (zonder dit secret komt er geen statusupdate binnen en blijft alles op 'sent' hangen)`

*ik wil kunnen zien dat de klant de mail écht heeft ontvangen, en direct merken als een adres bounct*

Na elke verzending schrijft `recordEmailMessage({providerMessageId, toEmail, template, eventKey?, entityType?, entityId?, userId?})` een rij in `email_messages` met status `sent` (het adres wordt genormaliseerd naar lowercase). Resend stuurt daarna afleverstatussen naar `/api/webhooks/resend`; die route verifieert eerst de Svix-HMAC-handtekening (de handtekening IS de authenticatie, er is geen login-gate) en roept dan `recordEmailEventFromWebhook()` aan. Die zoekt de rij op het provider-message-id, hangt de RUWE gebeurtenis onveranderd in `email_events` voor audit/debug, en werkt de status bij via `emailStatusFromProviderEvent()`: sent/delivered/bounced/complained/failed veranderen de status, terwijl geopend/geklikt/vertraagd alleen de `lastEventAt` bijwerken ("kwam hij aan?" blijft de canonieke vraag). Uitleesbaar per entiteit (`listForEntity` — rendert de mailgeschiedenis op een shift-, uren- of chefdetailpagina), als bouncelijst (`recentBounces`, 7 dagen) en als telling voor de gezondheidskaart (`counts`).

**Waar:** `/api/webhooks/resend (Resend-afleverwebhook, svix-geverifieerd)` · `mailgeschiedenis-blok op shift-/uren-/chefdetailpagina's` · `/admin/business/integrations (bounces + tellingen)`
**Let op:** Mails die niet via onze code gaan (bijv. wat Auth.js zelf verstuurt) hebben geen `email_messages`-rij; de webhook logt dat en slaat over — die zijn dus niet traceerbaar. Dezelfde gebeurtenis twee keer ontvangen voegt een tweede `email_events`-rij toe (bewust, voor audit) maar verandert de status niet verkeerd.
<sub>`src/lib/integrations/email.ts` · `src/app/api/webhooks/resend/route.ts`</sub>

#### Externe ID-koppelingen (external refs) 🟢 live

*ik wil weten welk nummer een chef of klant heeft in Payingit of het boekhoudpakket, zonder dat er voor elk nieuw systeem een kolom bij moet in de database*

Eén tabel koppelt onze entiteiten aan externe ID's: chef ↔ Payingit-medewerker-id, klant ↔ boekhoud-klantnummer, uren-regel ↔ payroll-batchregel, payroll-batch ↔ externe batchreferentie. `upsertExternalRef()` schrijft of overschrijft op de unieke combinatie (provider, entityType, entityId) en kan er een klikbare externe URL en vrije meta-data bij bewaren. `resolveExternalRef()` vertaalt van ons id naar het externe id; `resolveByExternalId()` doet de omgekeerde vertaling — nodig zodra een extern systeem iets naar ons terugstuurt.

**Waar:** `aangeroepen vanuit de payroll-/Payingit-synchronisatie (workers/payingit-sync.ts)`
**Let op:** Harde regel: externe ID's staan NOOIT als kolom op de entiteitstabel, altijd hier — zo kan er een provider bij zonder migratie. Ik heb de aanroepende kant (payingit-sync) niet gelezen, dus welke koppelingen in de praktijk gevuld worden is niet geverifieerd.
<sub>`src/lib/integrations/external-refs.ts`</sub>

#### Integratie-gezondheid / controlekamer 🟢 live

*ik wil in één oogopslag zien of alles wat het systeem naar buiten stuurt nog werkt — vastgelopen events, gebouncte mail, en wanneer de achtergrondtaken voor het laatst draaiden*

`getIntegrationHealth()` bundelt in één keer: het aantal openstaande outbox-events (pending + processing) en het aantal gefaalde, de mailtellingen over 7 dagen (bounces, afgeleverd, totaal — dat totaal is de noemer voor het afleverpercentage), en per provider de laatste uitvoering met status en eindtijd (DISTINCT ON over `integration_runs`). Het resultaat wordt 60 seconden in het geheugen gecachet; `invalidateHealthCache()` gooit de cache weg zodra iemand op retry drukt. Voor de detailtabellen: `listPendingOutbox()` (alles op pending/processing/failed, op volgorde van eerstvolgende poging), `listRecentRuns()` (laatste 50 taakuitvoeringen) en `listRecentBounces()` (bounces van de afgelopen 7 dagen).

**Waar:** `/admin/business (kaart "Systeem / integraties")` · `/admin/business/integrations (controlekamer)` · `/admin/business/integrations/outbox`
**Let op:** `lastBackupAt` staat hard op `null` met de opmerking dat PR-CHEF-13 het uit `backup_runs` zou vullen — de back-up-indicator toont dus niets, ook al bestaat het veld. De 60s-cache betekent dat een net verstuurd event tot een minuut lang niet in de telling zit.
<sub>`src/lib/integrations/health.ts` · `src/app/(admin)/admin/business/integrations/page.tsx`</sub>

#### Notificatievoorkeuren (uit-zetten per gebeurtenis) ⚫ uit

*ik wil dat een chef of klant straks bepaalde meldingen kan uitzetten zonder dat we elke verzendplek in de code moeten aanpassen*

`shouldSendToUser(userId, eventKey)` geeft standaard `true` terug: heeft de gebruiker geen voorkeurenrij, of staat de sleutel niet expliciet op `false`, dan gaat de mail eruit. `setPref({userId, eventKey, enabled})` schrijft de voorkeur weg in een JSON-veld per gebruiker (upsert op userId).

**Waar:** `nog geen geverifieerde instellingenpagina; het bestand noemt /chef/settings en /client/settings als V2`
**Let op:** Expliciet V1 = alles altijd aan. De naad bestaat zodat V2 een instellingenscherm kan bouwen, maar de code-commentaar beschrijft het gebruik (`if (await shouldSendToUser(...))`) als V2-voorbeeld — ik heb NIET geverifieerd dat er ergens werkelijk een verzending op wordt afgeremd, en `prefs.ts` wordt niet geëxporteerd via de `@/lib/integrations`-barrel.
<sub>`src/lib/integrations/prefs.ts`</sub>

> **Gaten in dit gebied**
> - ALLE outbox event keys die ik in de code vind (grep op `eventType:` over src/ + workers/ + scripts/), 14 stuks: `availability_updated` · `board.new_post` · `chef.updated` · `client.updated` · `hours.approved` · `hours.client_rejected` · `hours.client_signed` · `hours.submitted` · `hours_submitted` · `notify.push` · `notify.whatsapp` · `payroll_batch.exported` · `placement.cancelled_by_chef` · `shi
> - Twee naamgevingsconventies door elkaar, wat op dubbele events wijst: `hours.submitted` naast `hours_submitted`, en `placement.cancelled_by_chef` naast `shift_cancelled_by_chef` (punt vs. underscore). Voor dezelfde gebeurtenis lijken dus twee sleutels te bestaan — de outbox dedupliceert per idempotency-key, dus twee sleutels = twee rijen. Verdient opruiming of een expliciete uitleg welke welke is.
> - E-mailsjablonen: er zijn 29 sjablonen in src/emails/ (+ _layout.tsx) en ELK sjabloon heeft minstens één aanroepende plek buiten src/emails/ — ik vond GEEN weesbrief. De minst gebruikte (precies één call site) en waar die zit: BillingEmailChangedKlantEmail → src/app/(client)/client/profile/page.tsx · ClientChangeRequestAdminEmail → src/lib/domain/shift-change-requests.tsx · HoursRejectedByKlantChef
> - De outbox is voor externe systemen nog een lege huls: workers/deliver-outbox.ts bezorgt uitsluitend provider `internal` (waarvan de mail + notificatie al inline zijn verstuurd — 'bezorgen' = alleen bevestigen). `payroll` en `csv` hebben geen enkele bezorghandler en blijven bewust eeuwig op `pending`, wat het cijfer 'outboxPending' op de gezondheidskaart structureel laat oplopen zonder dat er iets 
> - `lastBackupAt` in health.ts staat hard-coded op `null` met de aantekening dat PR-CHEF-13 het uit `backup_runs` zou vullen — de back-up-status in de controlekamer toont dus nooit iets, ook niet als er wel back-ups draaien.
> - prefs.ts (notificatievoorkeuren) wordt NIET geëxporteerd via de src/lib/integrations/index.ts-barrel, en het bestand documenteert zijn eigen gebruik expliciet als 'V2-ready' voorbeeld. Ik heb geen verzendplek geverifieerd die `shouldSendToUser()` daadwerkelijk aanroept — behandel het als een naad, niet als een werkende afmeldknop.

### Data layer

#### chefs — het chef-dossier 🟢 live

*ik wil van elke kok weten wie hij is, wat hij kan, wat hij kost en of ik hem ergens heen kan sturen*

Eén rij per kok: identiteit, adres (met lat/lon), vakniveau, segmenten, skill-tags, talen, tariefrange, jaren ervaring, transport. Daarnaast payroll-PII (BSN/IBAN/ID-nummer AES-256-GCM versleuteld), onboarding-status, ratings-rollup (averageRating/ratingCount), Maartens vrije notes + owner-tags, en de interne oordeelslaag `intel` (jsonb: best ingezet voor / niet ideaal voor / risico / volgende actie). CHEF-PR1 voegde chef-eigen voorkeuren toe: reisradius, spoed-bereidheid, avoid-lijst, vroegste starttijd.

**Waar:** `/admin/business/chefs (directory + filters)` · `/admin/business/chefs/[id]` · `/chef/profile`
**Let op:** Soft-delete via deletedAt (nooit hard weg — AI-trainingsdata). `intel`, `notes` en `ownerTags` zijn INTERN: nooit chef- of klantzichtbaar. `whatsappEnabled` is een OWNER-schakelaar (chef kan niet zelf uit), globaal gated door CHEF_WHATSAPP_ENABLED. Geen enkele index op status/city/vakniveau — de chef-directory scant de tabel.
<sub>`src/lib/db/schema.ts:798-959`</sub>

#### clients — het klantdossier (hotels) 🟢 live

*ik wil per hotel weten waar mijn koks zich melden, wat er juridisch en operationeel geldt, en welke koks daar wel/niet heen mogen*

Bedrijfsgegevens (KvK, btw, rechtsvorm, holding), gesplitste adressen (shiftAddress waar de kok zich meldt + aankomstinstructies vs. billingAddress voor facturen), betaaltermijn, segment/clientType/tags, favoriete én geblokkeerde chef-ids, de onboarding-antwoorden (CAO, RI&E, PBM/VOG, parkeren, maaltijd, werkkleding, keukentaal), de per-hotel 'niet-onderhandelbaar'-checklist (nonNegotiables) en de interne `intel`-oordeelslaag.

**Waar:** `/admin/business/clients` · `klant-onboardingformulier (Stage 2, BEDRIJFSGEGEVENS)` · `/client/* portaal`
**Let op:** blockedChefIds is een HARDE uitsluiting in ranking, favoriteChefIds slechts een boost. Adres hier wijzigen herschrijft NOOIT bestaande diensten — die nemen bij aanmaak een eigen snapshot. Geen index op status; `address` is een legacy-kolom die je niet meer moet gebruiken.
<sub>`src/lib/db/schema.ts:985-1116`</sub>

#### shifts — de dienst (de vraag van de klant) 🟢 live `isEmergency werkt alleen samen met EMERGENCY_CLAIM_ENABLED (kolom staat default false)`

*ik wil een concrete dienst inplannen: wanneer, waar, welke rol, hoeveel koks, tegen welk tarief*

Start/eind, rol, segment, headcount, locatie + geocodering, klant- en cheftarief, en de eisen-set die het matchen voedt (dresscode, taal, minimale ervaring, keukentype, solo/team, servicestijl, parkeren, maaltijd, flexibele start). Drie gescheiden notitievelden met verschillende doelgroep: notes (intern), chefVisibleNotes, clientVisibleNotes. Spoeddienst-vlag isEmergency. Herkomst van een terugkerende template wordt vastgelegd (sourceTemplateId + datum).

**Waar:** `/client/shifts/[shiftId] (de klant-hub)` · `admin planbord` · `auto-gegenereerd uit shift_templates`
**Let op:** GROOTSTE INDEX-GAT van het schema: geen index op clientId, startsAt of status. Elke agenda-, planbord- en dashboardquery filtert daarop. Alleen een partiële unique op (sourceTemplateId, sourceTemplateDate) — die maakt de generator idempotent.
<sub>`src/lib/db/schema.ts:1157-1248`</sub>

#### placements — de koppeling kok ↔ dienst 🟢 live

*ik wil zien welke kok op welke dienst staat en in welke fase dat aanbod zit*

Eén rij per (kok, dienst) met een statusmachine (proposed → accepted/confirmed → completed/cancelled) en een tijdstempel per overgang. Bewaart het aanbod-leven: seenAt (kok heeft het geopend), expiresAt (reactietermijn; verlopen wordt afgeleid, niet opgeslagen), de match-score op moment van voorstellen, een gestructureerde afwijs- én annuleerreden, en het post-shift duimpje van de kok (chefReturnSignal).

**Waar:** `chef-portaal aanbod-scherm` · `admin planbord / voorstel-flow` · `/client/shifts/[shiftId] (voorgestelde kok)`
**Let op:** Unique (chefId, shiftId) voorkomt dubbelboeking; ON DELETE RESTRICT op chef betekent dat een kok met plaatsingen nooit hard verwijderd wordt. Er is een index op status maar GEEN losse index op shiftId — 'welke koks staan op deze dienst' is de heetste query en gebruikt de unique index niet (chefId staat vooraan).
<sub>`src/lib/db/schema.ts:1512-1577`</sub>

#### shift_hours — de urenketen (het hart van de omzet) 🟢 live

*ik wil dat gewerkte uren één keer worden ingediend, door de klant getekend, door mij goedgekeurd en daarna onveranderlijk de payroll en factuur in gaan*

Eén rij per plaatsing (UNIQUE = dubbel indienen onmogelijk). Bewaart start/eind/pauze, berekende gewerkte minuten en een SNAPSHOT van zowel chef- als klanttarief. Statusmachine draft → submitted → client_signed/rejected → admin_approved/rejected, met wie tekende en wanneer, plus de payroll-exportmarkering. Aparte notitievelden voor kok, klant en kantoor.

**Waar:** `chef: uren indienen` · `klant: uren tekenen` · `admin: urenwachtrij`
**Let op:** Best geïndexeerde tabel van het schema (5 indexes: admin-queue, chef, klant, per-dienst, klant-timeout). DB-checks bewaken eind > start en pauze ≥ 0. Tarieven zijn snapshots: later een tarief wijzigen verandert nooit oude uren.
<sub>`src/lib/db/schema.ts:2135-2216`</sub>

#### invoices + invoice_lines — facturatie richting hotels 🟢 live

*ik wil per klant per periode één factuur die precies de goedgekeurde uren verantwoordt*

Factuurkop met opeenvolgend nummer, bevroren factuuradres/KvK/btw-snapshot, periode, uitgifte- en vervaldatum, bedragen in centen (subtotaal ex btw, btw-tarief in basispunten, totaal), status draft→sent→paid→void/credit en een R2-sleutel voor de PDF. Elke regel verwijst terug naar de goedgekeurde shift_hours die het bedrag rechtvaardigt.

**Waar:** `admin facturatie-scherm` · `factuur-PDF via R2`
**Let op:** Partiële unique (client, periodStart, periodEnd) WHERE status <> 'void' → genereren is idempotent én een gestorneerde factuur geeft de periode weer vrij. Vereist ON CONFLICT ... WHERE, anders Postgres-fout 42P10. invoice_lines heeft GEEN index op invoiceId.
<sub>`src/lib/db/schema.ts:3479-3548`</sub>

#### payroll_batches + lines + shift_hour_corrections — uitbetaling koks 🟢 live

*ik wil goedgekeurde uren als één batch klaarzetten voor uitbetaling, en correcties achteraf netjes vastleggen*

Een batch groepeert goedgekeurde uren over een periode, met bestandsverwijzing + checksum, aantal regels en de totalen chefkosten / klantomzet / marge. Status draft → exported → partially_failed/corrected/void. Zodra geëxporteerd zijn de onderliggende uren READ-ONLY: een aanpassing wordt een correctierij met delta's in minuten en centen, die apart goedgekeurd wordt.

**Waar:** `admin payroll-scherm` · `CSV/provider-export`
**Let op:** Goedgekeurde uren ≠ uitbetaalde payroll — dat is bewust een aparte, menselijke handeling. payroll_batch_lines en shift_hour_corrections hebben géén indexes (ook niet op batchId).
<sub>`src/lib/db/schema.ts:3390-3461`</sub>

#### chef_invoices + chef_vacation_requests + chef_expense_claims — geld en verlof vanuit de kok 🟠 half af

*ik wil dat een kok zijn eigen factuur, verlof of onkosten indient en dat ik daar één keer ja of nee op zeg, met spoor*

chef_invoices: ZZP-zelffacturatie — de kok maakt een concept, uploadt zijn eigen factuur-PDF naar R2 en dient in; kantoor zet op approved/paid/rejected met beslisnotitie. chef_vacation_requests: verlof in twee smaken (uitbetaling of vrije tijd). chef_expense_claims: onkosten per categorie (reiskosten, parkeren, OV, kilometers, overig) met bedrag, optionele dienstkoppeling en een R2-sleutel voor de bonfoto. Alle drie: pending → approved/rejected/cancelled met beslisser en notitie.

**Waar:** `chef-portaal facturen / verlof / onkosten` · `admin beoordelingsschermen`
**Let op:** chef_invoices is bewust volledig gescheiden van de klant-facturen (andere partijen, andere levenscyclus). De upload-UI voor de bonfoto is uitgesteld — de kolom receiptR2Key bestaat wel. Bedragen zijn de CLAIM van de kok; payroll/finance bevestigt.
<sub>`src/lib/db/schema.ts:2275-2331` · `src/lib/db/schema.ts:2341-2378`</sub>

#### chef_availability — beschikbaarheidskalender 🟢 live

*ik wil weten wie op een datum NIET kan, zonder dat koks elke dag iets moeten aanvinken*

Eén rij per (kok, datum) met available true/false plus een notitie. De regel is: geen rij = beschikbaar; de tabel wordt vooral gebruikt om geblokkeerde dagen vast te leggen.

**Waar:** `chef-portaal beschikbaarheid` · `matching / voorstel-flow`
**Let op:** Unique op (chefId, date). Er is GEEN index met datum vooraan, terwijl 'wie is vrij op 15 juni' precies zo filtert.
<sub>`src/lib/db/schema.ts:1123-1145`</sub>

#### shift_templates + exceptions — terugkerende diensten 🟢 live

*ik wil 'elke vrijdag 17:00 een sous-chef bij dit hotel' één keer instellen en dat het vanzelf blijft doorlopen*

Weekpatroon per klant (dag van de week, begin- en eindtijd, doorloopt-naar-volgende-dag-vlag voor nachtdiensten, headcount, tarieven) dat een dagelijkse worker materialiseert tot echte diensten binnen een rollend venster (standaard 28 dagen). Uitzonderingen slaan losse datums over (kerst, verbouwing).

**Waar:** `admin templates-scherm` · `dagelijkse generator-worker`
**Let op:** Gegenereerde diensten zijn ONAFHANKELIJK: de template later aanpassen herschrijft bestaande diensten niet. dayOfWeek volgt de Postgres-conventie 0=zondag. DB-check bewaakt 0..6.
<sub>`src/lib/db/schema.ts:2844-2910`</sub>

#### client_shift_change_requests — wijzigen/annuleren door de klant 🟢 live

*ik wil dat een hotel een omgezette dienst kan laten wijzigen of annuleren zonder dat mijn kok zomaar wordt overvallen*

Verzoek van soort 'change' of 'cancel' op elke dienststatus, met verplichte reden en een jsonb met de voorgestelde wijziging (datum/tijd, headcount, rol). Status pending → in_progress → approved/rejected met beslisser en beslisnotitie.

**Waar:** `/client/shifts/[shiftId]` · `admin verzoeken-wachtrij`
**Let op:** Partiële unique: één OPEN verzoek per dienst per soort — de klant kan niet spammen. Dit is nooit een directe mutatie; Chef & Serve bemiddelt omdat koks al toegezegd hebben.
<sub>`src/lib/db/schema.ts:2723-2767`</sub>

#### client_change_requests + profile_change_requests + profile_suggestions — gevoelige veldwijzigingen 🟢 live

*ik wil dat klanten en koks hun eigen gegevens kunnen bijwerken, behalve de velden die mijn facturen en marges kunnen breken*

Per aangevraagd veld één rij: veldnaam, huidige waarde-snapshot, voorgestelde waarde, reden, status. Bij klanten gaat het om bedrijfsnaam, KvK, btw, betaaltermijn, factuuradres en inlog-e-mail; bij koks om tarief, vakniveau, naam en e-mail. profile_suggestions is de AI/CV-variant: voorgestelde profielverbeteringen met een code-eigen veldklasse (safe/sensitive), modelvertrouwen en CV-hash, met pending/accepted/dismissed/superseded.

**Waar:** `/client/profiel` · `/chef/profile` · `admin goedkeurwachtrij`
**Let op:** Bewust drie aparte tabellen (andere entiteit, ander veldenset, andere beoordelaarstekst). Bij profile_suggestions bepaalt de CODE of een veld gevoelig is, nooit het model, en de voorgestelde waarde mag alleen een enum/array/korte string zijn — nooit ruwe CV-tekst. Partiële unique houdt CV-sweeps idempotent.
<sub>`src/lib/db/schema.ts:2660-2694` · `src/lib/db/schema.ts:2399-2440` · `src/lib/db/schema.ts:2463-2508`</sub>

#### placement_comments — het gesprek rond een plaatsing 🟢 live

*ik wil dat kantoor, klant en kok over dezelfde dienst kunnen praten zonder dat iemand meeleest wat niet voor hem bestemd is*

Berichten met een auteurssoort (klant/kantoor/kok/systeem) en een zichtbaarheid (internal / client_visible / chef_visible). Platte tekst, met jsonb-ruimte voor AI-samenvattingen en e-mailthread-ids.

**Waar:** `/client/shifts/[shiftId] berichten` · `chef shift-scherm` · `admin plaatsingsdetail`
**Let op:** Vervangt bewust het oude 'alles in placements.notes' (privacylek). DB-check begrenst berichten op 1..1000 tekens. Renderers mogen geen HTML injecteren.
<sub>`src/lib/db/schema.ts:3589-3624`</sub>

#### ratings — beoordelingen van koks 🟢 live

*ik wil weten welke kok het goed doet, zonder dat sterren een publiek scorebord worden*

1–5 sterren met Nederlandse tags en optionele opmerking. Twee bronnen: 'client' (na een dienst, gekoppeld aan de plaatsing) en 'internal' (Maartens eigen oordeel, zonder plaatsing/klant). De rollup op chefs (gemiddelde + aantal) wordt bijgewerkt in dezelfde transactie.

**Waar:** `klantfeedback na dienst` · `admin chef-profiel (interne beoordeling)`
**Let op:** V1 is intern: kantoor ziet alles, de kok ziet alleen zijn eigen gemiddelde vanaf 5 beoordelingen, andere klanten zien nooit iets. Interne beoordelingen tellen NIET mee in de publieke ster-rollup. ON DELETE RESTRICT zodat een beoordeling nooit stilletjes verdwijnt.
<sub>`src/lib/db/schema.ts:2935-2965`</sub>

#### match_intel + chef_client_prefs — relatiegeheugen kok ↔ hotel 🟢 live

*ik wil onthouden welke kok bij welk hotel past en wie er bewust niet meer heen wil*

match_intel: één rij per (kok, klant) met Maartens notitie, 'zou opnieuw inhuren' (klant) en 'zou terugkomen' (kok), plus een AI-geschreven waarom-dit-werkt en waarom-dit-mis-kan-gaan. chef_client_prefs: het spiegelbeeld vanuit de kok — favoriet, blokkeren, alleen bij spoed, alleen met betere briefing, alleen tegen hoger tarief.

**Waar:** `admin chef- en klantprofiel` · `matching / AI-vraag 'wie stuur ik hierheen?'`
**Let op:** Beide tabellen zijn puur OORDEEL — feiten zoals 'hoe vaak samengewerkt' blijven live berekend, niet gedupliceerd. Chef-voorkeuren zijn zacht (down-rank), nooit een harde uitsluiting: de planner blijft de baas. Klanten zien dit nooit.
<sub>`src/lib/db/schema.ts:1672-1699` · `src/lib/db/schema.ts:1742-1760`</sub>

#### shift_signals + shift_hour_reviews — wat er tijdens en na de dienst gebeurt 🟢 live

*ik wil tijdens een dienst weten dat een kok onderweg, vertraagd of in de problemen is, en achteraf horen of het ging zoals beloofd*

shift_signals: één-tik statussen vanaf het diensscherm (onderweg, vertraagd, hulp nodig, voel me onveilig, kan niet starten, al op locatie, langer doorgewerkt, geen pauze gehad). shift_hour_reviews: zes korte vragen na het uitklokken (juiste rol? extra uren? pauze gehad? zoals beschreven? knelpunt? zou je terugkomen?) — één rij per plaatsing.

**Waar:** `chef shift-scherm` · `admin dienst-tijdlijn / geschillenoverzicht`
**Let op:** Veiligheidssignalen zijn bedoeld om direct bij de eigenaar te landen. Het vrije `detail`-veld en de issue-notitie zijn DATA, nooit instructies voor de AI. De signaal-enum mag alleen worden UITGEBREID, nooit hergeordend.
<sub>`src/lib/db/schema.ts:1625-1662` · `src/lib/db/schema.ts:2227-2248`</sub>

#### shift_arrival_checks — aankomstzekerheid (privacy-first) ⚫ uit `ARRIVAL_TRUST_ENABLED (donker volgens de schema-toelichting)`

*ik wil 20 minuten voor aanvang weten of mijn kok er bijna is, zonder iemand te volgen*

Eén rij per (dienst, kok) met alleen de UITKOMST van een controle die op de telefoon van de kok zelf draait: monitoring / nearby / no_signal / permission_missing / stopped, met tijdstempels.

**Waar:** `chef-PWA (on-device check)` · `admin dienstscherm`
**Let op:** Er worden bewust GEEN coördinaten en GEEN route opgeslagen — alleen '<1 km ja/nee'. Dat is de AVG-verdediging: tijdelijk, gebonden aan één dienst, op het toestel berekend.
<sub>`src/lib/db/schema.ts:1586-1615`</sub>

#### escalations — noodgevallen en incidenten ⚫ uit `EMERGENCY_MODE_ENABLED — de schema-toelichting zegt expliciet dat er nog niets naar deze tabel schrijft tot de detectie is aangesloten`

*ik wil dat een dienst die dreigt te ontsporen op één lijst staat tot hij is opgelost*

Getrackte incidenten van vier soorten: kok zegt laat af (<24u), dienst nog onbezet (<12u), geaccepteerd-maar-niet-bevestigd vlak voor aanvang, en een urgent signaal van de kok. Status open → in_progress → resolved/stood_down, met wie het oploste, een notitie en eventueel de vervangende plaatsing die het sloot.

**Waar:** `admin dashboard / noodoverzicht` · `systeemdetectie (emergencies.ts)`
**Let op:** Partiële unique (shiftId, kind) WHERE open/in_progress maakt herdetectie een no-op. De `reason` is altijd een machinegemaakte Nederlandse zin, nooit de vrije tekst van een kok.
<sub>`src/lib/db/schema.ts:2783-2827`</sub>

#### shift_interests — 'ik wil deze dienst' vanuit de kok 🟢 live

*ik wil dat koks zich melden op open diensten, terwijl de planner blijft bepalen wie hem krijgt*

Eén rij per (dienst, kok) waarmee een kok interesse toont in een open dienst; intrekken zet withdrawnAt. Uitdrukkelijk GEEN zelf-inplannen — de planner maakt daarna de echte plaatsing.

**Waar:** `/chef/rooster (open diensten)` · `admin planbord`
**Let op:** Goed geïndexeerd (unique + per dienst + per kok). Onderscheid met spoedclaim: bij isEmergency + EMERGENCY_CLAIM_ENABLED kan de eerste geschikte kok wél direct claimen.
<sub>`src/lib/db/schema.ts:2620-2638`</sub>

#### chef_documents + client_documents — papieren en certificaten 🟢 live

*ik wil ID's, diploma's en HACCP-papieren op één plek, geverifieerd, en tijdig weten wanneer iets verloopt*

Metadata in de database, bestanden in Cloudflare R2 (privé; alleen kortlevende presigned links). Per document: type, bestandsnaam, R2-sleutel, status (uploaded/needs_review/verified/expired/rejected), of de klant het mag zien, wie het verifieerde en een harde vervaldatum. Klantzijde spiegelt dit voor o.a. het RI&E-document.

**Waar:** `/chef/profile documenten` · `/admin/business/chefs/[id]` · `workers/document-expiry.ts (waarschuwing 30 dagen vooraf)`
**Let op:** clientVisible staat standaard UIT (intern). Soft-delete houdt het auditspoor; de R2-bytes worden door een opruimworker verwijderd. Geen index op chefId/clientId, en geen index op expiresAt terwijl de vervalworker daar dagelijks op scant.
<sub>`src/lib/db/schema.ts:1265-1308` · `src/lib/db/schema.ts:3677-3696`</sub>

#### integration_outbox + runs + external_refs — alles wat naar buiten gaat 🟢 live

*ik wil dat externe systemen (payroll, boekhouding, push) altijd precies één keer iets te horen krijgen, ook als er iets crasht*

Elke neveneffect-gebeurtenis wordt eerst als rij weggeschreven met provider, event-type, entiteit, payload en een UNIEKE idempotency-key; workers pikken (provider, pending, nextAttemptAt < nu) op, met pogingteller, foutmelding en backoff. integration_runs groepeert exportruns met succes/faal-tellingen; external_refs koppelt onze ids aan externe ids (Payingit-medewerker, boekhoudklant, batchregel).

**Waar:** `enqueueIntegrationEvent() vanuit elke mutatie` · `Railway workers` · `/admin/business/integrations`
**Let op:** Harde regel in dit project: NOOIT een externe API-call binnen een bedrijfsmutatie — altijd via deze outbox. Opnieuw inschrijven met dezelfde key is een no-op (ON CONFLICT DO NOTHING).
<sub>`src/lib/db/schema.ts:1888-1978`</sub>

#### notifications + push_subscriptions + board_posts — wat gebruikers te zien krijgen 🟠 half af

*ik wil dat iedere gebruiker in de app ziet wat er voor hem gebeurd is, en dat ik mededelingen kwijt kan aan al mijn koks*

notifications is de in-app bel: type, titel, tekst, actie-URL, gekoppelde entiteit en een gelezen-marker. push_subscriptions bewaart per browser/toestel het web-push endpoint met foutteller en uitzet-tijdstip; dode endpoints worden door de bezorgworker opgeruimd. board_posts (+images in R2, +emoji-reacties) is het prikbord: kantoor plaatst mededelingen met doelgroep chefs of iedereen, gepind-eerst, soft-delete; chefs.boardSeenAt drijft het 'nieuw'-label.

**Waar:** `bel in elk portaal` · `createNotification() / notifyUser()` · `deliver-push worker`
**Let op:** De bel is de ondergrens en is live; Web Push staat in CLAUDE.md nog als uitgesteld open punt. notifications is geïndexeerd op (userId, readAt, createdAt) — de ongelezen-teller draait op elke paginarender. board_reactions heeft een VOLLEDIGE unique op (post, user, emoji), dus daar is een gewone onConflictDoNothing veilig.
<sub>`src/lib/db/schema.ts:2033-2058` · `src/lib/db/schema.ts:2522-2542` · `src/lib/db/schema.ts:2554-2608`</sub>

#### email_messages + email_events + inbound_messages + inboxes — mail in en uit 🟡 live achter vlag `RESEND_INBOUND_SECRET is volgens CLAUDE.md nog niet gezet — de inbound-webhook staat dus nog donker; de uitgaande kant is live`

*ik wil bewijs van elke mail die wij stuurden en niet missen wat chefs en hotels ons mailen*

Uitgaand: één rij per verzonden mail (ontvanger, template, event-key, gekoppelde entiteit, status) plus de ruwe Resend-webhook-gebeurtenissen voor bounce-onderzoek. Inkomend: e-mail die binnenkomt via de svix-geverifieerde Resend-webhook wordt gematcht aan een kok, klant of medewerker, grof geclassificeerd (vraag/klacht/spoed/overig) en afvinkbaar gemaakt met handledAt. inboxes + inbox_access bepalen welke medewerker welke postbus mag zien.

**Waar:** `/api/webhooks/resend-inbound` · `admin Berichten` · `sendEmail() + recordEmailMessage()`
**Let op:** bodyPreview van inkomende mail is ONVERTROUWDE inhoud: data, nooit instructies voor de AI. email_events heeft geen index op messageId. Zonder geconfigureerde inboxes ziet iedereen met clients.read alles.
<sub>`src/lib/db/schema.ts:1984-2025` · `src/lib/db/schema.ts:3842-3868` · `src/lib/db/schema.ts:3939-3966`</sub>

#### audit_log + error_log + webhooks_received — wie deed wat, en wat ging er stuk 🟢 live

*ik wil achteraf altijd kunnen aantonen wie welke wijziging deed, ook als iemand meekeek als een ander*

audit_log legt per mutatie vast: actor, actie, resource + id, voor- en na-waarde als jsonb, IP en user-agent — plus impersonatorUserId, zodat bij 'Bekijk als' zichtbaar blijft wie het ECHT deed. error_log is de minimale Sentry-vervanger met severity en opgelost-markering; webhooks_received bewaart ruwe binnenkomende webhooks met headers en handtekening-validiteit.

**Waar:** `/admin/system audit-schermen` · `withTx() mutatie+audit-paar`
**Let op:** Migratie 0075 voegde pas de index op (resource, resourceId) toe voor het 'alles rond deze kok/dienst'-spoor. Er is nog steeds geen index op createdAt of userId, terwijl de auditlijst daarop sorteert. error_log en webhooks_received hebben helemaal geen indexes.
<sub>`src/lib/db/schema.ts:441-504`</sub>

#### consent_log + privacy_requests + erasure-tombstones + retention_policies — AVG-machinerie 🟢 live

*ik wil kunnen bewijzen dat wij toestemming hadden, verzoeken binnen 30 dagen afhandelen en verwijderde mensen echt verwijderd houden*

consent_log houdt per gebruiker per documentversie de acceptatie vast met IP en user-agent. privacy_requests is het volledige dossier van een AVG-verzoek: soort, status, 30-dagen-deadline, intake via elk kanaal (ook post/telefoon), bewijsvoering van identiteitsverificatie, formele SLA-verlenging met reden en verzendmoment, correctie-scope, en de R2-sleutel van het exportpakket. privacy_request_messages logt alle correspondentie. Tombstones bewaren onomkeerbaar dát er gewist is — met een HMAC van het e-mailadres in plaats van het adres zelf — zodat een backup-restore of een nieuwe aanmelding oude PII niet terugbrengt. retention_policies legt per entiteit de bewaartermijn en de juridische grondslag vast.

**Waar:** `portaal-privacyverzoek` · `off-portal intake door kantoor` · `scripts/replay-erasure-tombstones.mjs na een restore`
**Let op:** privacy_requests heeft GEEN index op status of dueDate, terwijl dat precies de SLA-wachtrij is. Tombstones bevatten bewust geen herleidbare PII. Een verwijderde gebruiker wist nooit het compliance-record zelf (userId gaat op null, niet cascade).
<sub>`src/lib/db/schema.ts:3166-3378`</sub>

#### chef_metrics_daily + client_metrics_daily — de KPI-laag 🟢 live

*ik wil over elke periode kunnen optellen hoeveel er gewerkt, verdiend en verdiend-aan is, zonder verzonnen scores*

Eén rij per kok respectievelijk klant per dag, geschreven door workers/metrics-snapshot.ts. Alles is een optelbare maat op de natuurlijke datum van het feit: uren en geld op de goedkeurdatum van de uren, afgeronde diensten op einddatum, beoordelingen op aanmaakdatum, betrouwbaarheid op de gebeurtenisdatum. Klantzijde voegt vraag/vulling toe (diensten, slots, gevulde slots) en de goedkeur-SLA.

**Waar:** `nachtelijke metrics-snapshot worker` · `admin KPI/rapportage-schermen`
**Let op:** Elke periode = SOM over een datumbereik, elk gemiddelde = Σsom/Σaantal — daarom staan sum én count los opgeslagen. Geld en uren komen UITSLUITEND uit definitieve uren (goedgekeurd/geëxporteerd). Bij AVG-verwijdering vallen de metrics automatisch mee weg (cascade).
<sub>`src/lib/db/schema.ts:3761-3826`</sub>

#### chef_events + contact_logs — stille activiteitssignalen 🟢 live

*ik wil zien hoe snel en hoe betrouwbaar een kok reageert, en onthouden wat er in een telefoontje is afgesproken*

chef_events schrijft achter de schermen mee bij normale chef-acties (voorstel geaccepteerd/afgewezen, uren ingediend/afgekeurd, beschikbaarheid bijgewerkt, dienst geannuleerd) met afgeleide signalen als reactietijd en gewerkt-versus-gepland. contact_logs legt vast wanneer kantoor belt of appt, via welk kanaal, met welke uitkomst (geen gehoor / gesproken / terugbelverzoek) en een notitie.

**Waar:** `automatisch bij chef-acties (geen chef-UI)` · `'Bel chef'/'WhatsApp'-knop met uitkomstmodal`
**Let op:** chef_events is bewust onzichtbaar voor de kok. contact_logs heeft een index op (entityType, entityId) voor de diensttijdlijn, maar niet op targetId — 'alle contactmomenten met deze kok' is dus niet geïndexeerd.
<sub>`src/lib/db/schema.ts:3717-3745` · `src/lib/db/schema.ts:2064-2085`</sub>

#### ai_conversations + ai_feedback + ai_memory_proposals + ai_embeddings — de AI-laag 🟡 live achter vlag `ai_memory_proposals is donker tot AI_MEMORY_MINING_ENABLED aan staat (volgens CLAUDE.md nog uit); ai_conversations en ai_feedback zijn live`

*ik wil dat de assistent mijn gesprek onthoudt, dat ik duim-omhoog/omlaag kan geven, en dat hij feiten voorstelt die ik met één klik kan onthouden*

ai_conversations spiegelt het chatgesprek serverkant (één actief gesprek per gebruiker per portaal, berichten als begrensde jsonb-array) zodat een refresh of ander apparaat verdergaat. ai_feedback bewaart duim omhoog/omlaag met de vraag en het antwoord. ai_memory_proposals houdt door de nachtelijke mining voorgestelde feiten vast (bijv. 'Okura wil alleen sous-chefs') met status pending/accepted/dismissed. ai_embeddings (pgvector, buiten de journal) is de RAG-store: één rij per geredigeerd tekstblok met vector, bron, tenant-scope en zichtbaarheid.

**Waar:** `/api/ai/conversation (GET/PUT/DELETE)` · `/api/ai/feedback` · `nachtelijke mining- en RAG-ingest workers`
**Let op:** PII wordt bij het INDEXEREN geredigeerd, zodat vectoren en tekstblokken nooit e-mail/telefoon/BSN/IBAN bevatten; toegang wordt vóór het model gefilterd op tenant-scope en zichtbaarheid. Herindexeren zet superseded_at (nooit hard verwijderen). Partiële unique houdt één openstaand voorstel per (gebruiker, genormaliseerd feit).
<sub>`src/lib/db/schema.ts:3880-3930` · `src/lib/db/schema.ts:4029-4053` · `drizzle/manual_ai_embeddings.sql`</sub>

#### chef_submissions + client_submissions — binnenkomende aanvragen 🟢 live

*ik wil elke sollicitatie en elke personeelsaanvraag op één triage-lijst, zonder dubbelingen*

Ruwe payload plus uitgepakte velden van elk intakeformulier (Jotform of portaal). Status new → triaged → converted/rejected, met wie triageerde en waar het naartoe ging (chef-id, klant-id of zelfs de dienst die eruit voortkwam). Klanten kunnen een eigen openstaande aanvraag zelf intrekken.

**Waar:** `Jotform-webhook` · `klantportaal 'nieuwe aanvraag'` · `admin inbox/triage`
**Let op:** Unique op (source, externalId) maakt herhaalde webhook-leveringen onschadelijk. clientId is pas later toegevoegd om een cross-tenant gat te dichten (eerder werd op bedrijfsnaam gematcht — niet uniek).
<sub>`src/lib/db/schema.ts:641-772`</sub>

#### agenda_events + dashboard_signal_state + saved_searches — de werkdag van de eigenaar 🟢 live

*ik wil losse afspraken kwijt kunnen, signalen die ik heb afgehandeld laten verdwijnen, en mijn vaste zoekopdrachten met één klik terug*

agenda_events zijn de HANDMATIGE agenda-items die niet uit een andere rij volgen (intakegesprek, opvolging, onboardingtaak, contractstart, interne herinnering) met optionele checklist, koppeling aan klant/kok/dienst, eigenaar en status. dashboard_signal_state slaat alleen snooze/afgehandeld-metadata op bij een afgeleid dashboardsignaal, met een vingerafdruk zodat een afgehandeld signaal vanzelf terugkomt als de situatie verandert. saved_searches bewaart chef-zoekfilters als knoppen.

**Waar:** `admin agenda` · `admin dashboard (snooze/klaar)` · `/admin/business/chefs?<filters>`
**Let op:** Diensten en wijzigingsverzoeken staan NIET in agenda_events — die worden live afgeleid. dashboard_signal_state is nadrukkelijk geen tweede issue-opslag.
<sub>`src/lib/db/schema.ts:4071-4097` · `src/lib/db/schema.ts:3975-3985` · `src/lib/db/schema.ts:3996-4013`</sub>

> **Gaten in dit gebied**
> - INDEX-GAT (grootste): `shifts` heeft geen enkele index op clientId, startsAt of status — alleen de partiële unique op (sourceTemplateId, sourceTemplateDate). Planbord, agenda, klant-dienstenlijst en elk dashboardsignaal filteren precies op die kolommen.
> - INDEX-GAT: `placements` heeft wel een index op status en een unique op (chefId, shiftId), maar géén index met shiftId vooraan — 'welke koks staan op deze dienst' is de heetste join van het systeem en kan de unique index niet gebruiken.
> - INDEX-GAT: `chefs` en `clients` hebben buiten de primary key geen enkele index. De chef-directory filtert op status, city, vakniveau, ownerTags en rating; de klantlijst op status. Beide doen nu een volledige tabelscan.
> - INDEX-GAT: `chef_availability` is alleen unique op (chefId, date). De matching-vraag 'wie is vrij op datum X' filtert met datum vooraan en is niet geïndexeerd.
> - INDEX-GAT in de financiële staart: `invoice_lines` (geen index op invoiceId), `payroll_batch_lines` (geen index op batchId of shiftHoursId), `shift_hour_corrections` (geen indexes). Een factuur of batch openen doet dus telkens een scan.
> - INDEX-GAT in compliance/ops: `audit_log` heeft sinds migratie 0075 alleen (resource, resourceId) — geen createdAt of userId, terwijl de auditlijst daarop sorteert en filtert; `error_log`, `webhooks_received` en `email_events` (geen index op messageId) hebben helemaal niets; `privacy_requests` heeft geen index op status/dueDate hoewel dat de 30-dagen-SLA-wachtrij is; `chef_documents`/`client_docume
> - MANUAL SQL BUITEN DE JOURNAL — `drizzle/manual_pgvector_prep.sql`: zet de pgvector-extensie aan en voegt met ruwe SQL de kolommen embedding vector(1536), embedded_text_hash en embedded_at toe aan chefs, clients én shifts. Die kolommen staan NIET in schema.ts, dus Drizzle weet er niets van.
> - MANUAL SQL BUITEN DE JOURNAL — `drizzle/manual_ai_embeddings.sql`: maakt de RAG-tabel ai_embeddings (chunk_text, vector(1536), bron, tenant_scope, visibility, content_hash, superseded_at) plus vier indexes waaronder een HNSW-cosine index over alleen de levende chunks. `npm run db:migrate` past deze twee bestanden NOOIT toe — ze moeten met de hand per Neon-branch. Een verse branch mist ze stilzwijg

---

## Hoe dit bestand bijgewerkt blijft

Per het doc-contract in CLAUDE.md: bewerk dit bestand wanneer een **capability** verandert —
iets nieuws dat het systeem kan, of een status die verschuift. Niet voor refactors, niet voor
bugfixes, en nooit met een aantal erin. Zet geen historie hier neer; die hoort in
`docs/history/PR-LEDGER.md`.
