/**
 * Drizzle ORM Schema — Full multi-tenant PostgreSQL schema
 *
 * Mirrors the existing SQL schema (migrations 001–028) with type-safe
 * Drizzle definitions. Supports:
 *   • Organization-based row-level isolation (not schema-per-tenant)
 *   • RBAC: superAdmin, owner, admin, member
 *   • Plan tiers: user, hobby, pro, premium, enterprise
 *   • Better Auth integration for authentication & org management
 */

import { relations } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Helper types ──────────────────────────────────────────────────────────────

/** Platform-level role. "admin" no longer exists: org ownership is tracked via memberships. */
export type UserRole = "superAdmin" | "user";
export type MemberRole = "owner" | "admin" | "member";
/** Platform subscription plan tier assigned to users. */
export type Plan = "user" | "hobby" | "pro" | "premium" | "enterprise";
/** @deprecated Use Plan */
export type OrgPlan = Plan;
export type OrgStatus = "active" | "suspended" | "archived";
export type InvitationStatus = "pending" | "accepted" | "rejected" | "expired";
export type ConnectionStatus = "connected" | "disconnected" | "error";
export type CommandStatus = "pending" | "dispatched" | "delivered" | "acked" | "failed" | "expired";
/** Visibility scope for applications and devices */
export type Visibility = "team" | "org" | "public";

// ─── Plan limits ───────────────────────────────────────────────────────────────

export const PLAN_LIMITS: Record<Plan, { organizationLimit: number; membershipLimit: number }> = {
  user: { organizationLimit: 0, membershipLimit: -1 }, // base tier: cannot create orgs
  hobby: { organizationLimit: 1, membershipLimit: 5 },
  pro: { organizationLimit: 3, membershipLimit: 25 },
  premium: { organizationLimit: 10, membershipLimit: 100 },
  enterprise: { organizationLimit: -1, membershipLimit: -1 }, // unlimited
};

// ============================================================================
// USERS
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    firstName: varchar("first_name", { length: 255 }),
    lastName: varchar("last_name", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    avatarUrl: text("avatar_url"),
    /** Platform-level role: only superAdmin can bypass org checks */
    role: varchar("role", { length: 20 }).$type<UserRole>().default("user").notNull(),
    /** Platform-level subscription plan */
    plan: varchar("plan", { length: 50 }).$type<Plan>().default("user").notNull(),
    emailVerified: boolean("email_verified").default(false),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_users_email").on(t.email),
    index("idx_users_is_active").on(t.isActive),
  ],
);

// ============================================================================
// ORGANIZATIONS
// ============================================================================

export const organizations = pgTable(
  "organizations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    description: text("description"),
    /** Owner user ID — the user who created this org */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).$type<OrgStatus>().default("active"),
    timezone: varchar("timezone", { length: 100 }).default("UTC"),
    isPublic: boolean("is_public").default(false),
    /** Enterprise-tier fields used for downgrade protection */
    domain: varchar("domain", { length: 255 }),
    logoUrl: text("logo_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_organizations_slug").on(t.slug),
    index("idx_organizations_status").on(t.status),
  ],
);

// ============================================================================
// ROLES
// ============================================================================

export const roles = pgTable(
  "user_roles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    scope: varchar("scope", { length: 50 }).notNull(), // 'organization' | 'team'
    description: text("description"),
    permissions: jsonb("permissions").notNull().$type<Record<string, boolean>>(),
    isSystemRole: boolean("is_system_role").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_user_roles_name").on(t.name),
    index("idx_user_roles_scope").on(t.scope),
  ],
);

// ============================================================================
// MEMBERSHIPS (organization_members)
// ============================================================================

export const memberships = pgTable(
  "organization_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    /** Invited users start unapproved; hooks or admin approval sets to true */
    isApproved: boolean("is_approved").default(false),
    invitationStatus: varchar("invitation_status", { length: 20 })
      .$type<InvitationStatus>()
      .default("pending"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at").defaultNow(),
    joinedAt: timestamp("joined_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_user_org").on(t.userId, t.orgId),
    index("idx_organization_members_user").on(t.userId),
    index("idx_organization_members_org").on(t.orgId),
    index("idx_organization_members_role").on(t.roleId),
    index("idx_organization_members_status").on(t.invitationStatus),
  ],
);

