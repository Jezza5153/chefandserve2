/**
 * The owner assistant's full tool set. Add new tools here; `createRegistry` enforces
 * unique names and `scripts/smoke-ai-tools.mts` validates permission keys + risk tiers.
 */
import { createRegistry, type ToolRegistry } from "@/lib/ai/tools/registry";
import type { AnyTool } from "@/lib/ai/types";

import { businessOverview } from "@/lib/ai/tools/business";
import {
  hoursApprove,
  hoursListAwaitingApproval,
  hoursReject,
  hoursSendReminder,
} from "@/lib/ai/tools/hours";
import { shiftsOpenSoon, insightsLeaderboards, integrationsHealth } from "@/lib/ai/tools/ops";
import { placementsPropose } from "@/lib/ai/tools/placements";

export const ALL_TOOLS: AnyTool[] = [
  // read — the eyes
  businessOverview,
  shiftsOpenSoon,
  insightsLeaderboards,
  integrationsHealth,
  hoursListAwaitingApproval,
  // act — the hands
  hoursApprove,
  hoursReject,
  hoursSendReminder,
  placementsPropose,
];

export function buildRegistry(): ToolRegistry {
  return createRegistry(ALL_TOOLS);
}
