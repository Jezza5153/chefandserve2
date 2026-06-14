/**
 * Portal-assistant tool registries — the scoped tool sets for the CHEF and KLANT assistants.
 * Kept SEPARATE from the owner's ALL_TOOLS: a chef/klant only ever sees their own read-only,
 * own-scoped tools (no owner tools leak in). Each tool is `permission: null` + `risk: "read"`
 * and keys its query off `ctx.actor.subject.entityId`.
 */
import { createRegistry, type ToolRegistry } from "@/lib/ai/tools/registry";
import type { AnyTool } from "@/lib/ai/types";

import { chefMyShiftsTool, chefMyHoursTool, chefMyProfileTool, chefMyAvailabilityTool, chefMyDocumentsTool, chefMyRatingTool } from "@/lib/ai/tools/chef-self";
import { clientMyShiftsTool, clientMyHoursTool, clientMyRequestsTool, clientMyTemplatesTool, clientShiftDetailTool } from "@/lib/ai/tools/client-self";

export const CHEF_TOOLS: AnyTool[] = [chefMyShiftsTool, chefMyHoursTool, chefMyAvailabilityTool, chefMyProfileTool, chefMyDocumentsTool, chefMyRatingTool];
export const CLIENT_TOOLS: AnyTool[] = [clientMyShiftsTool, clientMyHoursTool, clientMyTemplatesTool, clientShiftDetailTool, clientMyRequestsTool];

export function buildChefRegistry(): ToolRegistry {
  return createRegistry(CHEF_TOOLS);
}

export function buildClientRegistry(): ToolRegistry {
  return createRegistry(CLIENT_TOOLS);
}
