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
        Nieuwe shift voor je klaar
      </Heading>
      <Text style={styles.lead}>Hoi {chefName.split(" ")[0]},</Text>
      <Text style={styles.para}>
        We hebben een nieuwe shift voor je klaarstaan bij {clientName}. Het
        gaat om {shiftRole} op {shiftWhen} in {shiftCity}.
      </Text>

      <Section style={{ margin: "24px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Rol</span> {shiftRole}
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
        {shiftNotes && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Notitie</span> {shiftNotes}
          </Text>
        )}
      </Section>

      <Text style={styles.para}>
        Bekijk de shift in je portaal en laat weten of je 'm aanneemt of
        afwijst. Dan houden we de planning strak.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={placementUrl} style={styles.button}>
          Bekijk shift
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
