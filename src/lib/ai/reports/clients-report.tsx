/**
 * Klant report — React-PDF document for "rapport over mijn klanten": a ranked table (revenue,
 * margin, occupancy) + a horizontal revenue bar chart for the top klanten + a plain-language
 * summary. Fed by buildClientsReportData(); rendered to a Buffer in reports/render.tsx.
 */
import React from "react";
import { Document, Page, Text, View, StyleSheet, Svg, Rect } from "@react-pdf/renderer";

import type { ClientsReportData } from "@/lib/ai/read-model/report-clients";

const BURGUNDY = "#801B2B";
const INK = "#29292A";
const MUTED = "#6B6B6E";
const LIGHT = "#E7D7DB";
const BG = "#FAF7F5";

const eur = (cents: number): string => "€" + Math.round(cents / 100).toLocaleString("nl-NL");

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  brand: { fontSize: 9, letterSpacing: 2, color: BURGUNDY, textTransform: "uppercase" },
  title: { fontSize: 22, marginTop: 4, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, color: MUTED, marginTop: 2 },
  cardsRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  card: { flex: 1, backgroundColor: BG, borderRadius: 6, padding: 10, borderLeft: `3 solid ${BURGUNDY}` },
  cardLabel: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  cardValue: { fontSize: 16, marginTop: 3, fontFamily: "Helvetica-Bold" },
  section: { marginTop: 20 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  barName: { width: 120, fontSize: 9 },
  barVal: { width: 64, fontSize: 8, color: MUTED, textAlign: "right" },
  thead: { flexDirection: "row", borderBottom: `1 solid ${LIGHT}`, paddingBottom: 4, marginBottom: 2 },
  th: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  tr: { flexDirection: "row", paddingVertical: 3, borderBottom: `0.5 solid ${BG}` },
  td: { fontSize: 9 },
  cRank: { width: 22 },
  cName: { flex: 1 },
  cNum: { width: 70, textAlign: "right" },
  cDetail: { width: 96, textAlign: "right", color: MUTED, fontSize: 8 },
  narrative: { fontSize: 10, lineHeight: 1.5 },
  empty: { fontSize: 10, color: MUTED, fontStyle: "italic", marginTop: 8 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: MUTED, borderTop: `1 solid ${LIGHT}`, paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
});

export function ClientsReportDoc({ data }: { data: ClientsReportData }) {
  const { clients } = data;
  const top = clients.slice(0, 10);
  const maxRev = Math.max(1, ...top.map((c) => c.revenueCents));
  const marginPct = data.totalRevenueCents > 0 ? Math.round((data.totalMarginCents / data.totalRevenueCents) * 100) : 0;
  const BARW = 230;

  return (
    <Document title="Chef & Serve — Klant-rapport">
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>Chef &amp; Serve · Klant-rapport</Text>
        <Text style={s.title}>Klanten — omzet-overzicht</Text>
        <Text style={s.sub}>Laatste {data.rangeDays} dagen · gegenereerd op {data.generatedAtLabel}</Text>

        <View style={s.cardsRow}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Klanten met omzet</Text>
            <Text style={s.cardValue}>{clients.length}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Totale omzet</Text>
            <Text style={s.cardValue}>{eur(data.totalRevenueCents)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Totale marge</Text>
            <Text style={s.cardValue}>{eur(data.totalMarginCents)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Marge %</Text>
            <Text style={s.cardValue}>{marginPct}%</Text>
          </View>
        </View>

        {clients.length === 0 ? (
          <Text style={s.empty}>Geen geregistreerde omzet per klant in deze periode (de cijfers groeien aan zodra er diensten verwerkt zijn).</Text>
        ) : (
          <>
            <View style={s.section}>
              <Text style={s.h2}>Top-klanten op omzet</Text>
              {top.map((c, i) => (
                <View key={c.id} style={s.barRow}>
                  <Text style={s.barName}>{i + 1}. {c.name}</Text>
                  <Svg width={BARW} height={11}>
                    <Rect x={0} y={1} width={Math.max(2, (c.revenueCents / maxRev) * BARW)} height={9} fill={BURGUNDY} rx={2} />
                  </Svg>
                  <Text style={s.barVal}>{eur(c.revenueCents)}</Text>
                </View>
              ))}
            </View>

            <View style={s.section}>
              <Text style={s.h2}>Alle klanten ({data.rangeDays} dagen)</Text>
              <View style={s.thead}>
                <Text style={[s.th, s.cRank]}>#</Text>
                <Text style={[s.th, s.cName]}>Klant</Text>
                <Text style={[s.th, s.cNum]}>Omzet</Text>
                <Text style={[s.th, s.cNum]}>Marge</Text>
                <Text style={[s.th, s.cDetail]}>Bezetting</Text>
              </View>
              {clients.map((c, i) => (
                <View key={c.id} style={s.tr}>
                  <Text style={[s.td, s.cRank]}>{i + 1}</Text>
                  <Text style={[s.td, s.cName]}>{c.name}</Text>
                  <Text style={[s.td, s.cNum]}>{eur(c.revenueCents)}</Text>
                  <Text style={[s.td, s.cNum]}>{eur(c.marginCents)}</Text>
                  <Text style={[s.td, s.cDetail]}>{c.detail}</Text>
                </View>
              ))}
            </View>

            <View style={s.section}>
              <Text style={s.h2}>Wat dit betekent</Text>
              <Text style={s.narrative}>
                {top[0] ? `${top[0].name} is je grootste klant over deze periode (${eur(top[0].revenueCents)}). ` : ""}
                De {clients.length} actieve klanten brachten samen {eur(data.totalRevenueCents)} omzet met een marge van {eur(data.totalMarginCents)} ({marginPct}%).
              </Text>
            </View>
          </>
        )}

        <View style={s.footer} fixed>
          <Text>Chef &amp; Serve — intern klant-rapport</Text>
          <Text>Cijfers komen rechtstreeks uit het systeem.</Text>
        </View>
      </Page>
    </Document>
  );
}
