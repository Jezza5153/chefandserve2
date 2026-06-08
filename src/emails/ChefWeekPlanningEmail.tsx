import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Weekly digest sent to a chef when the planner PUBLISHES a week (PR-PLANBORD-2).
 * ONE mail listing every shift they were placed on — with the venue address, the
 * on-site contact person + phone, and the chef-visible details — plus a .ics
 * attachment so they drop the whole week into their calendar in one tap.
 */
export type ChefWeekShift = {
  when: string;
  klant: string;
  role: string;
  location?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  details?: string | null;
};

export function ChefWeekPlanningEmail({
  chefName,
  weekLabel,
  shifts,
  portalUrl,
}: {
  chefName: string;
  weekLabel: string;
  shifts: ChefWeekShift[];
  portalUrl: string;
}) {
  const firstName = chefName.split(" ")[0];
  const n = shifts.length;
  return (
    <EmailLayout preview={`Je planning — ${weekLabel} (${n} ${n === 1 ? "dienst" : "diensten"})`}>
      <Heading as="h1" style={styles.h1}>
        Je weekplanning staat klaar
      </Heading>
      <Text style={styles.lead}>Hoi {firstName},</Text>
      <Text style={styles.para}>
        Je planning voor {weekLabel} staat klaar. Hieronder vind je je diensten
        met adres, contactpersoon, telefoonnummer en de details die je nodig
        hebt.
      </Text>
      <Text style={styles.para}>
        De agenda-bijlage zit ook bij deze mail. Check voor de zekerheid altijd
        je portaal voor de laatste stand.
      </Text>

      {shifts.map((s, i) => (
        <Section
          key={i}
          style={{ margin: "16px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}
        >
          <Text style={{ ...styles.detailRow, fontWeight: 600 }}>{s.when}</Text>
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Klant</span> {s.klant}
          </Text>
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Rol</span> {s.role}
          </Text>
          {s.location && (
            <Text style={styles.detailRow}>
              <span style={styles.detailLabel}>Adres</span> {s.location}
            </Text>
          )}
          {s.contactName && (
            <Text style={styles.detailRow}>
              <span style={styles.detailLabel}>Contact</span> {s.contactName}
              {s.contactPhone ? ` · ${s.contactPhone}` : ""}
            </Text>
          )}
          {s.details && (
            <Text style={styles.detailRow}>
              <span style={styles.detailLabel}>Details</span> {s.details}
            </Text>
          )}
        </Section>
      ))}

      <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
        <Link href={portalUrl} style={styles.button}>
          Open portaal
        </Link>
      </Section>
      <Text style={styles.small}>
        De bijlage (.ics) zet je hele week in één klik in je agenda. Onverwacht verhinderd?
        Annuleer in het portaal én bel het kantoor als het minder dan 24 uur duurt.
      </Text>
    </EmailLayout>
  );
}
