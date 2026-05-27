import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to klant when a chef cancels an accepted/confirmed placement.
 * Maarten also gets a routable notification — this email is to the klant
 * so they're not surprised.
 */
export function ShiftCancelledByChefClientEmail({
  clientContactName,
  companyName,
  chefName,
  shiftWhen,
  reason,
  hoursUntilShift,
}: {
  clientContactName?: string | null;
  companyName: string;
  chefName: string;
  shiftWhen: string;
  reason: string;
  hoursUntilShift: number;
}) {
  const greeting = clientContactName
    ? `Beste ${clientContactName.split(" ")[0]},`
    : `Beste ${companyName},`;
  const urgencyLine =
    hoursUntilShift < 24
      ? "Wij zoeken nu direct vervanging en bellen je vandaag terug met een update."
      : hoursUntilShift < 48
        ? "Wij zoeken een vervanger en koppelen vandaag of morgen terug."
        : "Wij zoeken vervanging en koppelen ruim op tijd terug.";
  return (
    <EmailLayout preview={`Annulering: ${chefName} op ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        Chef heeft geannuleerd
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        Helaas heeft <strong>{chefName}</strong> de shift op {shiftWhen}{" "}
        moeten annuleren.
      </Text>

      <Section
        style={{
          margin: "20px 0",
          padding: "16px",
          backgroundColor: "#F7F8FA",
          borderLeft: `4px solid ${styles.burgundy}`,
          borderRadius: "4px",
        }}
      >
        <Text style={{ ...styles.para, fontStyle: "italic", margin: 0 }}>
          Reden van chef: &ldquo;{reason}&rdquo;
        </Text>
      </Section>

      <Text style={styles.para}>{urgencyLine}</Text>

      <Text style={styles.small}>
        Vragen? Bel Chef &amp; Serve direct. Onze excuses voor het ongemak.
      </Text>
    </EmailLayout>
  );
}
