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
  numeric,
  boolean,
  timestamp,
  time,
  date,
  uuid,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
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
  "cancelled_by_client", // klant retracted a portal submission (PR-KLANT-2)
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

/* ----- PR-2: structured chef intake (from the live Jotform) ----------------- */
/** "Do you have your own transportation?" → Car / Motorbike / Electric bike / No. */
export const transportModeEnum = pgEnum("transport_mode", [
  "car",
  "motorbike",
  "ebike",
  "none",
]);
/** "Payroll, ZZP or both?" */
export const employmentTypeEnum = pgEnum("employment_type", [
  "payroll",
  "zzp",
  "both",
]);
/** "Are you applying as a Chef or Front of house?" */
export const applyingAsEnum = pgEnum("applying_as", ["chef", "front_of_house"]);

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

/** Shift lifecycle. */
export const shiftStatusEnum = pgEnum("shift_status", [
  "request", // client request, not yet open for matching
  "open", // open for chef matching
  "filled", // at least one chef confirmed for full headcount
  "completed", // shift happened
  "cancelled", // client or us cancelled
]);

/** Chef document type — PDF/JPG metadata only; bytes live in R2. */
export const chefDocumentTypeEnum = pgEnum("chef_document_type", [
  "cv",
  "photo",
  "certificate",
  "id_document",
  "other",
  // PR-FB-1: native onboarding upload types (appended — order matters for ALTER TYPE)
  "bsn_registration",
  "id_copy_front",
  "id_copy_back",
  "bank_card",
]);

/** Placement lifecycle — the (chef, shift) record. */
export const placementStatusEnum = pgEnum("placement_status", [
  "proposed", // we offered to chef, awaiting response
  "accepted", // chef said yes
  "rejected", // chef said no
  "confirmed", // both sides agreed, chef + client notified
  "cancelled", // either side cancelled before shift
  "no_show", // chef didn't turn up
  "completed", // shift happened, hours logged
  // PR-PLANBORD-1: lifecycle-FIRST state despite array position. A private "concept"
  // placement (planbord drag / AI draft) that is INVISIBLE to chef + klant and ignored
  // by shift-status/fill counts until "Publiceer" flips it → proposed (which fires the
  // existing proposal mails). Appended last because `ALTER TYPE ADD VALUE` appends — the
  // array order must mirror the DB order, not the lifecycle order.
  "draft",
]);

/* ----- PR-FB-1: native onboarding form-builder + reminders enums ----------- */

/** Chef onboarding-form (Stage 2) progress. */
export const chefOnboardingStatusEnum = pgEnum("chef_onboarding_status", [
  "not_started",
  "in_progress",
  "submitted",
]);

/** Form lifecycle for the form-builder. */
export const formStatusEnum = pgEnum("form_status", ["draft", "published", "archived"]);

/** System-bound (typed column) vs custom (EAV) form field. */
export const formFieldKindEnum = pgEnum("form_field_kind", ["system", "custom"]);

/** Renderable input types for the form-builder. */
export const formFieldTypeEnum = pgEnum("form_field_type", [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "boolean",
  "file",
  "iban",
  "bsn",
  "postcode",
  "country",
  "heading",
]);

/** Reminder-rule trigger (extensible). */
export const reminderTriggerEnum = pgEnum("reminder_trigger", [
  "chef_birthday",
  "id_document_expiry",
  "certificate_expiry",
  "chef_inactivity",
  "custom_date",
]);

/** Reminder delivery channel. */
export const reminderChannelEnum = pgEnum("reminder_channel", ["email", "in_app", "both"]);

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

    /* ----- PR-S2D: password (bcrypt) for steady-state login ---------- */
    /**
     * bcrypt hash of the user's password. Null = user hasn't completed
     * the forced enrollment wizard yet. Internal users without a password
     * are bounced to /admin/account/setup on every request.
     */
    passwordHash: text("password_hash"),
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),

    /* ----- PR-S2A: TOTP 2FA (internal users only) -------------------- */
    /**
     * AES-256-GCM ciphertext of the TOTP shared secret. Format:
     * base64(iv || ciphertext || authTag). Encryption key from
     * env.TOTP_ENCRYPTION_KEY. Null = not enrolled.
     */
    totpSecretEncrypted: text("totp_secret_encrypted"),
    /**
     * Flipped to true on successful enrollment, false on disable. The
     * S2B/S2C challenge gate reads this — currently no challenge yet.
     */
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpEnrolledAt: timestamp("totp_enrolled_at", { withTimezone: true }),

    /* ----- PR-CHEF-11: ICS calendar feed token -------------------------
     * Per-user random secret used to derive the public ICS URL token.
     * Rotating this string invalidates any subscribed calendar app on
     * any device — the user's "logout of my calendar" button.
     */
    calendarTokenSecret: text("calendar_token_secret"),

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

/* ---------------------------------------------------------------------------
 * Per-user permission overrides (PR-RBAC-1). Layered ON TOP of role grants:
 *   effective = (rolePerms ∪ grants) − revokes   (super_admin bypasses all).
 * One row per (user, resource, action) — the PK — so a perm is granted,
 * revoked, or inherited; never ambiguous. Revoke is final/subtractive. Owners
 * may only set BUSINESS perms for staff (the save action enforces the
 * system/business wall + no-escalation-beyond-self).
 * ------------------------------------------------------------------------- */
export const permissionEffectEnum = pgEnum("permission_effect", ["grant", "revoke"]);

export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    effect: permissionEffectEnum("effect").notNull(),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.resource, t.action] }),
  }),
);

/* =============================================================================
 * Observability: auditLog · errorLog · webhooksReceived
 * =========================================================================== */

/** Who did what, when. Every mutation by an authed user. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * Phase B2 — when a super_admin performs this action while impersonating
   * (`Bekijk als`), `userId` is the TARGET and this is the real super_admin.
   * Null on normal actions. Lets us answer "who really did this?" forever.
   */
  impersonatorUserId: text("impersonator_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
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
  /**
   * PR-S1C step 1 — raw request headers captured for forensics + to identify
   * any signature header Jotform might send. Secrets (Authorization, Cookie)
   * are stripped before storage. Read this column to design the HMAC fallback
   * decision in S1C step 2.
   */
  headers: jsonb("headers"),
  signatureValid: boolean("signature_valid"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* =============================================================================
 * Recovery codes (PR-S2A) — one row per code, lifecycle tracked.
 *
 * 8 codes generated at TOTP enrollment, bcrypt-hashed (no plaintext stored).
 * `used_at` is set atomically on first use — never replayable. Disabling 2FA
 * deletes all rows for the user.
 *
 * NOTE: declared here (above users? no, schema relies on circular avoidance
 * via the foreign key). We place it at the bottom of the auth section but
 * BEFORE users? Drizzle handles forward refs via lazy refs (() => users.id).
 * Order in this file is for human readability only.
 * =========================================================================== */
export const userRecoveryCodes = pgTable(
  "user_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** bcrypt hash of the recovery code — never plaintext */
    codeHash: text("code_hash").notNull(),
    /** Atomic single-use: SET used_at = now() WHERE used_at IS NULL */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userRecoveryCodesUserIdx: index("user_recovery_codes_user_idx").on(
      t.userId,
      t.usedAt,
    ),
  }),
);

/* =============================================================================
 * Rate limits (PR-S1A) — per-scope sliding-window counter.
 *
 * Key derivation MUST keep scopes isolated. If a single key mixed email+ip,
 * an attacker could rotate emails to bypass the IP-only threshold. See
 * src/lib/rate-limit.ts for the hmac derivation.
 *
 * Scopes:
 *   magic_link_email  → hmac(SECRET, "magic_link_email:" + lower(email))  · 3 / 10 min
 *   magic_link_ip     → hmac(SECRET, "magic_link_ip:" + ip)               · 10 / hour
 *   totp_verify       → hmac(SECRET, "totp_verify:" + userId)             · 5 / 5 min  (S2B/S2C)
 *
 * Retention: rows older than 7 days pruned by workers/retention.ts (PR-AVG1).
 * Until that ships, the table grows but stays tiny (each row ~64 bytes).
 * =========================================================================== */
/* =============================================================================
 * Notification routes (PR-F1) — per-event configurable recipient list.
 *
 * Today every transactional/admin email is hardcoded to MAARTEN_EMAIL or
 * JEZZA_EMAIL via env var. This table lets the admin reroute per event from
 * the UI without a redeploy.
 *
 * Falls back to env vars when no row exists for the event (so behavior is
 * unchanged on first deploy). See src/lib/notifications.ts → routeFor().
 *
 * Events:
 *   chef_submission_received   client_submission_received
 *   client_portal_request      weekly_digest
 *   error_critical             totp_lockout
 *   erasure_r2_failure
 * =========================================================================== */
