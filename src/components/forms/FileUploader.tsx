"use client";

import { useState } from "react";

/**
 * Generic browser-direct-to-R2 uploader (PR-FB-2). Generalised from the admin
 * DocumentUploader: a single fixed document type per instance, an onUploaded
 * callback (so a form wizard can record the documentId in its own state), and
 * no router.refresh (the caller owns what happens next).
 *
 * Flow: requestUpload() → presigned PUT URL → XHR PUT to R2 → onUploaded(id).
 */

const DEFAULT_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";

type RequestUpload = (args: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) => Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }>;

export function FileUploader({
  requestUpload,
  accept = DEFAULT_ACCEPT,
  maxMb = 10,
  currentFilename,
  onUploaded,
  disabled,
}: {
  requestUpload: RequestUpload;
  accept?: string;
  maxMb?: number;
  currentFilename?: string | null;
  onUploaded?: (documentId: string, filename: string) => void;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading"; progress: number }
    | { kind: "done"; filename: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handlePick(file: File | null) {
    if (!file) return;
    setStatus({ kind: "uploading", progress: 0 });
    try {
      const result = await requestUpload({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!result.ok) {
        setStatus({ kind: "error", message: result.error });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setStatus({ kind: "uploading", progress: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload mislukt (${xhr.status})`));
        xhr.onerror = () => reject(new Error("Netwerkfout bij uploaden"));
        xhr.open("PUT", result.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.send(file);
      });
      setStatus({ kind: "done", filename: file.name });
      onUploaded?.(result.documentId, file.name);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : "Upload mislukt" });
    }
  }

  if (disabled) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Uploads zijn nog niet beschikbaar (R2 niet geconfigureerd).
      </p>
    );
  }

  const existing = status.kind === "done" ? status.filename : currentFilename;

  return (
    <div>
      <input
        type="file"
        accept={accept}
        disabled={status.kind === "uploading"}
        onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-full file:border-0 file:bg-burgundy file:px-4 file:py-2 file:font-ui file:text-[10px] file:font-medium file:uppercase file:tracking-[0.15em] file:text-white hover:file:bg-burgundy-900 disabled:opacity-50"
      />
      {status.kind === "uploading" && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-200">
          <div className="h-full bg-burgundy transition-all" style={{ width: `${status.progress}%` }} />
        </div>
      )}
      {status.kind === "error" && <p className="mt-1 text-xs text-red-700">⚠ {status.message}</p>}
      {existing && status.kind !== "uploading" && status.kind !== "error" && (
        <p className="mt-1 text-xs text-emerald-700">✓ {existing}</p>
      )}
      <p className="mt-1 text-[11px] text-ink-500">Max {maxMb} MB · PDF / JPG / PNG / WebP / HEIC</p>
    </div>
  );
}
