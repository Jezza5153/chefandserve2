import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the data subject when their privacy request is decided (PR-AVG-1/2):
 * fulfilled / partially_fulfilled / rejected. For access/export, may include a
 * note that a download link follows separately (links are short-lived, art.15/20).
 */
export function PrivacyRequestOutcomeEmail({
  requesterName,
  type,
  outcome,
  decisionNotes,
  retainedExplanation,
}: {
  requesterName?: string | null;
  type: string;
  outcome: "fulfilled" | "partially_fulfilled" | "rejected";
  decisionNotes?: string | null;
  retainedExplanation?: string | null;
}) {
  const greeting = requesterName ? `Beste ${requesterName.split(" ")[0]},` : "Beste,";
  const headline =
    outcome === "rejected"
      ? "Je verzoek is afgewezen"
      : outcome === "partially_fulfilled"
        ? "Je verzoek is deels afgehandeld"
        : "Je verzoek is afgehandeld";

  return (
    <EmailLayout preview={`Privacyverzoek (${type}) — ${headline}`}>
      <Heading as="h1" style={styles.h1}>{headline}</Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        We hebben je AVG-verzoek ({type}) behandeld. Uitkomst:{" "}
        <strong>
          {outcome === "fulfilled"
            ? "afgehandeld"
            : outcome === "partially_fulfilled"
              ? "deels afgehandeld"
              : "afgewezen"}
        </strong>
        .
      </Text>
      {decisionNotes ? (
        <Section style={{ margin: "16px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}>
          <Text style={styles.para}>{decisionNotes}</Text>
        </Section>
      ) : null}
      {retainedExplanation ? (
        <Text style={styles.small}>
          <strong>Wat we moeten bewaren:</strong> {retainedExplanation}
        </Text>
      ) : null}
      <Text style={styles.para}>
        Vragen over deze afhandeling? Reageer op deze mail of bel het kantoor.
      </Text>
      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Chef &amp; Serve
      </Text>
    </EmailLayout>
  );
}
