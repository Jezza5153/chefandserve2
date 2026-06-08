import { Heading, Link, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Weekly digest sent to a klant when the planner PUBLISHES a week (PR-PLANBORD-2).
 * ONE mail listing the week's shifts with the proposed chef + a phone number "voor
 * het geval dat", plus a .ics attachment for their calendar. AVG: only the
 * positive, klant-safe fields — never internal notes.
 */
export type KlantWeekShift = {
  when: string;
  role: string;
  chefName: string;
  chefPhone?: string | null;
};

export function KlantWeekPlanningEmail({
  contactName,
  companyName,
  weekLabel,
  shifts,
  hubUrl,
}: {
  contactName?: string | null;
  companyName: string;
  weekLabel: string;
  shifts: KlantWeekShift[];
  hubUrl: string;
}) {
  const n = shifts.length;
  return (
    <EmailLayout preview={`Jullie planning — ${weekLabel} (${n} ${n === 1 ? "dienst" : "diensten"})`}>
      <Heading as="h1" style={styles.h1}>
        Jullie weekplanning staat klaar
      </Heading>
      <Text style={styles.lead}>Hallo {contactName ?? companyName},</Text>
      <Text style={styles.para}>
        De planning voor {companyName} in {weekLabel} staat klaar. Hieronder
        ziet u de diensten met de gekoppelde chef en het telefoonnummer.
      </Text>
      <Text style={styles.para}>
        De agenda-bijlage zit ook bij deze mail. Check het portaal voor de
        laatste stand.
      </Text>

      {shifts.map((s, i) => (
        <Section
          key={i}
          style={{ margin: "16px 0", padding: "16px", backgroundColor: "#F7F8FA", borderRadius: "6px" }}
        >
          <Text style={{ ...styles.detailRow, fontWeight: 600 }}>{s.when}</Text>
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Rol</span> {s.role}
          </Text>
          <Text style={styles.detailRow}>
            <span style={styles.detailLabel}>Chef</span> {s.chefName}
            {s.chefPhone ? ` · ${s.chefPhone}` : ""}
          </Text>
        </Section>
      ))}

      <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
        <Link href={hubUrl} style={styles.button}>
          Open portaal
        </Link>
      </Section>
      <Text style={styles.small}>
        De bijlage (.ics) zet de planning in jullie agenda. Vragen of een wijziging nodig?
        Reageer op deze mail of bel het kantoor.
      </Text>
    </EmailLayout>
  );
}
