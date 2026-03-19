-- Migration: Create transport-specific connection configuration tables
-- This replaces the JSONB config column with typed, schema-validated tables
-- Date: 2026-03-17

-- ============================================================================
-- MQTT Transport Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_mqtt_config (
    id BIGSERIAL PRIMARY KEY,
    transport_type_id BIGINT NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
    
    -- Connection parameters
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL CHECK (port > 0 AND port < 65536),
    
    -- Authentication (optional)
    username VARCHAR(255),
    password VARCHAR(255),
    
    -- MQTT-specific settings
    qos SMALLINT NOT NULL DEFAULT 1 CHECK (qos IN (0, 1, 2)),
    clean_session BOOLEAN NOT NULL DEFAULT false,
    keep_alive_sec INT NOT NULL DEFAULT 60 CHECK (keep_alive_sec > 0),
    connection_timeout_sec INT NOT NULL DEFAULT 10 CHECK (connection_timeout_sec > 0),
    
    -- TLS/SSL support
    use_tls BOOLEAN NOT NULL DEFAULT false,
    tls_ca_cert TEXT,
    tls_client_cert TEXT,
    tls_client_key TEXT,
    tls_skip_verify BOOLEAN NOT NULL DEFAULT false,
    
    -- Topics as JSONB for flexibility (e.g., ["applications/+/devices/+/up", "devices/+/telemetry"])
    topics JSONB NOT NULL DEFAULT '[]'::JSONB,
    
    -- Connection pool settings
    max_reconnect_interval_sec INT NOT NULL DEFAULT 10 CHECK (max_reconnect_interval_sec > 0),
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT mqtt_config_valid_qos CHECK (qos >= 0 AND qos <= 2)
);

CREATE INDEX idx_transport_mqtt_config_type_id ON transport_mqtt_config(transport_type_id);

-- ============================================================================
-- HTTP/REST Transport Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_http_config (
    id BIGSERIAL PRIMARY KEY,
    transport_type_id BIGINT NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
    
    -- Connection parameters
    base_url VARCHAR(2048) NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'POST' CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
    
    -- HTTP headers as JSONB
    headers JSONB NOT NULL DEFAULT '{}'::JSONB,
    
    -- Authentication type: none, basic, bearer, api-key, custom
    auth_type VARCHAR(50) NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'basic', 'bearer', 'api-key', 'custom')),
    auth_credentials VARCHAR(1024),  -- For basic/bearer/api-key
    
    -- TLS/SSL support
    use_tls BOOLEAN NOT NULL DEFAULT true,
    tls_ca_cert TEXT,
    tls_client_cert TEXT,
    tls_client_key TEXT,
    tls_skip_verify BOOLEAN NOT NULL DEFAULT false,
    
    -- Request/Response configuration
    timeout_sec INT NOT NULL DEFAULT 30 CHECK (timeout_sec > 0),
    content_type VARCHAR(100) NOT NULL DEFAULT 'application/json',
    retry_count INT NOT NULL DEFAULT 3 CHECK (retry_count >= 0),
    retry_delay_sec INT NOT NULL DEFAULT 5 CHECK (retry_delay_sec > 0),
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transport_http_config_type_id ON transport_http_config(transport_type_id);

-- ============================================================================
-- gRPC Transport Configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS transport_grpc_config (
    id BIGSERIAL PRIMARY KEY,
    transport_type_id BIGINT NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
    
    -- Connection parameters
    host VARCHAR(255) NOT NULL,
    port INT NOT NULL CHECK (port > 0 AND port < 65536),
    
    -- gRPC service configuration
    service_name VARCHAR(255) NOT NULL,  -- e.g., "ingest.IngestService"
    
    -- TLS/SSL support (gRPC typically uses TLS)
    use_tls BOOLEAN NOT NULL DEFAULT true,
    tls_ca_cert TEXT,
    tls_client_cert TEXT,
    tls_client_key TEXT,
    
    -- Connection timeout and keepalive
    connection_timeout_sec INT NOT NULL DEFAULT 10 CHECK (connection_timeout_sec > 0),
    keep_alive_sec INT NOT NULL DEFAULT 30 CHECK (keep_alive_sec > 0),
    keep_alive_timeout_sec INT NOT NULL DEFAULT 10 CHECK (keep_alive_timeout_sec > 0),
    
    -- Connection pool
    max_idle_conns INT NOT NULL DEFAULT 10 CHECK (max_idle_conns > 0),
    max_connections INT NOT NULL DEFAULT 100 CHECK (max_connections > 0),
    
    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transport_grpc_config_type_id ON transport_grpc_config(transport_type_id);

-- ============================================================================
-- Update transport_registry to reference new config tables
-- ============================================================================

-- Add new nullable config_id columns (one per transport type)
ALTER TABLE transport_registry 
ADD COLUMN transport_mqtt_config_id BIGINT REFERENCES transport_mqtt_config(id) ON DELETE SET NULL,
ADD COLUMN transport_http_config_id BIGINT REFERENCES transport_http_config(id) ON DELETE SET NULL,
ADD COLUMN transport_grpc_config_id BIGINT REFERENCES transport_grpc_config(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX idx_transport_registry_mqtt_config ON transport_registry(transport_mqtt_config_id);
CREATE INDEX idx_transport_registry_http_config ON transport_registry(transport_http_config_id);
CREATE INDEX idx_transport_registry_grpc_config ON transport_registry(transport_grpc_config_id);

-- ============================================================================
-- Add function to get the appropriate config based on transport type
-- ============================================================================
CREATE OR REPLACE FUNCTION get_transport_config(p_transport_registry_id BIGINT)
RETURNS TABLE (
    config_type VARCHAR,
    mqtt_config JSON,
    http_config JSON,
    grpc_config JSON
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tt.code,
        row_to_json(tmc.*),
        row_to_json(thc.*),
        row_to_json(tgc.*)
    FROM transport_registry tr
    JOIN transport_type tt ON tr.transport_type_id = tt.id
    LEFT JOIN transport_mqtt_config tmc ON tr.transport_mqtt_config_id = tmc.id
    LEFT JOIN transport_http_config thc ON tr.transport_http_config_id = thc.id
    LEFT JOIN transport_grpc_config tgc ON tr.transport_grpc_config_id = tgc.id
    WHERE tr.id = p_transport_registry_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Note: The 'config' JSONB column in transport_registry can be kept for now
-- for backward compatibility, but should be deprecated. Migration of existing
-- data should happen separately via application code, ensuring proper validation.
-- ============================================================================
