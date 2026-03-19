-- Reset and Configure Transport & Device Registry
-- 2026-03-16
-- NOTE: Database constraint requires: is_global=true => team_id=NULL or is_global=false => team_id NOT NULL
-- Since team_id=1 is required, is_global must be false

-- ============================================================================
-- 1. Clear and reset transport_registry table
-- ============================================================================

TRUNCATE TABLE transport_registry RESTART IDENTITY CASCADE;

-- Insert the new ChirpStack-IMT transport
-- Note: Since team_id=1, is_global must be false (database constraint)
INSERT INTO transport_registry (
  id,
  name,
  description,
  organization_id,
  team_id,
  transport_type_id,
  is_global,
  is_active,
  config,
  created_by,
  created_at,
  updated_at,
  updated_by,
  transport_parser_id
) VALUES (
  1,
  'ChirpStack-IMT',
  'ChirpStack-IMT',
  2,
  1,
  1,
  false,
  true,
  '{"host":"networkserver2.maua.br","port":1883,"topics":"[\"application/+/device/+/event/up\"]"}',
  'f47ac10b-58cc-4372-a567-0e02b2c3d481'::uuid,
  '2026-03-12 20:45:29.50811'::timestamp,
  '2026-03-12 20:45:29.50811'::timestamp,
  'f47ac10b-58cc-4372-a567-0e02b2c3d481'::uuid,
  1
);

-- ============================================================================
-- 2. Ensure device vendor exists for Milesight
-- ============================================================================

DO $$ 
BEGIN
  INSERT INTO device_vendors (id, name, code)
  VALUES (7, 'Milesight', 'milesight')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================================================
-- 3. Add new device model
-- ============================================================================

INSERT INTO device_models (
  id,
  vendor_id,
  name,
  code,
  description
) VALUES (
  7,
  7,
  'Milesight-W101-R',
  'ws101',
  'Milesight-WS101R'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ============================================================================
-- 4. Remove parser_type_id column from device_registry if it exists
-- ============================================================================

DO $$ 
BEGIN
  BEGIN
    ALTER TABLE device_registry DROP COLUMN parser_type_id;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;
END $$;

-- ============================================================================
-- 5. Clean up and add new device to device_registry
-- ============================================================================

TRUNCATE TABLE device_registry CASCADE;

INSERT INTO device_registry (
  device_key,
  device_model_id,
  eui,
  organization_id,
  team_id,
  is_public,
  is_global,
  is_active,
  transport_registry_id,
  created_by
) VALUES (
  'milesight-ws101-001',
  7,
  '24e124535f318437',
  2,
  1,
  true,
  true,
  true,
  1,
  'f47ac10b-58cc-4372-a567-0e02b2c3d481'::uuid
);

-- ============================================================================
-- 6. Verify the inserts
-- ============================================================================

SELECT '✓ Configuration Complete' as status;
SELECT '';
SELECT 'Table Counts:' as info;
SELECT 'transport_registry' as table_name, COUNT(*) as rows FROM transport_registry
UNION ALL SELECT 'device_models', COUNT(*) FROM device_models
UNION ALL SELECT 'device_registry', COUNT(*) FROM device_registry
ORDER BY table_name;

SELECT '';
SELECT 'Transport Registry Data:' as info;
SELECT id, name, team_id, transport_parser_id, is_active FROM transport_registry;

SELECT '';
SELECT 'Device Model Data:' as info;
SELECT id, vendor_id, name, code FROM device_models WHERE id = 7;

SELECT '';
SELECT 'Device Registry Data:' as info;
SELECT device_key, eui, team_id, is_active, transport_registry_id FROM device_registry;