export const notificationRoutes = pgTable("notification_routes", {
  /** stable event key — primary key */
  event: text("event").primaryKey(),
  /** array of email addresses (normalized lowercase) */
  recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
  /** when false, sends are skipped (and logged to messages_sent as suppressed in PR-AVG1) */
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* =============================================================================
 * BUSINESS SETTINGS (PR-SET-1) — company-wide operational config / feature flags
 *
 * KV table for settings the OWNER (not just super_admin) controls without a
 * developer or env change. One row per key; `value` is jsonb so it holds a
 * boolean flag ({"enabled":true}) today and richer settings (SLAs, rates) later.
 * Read via src/lib/business-settings.ts (60s cache + safe default) by the app,
 * and via raw SQL by Railway workers (e.g. hours-reminders honors the flag).
 * =========================================================================== */
export const businessSettings = pgTable("business_settings", {
  /** stable setting key — primary key (e.g. 'hours_reminders') */
  key: text("key").primaryKey(),
  /** jsonb payload — boolean flags use {"enabled": true|false} */
  value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
  updatedBy: text("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    /** hmac_sha256(RATE_LIMIT_HASH_SECRET, scope+":"+identifier) — never raw PII */
    keyHash: text("key_hash").primaryKey(),
    /** which threshold this row is counting against */
    scope: text("scope").notNull(),
    /** hits in the current window */
    count: integer("count").notNull().default(0),
    /** start of the current window — when it expires, count resets */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    /** last hit, used by retention worker to prune cold rows */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Cold-row pruning by retention worker (PR-AVG1). NOT unique. */
    rateLimitsUpdatedAtIdx: index("rate_limits_updated_at_idx").on(t.updatedAt),
  }),
);

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

    /* ----- PR-2: structured intake (mirrors chefs; shown in triage) ----- */
    street: text("street"),
    houseNumber: text("house_number"),
    postcode: text("postcode"),
    transportMode: transportModeEnum("transport_mode"),
    preferences: text("preferences").array(),
    employmentType: employmentTypeEnum("employment_type"),
    applyingAs: applyingAsEnum("applying_as"),

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

    /**
     * PR-AUDIT-1: owner FK for portal submissions. Set on portal submit from
     * the session-resolved client; scopes retract + klant reads by id instead
     * of the non-unique `companyName` string (cross-tenant hole). Null for
     * jotform / native_* public intake (no session at submit time).
     */
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

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

    /* ----- PR-KLANT-2: klant self-cancel of a pending portal submission ----- */
    cancelledByClientAt: timestamp("cancelled_by_client_at", {
      withTimezone: true,
    }),
    cancelledByClientReason: text("cancelled_by_client_reason"),

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

  /* ----- PR-2: address (structured from Jotform → geocoded in PR-3) ----- */
  street: text("street"),
  houseNumber: text("house_number"),
  postcode: text("postcode"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),

  /* ----- PR-2: structured Jotform intake (feeds matching + filters) ----- */
  transportMode: transportModeEnum("transport_mode"),
  /** Multi-pick "what you like most": bbq/breakfast/banqueting/beachclub/early_shifts/hotels/restaurants/michelin/flexible. */
  preferences: text("preferences").array(),
  employmentType: employmentTypeEnum("employment_type"),
  applyingAs: applyingAsEnum("applying_as"),

  /* ----- ratings rollup (PR-KLANT-5) -------------------------------
   * Recomputed in the same tx as each rating insert. averageRating stays
   * NULL-ish until there's data; chef only SEES their average at N>=5
   * (enforced in src/lib/domain/ratings.ts, not here). Internal-only V1.
   */
  averageRating: numeric("average_rating", { precision: 3, scale: 2 }),
  ratingCount: integer("rating_count").notNull().default(0),

  /* ----- PR-FB-1: native onboarding personal data ------------------------
   * Replaces the Jotform "Personal data onboarding" form. System-bound form
   * fields write straight to these typed columns; BSN / IBAN / ID number are
   * AES-256-GCM ciphertext (src/lib/crypto.ts piiCipher) — never plaintext.
   */
  // name parts (fullName stays canonical; writeback recomputes it from these)
  firstName: text("first_name"),
  infix: text("infix"), // tussenvoegsel (van / de / der)
  surname: text("surname"),
  initials: text("initials"),
  // demographics
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"),
  nationality: text("nationality"),
  // address completion (street / houseNumber / postcode already above)
  placeOfResidence: text("place_of_residence"), // woonplaats
  country: text("country"),
  // identity document (the scans go to chef_documents)
  idType: text("id_type"), // passport | id_card | residence_permit
  idNumberEncrypted: text("id_number_encrypted"),
  idExpiresAt: date("id_expires_at"),
  // payroll-critical PII (encrypted at rest)
  bsnEncrypted: text("bsn_encrypted"),
  ibanEncrypted: text("iban_encrypted"),
  bankAccountHolderName: text("bank_account_holder_name"),
  // payroll flags / typed KPI signals
  loonheffingskorting: boolean("loonheffingskorting"),
  stippParticipated: boolean("stipp_participated"),
  stippMonths: integer("stipp_months"),
  workedForClientLast6mo: boolean("worked_for_client_last_6mo"),
  ownTransport: boolean("own_transport"), // complements transport_mode above
  // narrative (free text)
  bio: text("bio"), // "tell us about yourself"
  likesMost: text("likes_most"), // "what you like to do most"
  recentVenues: text("recent_venues"), // recent restaurants / hotels

  /* ----- lifecycle ----- */
  status: chefStatusEnum("status").notNull().default("onboarding"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  /** Native onboarding-form (Stage 2) progress. */
  onboardingStatus: chefOnboardingStatusEnum("onboarding_status")
    .notNull()
    .default("not_started"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  /** The forms.version the chef last answered against (re-base on republish). */
  onboardingFormVersion: integer("onboarding_form_version"),

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
  /**
   * Legacy ambiguous address — kept for backward compat. New code uses the
   * disambiguated columns below (PR-KLANT-0). Backfilled into shiftAddress.
   */
  address: text("address"),
  city: text("city"),

  /* ----- PR-KLANT-0: disambiguated addresses -------------------------
   * "address" was ambiguous (billing? shift location? office?). Split:
   *   shiftAddress       — where chefs physically report (klant-editable)
   *   shiftArrivalNotes  — gate code, which entrance, ask-for-X
   *   billingAddress     — legal/invoice address (admin-approved change only)
   * Shifts snapshot their own location at creation, so editing these here
   * NEVER rewrites existing shifts (correction round 3, #2).
   */
  shiftAddress: text("shift_address"),
  shiftArrivalNotes: text("shift_arrival_notes"),
  billingAddress: text("billing_address"),

  /* ----- external IDs ----- */
  payingitClientId: text("payingit_client_id"),

  /* ----- PR-2B: venue type + requirements + chef relationships ----- */
  /** hotel/restaurant/beachclub/event_venue/caterer/private/corporate/other */
  clientType: text("client_type"),
  /** ontbijt/banqueting/fine_dining/large_volume/early_start/solo_shift… */
  clientTags: text("client_tags").array(),
  /** chefs this klant prefers (soft boost in ranking). */
  favoriteChefIds: text("favorite_chef_ids").array(),
  /** chefs to never send here (HARD exclude in ranking). */
  blockedChefIds: text("blocked_chef_ids").array(),

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
 * Shifts + placements (Phase 3)
 *
 * Shift = a client's ask ("we need a sous chef on June 15, 18:00-23:00").
 * Placement = a (chef, shift) link — proposed/accepted/confirmed/etc.
 *
 * A shift can have multiple placements (e.g. headcount=3 → 3 placements).
 * Placements drive the chef portal + payroll bridge (Phase 4/5).
 * =========================================================================== */

export const shifts = pgTable("shifts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),

  /* ----- when ----- */
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** Free-text fallback if startsAt/endsAt aren't known yet (Phase 1 intakes). */
  whenDescription: text("when_description"),

  /* ----- what ----- */
  /** What chef-role do they need? */
  roleNeeded: vakniveauEnum("role_needed").notNull(),
  /** Segment context for matching. */
  segment: segmentEnum("segment"),
  /** How many chefs needed (1 = solo, 5 = brigade). */
  headcount: integer("headcount").notNull().default(1),

  /* ----- where ----- */
  location: text("location"),
  city: text("city"),
  /* PR-3: geocoded (PDOK) from the klant address/city for travel-cost estimates. */
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),

  /* ----- money ----- */
  /** Client-billed rate per chef in cents. */
  clientRateCents: integer("client_rate_cents"),
  /** Default chef-paid rate (placements can override). */
  chefRateCents: integer("chef_rate_cents"),

  /* ----- PR-2B: shift requirements (the other half of the matching brain) ----- */
  dressCode: text("dress_code"),
  languageRequired: text("language_required"),
  minExperience: integer("min_experience"),
  kitchenType: text("kitchen_type"),
  /** 'solo' | 'team' */
  soloOrTeam: text("solo_or_team"),
  /** 'prep' | 'live' | 'buffet' | 'fine_dining' */
  serviceStyle: text("service_style"),
  parkingAvailable: boolean("parking_available"),
  mealIncluded: boolean("meal_included"),
  startFlexible: boolean("start_flexible"),

  /* ----- lifecycle ----- */
  status: shiftStatusEnum("status").notNull().default("request"),
  /** INTERNAL admin-only — never shown to chef or client (PR-CHEF-2b). */
  notes: text("notes"),
  /** Chef-facing work instructions — safe to show on the chef proposal/shift. */
  chefVisibleNotes: text("chef_visible_notes"),
  /** Client-facing info — optional, shown in the klant portal (wired later). */
  clientVisibleNotes: text("client_visible_notes"),

  /* ----- PR-KLANT-4: recurring-template provenance -------------------
   * Set when a shift was auto-generated from a shift_template. The
   * (sourceTemplateId, sourceTemplateDate) pair is UNIQUE so the worker is
   * idempotent — re-running never duplicates a generated shift. Editing a
   * template does NOT touch already-generated shifts (they are independent).
   */
  sourceTemplateId: uuid("source_template_id").references(
    () => shiftTemplates.id,
    { onDelete: "set null" },
  ),
  sourceTemplateDate: date("source_template_date"),

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
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
}, (t) => ({
  templateDateUnique: uniqueIndex("shifts_template_date_unique")
    .on(t.sourceTemplateId, t.sourceTemplateDate)
    .where(sql`${t.sourceTemplateId} IS NOT NULL`),
}));

/**
 * Chef documents — metadata only. Bytes live in Cloudflare R2.
 *
 * Bytes path in R2: `chefs/<chefId>/<docId>/<filename>`
 * Public access: NONE. Files retrieved via short-lived presigned URLs
 * generated server-side by getDownloadUrl(documentId).
 */
export const chefDocumentStatusEnum = pgEnum("chef_document_status", [
  "uploaded",
  "needs_review",
  "verified",
  "expired",
  "rejected",
]);

export const chefDocuments = pgTable("chef_documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  chefId: text("chef_id")
    .notNull()
    .references(() => chefs.id, { onDelete: "cascade" }),
  type: chefDocumentTypeEnum("type").notNull().default("other"),
  /** Original filename as uploaded. */
  filename: text("filename").notNull(),
  /** Key in R2 bucket — `chefs/<chefId>/<docId>/<filename>`. */
  r2Key: text("r2_key").notNull().unique(),
  /** Reported by browser at upload time. Trust-but-verify. */
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedBy: text("uploaded_by").references(() => users.id, {
    onDelete: "set null",
  }),

  /* ----- PR-CHEF-12: trust signals -----------------------------------
   * Klant-visibility, verification, expiry. Used by:
   *   - /chef/profile shows labels "Klant mag zien" / "Alleen intern"
   *   - /admin/business/chefs/[id] has verify/reject/toggle/setExpiry
   *   - workers/document-expiry.ts sends 30d-out warnings
   */
  /** When true, klant portal pages may render this doc. Default false (intern). */
  clientVisible: boolean("client_visible").notNull().default(false),
  /** Admin marked the doc as legitimate. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by").references(() => users.id, {
    onDelete: "set null",
  }),
  /** Hard expiry — HACCP / SVH certs expire. Cron warns 30d out. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Workflow status — separate from soft-delete. */
  status: chefDocumentStatusEnum("status").notNull().default("uploaded"),
  rejectionReason: text("rejection_reason"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Soft-delete — preserve audit trail. R2 object purge happens via cleanup worker. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* =============================================================================
 * PR-FB-1: Form-builder (native onboarding) — forms / sections / fields / EAV
 *
 * One engine serves BOTH the public Stage-1 apply form and the authenticated
 * Stage-2 onboarding form (forms.slug + audience). System-bound fields write to
 * typed chefs/chef_documents columns via a code-owned binding registry
 * (src/lib/forms/system-bindings.ts); custom fields store answers in the EAV
 * table chef_field_values so they still feed typed KPIs.
 * =========================================================================== */

export const forms = pgTable(
  "forms",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Stable slug, e.g. 'chef-apply' | 'chef-onboarding'. */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Who fills it — 'chef' for both v1 forms; room for 'client' later. */
    audience: text("audience").notNull().default("chef"),
    status: formStatusEnum("status").notNull().default("draft"),
    /** Bumped on publish; chefs record which version they answered against. */
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("forms_slug_unique").on(t.slug),
  }),
);
export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;

export const formSections = pgTable(
  "form_sections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    formIdx: index("form_sections_form_idx").on(t.formId, t.sortOrder),
  }),
);
export type FormSection = typeof formSections.$inferSelect;
export type NewFormSection = typeof formSections.$inferInsert;

