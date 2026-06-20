"use client";

import { useState } from "react";

import { FileUploader } from "@/components/forms/FileUploader";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * CHEF-PR7: optional invoice-PDF upload for a ZZP self-bill. Sits inside the
 * invoice <form>; on a successful browser-direct-to-R2 upload it stores the
 * returned r2Key in a hidden input so the server action submits it with the invoice.
 */
type RequestUpload = (args: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }>;

export function InvoiceUploadField({ requestUpload }: { requestUpload: RequestUpload }) {
  const [r2Key, setR2Key] = useState("");
  const t = useT();
  return (
    <div>
      <span className="text-sm text-ink-800">{t.invoices.uploadLabel}</span>
      <div className="mt-1">
        <FileUploader requestUpload={requestUpload} onUploaded={(id) => setR2Key(id)} accept="application/pdf" />
      </div>
      <input type="hidden" name="invoiceR2Key" value={r2Key} />
    </div>
  );
}
