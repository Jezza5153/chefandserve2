/**
 * Render every transactional email template to a standalone .html file so
 * copywriters can SEE exactly how each mail looks. Reads the per-template sample
 * props from `previews/emails/_inventory.json`, renders with @react-email, and
 * writes `previews/emails/<Name>.html` + an `index.html` grouped by audience.
 *
 *   npx tsx scripts/render-emails.mts
 *
 * Pure render (no DB, no network). Re-run after editing any template copy.
 * NB: templates are imported DYNAMICALLY (a static named import of a TS alias
 * module trips Node's ESM loader under tsx — the repo's other .mts scripts do
 * the same).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import * as React from "react";
import { render } from "@react-email/components";

type Entry = {
  name: string;
  purpose: string;
  audience: string;
  trigger: string;
  recipients: string;
  subjectExample: string;
  sampleProps: Record<string, unknown>;
};

const OUT = "previews/emails";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function main() {
  const inventory: Entry[] = JSON.parse(readFileSync(`${OUT}/_inventory.json`, "utf8"));
  mkdirSync(OUT, { recursive: true });

  let ok = 0;
  const fails: string[] = [];
  const cards: string[] = [];

  for (const t of inventory) {
    try {
      const mod = (await import(`@/emails/${t.name}`)) as Record<string, React.FC<unknown>>;
      const Component = mod[t.name];
      if (!Component) throw new Error(`no export "${t.name}"`);
      const html = await render(React.createElement(Component, t.sampleProps), { pretty: true });
      writeFileSync(`${OUT}/${t.name}.html`, html);
      ok++;
      console.log("  ✓", t.name);
      cards.push(
        `<li><a href="${t.name}.html"><b>${t.name}</b></a> <span class="aud">${esc(t.audience)}</span>` +
          `<div class="meta"><i>Onderwerp:</i> ${esc(t.subjectExample)}</div>` +
          `<div class="meta">${esc(t.purpose)}</div></li>`,
      );
    } catch (e) {
      fails.push(`${t.name}: ${(e as Error).message}`);
      console.log("  ✗", t.name, (e as Error).message);
    }
  }

  const indexHtml = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<title>Chef &amp; Serve — e-mailtemplates (${ok})</title>
<style>
 body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#29292A}
 h1{font-family:Georgia,serif} .aud{background:#801B2B12;color:#801B2B;border-radius:99px;padding:2px 8px;font-size:11px;margin-left:8px}
 ul{list-style:none;padding:0} li{border:1px solid #eee;border-radius:8px;padding:12px 14px;margin:8px 0}
 a{color:#801B2B;text-decoration:none} .meta{font-size:13px;color:#555;margin-top:4px}
</style></head><body>
<h1>E-mailtemplates <span style="color:#801B2B">(${ok})</span></h1>
<p>Klik een template om te zien hoe de mail er voor de ontvanger uitziet. Regels + functies staan in <code>docs/EMAIL_TEMPLATES.md</code>.</p>
<ul>${cards.join("\n")}</ul>
</body></html>`;
  writeFileSync(`${OUT}/index.html`, indexHtml);

  console.log(`\n  ${ok}/${inventory.length} rendered → ${OUT}/index.html`);
  if (fails.length) {
    console.log(`  ${fails.length} FAILED:`);
    for (const f of fails) console.log("    -", f);
    process.exit(1);
  }
}

main();
