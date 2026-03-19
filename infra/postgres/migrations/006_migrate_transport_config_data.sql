-- Migration: Migrate existing JSONB configs to typed tables
-- This script handles the data migration from the old 'config' column
-- Date: 2026-03-17

-- ============================================================================
-- Migrate MQTT Configurations
-- ============================================================================

-- Step 1: For each MQTT transport registry entry, create MQTT config record
INSERT INTO transport_mqtt_config (
    transport_type_id,
    host,
    port,
    username,
    password,
    qos,
    clean_session,
    keep_alive_sec,
    connection_timeout_sec,
    use_tls,
    tls_ca_cert,
    tls_client_cert,
    tls_client_key,
    tls_skip_verify,
    topics,
    max_reconnect_interval_sec
)
SELECT
    tr.transport_type_id,
    COALESCE(tr.config->>'host', 'localhost') as host,
    COALESCE((tr.config->>'port')::int, 1883) as port,
    tr.config->>'username' as username,
    tr.config->>'password' as password,
    COALESCE((tr.config->>'qos')::smallint, 1) as qos,
    COALESCE((tr.config->>'clean_session')::boolean, false) as clean_session,
    COALESCE((tr.config->>'keep_alive_sec')::int, 60) as keep_alive_sec,
    COALESCE((tr.config->>'connection_timeout_sec')::int, 10) as connection_timeout_sec,
    COALESCE((tr.config->>'use_tls')::boolean, false) as use_tls,
    tr.config->>'tls_ca_cert' as tls_ca_cert,
    tr.config->>'tls_client_cert' as tls_client_cert,
    tr.config->>'tls_client_key' as tls_client_key,
    COALESCE((tr.config->>'tls_skip_verify')::boolean, false) as tls_skip_verify,
    COALESCE(tr.config->'topics', '[]'::jsonb) as topics,
    COALESCE((tr.config->>'max_reconnect_interval_sec')::int, 10) as max_reconnect_interval_sec
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tt.code = 'mqtt-subscriber'
    AND tr.config IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM transport_mqtt_config tmc
        WHERE tmc.transport_type_id = tr.transport_type_id
    )
ON CONFLICT (transport_type_id) DO NOTHING;

-- Step 2: Link transport_registry to new MQTT configs
UPDATE transport_registry tr
SET transport_mqtt_config_id = tmc.id
FROM transport_mqtt_config tmc
JOIN transport_type tt ON tmc.transport_type_id = tt.id
WHERE tt.code = 'mqtt-subscriber'
    AND tr.transport_type_id = tt.id
    AND tr.transport_mqtt_config_id IS NULL;

-- ============================================================================
-- Migrate HTTP Configurations
-- ============================================================================

INSERT INTO transport_http_config (
    transport_type_id,
    base_url,
    method,
    headers,
    auth_type,
    auth_credentials,
    use_tls,
    tls_ca_cert,
    tls_client_cert,
    tls_client_key,
    tls_skip_verify,
    timeout_sec,
    content_type,
    retry_count,
    retry_delay_sec
)
SELECT
    tr.transport_type_id,
    COALESCE(tr.config->>'base_url', tr.config->>'url', 'http://localhost') as base_url,
    COALESCE(tr.config->>'method', 'POST') as method,
    COALESCE(tr.config->'headers', '{}'::jsonb) as headers,
    COALESCE(tr.config->>'auth_type', 'none') as auth_type,
    tr.config->>'auth_credentials' as auth_credentials,
    COALESCE((tr.config->>'use_tls')::boolean, true) as use_tls,
    tr.config->>'tls_ca_cert' as tls_ca_cert,
    tr.config->>'tls_client_cert' as tls_client_cert,
    tr.config->>'tls_client_key' as tls_client_key,
    COALESCE((tr.config->>'tls_skip_verify')::boolean, false) as tls_skip_verify,
    COALESCE((tr.config->>'timeout_sec')::int, 30) as timeout_sec,
    COALESCE(tr.config->>'content_type', 'application/json') as content_type,
    COALESCE((tr.config->>'retry_count')::int, 3) as retry_count,
    COALESCE((tr.config->>'retry_delay_sec')::int, 5) as retry_delay_sec
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tt.code = 'http-subscriber'
    AND tr.config IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM transport_http_config thc
        WHERE thc.transport_type_id = tr.transport_type_id
    )
ON CONFLICT (transport_type_id) DO NOTHING;

UPDATE transport_registry tr
SET transport_http_config_id = thc.id
FROM transport_http_config thc
JOIN transport_type tt ON thc.transport_type_id = tt.id
WHERE tt.code = 'http-subscriber'
    AND tr.transport_type_id = tt.id
    AND tr.transport_http_config_id IS NULL;

-- ============================================================================
-- Migrate gRPC Configurations
-- ============================================================================

INSERT INTO transport_grpc_config (
    transport_type_id,
    host,
    port,
    service_name,
    use_tls,
    tls_ca_cert,
    tls_client_cert,
    tls_client_key,
    connection_timeout_sec,
    keep_alive_sec,
    keep_alive_timeout_sec,
    max_idle_conns,
    max_connections
)
SELECT
    tr.transport_type_id,
    COALESCE(tr.config->>'host', 'localhost') as host,
    COALESCE((tr.config->>'port')::int, 50051) as port,
    COALESCE(tr.config->>'service_name', 'ingest.IngestService') as service_name,
    COALESCE((tr.config->>'use_tls')::boolean, true) as use_tls,
    tr.config->>'tls_ca_cert' as tls_ca_cert,
    tr.config->>'tls_client_cert' as tls_client_cert,
    tr.config->>'tls_client_key' as tls_client_key,
    COALESCE((tr.config->>'connection_timeout_sec')::int, 10) as connection_timeout_sec,
    COALESCE((tr.config->>'keep_alive_sec')::int, 30) as keep_alive_sec,
    COALESCE((tr.config->>'keep_alive_timeout_sec')::int, 10) as keep_alive_timeout_sec,
    COALESCE((tr.config->>'max_idle_conns')::int, 10) as max_idle_conns,
    COALESCE((tr.config->>'max_connections')::int, 100) as max_connections
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tt.code = 'grpc-subscriber'
    AND tr.config IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM transport_grpc_config tgc
        WHERE tgc.transport_type_id = tr.transport_type_id
    )
ON CONFLICT (transport_type_id) DO NOTHING;

UPDATE transport_registry tr
SET transport_grpc_config_id = tgc.id
FROM transport_grpc_config tgc
JOIN transport_type tt ON tgc.transport_type_id = tt.id
WHERE tt.code = 'grpc-subscriber'
    AND tr.transport_type_id = tt.id
    AND tr.transport_grpc_config_id IS NULL;

-- ============================================================================
-- Verify migration
-- ============================================================================

-- This query shows migration status
SELECT
    tt.code,
    COUNT(*) as total_transports,
    COUNT(CASE WHEN tt.code = 'mqtt-subscriber' AND tr.transport_mqtt_config_id IS NOT NULL THEN 1 END) as mqtt_migrated,
    COUNT(CASE WHEN tt.code = 'http-subscriber' AND tr.transport_http_config_id IS NOT NULL THEN 1 END) as http_migrated,
    COUNT(CASE WHEN tt.code = 'grpc-subscriber' AND tr.transport_grpc_config_id IS NOT NULL THEN 1 END) as grpc_migrated
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tr.is_active = true
GROUP BY tt.code;
