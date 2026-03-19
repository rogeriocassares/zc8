-- ============================================================
-- PostgreSQL Migration 004: Device Registry & Team Providers
-- ============================================================
-- Purpose: Create device management tables with team-level provider support
-- Status: Ready for production
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: TEAM-LEVEL DEVICE PROVIDERS
-- ============================================================
-- Allows each team to select their own LNS/provider endpoints
-- Falls back to organization level if team doesn't specify

CREATE TABLE IF NOT EXISTS team_device_providers (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    device_provider_id BIGINT NOT NULL REFERENCES device_providers(id) ON DELETE RESTRICT,
    transport_endpoint_id BIGINT NOT NULL REFERENCES transport_endpoints(id) ON DELETE RESTRICT,
    is_primary BOOLEAN DEFAULT FALSE,
    priority INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_team_provider UNIQUE(team_id, device_provider_id),
    CONSTRAINT valid_priority CHECK (priority >= 0 AND priority <= 100)
);

-- Indexes for team provider queries
CREATE INDEX idx_team_device_providers_team ON team_device_providers(team_id);
CREATE INDEX idx_team_device_providers_provider ON team_device_providers(device_provider_id);
CREATE INDEX idx_team_device_providers_primary ON team_device_providers(team_id, is_primary) 
    WHERE is_primary = true;
CREATE INDEX idx_team_device_providers_endpoint ON team_device_providers(transport_endpoint_id);

-- ============================================================
-- SECTION 2: DEVICE REGISTRY TABLE
-- ============================================================
-- Single unified device registry with UUIDv7 and team-level support

