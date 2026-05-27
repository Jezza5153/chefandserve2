import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/** Sent to client when a chef is confirmed for one of their shifts. */
export function ShiftConfirmedClientEmail({
  clientContactName,
  companyName,
  chefName,
  chefVakniveau,
  chefYears,
  shiftWhen,
  shiftLocation,
  shiftRole,
}: {
  clientContactName?: string | null;
  companyName: string;
  chefName: string;
  chefVakniveau?: string | null;
  chefYears?: number | null;
  shiftWhen: string;
  shiftLocation?: string | null;
  shiftRole: string;
}) {
  const greeting = clientContactName
    ? `Beste ${clientContactName.split(" ")[0]},`
    : "Geachte heer/mevrouw,";

  return (
    <EmailLayout
      preview={`Chef bevestigd voor ${companyName} — ${shiftWhen}`}
    >
      <Heading as="h1" style={styles.h1}>
        Uw chef is bevestigd
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        Goed nieuws — <strong>{chefName}</strong> komt bij {companyName} op{" "}
        {shiftWhen}.
      </Text>

      <Section style={{ margin: "24px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Chef</span> {chefName}
        </Text>
        {chefVakniveau && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Vakniveau</span> {chefVakniveau}
          </Text>
        )}
        {chefYears && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Ervaring</span> {chefYears} jaar
          </Text>
        )}
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Wanneer</span> {shiftWhen}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Rol</span> {shiftRole}
        </Text>
        {shiftLocation && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Locatie</span> {shiftLocation}
          </Text>
        )}
      </Section>

      <Text style={styles.para}>
        Bij vragen of wijzigingen — bel of mail het kantoor. Wij zijn 7
        dagen per week bereikbaar tijdens kantooruren.
      </Text>

      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Maarten &amp; het Chef &amp; Serve team
      </Text>
    </EmailLayout>
  );
}
