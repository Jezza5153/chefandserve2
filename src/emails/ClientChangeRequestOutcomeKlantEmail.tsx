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
    ? `Beste ${contactName.split(" ")[0]},`
    : "Geachte heer/mevrouw,";
  const kindWord = kind === "cancel" ? "annulering" : "wijziging";
  const headline =
    outcome === "approved"
      ? `Je ${kindWord} is doorgevoerd`
      : `Je ${kindWord} is niet doorgevoerd`;

  return (
    <EmailLayout preview={`${headline} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        {headline}
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        We hebben je {kindWord}sverzoek voor de shift bij {companyName} bekeken.
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
          <span style={styles.detailLabel}>Shift</span> {shiftRole}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Wanneer</span> {shiftWhen}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Uitkomst</span>{" "}
          {outcome === "approved" ? "Doorgevoerd" : "Niet doorgevoerd"}
        </Text>
        {decisionNotes ? (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Toelichting</span> {decisionNotes}
          </Text>
        ) : null}
      </Section>

      <Text style={styles.para}>
        {outcome === "approved"
          ? "We hebben dit verwerkt. Bekijk de shift voor de actuele status."
          : "De shift blijft zoals gepland. Bel of mail ons gerust als je hierover wilt overleggen."}
      </Text>

      <Text style={styles.para}>
        <a href={shiftUrl} style={styles.button}>
          Bekijk shift
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
