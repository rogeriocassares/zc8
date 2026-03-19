-- Migration 026: Ingest Profiles
--
-- Introduces the ingest_profile concept that bundles InfluxDB3, Redis, and NATS
-- write destinations into a single selectable configuration per device.
--
-- Motivation:
-- - A team can have MANY InfluxDB3 instances (different brokers/buckets for
--   vehicles vs IoT sensors vs lab equipment)
-- - Redis history depth (max_hash_entries) should be configurable per team/profile
-- - Devices should reference a named ingest profile at creation time
--
-- Resolution order for a device's routing:
--   1. device_registry.ingest_profile_id  (device-specific)
--   2. Team's default ingest_profile      (is_default=true for team)
--   3. Org's default ingest_profile       (is_default=true, team_id IS NULL)
--
-- This migration:
-- 1. Adds organization_id/team_id/is_active to ingest_*_config tables (team ownership)
-- 2. Creates ingest_profile table
-- 3. Adds ingest_profile_id FK to device_registry
-- 4. Migrates device_influxdb3_config data → ingest_influxdb_config + ingest_profile
-- 5. Replaces v_device_ingest_routing view with profile-based resolution

BEGIN;

-- ============================================================================
-- 1. ADD OWNERSHIP TO INGEST CONFIG TABLES (from migration 024)
-- ============================================================================
-- These tables were originally "global" — now they're team-scoped resources
-- so teams can manage their own infrastructure instances.