export const formFields = pgTable(
  "form_fields",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    sectionId: text("section_id")
      .notNull()
      .references(() => formSections.id, { onDelete: "cascade" }),
    kind: formFieldKindEnum("kind").notNull().default("custom"),
    /** Non-null + unique-per-form for system fields; null for custom. Maps to the binding registry. */
    systemKey: text("system_key"),
    type: formFieldTypeEnum("type").notNull(),
    /** Machine name — stable join key for EAV + KPIs. Unique per form. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    placeholder: text("placeholder"),
    required: boolean("required").notNull().default(false),
    isVisible: boolean("is_visible").notNull().default(true),
    /** PII flag → encrypt custom values at rest. */
    isSensitive: boolean("is_sensitive").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** select/multiselect options: [{value,label}]. */
    options: jsonb("options"),
    /** {minLen,maxLen,min,max,pattern,maxFileMb,accept,notFuture}. */
    validation: jsonb("validation"),
    /** file fields: which chef_documents.type to write. */
    documentType: chefDocumentTypeEnum("document_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sectionIdx: index("form_fields_section_idx").on(t.sectionId, t.sortOrder),
    formKeyUnique: uniqueIndex("form_fields_form_key_unique").on(t.formId, t.key),
    formSystemKeyUnique: uniqueIndex("form_fields_form_system_key_unique")
      .on(t.formId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
  }),
);
export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;

export const chefFieldValues = pgTable(
  "chef_field_values",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "cascade" }),
    fieldId: text("field_id")
      .notNull()
      .references(() => formFields.id, { onDelete: "cascade" }),
    /** Denormalised for KPI queries that don't want to join form_fields. */
    fieldKey: text("field_key").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number", { precision: 14, scale: 4 }),
    valueBoolean: boolean("value_boolean"),
    valueDate: date("value_date"),
    valueJson: jsonb("value_json"),
    documentId: text("document_id").references(() => chefDocuments.id, { onDelete: "set null" }),
    /** value_text holds AES-256-GCM ciphertext (sensitive custom field). */
    isEncrypted: boolean("is_encrypted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chefFieldUnique: uniqueIndex("chef_field_values_chef_field_unique").on(t.chefId, t.fieldId),
    fieldKeyIdx: index("chef_field_values_field_key_idx").on(t.fieldKey),
  }),
);
export type ChefFieldValue = typeof chefFieldValues.$inferSelect;
export type NewChefFieldValue = typeof chefFieldValues.$inferInsert;

/* =============================================================================
 * PR-FB-1: Configurable reminder-rules engine (+ idempotency ledger)
 * =========================================================================== */

export const reminderRules = pgTable(
  "reminder_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    triggerType: reminderTriggerEnum("trigger_type").notNull(),
    /** Fire this many days BEFORE the trigger date (0 = on the day). */
    leadDays: integer("lead_days").notNull().default(0),
    channel: reminderChannelEnum("channel").notNull().default("email"),
    /** Explicit recipient emails. */
    recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
    /** Role keys whose active users also receive it (e.g. {owner,planner}). */
    recipientRoles: text("recipient_roles").array().notNull().default(sql`'{}'::text[]`),
    /** Also notify the subject chef (e.g. their own ID expiring). */
    notifySubjectChef: boolean("notify_subject_chef").notNull().default(false),
    /** Trigger-specific knobs (inactivity thresholdDays, custom_date source, …). */
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enabledIdx: index("reminder_rules_enabled_idx").on(t.enabled, t.triggerType),
  }),
);
export type ReminderRule = typeof reminderRules.$inferSelect;
export type NewReminderRule = typeof reminderRules.$inferInsert;

export const reminderSends = pgTable(
  "reminder_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => reminderRules.id, { onDelete: "cascade" }),
    /** Nullable: custom_date / global rules may be chef-less. */
    chefId: text("chef_id").references(() => chefs.id, { onDelete: "cascade" }),
    /** Annual birthdays: "<year>". One-shot expiries: "YYYY-MM-DD" of the target date. */
    occurrenceKey: text("occurrence_key").notNull(),
    /** The calendar date this send was FOR (the trigger date, not send time). */
    targetDate: date("target_date"),
    channel: reminderChannelEnum("channel").notNull(),
    recipientCount: integer("recipient_count").notNull().default(0),
    /** sent | skipped_empty | error */
    status: text("status").notNull().default("sent"),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupe: uniqueIndex("reminder_sends_dedupe").on(t.ruleId, t.chefId, t.occurrenceKey),
    dedupeNullChef: uniqueIndex("reminder_sends_dedupe_null_chef")
      .on(t.ruleId, t.occurrenceKey)
      .where(sql`${t.chefId} is null`),
    ruleIdx: index("reminder_sends_rule_idx").on(t.ruleId, t.sentAt),
  }),
);
export type ReminderSend = typeof reminderSends.$inferSelect;
export type NewReminderSend = typeof reminderSends.$inferInsert;

