import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the chef when admin has given the final approval on their hours.
 * Hours are now locked and routed to payroll.
 */
export function HoursApprovedChefEmail({
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
      preview={`Uren goedgekeurd — wordt uitbetaald`}
    >
      <Heading as="h1" style={styles.h1}>
        Je uren zijn goedgekeurd
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        Je uren voor je dienst bij {clientName} op {dateLabel} zijn definitief
        goedgekeurd.
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
          <span style={styles.detailLabel}>Gewerkte uren</span>{" "}
          {workedHoursLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Vergoeding</span> {amountLabel}
        </Text>
      </Section>

      <Text style={styles.para}>
        We zetten dit klaar voor uitbetaling volgens de normale betaalronde.
      </Text>
    </EmailLayout>
  );
}
