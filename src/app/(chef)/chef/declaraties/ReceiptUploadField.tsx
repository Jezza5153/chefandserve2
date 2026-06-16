"use client";

import { useState } from "react";

import { FileUploader } from "@/components/forms/FileUploader";

/**
 * CHEF-PR9b: optional receipt photo for an expense claim. Sits INSIDE the expense
 * <form>; on a successful browser-direct-to-R2 upload it stores the returned r2Key
 * in a hidden input so the form's server action submits it with the claim.
 */
type RequestUpload = (args: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }>;

export function ReceiptUploadField({ requestUpload }: { requestUpload: RequestUpload }) {
  const [r2Key, setR2Key] = useState("");

  return (
    <div>
      <span className="text-sm text-ink-800">Bon meesturen (optioneel)</span>
      <div className="mt-1">
        <FileUploader
          requestUpload={requestUpload}
          onUploaded={(documentId) => setR2Key(documentId)}
        />
      </div>
      <input type="hidden" name="receiptR2Key" value={r2Key} />
    </div>
  );
}
