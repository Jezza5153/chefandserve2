import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the chef when the client has signed off on their submitted hours.
 * Informational only — no action required. Chef & Serve still has to give
 * the final approval before payroll runs.
 */
export function HoursSignedChefEmail({
  recipientName,
  clientName,
  shiftDate,
  workedHoursLabel,
  expectedAmountEur,
}: {
  recipientName: string;
  clientName: string;
  shiftDate: string;
  workedHoursLabel: string;
  expectedAmountEur: number;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const amountLabel = `€${expectedAmountEur.toFixed(2).replace(".", ",")}`;

  return (
    <EmailLayout
      preview={`Je uren zijn ondertekend door ${clientName}`}
    >
      <Heading as="h1" style={styles.h1}>
        Je uren zijn ondertekend
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        Je uren voor {clientName} op {dateLabel} zijn akkoord. Chef &amp;
        Serve controleert nu en zet daarna de uitbetaling in gang.
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
          <span style={styles.detailLabel}>Klant</span> {clientName}
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
        Je hoeft niets te doen — we laten je weten zodra de uitbetaling is
        ingepland.
      </Text>
    </EmailLayout>
  );
}
