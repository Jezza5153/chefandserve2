import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent when an internal user requests recovery for a forgotten password or
 * lost authenticator. PR-C / Fence 5: the link encodes a purpose-bound token
 * that is single-use and intent-bound (password vs totp).
 */
export function RecoveryEmail({
  recipientName,
  intent,
  recoveryUrl,
}: {
  recipientName: string;
  intent: "password" | "totp";
  recoveryUrl: string;
}) {
  const title =
    intent === "password" ? "Wachtwoord opnieuw instellen" : "2FA herstellen";
  const preview =
    intent === "password"
      ? "Klik op de link om je wachtwoord opnieuw in te stellen."
      : "Klik op de link om opnieuw 2FA in te stellen.";
  const lead = `Hallo ${recipientName},`;
  const reason =
    intent === "password"
      ? "Er is een verzoek gedaan om je wachtwoord voor Chef & Serve te herstellen."
      : "Er is een verzoek gedaan om je tweestapsverificatie voor Chef & Serve te herstellen.";
  const followup =
    intent === "password"
      ? "Gebruik de knop hieronder om een nieuw wachtwoord in te stellen. De link is eenmalig en 15 minuten geldig."
      : "Gebruik de knop hieronder om je herstelproces te starten. De link is eenmalig en 15 minuten geldig.";

  return (
    <EmailLayout preview={preview}>
      <Heading as="h1" style={styles.h1}>
        {title}
      </Heading>
      <Text style={styles.lead}>{lead}</Text>

      <Text style={styles.para}>{reason}</Text>

      <Text style={styles.para}>{followup}</Text>

      <Text style={styles.para}>
        Heb je dit niet aangevraagd? Dan kun je deze mail negeren.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={recoveryUrl} style={styles.button}>
          {intent === "password" ? "Wachtwoord herstellen" : "Herstel starten"}
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link
          href={recoveryUrl}
          style={{ color: styles.burgundy, wordBreak: "break-all" }}
        >
          {recoveryUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
