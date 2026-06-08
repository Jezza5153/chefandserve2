import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

/**
 * Magic-link sign-in email (Chef & Serve brand).
 *
 * Renders to inline-styled HTML for maximum email-client compatibility.
 * Sent by Resend from info@jezzacooks.com during staging.
 */
export function MagicLinkEmail({
  url,
  host = "Chef & Serve",
  recipientEmail,
}: {
  url: string;
  host?: string;
  recipientEmail: string;
}) {
  return (
    <Html lang="nl">
      <Head />
      <Preview>Je inloglink voor {host}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brand}>
            <Text style={brandText}>
              Chef <span style={ampersand}>&amp;</span> Serve
            </Text>
            <Text style={eyebrow}>Operations</Text>
          </Section>

          <Section style={card}>
            <Heading as="h1" style={h1}>
              Je inloglink voor Chef &amp; Serve
            </Heading>
            <Text style={lead}>
              Er is een inloglink aangevraagd voor {recipientEmail} op {host}.
            </Text>
            <Text style={lead}>
              Gebruik de knop hieronder om in te loggen. De link is eenmalig en
              15 minuten geldig.
            </Text>

            <Section style={{ textAlign: "center", margin: "32px 0" }}>
              <Link href={url} style={button}>
                Inloggen
              </Link>
            </Section>

            <Text style={small}>
              Werkt de knop niet? Kopieer en plak deze link in je browser:
              <br />
              <Link href={url} style={fallbackLink}>
                {url}
              </Link>
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Heeft u deze link niet aangevraagd? Dan kunt u deze mail negeren.
            </Text>
            <Text style={footerText}>
              © {new Date().getFullYear()} {host} · Closed-system operations
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/* ----------------------------- styles ----------------------------------- */
const burgundy = "#801B2B";
const ink = "#29292A";
const bgGray = "#F7F8FA";

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
  fontSize: "28px",
  letterSpacing: "0.04em",
  color: ink,
  margin: 0,
};

const ampersand: React.CSSProperties = {
  color: burgundy,
};

const eyebrow: React.CSSProperties = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: ink,
  marginTop: "4px",
  opacity: 0.6,
};

const card: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "8px",
  border: `1px solid ${burgundy}15`,
  padding: "40px 32px",
};

const h1: React.CSSProperties = {
  fontFamily: "Georgia, serif",
  fontSize: "28px",
  color: ink,
  margin: "0 0 16px",
};

const lead: React.CSSProperties = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: ink,
  margin: 0,
};

const button: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: burgundy,
  color: "#fff",
  textDecoration: "none",
  borderRadius: "999px",
  padding: "14px 28px",
  fontSize: "11px",
  fontWeight: 500,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

const small: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "1.6",
  color: "#666",
  marginTop: "24px",
};

const fallbackLink: React.CSSProperties = {
  color: burgundy,
  wordBreak: "break-all",
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