// ============================================================================
// TEAMS
// ============================================================================

export const teams = pgTable(
  "teams",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).default("active"),
    teamType: varchar("team_type", { length: 50 }).default("department"),
    // parent_team_id removed in migration 034 — use Applications instead of subteams
    isPublic: boolean("is_public").default(false),
    /** Integration profile assigned to this team. Every device in the team
     *  inherits the profile's input + output services for routing. */
    integrationProfileId: bigint("integration_profile_id", { mode: "number" }).references(
      () => integrationProfiles.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_org_team_slug").on(t.organizationId, t.slug),
    index("idx_teams_org").on(t.organizationId),
    index("idx_teams_slug").on(t.slug),
    index("idx_teams_profile").on(t.integrationProfileId),
  ],
);

// ============================================================================
// TEAM MEMBERS
// ============================================================================

export const teamMembers = pgTable(
  "team_members",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    roleId: bigint("role_id", { mode: "number" })
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    invitationStatus: varchar("invitation_status", { length: 20 })
      .$type<InvitationStatus>()
      .default("accepted"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at").defaultNow(),
    joinedAt: timestamp("joined_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_user_team").on(t.userId, t.teamId),
    index("idx_team_members_user").on(t.userId),
    index("idx_team_members_team").on(t.teamId),
    index("idx_team_members_role").on(t.roleId),
    index("idx_team_members_status").on(t.invitationStatus),
  ],
);

// ============================================================================
// PLAN CONFIGURATIONS (superAdmin-editable limits per plan tier)
// ============================================================================

export const planConfigurations = pgTable("user_plans_config", {
  plan: varchar("plan", { length: 50 }).primaryKey().$type<Plan>(),
  /** Max orgs a user on this plan can own. -1 = unlimited, 0 = none */
  maxOrgs: integer("max_orgs").notNull().default(-1),
  /** Max top-level teams per org. -1 = unlimited */
  maxTeamsPerOrg: integer("max_teams_per_org").notNull().default(-1),
  /** Max applications per team. -1 = unlimited, 0 = none */
  maxAppsPerTeam: integer("max_apps_per_team").notNull().default(-1),
  /** Max devices that can be assigned to each application. -1 = unlimited */
  maxDevicesPerTeam: integer("max_devices_per_team").notNull().default(-1),
  /** Max members per org. -1 = unlimited, 0 = none */
  maxMembersPerOrg: integer("max_members_per_org").notNull().default(-1),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

// ============================================================================
// APPLICATIONS (team-scoped, replace subteams)
// ============================================================================

// ============================================================================
// INTEGRATION_PROFILES  (reusable input+output routing bundles per org)
// ============================================================================
// An integration profile bundles the set of input and output services that apply
// to every device in an application.  Profile → application is the ONLY routing
// layer — no per-device overrides, no service-level fallbacks.

export const integrationProfiles = pgTable(
  "integration_profiles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: bigint("org_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    isGlobal: boolean("is_global").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_integration_profile_org_name").on(t.orgId, t.name),
    index("idx_integration_profiles_org").on(t.orgId),
  ],
);

// ============================================================================
// INTEGRATION_PROFILE_SERVICES  (profile ↔ services M2M)
// ============================================================================
// role: 'input' | 'output'
// topic_template: optional {device_key} template; NULL = use service default

export const integrationProfileServices = pgTable(
  "integration_profile_services",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    profileId: bigint("profile_id", { mode: "number" })
      .notNull()
      .references(() => integrationProfiles.id, { onDelete: "cascade" }),
    serviceId: bigint("service_id", { mode: "number" })
      .notNull()
      .references(() => serviceRegistry.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 10 })
      .$type<"input" | "output">()
      .notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    topicTemplate: varchar("topic_template", { length: 1024 }),
  },
  (t) => [
    unique("uq_profile_service_role").on(t.profileId, t.serviceId, t.role),
    index("idx_ips_profile").on(t.profileId),
    index("idx_ips_service").on(t.serviceId),
    index("idx_ips_role").on(t.role),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    /** Visibility scope: 'team' = team-private, 'org' = all org members, 'public' = all authenticated users */
    visibility: varchar("visibility", { length: 20 }).$type<Visibility>().notNull().default("team"),
    /** Number of last sensor values to cache per sensor type (Redis cache size) */
    redisCacheSize: integer("redis_cache_size").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_team_app_slug").on(t.teamId, t.slug),
    index("idx_applications_team").on(t.teamId),
    index("idx_applications_status").on(t.status),
  ],
);

