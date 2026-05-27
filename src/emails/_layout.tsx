/**
 * Shared email layout — Chef & Serve brand chrome for all transactional emails.
 *
 * All other email templates wrap their content in <EmailLayout>.
 * Inline styles only (email clients strip <style>).
 */
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

const burgundy = "#801B2B";
const ink = "#29292A";
const bgGray = "#F7F8FA";

export function EmailLayout({
  preview,
  children,
  footerNote,
}: {
  preview: string;
  children: React.ReactNode;
  footerNote?: string;
}) {
  return (
    <Html lang="nl">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <Text style={brandText}>
              Chef <span style={ampersand}>&amp;</span> Serve
            </Text>
          </Section>

          <Section style={card}>{children}</Section>

          <Section style={footer}>
            {footerNote && <Text style={footerText}>{footerNote}</Text>}
            <Text style={footerText}>
              © {new Date().getFullYear()} Chef &amp; Serve · Premium Hospitality Staffing
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/* ----------------------------- styles ----------------------------------- */

const body: React.CSSProperties = {
  backgroundColor: bgGray,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif',
  color: ink,
  margin: 0,
  padding: "40px 0",
};

const container: React.CSSProperties = {
  maxWidth: "560px",
  margin: "0 auto",
  padding: "0 20px",
};

const brand: React.CSSProperties = {
  textAlign: "center",
  padding: "0 0 24px",
};

const brandText: React.CSSProperties = {
  fontFamily: "Georgia, serif",
  fontSize: "26px",
  letterSpacing: "0.04em",
  color: ink,
  margin: 0,
};

const ampersand: React.CSSProperties = { color: burgundy };

const card: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "8px",
  border: `1px solid ${burgundy}15`,
  padding: "40px 32px",
};

const footer: React.CSSProperties = {
  textAlign: "center",
  padding: "24px 0 0",
};

const footerText: React.CSSProperties = {
  fontSize: "11px",
  lineHeight: "1.6",
  color: "#888",
  margin: "4px 0",
};

/* ----- shared atoms exported for use in templates -------------------- */

export const styles = {
  h1: {
    fontFamily: "Georgia, serif",
    fontSize: "26px",
    color: ink,
    margin: "0 0 16px",
  } as React.CSSProperties,
  lead: {
    fontSize: "15px",
    lineHeight: "1.6",
    color: ink,
    margin: 0,
  } as React.CSSProperties,
  para: {
    fontSize: "14px",
    lineHeight: "1.6",
    color: ink,
    margin: "12px 0",
  } as React.CSSProperties,
  small: {
    fontSize: "12px",
    lineHeight: "1.6",
    color: "#666",
    margin: "12px 0",
  } as React.CSSProperties,
  button: {
    display: "inline-block",
    backgroundColor: burgundy,
    color: "#fff",
    textDecoration: "none",
    borderRadius: "999px",
    padding: "14px 28px",
    fontSize: "11px",
    fontWeight: 500,
    letterSpacing: "0.18em",
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
  detailRow: {
    fontSize: "14px",
    lineHeight: "1.6",
    color: ink,
    margin: "4px 0",
  } as React.CSSProperties,
  detailLabel: {
    color: "#888",
    display: "inline-block",
    minWidth: "100px",
    fontSize: "12px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
  } as React.CSSProperties,
  burgundy,
  ink,
};
