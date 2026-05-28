import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the privacy-routable admins when a data-subject request arrives
 * (PR-AVG-1) — portal or off-portal. Starts the 30-day SLA clock awareness.
 */
export function PrivacyRequestReceivedAdminEmail({
  requesterLabel,
  type,
  channel,
  dueDate,
  adminUrl,
}: {
  requesterLabel: string;
  type: string;
  channel: string;
  dueDate: string;
  adminUrl: string;
}) {
  return (
    <EmailLayout preview={`Privacyverzoek (${type}) van ${requesterLabel}`}>
      <Heading as="h1" style={styles.h1}>
        Nieuw privacyverzoek
      </Heading>
      <Text style={styles.lead}>
        Er is een AVG-verzoek binnengekomen. De wettelijke reactietermijn is 30
        dagen.
      </Text>
      <Section style={{ margin: "24px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}>
        <Text style={styles.detailRow}><span style={styles.detailLabel}>Aanvrager</span> {requesterLabel}</Text>
        <Text style={styles.detailRow}><span style={styles.detailLabel}>Type</span> {type}</Text>
        <Text style={styles.detailRow}><span style={styles.detailLabel}>Kanaal</span> {channel}</Text>
        <Text style={styles.detailRow}><span style={styles.detailLabel}>Uiterlijk</span> {dueDate}</Text>
      </Section>
      <Text style={styles.para}>
        Verifieer eerst de identiteit. Een super_admin handelt het verzoek af.
      </Text>
      <Text style={styles.para}>
        <a href={adminUrl} style={styles.button}>Open in admin</a>
      </Text>
    </EmailLayout>
  );
}
