/**
 * Drizzle schema — Phase 0.
 *
 * 9 tables for v1 Phase 0:
 *   users · authAccounts · authSessions · authVerificationTokens
 *   roles · permissions · rolePermissions · userRoles
 *   auditLog · errorLog · webhooksReceived
 *
 * Conventions:
 *   - All ids: uuid generated server-side via crypto.randomUUID()
 *     (Auth.js adapter requires text ids on auth tables, but app tables use uuid)
 *   - All times: `timestamp with time zone`, default now()
 *   - Foreign keys cascade on delete unless noted
 *   - `users.email` enforced lowercase via check constraint
 *   - `users.seed_key` lets the seed script identify rows after email changes
 *
 * Sentry replacement: errorLog is our own table — see PR-0F /admin/system/errors
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  jsonb,
  primaryKey,
  uniqueIndex,
  check,
  pgEnum,
} from "drizzle-orm/pg-core";

/* =============================================================================
 * Enums
 * =========================================================================== */

export const userKindEnum = pgEnum("user_kind", ["internal", "chef", "client"]);

export const userStatusEnum = pgEnum("user_status", [
  "invited", // row exists, cannot log in yet
  "active", // can log in
  "disabled", // explicitly blocked
]);

export const errorSeverityEnum = pgEnum("error_severity", [
  "info",
  "warning",
  "error",
  "critical",
]);

/** Submission lifecycle. `new` → triaged by Maarten → converted to chef/client OR rejected. */
export const submissionStatusEnum = pgEnum("submission_status", [
  "new", // just arrived
  "triaged", // Maarten has reviewed but not yet acted
  "converted", // promoted to a chef or client record
  "rejected", // not pursuing
  "duplicate", // already exists as chef/client
]);

/** Vakniveau (chef skill ladder) — ordered from junior to senior. */
export const vakniveauEnum = pgEnum("vakniveau", [
  "keukenhulp",
  "bediening",
  "host",
  "runner",
  "commis",
  "chef_de_partie",
  "sous_chef",
  "chef_de_cuisine",
  "executive_chef",
  "patissier",
  "banqueting",
  "breakfast",
  "roomservice",
  "other",
]);

/** Hospitality segment — drives matching. A chef can serve multiple segments. */
export const segmentEnum = pgEnum("segment", [
  "casual",
  "fine_dining",
  "hotel",
  "banqueting",
  "catering",
  "event",
  "corporate",
  "michelin",
]);

/** Chef availability lifecycle. */
export const chefStatusEnum = pgEnum("chef_status", [
  "onboarding", // intake done, paperwork in progress
  "active", // available for placement
  "paused", // temporarily unavailable
  "inactive", // not currently working with us
  "archived", // permanent exit
]);

/** Client lifecycle. */
export const clientStatusEnum = pgEnum("client_status", [
  "prospect", // intake done, no placements yet
  "active", // currently has placements
  "paused", // not currently booking
  "archived",
]);

/* =============================================================================
 * Users + Auth.js adapter tables
 * =========================================================================== */

/**
 * Application user table.
 * Auth.js's Drizzle adapter expects `id` (text), `email` (text, unique),
 * `emailVerified` (timestamp), `name` (text), `image` (text). We extend
 * with our domain fields.
 */
export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull().unique(),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    name: text("name"),
    image: text("image"),

    // App fields
    kind: userKindEnum("kind").notNull().default("internal"),
    status: userStatusEnum("status").notNull().default("invited"),
    permissionsVersion: integer("permissions_version").notNull().default(1),

    /**
     * Stable identifier for seeded users. Lets the seed re-run idempotently
     * even after the email is changed by an admin. Null for users created
     * via the admin UI later.
     */
    seedKey: text("seed_key").unique(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailLowercase: check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
  }),
);

/** Auth.js adapter table — OAuth accounts (unused in magic-link flow but required by adapter typing). */
export const authAccounts = pgTable(
  "auth_accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

/** Auth.js adapter table — required by typing; mostly unused since we use JWT strategy. */
export const authSessions = pgTable("auth_sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

/** Auth.js adapter table — magic-link tokens. Consumed on use. */
export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(), // email
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

/* =============================================================================
 * RBAC: roles, permissions, mappings
 * =========================================================================== */

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // e.g. 'super_admin'
  label: text("label").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resource: text("resource").notNull(), // e.g. 'chefs'
    action: text("action").notNull(), // e.g. 'read'
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("permissions_resource_action_unique").on(t.resource, t.action),
  }),
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
  }),
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
);

