"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { FileUploader } from "@/components/forms/FileUploader";

/** Chef-selectable upload categories → existing chef_document_type enum keys. */
const CATEGORIES: { value: string; label: string }[] = [
  { value: "id_document", label: "ID-bewijs" },
  { value: "certificate", label: "Certificaat / diploma" },
  { value: "other", label: "Overig (contract, loonstrook, …)" },
];

type RequestUpload = (
  type: string,
  args: { filename: string; mimeType: string; sizeBytes: number },
) => Promise<{ ok: true; uploadUrl: string; documentId: string } | { ok: false; error: string }>;

/**
 * CHEF-PR7: thin client wrapper around the shared FileUploader. Holds the chosen
 * category, binds it into the (server-action) requestUpload, and refreshes the
 * server component once the browser PUT to R2 completes.
 */
export function ChefDocUploader({ requestUpload }: { requestUpload: RequestUpload }) {
  const router = useRouter();
  const [type, setType] = useState(CATEGORIES[0].value);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-sm text-ink-800">Soort document</span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm focus:border-burgundy focus:outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <FileUploader
        requestUpload={(args) => requestUpload(type, args)}
        onUploaded={() => router.refresh()}
      />
    </div>
  );
}
