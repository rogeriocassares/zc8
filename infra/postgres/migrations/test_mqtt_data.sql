-- Test data for MQTT subscriber functionality
-- Creates device_model, transport_registry, and device_registry

-- 1. Create new device_model (id 5)
INSERT INTO device_models (vendor_id, name, code, description, created_at, updated_at)
VALUES (7, 'Emergency', 'ws101', 'Emergency', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
RETURNING id, vendor_id, code, name;

-- 2. Create transport_registry (for MQTT broker connection)
-- Note: is_global=false because team_id=1 is specified (constraint requires this)
INSERT INTO transport_registry (
  name, description, organization_id, team_id, 
  transport_type_id, transport_parser_id, 
  is_global, is_active, config, created_by
)
VALUES (
  'chirpstack',
  'chirpstack from imt',
  2, 1,
  1, 1,
  false, true,
  '{"hostname":"mqtt.maua.br", "port":1883,"topic":"application/+/device/+/up"}'::jsonb,
  'f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid
)
RETURNING id, name, organization_id, team_id, is_global, is_active, transport_parser_id, config;

-- 3. Create device_registry (actual device instance)
INSERT INTO device_registry (
  device_key, device_model_id, eui, 
  organization_id, team_id, 
  created_by, 
  is_public, is_active, is_global,
  parser_type_id, transport_registry_id
)
VALUES (
  'emergency-ws101-001',
  5,
  '24e124535f318437',
  2, 1,
  'f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid,
  true, true, false,
  1, 3
)
RETURNING id, device_key, device_model_id, eui, organization_id, team_id, parser_type_id, transport_registry_id, is_public, is_active;