// ============================================================================
// APPLICATION SENSOR VALUES (last N cached values per sensor type per app)
// ============================================================================

export const applicationSensorValues = pgTable(
  "application_sensor_values",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    sensorType: varchar("sensor_type", { length: 100 }).notNull(),
    sensorValue: jsonb("sensor_value"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_asv_app_sensor").on(t.applicationId, t.sensorType),
    index("idx_asv_recorded_at").on(t.applicationId, t.sensorType, t.recordedAt),
  ],
);

// ============================================================================
// APPLICATION_DEVICES (device assignment to applications)
// ============================================================================

export const applicationDevices = pgTable(
  "application_devices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => deviceRegistry.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // uq_app_device intentionally removed — a device may belong to many applications
    index("idx_app_devices_app").on(t.applicationId),
    index("idx_app_devices_device").on(t.deviceId),
  ],
);

// ============================================================================
// APPLICATION SENSOR TYPES (sensor type subscriptions per application)
// ============================================================================

export const applicationSensorTypes = pgTable(
  "application_sensor_types",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    sensorType: varchar("sensor_type", { length: 100 }).notNull(),
    /** Visibility scope for this sensor type:
     *  'team'   = only visible within the owning team (default)
     *  'org'    = visible to all teams in the same organisation
     *  'public' = visible to all authenticated users across all orgs
     */
    visibility: varchar("visibility", { length: 20 })
      .$type<Visibility>()
      .notNull()
      .default("team"),
    /** Shorthand flag — true when visibility = 'public'. */
    isPublic: boolean("is_public").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_app_sensor_type").on(t.applicationId, t.sensorType),
    index("idx_app_sensor_types_app").on(t.applicationId),
    index("idx_app_sensor_types_sensor").on(t.sensorType),
    index("idx_app_sensor_types_visibility").on(t.visibility),
    index("idx_app_sensor_types_public").on(t.isPublic),
  ],
);

// ============================================================================
// APPLICATION NATS CREDENTIALS (per-app NKey + signed JWT for JetStream access)
// ============================================================================

export const applicationNatsCredentials = pgTable(
  "application_nats_credentials",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => applications.id, { onDelete: "cascade" }),
    /** NKey public key in base32 NKEY format (starts with 'U') */
    nkeyPublic: varchar("nkey_public", { length: 65 }).notNull(),
    /** NKey seed in base32 NKEY format (starts with 'SU') — keep secret */
    nkeySeed: text("nkey_seed").notNull(),
    /** Signed NATS user JWT (header.payload.signature) */
    natsJwt: text("nats_jwt").notNull(),
    /** Full .creds file content for direct use with the NATS client */
    creds: text("creds").notNull(),
    /** Allowed subscribe subject patterns */
    subPermissions: jsonb("sub_permissions").notNull().$type<string[]>().default([]),
    /** Allowed publish subject patterns */
    pubPermissions: jsonb("pub_permissions").notNull().$type<string[]>().default([]),
    /** Optional JWT expiry (null = no expiry) */
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_app_nats_creds_app").on(t.applicationId),
  ],
);

// ============================================================================
// DEVICE VENDORS & MODELS
// ============================================================================

export const deviceVendors = pgTable("device_vendors", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const deviceModels = pgTable(
  "device_models",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    vendorId: bigint("vendor_id", { mode: "number" })
      .notNull()
      .references(() => deviceVendors.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 100 }).notNull(),
    description: text("description"),
    deviceType: varchar("device_type", { length: 50 }).notNull().default("other"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    unique("uq_vendor_model_code").on(t.vendorId, t.code),
    index("idx_device_models_vendor").on(t.vendorId),
  ],
);

