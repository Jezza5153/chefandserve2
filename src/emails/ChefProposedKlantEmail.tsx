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
    ? `Beste ${contactName.split(" ")[0]},`
    : "Geachte heer/mevrouw,";

  return (
    <EmailLayout preview={`Voorgestelde chef voor ${companyName} — ${shiftWhen}`}>
      <Heading as="h1" style={styles.h1}>
        We hebben een chef voorgesteld
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        Voor je shift bij {companyName} hebben we{" "}
        <strong>{chefName}</strong> voorgesteld. Je kunt het voorstel bekijken
        en een opmerking meesturen. Chef &amp; Serve bevestigt de shift daarna
        definitief.
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
          <span style={styles.detailLabel}>Chef</span> {chefName}
        </Text>
        {chefVakniveau ? (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Niveau</span> {chefVakniveau}
          </Text>
        ) : null}
        {chefYears ? (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Ervaring</span> {chefYears} jaar
          </Text>
        ) : null}
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Shift</span> {shiftRole}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Wanneer</span> {shiftWhen}
        </Text>
      </Section>

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
