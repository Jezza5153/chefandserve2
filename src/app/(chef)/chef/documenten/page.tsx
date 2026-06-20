/**
 * /chef/documenten — CHEF-PR7. The chef's own document area: contract, loonstroken,
 * jaaropgave, ID, certificaten. View + download (short-lived presigned R2 URLs) +
 * upload + delete, reusing the existing chef-documents domain (no new schema, no
 * invoices-lane touch). Expiry is surfaced ("verloopt binnenkort") off the existing
 * document-expiry signals. Auth IS the lookup (session.user.id → chefs.userId).
 */
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import { chefs } from "@/lib/db/schema";
import {
  deleteOwnChefDocument,
  listChefDocuments,
  requestChefDocumentUpload,
  type DocumentType,
} from "@/lib/domain/chef-documents";
import { getI18n } from "@/lib/i18n/server";
import { fill, INTL_TAG } from "@/lib/i18n/locales";
import { type Dict } from "@/lib/i18n/get-dict";
import { requireAuth } from "@/lib/permissions";

import { ChefDocUploader } from "./ChefDocUploader";

export const metadata = { title: "Mijn documenten", robots: { index: false } };
export const dynamic = "force-dynamic";

const LABEL = "font-ui text-[11px] uppercase tracking-[0.18em] text-burgundy";

const ALLOWED_UPLOAD = new Set<DocumentType>(["id_document", "certificate", "other"]);

async function resolveChefId(): Promise<string> {
  const session = await requireAuth("/chef/documenten");
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) notFound();
  return chef.id;
}

/** Server action passed to the client uploader (binds chef from session). */
async function requestUpload(
  type: string,
  args: { filename: string; mimeType: string; sizeBytes: number },
) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  if (!chef) return { ok: false as const, error: "Geen chef-profiel." };
  const safeType: DocumentType = ALLOWED_UPLOAD.has(type as DocumentType)
    ? (type as DocumentType)
    : "other";
  const res = await requestChefDocumentUpload({
    chefId: chef.id,
    type: safeType,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    uploadedBy: session.user.id,
  });
  return res.ok
    ? { ok: true as const, uploadUrl: res.uploadUrl, documentId: res.documentId }
    : { ok: false as const, error: res.error };
}

async function deleteDoc(formData: FormData) {
  "use server";
  const session = await requireAuth();
  const chef = await db.query.chefs.findFirst({ where: eq(chefs.userId, session.user.id) });
  const documentId = String(formData.get("documentId") ?? "");
  if (!chef || !documentId) return;
  await deleteOwnChefDocument({ documentId, chefId: chef.id, actingUserId: session.user.id });
  redirect("/chef/documenten?ok=deleted");
}

function expiryNote(
  expiresAt: Date | null,
  t: Dict,
): { text: string; cls: string } | null {
  if (!expiresAt) return null;
  const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: t.documenten.expired, cls: "text-burgundy" };
  if (days <= 30)
    return {
      text: fill(t.documenten.expiresIn, {
        days,
        unit: days === 1 ? t.documenten.dayOne : t.documenten.dayMany,
      }),
      cls: "text-amber-700",
    };
  return null;
}

export default async function ChefDocumentenPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const sp = await searchParams;
  const { locale, dict: t } = await getI18n();
  const chefId = await resolveChefId();
  const docs = await listChefDocuments(chefId);
  const dayFmt = new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: "Europe/Amsterdam",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="pb-24">
      <p className={LABEL}>{t.documenten.eyebrow}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink-900 md:text-4xl">{t.documenten.title}</h1>
      <p className="mt-3 max-w-prose text-sm text-ink-700">{t.documenten.intro}</p>

      {sp.ok === "deleted" ? (
        <p className="mt-4 rounded-lg border border-ink-200 bg-bg-gray/50 p-3 text-sm text-ink-600">
          {t.documenten.deleted}
        </p>
      ) : null}

      {/* Upload */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <p className={LABEL}>{t.documenten.addDoc}</p>
        <div className="mt-3 max-w-md">
          <ChefDocUploader requestUpload={requestUpload} />
        </div>
      </section>

      {/* List */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
        <p className={LABEL}>{t.documenten.yourDocs}</p>
        {docs.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">{t.documenten.empty}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {docs.map((d) => {
              const exp = expiryNote(d.expiresAt, t);
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{d.filename}</p>
                    <p className="text-xs text-ink-500">
                      {t.documenten.types[d.type as keyof Dict["documenten"]["types"]] ?? d.type} · {dayFmt.format(d.createdAt)}
                      {d.verifiedAt ? ` · ${t.documenten.verified}` : ""}
                      {exp ? (
                        <>
                          {" · "}
                          <span className={exp.cls}>{exp.text}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {d.downloadUrl ? (
                      <a
                        href={d.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-ui text-[11px] font-medium uppercase tracking-[0.15em] text-burgundy hover:underline"
                      >
                        {t.documenten.view}
                      </a>
                    ) : null}
                    <form action={deleteDoc}>
                      <input type="hidden" name="documentId" value={d.id} />
                      <button className="text-xs text-ink-400 hover:text-burgundy">{t.documenten.delete}</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
