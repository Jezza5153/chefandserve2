import { Heading, Text } from "@react-email/components";
import * as React from "react";

import { EmailLayout, styles } from "./_layout";

/**
 * A freeform message Maarten sends via the assistant ("stuur een mail naar X").
 * The body renders as paragraphs (blank line = new paragraph, single newline = break).
 * Always confirm-gated upstream, so the content is owner-approved before it sends.
 */
export function OwnerMessageEmail({ title, body }: { title?: string; body: string }) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const preview = (paragraphs[0] ?? title ?? "Bericht van Chef & Serve").slice(0, 120);

  return (
    <EmailLayout preview={preview} footerNote="Met vriendelijke groet, Chef & Serve">
      {title ? (
        <Heading as="h1" style={styles.h1}>
          {title}
        </Heading>
      ) : null}
      {paragraphs.map((p, i) => {
        const lines = p.split("\n");
        return (
          <Text key={i} style={styles.para}>
            {lines.map((line, j) => (
              <React.Fragment key={j}>
                {line}
                {j < lines.length - 1 ? <br /> : null}
              </React.Fragment>
            ))}
          </Text>
        );
      })}
    </EmailLayout>
  );
}
