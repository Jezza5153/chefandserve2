/**
 * P5a-2: shape the assistant's most recent `shifts.suggest_chefs` result into a minimal,
 * AVG-safe action shortlist the owner chat renders as rows with a "Stel voor" button.
 * Labels only — chefId is opaque, chefName already appears in the assistant's own text,
 * score + one match reason are labels — never rates, PII, or free text. Pure + STRUCTURAL
 * (no AI-runtime imports), so it unit-tests without the agent loop and lives outside the
 * eval-gated `src/lib/ai` tree.
 */
export type ShortlistItem = { chefId: string; chefName: string; score: number; reason: string };
export type ShortlistEnvelope = { shiftId: string; items: ShortlistItem[] };

/** Structural mirror of an AgentStep — avoids importing the AI runtime types here. */
type StepLike = { tool: string; input: unknown; result: { status: string; data?: unknown } };

const SUGGEST_TOOL = "shifts.suggest_chefs";
const MAX_ITEMS = 5;

/**
 * Build the shortlist from the agent's steps: the LAST successful `shifts.suggest_chefs`
 * call (the shortlist the assistant most recently looked at). Returns null when there is no
 * such call or it yielded no usable rows — the chat then stays text-only.
 */
export function buildShortlistEnvelope(steps: readonly StepLike[] | undefined | null): ShortlistEnvelope | null {
  if (!Array.isArray(steps)) return null;

  let chosen: StepLike | null = null;
  for (const s of steps) {
    if (s && s.tool === SUGGEST_TOOL && s.result?.status === "ok") chosen = s; // keep the last one
  }
  if (!chosen) return null;

  const shiftId = readShiftId(chosen.input);
  if (!shiftId) return null;

  const items: ShortlistItem[] = [];
  for (const m of readMatches(chosen.result.data)) {
    const chefId = typeof m.chefId === "string" ? m.chefId.trim() : "";
    const chefName = typeof m.chefName === "string" ? m.chefName.trim() : "";
    if (!chefId || !chefName) continue;
    const score = typeof m.score === "number" && Number.isFinite(m.score) ? Math.max(0, Math.min(100, Math.round(m.score))) : 0;
    const reason = Array.isArray(m.reasons) && typeof m.reasons[0] === "string" ? m.reasons[0] : "";
    items.push({ chefId, chefName, score, reason });
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length > 0 ? { shiftId, items } : null;
}

function readShiftId(input: unknown): string | null {
  if (input && typeof input === "object" && "shiftId" in input) {
    const v = (input as { shiftId?: unknown }).shiftId;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function readMatches(data: unknown): Array<Record<string, unknown>> {
  if (data && typeof data === "object" && "matches" in data) {
    const m = (data as { matches?: unknown }).matches;
    if (Array.isArray(m)) return m as Array<Record<string, unknown>>;
  }
  return [];
}
