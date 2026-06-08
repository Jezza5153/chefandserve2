/**
 * Core types for the owner AI assistant runtime.
 *
 * This module is intentionally PURE — no DB, no env, no Next, no LLM. It defines the
 * contracts every channel (dashboard, WhatsApp, voice) and every tool conform to, so
 * the whole assistant funnels through ONE gate and ONE audit trail.
 */
import type { ZodType } from "zod";

/**
 * How consequential an action is — decides whether the human must confirm it.
 * - read      : pure information, no side effects        → never needs confirmation.
 * - self      : changes only the owner's own state       → no confirmation (e.g. "set my reminder").
 * - outbound  : a side effect reaching a third party     → one confirmation (e.g. email/WhatsApp a chef).
 * - financial : moves money or is irreversible           → strong confirmation (approve hours, export payroll, delete).
 */
export type RiskTier = "read" | "self" | "outbound" | "financial";

export type AiChannel = "dashboard" | "whatsapp" | "voice";

/**
 * Who the assistant is acting for. The assistant NEVER has its own authority — it
 * borrows the requesting human's permission ceiling and can never exceed it.
 */
export type AiActor = {
  /** The human giving the instruction (Maarten). Recorded as `requestedBy` in the delegation audit. */
  requestedByUserId: string;
  /** That human's role, e.g. "owner". */
  requestedByRole: string;
  /** The service-account identity that owns the AI's audit rows (never a human login). */
  paServiceUserId: string;
  /** The human's effective permission keys ("resource.action"). This is the assistant's ceiling. */
  effectivePerms: ReadonlySet<string>;
  /**
   * For the chef/klant portal assistants: the entity the caller IS. Their scoped tools read
   * ONLY this entity's data (the "auth IS the lookup" rule) — the model never supplies an id.
   * Undefined for the owner assistant (which is RBAC-permission-scoped instead).
   */
  subject?: { kind: "chef" | "client"; entityId: string };
};

export type ToolPermission = { resource: string; action: string };

export type ToolContext = {
  actor: AiActor;
  channel: AiChannel;
  /** Signed token proving the human confirmed THIS exact action. Absent on the first attempt. */
  confirmation?: string;
  /** Free-text intent the human expressed, recorded in the delegation audit. */
  reason?: string;
};

export type ToolRunResult = {
  /** Structured result handed back to the brain / channel. */
  data: unknown;
  /** Short Dutch sentence describing what happened, safe to read back to the human. */
  summary: string;
};

export type ToolDef<I = unknown> = {
  /** Stable id, "resource.action" style, e.g. "hours.approve". */
  name: string;
  /** Dutch human label. */
  title: string;
  /** What the tool does — shown to the brain so it can choose it. */
  description: string;
  risk: RiskTier;
  /** Permission required to run it, or null for actions any authenticated owner may take. */
  permission: ToolPermission | null;
  /** Runtime validation of the brain-supplied arguments. */
  input: ZodType<I>;
  /** Builds the confirmation sentence for outbound/financial tools. Falls back to `title`. */
  describeAction?: (input: I, ctx: ToolContext) => string;
  /** The actual work. Assumed to perform its own DB transaction + business audit row where needed. */
  run: (input: I, ctx: ToolContext) => Promise<ToolRunResult>;
};

/** Heterogeneous tool storage (the registry holds tools of many input shapes). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;

export type ConfirmationRequest = {
  tool: string;
  risk: RiskTier;
  /** Channel-neutral description of what will happen if confirmed. */
  summary: string;
  /** Opaque signed token the channel echoes back to proceed. */
  token: string;
};

export type ToolResult =
  | { status: "ok"; data: unknown; summary: string }
  | { status: "needs_confirmation"; confirmation: ConfirmationRequest }
  | { status: "denied"; reason: string }
  | { status: "error"; error: string };

/** One audit signal emitted by the executor. The real sink maps these to `audit_log` rows. */
export type AiAuditEvent = {
  kind: "invoked" | "completed" | "blocked" | "failed";
  tool: string;
  risk: RiskTier;
  actor: AiActor;
  channel: AiChannel;
  /** Why it was blocked/failed (e.g. "perm_denied", "needs_confirmation", "invalid_input"). */
  reason?: string;
  resourceId?: string | null;
  detail?: Record<string, unknown>;
};

export type AiAuditSink = (event: AiAuditEvent) => Promise<void>;
