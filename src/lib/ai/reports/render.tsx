/**
 * Render a report to PDF and hand back a short-lived download link: render React-PDF to a Buffer
 * → upload to R2 (private) → presign a 24h GET URL. Degrades gracefully if R2 isn't configured
 * (returns an error the tool surfaces in plain Dutch). One upload helper, one generator per report.
 */
import { randomUUID } from "node:crypto";

import { renderToBuffer } from "@react-pdf/renderer";

import { buildKpiReportData } from "@/lib/ai/read-model/report-kpi";
import { buildChefsReportData } from "@/lib/ai/read-model/report-chefs";
import { KpiReportDoc } from "@/lib/ai/reports/kpi-report";
import { ChefsReportDoc } from "@/lib/ai/reports/chefs-report";
import { getDownloadUrl, putObject, r2IsConfigured } from "@/lib/r2";

export type ReportResult = { ok: true; url: string } | { ok: false; error: string };

const R2_MISSING = "Bestandsopslag (R2) is niet geconfigureerd, dus ik kan het rapport niet opslaan.";

/** Upload a rendered PDF buffer to R2 and presign a 24h download link. */
async function uploadPdf(buffer: Buffer, prefix: string, now: Date): Promise<ReportResult> {
  const key = `reports/${prefix}/${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.pdf`;
  await putObject(key, buffer, "application/pdf");
  return { ok: true, url: await getDownloadUrl(key, 60 * 60 * 24) };
}

export async function generateKpiReport(now: Date): Promise<ReportResult> {
  if (!r2IsConfigured()) return { ok: false, error: R2_MISSING };
  const data = await buildKpiReportData(now);
  const buffer = await renderToBuffer(<KpiReportDoc data={data} />);
  return uploadPdf(buffer, "business-kpi", now);
}

export async function generateChefsReport(now: Date, rangeDays = 90): Promise<ReportResult> {
  if (!r2IsConfigured()) return { ok: false, error: R2_MISSING };
  const data = await buildChefsReportData(now, rangeDays);
  const buffer = await renderToBuffer(<ChefsReportDoc data={data} />);
  return uploadPdf(buffer, "chefs", now);
}
