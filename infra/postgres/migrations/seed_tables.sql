-- ============================================================================
-- seed_tables.sql — Reference / Lookup Seed Data
-- ============================================================================
-- Contains only durable reference rows that the platform requires on first
-- boot.  Does NOT include test devices, test organizations, or test users
-- (those come from test fixtures).
--
-- When mounted as docker-entrypoint-initdb.d/02_seed_tables.sql, this file
-- runs after 01_create_tables.sql. It connects to the zc8 database and
-- inserts all required reference data including the superAdmin bootstrap user.
--
-- Sections:
--   1.  user_roles        — RBAC system roles
--   2.  user_plans_config — plan tier limits
--   3.  service_providers — built-in integration/LNS providers
--   4.  command_formatter — built-in command formatters
--   5.  device_vendors    — supported device vendors
--   6.  device_models     — known device models
--   7.  users             — superAdmin bootstrap user
-- ============================================================================

-- Connect to the application database
\c zc8

-- ============================================================================
-- 1. USER_ROLES  (system roles — final permissions after migration 032)
-- ============================================================================
-- Organization roles (scope = 'organization')
--   Owner   → full org + team management
--   Admin   → member management + team management (no org delete/transfer)
--   Member  → read-only org + team management since migration 032
--
-- Team roles (scope = 'team')
--   TeamOwner  → full control + ownership transfer
--   TeamAdmin  → create/manage devices and team members, no transfer
--   TeamMember → read/monitor devices, no member management

INSERT INTO user_roles (name, scope, description, permissions, is_system_role) VALUES
(
  'Owner',
  'organization',
  'Full organization owner — can delete the org and transfer ownership',
  '{"read": true, "admin": true, "write": true, "delete": true, "manage_teams": true, "manage_members": true}'::jsonb,
  true
),
(
  'Admin',
  'organization',
  'Organization administrator — can manage members and teams',
  '{"read": true, "admin": true, "write": true, "delete": true, "manage_teams": true, "manage_members": true}'::jsonb,
  true
),
(
  'Member',
  'organization',
  'Organization member — read access and team management (migration 032)',
  '{"read": true, "admin": false, "write": false, "delete": false, "manage_teams": true, "manage_members": false}'::jsonb,
  true
),
(
  'TeamOwner',
  'team',
  'Team owner — full control including ownership transfer',
  '{"read": true, "admin": true, "write": true, "delete": true, "create_devices": true, "manage_members": true, "create_subteams": true, "monitor_devices": true, "transfer_ownership": true}'::jsonb,
  true
),
(
  'TeamAdmin',
  'team',
  'Team administrator — create and manage devices and members',
  '{"read": true, "admin": true, "write": true, "delete": true, "create_devices": true, "manage_members": true, "create_subteams": false, "monitor_devices": true, "transfer_ownership": false}'::jsonb,
  true
),
(
  'TeamMember',
  'team',
  'Team member — read and monitor devices',
  '{"read": true, "admin": false, "write": true, "delete": false, "create_devices": true, "manage_members": false, "create_subteams": false, "monitor_devices": true, "transfer_ownership": false}'::jsonb,
  true
)
ON CONFLICT (name) DO UPDATE SET
  permissions    = EXCLUDED.permissions,
  is_system_role = EXCLUDED.is_system_role,
  updated_at     = now();

-- ============================================================================
-- 2. USER_PLANS_CONFIG  (plan tier limits — after migrations 0001/0003/0009)
-- ============================================================================
-- Columns (final state):
--   max_orgs             — org count the user may create (-1 = unlimited)
--   max_teams_per_org    — teams per org
--   max_apps_per_team    — applications per team (added by 0003)
--   max_devices_per_team — devices per team (added by 0003)
--   max_members_per_org  — members per org (added by 0009)

INSERT INTO user_plans_config
  (plan, max_orgs, max_teams_per_org, max_apps_per_team, max_devices_per_team, max_members_per_org)
VALUES
  ('user',        0,   0,   0,   0,   0),
  ('hobby',       1,   1,   3,  10,   5),
  ('pro',         1,   5,  10,  50,  20),
  ('premium',    -1,  20,  50,  -1,  -1),
  ('enterprise', -1,  -1,  -1,  -1,  -1)
ON CONFLICT (plan) DO UPDATE SET
  max_orgs             = EXCLUDED.max_orgs,
  max_teams_per_org    = EXCLUDED.max_teams_per_org,
  max_apps_per_team    = EXCLUDED.max_apps_per_team,
  max_devices_per_team = EXCLUDED.max_devices_per_team,
  max_members_per_org  = EXCLUDED.max_members_per_org,
  updated_at           = now();

-- ============================================================================
-- 3. SERVICE_PROVIDERS  (built-in integration + LNS providers)
-- ============================================================================
-- Sources:
--   • integration_provider seeds (Drizzle 0011)
--   • lns_provider records merged in (Drizzle 0012)  — is_lns = true
--   • default_subscribe_topics     (Drizzle 0014)

