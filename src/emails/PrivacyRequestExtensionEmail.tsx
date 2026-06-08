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
  const greeting = requesterName ? `Hallo ${requesterName},` : "Hallo,";
  return (
    <EmailLayout preview="Verlenging behandeltermijn privacyverzoek">
      <Heading as="h1" style={styles.h1}>
        Behandeltermijn verlengd
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        We hebben meer tijd nodig om uw privacyverzoek zorgvuldig te behandelen.
        Daarom verlengen we de behandeltermijn tot <strong>{newDueDate}</strong>.
      </Text>
      <Text style={styles.para}>
        Reden: {reason}
      </Text>
      <Text style={styles.para}>
        U hoeft nu niets te doen. We houden u op de hoogte van de uitkomst.
      </Text>
    </EmailLayout>
  );
}
