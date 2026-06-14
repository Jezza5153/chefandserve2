/**
 * Documenten & onboarding-readiness — owner-side drill-down on the klant detail (K2).
 * Lists the klant's non-deleted documents (RI&E etc.) with short-lived presigned download
 * links (resolved server-side in listClientDocuments) and a one-line readiness chip derived
 * from clients.onboardingStatus + whether an RI&E document is on file.
 */
import type { ClientDocumentType } from "@/lib/domain/client-documents";

type ClientDoc = {
  id: string;
  type: string;
  filename: string;
  downloadUrl: string;
  createdAt: Date;
};

const DOC_TYPE_LABEL: Record<ClientDocumentType, string> = {
  rie_document: "RI&E",
  other: "Overig",
};

const ONBOARDING_LABEL: Record<string, string> = {
  not_started: "Onboarding niet gestart",
  in_progress: "Onboarding loopt",
  submitted: "Onboarding ingediend",
};

export function ClientDocumentsSection({
  documents,
  onboardingStatus,
  hasRie,
}: {
  documents: ClientDoc[];
  onboardingStatus: string;
  hasRie: boolean;
}) {
  const onboardingTone =
    onboardingStatus === "submitted"
      ? "bg-emerald-100 text-emerald-800"
      : onboardingStatus === "in_progress"
        ? "bg-amber-100 text-amber-800"
        : "bg-bg-gray text-ink-600";

  return (
    <div className="mt-8 rounded-lg border border-ink-200 bg-white p-6">
      <h2 className="font-serif text-lg text-ink-900">Documenten &amp; onboarding</h2>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${onboardingTone}`}>
          {ONBOARDING_LABEL[onboardingStatus] ?? onboardingStatus}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            hasRie ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {hasRie ? "✓ RI&E aanwezig" : "RI&E ontbreekt"}
        </span>
      </div>

      {documents.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">Nog geen documenten geüpload voor deze klant.</p>
      ) : (
        <ul className="mt-4 divide-y divide-ink-200">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink-900">{d.filename}</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {DOC_TYPE_LABEL[(d.type as ClientDocumentType)] ?? d.type} ·{" "}
                  {new Date(d.createdAt).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
                </p>
              </div>
              {d.downloadUrl ? (
                <a
                  href={d.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 font-ui text-[11px] uppercase tracking-[0.15em] text-burgundy underline-offset-4 hover:underline"
                >
                  Download →
                </a>
              ) : (
                <span className="shrink-0 text-xs text-ink-400">geen opslag</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
