-- Migration 012: Rename parser_type to transport_parser and remove direct_mqtt
-- Date: March 12, 2026
-- Purpose: Clarify naming (parser is associated with transport strategy) and remove unused direct_mqtt

---------- RENAME TABLE ----------

-- PostgreSQL doesn't have direct RENAME TABLE, so we'll recreate
-- Step 1: Create new table with correct schema
CREATE TABLE IF NOT EXISTS transport_parser (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_builtin BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_parser_code CHECK (code ~ '^[a-z0-9_-]+$')
);

-- Step 2: Copy data (excluding direct_mqtt)
INSERT INTO transport_parser (id, code, display_name, description, is_builtin, created_at)
SELECT id, code, display_name, description, is_builtin, created_at 
FROM parser_type
WHERE code != 'direct_mqtt'
ON CONFLICT (code) DO NOTHING;

-- Step 3: Update foreign key references
ALTER TABLE device_registry 
  DROP CONSTRAINT IF EXISTS device_registry_parser_type_id_fkey;

ALTER TABLE device_registry
  ADD CONSTRAINT device_registry_parser_type_id_fkey 
  FOREIGN KEY (parser_type_id) REFERENCES transport_parser(id) ON DELETE SET NULL;

-- Step 4: Update views
CREATE OR REPLACE VIEW available_parsers AS
SELECT 
  id,
  code,
  display_name,
  description,
  is_builtin
FROM transport_parser
WHERE is_builtin = true
ORDER BY display_name;

-- Step 5: Drop old table (after views updated)
DROP TABLE IF EXISTS parser_type CASCADE;

---------- COMMENTS ----------

COMMENT ON TABLE transport_parser IS 'Parser types for device data interpretation: chirpstack, everynet, default (passthrough)';
COMMENT ON COLUMN transport_parser.code IS 'Parser code: chirpstack, everynet, or default';

---------- VERIFICATION ----------

-- Verify data:
-- SELECT 'transport_parser' as table_name, COUNT(*) as rows FROM transport_parser;
-- Result: 3 rows (chirpstack, everynet, default)

-- Verify views:
-- SELECT COUNT(*) FROM available_parsers;
-- Result: 3 parsers