// ============================================================================
// DEVICE SENSORS (sensor types per device model)
// ============================================================================

export const deviceSensors = pgTable(
  "device_sensors",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceModelId: bigint("device_model_id", { mode: "number" })
      .notNull()
      .references(() => deviceModels.id, { onDelete: "cascade" }),
    sensorType: varchar("sensor_type", { length: 100 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    description: text("description"),
    /** Value type for InfluxDB storage: int | float | bool | string */
    valueType: varchar("value_type", { length: 10 }).notNull().default("float"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_device_model_sensor").on(t.deviceModelId, t.sensorType),
    index("idx_device_sensors_model").on(t.deviceModelId),
    index("idx_device_sensors_type").on(t.sensorType),
  ],
);

// ============================================================================
// SERVICE LAYER — providers, registry, per-service config tables
// ============================================================================

export type ServiceType =
  | "input.mqtt"
  | "input.grpc-server"
  | "input.grpc-pull"
  | "input.http-server"
  | "input.http-pull"
  | "input.influxdb3"
  | "output.mqtt"
  | "output.grpc-push"
  | "output.http-push"
  | "output.influxdb3"
  | "output.clickhouse";

export const serviceProvider = pgTable("service_providers", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  description: text("description"),
  isBuiltin: boolean("is_builtin").default(true),
  /** True for LoRaWAN Network Server providers (merged from former lns_provider table) */
  isLns: boolean("is_lns").notNull().default(false),
  /** Default MQTT subscribe topics for this provider (e.g. ChirpStack, TTN). Loaded by Go services to avoid hardcoded switch statements. */
  defaultSubscribeTopics: jsonb("default_subscribe_topics").notNull().default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const serviceRegistry = pgTable(
  "services",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /** Service type determines both the protocol and direction.
     *  Input:  input.mqtt | input.grpc-server | input.grpc-pull | input.http-server | input.http-pull
     *  Output: output.mqtt | output.grpc-push | output.http-push | output.influxdb3 | output.clickhouse */
    serviceType: varchar("service_type", { length: 50 }).$type<ServiceType>().notNull(),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: bigint("team_id", { mode: "number" }).references(() => teams.id, {
      onDelete: "cascade",
    }),
    /** Optional parser/provider for input services (e.g. chirpstack, everynet) */
    providerId: integer("provider_id").references(() => serviceProvider.id, {
      onDelete: "set null",
    }),
    /** True for input services that receive data from a LoRaWAN network server (e.g. ChirpStack, TTN).
     *  A device with device_type='lorawan' can be routed to multiple LoRaWAN input services
     *  (from different LNS providers) simultaneously — the LNS handles deduplication.
     *  For IP/other device types only one input service is expected. */
    isLoraWan: boolean("is_lorawan").notNull().default(false),
    isGlobal: boolean("is_global").default(false),
    isActive: boolean("is_active").default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => [
    unique("uq_services_org_name").on(t.organizationId, t.name),
    index("idx_services_org").on(t.organizationId),
    index("idx_services_team").on(t.teamId),
    index("idx_services_service_type").on(t.serviceType),
    index("idx_services_active").on(t.isActive),
  ],
);

// ── Per-service config tables (one per service type) ─────────────────────────

/** MQTT input config — subscribe to broker topics */
export const serviceInputMqttConfig = pgTable("service_input_mqtt_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(1883),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  qos: smallint("qos").notNull().default(1),
  cleanSession: boolean("clean_session").notNull().default(false),
  keepAliveSec: integer("keep_alive_sec").notNull().default(60),
  connectionTimeoutSec: integer("connection_timeout_sec").notNull().default(10),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsClientCert: text("tls_client_cert"),
  tlsClientKey: text("tls_client_key"),
  tlsSkipVerify: boolean("tls_skip_verify").notNull().default(false),
  maxReconnectIntervalSec: integer("max_reconnect_interval_sec").notNull().default(10),
  subscribeTopics: jsonb("subscribe_topics").notNull().default([]),
  publishTopicTemplate: varchar("publish_topic_template", { length: 1024 })
    .notNull()
    .default("devices/{device_key}/command"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** MQTT output config — publish to broker topics */
export const serviceOutputMqttConfig = pgTable("service_output_mqtt_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(1883),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  qos: smallint("qos").notNull().default(1),
  cleanSession: boolean("clean_session").notNull().default(false),
  keepAliveSec: integer("keep_alive_sec").notNull().default(60),
  connectionTimeoutSec: integer("connection_timeout_sec").notNull().default(10),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsClientCert: text("tls_client_cert"),
  tlsClientKey: text("tls_client_key"),
  tlsSkipVerify: boolean("tls_skip_verify").notNull().default(false),
  maxReconnectIntervalSec: integer("max_reconnect_interval_sec").notNull().default(10),
  publishTopicTemplate: varchar("publish_topic_template", { length: 1024 }).notNull().default("devices/{device_key}/data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** gRPC server input config — listens for incoming connections */
export const serviceInputGrpcserverConfig = pgTable("service_input_grpcserver_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull().default("0.0.0.0"),
  port: integer("port").notNull().default(50051),
  serviceName: varchar("service_name", { length: 255 }).notNull().default(""),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsCert: text("tls_cert"),
  tlsKey: text("tls_key"),
  maxConnectionAgeSec: integer("max_connection_age_sec").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** gRPC pull input config — client connecting to remote gRPC */
export const serviceInputGrpcpullConfig = pgTable("service_input_grpcpull_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(50051),
  serviceName: varchar("service_name", { length: 255 }).notNull().default(""),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsCert: text("tls_cert"),
  tlsKey: text("tls_key"),
  connectionTimeoutSec: integer("connection_timeout_sec").notNull().default(10),
  keepAliveSec: integer("keep_alive_sec").notNull().default(60),
  keepAliveTimeoutSec: integer("keep_alive_timeout_sec").notNull().default(20),
  maxIdleConns: integer("max_idle_conns").notNull().default(10),
  maxConnections: integer("max_connections").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** HTTP server input config — webhook listener */
export const serviceInputHttpserverConfig = pgTable("service_input_httpserver_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  listenPath: varchar("listen_path", { length: 255 }).notNull().default("/ingest"),
  headers: jsonb("headers").notNull().default({}),
  authType: varchar("auth_type", { length: 50 }).notNull().default("none"),
  authCredentials: varchar("auth_credentials", { length: 1024 }),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsCert: text("tls_cert"),
  tlsKey: text("tls_key"),
  tlsSkipVerify: boolean("tls_skip_verify").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** HTTP pull input config — polling client */
export const serviceInputHttppullConfig = pgTable("service_input_httppull_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  baseUrl: varchar("base_url", { length: 2048 }).notNull(),
  method: varchar("method", { length: 10 }).notNull().default("GET"),
  headers: jsonb("headers").notNull().default({}),
  timeoutSec: integer("timeout_sec").notNull().default(30),
  contentType: varchar("content_type", { length: 100 }).default("application/json"),
  retryCount: integer("retry_count").notNull().default(3),
  retryDelaySec: integer("retry_delay_sec").notNull().default(5),
  authType: varchar("auth_type", { length: 50 }).notNull().default("none"),
  authCredentials: varchar("auth_credentials", { length: 1024 }),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsCert: text("tls_cert"),
  tlsKey: text("tls_key"),
  tlsSkipVerify: boolean("tls_skip_verify").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** gRPC push output config — client that forwards data */
export const serviceOutputGrpcpushConfig = pgTable("service_output_grpcpush_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(50051),
  serviceName: varchar("service_name", { length: 255 }).notNull().default(""),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsCert: text("tls_cert"),
  tlsKey: text("tls_key"),
  connectionTimeoutSec: integer("connection_timeout_sec").notNull().default(10),
  keepAliveSec: integer("keep_alive_sec").notNull().default(60),
  keepAliveTimeoutSec: integer("keep_alive_timeout_sec").notNull().default(20),
  maxIdleConns: integer("max_idle_conns").notNull().default(10),
  maxConnections: integer("max_connections").notNull().default(100),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** HTTP push output config — POST to remote endpoint */
export const serviceOutputHttppushConfig = pgTable("service_output_httppush_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  baseUrl: varchar("base_url", { length: 2048 }).notNull(),
  method: varchar("method", { length: 10 }).notNull().default("POST"),
  headers: jsonb("headers").notNull().default({}),
  timeoutSec: integer("timeout_sec").notNull().default(30),
  contentType: varchar("content_type", { length: 100 }).default("application/json"),
  retryCount: integer("retry_count").notNull().default(3),
  retryDelaySec: integer("retry_delay_sec").notNull().default(5),
  authType: varchar("auth_type", { length: 50 }).notNull().default("none"),
  authCredentials: varchar("auth_credentials", { length: 1024 }),
  useTls: boolean("use_tls").notNull().default(false),
  tlsCaCert: text("tls_ca_cert"),
  tlsCert: text("tls_cert"),
  tlsKey: text("tls_key"),
  tlsSkipVerify: boolean("tls_skip_verify").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** InfluxDB3 output config — time-series writer */
export const serviceOutputInfluxdb3Config = pgTable("service_output_influxdb3_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(8086),
  token: varchar("token", { length: 1024 }).notNull().default(""),
  influxdbOrg: varchar("influxdb_org", { length: 255 }).notNull().default(""),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  measurement: varchar("measurement", { length: 255 }).notNull().default("telemetry"),
  useTls: boolean("use_tls").notNull().default(false),
  writePrecision: varchar("write_precision", { length: 10 }).notNull().default("ns"),
  batchSize: integer("batch_size").notNull().default(5000),
  flushIntervalMs: integer("flush_interval_ms").notNull().default(1000),
  maxRetries: integer("max_retries").notNull().default(3),
  retryDelayMs: integer("retry_delay_ms").notNull().default(500),
  workers: integer("workers").notNull().default(4),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** ClickHouse output config — column store writer */
export const serviceOutputClickhouseConfig = pgTable("service_output_clickhouse_config", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serviceId: bigint("service_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => serviceRegistry.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(9000),
  database: varchar("database", { length: 255 }).notNull().default("default"),
  username: varchar("username", { length: 255 }).notNull().default("default"),
  password: varchar("password", { length: 255 }).notNull().default(""),
  tableName: varchar("table_name", { length: 255 }).notNull().default("telemetry"),
  useTls: boolean("use_tls").notNull().default(false),
  batchSize: integer("batch_size").notNull().default(1000),
  flushIntervalMs: integer("flush_interval_ms").notNull().default(1000),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// DEVICE REGISTRY
// ============================================================================

export const deviceRegistry = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceKey: varchar("device_key", { length: 255 }).notNull(),
    deviceModelId: bigint("device_model_id", { mode: "number" })
      .notNull()
      .references(() => deviceModels.id, { onDelete: "restrict" }),
    deviceType: varchar("device_type", { length: 50 }), // 'lorawan' | 'ip' | 'other'
    devEui: varchar("dev_eui", { length: 16 }),
    macAddress: varchar("mac_address", { length: 17 }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    organizationId: bigint("organization_id", { mode: "number" })
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: bigint("team_id", { mode: "number" })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    // serviceId and lnsProviderId removed — routing is now via team → integration profile
    isPersistent: boolean("is_persistent").default(false),
    isPublic: boolean("is_public").default(false),
    isActive: boolean("is_active").default(true),
    isGlobal: boolean("is_global").default(false),
    connectionStatus: varchar("connection_status", { length: 50 }).default("disconnected"),
    lastHeartbeat: timestamp("last_heartbeat"),
    metadata: jsonb("metadata").default({}),
    /** Visibility scope: 'team' = team-private, 'org' = all org members, 'public' = all authenticated users */
    visibility: varchar("visibility", { length: 20 }).$type<Visibility>().notNull().default("team"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_devices_org_key").on(t.organizationId, t.deviceKey),
    index("idx_devices_key").on(t.deviceKey),
    index("idx_devices_org").on(t.organizationId),
    index("idx_devices_team").on(t.teamId),
    index("idx_devices_model").on(t.deviceModelId),
    index("idx_devices_eui").on(t.devEui),
    index("idx_devices_mac").on(t.macAddress),
    index("idx_devices_active").on(t.isActive),
    index("idx_devices_public").on(t.isPublic),
    index("idx_devices_status").on(t.connectionStatus),
    index("idx_devices_created_by").on(t.createdBy),
  ],
);

// ============================================================================
// SERVICE INPUT — InfluxDB3 query source (reads telemetry FROM InfluxDB3)
// ============================================================================

export const serviceInputInfluxdb3Config = pgTable(
  "service_input_influxdb3_config",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    serviceId: bigint("service_id", { mode: "number" })
      .notNull()
      .unique()
      .references(() => serviceRegistry.id, { onDelete: "cascade" }),
    host: varchar("host", { length: 255 }).notNull(),
    port: integer("port").notNull().default(8086),
    token: varchar("token", { length: 1024 }).notNull().default(""),
    influxdbOrg: varchar("influxdb_org", { length: 255 }).notNull().default(""),
    bucket: varchar("bucket", { length: 255 }).notNull(),
    measurement: varchar("measurement", { length: 255 }).notNull().default("telemetry"),
    useTls: boolean("use_tls").notNull().default(false),
    writePrecision: varchar("write_precision", { length: 10 }).notNull().default("ns"),
    batchSize: integer("batch_size").notNull().default(5000),
    flushIntervalMs: integer("flush_interval_ms").notNull().default(1000),
    maxRetries: integer("max_retries").notNull().default(3),
    retryDelayMs: integer("retry_delay_ms").notNull().default(500),
    workers: integer("workers").notNull().default(4),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

// ============================================================================
// COMMAND DISPATCH
// ============================================================================

export const commandLog = pgTable(
  "command_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => deviceRegistry.id, { onDelete: "cascade" }),
    deviceKey: varchar("device_key", { length: 255 }).notNull(),
    commandType: varchar("command_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: varchar("status", { length: 30 })
      .$type<CommandStatus>()
      .notNull()
      .default("pending"),
    transportType: varchar("transport_type", { length: 30 }).notNull(),
    lnsProviderCode: varchar("lns_provider_code", { length: 50 }),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    dispatchedAt: timestamp("dispatched_at"),
    deliveredAt: timestamp("delivered_at"),
    ackedAt: timestamp("acked_at"),
    expiresAt: timestamp("expires_at"),
    metadata: jsonb("metadata").default({}),
  },
  (t) => [
    index("idx_command_log_device").on(t.deviceId),
    index("idx_command_log_status").on(t.status),
    index("idx_command_log_created").on(t.createdAt),
    index("idx_command_log_device_key").on(t.deviceKey),
  ],
);

export const commandFormatter = pgTable(
  "command_formatter",
  {
    id: serial("id").primaryKey(),
    transportTypeCode: varchar("transport_type_code", { length: 30 }).notNull(),
    lnsProviderCode: varchar("lns_provider_code", { length: 50 }),
    formatterCode: varchar("formatter_code", { length: 100 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uq_transport_lns_formatter").on(t.transportTypeCode, t.lnsProviderCode),
  ],
);

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  teamMembers: many(teamMembers),
  ownedOrganizations: many(organizations),
  createdDevices: many(deviceRegistry),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  owner: one(users, { fields: [organizations.ownerId], references: [users.id] }),
  memberships: many(memberships),
  teams: many(teams),
  services: many(serviceRegistry),
  devices: many(deviceRegistry),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  organization: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
  role: one(roles, { fields: [memberships.roleId], references: [roles.id] }),
  inviter: one(users, { fields: [memberships.invitedBy], references: [users.id] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [teams.organizationId],
    references: [organizations.id],
  }),
  integrationProfile: one(integrationProfiles, {
    fields: [teams.integrationProfileId],
    references: [integrationProfiles.id],
  }),
  members: many(teamMembers),
  applications: many(applications),
  devices: many(deviceRegistry),
  services: many(serviceRegistry),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  role: one(roles, { fields: [teamMembers.roleId], references: [roles.id] }),
}));

export const deviceVendorsRelations = relations(deviceVendors, ({ many }) => ({
  models: many(deviceModels),
}));

export const deviceModelsRelations = relations(deviceModels, ({ one, many }) => ({
  vendor: one(deviceVendors, { fields: [deviceModels.vendorId], references: [deviceVendors.id] }),
  devices: many(deviceRegistry),
  sensors: many(deviceSensors),
}));

export const deviceSensorsRelations = relations(deviceSensors, ({ one }) => ({
  deviceModel: one(deviceModels, {
    fields: [deviceSensors.deviceModelId],
    references: [deviceModels.id],
  }),
}));

export const serviceRegistryRelations = relations(serviceRegistry, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [serviceRegistry.organizationId],
    references: [organizations.id],
  }),
  team: one(teams, { fields: [serviceRegistry.teamId], references: [teams.id] }),
  provider: one(serviceProvider, {
    fields: [serviceRegistry.providerId],
    references: [serviceProvider.id],
  }),
  creator: one(users, { fields: [serviceRegistry.createdBy], references: [users.id] }),
  devices: many(deviceRegistry),
}));

export const deviceRegistryRelations = relations(deviceRegistry, ({ one }) => ({
  model: one(deviceModels, {
    fields: [deviceRegistry.deviceModelId],
    references: [deviceModels.id],
  }),
  organization: one(organizations, {
    fields: [deviceRegistry.organizationId],
    references: [organizations.id],
  }),
  team: one(teams, { fields: [deviceRegistry.teamId], references: [teams.id] }),
  creator: one(users, { fields: [deviceRegistry.createdBy], references: [users.id] }),
  commands: one(commandLog),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  team: one(teams, { fields: [applications.teamId], references: [teams.id] }),
  creator: one(users, { fields: [applications.createdBy], references: [users.id] }),
  deviceAssignments: many(applicationDevices),
  sensorTypes: many(applicationSensorTypes),
  sensorValues: many(applicationSensorValues),
  natsCredentials: one(applicationNatsCredentials, {
    fields: [applications.id],
    references: [applicationNatsCredentials.applicationId],
  }),
}));

export const applicationNatsCredentialsRelations = relations(applicationNatsCredentials, ({ one }) => ({
  application: one(applications, {
    fields: [applicationNatsCredentials.applicationId],
    references: [applications.id],
  }),
}));

export const applicationSensorValuesRelations = relations(applicationSensorValues, ({ one }) => ({
  application: one(applications, {
    fields: [applicationSensorValues.applicationId],
    references: [applications.id],
  }),
}));

export const applicationSensorTypesRelations = relations(applicationSensorTypes, ({ one }) => ({
  application: one(applications, {
    fields: [applicationSensorTypes.applicationId],
    references: [applications.id],
  }),
}));

export const applicationDevicesRelations = relations(applicationDevices, ({ one }) => ({
  application: one(applications, {
    fields: [applicationDevices.applicationId],
    references: [applications.id],
  }),
  device: one(deviceRegistry, {
    fields: [applicationDevices.deviceId],
    references: [deviceRegistry.id],
  }),
  assignedByUser: one(users, {
    fields: [applicationDevices.assignedBy],
    references: [users.id],
  }),
}));



export const integrationProfilesRelations = relations(integrationProfiles, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [integrationProfiles.orgId],
    references: [organizations.id],
  }),
  creator: one(users, { fields: [integrationProfiles.createdBy], references: [users.id] }),
  services: many(integrationProfileServices),
  teams: many(teams),
}));

export const integrationProfileServicesRelations = relations(integrationProfileServices, ({ one }) => ({
  profile: one(integrationProfiles, {
    fields: [integrationProfileServices.profileId],
    references: [integrationProfiles.id],
  }),
  service: one(serviceRegistry, {
    fields: [integrationProfileServices.serviceId],
    references: [serviceRegistry.id],
  }),
}));
