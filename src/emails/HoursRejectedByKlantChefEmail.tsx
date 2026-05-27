import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the chef when the client has rejected their submitted hours.
 * Includes the client's note so the chef knows what to fix.
 */
export function HoursRejectedByKlantChefEmail({
  recipientName,
  clientName,
  shiftDate,
  klantNote,
  editUrl,
}: {
  recipientName: string;
  clientName: string;
  shiftDate: string;
  klantNote: string;
  editUrl: string;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <EmailLayout
      preview={`Uren-correctie nodig — ${clientName}`}
    >
      <Heading as="h1" style={styles.h1}>
        Uren-correctie nodig
      </Heading>
      <Text style={styles.lead}>
        Hoi {firstName}, {clientName} heeft je uren teruggegeven met deze
        opmerking:
      </Text>

      <Section
        style={{
          margin: "24px 0",
          padding: "16px 20px",
          backgroundColor: "#F7F8FA",
          borderLeft: `3px solid ${styles.burgundy}`,
          borderRadius: "4px",
        }}
      >
        <Text
          style={{
            ...styles.para,
            margin: 0,
            fontStyle: "italic",
            color: styles.ink,
          }}
        >
          {klantNote}
        </Text>
      </Section>

      <Text style={styles.para}>
        Pas je uren aan en dien opnieuw in. Daarna gaat het automatisch terug
        naar de klant.
      </Text>

      <Text style={styles.small}>
        <span style={styles.detailLabel}>Datum</span> {dateLabel}
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={editUrl} style={styles.button}>
          Uren aanpassen
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link
          href={editUrl}
          style={{ color: styles.burgundy, wordBreak: "break-all" }}
        >
          {editUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
