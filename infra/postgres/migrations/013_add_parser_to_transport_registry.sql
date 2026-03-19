-- Migration 013: Add transport_parser default to transport_registry
-- Date: March 12, 2026
-- Purpose: Each transport instance specifies its default parser strategy
-- Impact: Worker pool can pre-initialize parser at startup, device can override if needed

---------- ADD COLUMN ----------

ALTER TABLE transport_registry 
  ADD COLUMN IF NOT EXISTS transport_parser_id INTEGER REFERENCES transport_parser(id) ON DELETE RESTRICT;

---------- ADD INDEX ----------

CREATE INDEX IF NOT EXISTS idx_transport_registry_parser ON transport_registry(transport_parser_id);

---------- SET DEFAULT ----------

-- Set default to 'chirpstack' for all existing rows (most common case)
UPDATE transport_registry 
SET transport_parser_id = (SELECT id FROM transport_parser WHERE code = 'chirpstack')
WHERE transport_parser_id IS NULL;

-- Make column NOT NULL since it should always have a parser
ALTER TABLE transport_registry 
  ALTER COLUMN transport_parser_id SET NOT NULL;

---------- UPDATE VIEWS ----------

CREATE OR REPLACE VIEW team_available_transports AS
SELECT 
  tr.id,
  tr.name,
  tr.description,
  tr.organization_id,
  tr.team_id,
  tt.code as transport_type_code,
  tt.display_name as transport_type_name,
  tp.code as default_parser_code,
  tp.display_name as default_parser_name,
  tr.config,
  tr.is_global,
  tr.is_active,
  (CASE WHEN tr.is_global THEN 'Global' ELSE 'Team-Specific' END) as scope
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
JOIN transport_parser tp ON tr.transport_parser_id = tp.id
WHERE tr.is_active = true
ORDER BY tr.is_global DESC, tr.name;

---------- COMMENTS ----------

COMMENT ON COLUMN transport_registry.transport_parser_id IS 'Default parser strategy for messages from this transport. Device can override via device_registry.parser_type_id';

---------- DATA MIGRATION GUIDE ----------

-- Worker instantiation pattern (pseudocode):
-- 
-- 1. Fetch all active transports:
--    SELECT tr.id, tr.config, tp.code as parser_code, tt.code as transport_type 
--    FROM transport_registry tr
--    JOIN transport_type tt ON tr.transport_type_id = tt.id
--    JOIN transport_parser tp ON tr.transport_parser_id = tp.id
--    WHERE tr.is_active = true AND tt.code = 'mqtt-subscriber'
--
-- 2. For each transport:
--    - Initialize transport client (mqtt broker connection)
--    - Initialize parser (chirpstack/everynet/default)
--    - Store parser instance in memory
--
-- 3. When message arrives:
--    - Extract device_key from message
--    - Query device_registry for parser override:
--      SELECT COALESCE(dr.parser_type_id, tr.transport_parser_id) as parser_id
--      FROM device_registry dr
--      WHERE dr.device_key = ? 
--      LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id
--    - Use selected parser_id to get parser from registry
--    - Parse message
--

---------- STATUS ----------

-- After this migration:
-- ✅ transport_registry has its own default parser_type_id
-- ✅ Worker can pre-initialize parser at startup
-- ✅ Device can override with device_registry.parser_type_id
-- ✅ Cleaner separation: transport defines parsing strategy
-- ✅ Device model layer receives pre-parsed metadata
