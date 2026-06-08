import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the klant when Chef & Serve decides on their shift change-/cancel-
 * request (PR-KLANT-2). Plain Dutch, always ends with a clear next step.
 */
export function ClientChangeRequestOutcomeKlantEmail({
  contactName,
  companyName,
  kind,
  outcome,
  shiftWhen,
  shiftRole,
  decisionNotes,
  shiftUrl,
}: {
  contactName?: string | null;
  companyName: string;
  kind: "change" | "cancel";
  outcome: "approved" | "rejected";
  shiftWhen: string;
  shiftRole: string;
  decisionNotes?: string | null;
  shiftUrl: string;
}) {
  const greeting = contactName
    ? `Hallo ${contactName},`
    : "Geachte heer/mevrouw,";
  const kindWord = kind === "cancel" ? "annulering" : "wijziging";
  const outcomeWord = outcome === "approved" ? "goedgekeurd" : "afgewezen";
  const headline =
    outcome === "approved"
      ? `Je ${kindWord} is doorgevoerd`
      : `Je ${kindWord} is niet doorgevoerd`;

  return (
    <EmailLayout preview={`${headline} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        Uitkomst van uw verzoek
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        Uw {kindWord}-verzoek voor {companyName} is {outcomeWord}.
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

      {decisionNotes ? (
        <Text style={styles.para}>Toelichting: {decisionNotes}</Text>
      ) : null}

      <Text style={styles.para}>
        Bekijk de details in het portaal. Daar ziet u ook wat dit betekent voor
        de planning.
      </Text>

      <Text style={styles.para}>
        <a href={shiftUrl} style={styles.button}>
          Bekijk dienst
        </a>
      </Text>

      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Maarten &amp; het Chef &amp; Serve team
      </Text>
    </EmailLayout>
  );
}