/* =============================================================================
 * Observability: auditLog · errorLog · webhooksReceived
 * =========================================================================== */

/** Who did what, when. Every mutation by an authed user. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g. 'auth.signin', 'chefs.update'
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Application error log — our minimal Sentry replacement. */
export const errorLog = pgTable("error_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  message: text("message").notNull(),
  stack: text("stack"),
  context: jsonb("context"), // arbitrary structured context
  url: text("url"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  userAgent: text("user_agent"),
  severity: errorSeverityEnum("severity").notNull().default("error"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Raw webhook deliveries. Phase 0 just creates the table; Phase 1 fills it. */
export const webhooksReceived = pgTable("webhooks_received", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // 'jotform' | 'payingit' | etc.
  payload: jsonb("payload").notNull(),
  signatureValid: boolean("signature_valid"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* =============================================================================
 * Submissions (Phase 1 — Jotform intake)
 *
 * Two tables — one per form-type for clean separation. Both share the same
 * shape: external ID for idempotency, the raw payload (jsonb) for replay,
 * structured fields the webhook extractor populates, status for triage flow,
 * and FK to the chef/client row created on "convert".
 * =========================================================================== */

/** Chef intake — sourced from Jotform 252442173847359. */
export const chefSubmissions = pgTable(
  "chef_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Jotform's submission ID. Idempotency key — same Jotform retry → 1 row. */
    externalId: text("external_id").notNull(),
    source: text("source").notNull().default("jotform"), // 'jotform' | 'manual' | future …

    /** Full raw Jotform payload — kept for replay + audit. */
    rawPayload: jsonb("raw_payload").notNull(),

    /* ----- structured fields extracted from Jotform ----- */
    fullName: text("full_name"),
    email: text("email"),
    phone: text("phone"),
    /** Free-text or comma list of desired roles (chef/sous/bediening/…). */
    rolesRequested: text("roles_requested"),
    yearsExperience: integer("years_experience"),
    /** Where the chef wants to work (Amsterdam/Randstad/etc.). */
    locationPreference: text("location_preference"),
    /** Free-text notes the chef wrote. */
    notes: text("notes"),

    status: submissionStatusEnum("status").notNull().default("new"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    triagedBy: text("triaged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Set when status='converted'. Phase 2's chefs.id (text uuid). */
    convertedToChefId: text("converted_to_chef_id"),
    rejectedReason: text("rejected_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    externalIdUnique: uniqueIndex("chef_submissions_external_id_unique").on(
      t.source,
      t.externalId,
    ),
  }),
);

/** Client intake — sourced from Jotform 252448184762060. */
export const clientSubmissions = pgTable(
  "client_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    externalId: text("external_id").notNull(),
    source: text("source").notNull().default("jotform"),

    rawPayload: jsonb("raw_payload").notNull(),

    /* ----- structured fields ----- */
    companyName: text("company_name"),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    /** What role(s) are they asking for? */
    roleRequested: text("role_requested"),
    /** casual | fine_dining | hotel | catering | event | corporate */
    segment: text("segment"),
    /** Date they need staff (free-text — chef intake forms vary). */
    dateNeeded: text("date_needed"),
    /** Number of staff. */
    headcount: integer("headcount"),
    /** Their location / address. */
    location: text("location"),
    /** Free-text notes. */
    notes: text("notes"),

    status: submissionStatusEnum("status").notNull().default("new"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    triagedBy: text("triaged_by").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Set when status='converted'. Phase 2's clients.id (text uuid). */
    convertedToClientId: text("converted_to_client_id"),
    rejectedReason: text("rejected_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    externalIdUnique: uniqueIndex("client_submissions_external_id_unique").on(
      t.source,
      t.externalId,
    ),
  }),
);

/* =============================================================================
 * Master records (Phase 2 — chefs + clients)
 *
 * These are the canonical entities the roster brain operates on. A submission
 * is "converted" into a master record by Maarten via the inbox UI. Master
 * records can also be created manually for chefs/clients that didn't come
 * through Jotform.
 * =========================================================================== */

export const chefs = pgTable("chefs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  /** Optional FK back to the submission that birthed this record. */
  sourceSubmissionId: uuid("source_submission_id"),

  /** Optional FK to a users row (if/when chef gets portal access — Phase 4). */
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),

  /* ----- identity ----- */
  fullName: text("full_name").notNull(),
  email: text("email"), // optional in case we onboard chefs by phone only
  phone: text("phone"),
  /** Free-text city/neighbourhood (e.g. "Amsterdam-Oost"). Phase 9 adds geo. */
  city: text("city"),

  /* ----- vakniveau & segments ----- */
  vakniveau: vakniveauEnum("vakniveau"),
  /** Multiple segments a chef can cover. Array column. */
  segments: text("segments").array(),
  /** Free-text list of specialties (e.g. "patisserie, banketkok, Frans"). */
  specialties: text("specialties"),

  /* ----- experience ----- */
  yearsExperience: integer("years_experience"),
  /** Languages the chef speaks (NL/EN/FR/…). Array. */
  languages: text("languages").array(),

  /* ----- rate ----- */
  /** Min hourly rate in cents (€ × 100). Phase 5 wires this to invoicing. */
  hourlyRateMinCents: integer("hourly_rate_min_cents"),
  hourlyRateMaxCents: integer("hourly_rate_max_cents"),

  /* ----- external IDs ----- */
  /** Payingit's employee ID once enrolled. Phase 5. */
  payingitEmployeeId: text("payingit_employee_id"),

  /* ----- lifecycle ----- */
  status: chefStatusEnum("status").notNull().default("onboarding"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),

  /** Maarten's tribal-knowledge notes. RAG-indexable in Phase 9. */
  notes: text("notes"),

  /* ----- audit ----- */
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** Soft-delete — preserves training data for AI. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const clients = pgTable("clients", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  sourceSubmissionId: uuid("source_submission_id"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),

  /* ----- identity ----- */
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  /** Kamer van Koophandel number — NL company registration. */
  kvk: text("kvk"),
  /** Btw / VAT id. */
  btw: text("btw"),

  /* ----- billing ----- */
  billingEmail: text("billing_email"),
  /** Payment terms (e.g. 14, 30). Default 14 for new clients. */
  paymentTermsDays: integer("payment_terms_days").default(14),

  /* ----- profile ----- */
  /** casual | fine_dining | hotel | banqueting | catering | event | corporate */
  segment: segmentEnum("segment"),
  /** Address — free-text for now; Phase 9 adds geocoding. */
  address: text("address"),
  city: text("city"),

  /* ----- external IDs ----- */
  payingitClientId: text("payingit_client_id"),

  /* ----- lifecycle ----- */
  status: clientStatusEnum("status").notNull().default("prospect"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),

  notes: text("notes"),

  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * Chef availability calendar. One row per (chef, date).
 * Default = available (no row = available). Use this table for BLOCKED dates.
 * Phase 4 chef portal toggles rows here.
 */
export const chefAvailability = pgTable(
  "chef_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "cascade" }),
    /** Calendar date (no time component — UTC midnight). */
    date: timestamp("date", { withTimezone: false, mode: "date" }).notNull(),
    /** true = explicitly available, false = blocked. */
    available: boolean("available").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chefDateUnique: uniqueIndex("chef_availability_chef_date_unique").on(
      t.chefId,
      t.date,
    ),
  }),
);

/* =============================================================================
 * Type exports (for use across the app)
 * =========================================================================== */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type ErrorLogEntry = typeof errorLog.$inferSelect;
export type ChefSubmission = typeof chefSubmissions.$inferSelect;
export type NewChefSubmission = typeof chefSubmissions.$inferInsert;
export type ClientSubmission = typeof clientSubmissions.$inferSelect;
export type NewClientSubmission = typeof clientSubmissions.$inferInsert;
export type Chef = typeof chefs.$inferSelect;
export type NewChef = typeof chefs.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type ChefAvailability = typeof chefAvailability.$inferSelect;
