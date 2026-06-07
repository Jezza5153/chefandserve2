/**
 * The owner assistant's full tool set. Add new tools here; `createRegistry` enforces
 * unique names and `scripts/smoke-ai-tools.mts` validates permission keys + risk tiers.
 */
import { createRegistry, type ToolRegistry } from "@/lib/ai/tools/registry";
import type { AnyTool } from "@/lib/ai/types";

import { businessOverview } from "@/lib/ai/tools/business";
import { hoursApprove, hoursListAwaitingApproval, hoursSendReminder } from "@/lib/ai/tools/hours";

export const ALL_TOOLS: AnyTool[] = [
  businessOverview,
  hoursListAwaitingApproval,
  hoursApprove,
  hoursSendReminder,
];

export function buildRegistry(): ToolRegistry {
  return createRegistry(ALL_TOOLS);
}
