import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the OLD billing email when a klant changes their facturatie-e-mail
 * directly in the portal (PR-KLANT-1). A security/anti-takeover confirmation:
 * if the change wasn't them, they have a 7-day window to flag it.
 *
 * Goes to the OLD address on purpose — the new address already "knows".
 */
export function BillingEmailChangedKlantEmail({
  companyName,
  oldEmail,
  newEmail,
}: {
  companyName: string;
  oldEmail: string;
  newEmail: string;
}) {
  return (
    <EmailLayout
      preview={`Facturatie-e-mail gewijzigd voor ${companyName}`}
      footerNote="Je ontvangt deze melding omdat dit het vorige facturatie-e-mailadres was."
    >
      <Heading as="h1" style={styles.h1}>
        Facturatie-e-mail gewijzigd
      </Heading>
      <Text style={styles.lead}>Hallo,</Text>
      <Text style={styles.para}>
        Het facturatie-e-mailadres van {companyName} is gewijzigd.
      </Text>

      <Section
        style={{
          margin: "24px 0",
          padding: "16px",
          backgroundColor: "#F7F8FA",
          borderRadius: "6px",
        }}
      >
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Oud e-mailadres</span> {oldEmail}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Nieuw e-mailadres</span> {newEmail}
        </Text>
      </Section>

      <Text style={styles.para}>
        Was dit niet de bedoeling? Neem dan binnen 7 dagen contact met ons op,
        dan kunnen we dit controleren en waar nodig terugdraaien.
      </Text>

      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Maarten &amp; het Chef &amp; Serve team
      </Text>
    </EmailLayout>
  );
}
