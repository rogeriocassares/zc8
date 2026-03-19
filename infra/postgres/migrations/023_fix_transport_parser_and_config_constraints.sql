-- Migration 023: Fix transport_parser schema and config table constraints
-- 
-- Fixes:
-- 1. Add missing parser_type and is_active columns to transport_parser
-- 2. Remove UNIQUE constraint on transport_*_config.transport_type_id
--    (allows multiple configs per protocol - one per org/team broker)
-- 3. Drop legacy config JSONB default from transport_registry

-- ============================================================================
-- 1. Fix transport_parser table (matches Go code queries)
-- ============================================================================

ALTER TABLE transport_parser
  ADD COLUMN IF NOT EXISTS parser_type varchar(20) NOT NULL DEFAULT 'gateway'
    CHECK (parser_type IN ('gateway', 'device')),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Create index for parser lookups by type + active status
CREATE INDEX IF NOT EXISTS idx_transport_parser_type_active 
  ON transport_parser(parser_type, is_active) WHERE is_active = true;

-- ============================================================================
-- 2. Remove UNIQUE constraints on config type IDs
--    Each org/team can have its own broker config (many configs per protocol)
-- ============================================================================

ALTER TABLE transport_mqtt_config 
  DROP CONSTRAINT IF EXISTS transport_mqtt_config_transport_type_id_key;

ALTER TABLE transport_http_config 
  DROP CONSTRAINT IF EXISTS transport_http_config_transport_type_id_key;

ALTER TABLE transport_grpc_config 
  DROP CONSTRAINT IF EXISTS transport_grpc_config_transport_type_id_key;

-- ============================================================================
-- 3. Change transport_registry.config from NOT NULL to nullable (legacy field)
-- ============================================================================

ALTER TABLE transport_registry 
  ALTER COLUMN config DROP NOT NULL,
  ALTER COLUMN config SET DEFAULT NULL;

COMMENT ON COLUMN transport_registry.config IS 
  'DEPRECATED: Use transport_config → transport_*_config typed tables instead';
