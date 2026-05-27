import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent when a chef or client is invited to access their portal.
 * They receive this BEFORE their first magic-link login — explains what
 * the portal is, then a link to /login where they enter their email and
 * Resend sends the actual login link.
 */
export function PortalInviteEmail({
  recipientName,
  recipientKind, // 'chef' | 'client' | 'internal'
  loginUrl,
}: {
  recipientName: string;
  recipientKind: "chef" | "client" | "internal";
  loginUrl: string;
}) {
  const firstName = recipientName.split(" ")[0];
  const portalLabel =
    recipientKind === "chef"
      ? "chef-portaal"
      : recipientKind === "client"
        ? "klant-portaal"
        : "medewerker-portaal van Chef & Serve";

  const bullets: string[] =
    recipientKind === "chef"
      ? [
          "Shift-voorstellen van Maarten zien en accepteren of afwijzen",
          "Je komende shifts bekijken",
          "Je beschikbaarheid beheren",
          "Je profiel bekijken",
        ]
      : recipientKind === "client"
        ? [
            "Je geplande shifts en bevestigde chefs zien",
            "Nieuwe aanvragen indienen vanuit het portaal",
            "Je bedrijfsprofiel bekijken",
            "Facturen + betalingsstatus bekijken (binnenkort)",
          ]
        : [
            "Aanmeldingen converteren naar chefs en klanten",
            "Roosters samenstellen en chef-voorstellen versturen",
            "Volledige toegang tot alle inkomende aanvragen",
            "Eerste login: wachtwoord + 2FA setup verplicht (~90 sec)",
          ];

  return (
    <EmailLayout
      preview={`Je bent uitgenodigd voor het Chef & Serve ${portalLabel}`}
    >
      <Heading as="h1" style={styles.h1}>
        Welkom bij Chef &amp; Serve
      </Heading>
      <Text style={styles.lead}>
        Hoi {firstName}, je hebt nu toegang tot het {portalLabel}.
      </Text>

      <Text style={styles.para}>
        In het portaal kun je:
      </Text>
      <ul style={{ fontSize: "14px", lineHeight: "1.8", color: styles.ink, paddingLeft: "20px" }}>
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>

      <Text style={styles.para}>
        {recipientKind === "internal"
          ? "Klik op de knop hieronder om in te loggen. Bij je eerste login richt je je wachtwoord en 2FA in — dit duurt ~90 seconden."
          : "Klik op de knop hieronder om in te loggen. Wij sturen je een eenmalige link per e-mail — geen wachtwoord nodig."}
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={loginUrl} style={styles.button}>
          Inloggen
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link href={loginUrl} style={{ color: styles.burgundy, wordBreak: "break-all" }}>
          {loginUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