export const placements = pgTable(
  "placements",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "restrict" }),

    status: placementStatusEnum("status").notNull().default("proposed"),

    /* ----- override rates (default to shift's if null) ----- */
    chefRateCents: integer("chef_rate_cents"),

    /* ----- timestamps for each transition ----- */
    proposedAt: timestamp("proposed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

    /* ----- audit ----- */
    proposedBy: text("proposed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    /** Maarten's match-score snapshot at proposal time (0-100). */
    matchScore: integer("match_score"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** One (chef, shift) row — chef can't be double-booked on same shift. */
    chefShiftUnique: uniqueIndex("placements_chef_shift_unique").on(
      t.chefId,
      t.shiftId,
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
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
export type Placement = typeof placements.$inferSelect;
export type NewPlacement = typeof placements.$inferInsert;
export type ChefDocument = typeof chefDocuments.$inferSelect;
export type NewChefDocument = typeof chefDocuments.$inferInsert;
export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
export type UserRecoveryCode = typeof userRecoveryCodes.$inferSelect;
export type NewUserRecoveryCode = typeof userRecoveryCodes.$inferInsert;
export type NotificationRoute = typeof notificationRoutes.$inferSelect;
export type NewNotificationRoute = typeof notificationRoutes.$inferInsert;

/* =============================================================================
 * Recovery intents (PR-C) — purpose-bound, single-use account recovery tokens.
 *
 * Fence 5: forgot-password and lost-2fa flows MUST NOT reuse generic login
 * magic-links. Each recovery email contains a token bound to a specific
 * intent. The recovery page validates intent matches before accepting the
 * 2nd factor.
 *
 *   intent = 'password' → /recover/password?token=<token>
 *     Requires current TOTP code + new password (twice).
 *   intent = 'totp'     → /recover/2fa?token=<token>
 *     Requires a recovery code; consumes it and wipes the user's TOTP
 *     so they re-enroll via the wizard.
 *
 * Token = 32 random bytes hex (64 chars). Expires 15 min after creation.
 * Single-use via atomic UPDATE … SET consumed_at = now() WHERE
 * consumed_at IS NULL. All attempts audited.
 * =========================================================================== */
export const recoveryIntentEnum = pgEnum("recovery_intent", ["password", "totp"]);

export const recoveryIntents = pgTable(
  "recovery_intents",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    intent: recoveryIntentEnum("intent").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recoveryIntentsUserIdx: index("recovery_intents_user_idx").on(
      t.userId,
      t.intent,
    ),
  }),
);

export type RecoveryIntent = typeof recoveryIntents.$inferSelect;
export type NewRecoveryIntent = typeof recoveryIntents.$inferInsert;

/* =============================================================================
 * Integration spine (PR-CHEF-0) — the operating-system layer underneath the
 * trust chain. Every external delivery (payroll, accounting, calendar, email)
 * goes through this set of tables so we have:
 *   - one place to see what's connected and healthy
 *   - one place to retry failed exports
 *   - idempotency on every outbound side-effect
 *   - delivery tracking for emails (via Resend webhooks)
 *   - in-app notifications as a separate channel (and future push source)
 *
 * Rules (see plan: "Integration principles"):
 *  - No external API call inside a business transaction.
 *  - Approve hours → write state + enqueue outbox row (atomic).
 *  - Workers consume outbox by `provider` field with retries.
 *  - External system IDs live in external_refs, never on entity tables.
 * =========================================================================== */

export const integrationStatusEnum = pgEnum("integration_status", [
  "disabled",
  "test",
  "active",
  "error",
]);

export const integrationOutboxStatusEnum = pgEnum("integration_outbox_status", [
  "pending",
  "processing",
  "sent",
  "failed",
  "skipped",
  "superseded",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "complained",
  "suppressed",
]);

/**
 * One row per external system we talk to. Status + last-checked surfaced on
 * /admin/business/integrations.
 */
export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  displayName: text("display_name").notNull(),
  status: integrationStatusEnum("status").notNull().default("disabled"),
  /** AES-256-GCM ciphertext (reuses TOTP_ENCRYPTION_KEY pattern). */
  configEncrypted: text("config_encrypted"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Outbox: every cross-system side-effect lands here first. Workers pick rows
 * by (provider, status='pending', nextAttemptAt < now()) and execute.
 *
 * Idempotency: `idempotencyKey` is UNIQUE. Same key = same logical event.
 * Re-enqueuing with the same key is a no-op (ON CONFLICT DO NOTHING).
 */
export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: integrationOutboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    runId: uuid("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idempotencyKeyUnique: uniqueIndex("integration_outbox_idempotency_unique").on(
      t.idempotencyKey,
    ),
    pendingIdx: index("integration_outbox_pending_idx").on(
      t.provider,
      t.status,
      t.nextAttemptAt,
    ),
  }),
);

/**
 * Manual or cron-driven export runs. Groups outbox rows for forensics and
 * surfaces success/fail counts on /admin/business/integrations.
 */
export const integrationRuns = pgTable("integration_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  /** 'manual_export' | 'cron' | 'retry' | 'dry_run' */
  runType: text("run_type").notNull(),
  /** 'pending' | 'running' | 'success' | 'partial' | 'failed' */
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  totalItems: integer("total_items"),
  successCount: integer("success_count"),
  failedCount: integer("failed_count"),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Maps Chef & Serve entities to external system IDs.
 *   - chef → payingit employee id
 *   - client → accounting customer id
 *   - shift_hours → payroll batch line id
 *   - payroll_batch → external batch ref
 */
export const externalRefs = pgTable(
  "external_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    metaJson: jsonb("meta_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerEntityUnique: uniqueIndex("external_refs_provider_entity_unique").on(
      t.provider,
      t.entityType,
      t.entityId,
    ),
  }),
);

/**
 * One row per email sent. Resend's providerMessageId is the bridge to the
 * webhook events table — webhook lookups join on this id.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerMessageId: text("provider_message_id"),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    eventKey: text("event_key"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: emailStatusEnum("status").notNull().default("queued"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerMessageIdUnique: uniqueIndex(
      "email_messages_provider_message_id_unique",
    ).on(t.providerMessageId),
    statusIdx: index("email_messages_status_idx").on(t.status, t.createdAt),
  }),
);

/**
 * Raw Resend webhook events. Lets us replay/audit + debug bounce reasons.
 */
export const emailEvents = pgTable("email_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id")
    .notNull()
    .references(() => emailMessages.id, { onDelete: "cascade" }),
  providerEventType: text("provider_event_type").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * In-app notifications — the bell-and-list inbox. Future Web Push source.
 *
 * Read marker via `readAt`. We index on (userId, readAt) for the unread
 * count query that runs on every page render of any layout with the bell.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    actionUrl: text("action_url"),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    unreadIdx: index("notifications_unread_idx").on(
      t.userId,
      t.readAt,
      t.createdAt,
    ),
  }),
);

/**
 * Lightweight contact log — when Maarten clicks "Bel chef" / "WhatsApp",
 * a small modal captures the outcome. Builds operational memory.
 */
