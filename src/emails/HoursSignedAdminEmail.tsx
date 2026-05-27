import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to admin recipients (via recipientsFor('hours_signed')) when a
 * client has signed off on a chef's hours. Admin still has to approve
 * before payroll runs.
 */
export function HoursSignedAdminEmail({
  chefName,
  clientName,
  shiftDate,
  workedHoursLabel,
  chefAmountEur,
  clientAmountEur,
  marginEur,
  approveUrl,
}: {
  chefName: string;
  clientName: string;
  shiftDate: string;
  workedHoursLabel: string;
  chefAmountEur: number;
  clientAmountEur: number;
  marginEur: number;
  approveUrl: string;
}): React.ReactElement {
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const chefAmountLabel = `€${chefAmountEur.toFixed(2).replace(".", ",")}`;
  const clientAmountLabel = `€${clientAmountEur.toFixed(2).replace(".", ",")}`;
  const marginLabel = `€${marginEur.toFixed(2).replace(".", ",")}`;

  return (
    <EmailLayout
      preview={`Uren goedgekeurd door ${clientName} — keuren?`}
    >
      <Heading as="h1" style={styles.h1}>
        Uren wachten op je goedkeuring
      </Heading>
      <Text style={styles.lead}>
        {clientName} heeft de uren van {chefName} ondertekend voor {dateLabel}.
        Even controleren en goedkeuren, daarna gaat het naar de payroll.
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
          <span style={styles.detailLabel}>Klant</span> {clientName}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Datum</span> {dateLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Totaal</span> {workedHoursLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Chef-kost</span> {chefAmountLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Klant-omzet</span>{" "}
          {clientAmountLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Marge</span> {marginLabel}
        </Text>
      </Section>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={approveUrl} style={styles.button}>
          Keur uren
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link
          href={approveUrl}
          style={{ color: styles.burgundy, wordBreak: "break-all" }}
        >
          {approveUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
