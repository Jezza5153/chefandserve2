import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to chef when admin confirms a placement.
 *
 * Until PR-CHEF-5 only the klant got this. Chef closes the loop too —
 * email + in-app notification when their accepted shift goes confirmed.
 */
export function ShiftConfirmedChefEmail({
  chefName,
  clientName,
  shiftWhen,
  shiftLocation,
  shiftRole,
  clientContactName,
  clientContactPhone,
}: {
  chefName: string;
  clientName: string;
  shiftWhen: string;
  shiftLocation?: string | null;
  shiftRole: string;
  clientContactName?: string | null;
  clientContactPhone?: string | null;
}) {
  const firstName = chefName.split(" ")[0];
  return (
    <EmailLayout preview={`Shift bevestigd bij ${clientName} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        Shift bevestigd
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        Chef &amp; Serve heeft je shift bij <strong>{clientName}</strong> op{" "}
        {shiftWhen} bevestigd. Je staat in het rooster.
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
          <span style={styles.detailLabel}>Rol</span> {shiftRole}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Wanneer</span> {shiftWhen}
        </Text>
        {shiftLocation && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Locatie</span> {shiftLocation}
          </Text>
        )}
        {clientContactName && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Contact</span> {clientContactName}
            {clientContactPhone ? ` · ${clientContactPhone}` : ""}
          </Text>
        )}
      </Section>

      <Text style={styles.para}>
        Onverwacht verhinderd? Annuleer in het portaal én bel het kantoor
        direct als het minder dan 24 uur duurt.
      </Text>

      <Text style={styles.small}>
        Succes op je shift. Na afloop dien je je uren in via het portaal.
      </Text>
    </EmailLayout>
  );
}
