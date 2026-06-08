import { Heading, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the klant when Chef & Serve proposes a chef for one of their shifts
 * (PR-KLANT-3). The klant has NO veto — copy is "bekijk + opmerking", never
 * "goedkeuren". They can send a comment before Chef & Serve confirms.
 */
export function ChefProposedKlantEmail({
  contactName,
  companyName,
  chefName,
  chefVakniveau,
  chefYears,
  shiftWhen,
  shiftRole,
  hubUrl,
}: {
  contactName?: string | null;
  companyName: string;
  chefName: string;
  chefVakniveau?: string | null;
  chefYears?: number | null;
  shiftWhen: string;
  shiftRole: string;
  hubUrl: string;
}) {
  const greeting = contactName
    ? `Hallo ${contactName.split(" ")[0]},`
    : "Geachte heer/mevrouw,";

  return (
    <EmailLayout preview={`Voorgestelde chef voor ${companyName} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        We hebben een chef voorgesteld
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        We hebben <strong>{chefName}</strong> voorgesteld voor de dienst als{" "}
        {shiftRole} op {shiftWhen}.
      </Text>

      <Section
        style={{
          margin: "24px 0",
          padding: "16px",
          backgroundColor: "#F7F8FA",
          borderRadius: "6px",
        }}
      >
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Chef-profiel</span>
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Naam</span> {chefName}
        </Text>
        {chefVakniveau ? (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Vakniveau</span> {chefVakniveau}
          </Text>
        ) : null}
        {chefYears ? (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Ervaring</span> {chefYears} jaar
          </Text>
        ) : null}
      </Section>

      <Text style={styles.para}>
        Bekijk het voorstel in uw portaal. Heeft u iets dat belangrijk is voor
        deze dienst? Laat daar dan een opmerking achter, dan nemen we dat mee.
      </Text>

      <Text style={styles.para}>
        <a href={hubUrl} style={styles.button}>
          Bekijk voorstel
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
