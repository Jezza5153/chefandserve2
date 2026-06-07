import { chefs } from "@/lib/db/schema";
import { listChefDocuments } from "@/lib/domain/chef-documents";

import { DocumentUploader } from "./DocumentUploader";

type ChefRow = typeof chefs.$inferSelect;
type ChefDocument = Awaited<ReturnType<typeof listChefDocuments>>[number];

/**
 * Documenten. Action-bearing — `deleteDocument` + `uploadRequest` stay in page.tsx
 * (they close over the route `id` / session) and arrive as props; the existing
 * <DocumentUploader> client child is rendered here unchanged. The original
 * `<section className="mt-8 ... p-6">` card is kept as-is (not DetailSection), so
 * only the inner markup is relocated verbatim.
 */
export function DocumentsSection({
  chef,
  documents,
  DOC_TYPE_LABELS,
  deleteDocument,
  uploadRequest,
  r2Ready,
}: {
  chef: ChefRow;
  documents: ChefDocument[];
  DOC_TYPE_LABELS: Record<string, string>;
  deleteDocument: (formData: FormData) => Promise<void>;
  uploadRequest: Parameters<typeof DocumentUploader>[0]["requestUpload"];
  r2Ready: boolean;
}) {
  return (
    <section className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      {/* @verbatim-start */}
      <div className="mb-4">
        <h2 className="font-serif text-lg text-ink-900">Documenten</h2>
        <p className="mt-1 text-sm text-ink-700">
          CV, foto, certificaten, ID-bewijs. Bestanden worden veilig opgeslagen
          in Cloudflare R2 — alleen toegankelijk via tijdelijk-getekende links.
        </p>
      </div>

      {documents.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded border border-ink-200 bg-bg-gray px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">
                  {doc.filename}
                </p>
                <p className="text-xs text-ink-500">
                  {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                  {doc.sizeBytes &&
                    ` · ${(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
                  {" · "}
                  {new Date(doc.createdAt).toLocaleDateString("nl-NL")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {doc.downloadUrl && (
                  <a
                    href={doc.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-ink-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-ink-900 hover:border-burgundy hover:text-burgundy"
                  >
                    Bekijk
                  </a>
                )}
                <form action={deleteDocument}>
                  <input type="hidden" name="documentId" value={doc.id} />
                  <button
                    type="submit"
                    className="rounded-full border border-red-200 bg-white px-3 py-1 font-ui text-[10px] font-medium uppercase tracking-[0.15em] text-red-700 hover:bg-red-50"
                  >
                    Verwijder
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ink-500">Nog geen documenten geupload.</p>
      )}

      <DocumentUploader
        chefId={chef.id}
        requestUpload={uploadRequest}
        disabled={!r2Ready}
      />
      {/* @verbatim-end */}
    </section>
  );
}
