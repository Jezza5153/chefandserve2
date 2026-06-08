import { Heading, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the klant after their shift hours are admin-approved (PR-KLANT-5),
 * inviting feedback on the chef. Copy is "feedback", never "review".
 * Feedback is internal-only — used to improve future matches.
 */
export function RatingPendingKlantEmail({
  companyName,
  chefName,
  shiftDate,
  rateUrl,
}: {
  companyName: string;
  chefName: string;
  shiftDate: string;
  rateUrl: string;
}) {
  return (
    <EmailLayout preview={`Geef feedback over ${chefName}`}>
      <Heading as="h1" style={styles.h1}>
        Geef feedback over de dienst
      </Heading>
      <Text style={styles.lead}>Hallo,</Text>
      <Text style={styles.para}>
        Hoe ging de dienst met {chefName} op {shiftDate} bij {companyName}?
      </Text>
      <Text style={styles.para}>
        Geef kort feedback in het portaal. Dit gebruiken we intern om de
        kwaliteit en de match met uw team scherp te houden.
      </Text>

      <Text style={styles.para}>
        <a href={rateUrl} style={styles.button}>
          Feedback geven
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