-- 1a. ingest_influxdb_config
ALTER TABLE ingest_influxdb_config
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ingest_influxdb_config_org
  ON ingest_influxdb_config(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingest_influxdb_config_team
  ON ingest_influxdb_config(team_id) WHERE team_id IS NOT NULL;

-- 1b. ingest_redis_config
ALTER TABLE ingest_redis_config
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ingest_redis_config_org
  ON ingest_redis_config(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingest_redis_config_team
  ON ingest_redis_config(team_id) WHERE team_id IS NOT NULL;

-- 1c. ingest_nats_config
ALTER TABLE ingest_nats_config
  ADD COLUMN IF NOT EXISTS organization_id bigint REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ingest_nats_config_org
  ON ingest_nats_config(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingest_nats_config_team
  ON ingest_nats_config(team_id) WHERE team_id IS NOT NULL;

-- ============================================================================
-- 2. INGEST PROFILE
-- ============================================================================
-- Bundles one instance from each backend type + per-profile overrides.
-- Examples: "vehicles-prod" → InfluxDB instance A, bucket "fleet_data"
--           "iot-sensors"   → InfluxDB instance B, bucket "sensor_data", history=50

CREATE SEQUENCE IF NOT EXISTS ingest_profile_id_seq START 1;

CREATE TABLE IF NOT EXISTS ingest_profile (
  id bigint NOT NULL DEFAULT nextval('ingest_profile_id_seq'::regclass) PRIMARY KEY,
  name varchar(255) NOT NULL,
  description text,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id bigint REFERENCES teams(id) ON DELETE CASCADE,

  -- InfluxDB3 destination (NULL influxdb_config_id = skip InfluxDB writes)
  influxdb_config_id bigint REFERENCES ingest_influxdb_config(id) ON DELETE SET NULL,
  influxdb_write_enabled boolean NOT NULL DEFAULT true,
  influxdb_require_ack boolean NOT NULL DEFAULT true,
  influxdb_bucket varchar(255),       -- override bucket from config (NULL = use config default)
  influxdb_measurement varchar(255),  -- override measurement (NULL = use config default)

  -- Redis destination (NULL redis_config_id = use shared Redis from env)
  redis_config_id bigint REFERENCES ingest_redis_config(id) ON DELETE SET NULL,
  redis_write_enabled boolean NOT NULL DEFAULT true,
  redis_max_hash_entries int DEFAULT 10 CHECK (redis_max_hash_entries IS NULL OR redis_max_hash_entries > 0),
  redis_key_prefix varchar(100),      -- override key prefix (NULL = use default "device:")

  -- NATS realtime destination (NULL nats_config_id = use shared NATS from env)
  nats_config_id bigint REFERENCES ingest_nats_config(id) ON DELETE SET NULL,
  nats_write_enabled boolean NOT NULL DEFAULT true,
  nats_subject_prefix varchar(255),   -- override subject (NULL = use default)

  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Profile name is unique within (org, team) scope
  UNIQUE(organization_id, team_id, name)
);

-- At most one default profile per (org, team) scope
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_profile_default_team
  ON ingest_profile(organization_id, team_id)
  WHERE is_default = true AND is_active = true AND team_id IS NOT NULL;

-- At most one org-wide default (team_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_profile_default_org
  ON ingest_profile(organization_id)
  WHERE is_default = true AND is_active = true AND team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ingest_profile_org ON ingest_profile(organization_id);
CREATE INDEX IF NOT EXISTS idx_ingest_profile_team ON ingest_profile(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingest_profile_active ON ingest_profile(is_active) WHERE is_active = true;

COMMENT ON TABLE ingest_profile IS
  'Bundles InfluxDB3, Redis, and NATS write destinations into a named profile. '
  'Devices reference a profile at creation time. Fallback: device → team default → org default.';

COMMENT ON COLUMN ingest_profile.is_default IS
  'If true, this profile is the default for its team (or org if team_id IS NULL). '
  'New devices without an explicit profile assignment inherit the default.';

-- ============================================================================
-- 3. LINK DEVICES TO INGEST PROFILES
-- ============================================================================

ALTER TABLE device_registry
  ADD COLUMN IF NOT EXISTS ingest_profile_id bigint
    REFERENCES ingest_profile(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_device_registry_ingest_profile
  ON device_registry(ingest_profile_id) WHERE ingest_profile_id IS NOT NULL;

COMMENT ON COLUMN device_registry.ingest_profile_id IS
  'References the ingest profile controlling this device''s storage routing. '
  'NULL = inherit team/org default profile.';

-- ============================================================================
-- 4. DATA MIGRATION: device_influxdb3_config → ingest_influxdb_config + ingest_profile
-- ============================================================================
-- Copy existing device_influxdb3_config entries into the 024 ingest_influxdb_config
-- table and create corresponding default ingest_profiles.

-- 4a. Copy InfluxDB3 configs (skip duplicates by host+port+token+bucket)
INSERT INTO ingest_influxdb_config (
  host, port, token, influxdb_org, bucket, measurement,
  use_tls, batch_size, flush_interval_ms, workers,
  organization_id, team_id, is_active
)
SELECT
  host, port, token, influxdb_org, bucket, measurement,
  use_tls, batch_size, flush_interval_ms, workers,
  organization_id, team_id, is_active
FROM device_influxdb3_config
WHERE is_active = true
ON CONFLICT DO NOTHING;

-- 4b. Create default ingest_profiles for each migrated config
-- These become the team/org defaults so existing devices keep working.
INSERT INTO ingest_profile (
  name, description, organization_id, team_id,
  influxdb_config_id, influxdb_write_enabled, influxdb_require_ack,
  influxdb_bucket, influxdb_measurement,
  is_default, is_active
)
SELECT
  CASE
    WHEN dic.team_id IS NOT NULL THEN 'default'
    ELSE 'default'
  END,
  'Auto-migrated from device_influxdb3_config (id=' || dic.id || ')',
  dic.organization_id,
  dic.team_id,
  iic.id,
  true,   -- influxdb_write_enabled
  true,   -- influxdb_require_ack
  dic.bucket,
  dic.measurement,
  true,   -- is_default
  true    -- is_active
FROM device_influxdb3_config dic
JOIN ingest_influxdb_config iic
  ON iic.host = dic.host
  AND iic.port = dic.port
  AND iic.token = dic.token
  AND iic.bucket = dic.bucket
  AND iic.organization_id = dic.organization_id
  AND COALESCE(iic.team_id, 0) = COALESCE(dic.team_id, 0)
WHERE dic.is_active = true
ON CONFLICT (organization_id, team_id, name) DO NOTHING;

-- ============================================================================
-- 5. UPDATED VIEW: Profile-based device ingest routing
-- ============================================================================
-- Resolves the complete device context + write destinations in one query.
-- Used by the transport layer to populate DeviceContext/IngestRouting proto.
--
-- Resolution: device.ingest_profile_id → team default → org default

DROP VIEW IF EXISTS v_device_ingest_routing;
CREATE VIEW v_device_ingest_routing AS
SELECT
  dr.id AS device_id,
  dr.device_key,
  dr.dev_eui,
  dr.mac_address,
  dr.device_type,
  dr.organization_id,
  dr.team_id,
  dr.device_model_id,
  dm.code AS device_model_code,
  dm.vendor_id,
  dv.code AS vendor_code,
  dr.is_active,
  dr.is_persistent,
  dr.transport_registry_id,

  -- Resolved ingest profile
  COALESCE(dev_ip.id, team_ip.id, org_ip.id) AS ingest_profile_id,
  COALESCE(dev_ip.name, team_ip.name, org_ip.name) AS ingest_profile_name,

  -- InfluxDB3 routing
  COALESCE(dev_ip.influxdb_config_id, team_ip.influxdb_config_id, org_ip.influxdb_config_id) AS influxdb_config_id,
  COALESCE(dev_ip.influxdb_write_enabled, team_ip.influxdb_write_enabled, org_ip.influxdb_write_enabled, false) AS influxdb_write_enabled,
  COALESCE(dev_ip.influxdb_require_ack, team_ip.influxdb_require_ack, org_ip.influxdb_require_ack, false) AS influxdb_require_ack,
  iic.host AS influxdb_host,
  iic.port AS influxdb_port,
  iic.token AS influxdb_token,
  COALESCE(
    COALESCE(dev_ip.influxdb_bucket, team_ip.influxdb_bucket, org_ip.influxdb_bucket),
    iic.bucket
  ) AS influxdb_bucket,
  COALESCE(
    COALESCE(dev_ip.influxdb_measurement, team_ip.influxdb_measurement, org_ip.influxdb_measurement),
    iic.measurement,
    'telemetry'
  ) AS influxdb_measurement,

  -- Redis routing
  COALESCE(dev_ip.redis_config_id, team_ip.redis_config_id, org_ip.redis_config_id) AS redis_config_id,
  COALESCE(dev_ip.redis_write_enabled, team_ip.redis_write_enabled, org_ip.redis_write_enabled, true) AS redis_write_enabled,
  COALESCE(dev_ip.redis_max_hash_entries, team_ip.redis_max_hash_entries, org_ip.redis_max_hash_entries, 10) AS redis_max_hash_entries,
  COALESCE(dev_ip.redis_key_prefix, team_ip.redis_key_prefix, org_ip.redis_key_prefix) AS redis_key_prefix,
  irc.host AS redis_host,
  irc.port AS redis_port,

  -- NATS realtime routing
  COALESCE(dev_ip.nats_config_id, team_ip.nats_config_id, org_ip.nats_config_id) AS nats_config_id,
  COALESCE(dev_ip.nats_write_enabled, team_ip.nats_write_enabled, org_ip.nats_write_enabled, true) AS nats_write_enabled,
  COALESCE(dev_ip.nats_subject_prefix, team_ip.nats_subject_prefix, org_ip.nats_subject_prefix) AS nats_subject_prefix,
  inc.url AS nats_url,

  -- LNS provider info (only for lorawan devices)
  lp.code AS lns_provider_code,
  lp.display_name AS lns_provider_name

FROM device_registry dr
JOIN device_models dm ON dr.device_model_id = dm.id
JOIN device_vendors dv ON dm.vendor_id = dv.id

-- Device-specific ingest profile (highest priority)
LEFT JOIN ingest_profile dev_ip
  ON dr.ingest_profile_id = dev_ip.id
  AND dev_ip.is_active = true

-- Team default ingest profile (second priority)
LEFT JOIN ingest_profile team_ip
  ON team_ip.organization_id = dr.organization_id
  AND team_ip.team_id = dr.team_id
  AND team_ip.is_default = true
  AND team_ip.is_active = true
  AND dr.ingest_profile_id IS NULL

-- Org default ingest profile (last resort)
LEFT JOIN ingest_profile org_ip
  ON org_ip.organization_id = dr.organization_id
  AND org_ip.team_id IS NULL
  AND org_ip.is_default = true
  AND org_ip.is_active = true
  AND dr.ingest_profile_id IS NULL
  AND team_ip.id IS NULL

-- Resolve backend configs from winning profile
LEFT JOIN ingest_influxdb_config iic
  ON iic.id = COALESCE(dev_ip.influxdb_config_id, team_ip.influxdb_config_id, org_ip.influxdb_config_id)
LEFT JOIN ingest_redis_config irc
  ON irc.id = COALESCE(dev_ip.redis_config_id, team_ip.redis_config_id, org_ip.redis_config_id)
LEFT JOIN ingest_nats_config inc
  ON inc.id = COALESCE(dev_ip.nats_config_id, team_ip.nats_config_id, org_ip.nats_config_id)

-- LNS provider (optional, for lorawan devices)
LEFT JOIN lns_provider lp ON dr.lns_provider_id = lp.id

WHERE dr.is_active = true;

COMMIT;
