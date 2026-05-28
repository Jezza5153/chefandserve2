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
        {kindLabel} van {companyName}
      </Heading>
      <Text style={styles.lead}>
        {companyName} heeft via het portaal een {kind === "cancel" ? "annulering" : "wijziging"}{" "}
        aangevraagd voor een ingeplande shift.
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
          <span style={styles.detailLabel}>Type</span> {kindLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Shift</span> {shiftRole}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Wanneer</span> {shiftWhen}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Reden</span> {reason}
        </Text>
      </Section>

      <Text style={styles.para}>
        {kind === "cancel"
          ? "Neem contact op met de klant én de ingeplande chef voordat je de shift annuleert."
          : "Beoordeel de gewenste wijziging en koppel terug naar de klant."}
      </Text>

      <Text style={styles.para}>
        <a href={adminUrl} style={styles.button}>
          Open in admin
        </a>
      </Text>
    </EmailLayout>
  );
}
