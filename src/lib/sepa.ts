/**
 * SEPA credit transfer file (pain.001.001.03) — pure, no database.
 *
 * The agency is taking payments in-house, so "export a CSV and hope Payingit does the
 * rest" becomes "produce a file the bank actually executes". Every Dutch bank accepts
 * pain.001.001.03 for a bulk SEPA credit transfer, which makes it the one format worth
 * writing: no API, no credentials in this system, no integration to keep alive.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not talk to a bank. The file is downloaded
 * and uploaded by a person, which keeps a human between "the system thinks it owes money"
 * and "money leaves the account". For a payment run that is the right amount of friction:
 * a wrong invoice can be corrected, a wrong transfer has to be asked back.
 *
 * A malformed file is rejected by the bank — a loud, safe failure. A file that is valid
 * but wrong is not, so IBAN and amount validation happen before anything is written.
 */

/** One payment. Amounts in cents; the XML carries euros with two decimals. */
export type SepaBetaling = {
  /** Unique within the batch; ends up on the bank statement as the end-to-end id. */
  id: string;
  naam: string;
  iban: string;
  bedragCents: number;
  /** What the recipient sees on their statement. */
  omschrijving: string;
};

export type SepaOpdracht = {
  /** Message id; the bank rejects a duplicate, which is a useful double-payment guard. */
  berichtId: string;
  /** Our own name as it should appear as the debtor. */
  opdrachtgeverNaam: string;
  opdrachtgeverIban: string;
  opdrachtgeverBic?: string;
  /** The date the bank should execute. */
  uitvoerDatum: string;
  betalingen: SepaBetaling[];
  /** Injected so the file is reproducible in tests. */
  aangemaaktOp: Date;
};

/** Strip spaces and upper-case; IBANs are written with spaces by humans. */
export function normaliseerIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

/**
 * IBAN check digits (ISO 7064 mod-97-10).
 *
 * Worth doing properly rather than only checking the length: a transposed pair of digits
 * gives a valid-looking IBAN that either bounces or, far worse, reaches someone else.
 */
export function isGeldigIban(ruw: string): boolean {
  const iban = normaliseerIban(ruw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const herschikt = iban.slice(4) + iban.slice(0, 4);
  const cijfers = herschikt.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  // Modulo in chunks: the number is far larger than Number.MAX_SAFE_INTEGER.
  let rest = 0;
  for (const c of cijfers) rest = (rest * 10 + Number(c)) % 97;
  return rest === 1;
}

/** XML text escaping. The name field is free text and a "&" in a company name is common. */
function esc(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * SEPA allows a restricted character set; anything else can be silently mangled or the
 * whole file refused. Transliterate what we can and drop what we cannot, so a chef called
 * "Müller" arrives as "Muller" instead of breaking the run.
 */
export function sepaTekst(t: string, maxLengte: number): string {
  const vervangen = t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // "&" hoort niet bij de toegestane tekens, maar hem wegstrepen maakt van
    // "Chef & Serve" het onherkenbare "Chef Serve" op het bankafschrift.
    .replace(/&/g, " en ")
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return vervangen.slice(0, maxLengte);
}

const euro = (cents: number) => (cents / 100).toFixed(2);

export type SepaResultaat = { ok: true; xml: string } | { ok: false; error: string };

export function bouwSepaBestand(o: SepaOpdracht): SepaResultaat {
  if (o.betalingen.length === 0) return { ok: false, error: "Er staan geen betalingen in deze batch." };
  if (!isGeldigIban(o.opdrachtgeverIban)) {
    return { ok: false, error: "Het IBAN van de opdrachtgever klopt niet — controleer de bedrijfsinstellingen." };
  }
  for (const b of o.betalingen) {
    if (!isGeldigIban(b.iban)) return { ok: false, error: `Ongeldig IBAN bij ${b.naam}.` };
    if (!Number.isInteger(b.bedragCents) || b.bedragCents <= 0) {
      return { ok: false, error: `Ongeldig bedrag bij ${b.naam}.` };
    }
  }
  const ids = new Set(o.betalingen.map((b) => b.id));
  if (ids.size !== o.betalingen.length) return { ok: false, error: "Dubbele regel-id's in de batch." };

  const totaal = o.betalingen.reduce((s, b) => s + b.bedragCents, 0);
  const stamp = o.aangemaaktOp.toISOString().replace(/\.\d{3}Z$/, "");

  const regels = o.betalingen
    .map(
      (b) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${esc(sepaTekst(b.id, 35))}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${euro(b.bedragCents)}</InstdAmt></Amt>
        <Cdtr><Nm>${esc(sepaTekst(b.naam, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${normaliseerIban(b.iban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${esc(sepaTekst(b.omschrijving, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(sepaTekst(o.berichtId, 35))}</MsgId>
      <CreDtTm>${stamp}</CreDtTm>
      <NbOfTxs>${o.betalingen.length}</NbOfTxs>
      <CtrlSum>${euro(totaal)}</CtrlSum>
      <InitgPty><Nm>${esc(sepaTekst(o.opdrachtgeverNaam, 70))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(sepaTekst(o.berichtId, 35))}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${o.betalingen.length}</NbOfTxs>
      <CtrlSum>${euro(totaal)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${o.uitvoerDatum}</ReqdExctnDt>
      <Dbtr><Nm>${esc(sepaTekst(o.opdrachtgeverNaam, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${normaliseerIban(o.opdrachtgeverIban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId>${o.opdrachtgeverBic ? `<BIC>${esc(o.opdrachtgeverBic)}</BIC>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${regels}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
  return { ok: true, xml };
}
