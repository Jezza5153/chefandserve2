/**
 * Business-KPI report — the React-PDF "management dashboard" the assistant generates on request.
 * One clean A4 page: title, KPI cards, a 6-month revenue+margin bar chart (hand-drawn SVG, no
 * external chart service), occupancy, and a plain-language "Wat dit betekent" narrative.
 *
 * Pure presentation — fed by buildKpiReportData(). Rendered to a Buffer in reports/render.ts.
 */
import React from "react";
import { Document, Page, Text, View, StyleSheet, Svg, Rect, Line } from "@react-pdf/renderer";

import type { KpiReportData } from "@/lib/ai/read-model/report-kpi";

const BURGUNDY = "#801B2B";
const INK = "#29292A";
const MUTED = "#6B6B6E";
const LIGHT = "#E7D7DB";
const BG = "#FAF7F5";

const eur = (cents: number): string =>
  "€" + Math.round(cents / 100).toLocaleString("nl-NL");

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: INK, fontFamily: "Helvetica", backgroundColor: "#FFFFFF" },
  brand: { fontSize: 9, letterSpacing: 2, color: BURGUNDY, textTransform: "uppercase" },
  title: { fontSize: 22, marginTop: 4, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, color: MUTED, marginTop: 2 },
  cardsRow: { flexDirection: "row", gap: 8, marginTop: 18 },
  card: { flex: 1, backgroundColor: BG, borderRadius: 6, padding: 10, borderLeft: `3 solid ${BURGUNDY}` },
  cardLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  cardValue: { fontSize: 16, marginTop: 3, fontFamily: "Helvetica-Bold" },
  cardNote: { fontSize: 8, color: MUTED, marginTop: 2 },
  section: { marginTop: 22 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  legendRow: { flexDirection: "row", gap: 14, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 8, color: MUTED },
  monthRow: { flexDirection: "row", marginTop: 4 },
  monthCell: { flex: 1, textAlign: "center", fontSize: 8, color: MUTED },
  narrative: { fontSize: 10, lineHeight: 1.5, color: INK },
  bullet: { fontSize: 10, lineHeight: 1.5, marginBottom: 2 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: MUTED, borderTop: `1 solid ${LIGHT}`, paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
});

function Chart({ data }: { data: KpiReportData }) {
  const W = 523;
  const H = 170;
  const padL = 4;
  const padB = 4;
  const months = data.months;
  const max = Math.max(1, ...months.map((m) => m.revenueCents));
  const groupW = (W - padL) / months.length;
  const barW = Math.min(26, groupW / 3);
  const plotH = H - padB;
  const y = (cents: number) => plotH - (cents / max) * (plotH - 8);

  return (
    <Svg width={W} height={H}>
      {/* baseline */}
      <Line x1={0} y1={plotH} x2={W} y2={plotH} strokeWidth={1} stroke={LIGHT} />
      {months.map((m, i) => {
        const cx = padL + groupW * i + groupW / 2;
        const revH = plotH - y(m.revenueCents);
        const marH = plotH - y(m.marginCents);
        return (
          <React.Fragment key={m.key}>
            <Rect x={cx - barW - 1} y={y(m.revenueCents)} width={barW} height={Math.max(0, revH)} fill={LIGHT} />
            <Rect x={cx + 1} y={y(m.marginCents)} width={barW} height={Math.max(0, marH)} fill={BURGUNDY} />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export function KpiReportDoc({ data }: { data: KpiReportData }) {
  const { snapshot: snap, months } = data;
  const monthRev = snap.money.month.revenueCents;
  const monthMar = snap.money.month.marginCents;
  const marginPct = monthRev > 0 ? Math.round((monthMar / monthRev) * 100) : 0;
  const occ = snap.fill.overallSlots > 0 ? Math.round((snap.fill.overallFilled / snap.fill.overallSlots) * 100) : 0;
  const trend = months.length >= 2 ? months[months.length - 1].revenueCents - months[months.length - 2].revenueCents : 0;

  const narrative: string[] = [];
  narrative.push(
    `Deze maand staat de omzet op ${eur(monthRev)} met een marge van ${eur(monthMar)} (${marginPct}%). ` +
      (monthRev === 0 ? "Er zijn deze maand nog geen uren geregistreerd, dus deze stand groeit nog aan." : trend >= 0 ? "De omzet ligt op of boven die van vorige maand." : "De omzet ligt onder die van vorige maand — houd de bezetting in de gaten."),
  );
  narrative.push(
    `De bezetting is ${snap.fill.overallFilled} van ${snap.fill.overallSlots} plekken (${occ}%). ` +
      `Er zijn ${snap.chefs.active} actieve chefs op de rol (van ${snap.chefs.total} totaal).`,
  );
  const opsBits: string[] = [];
  if (snap.ops.open48hSlots > 0) opsBits.push(`${snap.ops.open48hSlots} plek(ken) open binnen 48 uur`);
  if (snap.ops.acceptedUnconfirmed > 0) opsBits.push(`${snap.ops.acceptedUnconfirmed} geaccepteerd maar nog niet bevestigd`);
  if (snap.ops.intakeTotal > 0) opsBits.push(`${snap.ops.intakeTotal} aanmelding(en) in de intake`);

  return (
    <Document title="Chef & Serve — Bedrijfsrapportage">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>Chef &amp; Serve · Bedrijfsrapportage</Text>
        <Text style={s.title}>KPI-overzicht</Text>
        <Text style={s.sub}>Gegenereerd op {data.generatedAtLabel}</Text>

        <View style={s.cardsRow}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Omzet (maand)</Text>
            <Text style={s.cardValue}>{eur(monthRev)}</Text>
            <Text style={s.cardNote}>YTD {eur(snap.money.ytd.revenueCents)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Marge (maand)</Text>
            <Text style={s.cardValue}>{eur(monthMar)}</Text>
            <Text style={s.cardNote}>{marginPct}% van de omzet</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Bezetting</Text>
            <Text style={s.cardValue}>{occ}%</Text>
            <Text style={s.cardNote}>{snap.fill.overallFilled}/{snap.fill.overallSlots} plekken</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Actieve chefs</Text>
            <Text style={s.cardValue}>{snap.chefs.active}</Text>
            <Text style={s.cardNote}>van {snap.chefs.total} totaal</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Omzet &amp; marge — laatste 6 maanden</Text>
          <Chart data={data} />
          <View style={s.monthRow}>
            {months.map((m) => (
              <Text key={m.key} style={s.monthCell}>{m.label}</Text>
            ))}
          </View>
          <View style={s.legendRow}>
            <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: LIGHT }]} /><Text style={s.legendText}>Omzet</Text></View>
            <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: BURGUNDY }]} /><Text style={s.legendText}>Marge</Text></View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Wat dit betekent</Text>
          {narrative.map((line, i) => (
            <Text key={i} style={s.narrative}>{line}</Text>
          ))}
          {opsBits.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[s.h2, { fontSize: 11, marginBottom: 4 }]}>Aandachtspunten</Text>
              {opsBits.map((b, i) => (
                <Text key={i} style={s.bullet}>• {b}</Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={s.footer} fixed>
          <Text>Chef &amp; Serve — intern rapport</Text>
          <Text>Cijfers komen rechtstreeks uit het systeem.</Text>
        </View>
      </Page>
    </Document>
  );
}
