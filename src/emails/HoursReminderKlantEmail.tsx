import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Cron-driven reminder to the client when the chef has submitted hours but
 * they haven't signed yet after several days.
 */
export function HoursReminderKlantEmail({
  recipientName,
  chefName,
  shiftDate,
  signUrl,
}: {
  recipientName: string;
  chefName: string;
  shiftDate: string;
  signUrl: string;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <EmailLayout
      preview={`Ondertekening uren wacht — ${chefName}`}
    >
      <Heading as="h1" style={styles.h1}>
        Uren wachten op bevestiging
      </Heading>
      <Text style={styles.lead}>Hallo {firstName},</Text>
      <Text style={styles.para}>
        De uren van {chefName} voor {dateLabel} staan nog klaar om te
        bevestigen.
      </Text>
      <Text style={styles.para}>
        Wilt u ze controleren en tekenen in het portaal? Dan kunnen we de
        dienst netjes afronden.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={signUrl} style={styles.button}>
          Uren bevestigen
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link
          href={signUrl}
          style={{ color: styles.burgundy, wordBreak: "break-all" }}
        >
          {signUrl}
        </Link>
      </Text>

      <Text style={styles.small}>
        Klopt er iets niet aan de uren? Open de link, kies "Niet akkoord" en
        geef een korte opmerking — de chef past het dan aan.
      </Text>
    </EmailLayout>
  );
}
