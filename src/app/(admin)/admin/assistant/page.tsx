/**
 * /admin/assistant — the owner assistant's dashboard channel. Owner / super_admin only.
 * Dormant until AI_ENABLED + OPENAI_API_KEY are set (the chat shows a hint).
 */
import { requirePermission } from "@/lib/permissions";
import { aiEnabled } from "@/lib/ai/config";
import { AssistantChat } from "@/components/ai/AssistantChat";
import { MemoryProposals } from "@/components/ai/MemoryProposals";

export const metadata = { title: "Assistent", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  // owner + super_admin only (assistant.use is owner-only; super_admin bypasses).
  await requirePermission("assistant", "use");
  // #4: the "Zal ik dit onthouden?" inbox rides the same flag as the miner that fills it.
  const memoryMining = process.env.AI_MEMORY_MINING_ENABLED === "true";
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-serif text-2xl text-ink-900">Assistent</h1>
        <p className="mt-1 text-sm text-ink-500">
          Je persoonlijke assistent. Vraag om data of een actie — bij acties die iets versturen of
          goedkeuren vraag ik eerst je bevestiging.
        </p>
      </div>
      <MemoryProposals enabled={memoryMining} />
      <AssistantChat enabled={aiEnabled()} />
    </div>
  );
}
