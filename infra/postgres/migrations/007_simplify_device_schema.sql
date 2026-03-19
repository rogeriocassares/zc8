-- ============================================================
-- PostgreSQL Migration 007: Simplify Device Schema
-- ============================================================
-- Purpose: Remove redundant columns and simplify device configuration
-- Changes:
--   - Remove device_type_id from device_models (device_types already dropped)
--   - Remove spec from device_models (unused)
--   - Remove protocol from device_models (infer from identifier format)
--   - Remove vendor_type from device_vendors (redundant CHECK constraint)
--   - Update device_registry_with_type view to infer protocol
--   - Update validate_device_identifier trigger to infer protocol
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: DROP UNUSED COLUMNS
-- ============================================================

\echo 'Removing device_type_id from device_models...'
ALTER TABLE device_models DROP COLUMN device_type_id CASCADE;

\echo 'Removing spec from device_models...'
ALTER TABLE device_models DROP COLUMN spec;

\echo 'Removing protocol from device_models...'
ALTER TABLE device_models DROP COLUMN protocol;

\echo 'Removing vendor_type from device_vendors...'
ALTER TABLE device_vendors DROP COLUMN vendor_type;

-- ============================================================
-- SECTION 2: RECREATE VIEW WITH PROTOCOL INFERENCE
-- ============================================================
-- Protocol is now inferred from the identifier format:
-- - EUI → LoRaWAN
-- - MAC → MQTT
-- - Others use first available identifier

\echo 'Recreating device_registry_with_type view with protocol inference...'

DROP VIEW IF EXISTS device_registry_with_type CASCADE;

CREATE VIEW device_registry_with_type AS
SELECT 
  dr.id,
  dr.device_key,
  dr.device_model_id,
  dr.eui,
  dr.mac_address,
  dr.created_by,
  dr.organization_id,
  dr.team_id,
  dr.lns_provider_id,
  dr.is_public,
  dr.is_active,
  dr.is_global,
  dr.metadata,
  dr.created_at,
  dr.updated_at,
  dm.vendor_id,
  dm.name as device_model_name,
  dm.code as device_model_code,
  dv.name as vendor_name,
  dv.code as vendor_code,
  -- Infer protocol from identifier format
  CASE 
    WHEN dr.eui IS NOT NULL THEN 'lora'
    WHEN dr.mac_address IS NOT NULL THEN 'mqtt'
    ELSE 'unknown'
  END as device_protocol
FROM device_registry dr
JOIN device_models dm ON dr.device_model_id = dm.id
JOIN device_vendors dv ON dm.vendor_id = dv.id;

-- ============================================================
-- SECTION 3: RECREATE TRIGGER WITH PROTOCOL INFERENCE
-- ============================================================
-- Update validate_device_identifier to infer protocol from identifier type

\echo 'Recreating validate_device_identifier trigger with protocol inference...'

DROP TRIGGER IF EXISTS validate_device_identifier ON device_registry CASCADE;
DROP FUNCTION IF EXISTS validate_device_identifier() CASCADE;

CREATE FUNCTION validate_device_identifier() RETURNS TRIGGER AS $$
DECLARE
  v_device_protocol VARCHAR(50);
  v_eui_pattern TEXT := '^[0-9A-Fa-f]{16}$';
  v_mac_pattern TEXT := '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$';
BEGIN
  -- Infer protocol from identifier format
  IF NEW.eui IS NOT NULL THEN
    v_device_protocol := 'lora';
    -- Validate EUI format (16 hex characters)
    IF NEW.eui !~ v_eui_pattern THEN
      RAISE EXCEPTION 'Invalid EUI format for LoRaWAN device: %, must be 16 hex characters', NEW.eui;
    END IF;
  ELSIF NEW.mac_address IS NOT NULL THEN
    v_device_protocol := 'mqtt';
    -- Validate MAC format (AA:BB:CC:DD:EE:FF)
    IF NEW.mac_address !~ v_mac_pattern THEN
      RAISE EXCEPTION 'Invalid MAC address format for MQTT device: %, must be XX:XX:XX:XX:XX:XX', NEW.mac_address;
    END IF;
  ELSE
    RAISE EXCEPTION 'Device must have either EUI (LoRaWAN) or MAC address (MQTT)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_device_identifier
  BEFORE INSERT OR UPDATE ON device_registry
  FOR EACH ROW
  EXECUTE FUNCTION validate_device_identifier();

-- ============================================================
-- SECTION 4: VERIFY SCHEMA CHANGES
-- ============================================================

\echo ''
\echo '✅ Device Schema Simplified!'
\echo ''
\echo 'device_models current structure:'
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'device_models'
ORDER BY ordinal_position;

\echo ''
\echo 'device_vendors current structure:'
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'device_vendors'
ORDER BY ordinal_position;

\echo ''
\echo 'Device Registry view with inferred protocol:'
SELECT 
  device_key,
  device_protocol,
  eui,
  mac_address
FROM device_registry_with_type
LIMIT 5;

COMMIT;
