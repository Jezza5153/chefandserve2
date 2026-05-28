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
        Je facturatie-e-mail is gewijzigd
      </Heading>
      <Text style={styles.lead}>Beste relatie van {companyName},</Text>
      <Text style={styles.para}>
        Het facturatie-e-mailadres voor {companyName} is zojuist aangepast in
        het Chef &amp; Serve portaal.
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
          <span style={styles.detailLabel}>Was</span> {oldEmail}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Nu</span> {newEmail}
        </Text>
      </Section>

      <Text style={styles.para}>
        <strong>Heb jij dit niet gedaan?</strong> Mail of bel Chef &amp; Serve
        binnen 7 dagen, dan draaien we de wijziging terug. Tot die tijd
        versturen we facturen naar het nieuwe adres.
      </Text>

      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Maarten &amp; het Chef &amp; Serve team
      </Text>
    </EmailLayout>
  );
}
