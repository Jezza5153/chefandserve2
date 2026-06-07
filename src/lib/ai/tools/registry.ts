/**
 * The tool registry — the assistant's complete set of "hands". Each tool is a typed,
 * permission-tagged, risk-tiered capability. The registry is the single source of
 * truth the brain sees and the executor dispatches through.
 */
import type { AnyTool, RiskTier, ToolDef } from "@/lib/ai/types";

/** Identity helper that preserves the input type for `run` / `describeAction`. */
export function defineTool<I>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

/** What the brain is told about a tool (no executable bits, no secrets). */
export type ToolSpec = {
  name: string;
  title: string;
  description: string;
  risk: RiskTier;
};

export type ToolRegistry = {
  get(name: string): AnyTool | undefined;
  list(): AnyTool[];
  specs(): ToolSpec[];
};

export function createRegistry(tools: readonly AnyTool[]): ToolRegistry {
  const map = new Map<string, AnyTool>();
  for (const t of tools) {
    if (map.has(t.name)) throw new Error(`Dubbele tool-naam in registry: ${t.name}`);
    map.set(t.name, t);
  }
  return {
    get: (name) => map.get(name),
    list: () => [...map.values()],
    specs: () =>
      [...map.values()].map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        risk: t.risk,
      })),
  };
}
