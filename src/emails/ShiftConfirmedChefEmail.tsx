import { Heading, Link, Section, Text } from "@react-email/components";
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
  placementUrl,
}: {
  chefName: string;
  clientName: string;
  shiftWhen: string;
  shiftLocation?: string | null;
  shiftRole: string;
  clientContactName?: string | null;
  clientContactPhone?: string | null;
  placementUrl?: string;
}) {
  const firstName = chefName.split(" ")[0];
  return (
    <EmailLayout preview={`Shift bevestigd bij ${clientName} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        Je shift is bevestigd
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        Je shift bij {clientName} is bevestigd. Je staat ingepland als{" "}
        {shiftRole} op {shiftWhen}.
      </Text>

      <Section
        style={{
          margin: "24px 0",
          padding: "16px",
          backgroundColor: "#F7F8FA",
          borderRadius: "6px",
        }}
      >
        {shiftLocation && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Locatie</span> {shiftLocation}
          </Text>
        )}
        {clientContactName && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Contactpersoon</span>{" "}
            {clientContactName}
          </Text>
        )}
        {clientContactPhone && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Telefoon</span>{" "}
            {clientContactPhone}
          </Text>
        )}
      </Section>

      {placementUrl && (
        <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
          <Link href={placementUrl} style={styles.button}>
            Bekijk shift
          </Link>
        </Section>
      )}

      <Text style={styles.para}>
        Ben je verhinderd of klopt er iets niet? Laat het direct weten via je
        portaal, zodat we snel kunnen schakelen.
      </Text>
    </EmailLayout>
  );
}