export const contactLogs = pgTable("contact_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: text("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /** 'chef' | 'client' */
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  /** 'phone' | 'whatsapp' | 'email' | 'in_person' */
  channel: text("channel").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  /** 'no_answer' | 'spoken' | 'callback_requested' | 'note_only' */
  outcome: text("outcome"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ----- Type exports ------------------------------------------------------ */
export type IntegrationConnection =
  typeof integrationConnections.$inferSelect;
export type NewIntegrationConnection =
  typeof integrationConnections.$inferInsert;
export type IntegrationOutboxRow = typeof integrationOutbox.$inferSelect;
export type NewIntegrationOutboxRow = typeof integrationOutbox.$inferInsert;
export type IntegrationRun = typeof integrationRuns.$inferSelect;
export type NewIntegrationRun = typeof integrationRuns.$inferInsert;
export type ExternalRef = typeof externalRefs.$inferSelect;
export type NewExternalRef = typeof externalRefs.$inferInsert;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type NewEmailMessage = typeof emailMessages.$inferInsert;
export type EmailEvent = typeof emailEvents.$inferSelect;
export type NewEmailEvent = typeof emailEvents.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type ContactLog = typeof contactLogs.$inferSelect;
export type NewContactLog = typeof contactLogs.$inferInsert;

/* =============================================================================
 * Shift hours (PR-CHEF-1) — the trust chain backbone.
 *
 * One row per placement. The placement is the "work assignment"; the hours
 * row is the "payroll-evidence" lifecycle that flows: chef logs → klant
 * signs → admin approves → exported to payroll. Statuses NEVER show in UI
 * directly — pipe through humanStatus() from src/lib/hours-labels.ts.
 *
 * Rules:
 *   - row created by workers/complete-placements.ts (NOT inline at submit)
 *   - chef can edit while status='draft' or 'client_rejected'
 *   - klant can sign/reject only while status='submitted' (no time editing)
 *   - admin can approve only while status='client_signed'
 *   - after 'admin_approved' or 'exported' the row is READ-ONLY — corrections
 *     create a new shift_hour_corrections row (PR-CHEF-7), never mutate
 * =========================================================================== */

export const shiftHoursStatusEnum = pgEnum("shift_hours_status", [
  "draft",
  "submitted",
  "client_signed",
  "client_rejected",
  "admin_approved",
  "admin_rejected",
  "exported",
  "void",
]);

export const shiftHours = pgTable(
  "shift_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** One row per placement — UNIQUE means double-submit is impossible. */
    placementId: text("placement_id")
      .notNull()
      .unique()
      .references(() => placements.id, { onDelete: "restrict" }),
    /** Denormalized for query speed — joins on chef/client/shift become 1-hop. */
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "restrict" }),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),

    /* ----- the actual numbers ----- */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    breakMinutes: integer("break_minutes").notNull().default(0),
    /** Computed at submit, stored — endedAt - startedAt - breakMinutes. */
    workedMinutes: integer("worked_minutes").notNull(),
    /** Snapshot — chef rate at submit time (may differ from current chef.hourlyRate*). */
    chefRateCents: integer("chef_rate_cents").notNull(),
    clientRateCents: integer("client_rate_cents").notNull(),

    /* ----- notes ----- */
    chefNotes: text("chef_notes"),
    clientNotes: text("client_notes"),
    adminNotes: text("admin_notes"),

    /* ----- state machine ----- */
    status: shiftHoursStatusEnum("status").notNull().default("draft"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    clientSignedAt: timestamp("client_signed_at", { withTimezone: true }),
    clientSignedBy: text("client_signed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    clientRejectedAt: timestamp("client_rejected_at", { withTimezone: true }),
    adminApprovedAt: timestamp("admin_approved_at", { withTimezone: true }),
    adminApprovedBy: text("admin_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    adminRejectedAt: timestamp("admin_rejected_at", { withTimezone: true }),

    /* ----- payroll handoff (Phase 5+) ----- */
    payingitExportedAt: timestamp("payingit_exported_at", { withTimezone: true }),
    payingitExportRef: text("payingit_export_ref"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Admin queue ordered by signed-at. */
    statusIdx: index("shift_hours_status_idx").on(t.status, t.clientSignedAt),
    /** Chef dashboard query. */
    chefIdx: index("shift_hours_chef_idx").on(t.chefId, t.status),
    /** Klant queue query. */
    clientIdx: index("shift_hours_client_idx").on(t.clientId, t.status),
    /** Sanity: end > start, no negative break. */
    endAfterStart: check(
      "shift_hours_end_after_start",
      sql`${t.endedAt} > ${t.startedAt}`,
    ),
    breakNonNegative: check(
      "shift_hours_break_non_negative",
      sql`${t.breakMinutes} >= 0`,
    ),
  }),
);

export type ShiftHours = typeof shiftHours.$inferSelect;
export type NewShiftHours = typeof shiftHours.$inferInsert;

/* =============================================================================
 * Profile change requests (PR-CHEF-4) — chef requests edits to sensitive fields.
 *
 * Chef can edit phone/city/languages/specialties/segments/photo directly.
 * For rate, vakniveau, name, email — they file a request here and Maarten
 * approves. Prevents surprise payroll/margin bugs from chef-edited rates.
 *
 * Status flow: pending → approved | rejected.
 * Approval writes the new value to the chefs table + audit + email + outbox.
 * =========================================================================== */

export const profileChangeStatusEnum = pgEnum("profile_change_status", [
  "pending",
  "approved",
  "rejected",
]);

export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "cascade" }),
    /** Field name on the chefs table, e.g. 'hourlyRateMinCents' */
    field: text("field").notNull(),
    /** Snapshot of current value at request time (jsonb so works for any type). */
    currentValue: jsonb("current_value"),
    /** What the chef proposes. */
    proposedValue: jsonb("proposed_value"),
    /** Free-text justification. */
    reason: text("reason"),
    status: profileChangeStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decisionNotes: text("decision_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chefIdx: index("profile_change_requests_chef_idx").on(t.chefId, t.status),
  }),
);

export type ProfileChangeRequest = typeof profileChangeRequests.$inferSelect;
export type NewProfileChangeRequest = typeof profileChangeRequests.$inferInsert;

/* =============================================================================
 * Client change requests (PR-KLANT-1) — sibling of profile_change_requests.
 *
 * Klant edits contact + shift-location fields directly (instant save). But
 * finance + structural fields (companyName, kvk, btw, paymentTermsDays,
 * billingAddress, auth-email) flow through admin approval so offertes,
 * facturen and afspraken keep matching. One row per requested field change.
 *
 * Intentionally NOT shared with chefs' profile_change_requests — different
 * entity, different field set, different reviewer copy (decision #3).
 * =========================================================================== */

export const clientChangeStatusEnum = pgEnum("client_change_status", [
  "pending",
  "approved",
  "rejected",
]);

export const clientChangeRequests = pgTable(
  "client_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Field name on the clients table (e.g. 'paymentTermsDays', 'companyName'). */
    field: text("field").notNull(),
    /** Snapshot of current value at request time (jsonb so works for any type). */
    currentValue: jsonb("current_value"),
    /** What the klant proposes. */
    proposedValue: jsonb("proposed_value"),
    /** Free-text justification. */
    reason: text("reason"),
    status: clientChangeStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decisionNotes: text("decision_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdx: index("client_change_requests_client_idx").on(
      t.clientId,
      t.status,
    ),
  }),
);

export type ClientChangeRequest = typeof clientChangeRequests.$inferSelect;
export type NewClientChangeRequest = typeof clientChangeRequests.$inferInsert;

/* =============================================================================
 * Client shift change/cancel requests (PR-KLANT-2).
 *
 * After a request is converted into a real shift, the klant is never trapped:
 * they can request a CHANGE (date/time/headcount/role/other) or a CANCEL on
 * ANY shift status. These are REQUESTS — Chef & Serve mediates (chefs are
 * already committed), never an instant mutation.
 *
 * One open request per shift per kind (partial unique index) so a klant
 * can't spam; they wait for admin to resolve before filing another.
 * =========================================================================== */

export const clientShiftChangeKindEnum = pgEnum("client_shift_change_kind", [
  "change",
  "cancel",
]);

export const clientShiftChangeStatusEnum = pgEnum("client_shift_change_status", [
  "pending",
  "in_progress",
  "approved",
  "rejected",
]);

export const clientShiftChangeRequests = pgTable(
  "client_shift_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: clientShiftChangeKindEnum("kind").notNull(),
    reason: text("reason").notNull(),
    /** e.g. { "startsAt": "...", "headcount": 2, "topic": "datetime" } */
    proposedChange: jsonb("proposed_change"),
    status: clientShiftChangeStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decisionNotes: text("decision_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdx: index("client_shift_change_requests_client_idx").on(
      t.clientId,
      t.status,
    ),
    shiftIdx: index("client_shift_change_requests_shift_idx").on(
      t.shiftId,
      t.status,
    ),
    // One OPEN request per shift per kind — prevents duplicate spam.
    openUnique: uniqueIndex("client_shift_change_open_unique")
      .on(t.shiftId, t.kind)
      .where(sql`${t.status} IN ('pending', 'in_progress')`),
  }),
);

export type ClientShiftChangeRequest =
  typeof clientShiftChangeRequests.$inferSelect;
export type NewClientShiftChangeRequest =
  typeof clientShiftChangeRequests.$inferInsert;

/* =============================================================================
 * Recurring shift templates + exceptions (PR-KLANT-4).
 *
 * Admin creates a weekly pattern ("elke vrijdag 17:00 sous-chef"); a daily
 * worker materializes real `shifts` rows over a rolling horizon. Exceptions
 * skip specific dates (Kerst, renovatie). Overnight shifts (17:00–01:00) set
 * ends_next_day so the worker computes endsAt across midnight in
 * Europe/Amsterdam. Generated shifts are INDEPENDENT — editing the template
 * never rewrites shifts already created.
 *
 * day_of_week uses Postgres DOW convention: 0=Sunday … 6=Saturday.
 * =========================================================================== */

export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    roleNeeded: vakniveauEnum("role_needed").notNull(),
    segment: segmentEnum("segment"),
    /** Postgres DOW: 0=Sunday … 6=Saturday. */
    dayOfWeek: integer("day_of_week").notNull(),
    startsAtTime: time("starts_at_time").notNull(),
    endsAtTime: time("ends_at_time").notNull(),
    /** True when the shift ends the next calendar day (e.g. 17:00–01:00). */
    endsNextDay: boolean("ends_next_day").notNull().default(false),
    headcount: integer("headcount").notNull().default(1),
    chefRateCents: integer("chef_rate_cents"),
    clientRateCents: integer("client_rate_cents"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    /** How far ahead the worker materializes shifts (rolling window). */
    generateHorizonDays: integer("generate_horizon_days").notNull().default(28),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dowCheck: check(
      "shift_templates_dow_check",
      sql`${t.dayOfWeek} BETWEEN 0 AND 6`,
    ),
    activeUnique: uniqueIndex("shift_templates_client_dow_role_unique")
      .on(t.clientId, t.dayOfWeek, t.startsAtTime, t.roleNeeded)
      .where(sql`${t.active} = true`),
  }),
);

export const shiftTemplateExceptions = pgTable(
  "shift_template_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => shiftTemplates.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    reason: text("reason"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    templateDateUnique: uniqueIndex("shift_template_exceptions_unique").on(
      t.templateId,
      t.date,
    ),
  }),
);

