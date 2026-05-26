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
 * Type exports (for use across the app)
 * =========================================================================== */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type ErrorLogEntry = typeof errorLog.$inferSelect;
