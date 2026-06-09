/**
 * The owner assistant's full tool set. Add new tools here; `createRegistry` enforces
 * unique names and `scripts/smoke-ai-tools.mts` validates permission keys + risk tiers.
 */
import { createRegistry, type ToolRegistry } from "@/lib/ai/tools/registry";
import type { AnyTool } from "@/lib/ai/types";

import { businessOverview } from "@/lib/ai/tools/business";
import {
  hoursApprove,
  hoursDetail,
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
import {
  chefsWorkSummary,
  chefsFeedback,
  chefsTrends,
  chefsProfileCompleteness,
} from "@/lib/ai/tools/chef-profile";
import { rosterOverview, rosterPublish, rosterAutofill, rosterCopyLastWeek } from "@/lib/ai/tools/roster";
import { clientsHistory, clientsHealth } from "@/lib/ai/tools/clients";
import { plannerCockpitTool, shiftsSuggestChefs, shiftsMargin } from "@/lib/ai/tools/staffing";
import { contactsTimeline, contactsLog } from "@/lib/ai/tools/contacts";
import { chefsSemanticSearch, clientsSemanticSearch } from "@/lib/ai/tools/semantic";
import { knowledgeSearch } from "@/lib/ai/tools/knowledge";
import { auditSearch, documentsListForChef, documentsExpiring, privacyListRequests, emailStatus, payrollRead } from "@/lib/ai/tools/oversight";
import { briefingDaily } from "@/lib/ai/tools/briefing";
import { shiftsDetail } from "@/lib/ai/tools/shift-detail";
import { chefsHistoryAtClient } from "@/lib/ai/tools/chef-client-history";
import { risksScan } from "@/lib/ai/tools/risks";
import { intakeList } from "@/lib/ai/tools/intake";
import { chefsAvailability } from "@/lib/ai/tools/chef-availability";
import { clientsShiftRequests, clientsDecideShiftRequest } from "@/lib/ai/tools/client-requests";
import { placementsReply } from "@/lib/ai/tools/placement-reply";

export const ALL_TOOLS: AnyTool[] = [
  // read — the eyes
  businessOverview,
  shiftsOpenSoon,
  insightsLeaderboards,
  integrationsHealth,
  hoursListAwaitingApproval,
  hoursDetail,
  chefsFind,
  clientsFind,
  shiftsFind,
  shiftsDetail,
  rosterOverview,
  chefsListProfileChanges,
  chefsWorkSummary,
  chefsFeedback,
  chefsTrends,
  chefsProfileCompleteness,
  chefsAvailability,
  intakeList,
  clientsHistory,
  clientsHealth,
  clientsShiftRequests,
  chefsHistoryAtClient,
  plannerCockpitTool,
  risksScan,
  shiftsSuggestChefs,
  chefsSemanticSearch,
  clientsSemanticSearch,
  shiftsMargin,
  contactsTimeline,
  knowledgeSearch,
  auditSearch,
  documentsListForChef,
  documentsExpiring,
  privacyListRequests,
  emailStatus,
  payrollRead,
  briefingDaily,
  // act — the hands
  hoursApprove,
  hoursReject,
  hoursSendReminder,
  placementsPropose,
  placementsConfirm,
  placementsCancel,
  placementsReply,
  rosterPublish,
  rosterAutofill,
  rosterCopyLastWeek,
  emailSend,
  chefsApproveProfileChange,
  chefsRejectProfileChange,
  chefsSendAvailabilityReminder,
  contactsLog,
  clientsDecideShiftRequest,
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
