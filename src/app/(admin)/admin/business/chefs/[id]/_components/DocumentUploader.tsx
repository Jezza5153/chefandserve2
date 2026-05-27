"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type DocumentType = "cv" | "photo" | "certificate" | "id_document" | "other";

type Props = {
  chefId: string;
  requestUpload: (args: {
    chefId: string;
    type: DocumentType;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<
    | { ok: true; uploadUrl: string; documentId: string }
    | { ok: false; error: string }
  >;
  disabled?: boolean;
};

/**
 * Browser-direct upload to Cloudflare R2.
 *
 * Flow:
 *   1. User picks file + type
 *   2. We call the server action requestUpload(...) → returns presigned PUT URL
 *   3. We do PUT uploadUrl with the file body (R2 receives it directly,
 *      never proxied through our Next.js app)
 *   4. After success → router.refresh() to show the new doc in the list
 */
export function DocumentUploader({ chefId, requestUpload, disabled }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<DocumentType>("cv");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading"; progress: number }
    | { kind: "done" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function handleUpload() {
    if (!file) return;
    setStatus({ kind: "uploading", progress: 0 });

    try {
      const result = await requestUpload({
        chefId,
        type,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });

      if (!result.ok) {
        setStatus({ kind: "error", message: result.error });
        return;
      }

      // Direct PUT to R2 — using XHR so we can track progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setStatus({
              kind: "uploading",
              progress: Math.round((e.loaded / e.total) * 100),
            });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 returned ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.open("PUT", result.uploadUrl);
        xhr.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream",
        );
        xhr.send(file);
      });

      setStatus({ kind: "done" });
      setFile(null);
      startTransition(() => {
        router.refresh();
        setTimeout(() => setStatus({ kind: "idle" }), 2000);
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Upload failed",
      });
    }
  }

  if (disabled) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Bestand-uploads zijn nog niet geconfigureerd (R2 env vars ontbreken).
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-bg-gray p-4">
      <div className="grid gap-3 md:grid-cols-[auto_1fr_auto]">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as DocumentType)}
          disabled={status.kind === "uploading"}
          className="rounded border border-ink-200 bg-white px-3 py-2 text-sm focus:border-burgundy focus:outline-none focus:ring-1 focus:ring-burgundy"
        >
          <option value="cv">CV</option>
          <option value="photo">Foto</option>
          <option value="certificate">Certificaat</option>
          <option value="id_document">ID-bewijs</option>
          <option value="other">Overig</option>
        </select>

        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={status.kind === "uploading"}
          className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-full file:border-0 file:bg-burgundy file:px-4 file:py-2 file:font-ui file:text-[10px] file:font-medium file:uppercase file:tracking-[0.15em] file:text-white hover:file:bg-burgundy-900"
        />

        <button
          type="button"
          onClick={handleUpload}
          disabled={!file || status.kind === "uploading"}
          className="rounded-full bg-burgundy px-5 py-2 font-ui text-[10px] font-medium uppercase tracking-[0.18em] text-white transition-colors hover:bg-burgundy-900 disabled:opacity-50"
        >
          {status.kind === "uploading"
            ? `Uploaden ${status.progress}%`
            : "Upload"}
        </button>
      </div>

      {status.kind === "error" && (
        <p className="mt-2 text-xs text-red-700">⚠ {status.message}</p>
      )}
      {status.kind === "done" && (
        <p className="mt-2 text-xs text-emerald-700">✓ Geupload</p>
      )}
      {status.kind === "uploading" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-200">
          <div
            className="h-full bg-burgundy transition-all"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}

      <p className="mt-2 text-xs text-ink-500">
        Max 10 MB · PDF / JPG / PNG / WebP / HEIC
      </p>
    </div>
  );
}
