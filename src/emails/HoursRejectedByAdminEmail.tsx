import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent when Chef & Serve admin has rejected hours that were already signed
 * by the client. Goes to BOTH the chef (with edit button) and the client
 * (informational). Same template, two routes — toggled via recipientRole.
 */
export function HoursRejectedByAdminEmail({
  recipientName,
  recipientRole,
  chefName,
  clientName,
  shiftDate,
  adminNote,
  editUrl,
}: {
  recipientName: string;
  recipientRole: "chef" | "klant";
  chefName: string;
  clientName: string;
  shiftDate: string;
  adminNote: string;
  editUrl?: string;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const dateLabel = new Date(shiftDate).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const isChef = recipientRole === "chef";
  const preview = isChef
    ? "Chef & Serve heeft je uren teruggezet"
    : `Uren-correctie voor ${chefName} op ${dateLabel}`;
  const title = isChef
    ? "Je uren zijn teruggezet"
    : "Uren-correctie nodig";
  const lead = isChef
    ? `Hoi ${firstName}, Chef & Serve heeft je uren voor ${clientName} op ${dateLabel} teruggezet met deze opmerking:`
    : `Hoi ${firstName}, Chef & Serve heeft de uren van ${chefName} voor ${dateLabel} teruggezet met deze opmerking:`;
  const followup = isChef
    ? "Pas je uren aan en dien opnieuw in. De klant tekent daarna opnieuw."
    : "Je hoeft niets te doen — wij coördineren met de chef. Zodra de uren zijn aangepast en opnieuw zijn ondertekend, krijg je weer bericht.";

  return (
    <EmailLayout preview={preview}>
      <Heading as="h1" style={styles.h1}>
        {title}
      </Heading>
      <Text style={styles.lead}>{lead}</Text>

      <Section
        style={{
          margin: "24px 0",
          padding: "16px 20px",
          backgroundColor: "#F7F8FA",
          borderLeft: `3px solid ${styles.burgundy}`,
          borderRadius: "4px",
        }}
      >
        <Text
          style={{
            ...styles.para,
            margin: 0,
            fontStyle: "italic",
            color: styles.ink,
          }}
        >
          {adminNote}
        </Text>
      </Section>

      <Text style={styles.para}>{followup}</Text>

      {isChef && editUrl && (
        <>
          <Section style={{ textAlign: "center", margin: "32px 0" }}>
            <Link href={editUrl} style={styles.button}>
              Uren aanpassen
            </Link>
          </Section>

          <Text style={styles.small}>
            Werkt de knop niet? Plak deze link in je browser:
            <br />
            <Link
              href={editUrl}
              style={{ color: styles.burgundy, wordBreak: "break-all" }}
            >
              {editUrl}
            </Link>
          </Text>
        </>
      )}

      {!isChef && (
        <Text style={styles.small}>Vragen? Bel of mail het kantoor.</Text>
      )}
    </EmailLayout>
  );
}
