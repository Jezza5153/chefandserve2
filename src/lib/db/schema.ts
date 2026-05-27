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

  /* ----- money ----- */
  /** Client-billed rate per chef in cents. */
  clientRateCents: integer("client_rate_cents"),
  /** Default chef-paid rate (placements can override). */
  chefRateCents: integer("chef_rate_cents"),

  /* ----- lifecycle ----- */
  status: shiftStatusEnum("status").notNull().default("request"),
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
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelledReason: text("cancelled_reason"),
});

/**
 * Chef documents — metadata only. Bytes live in Cloudflare R2.
 *
 * Bytes path in R2: `chefs/<chefId>/<docId>/<filename>`
 * Public access: NONE. Files retrieved via short-lived presigned URLs
 * generated server-side by getDownloadUrl(documentId).
 */
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Soft-delete — preserve audit trail. R2 object purge happens via cleanup worker. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

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
