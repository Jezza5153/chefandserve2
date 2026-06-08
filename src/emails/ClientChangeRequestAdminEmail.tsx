import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the admin routable group when a klant files a shift change- or
 * cancellation-request from the portal (PR-KLANT-2). Chefs are already
 * committed to these shifts, so a human must mediate — this is the ping.
 */
export function ClientChangeRequestAdminEmail({
  companyName,
  kind,
  shiftWhen,
  shiftRole,
  reason,
  adminUrl,
}: {
  companyName: string;
  kind: "change" | "cancel";
  shiftWhen: string;
  shiftRole: string;
  reason: string;
  adminUrl: string;
}) {
  const kindLabel = kind === "cancel" ? "Annuleringsverzoek" : "Wijzigingsverzoek";

  return (
    <EmailLayout preview={`${kindLabel} van ${companyName} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        Nieuw klantverzoek
      </Heading>
      <Text style={styles.lead}>
        {companyName} heeft een {kind === "cancel" ? "annulering" : "wijziging"}
        -verzoek ingediend.
      </Text>

      <Text style={styles.detailLabel}>Dienst</Text>
      <Section
        style={{
          margin: "24px 0",
          padding: "16px",
          backgroundColor: "#F7F8FA",
          borderRadius: "6px",
        }}
      >
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Rol</span> {shiftRole}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Moment</span> {shiftWhen}
        </Text>
      </Section>

      <Text style={styles.para}>Reden: {reason}</Text>

      <Text style={styles.para}>
        Bekijk het verzoek in het portaal en neem een beslissing.
      </Text>

      <Text style={styles.para}>
        <a href={adminUrl} style={styles.button}>
          Verzoek bekijken
        </a>
      </Text>
    </EmailLayout>
  );
}