INSERT INTO service_providers
  (code, display_name, description, is_builtin, is_lns, default_subscribe_topics)
VALUES
  (
    'chirpstack',
    'ChirpStack',
    'Open-source LoRaWAN Network Server (ChirpStack v4)',
    true, true,
    '["applications/+/devices/+/up"]'::jsonb
  ),
  (
    'everynet',
    'Everynet',
    'Everynet LoRaWAN-as-a-Service platform',
    true, true,
    '["#"]'::jsonb
  ),
  (
    'ttn',
    'The Things Network',
    'The Things Network community LoRaWAN server',
    true, true,
    '["v3/+/devices/+/up"]'::jsonb
  ),
  (
    'actility',
    'Actility',
    'Actility ThingPark LoRaWAN enterprise platform',
    true, true,
    '[]'::jsonb
  ),
  (
    'loriot',
    'LORIOT',
    'LORIOT LoRaWAN Network Server',
    true, true,
    '[]'::jsonb
  ),
  (
    'schneider',
    'Schneider Electric',
    'Schneider Electric EcoStruxure industrial platform',
    true, false,
    '[]'::jsonb
  )
ON CONFLICT (code) DO UPDATE SET
  display_name             = EXCLUDED.display_name,
  description              = EXCLUDED.description,
  is_lns                   = EXCLUDED.is_lns,
  default_subscribe_topics = EXCLUDED.default_subscribe_topics;

-- ============================================================================
-- 4. COMMAND_FORMATTER  (built-in downlink formatters — migration 027)
-- ============================================================================
-- Maps (transport_type_code, lns_provider_code) → formatter_code.
-- lns_provider_code = NULL means "generic formatter for that transport type".

INSERT INTO command_formatter
  (transport_type_code, lns_provider_code, formatter_code, description)
VALUES
  (
    'mqtt', 'chirpstack',
    'chirpstack_mqtt_downlink',
    'ChirpStack v4 MQTT downlink via applications/{app_id}/devices/{dev_eui}/command/down'
  ),
  (
    'mqtt', 'ttn',
    'ttn_mqtt_downlink',
    'TTN v3 MQTT downlink via v3/{app_id}/devices/{dev_id}/down/push'
  ),
  (
    'mqtt', NULL,
    'direct_mqtt_command',
    'Direct MQTT publish to device command topic'
  ),
  (
    'http', 'everynet',
    'everynet_http_downlink',
    'Everynet REST API downlink POST'
  ),
  (
    'http', 'actility',
    'actility_http_downlink',
    'Actility ThingPark REST API downlink'
  ),
  (
    'http', 'loriot',
    'loriot_http_downlink',
    'LORIOT REST API downlink'
  ),
  (
    'http', NULL,
    'generic_http_command',
    'Generic HTTP POST command to device endpoint'
  ),
  (
    'grpc', NULL,
    'grpc_bidirectional',
    'gRPC bidirectional stream CommandDispatch'
  )
ON CONFLICT (transport_type_code, lns_provider_code) DO UPDATE SET
  formatter_code = EXCLUDED.formatter_code,
  description    = EXCLUDED.description,
  is_active      = true;

-- ============================================================================
-- 5. DEVICE_VENDORS  (supported hardware vendors — migration 023/006)
-- ============================================================================

INSERT INTO device_vendors (name, code, description) VALUES
  ('Milesight',  'milesight',  'Milesight IoT sensor and gateway solutions'),
  ('Kron',       'kron',       'Kron energy monitoring and control devices'),
  ('Khomp',      'khomp',      'Khomp industrial gateway and meter solutions'),
  ('Zc2x',       'zc2x',       'Zc2x ESP32-based IoT embedded systems'),
  ('Agent',      'agent',      'Agent distributed telemetry agent service'),
  ('Schneider',  'schneider',  'Schneider Electric industrial automation and control')
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at  = now();

-- ============================================================================
-- 6. DEVICE_MODELS  (known device models — migration 023)
-- ============================================================================

INSERT INTO device_models (vendor_id, name, code, description)
SELECT v.id, 'Milesight WS101-R', 'ws101', 'Milesight WS101-R LoRaWAN button/PIR sensor'
FROM device_vendors v
WHERE v.code = 'milesight'
ON CONFLICT (vendor_id, code) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at  = now();

-- ============================================================================
-- 7. USERS — superAdmin bootstrap account  (migration 030 + 031)
-- ============================================================================
-- password_hash = SHA-256('admin123')
-- This is the only user seeded; all other users are created at runtime.

INSERT INTO users
  (id, email, password_hash, first_name, last_name, role, plan, email_verified, is_active)
VALUES
  (
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    'admin@platform.com',
    '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
    'Platform',
    'Admin',
    'superAdmin',
    'enterprise',
    true,
    true
  )
ON CONFLICT (email) DO UPDATE SET
  role           = 'superAdmin',
  plan           = 'enterprise',
  first_name     = 'Platform',
  last_name      = 'Admin',
  email_verified = true,
  is_active      = true,
  updated_at     = now();
