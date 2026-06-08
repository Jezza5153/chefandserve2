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

  return (
    <EmailLayout preview={preview}>
      <Heading as="h1" style={styles.h1}>
        Vul je uren even in
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        Je dienst bij {clientName} op {dateLabel} is afgerond, maar je uren
        staan nog open. Vul ze even in, dan houden we de afhandeling en betaling
        netjes op gang.
      </Text>

      <Section style={{ textAlign: "center", margin: "32px 0" }}>
        <Link href={submitUrl} style={styles.button}>
          Uren invullen
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
