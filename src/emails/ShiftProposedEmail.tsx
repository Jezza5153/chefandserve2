import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to a chef when admin proposes them for a shift.
 * CTA → /chef/shifts/[placementId] where chef can accept/reject.
 */
export function ShiftProposedEmail({
  chefName,
  clientName,
  shiftWhen,
  shiftRole,
  shiftCity,
  shiftRateEur,
  shiftNotes,
  placementUrl,
}: {
  chefName: string;
  clientName: string;
  shiftWhen: string; // pre-formatted "Maandag 15 juni, 18:00–23:00"
  shiftRole: string;
  shiftCity?: string | null;
  shiftRateEur?: number | null;
  shiftNotes?: string | null;
  placementUrl: string;
}) {
  return (
    <EmailLayout
      preview={`Nieuwe shift-aanbieding bij ${clientName}`}
    >
      <Heading as="h1" style={styles.h1}>
        Hoi {chefName.split(" ")[0]}, een nieuwe shift voor je
      </Heading>
      <Text style={styles.lead}>
        Maarten heeft je voorgesteld voor onderstaande shift. Reageer zo
        snel mogelijk — andere chefs staan ook in de wachtrij.
      </Text>

      <Section style={{ margin: "24px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Klant</span> {clientName}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Rol</span> {shiftRole}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Wanneer</span> {shiftWhen}
        </Text>
        {shiftCity && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Locatie</span> {shiftCity}
          </Text>
        )}
        {shiftRateEur && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Tarief</span> €
            {shiftRateEur.toFixed(2)}/uur
          </Text>
        )}
      </Section>

      {shiftNotes && (
        <Text style={styles.para}>
          <strong>Notitie van Maarten:</strong> {shiftNotes}
        </Text>
      )}

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={placementUrl} style={styles.button}>
          Bekijk &amp; reageer
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link href={placementUrl} style={{ color: styles.burgundy, wordBreak: "break-all" }}>
          {placementUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