export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type NewShiftTemplate = typeof shiftTemplates.$inferInsert;
export type ShiftTemplateException = typeof shiftTemplateExceptions.$inferSelect;
export type NewShiftTemplateException =
  typeof shiftTemplateExceptions.$inferInsert;

/* =============================================================================
 * Ratings (PR-KLANT-5) — klant feedback on a completed placement.
 *
 * Stars (1–5) + soft tags (Dutch labels, see src/lib/rating-tags.ts) +
 * optional comment. INTERNAL-ONLY in V1: admin always sees; chef sees their
 * average only at ratingCount>=5; other klanten never see it. One rating per
 * placement (UNIQUE). ON DELETE RESTRICT preserves the signal (chefs/clients
 * soft-delete elsewhere; a rating must not silently vanish).
 *
 * Negative tags are a soft matching hint — they require human review before
 * penalizing a chef (documented in docs/ai/ai-safety-rules.md).
 * =========================================================================== */

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placementId: text("placement_id")
      .notNull()
      .unique()
      .references(() => placements.id, { onDelete: "restrict" }),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    stars: integer("stars").notNull(),
    /** Dutch tag keys from RATING_TAGS (positive + negative). */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    starsCheck: check("ratings_stars_check", sql`${t.stars} BETWEEN 1 AND 5`),
    chefIdx: index("ratings_chef_idx").on(t.chefId, t.createdAt),
  }),
);

export type Rating = typeof ratings.$inferSelect;
export type NewRating = typeof ratings.$inferInsert;

/* =============================================================================
 * Backup runs + restore drills (PR-CHEF-13) — backup ops record-keeping.
 *
 * scripts/backup-neon.sh writes one backup_runs row per backup. Same
 * for scripts/restore-drill.sh and restore_drills.
 *
 * These are intentionally simple tables — no FKs, no enums, just operator
 * truth. Admin /admin/business/integrations reads them for the "last
 * backup" widget.
 * =========================================================================== */

export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** 'ok' | 'failed' */
  status: text("status").notNull(),
  fileSize: integer("file_size"),
  /** sha256 of pre-encryption gzip — for integrity verification */
  checksum: text("checksum"),
  /** sha256 of the encrypted .age file */
  encryptedChecksum: text("encrypted_checksum"),
  /** Absolute path on the Mac Mini, e.g. /Users/jezza/Backups/... */
  location: text("location"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restoreDrills = pgTable("restore_drills", {
  id: uuid("id").primaryKey().defaultRandom(),
  backupRunId: uuid("backup_run_id").references(() => backupRuns.id, {
    onDelete: "set null",
  }),
  restoredAt: timestamp("restored_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** 'local_dev' | 'neon_dev_branch' */
  target: text("target").notNull(),
  rowCountSpotCheck: integer("row_count_spot_check"),
  /** 'ok' | 'failed' | 'data_mismatch' */
  result: text("result").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BackupRun = typeof backupRuns.$inferSelect;
export type NewBackupRun = typeof backupRuns.$inferInsert;
export type RestoreDrill = typeof restoreDrills.$inferSelect;
export type NewRestoreDrill = typeof restoreDrills.$inferInsert;

/* =============================================================================
 * Notification preferences (PR-CHEF-6) — per-user opt-out scaffolding.
 *
 * V1: empty table = all events enabled. shouldSendToUser() defaults true.
 * V2: future /chef/settings + /client/settings will mutate this row.
 *
 * jsonb shape: { [eventKey: string]: boolean } where false = suppress.
 * =========================================================================== */

export const notificationPrefs = pgTable("notification_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  prefs: jsonb("prefs").notNull().default({} as Record<string, boolean>),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NotificationPrefs = typeof notificationPrefs.$inferSelect;
export type NewNotificationPrefs = typeof notificationPrefs.$inferInsert;

/**
 * Per-employee settings hub (Cockpit Instellingen). One row per internal user;
 * `prefs` is a free-form jsonb of sections (e.g. `{ roster: { criticalHours,
 * defaultView, labels } }`). Code defaults apply when a section/key is absent,
 * so "no row" = everyone gets the sensible defaults. Notification toggles stay
 * in `notification_prefs` (the Meldingen section reads/writes that). Keeping this
 * generic means future settings sections need no new migration.
 */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  prefs: jsonb("prefs").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type NewUserSettings = typeof userSettings.$inferInsert;

/* =============================================================================
 * Profile-data requests (Cockpit PR-2.1) — the "vraag ontbrekende gegevens"
 * workflow. When a chef profile is incomplete (no postcode/transport/voorkeuren),
 * an admin one-click sends a form/request and the cockpit tracks it: who got
 * which form, which fields, sent vs completed vs no-reply. Text columns (not
 * enums) mirror contact_logs' flexible style.
 * =========================================================================== */

export const profileDataRequests = pgTable(
  "profile_data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "cascade" }),
    /** 'profile_update' | 'availability' | 'documents' */
    requestType: text("request_type").notNull().default("profile_update"),
    /** Which fields we asked for (postcode, transport, preferences, …). */
    requestedFields: text("requested_fields").array(),
    /** 'email' | 'whatsapp' | 'phone' */
    channel: text("channel").notNull().default("email"),
    /** 'draft' | 'sent' | 'completed' | 'expired' | 'failed' */
    status: text("status").notNull().default("draft"),
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    messageTemplateKey: text("message_template_key"),
    /** Jotform submission that completed this request (matched by email). */
    jotformSubmissionId: text("jotform_submission_id"),
    contactLogId: uuid("contact_log_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chefIdx: index("profile_data_requests_chef_idx").on(t.chefId, t.status),
  }),
);

export type ProfileDataRequest = typeof profileDataRequests.$inferSelect;
export type NewProfileDataRequest = typeof profileDataRequests.$inferInsert;

/* =============================================================================
 * AVG / GDPR (PR-CHEF-10) — consent_log + privacy_requests + DPA + retention.
 *
 * Plain-Dutch UX in front, full audit trail in back. Consent is append-only.
 * Privacy requests have a 30d AVG max response time auto-set. DPA files
 * live in R2. retention_policies map entity types to bewaartermijn intervals.
 * =========================================================================== */

export const privacyRequestTypeEnum = pgEnum("privacy_request_type", [
  "access",
  "correction",
  "deletion",
  "export",
  // PR-AVG-1: catch-all so real-world rights (restriction art.18, objection
  // art.21, anything else) have an intake path; handled manually via notes.
  "other",
]);

export const privacyRequestStatusEnum = pgEnum("privacy_request_status", [
  "pending",
  "in_progress",
  "fulfilled",
  "rejected",
  "partially_fulfilled",
  "withdrawn", // PR-AVG-1: requester cancelled the request
]);

/* ----- PR-AVG-1: privacy-request operations enums ------------------- */
export const privacyRequesterKindEnum = pgEnum("privacy_requester_kind", [
  "chef",
  "klant",
  "unknown",
  "external",
]);

export const privacyChannelEnum = pgEnum("privacy_channel", [
  "portal",
  "email",
  "phone",
  "whatsapp",
  "letter",
]);

export const privacyIdentityStatusEnum = pgEnum("privacy_identity_status", [
  "not_started",
  "requested",
  "verified",
  "failed",
]);

export const privacyMessageDirectionEnum = pgEnum("privacy_message_direction", [
  "inbound",
  "outbound",
  "internal_note",
]);

export const consentLog = pgTable(
  "consent_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Stable key, e.g. 'gegevensgebruik_chef_v1'. */
    documentKey: text("document_key").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => ({
    userIdx: index("consent_log_user_idx").on(t.userId, t.documentKey),
  }),
);

export const privacyRequests = pgTable("privacy_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * PR-AVG-1: nullable — off-portal intake (email/phone/letter) can come from
   * a person without (or with a soft-deleted) account. onDelete=set null so an
   * erasure of the user never cascades away the compliance record of the
   * request itself.
   */
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  type: privacyRequestTypeEnum("type").notNull(),
  status: privacyRequestStatusEnum("status").notNull().default("pending"),
  reason: text("reason"),
  /** 30 days from creation (AVG art. 12(3) max — moved only via extension). */
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),

  /* ----- PR-AVG-1: intake (real-world, off-portal) ----- */
  requesterKind: privacyRequesterKindEnum("requester_kind"),
  requesterName: text("requester_name"),
  requesterEmail: text("requester_email"),
  requesterPhone: text("requester_phone"),
  originalChannel: privacyChannelEnum("original_channel").notNull().default("portal"),
  rawRequestText: text("raw_request_text"),

  /* ----- PR-AVG-1: identity verification (evidence, not a checkbox) ----- */
  identityStatus: privacyIdentityStatusEnum("identity_status")
    .notNull()
    .default("not_started"),
  identityMethod: text("identity_method"),
  identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
  identityVerifiedBy: text("identity_verified_by").references(() => users.id, {
    onDelete: "set null",
  }),
  identityNotes: text("identity_notes"),

  /* ----- PR-AVG-1: SLA extension (art. 12(3) — never silent) ----- */
  slaExtendedAt: timestamp("sla_extended_at", { withTimezone: true }),
  slaExtendedBy: text("sla_extended_by").references(() => users.id, {
    onDelete: "set null",
  }),
  slaExtensionReason: text("sla_extension_reason"),
  slaExtensionNotifiedAt: timestamp("sla_extension_notified_at", {
    withTimezone: true,
  }),

  /* ----- PR-AVG-2: correction (art. 16) ----- */
  correctionScope: jsonb("correction_scope"),
  correctionAppliedAt: timestamp("correction_applied_at", {
    withTimezone: true,
  }),
  correctionAppliedBy: text("correction_applied_by").references(
    () => users.id,
    { onDelete: "set null" },
  ),

  handledBy: text("handled_by").references(() => users.id, {
    onDelete: "set null",
  }),
  responseFileUrl: text("response_file_url"),
  /** R2 key of the export package (presigned on demand — never a public URL). */
  responseFileKey: text("response_file_key"),
  decisionNotes: text("decision_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * PR-AVG-1: correspondence log for a privacy request — proof of communication
 * (identity follow-up, extension notice, requester clarification, internal notes).
 */
export const privacyRequestMessages = pgTable(
  "privacy_request_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    privacyRequestId: uuid("privacy_request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "cascade" }),
    direction: privacyMessageDirectionEnum("direction").notNull(),
    channel: privacyChannelEnum("channel").notNull(),
    body: text("body").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    requestIdx: index("privacy_request_messages_request_idx").on(
      t.privacyRequestId,
      t.createdAt,
    ),
  }),
);

/**
 * PR-AVG-2: erasure tombstones — a non-reversible marker of every erased data
 * subject. Three jobs:
 *   1. PROVE the erasure happened (accountability — art. 5(2)) without keeping
 *      the erased PII. We store an HMAC of the email, never the email itself.
 *   2. PREVENT silent re-import — if the same person re-submits via Jotform, a
 *      lookup on hashedEmail flags "this subject was erased; reconfirm intent".
 *   3. SURVIVE backup restore — `scripts/replay-erasure-tombstones.mjs` re-applies
 *      every tombstone after a restore so old PII does not resurrect (art. 17 +
 *      `docs/privacy/backup-erasure-policy.md`).
 *
 * Deliberately holds NO recoverable PII: only opaque ids + a one-way email hash
 * + a jsonb summary of what was retained under legal hold and why.
 */
export const privacyErasureTombstones = pgTable(
  "privacy_erasure_tombstones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The request that authorised this erasure (kept for the compliance trail). */
    privacyRequestId: uuid("privacy_request_id").references(
      () => privacyRequests.id,
      { onDelete: "set null" },
    ),
    /** Opaque ids of the erased subject. No FK — must survive the row's anonymisation/removal. */
    originalUserId: text("original_user_id"),
    originalChefId: text("original_chef_id"),
    originalClientId: text("original_client_id"),
    /** HMAC-SHA256 of the lower-cased email (RATE_LIMIT_HASH_SECRET). One-way. */
    hashedEmail: text("hashed_email"),
    requesterKind: privacyRequesterKindEnum("requester_kind"),
    erasedAt: timestamp("erased_at", { withTimezone: true }).notNull().defaultNow(),
    erasedBy: text("erased_by").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    /** What we kept + why (legal-hold scope) — proof of partial fulfilment. */
    retainedEntitiesSummary: jsonb("retained_entities_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    hashedEmailIdx: index("privacy_erasure_tombstones_hashed_email_idx").on(
      t.hashedEmail,
    ),
    userIdx: index("privacy_erasure_tombstones_user_idx").on(t.originalUserId),
  }),
);

