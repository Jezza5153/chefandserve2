import { Button, Heading, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Cockpit PR-2.1 — "vraag ontbrekende gegevens". Sent to a chef whose profile is
 * incomplete, asking them to (re)submit the intake form so we can plan + estimate
 * travel. The missing fields are named in plain Dutch.
 */
export function ProfileDataRequestEmail({
  chefName,
  missingLabels,
  formUrl,
}: {
  chefName?: string | null;
  missingLabels: string[];
  formUrl: string;
}) {
  const greeting = chefName ? `Hoi ${chefName.split(" ")[0]},` : "Hoi,";
  return (
    <EmailLayout preview="We missen nog een paar gegevens van je">
      <Heading as="h1" style={styles.h1}>
        Vul je gegevens aan
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        We missen nog een paar gegevens in je profiel. Zonder deze gegevens
        kunnen we je minder goed inplannen of uitbetalen.
      </Text>
      {missingLabels.length > 0 && (
        <>
          <Text style={styles.para}>
            <strong>Nog nodig</strong>
          </Text>
          <Text style={styles.para}>{missingLabels.join(" · ")}</Text>
        </>
      )}
      <Text style={styles.para}>
        Vul ze even aan via het formulier. Dan staat alles netjes klaar.
      </Text>
      <Button href={formUrl} style={styles.button}>
        Gegevens aanvullen
      </Button>
      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Chef &amp; Serve
      </Text>
    </EmailLayout>
  );
}
