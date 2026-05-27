import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Cron-driven reminder to the chef when they haven't submitted their hours
 * yet after the shift completed. Two stages: 24h (friendly nudge) and 72h
 * (last call before admin intervenes).
 */
export function HoursReminderChefEmail({
  recipientName,
  clientName,
  shiftDate,
  stage,
  submitUrl,
}: {
  recipientName: string;
  clientName: string;
  shiftDate: string;
  stage: "24h" | "72h";
  submitUrl: string;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const preview =
    stage === "24h"
      ? "Vergeet je je uren niet?"
      : `Laatste herinnering — uren voor ${clientName}`;
  const title =
    stage === "24h"
      ? "Vergeet je je uren niet?"
      : "Laatste herinnering";
  const lead =
    stage === "24h"
      ? `Hoi ${firstName}, je shift bij ${clientName} op ${dateLabel} staat als afgerond, maar we hebben je uren nog niet binnen. Even 2 minuutjes en het is geregeld.`
      : `Hoi ${firstName}, het is alweer drie dagen na je shift bij ${clientName} op ${dateLabel} en je uren staan nog open. Dien ze vandaag in — anders neemt het kantoor contact op om het samen door te lopen.`;
  const followup =
    stage === "24h"
      ? "Hoe sneller jij je uren indient, hoe sneller de klant tekent en wij de uitbetaling kunnen plannen."
      : "Zonder ingediende uren kunnen we de uitbetaling niet plannen.";

  return (
    <EmailLayout preview={preview}>
      <Heading as="h1" style={styles.h1}>
        {title}
      </Heading>
      <Text style={styles.lead}>{lead}</Text>
      <Text style={styles.para}>{followup}</Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={submitUrl} style={styles.button}>
          Uren indienen
        </Link>
      </Section>

      <Text style={styles.small}>
        Werkt de knop niet? Plak deze link in je browser:
        <br />
        <Link
          href={submitUrl}
          style={{ color: styles.burgundy, wordBreak: "break-all" }}
        >
          {submitUrl}
        </Link>
      </Text>
    </EmailLayout>
  );
}
