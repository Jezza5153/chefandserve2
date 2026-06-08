import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/** Sent to client when a chef is confirmed for one of their shifts. */
export function ShiftConfirmedClientEmail({
  clientContactName,
  companyName,
  chefName,
  chefVakniveau,
  chefYears,
  shiftWhen,
  shiftLocation,
  shiftRole,
  hubUrl,
}: {
  clientContactName?: string | null;
  companyName: string;
  chefName: string;
  chefVakniveau?: string | null;
  chefYears?: number | null;
  shiftWhen: string;
  shiftLocation?: string | null;
  shiftRole: string;
  hubUrl?: string;
}) {
  const greeting = clientContactName
    ? `Hallo ${clientContactName.split(" ")[0]},`
    : "Geachte heer/mevrouw,";

  return (
    <EmailLayout
      preview={`Chef bevestigd voor ${companyName} — ${shiftWhen}`}
    >
      <Heading as="h1" style={styles.h1}>
        De chef is bevestigd
      </Heading>
      <Text style={styles.lead}>{greeting}</Text>
      <Text style={styles.para}>
        <strong>{chefName}</strong> is bevestigd voor {companyName}. De dienst
        staat ingepland als {shiftRole} op {shiftWhen}.
      </Text>

      <Section style={{ margin: "24px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Chef</span> {chefName}
        </Text>
        {chefVakniveau && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Vakniveau</span> {chefVakniveau}
          </Text>
        )}
        {chefYears && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Ervaring</span> {chefYears} jaar
          </Text>
        )}
        {shiftLocation && (
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Locatie</span> {shiftLocation}
          </Text>
        )}
      </Section>

      <Text style={styles.para}>
        Alles staat klaar in het portaal. Als er nog iets verandert, ziet u dat
        daar terug.
      </Text>

      {hubUrl && (
        <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
          <Link href={hubUrl} style={styles.button}>
            Bekijk dienst
          </Link>
        </Section>
      )}

      <Text style={styles.para}>
        Met vriendelijke groet,
        <br />
        Maarten &amp; het Chef &amp; Serve team
      </Text>
    </EmailLayout>
  );
}