export const dataProcessingAgreements = pgTable("data_processing_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acceptedBy: text("accepted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  fileUrl: text("file_url"),
  fileChecksum: text("file_checksum"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const retentionPolicies = pgTable("retention_policies", {
  entityType: text("entity_type").primaryKey(),
  /** Postgres interval string, e.g. '7 years'. */
  retentionPeriod: text("retention_period").notNull(),
  legalBasis: text("legal_basis").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ConsentLog = typeof consentLog.$inferSelect;
export type NewConsentLog = typeof consentLog.$inferInsert;
export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export type NewPrivacyRequest = typeof privacyRequests.$inferInsert;
export type PrivacyRequestMessage = typeof privacyRequestMessages.$inferSelect;
export type NewPrivacyRequestMessage =
  typeof privacyRequestMessages.$inferInsert;
export type PrivacyErasureTombstone =
  typeof privacyErasureTombstones.$inferSelect;
export type NewPrivacyErasureTombstone =
  typeof privacyErasureTombstones.$inferInsert;
export type DPA = typeof dataProcessingAgreements.$inferSelect;
export type NewDPA = typeof dataProcessingAgreements.$inferInsert;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type NewRetentionPolicy = typeof retentionPolicies.$inferInsert;

/* =============================================================================
 * Payroll batches + corrections (PR-CHEF-7) — admin-approved hours become
 * payroll-exportable batches. Once 'exported' the underlying shift_hours
 * row is READ-ONLY — corrections create a shift_hour_corrections row.
 *
 * Rule: approved hours are not the same as exported payroll. A batch is
 * a deliberate admin action ("klaarzetten voor uitbetaling") that groups
 * approved rows for a period.
 * =========================================================================== */

export const payrollBatchStatusEnum = pgEnum("payroll_batch_status", [
  "draft",
  "exported",
  "partially_failed",
  "corrected",
  "void",
]);

export const payrollBatches = pgTable("payroll_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodStart: timestamp("period_start", { withTimezone: false, mode: "date" }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: false, mode: "date" }).notNull(),
  provider: text("provider").notNull().default("csv"),
  status: payrollBatchStatusEnum("status").notNull().default("draft"),
  fileUrl: text("file_url"),
  fileChecksum: text("file_checksum"),
  rowCount: integer("row_count"),
  totalChefCostCents: integer("total_chef_cost_cents"),
  totalClientRevenueCents: integer("total_client_revenue_cents"),
  totalMarginCents: integer("total_margin_cents"),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  exportedBy: text("exported_by").references(() => users.id, {
    onDelete: "set null",
  }),
  externalRef: text("external_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const payrollBatchLines = pgTable("payroll_batch_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => payrollBatches.id, { onDelete: "cascade" }),
  shiftHoursId: uuid("shift_hours_id")
    .notNull()
    .references(() => shiftHours.id, { onDelete: "restrict" }),
  amountCents: integer("amount_cents").notNull(),
  clientAmountCents: integer("client_amount_cents").notNull(),
  /** 'pending' | 'exported' | 'rejected' */
  status: text("status").notNull().default("pending"),
  externalRef: text("external_ref"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const shiftHourCorrections = pgTable("shift_hour_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalShiftHoursId: uuid("original_shift_hours_id")
    .notNull()
    .references(() => shiftHours.id, { onDelete: "restrict" }),
  /** 'time_change' | 'break_change' | 'rate_change' | 'void' | 'manual_adjustment' */
  correctionType: text("correction_type").notNull(),
  reason: text("reason").notNull(),
  deltaWorkedMinutes: integer("delta_worked_minutes"),
  deltaChefAmountCents: integer("delta_chef_amount_cents"),
  deltaClientAmountCents: integer("delta_client_amount_cents"),
  /** 'pending' | 'approved' | 'exported' | 'rejected' */
  status: text("status").notNull().default("pending"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "set null" }),
  approvedBy: text("approved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* =============================================================================
 * Invoicing (facturatie) — PR-INVOICE-A. The klant-billing side of the hours
 * chain (payroll = the chef-payout side, already shipped in PR-CHEF-7). The
 * approval email already promises "de factuur volgt"; this produces + tracks it.
 * An invoice is a SELF-CONTAINED financial record: billing details are snapshot
 * at issue time (never re-derived), and each line links to the admin_approved
 * shift_hours that justify its amount. Cents; lines are ex-BTW, BTW on the invoice.
 * =========================================================================== */
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft", // generated, not yet sent
  "sent", // emailed to the klant
  "paid", // marked paid
  "void", // cancelled before payment
  "credit", // credit note (negative) for a cross-period correction
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Sequential human number, e.g. "2026-0001". */
    number: text("number").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }), // never orphan a financial record
    status: invoiceStatusEnum("status").notNull().default("draft"),

    /* ----- billing snapshot (immutable once issued) ----- */
    billToName: text("bill_to_name").notNull(),
    billToEmail: text("bill_to_email"),
    billToAddress: text("bill_to_address"),
    billToKvk: text("bill_to_kvk"),
    billToBtw: text("bill_to_btw"),

    /* ----- period + dates ----- */
    periodStart: timestamp("period_start", { withTimezone: false, mode: "date" }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: false, mode: "date" }).notNull(),
    issueDate: timestamp("issue_date", { withTimezone: false, mode: "date" }).notNull(),
    dueDate: timestamp("due_date", { withTimezone: false, mode: "date" }).notNull(),

    /* ----- money (cents) ----- */
    subtotalCents: integer("subtotal_cents").notNull().default(0), // ex BTW
    vatRateBps: integer("vat_rate_bps").notNull().default(2100), // 21% in basis points
    vatCents: integer("vat_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0), // incl BTW

    /* ----- lifecycle ----- */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    pdfR2Key: text("pdf_r2_key"),
    externalRef: text("external_ref"), // accounting-system id
    notes: text("notes"),

    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * One LIVE invoice per (client, period) — generation is idempotent. Partial
     * so a voided invoice frees its period to be re-billed on a corrected one.
     */
    clientPeriodUnique: uniqueIndex("invoices_client_period_unique")
      .on(t.clientId, t.periodStart, t.periodEnd)
      .where(sql`${t.status} <> 'void'`),
    statusIdx: index("invoices_status_idx").on(t.status),
  }),
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  /** The approved hours this line bills (set null if the hours row is ever purged). */
  shiftHoursId: uuid("shift_hours_id").references(() => shiftHours.id, {
    onDelete: "set null",
  }),
  description: text("description").notNull(),
  chefName: text("chef_name"),
  shiftDate: timestamp("shift_date", { withTimezone: false, mode: "date" }),
  workedMinutes: integer("worked_minutes"),
  rateCents: integer("rate_cents"), // client rate per hour
  amountCents: integer("amount_cents").notNull(), // line total, ex BTW
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PayrollBatch = typeof payrollBatches.$inferSelect;
export type NewPayrollBatch = typeof payrollBatches.$inferInsert;
export type PayrollBatchLine = typeof payrollBatchLines.$inferSelect;
export type NewPayrollBatchLine = typeof payrollBatchLines.$inferInsert;
export type ShiftHourCorrection = typeof shiftHourCorrections.$inferSelect;
export type NewShiftHourCorrection = typeof shiftHourCorrections.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;

/* =============================================================================
 * Klant workflow foundations (PR-KLANT-0) — the keystone before klant features.
 *
 * 1. placement_comments — structured multi-actor comments with per-row
 *    visibility. REPLACES appending klant feedback to placements.notes.
 *    The notes blob mixes admin/matching/klant/chef scopes and is a privacy
 *    leak. Comments here are visibility-scoped + length-capped + plain-text.
 *
 * 2. client_contacts — email-routing seam. V1 has no UI (one klant user gets
 *    all mail via recipientsForClient()); V2 resolves by role. Schema exists
 *    now so V2 doesn't require a migration mid-flight.
 *
 * See plan ~/.claude/plans/goofy-moseying-truffle.md PR-KLANT-0.
 * =========================================================================== */

export const commentVisibilityEnum = pgEnum("comment_visibility", [
  "internal", // admin-only — Maarten's private + matching notes
  "client_visible", // klant of this shift can see
  "chef_visible", // chef of this placement can see
]);

export const commentAuthorKindEnum = pgEnum("comment_author_kind", [
  "client",
  "admin",
  "chef",
  "system",
]);

export const placementComments = pgTable(
  "placement_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placementId: text("placement_id")
      .notNull()
      .references(() => placements.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    authorKind: commentAuthorKindEnum("author_kind").notNull(),
    visibility: commentVisibilityEnum("visibility").notNull(),
    /** Plain text only. Renderers MUST NOT use dangerouslySetInnerHTML. */
    body: text("body").notNull(),
    /** Future AI: summaries, sentiment, source, email/thread ids. */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    placementIdx: index("placement_comments_placement_idx").on(
      t.placementId,
      t.createdAt,
    ),
    visibilityIdx: index("placement_comments_visibility_idx").on(
      t.placementId,
      t.visibility,
    ),
    // 1..1000 chars — a bad client can't write a megabyte (correction r3 #5).
    bodyLen: check(
      "placement_comments_body_len",
      sql`char_length(${t.body}) BETWEEN 1 AND 1000`,
    ),
  }),
);

export const clientContactRoleEnum = pgEnum("client_contact_role", [
  "planning",
  "onsite",
  "finance",
  "hours_approval",
  "emergency",
]);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: clientContactRoleEnum("role").notNull(),
    receivesNotifications: boolean("receives_notifications")
      .notNull()
      .default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clientIdx: index("client_contacts_client_idx").on(t.clientId, t.role),
  }),
);

