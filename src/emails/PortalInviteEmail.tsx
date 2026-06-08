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

  const greeting =
    recipientKind === "chef" ? `Hoi ${firstName},` : `Hallo ${firstName},`;
  const intro =
    recipientKind === "chef"
      ? "Je toegang tot het Chef & Serve-portaal staat klaar. Hier vind je je diensten, planning, gegevens en uren."
      : recipientKind === "client"
        ? "Uw toegang tot het Chef & Serve-portaal staat klaar. Hier vindt u de planning, diensten, chef-voorstellen en uren die bevestigd moeten worden."
        : "Je toegang tot het interne Chef & Serve-portaal staat klaar.";
  const followup =
    recipientKind === "chef"
      ? "Log in via de knop hieronder en controleer meteen of je profiel compleet is."
      : recipientKind === "client"
        ? "Log in via de knop hieronder om het portaal te openen."
        : "Log in via de knop hieronder en controleer je toegang.";

  return (
    <EmailLayout
      preview={`Je bent uitgenodigd voor het Chef & Serve ${portalLabel}`}
    >
      <Heading as="h1" style={styles.h1}>
        Welkom bij Chef &amp; Serve
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>

      <Text style={styles.para}>{intro}</Text>

      <Text style={styles.para}>{followup}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={loginUrl} style={styles.button}>
          Open portaal
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
