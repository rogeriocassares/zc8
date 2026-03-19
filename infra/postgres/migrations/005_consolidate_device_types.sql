-- ============================================================
-- PostgreSQL Migration 005: Device Types Consolidation
-- ============================================================
-- Purpose: Move protocol from device_types to device_models
-- Consolidate device_types data into device_models
-- Drop unnecessary device_types table
-- ============================================================

BEGIN;

-- ============================================================
-- STEP 1: Add protocol column to device_models
-- ============================================================

ALTER TABLE device_models 
ADD COLUMN protocol VARCHAR(50);

-- Populate protocol from device_types
UPDATE device_models dm
SET protocol = dt.protocol
FROM device_types dt
WHERE dm.device_type_id = dt.id;

-- Make protocol NOT NULL after data migration
ALTER TABLE device_models
ALTER COLUMN protocol SET NOT NULL;

-- ============================================================
-- STEP 2: Remove FK from device_models to device_types
-- ============================================================

ALTER TABLE device_models
DROP CONSTRAINT device_models_device_type_id_fkey;

-- Store device_type_id values separately (we'll keep the column for now)
-- Don't drop the column yet as it might be used elsewhere

-- ============================================================
-- STEP 3: Update device_registry_with_type view
-- ============================================================

DROP VIEW IF EXISTS device_registry_with_type CASCADE;

CREATE VIEW device_registry_with_type AS
SELECT 
    dr.id,
    dr.device_key,
    dr.device_model_id,
    dm.name as device_model_name,
    dm.code as device_model_code,
    dm.device_type_id as device_type_id,
    dm.device_type_id::text as device_type,  -- Use device_type_id value as device_type
    dm.protocol as device_protocol,
    dr.eui,
    dr.mac_address,
    CASE 
        WHEN dm.protocol = 'lora' THEN 'eui'
        ELSE 'mac_address'
    END as identifier_field,
    CASE
        WHEN dm.protocol = 'lora' THEN dr.eui
        ELSE dr.mac_address
    END as device_identifier,
    dr.created_by,
    dr.organization_id,
    dr.team_id,
    dr.lns_provider_id,
    dr.is_public,
    dr.is_active,
    dr.is_global,
    dr.connection_status,
    dr.last_heartbeat,
    dr.metadata,
    dr.created_at,
    dr.updated_at
FROM device_registry dr
JOIN device_models dm ON dr.device_model_id = dm.id;

-- ============================================================
-- STEP 4: Update validate_device_identifier trigger
-- ============================================================

DROP TRIGGER IF EXISTS device_registry_identifier_check ON device_registry CASCADE;
DROP FUNCTION IF EXISTS validate_device_identifier() CASCADE;

CREATE FUNCTION validate_device_identifier() RETURNS TRIGGER AS $$
DECLARE
    v_device_protocol VARCHAR;
BEGIN
    -- Get device protocol from related device_model
    SELECT dm.protocol INTO v_device_protocol
    FROM device_models dm
    WHERE dm.id = NEW.device_model_id;
    
    -- Validate based on device protocol
    IF v_device_protocol = 'lora' THEN
        IF NEW.eui IS NULL THEN
            RAISE EXCEPTION 'LoRaWAN devices must have EUI specified';
        END IF;
        -- Clear MAC for LoRaWAN devices
        NEW.mac_address := NULL;
        
        -- Validate EUI format (should be 16 hex characters)
        IF NEW.eui !~ '^[0-9A-Fa-f]{16}$' THEN
            RAISE EXCEPTION 'EUI must be 16 hexadecimal characters (8 bytes)';
        END IF;
    ELSE
        -- Non-LoRaWAN devices must have MAC address
        IF NEW.mac_address IS NULL THEN
            RAISE EXCEPTION 'Non-LoRaWAN devices must have MAC address specified';
        END IF;
        -- Clear EUI for non-LoRaWAN devices
        NEW.eui := NULL;
        
        -- Validate MAC format (should be 17 characters with colons)
        IF NEW.mac_address !~ '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$' THEN
            RAISE EXCEPTION 'MAC address format must be XX:XX:XX:XX:XX:XX';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_registry_identifier_check
BEFORE INSERT OR UPDATE ON device_registry
FOR EACH ROW EXECUTE FUNCTION validate_device_identifier();

-- ============================================================
-- STEP 5: Drop device_types table (no longer needed)
-- ============================================================

DROP TABLE IF EXISTS device_types CASCADE;

-- ============================================================
-- STEP 6: Update device_models to drop device_type_id FK
-- (keeping the column for now as reference)
-- ============================================================

-- Note: Keeping device_type_id column as a reference/archive column
-- It can be safely dropped later if not needed elsewhere

-- ============================================================
-- VERIFICATION
-- ============================================================

\echo ''
\echo '✅ Device Types Consolidation Complete!'
\echo ''
\echo 'Changes:'
\echo '  - Added protocol column to device_models'
\echo '  - Migrated protocol data from device_types'
\echo '  - Updated device_registry_with_type view'
\echo '  - Updated validate_device_identifier trigger'
\echo '  - Dropped device_types table'
\echo ''
\echo 'device_models now contains:'
SELECT 
    id, name, code, protocol, device_type_id, created_at
FROM device_models
ORDER BY id;

COMMIT;
