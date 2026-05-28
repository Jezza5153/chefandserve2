import { Heading, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the data subject when we extend the response term (PR-AVG-1).
 * AVG art. 12(3): a 2-month extension is allowed when necessary, but the
 * requester MUST be informed within the first month + given the reason.
 */
export function PrivacyRequestExtensionEmail({
  requesterName,
  newDueDate,
  reason,
}: {
  requesterName?: string | null;
  newDueDate: string;
  reason: string;
}) {
  const greeting = requesterName ? `Beste ${requesterName.split(" ")[0]},` : "Beste,";
  return (
    <EmailLayout preview="Verlenging behandeltermijn privacyverzoek">
      <Heading as="h1" style={styles.h1}>
        We hebben iets meer tijd nodig
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        We hebben je privacyverzoek in behandeling. Vanwege de aard van het
        verzoek verlengen we de behandeltermijn. Je hoort uiterlijk{" "}
        <strong>{newDueDate}</strong> van ons.
      </Text>
      <Text style={styles.para}>
        <strong>Reden:</strong> {reason}
      </Text>
      <Text style={styles.para}>
        Heb je vragen? Reageer gerust op deze mail.
        <br />
        <br />
        Met vriendelijke groet,
        <br />
        Chef &amp; Serve
      </Text>
    </EmailLayout>
  );
}