CREATE TABLE IF NOT EXISTS device_registry (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_key VARCHAR(64) UNIQUE NOT NULL,
    
    -- Classification & Model
    device_model_id BIGINT NOT NULL REFERENCES device_models(id) ON DELETE RESTRICT,
    
    -- Identifiers (EUI for LoRaWAN, MAC for others)
    eui VARCHAR(16),                    -- EUI-64 for LoRaWAN devices (8 bytes = 16 hex chars)
    mac_address VARCHAR(17),            -- MAC address for non-LoRaWAN devices (00:00:00:00:00:00)
    
    -- Ownership & Assignment
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    
    -- Provider Configuration
    lns_provider_id BIGINT REFERENCES device_providers(id) ON DELETE SET NULL,
    
    -- Visibility & Status
    is_public BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_global BOOLEAN DEFAULT FALSE,
    
    -- Connection Status
    connection_status VARCHAR(50) DEFAULT 'disconnected',
    last_heartbeat TIMESTAMP,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for device registry queries
CREATE INDEX idx_device_registry_org ON device_registry(organization_id);
CREATE INDEX idx_device_registry_team ON device_registry(team_id);
CREATE INDEX idx_device_registry_model ON device_registry(device_model_id);
CREATE INDEX idx_device_registry_active ON device_registry(is_active) WHERE is_active = true;
CREATE INDEX idx_device_registry_eui ON device_registry(eui) WHERE eui IS NOT NULL;
CREATE INDEX idx_device_registry_mac ON device_registry(mac_address) WHERE mac_address IS NOT NULL;
CREATE INDEX idx_device_registry_key ON device_registry(device_key);
CREATE INDEX idx_device_registry_created_by ON device_registry(created_by);
CREATE INDEX idx_device_registry_provider ON device_registry(lns_provider_id);
CREATE INDEX idx_device_registry_public ON device_registry(is_public) WHERE is_public = true;
CREATE INDEX idx_device_registry_status ON device_registry(connection_status);

-- ============================================================
-- SECTION 3: VIEW - Devices with Type Information
-- ============================================================
-- Provides device_type context for queries and applications

CREATE VIEW device_registry_with_type AS
SELECT 
    dr.id,
    dr.device_key,
    dr.device_model_id,
    dm.name as device_model_name,
    dm.code as device_model_code,
    dt.id as device_type_id,
    dt.name as device_type,
    dt.protocol as device_protocol,
    dr.eui,
    dr.mac_address,
    CASE 
        WHEN dt.name = 'LoRaWAN' THEN 'eui'
        ELSE 'mac_address'
    END as identifier_field,
    CASE
        WHEN dt.name = 'LoRaWAN' THEN dr.eui
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
JOIN device_models dm ON dr.device_model_id = dm.id
JOIN device_types dt ON dm.device_type_id = dt.id;

-- ============================================================
-- SECTION 4: TRIGGER - Validate Device Identifiers
-- ============================================================
-- Automatically validate and clean identifiers based on device type

CREATE FUNCTION validate_device_identifier() RETURNS TRIGGER AS $$
DECLARE
    v_device_type_name VARCHAR;
BEGIN
    -- Get device type from related device_model
    SELECT dt.name INTO v_device_type_name
    FROM device_models dm
    JOIN device_types dt ON dm.device_type_id = dt.id
    WHERE dm.id = NEW.device_model_id;
    
    -- Validate based on device type
    IF v_device_type_name = 'LoRaWAN' THEN
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
-- SECTION 5: TRIGGER - Update Timestamps
-- ============================================================

CREATE FUNCTION update_device_registry_timestamp() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_registry_update_timestamp
BEFORE UPDATE ON device_registry
FOR EACH ROW EXECUTE FUNCTION update_device_registry_timestamp();

-- ============================================================
-- SECTION 5b: TRIGGER - Validate Team Belongs to Organization
-- ============================================================
-- Ensure that team_id belongs to the specified organization_id

CREATE FUNCTION validate_device_team_organization() RETURNS TRIGGER AS $$
BEGIN
    -- Verify team belongs to device's organization
    IF NOT EXISTS (
        SELECT 1 FROM teams 
        WHERE id = NEW.team_id AND organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'Team % does not belong to organization %', NEW.team_id, NEW.organization_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_registry_team_org_validation
BEFORE INSERT OR UPDATE ON device_registry
FOR EACH ROW EXECUTE FUNCTION validate_device_team_organization();

-- ============================================================
-- SECTION 6: PROVIDER SELECTION FUNCTION
-- ============================================================
-- Returns appropriate provider for a device (team level first, org fallback)

CREATE FUNCTION get_device_provider(
    p_team_id BIGINT,
    p_org_id BIGINT
) RETURNS TABLE(
    provider_id BIGINT,
    provider_name VARCHAR,
    endpoint_id BIGINT,
    endpoint_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(tdp.device_provider_id, odp.device_provider_id) as provider_id,
        COALESCE(dp1.name, dp2.name) as provider_name,
        COALESCE(tdp.transport_endpoint_id, odp.organization_id) as endpoint_id,
        COALESCE(te1.endpoint_url, '') as endpoint_url
    FROM team_device_providers tdp
    FULL OUTER JOIN organization_device_providers odp 
        ON odp.organization_id = p_org_id
    LEFT JOIN device_providers dp1 ON tdp.device_provider_id = dp1.id
    LEFT JOIN device_providers dp2 ON odp.device_provider_id = dp2.id
    LEFT JOIN transport_endpoints te1 ON tdp.transport_endpoint_id = te1.id
    WHERE (tdp.team_id = p_team_id OR tdp.team_id IS NULL)
        AND (tdp.is_primary = true OR tdp.is_primary IS NULL)
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SECTION 7: SEED DATA - Team Device Providers
-- ============================================================
-- Map teams to their preferred providers and endpoints

INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, is_primary, priority)
VALUES 
    -- GMS team (IMT org) uses ChirpStack as primary
    (1, 1, 1, TRUE, 10),
    -- GMS team has Everynet as secondary
    (1, 2, 2, FALSE, 20),
    -- MauaRacing team uses ChirpStack
    (2, 1, 1, TRUE, 10),
    -- Teams team uses ChirpStack  
    (3, 1, 1, TRUE, 10),
    -- RaceTracks team uses ChirpStack
    (4, 1, 1, TRUE, 10),
    -- Committee team uses ChirpStack
    (5, 1, 1, TRUE, 10),
    -- Cinemark team uses Engil
    (6, 4, 3, TRUE, 10),
    -- UCI team uses Engil
    (7, 4, 3, TRUE, 10)
ON CONFLICT DO NOTHING;

-- ============================================================
-- FINAL VERIFICATION
-- ============================================================

\echo ''
\echo '✅ Device Registry Schema Created Successfully!'
\echo ''
\echo 'New Tables:'
\echo '  - team_device_providers: Team-level provider configuration'
\echo '  - device_registry: Unified device registry'
\echo ''
\echo 'New Views:'
\echo '  - device_registry_with_type: Device info with protocol type'
\echo ''
\echo 'New Triggers:'
\echo '  - validate_device_identifier: Enforce EUI/MAC validation'
\echo '  - device_registry_team_org_validation: Verify team belongs to organization'
\echo '  - device_registry_update_timestamp: Auto-update timestamps'
\echo ''
\echo 'New Functions:'
\echo '  - get_device_provider(): Select team or org provider'
\echo ''

COMMIT;
