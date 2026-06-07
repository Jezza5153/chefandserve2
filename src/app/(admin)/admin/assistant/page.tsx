/**
 * /admin/assistant — the owner assistant's dashboard channel. Owner / super_admin only.
 * Dormant until AI_ENABLED + OPENAI_API_KEY are set (the chat shows a hint).
 */
import { requireRole } from "@/lib/permissions";
import { aiEnabled } from "@/lib/ai/config";
import { AssistantChat } from "./AssistantChat";

export const metadata = { title: "Assistent", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await requireRole("owner");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-ink-900">Assistent</h1>
        <p className="mt-1 text-sm text-ink-500">
          Je persoonlijke assistent. Vraag om data of een actie — bij acties die iets versturen of
          goedkeuren vraag ik eerst je bevestiging.
        </p>
      </div>
      <AssistantChat enabled={aiEnabled()} />
    </div>
  );
}
