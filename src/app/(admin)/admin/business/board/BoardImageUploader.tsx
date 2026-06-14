"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Per-post image uploader (BOARD-2). Presigns via the server action, PUTs the
 * file straight to R2 (no proxy through the app), then refreshes. Mirrors the
 * chef DocumentUploader flow.
 */
type PresignResult = { ok: true; uploadUrl: string } | { ok: false; error: string };

export function BoardImageUploader({
  postId,
  presignAction,
}: {
  postId: string;
  presignAction: (args: {
    postId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<PresignResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await presignAction({
        postId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const put = await fetch(res.uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) {
        setErr("Upload mislukt.");
        return;
      }
      router.refresh();
    } catch {
      setErr("Upload mislukt.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <label className="cursor-pointer text-xs text-burgundy hover:underline">
      {busy ? "Uploaden…" : "+ Afbeelding"}
      <input type="file" accept="image/*" className="hidden" onChange={onPick} disabled={busy} />
      {err ? <span className="ml-2 text-red-600">{err}</span> : null}
    </label>
  );
}
