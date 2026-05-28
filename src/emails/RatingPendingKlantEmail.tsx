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
        Hoe ging het met {chefName}?
      </Heading>
      <Text style={styles.lead}>Beste relatie van {companyName},</Text>
      <Text style={styles.para}>
        De shift van {shiftDate} is afgerond. Je feedback helpt ons om volgende
        matches nog beter te maken — het kost je minder dan een minuut en is
        alleen zichtbaar voor Chef &amp; Serve.
      </Text>

      <Text style={styles.para}>
        <a href={rateUrl} style={styles.button}>
          Geef feedback
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
