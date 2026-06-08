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
import { placementsPropose, placementsConfirm, placementsCancel } from "@/lib/ai/tools/placements";
import { chefsFind, clientsFind, shiftsFind } from "@/lib/ai/tools/directory";
import { emailSend } from "@/lib/ai/tools/comms";
import { remindersCreate, remindersList, remindersComplete } from "@/lib/ai/tools/reminders";
import { memoryRemember, memoryList, memoryForget } from "@/lib/ai/tools/memory";
import {
  chefsListProfileChanges,
  chefsApproveProfileChange,
  chefsRejectProfileChange,
} from "@/lib/ai/tools/profile-changes";
import { chefsSendAvailabilityReminder } from "@/lib/ai/tools/availability";
import { chefsWorkSummary, chefsFeedback, chefsTrends } from "@/lib/ai/tools/chef-profile";
import { rosterOverview } from "@/lib/ai/tools/roster";
import { clientsHistory } from "@/lib/ai/tools/clients";
import { plannerCockpitTool, shiftsSuggestChefs } from "@/lib/ai/tools/staffing";

export const ALL_TOOLS: AnyTool[] = [
  // read — the eyes
  businessOverview,
  shiftsOpenSoon,
  insightsLeaderboards,
  integrationsHealth,
  hoursListAwaitingApproval,
  chefsFind,
  clientsFind,
  shiftsFind,
  rosterOverview,
  chefsListProfileChanges,
  chefsWorkSummary,
  chefsFeedback,
  chefsTrends,
  clientsHistory,
  plannerCockpitTool,
  shiftsSuggestChefs,
  // act — the hands
  hoursApprove,
  hoursReject,
  hoursSendReminder,
  placementsPropose,
  placementsConfirm,
  placementsCancel,
  emailSend,
  chefsApproveProfileChange,
  chefsRejectProfileChange,
  chefsSendAvailabilityReminder,
  // personal — Maarten's own to-remember list
  remindersCreate,
  remindersList,
  remindersComplete,
  // personal — what Maarten teaches the assistant to remember
  memoryRemember,
  memoryList,
  memoryForget,
];

export function buildRegistry(): ToolRegistry {
  return createRegistry(ALL_TOOLS);
}
