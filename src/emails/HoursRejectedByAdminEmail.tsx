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
    ? "Je uren moeten aangepast worden"
    : "Uren teruggezet voor correctie";
  const greeting = isChef
    ? `Hoi ${recipientName},`
    : `Hallo ${recipientName},`;
  const lead = isChef
    ? `We hebben de ondertekende uren voor je dienst bij ${clientName} op ${dateLabel} teruggezet voor correctie.`
    : `We hebben de uren van ${chefName} voor ${dateLabel} bij ${clientName} teruggezet voor correctie.`;
  const followup = isChef
    ? "Pas je uren aan in het portaal en dien ze opnieuw in."
    : "U hoeft nu niets te doen. Zodra de aangepaste uren opnieuw klaarstaan, krijgt u bericht.";

  return (
    <EmailLayout preview={preview}>
      <Heading as="h1" style={styles.h1}>
        {title}
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>{lead}</Text>

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
          Reden: {adminNote}
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
