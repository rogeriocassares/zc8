-- Migration 025: Device & Transport Schema Redesign
--
-- Addresses:
-- 1. device_registry: LoRaWAN vs non-LoRaWAN null inconsistency (dev_eui / mac_address)
-- 2. device_registry: Add device_type discriminator + is_persistent for InfluxDB write control
-- 3. device_registry: Proper FK for lns_provider_id via new lns_provider table
-- 4. device_influxdb3_config: Per-org/team InfluxDB3 instance config
-- 5. transport_registry: Drop deprecated config JSONB column
-- 6. transport_parser: Add missing device parsers to seed data
-- 7. v_device_ingest_routing: Denormalized view for 3-tier cache warm

BEGIN;

-- ============================================================================
-- 1. LNS PROVIDER REFERENCE TABLE
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS lns_provider_id_seq START 1;

CREATE TABLE IF NOT EXISTS lns_provider (
  id bigint NOT NULL DEFAULT nextval('lns_provider_id_seq'::regclass) PRIMARY KEY,
  code varchar NOT NULL UNIQUE,
  display_name varchar NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed LNS providers
INSERT INTO lns_provider (code, display_name, description) VALUES
  ('chirpstack', 'ChirpStack', 'Open-source LoRaWAN Network Server'),
  ('everynet', 'Everynet', 'Everynet LoRaWAN-as-a-Service platform'),
  ('ttn', 'The Things Network', 'The Things Network community LoRaWAN'),
  ('actility', 'Actility', 'Actility ThingPark LoRaWAN platform'),
  ('loriot', 'LORIOT', 'LORIOT LoRaWAN Network Server')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. DEVICE INFLUXDB3 CONFIG (per-org/team InfluxDB3 instances)
-- ============================================================================
-- Each organization/team can have its own InfluxDB3 instance.
-- Devices inherit the config from their org/team.
-- Resolution order: team-specific → org-wide default.

CREATE SEQUENCE IF NOT EXISTS device_influxdb3_config_id_seq START 1;

CREATE TABLE IF NOT EXISTS device_influxdb3_config (
  id bigint NOT NULL DEFAULT nextval('device_influxdb3_config_id_seq'::regclass) PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  host varchar(255) NOT NULL,
  port int NOT NULL DEFAULT 8086 CHECK (port > 0 AND port < 65536),
  token varchar(1024) NOT NULL,
  influxdb_org varchar(255) NOT NULL,
  bucket varchar(255) NOT NULL,
  measurement varchar(255) NOT NULL DEFAULT 'telemetry',
  use_tls boolean NOT NULL DEFAULT false,
  write_precision varchar(10) NOT NULL DEFAULT 'ns'
    CHECK (write_precision IN ('ns', 'us', 'ms', 's')),
  batch_size int NOT NULL DEFAULT 5000 CHECK (batch_size > 0),
  flush_interval_ms int NOT NULL DEFAULT 1000 CHECK (flush_interval_ms > 0),
  max_retries int NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  workers int NOT NULL DEFAULT 4 CHECK (workers > 0 AND workers <= 64),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique: at most one config per (org, team) pair
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_influxdb3_config_org_team
  ON device_influxdb3_config(organization_id, team_id)
  WHERE team_id IS NOT NULL;

-- Unique: at most one org-wide default (team_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_influxdb3_config_org_default
  ON device_influxdb3_config(organization_id)
  WHERE team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_influxdb3_config_active
  ON device_influxdb3_config(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. ALTER DEVICE REGISTRY
-- ============================================================================

-- 3a. Fix existing trigger that references the old 'eui' column name
-- Also update to respect device_type = 'other' (no identifier required)
CREATE OR REPLACE FUNCTION validate_device_identifier()
RETURNS TRIGGER AS $$
DECLARE
  v_eui_pattern TEXT := '^[0-9A-Fa-f]{16}$';
  v_mac_pattern TEXT := '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$';
BEGIN
  IF NEW.device_type = 'lorawan' THEN
    IF NEW.dev_eui IS NULL THEN
      RAISE EXCEPTION 'LoRaWAN device must have dev_eui';
    END IF;
    IF NEW.dev_eui !~ v_eui_pattern THEN
      RAISE EXCEPTION 'Invalid DevEUI format: %, must be 16 hex characters', NEW.dev_eui;
    END IF;
  ELSIF NEW.device_type = 'ip' THEN
    IF NEW.mac_address IS NULL THEN
      RAISE EXCEPTION 'IP device must have mac_address';
    END IF;
    IF NEW.mac_address !~ v_mac_pattern THEN
      RAISE EXCEPTION 'Invalid MAC address format: %, must be XX:XX:XX:XX:XX:XX', NEW.mac_address;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Rename eui → dev_eui
ALTER TABLE device_registry RENAME COLUMN eui TO dev_eui;

-- Add device_type discriminator column
ALTER TABLE device_registry
  ADD COLUMN IF NOT EXISTS device_type varchar(20) NOT NULL DEFAULT 'lorawan'
    CHECK (device_type IN ('lorawan', 'ip', 'other'));

-- 3c. Add is_persistent (controls whether device data is written to InfluxDB)
ALTER TABLE device_registry
  ADD COLUMN IF NOT EXISTS is_persistent boolean NOT NULL DEFAULT true;

-- 3d. Add FK for lns_provider_id → lns_provider table
-- First set existing NULL lns_provider_id values (they stay NULL, which is fine)
ALTER TABLE device_registry
  ADD CONSTRAINT fk_device_registry_lns_provider
    FOREIGN KEY (lns_provider_id) REFERENCES lns_provider(id)
    ON DELETE SET NULL;

-- 3e. Enforce: lorawan devices must have dev_eui, ip devices must have mac_address
ALTER TABLE device_registry
  ADD CONSTRAINT chk_device_type_identifier CHECK (
    (device_type = 'lorawan' AND dev_eui IS NOT NULL)
    OR (device_type = 'ip' AND mac_address IS NOT NULL)
    OR (device_type = 'other')
  );

-- 3f. Update existing index (renamed column)
DROP INDEX IF EXISTS idx_device_registry_eui;
CREATE INDEX IF NOT EXISTS idx_device_registry_dev_eui
  ON device_registry(dev_eui) WHERE dev_eui IS NOT NULL;

-- 3g. Add index for device_type lookups
CREATE INDEX IF NOT EXISTS idx_device_registry_device_type
  ON device_registry(device_type);

-- 3h. Add index for is_persistent
CREATE INDEX IF NOT EXISTS idx_device_registry_persistent
  ON device_registry(is_persistent) WHERE is_persistent = true;

-- 3i. Comment on metadata column to document expected structure
COMMENT ON COLUMN device_registry.metadata IS
  'Device-specific metadata JSON. Expected keys: firmware_version, hardware_version, '
  'location (lat/lng), custom labels. Do NOT store connection config here.';

COMMENT ON COLUMN device_registry.lns_provider_id IS
  'FK to lns_provider table. Only relevant for lorawan device_type. '
  'Identifies which LoRaWAN Network Server manages this device.';

COMMENT ON COLUMN device_registry.is_persistent IS
  'Controls InfluxDB write behavior. true = persist to InfluxDB, '
  'false = Redis/NATS only (real-time streaming without storage).';

COMMENT ON COLUMN device_registry.device_type IS
  'Device connectivity type. lorawan = LoRaWAN (requires dev_eui), '
  'ip = IP-based (requires mac_address), other = generic/custom.';

-- ============================================================================
-- 4. ALTER TRANSPORT REGISTRY: Drop deprecated config JSONB column
-- ============================================================================

ALTER TABLE transport_registry DROP COLUMN IF EXISTS config;

-- ============================================================================
-- 5. TRANSPORT PARSER: Add device parser seeds
-- ============================================================================

-- Update existing gateway parsers to have explicit parser_type
UPDATE transport_parser SET parser_type = 'gateway' WHERE code IN ('chirpstack', 'everynet', 'default');

-- Advance sequence past any rows inserted with explicit IDs (avoids PK conflict)
SELECT setval('transport_parser_id_seq', (SELECT MAX(id) FROM transport_parser));

-- Add device parsers (code matches Go switch-case in parser_registry.go)
INSERT INTO transport_parser (code, display_name, description, is_builtin, parser_type, is_active) VALUES
  ('milesight', 'Milesight Device', 'Milesight IoT sensor binary payload decoder', true, 'device', true),
  ('zc2x', 'ZC2X Device', 'ZC2X ESP32-based device payload decoder', true, 'device', true),
  ('agent', 'Agent Device', 'Agent distributed telemetry agent decoder', true, 'device', true),
  ('kron', 'Kron Device', 'Kron energy monitoring device decoder', true, 'device', true),
  ('khomp', 'Khomp Device', 'Khomp industrial gateway/meter decoder', true, 'device', true),
  ('schneider', 'Schneider Device', 'Schneider Electric industrial device decoder', true, 'device', true)
ON CONFLICT (code) DO UPDATE SET parser_type = EXCLUDED.parser_type, is_active = EXCLUDED.is_active;

-- ============================================================================
-- 6. VIEW: Denormalized device → ingest routing for 3-tier cache warm
-- ============================================================================
-- This view resolves the complete device context + InfluxDB routing
-- in a single query, used by the transport layer to populate DeviceContext proto.
-- Resolution: device → org/team → device_influxdb3_config (team-specific, then org-wide)

CREATE OR REPLACE VIEW v_device_ingest_routing AS
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
  -- InfluxDB3 config (team-specific takes precedence over org-wide)
  COALESCE(team_influx.id, org_influx.id) AS influxdb3_config_id,
  COALESCE(team_influx.host, org_influx.host) AS influxdb_host,
  COALESCE(team_influx.port, org_influx.port) AS influxdb_port,
  COALESCE(team_influx.token, org_influx.token) AS influxdb_token,
  COALESCE(team_influx.influxdb_org, org_influx.influxdb_org) AS influxdb_org,
  COALESCE(team_influx.bucket, org_influx.bucket) AS influxdb_bucket,
  COALESCE(team_influx.measurement, org_influx.measurement) AS influxdb_measurement,
  COALESCE(team_influx.use_tls, org_influx.use_tls) AS influxdb_use_tls,
  COALESCE(team_influx.batch_size, org_influx.batch_size) AS influxdb_batch_size,
  COALESCE(team_influx.flush_interval_ms, org_influx.flush_interval_ms) AS influxdb_flush_interval_ms,
  COALESCE(team_influx.workers, org_influx.workers) AS influxdb_workers,
  -- LNS provider info (only for lorawan devices)
  lp.code AS lns_provider_code,
  lp.display_name AS lns_provider_name
FROM device_registry dr
JOIN device_models dm ON dr.device_model_id = dm.id
JOIN device_vendors dv ON dm.vendor_id = dv.id
-- Team-specific InfluxDB config (highest priority)
LEFT JOIN device_influxdb3_config team_influx
  ON team_influx.organization_id = dr.organization_id
  AND team_influx.team_id = dr.team_id
  AND team_influx.is_active = true
-- Org-wide InfluxDB config (fallback)
LEFT JOIN device_influxdb3_config org_influx
  ON org_influx.organization_id = dr.organization_id
  AND org_influx.team_id IS NULL
  AND org_influx.is_active = true
-- LNS provider (optional)
LEFT JOIN lns_provider lp ON dr.lns_provider_id = lp.id
WHERE dr.is_active = true;

COMMIT;
