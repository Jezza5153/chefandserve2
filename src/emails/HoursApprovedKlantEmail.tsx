import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the client when admin has given the final approval on chef hours
 * for one of their shifts. The invoice follows within 5 working days.
 */
export function HoursApprovedKlantEmail({
  recipientName,
  chefName,
  shiftDate,
  workedHoursLabel,
  clientAmountEur,
}: {
  recipientName: string;
  chefName: string;
  shiftDate: string;
  workedHoursLabel: string;
  clientAmountEur: number;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const amountLabel = `€${clientAmountEur.toFixed(2).replace(".", ",")}`;

  return (
    <EmailLayout
      preview={`Uren afgerond voor ${dateLabel} — factuur volgt`}
    >
      <Heading as="h1" style={styles.h1}>
        Uren afgerond
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        De uren van {chefName} voor {dateLabel} zijn definitief afgerond. De
        factuur volgt binnen 5 werkdagen op het factuur-e-mailadres.
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
          <span style={styles.detailLabel}>Chef</span> {chefName}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Datum</span> {dateLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Totaal</span> {workedHoursLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Bedrag</span> {amountLabel}
        </Text>
      </Section>

      <Text style={styles.small}>
        Vragen over de factuur of de shift? Bel of mail het kantoor.
      </Text>
    </EmailLayout>
  );
}