export type PlacementComment = typeof placementComments.$inferSelect;
export type NewPlacementComment = typeof placementComments.$inferInsert;
export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;

/* ============================================================================
 * chef_events — PR-CHEF-5. Structured activity signals for Maarten + AI.
 * Written behind the scenes from normal chef actions (NO chef-facing UI).
 * Surfaced later as gentle nudges + admin/AI analytics.
 * ==========================================================================*/
export const chefEventTypeEnum = pgEnum("chef_event_type", [
  "proposal_accepted",
  "proposal_rejected",
  "hours_submitted",
  "hours_rejected",
  "availability_updated",
  "shift_cancelled_by_chef",
]);

export const chefEvents = pgTable(
  "chef_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "cascade" }),
    eventType: chefEventTypeEnum("event_type").notNull(),
    /** What the event is about (placement / shift_hours / shift / availability). */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** Derived signals (nullable — only set when meaningful for that event). */
    responseSeconds: integer("response_seconds"),
    delayFromShiftEndMin: integer("delay_from_shift_end_min"),
    workedVsScheduledMin: integer("worked_vs_scheduled_min"),
    /** Free-form structured context for analytics / AI. */
    payload: jsonb("payload"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    chefIdx: index("chef_events_chef_idx").on(t.chefId, t.occurredAt),
    typeIdx: index("chef_events_type_idx").on(t.eventType, t.occurredAt),
  }),
);

export type ChefEvent = typeof chefEvents.$inferSelect;
export type NewChefEvent = typeof chefEvents.$inferInsert;

/**
 * chef_metrics_daily / client_metrics_daily — KPI-1. Per-day ACTIVITY snapshots
 * (one row per entity per day) written by workers/metrics-snapshot.ts. Every column
 * is a composable additive measure keyed by the fact's OWN natural date — hours/money
 * by shift_hours.admin_approved_at, completed shifts by shift end, ratings by
 * created_at, reliability by chef_events.occurred_at — so any period = SUM over a
 * date range and any average = Σsum/Σcount. No fabricated scores. Honesty rules
 * mirror chef-history.ts: money + hours come from FINAL shift_hours only
 * (admin_approved / exported). FK ON DELETE CASCADE so AVG erasure of a chef/client
 * drops their derived metrics automatically.
 */
export const chefMetricsDaily = pgTable(
  "chef_metrics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chefId: text("chef_id")
      .notNull()
      .references(() => chefs.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    // hours + money — FINAL shift_hours only, keyed by admin_approved_at date.
    hoursWorkedMinutes: integer("hours_worked_minutes").notNull().default(0),
    payCents: integer("pay_cents").notNull().default(0),
    revenueCents: integer("revenue_cents").notNull().default(0),
    marginCents: integer("margin_cents").notNull().default(0),
    // shifts completed, keyed by shift end date.
    completedShifts: integer("completed_shifts").notNull().default(0),
    // ratings received that day (windowed avg = Σsum / Σcount).
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    // reliability — chef_events that day.
    proposalsAccepted: integer("proposals_accepted").notNull().default(0),
    proposalsRejected: integer("proposals_rejected").notNull().default(0),
    cancellations: integer("cancellations").notNull().default(0),
    hoursSubmitted: integer("hours_submitted").notNull().default(0),
    responseSecondsSum: integer("response_seconds_sum").notNull().default(0),
    responseSecondsCount: integer("response_seconds_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chefDateIdx: uniqueIndex("chef_metrics_daily_chef_date_idx").on(t.chefId, t.snapshotDate),
    dateIdx: index("chef_metrics_daily_date_idx").on(t.snapshotDate),
  }),
);
export type ChefMetricsDaily = typeof chefMetricsDaily.$inferSelect;
export type NewChefMetricsDaily = typeof chefMetricsDaily.$inferInsert;

export const clientMetricsDaily = pgTable(
  "client_metrics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    // demand + fill — shifts STARTING that day.
    shiftsCount: integer("shifts_count").notNull().default(0),
    slotsCount: integer("slots_count").notNull().default(0),
    filledSlots: integer("filled_slots").notNull().default(0),
    // money — FINAL shift_hours for this client, keyed by admin_approved_at date.
    spendCents: integer("spend_cents").notNull().default(0), // client billed (client_rate_cents)
    chefPayCents: integer("chef_pay_cents").notNull().default(0), // agency cost (chef_rate_cents)
    marginCents: integer("margin_cents").notNull().default(0),
    // ratings the client GAVE that day.
    ratingSum: integer("rating_sum").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    // hours-approval SLA — hours finalized that day (admin_approved_at − client_signed_at).
    approvalSlaMinutesSum: integer("approval_sla_minutes_sum").notNull().default(0),
    approvalSlaCount: integer("approval_sla_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientDateIdx: uniqueIndex("client_metrics_daily_client_date_idx").on(t.clientId, t.snapshotDate),
    dateIdx: index("client_metrics_daily_date_idx").on(t.snapshotDate),
  }),
);
export type ClientMetricsDaily = typeof clientMetricsDaily.$inferSelect;
export type NewClientMetricsDaily = typeof clientMetricsDaily.$inferInsert;
