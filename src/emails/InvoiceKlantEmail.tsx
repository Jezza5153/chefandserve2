import { Heading, Hr, Section, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * Sent to the klant when an invoice is issued for a billing period. Closes the
 * loop the hours-approved mail opened ("de factuur volgt"). Calm, professional
 * tone; the line table mirrors the invoice, and the mail ends with one clear
 * next step: pay before the due date. The full invoice also lives in the portal.
 *
 * Props are stable — do not rename or remove (copywriters edit only Dutch text).
 */
export function InvoiceKlantEmail({
  recipientName,
  billToName,
  invoiceNumber,
  periodLabel,
  issueDateLabel,
  dueDateLabel,
  lines,
  subtotalCents,
  vatCents,
  vatRateLabel,
  totalCents,
  invoiceUrl,
}: {
  recipientName: string;
  billToName: string;
  invoiceNumber: string;
  periodLabel: string;
  issueDateLabel: string;
  dueDateLabel: string;
  lines: Array<{ description: string; amountCents: number }>;
  subtotalCents: number;
  vatCents: number;
  vatRateLabel: string;
  totalCents: number;
  invoiceUrl?: string;
}): React.ReactElement {
  const firstName = recipientName.split(" ")[0] || "daar";
  const eur = (cents: number) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
      cents / 100,
    );

  return (
    <EmailLayout preview={`Factuur ${invoiceNumber} — te voldoen vóór ${dueDateLabel}`}>
      <Heading as="h1" style={styles.h1}>
        Factuur {invoiceNumber}
      </Heading>
      <Text style={styles.lead}>Hallo {firstName},</Text>
      <Text style={styles.para}>
        Hierbij de factuur voor {billToName} over de periode {periodLabel}. Een
        overzicht van de shifts staat hieronder; de volledige factuur vind je ook
        in je portaal.
      </Text>

      <Section
        style={{
          margin: "24px 0",
          padding: "16px 20px",
          backgroundColor: "#F7F8FA",
          borderRadius: "6px",
        }}
      >
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Factuurnummer</span> {invoiceNumber}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Factuurdatum</span> {issueDateLabel}
        </Text>
        <Text style={styles.detailRow}>
          <span style={styles.detailLabel}>Vervaldatum</span> {dueDateLabel}
        </Text>
      </Section>

      {/* Line items */}
      <Section style={{ margin: "8px 0" }}>
        {lines.map((line, i) => (
          <Text
            key={i}
            style={{
              ...styles.detailRow,
              display: "flex",
              justifyContent: "space-between",
              margin: "6px 0",
            }}
          >
            <span style={{ color: styles.ink, paddingRight: "12px" }}>
              {line.description}
            </span>
            <span style={{ color: styles.ink, whiteSpace: "nowrap" }}>
              {eur(line.amountCents)}
            </span>
          </Text>
        ))}
      </Section>

      <Hr style={{ borderColor: "#eee", margin: "16px 0" }} />

      {/* Totals */}
      <Section style={{ margin: "0 0 8px" }}>
        <Text style={{ ...styles.detailRow, display: "flex", justifyContent: "space-between", margin: "4px 0" }}>
          <span style={{ color: "#666" }}>Subtotaal (excl. btw)</span>
          <span>{eur(subtotalCents)}</span>
        </Text>
        <Text style={{ ...styles.detailRow, display: "flex", justifyContent: "space-between", margin: "4px 0" }}>
          <span style={{ color: "#666" }}>Btw {vatRateLabel}</span>
          <span>{eur(vatCents)}</span>
        </Text>
        <Text
          style={{
            ...styles.detailRow,
            display: "flex",
            justifyContent: "space-between",
            margin: "8px 0 0",
            fontWeight: 600,
          }}
        >
          <span>Totaal te voldoen</span>
          <span>{eur(totalCents)}</span>
        </Text>
      </Section>

      <Text style={styles.para}>
        Wij verzoeken je het totaalbedrag vóór {dueDateLabel} te voldoen onder
        vermelding van factuurnummer {invoiceNumber}.
      </Text>

      {invoiceUrl && (
        <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
          <a href={invoiceUrl} style={styles.button}>
            Bekijk factuur
          </a>
        </Section>
      )}

      <Text style={styles.small}>
        Vragen over deze factuur? Mail of bel het kantoor — we helpen je graag.
      </Text>
    </EmailLayout>
  );
}
