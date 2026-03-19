-- Migration: Introduce transport_config intermediate table for polymorphic foreign keys
-- This replaces 3 nullable FK columns with a single, type-safe config reference
-- Date: 2026-03-17

-- ============================================================================
-- Create transport_config intermediate table
-- ============================================================================

CREATE TABLE IF NOT EXISTS transport_config (
    id BIGSERIAL PRIMARY KEY,
    transport_type_id BIGINT NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
    
    -- Config type enum: determines which specific config table to reference
    config_type VARCHAR(20) NOT NULL CHECK (config_type IN ('mqtt', 'http', 'grpc')),
    
    -- Type-specific config references (only ONE should be non-null per CHECK constraint)
    mqtt_config_id BIGINT REFERENCES transport_mqtt_config(id) ON DELETE RESTRICT,
    http_config_id BIGINT REFERENCES transport_http_config(id) ON DELETE RESTRICT,
    grpc_config_id BIGINT REFERENCES transport_grpc_config(id) ON DELETE RESTRICT,
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraint: exactly one config must be set and match config_type
    CONSTRAINT config_type_matches_config_id CHECK (
        (config_type = 'mqtt' AND mqtt_config_id IS NOT NULL AND http_config_id IS NULL AND grpc_config_id IS NULL)
        OR (config_type = 'http' AND http_config_id IS NOT NULL AND mqtt_config_id IS NULL AND grpc_config_id IS NULL)
        OR (config_type = 'grpc' AND grpc_config_id IS NOT NULL AND mqtt_config_id IS NULL AND http_config_id IS NULL)
    )
);

CREATE INDEX idx_transport_config_type_id ON transport_config(transport_type_id);
CREATE INDEX idx_transport_config_mqtt ON transport_config(mqtt_config_id) WHERE config_type = 'mqtt';
CREATE INDEX idx_transport_config_http ON transport_config(http_config_id) WHERE config_type = 'http';
CREATE INDEX idx_transport_config_grpc ON transport_config(grpc_config_id) WHERE config_type = 'grpc';

-- ============================================================================
-- Migrate data from existing transport_registry to transport_config
-- ============================================================================

-- For each transport_type, create the corresponding transport_config entry
-- based on which config table currently has data linked

INSERT INTO transport_config (
    transport_type_id,
    config_type,
    mqtt_config_id,
    http_config_id,
    grpc_config_id
)
SELECT
    tr.transport_type_id,
    CASE
        WHEN tr.transport_mqtt_config_id IS NOT NULL THEN 'mqtt'
        WHEN tr.transport_http_config_id IS NOT NULL THEN 'http'
        WHEN tr.transport_grpc_config_id IS NOT NULL THEN 'grpc'
        ELSE 'mqtt'  -- Default to mqtt if none specified (should not happen in practice)
    END as config_type,
    tr.transport_mqtt_config_id,
    tr.transport_http_config_id,
    tr.transport_grpc_config_id
FROM transport_registry tr
WHERE NOT EXISTS (
    SELECT 1 FROM transport_config tc
    WHERE tc.transport_type_id = tr.transport_type_id
)
GROUP BY tr.transport_type_id, tr.transport_mqtt_config_id, tr.transport_http_config_id, tr.transport_grpc_config_id;

-- ============================================================================
-- Update transport_registry to reference transport_config
-- ============================================================================

-- Add the new transport_config_id column
ALTER TABLE transport_registry
ADD COLUMN transport_config_id BIGINT UNIQUE REFERENCES transport_config(id) ON DELETE RESTRICT;

-- Populate transport_config_id from existing configs
UPDATE transport_registry tr
SET transport_config_id = tc.id
FROM transport_config tc
WHERE tr.transport_type_id = tc.transport_type_id;

-- Make transport_config_id NOT NULL after data migration
ALTER TABLE transport_registry
ALTER COLUMN transport_config_id SET NOT NULL;

-- Drop the old nullable FK columns
ALTER TABLE transport_registry
DROP COLUMN transport_mqtt_config_id,
DROP COLUMN transport_http_config_id,
DROP COLUMN transport_grpc_config_id;

-- ============================================================================
-- Verification
-- ============================================================================

-- Show the migration results
SELECT
    tr.id,
    tr.name,
    tt.code as transport_type,
    tc.config_type,
    CASE
        WHEN tc.config_type = 'mqtt' THEN tmc.host || ':' || tmc.port::text
        WHEN tc.config_type = 'http' THEN hc.base_url
        WHEN tc.config_type = 'grpc' THEN gc.host || ':' || gc.port::text
    END as endpoint
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
JOIN transport_config tc ON tr.transport_config_id = tc.id
LEFT JOIN transport_mqtt_config tmc ON tc.mqtt_config_id = tmc.id
LEFT JOIN transport_http_config hc ON tc.http_config_id = hc.id
LEFT JOIN transport_grpc_config gc ON tc.grpc_config_id = gc.id
ORDER BY tr.id;
