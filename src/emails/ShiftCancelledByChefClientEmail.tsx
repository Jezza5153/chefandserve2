import { Heading, Link, Section, Text } from "@react-email/components";
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
  hubUrl,
}: {
  clientContactName?: string | null;
  companyName: string;
  chefName: string;
  shiftWhen: string;
  reason: string;
  hoursUntilShift: number;
  hubUrl?: string;
}) {
  const greeting = clientContactName
    ? `Hallo ${clientContactName.split(" ")[0]},`
    : `Hallo ${companyName},`;
  const urgencyLine =
    hoursUntilShift < 24
      ? "We zoeken direct naar een passende oplossing en houden u vandaag op de hoogte via het portaal."
      : hoursUntilShift < 48
        ? "We zoeken direct naar een passende oplossing en houden u via het portaal op de hoogte."
        : "We zoeken direct naar een passende oplossing en houden u ruim op tijd op de hoogte via het portaal.";
  return (
    <EmailLayout preview={`Annulering: ${chefName} op ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        Een chef heeft geannuleerd
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        <strong>{chefName}</strong> heeft de dienst bij {companyName} op{" "}
        {shiftWhen} geannuleerd.
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
          <span style={styles.detailLabel}>Reden</span> {reason}
        </Text>
      </Section>

      <Text style={styles.para}>
        De dienst start over {hoursUntilShift} uur. {urgencyLine}
      </Text>

      {hubUrl && (
        <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
          <Link href={hubUrl} style={styles.button}>
            Bekijk dienst
          </Link>
        </Section>
      )}

      <Text style={styles.small}>
        Vragen? Bel Chef &amp; Serve direct. Onze excuses voor het ongemak.
      </Text>
    </EmailLayout>
  );
}
