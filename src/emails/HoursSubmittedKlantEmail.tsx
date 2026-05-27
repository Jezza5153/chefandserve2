import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the client contact when a chef has submitted their hours for a
 * shift. The client reviews and either signs off or rejects with a note.
 */
export function HoursSubmittedKlantEmail({
  recipientName,
  chefName,
  shiftDate,
  scheduledStart,
  scheduledEnd,
  actualStart,
  actualEnd,
  breakMinutes,
  workedHoursLabel,
  expectedAmountEur,
  signUrl,
}: {
  recipientName: string;
  chefName: string;
  shiftDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart: string;
  actualEnd: string;
  breakMinutes: number;
  workedHoursLabel: string;
  expectedAmountEur: number;
  signUrl: string;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const chefFirst = chefName.split(" ")[0];
  const amountLabel = `€${expectedAmountEur.toFixed(2).replace(".", ",")}`;
  const breakLabel = `${breakMinutes} min`;

  return (
    <EmailLayout
      preview={`Uren te ondertekenen — ${chefName} op ${dateLabel}`}
    >
      <Heading as="h1" style={styles.h1}>
        Uren te ondertekenen
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        {chefFirst} heeft zijn uren ingediend voor de shift op {dateLabel}.
        Even controleren en akkoord geven (of niet).
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
          <span style={styles.detailLabel}>Gepland</span> {scheduledStart}–
          {scheduledEnd}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Ingevuld</span> {actualStart}–
          {actualEnd}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Pauze</span> {breakLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Totaal</span> {workedHoursLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Bedrag</span> {amountLabel}
        </Text>
      </Section>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={signUrl} style={styles.button}>
          Akkoord geven
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link
          href={signUrl}
          style={{ color: styles.burgundy, wordBreak: "break-all" }}
        >
          {signUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
