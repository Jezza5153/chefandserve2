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
  recipientKind, // 'chef' | 'client'
  loginUrl,
}: {
  recipientName: string;
  recipientKind: "chef" | "client";
  loginUrl: string;
}) {
  const isChef = recipientKind === "chef";

  return (
    <EmailLayout
      preview={`Je bent uitgenodigd voor het Chef & Serve portaal`}
    >
      <Heading as="h1" style={styles.h1}>
        Welkom bij Chef &amp; Serve
      </Heading>
      <Text style={styles.lead}>
        Hoi {recipientName.split(" ")[0]}, je hebt nu toegang tot het{" "}
        {isChef ? "chef-portaal" : "klant-portaal"}.
      </Text>

      {isChef ? (
        <>
          <Text style={styles.para}>
            In het portaal kun je:
          </Text>
          <ul style={{ fontSize: "14px", lineHeight: "1.8", color: styles.ink, paddingLeft: "20px" }}>
            <li>Shift-voorstellen van Maarten zien en accepteren of afwijzen</li>
            <li>Je komende shifts bekijken</li>
            <li>Je beschikbaarheid beheren (binnenkort)</li>
            <li>Je uren indienen na elke shift (binnenkort)</li>
          </ul>
        </>
      ) : (
        <>
          <Text style={styles.para}>
            In het portaal kun je:
          </Text>
          <ul style={{ fontSize: "14px", lineHeight: "1.8", color: styles.ink, paddingLeft: "20px" }}>
            <li>Je geplande shifts en bevestigde chefs zien</li>
            <li>Nieuwe aanvragen indienen (binnenkort in portaal)</li>
            <li>Facturen + betalingsstatus bekijken (binnenkort)</li>
            <li>Chefs beoordelen na elke shift (binnenkort)</li>
          </ul>
        </>
      )}

      <Text style={styles.para}>
        Klik op de knop hieronder om in te loggen. Wij sturen je een
        eenmalige link per e-mail — geen wachtwoord nodig.
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
