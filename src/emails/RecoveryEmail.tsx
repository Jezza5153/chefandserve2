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
  const firstName = recipientName.split(" ")[0] || "daar";
  const title =
    intent === "password" ? "Wachtwoord opnieuw instellen" : "2FA herstellen";
  const preview =
    intent === "password"
      ? "Klik op de link om je wachtwoord opnieuw in te stellen."
      : "Klik op de link om opnieuw 2FA in te stellen.";
  const lead =
    intent === "password"
      ? `Hoi ${firstName}, je hebt aangegeven dat je je wachtwoord wilt herstellen.`
      : `Hoi ${firstName}, je hebt aangegeven dat je geen toegang meer hebt tot je authenticator-app.`;
  const followup =
    intent === "password"
      ? "Klik op de knop hieronder. Je hebt je huidige 2FA-code uit je authenticator-app nodig om een nieuw wachtwoord in te stellen."
      : "Klik op de knop hieronder. Je hebt één van je recovery codes nodig (formaat ABCD-EFGH-IJKL). Daarna richt je via de wizard opnieuw 2FA in.";

  return (
    <EmailLayout preview={preview}>
      <Heading as="h1" style={styles.h1}>
        {title}
      </Heading>
      <Text style={styles.lead}>{lead}</Text>

      <Text style={styles.para}>{followup}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={recoveryUrl} style={styles.button}>
          {intent === "password" ? "Wachtwoord herstellen" : "2FA herstellen"}
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

      <Text style={styles.small}>
        De link is 15 minuten geldig en kan maar één keer gebruikt worden. Heb
        je deze herstelmail niet zelf aangevraagd? Negeer dit bericht — er
        verandert dan niets aan je account.
      </Text>
    </EmailLayout>
  );
}
