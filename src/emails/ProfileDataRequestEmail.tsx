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
  const greeting = chefName ? `Beste ${chefName.split(" ")[0]},` : "Beste,";
  return (
    <EmailLayout preview="We missen nog een paar gegevens van je">
      <Heading as="h1" style={styles.h1}>
        We missen nog een paar gegevens
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        Om je goed te kunnen inplannen missen we nog wat informatie
        {missingLabels.length > 0 ? ":" : "."}
      </Text>
      {missingLabels.length > 0 && (
        <Text style={styles.para}>
          <strong>{missingLabels.join(" · ")}</strong>
        </Text>
      )}
      <Text style={styles.para}>
        Vul je gegevens (opnieuw) in via onderstaand formulier — duurt een paar
        minuten.
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
