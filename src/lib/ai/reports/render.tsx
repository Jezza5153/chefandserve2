/**
 * Render the Business-KPI report to a PDF and hand back a short-lived download link:
 * build data → render React-PDF to a Buffer → upload to R2 (private) → presign a 24h GET URL.
 * Degrades gracefully if R2 isn't configured (returns an error the tool surfaces in plain Dutch).
 */
import { randomUUID } from "node:crypto";

import { renderToBuffer } from "@react-pdf/renderer";

import { buildKpiReportData } from "@/lib/ai/read-model/report-kpi";
import { KpiReportDoc } from "@/lib/ai/reports/kpi-report";
import { getDownloadUrl, putObject, r2IsConfigured } from "@/lib/r2";

export type ReportResult = { ok: true; url: string } | { ok: false; error: string };

export async function generateKpiReport(now: Date): Promise<ReportResult> {
  if (!r2IsConfigured()) {
    return { ok: false, error: "Bestandsopslag (R2) is niet geconfigureerd, dus ik kan het rapport niet opslaan." };
  }
  const data = await buildKpiReportData(now);
  const buffer = await renderToBuffer(<KpiReportDoc data={data} />);
  const stamp = now.toISOString().slice(0, 10);
  const key = `reports/business-kpi/${stamp}-${randomUUID().slice(0, 8)}.pdf`;
  await putObject(key, buffer, "application/pdf");
  const url = await getDownloadUrl(key, 60 * 60 * 24); // 24h link
  return { ok: true, url };
}
