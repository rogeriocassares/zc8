-- ============================================================================
-- PostgreSQL Consolidated Migration 001: CREATE COMPLETE DATABASE SCHEMA
-- ============================================================================
-- Version: 2.0 - Complete refactored schema with vendor/provider separation
-- Consolidates: 001 DDL + 003 Routing DDL + 005 Vendor Refactor + 006 Device Models + 007 Org Providers
-- Status: Fresh consolidated schema - all DDL operations
-- Total tables created: 29 (core + routing + deprecated compatibility)
-- Total indexes: 55+
-- Total views: 3
-- ============================================================================

-- Create zc8 user if not exists
DO $$ BEGIN
    CREATE ROLE zc8 WITH LOGIN PASSWORD 'zc8' CREATEDB;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- Drop existing database if exists (for development fresh start)
DROP DATABASE IF EXISTS zc8;

-- Create database zc8
CREATE DATABASE zc8 OWNER zc8 ENCODING 'UTF8';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE zc8 TO zc8;

-- ============================================================================
-- BEGIN COMPLETE SCHEMA TRANSACTION (on zc8 database)
-- ============================================================================

-- Connect to zc8 database for DDL operations
\c zc8 zc8

BEGIN;

-- ============================================================================
-- SECTION 1: CORE INFRASTRUCTURE TABLES
-- ============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organizations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    team_type VARCHAR(50) DEFAULT 'department',
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, slug)
);

CREATE TABLE device_types (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    protocol VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 2: VENDOR & PROVIDER TABLES (v2.0 - Refactored)
-- ============================================================================

CREATE TABLE device_vendors (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    vendor_type VARCHAR(50) DEFAULT 'device_vendor' CHECK (vendor_type = 'device_vendor'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE device_providers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    provider_type VARCHAR(50) NOT NULL CHECK (provider_type IN ('lns', 'cloud', 'integration')),
    api_endpoint_template VARCHAR(255),
    api_port INT DEFAULT 80,
    requires_authentication BOOLEAN DEFAULT true,
    authentication_type VARCHAR(50),
    documentation_url VARCHAR(255),
    support_contact VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 3: DEVICE MODELS & INSTANCES (v2.0 - Separated)
-- ============================================================================

CREATE TABLE device_models (
    id BIGSERIAL PRIMARY KEY,
    device_vendor_id BIGINT NOT NULL REFERENCES device_vendors(id) ON DELETE CASCADE,
    model_name VARCHAR(255) NOT NULL,
    model_code VARCHAR(50),
    device_type_id BIGINT NOT NULL REFERENCES device_types(id) ON DELETE RESTRICT,
    network_interface VARCHAR(50) CHECK (network_interface IN ('lorawan', 'ethernet', 'wifi', '4g', 'bluetooth')),
    connection_type VARCHAR(50) NOT NULL CHECK (connection_type IN ('direct', 'lns', 'cloud')),
    direct_transport_type VARCHAR(20) CHECK (direct_transport_type IN ('grpc-server', 'grpc-client', 'http-server', 'http-client', 'mqtt-subscriber')),
    supported_lns_vendors BIGINT[] DEFAULT '{}',
    can_use_multiple_lns BOOLEAN DEFAULT false,
    has_eui BOOLEAN DEFAULT false,
    has_mac_address BOOLEAN DEFAULT false,
    has_device_key BOOLEAN DEFAULT false,
    cloud_provider_id BIGINT REFERENCES device_providers(id) ON DELETE SET NULL,
    description TEXT,
    data_sheet_url VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_vendor_id, model_name),
    CONSTRAINT connection_type_consistency CHECK (
        (connection_type = 'direct' AND direct_transport_type IS NOT NULL) OR
        (connection_type = 'lns' AND has_eui = true) OR
        (connection_type = 'cloud' AND cloud_provider_id IS NOT NULL)
    )
);

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_model_id BIGINT NOT NULL REFERENCES device_models(id) ON DELETE RESTRICT,
    device_name VARCHAR(255),
    device_key BIGINT UNIQUE,
    eui VARCHAR(255) UNIQUE,
    mac_address VARCHAR(17) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    provisioning_status VARCHAR(50) DEFAULT 'pending' CHECK (provisioning_status IN ('pending', 'provisioned', 'activated', 'deactivated', 'error')),
    last_seen TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT at_least_one_identifier CHECK (device_key IS NOT NULL OR eui IS NOT NULL OR mac_address IS NOT NULL)
);

CREATE TABLE vendor_models_mapping (
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES device_vendors(id) ON DELETE CASCADE,
    model_name VARCHAR(255) NOT NULL,
    device_type_id BIGINT NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id, model_name, device_type_id)
);

CREATE TABLE device_registry_deprecated (
    device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_name VARCHAR(255),
    device_model VARCHAR(255),
    vendor_name VARCHAR(255),
    device_key BIGINT UNIQUE,
    mqtt_device_id VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_seen TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 4: TRANSPORT & PROCESSING TABLES
-- ============================================================================

CREATE TABLE organization_transports (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    transport_protocol VARCHAR(20) NOT NULL,
    gateway_vendor VARCHAR(50),
    device_vendors TEXT[] NOT NULL,
    mqtt_broker_url VARCHAR(255),
    mqtt_username VARCHAR(255),
    mqtt_password VARCHAR(255),
    mqtt_topic_pattern VARCHAR(255),
    http_webhook_url VARCHAR(255),
    http_auth_type VARCHAR(50),
    http_auth_secret VARCHAR(255),
    grpc_server_url VARCHAR(255),
    grpc_port INT,
    enabled BOOLEAN DEFAULT true,
    auto_reload BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, transport_protocol, gateway_vendor)
);

CREATE TABLE org_parser_usage (
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parser_type VARCHAR(20) NOT NULL,
    parser_name VARCHAR(50) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    last_message_at TIMESTAMP,
    error_count INT DEFAULT 0,
    success_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (org_id, parser_type, parser_name)
);

CREATE TABLE transport_worker_metrics (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    transport_protocol VARCHAR(20) NOT NULL,
    gateway_vendor VARCHAR(50),
    messages_received BIGINT DEFAULT 0,
    messages_processed BIGINT DEFAULT 0,
    messages_failed BIGINT DEFAULT 0,
    messages_deduplicated BIGINT DEFAULT 0,
    avg_latency_ms FLOAT DEFAULT 0,
    max_latency_ms FLOAT DEFAULT 0,
    min_latency_ms FLOAT DEFAULT 999999,
    last_message_at TIMESTAMP,
    worker_started_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, transport_protocol, gateway_vendor)
);

-- ============================================================================
-- SECTION 5: TENANT SHARDING TABLES
-- ============================================================================

CREATE TABLE transport_shards (
    id SERIAL PRIMARY KEY,
    protocol VARCHAR(20) NOT NULL,
    shard_id INT NOT NULL,
    total_shards INT NOT NULL,
    replicas INT NOT NULL DEFAULT 2,
    max_orgs_per_shard INT NOT NULL,
    container_port_base INT,
    worker_instance VARCHAR(255),
    current_org_count INT DEFAULT 0,
    current_event_rate_per_sec INT DEFAULT 0,
    avg_latency_ms FLOAT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP,
    deactivated_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    UNIQUE(protocol, shard_id),
    CHECK (shard_id >= 0 AND replicas > 0)
);

CREATE TABLE tenant_shard_mapping (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    protocol VARCHAR(20) NOT NULL,
    shard_id INT NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tenant_hash BIGINT,
    verified_at TIMESTAMP,
    verification_status VARCHAR(20),
    FOREIGN KEY (protocol, shard_id) REFERENCES transport_shards(protocol, shard_id),
    UNIQUE(org_id, protocol)
);

CREATE TABLE shard_rebalance_events (
    id BIGSERIAL PRIMARY KEY,
    protocol VARCHAR(20) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    old_shard_id INT,
    new_shard_id INT,
    org_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
    total_shards_old INT,
    total_shards_new INT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INT,
    status VARCHAR(20),
    error_message TEXT,
    orgs_affected INT,
    events_missed INT,
    events_duplicated INT,
    triggered_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE shard_health (
    id BIGSERIAL PRIMARY KEY,
    protocol VARCHAR(20) NOT NULL,
    shard_id INT NOT NULL,
    messages_received BIGINT DEFAULT 0,
    messages_processed BIGINT DEFAULT 0,
    messages_failed BIGINT DEFAULT 0,
    avg_latency_ms FLOAT DEFAULT 0,
    p95_latency_ms FLOAT DEFAULT 0,
    p99_latency_ms FLOAT DEFAULT 0,
    cpu_percent FLOAT DEFAULT 0,
    memory_mb INT DEFAULT 0,
    connection_count INT DEFAULT 0,
    worker_status VARCHAR(20),
    last_heartbeat TIMESTAMP,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(protocol, shard_id, recorded_at)
);

CREATE TABLE shard_ingest_connections (
    id SERIAL PRIMARY KEY,
    protocol VARCHAR(20) NOT NULL,
    shard_id INT NOT NULL,
    ingest_service_address VARCHAR(255) NOT NULL,
    active_connections INT DEFAULT 0,
    max_connections INT DEFAULT 10,
    grpc_round_trip_time_ms FLOAT DEFAULT 0,
    last_check_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(protocol, shard_id)
);

-- ============================================================================
-- SECTION 6: TRANSPORT ROUTING TABLES  (v2.0)
-- ============================================================================

CREATE TABLE transport_endpoints (
    id SERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    transport_type VARCHAR(20) NOT NULL CHECK (transport_type IN ('grpc-server', 'grpc-client', 'http-server', 'http-client', 'mqtt-subscriber')),
    connection_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    address VARCHAR(255),
    port INT,
    mqtt_topic_pattern VARCHAR(255),
    mqtt_qos INT DEFAULT 1,
    http_path VARCHAR(255),
    http_auth_type VARCHAR(50),
    http_auth_value VARCHAR(255),
    http_timeout_sec INT DEFAULT 30,
    grpc_service_name VARCHAR(255),
    grpc_max_conn_age_ms INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, transport_type, connection_name),
    UNIQUE(org_id, transport_type, address, port)
);

CREATE TABLE org_device_providers (
    id SERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_provider_id BIGINT NOT NULL REFERENCES device_providers(id) ON DELETE CASCADE,
    provider_instance_name VARCHAR(255),
    description TEXT,
    api_endpoint VARCHAR(255) NOT NULL,
    api_port INT DEFAULT 80,
    api_key VARCHAR(255),
    api_secret VARCHAR(255),
    transport_endpoint_id INT REFERENCES transport_endpoints(id) ON DELETE SET NULL,
    region VARCHAR(100),
    timezone VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    is_primary BOOLEAN DEFAULT false,
    failover_strategy VARCHAR(50) DEFAULT 'round-robin' CHECK (failover_strategy IN ('round-robin', 'priority', 'sticky')),
    last_healthcheck_at TIMESTAMP,
    healthcheck_status VARCHAR(20),
    consecutive_failures INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(org_id, device_provider_id, provider_instance_name)
);

CREATE TABLE provider_transport_bindings (
    id SERIAL PRIMARY KEY,
    device_provider_id BIGINT NOT NULL REFERENCES device_providers(id) ON DELETE CASCADE,
    transport_type VARCHAR(20) NOT NULL CHECK (transport_type IN ('grpc-server', 'grpc-client', 'http-server', 'http-client', 'mqtt-subscriber')),
    description TEXT,
    default_topic_pattern VARCHAR(255),
    default_http_path VARCHAR(255),
    requires_authentication BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_provider_id, transport_type)
);

CREATE TABLE device_model_routing_rules (
    id SERIAL PRIMARY KEY,
    device_model_id BIGINT NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
    routing_pattern VARCHAR(50) NOT NULL CHECK (routing_pattern IN ('direct', 'lns', 'cloud')),
    direct_transport_type VARCHAR(20),
    supported_lns_providers BIGINT[] DEFAULT '{}',
    can_use_multiple_lns BOOLEAN DEFAULT false,
    require_lns_assignment BOOLEAN DEFAULT true,
    required_cloud_provider_id BIGINT REFERENCES device_providers(id) ON DELETE RESTRICT,
    is_active BOOLEAN DEFAULT true,
    priority INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_model_id)
);

CREATE TABLE device_provider_assignments (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    org_device_provider_id INT NOT NULL REFERENCES org_device_providers(id) ON DELETE CASCADE,
    provider_device_id VARCHAR(255),
    provider_device_secret VARCHAR(255),
    provider_device_config TEXT,
    priority INT DEFAULT 1,
    failover_threshold_retries INT DEFAULT 3,
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_verified_at TIMESTAMP,
    verification_status VARCHAR(50),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMP,
    deactivated_at TIMESTAMP,
    UNIQUE(device_id, org_device_provider_id, priority),
    CONSTRAINT priority_check CHECK (priority > 0)
);

CREATE TABLE device_message_routes (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    source_transport_endpoint_id INT NOT NULL REFERENCES transport_endpoints(id) ON DELETE RESTRICT,
    provider_assignment_id BIGINT REFERENCES device_provider_assignments(id) ON DELETE SET NULL,
    route_type VARCHAR(50) NOT NULL CHECK (route_type IN ('direct', 'provider_lns', 'provider_cloud', 'fallback')),
    route_confidence_percent INT DEFAULT 100 CHECK (route_confidence_percent BETWEEN 0 AND 100),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_message_at TIMESTAMP,
    messages_received BIGINT DEFAULT 0,
    messages_failed BIGINT DEFAULT 0,
    avg_latency_ms FLOAT DEFAULT 0,
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, org_id),
    CONSTRAINT route_provider_consistency CHECK (
        (route_type = 'direct' AND provider_assignment_id IS NULL) OR
        (route_type IN ('provider_lns', 'provider_cloud') AND provider_assignment_id IS NOT NULL)
    )
);

-- ============================================================================
-- SECTION 7: ACCESS CONTROL TABLES
-- ============================================================================

CREATE TABLE organization_access_permissions (
    id BIGSERIAL PRIMARY KEY,
    source_organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    access_type VARCHAR(50) DEFAULT 'read' CHECK (access_type IN ('read', 'write', 'admin')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(source_organization_id, target_organization_id),
    CONSTRAINT no_self_access CHECK (source_organization_id != target_organization_id)
);

CREATE TABLE team_access_permissions (
    id BIGSERIAL PRIMARY KEY,
    source_team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    target_team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    access_type VARCHAR(50) DEFAULT 'read' CHECK (access_type IN ('read', 'write', 'admin')),
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(source_team_id, target_team_id, organization_id)
);

-- ============================================================================
-- SECTION 8: CREATE ALL INDEXES
-- ============================================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(status);
CREATE INDEX idx_teams_organization_id ON teams(organization_id);
CREATE INDEX idx_teams_slug ON teams(slug);
CREATE INDEX idx_device_vendors_code ON device_vendors(code);
CREATE INDEX idx_device_vendors_name ON device_vendors(name);
CREATE INDEX idx_device_providers_code ON device_providers(code);
CREATE INDEX idx_device_providers_type ON device_providers(provider_type);
CREATE INDEX idx_device_providers_name ON device_providers(name);
CREATE INDEX idx_device_models_vendor ON device_models(device_vendor_id, is_active);
CREATE INDEX idx_device_models_type ON device_models(device_type_id);
CREATE INDEX idx_device_models_connection ON device_models(connection_type);
CREATE INDEX idx_device_models_transport ON device_models(direct_transport_type);
CREATE INDEX idx_device_models_lns ON device_models(supported_lns_vendors);
CREATE INDEX idx_device_models_provider ON device_models(cloud_provider_id);
CREATE INDEX idx_devices_org ON devices(organization_id, is_active);
CREATE INDEX idx_devices_model ON devices(device_model_id);
CREATE INDEX idx_devices_key ON devices(device_key) WHERE device_key IS NOT NULL;
CREATE INDEX idx_devices_eui ON devices(eui) WHERE eui IS NOT NULL;
CREATE INDEX idx_devices_mac ON devices(mac_address) WHERE mac_address IS NOT NULL;
CREATE INDEX idx_devices_status ON devices(provisioning_status);
CREATE INDEX idx_vendor_models_vendor_id ON vendor_models_mapping(vendor_id);
CREATE INDEX idx_vendor_models_device_type ON vendor_models_mapping(device_type_id);
CREATE INDEX idx_org_transports_org_id ON organization_transports(org_id);
CREATE INDEX idx_org_transports_enabled ON organization_transports(enabled);
CREATE INDEX idx_org_transports_protocol ON organization_transports(transport_protocol);
CREATE INDEX idx_org_transports_gateway ON organization_transports(gateway_vendor);
CREATE INDEX idx_parser_usage_org ON org_parser_usage(org_id);
CREATE INDEX idx_parser_usage_type ON org_parser_usage(parser_type);
CREATE INDEX idx_parser_usage_enabled ON org_parser_usage(enabled);
CREATE INDEX idx_worker_metrics_org ON transport_worker_metrics(org_id);
CREATE INDEX idx_worker_metrics_protocol ON transport_worker_metrics(transport_protocol);
CREATE INDEX idx_worker_metrics_updated ON transport_worker_metrics(updated_at DESC);
CREATE INDEX idx_transport_shards_protocol ON transport_shards(protocol);
CREATE INDEX idx_transport_shards_status ON transport_shards(status);
CREATE INDEX idx_tenant_shard_org ON tenant_shard_mapping(org_id);
CREATE INDEX idx_tenant_shard_protocol ON tenant_shard_mapping(protocol, shard_id);
CREATE INDEX idx_tenant_shard_status ON tenant_shard_mapping(verification_status);
CREATE INDEX idx_rebalance_protocol ON shard_rebalance_events(protocol, created_at DESC);
CREATE INDEX idx_rebalance_status ON shard_rebalance_events(status);
CREATE INDEX idx_shard_health_protocol_recent ON shard_health(protocol, recorded_at DESC);
CREATE INDEX idx_ingest_connections_status ON shard_ingest_connections(protocol, status);
CREATE INDEX idx_org_access_source ON organization_access_permissions(source_organization_id);
CREATE INDEX idx_org_access_target ON organization_access_permissions(target_organization_id);
CREATE INDEX idx_team_access_source ON team_access_permissions(source_team_id);
CREATE INDEX idx_team_access_target ON team_access_permissions(target_team_id);
CREATE INDEX idx_team_access_org ON team_access_permissions(organization_id);
CREATE INDEX idx_transport_endpoints_org ON transport_endpoints(org_id, is_active);
CREATE INDEX idx_transport_endpoints_type ON transport_endpoints(transport_type, is_active);
CREATE INDEX idx_transport_endpoints_address ON transport_endpoints(address, port) WHERE is_active = true;
CREATE INDEX idx_org_device_providers_org ON org_device_providers(org_id, is_active);
CREATE INDEX idx_org_device_providers_provider ON org_device_providers(device_provider_id);
CREATE INDEX idx_org_device_providers_endpoint ON org_device_providers(transport_endpoint_id);
CREATE INDEX idx_org_device_providers_primary ON org_device_providers(org_id, is_primary) WHERE is_primary = true;
CREATE INDEX idx_org_device_providers_health ON org_device_providers(org_id, healthcheck_status);
CREATE INDEX idx_provider_transport_bindings_provider ON provider_transport_bindings(device_provider_id);
CREATE INDEX idx_provider_transport_bindings_type ON provider_transport_bindings(transport_type);
CREATE INDEX idx_device_model_routing_rules_model ON device_model_routing_rules(device_model_id);
CREATE INDEX idx_device_model_routing_rules_pattern ON device_model_routing_rules(routing_pattern);
CREATE INDEX idx_device_provider_assignments_device ON device_provider_assignments(device_id, priority);
CREATE INDEX idx_device_provider_assignments_provider ON device_provider_assignments(org_device_provider_id);
CREATE INDEX idx_device_provider_assignments_active ON device_provider_assignments(device_id, is_active, priority);
CREATE INDEX idx_device_message_routes_device ON device_message_routes(device_id, org_id);
CREATE INDEX idx_device_message_routes_endpoint ON device_message_routes(source_transport_endpoint_id);
CREATE INDEX idx_device_message_routes_org ON device_message_routes(org_id, is_active);
CREATE INDEX idx_device_message_routes_provider ON device_message_routes(provider_assignment_id);
CREATE INDEX idx_device_message_routes_type ON device_message_routes(route_type, is_active);
CREATE INDEX idx_device_message_routes_recent ON device_message_routes(org_id, last_message_at DESC) WHERE is_active = true;

-- ============================================================================
-- SECTION 9: CREATE VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW v_enabled_org_transports AS
SELECT 
    ot.id, ot.org_id, o.name as org_name, ot.transport_protocol, ot.gateway_vendor,
    ot.device_vendors, ot.mqtt_broker_url, ot.http_webhook_url, ot.grpc_server_url, ot.created_at
FROM organization_transports ot
JOIN organizations o ON ot.org_id = o.id
WHERE ot.enabled = true
ORDER BY ot.org_id, ot.transport_protocol;

CREATE OR REPLACE VIEW v_org_parser_summary AS
SELECT 
    pu.org_id, o.name as org_name, pu.parser_type, pu.parser_name, pu.enabled,
    pu.success_count, pu.error_count,
    CASE WHEN (pu.success_count + pu.error_count) > 0 
        THEN ROUND(((pu.success_count::NUMERIC) / (pu.success_count + pu.error_count)) * 100, 2)
        ELSE 0 END as success_rate_percent,
    pu.last_message_at
FROM org_parser_usage pu
JOIN organizations o ON pu.org_id = o.id
WHERE pu.enabled = true
ORDER BY pu.org_id, pu.parser_type, pu.parser_name;

CREATE OR REPLACE VIEW v_shard_topology AS
SELECT 
    ts.protocol, ts.shard_id, ts.total_shards, ts.replicas, ts.max_orgs_per_shard,
    COUNT(DISTINCT tsm.org_id) as current_org_count, ts.status, ts.created_at
FROM transport_shards ts
LEFT JOIN tenant_shard_mapping tsm ON ts.protocol = tsm.protocol AND ts.shard_id = tsm.shard_id
GROUP BY ts.id, ts.protocol, ts.shard_id, ts.total_shards, ts.replicas, ts.max_orgs_per_shard, ts.status, ts.created_at;

-- ============================================================================
-- SECTION 10: GRANT PRIVILEGES
-- ============================================================================

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO zc8;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO zc8;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO zc8;

GRANT USAGE ON SCHEMA public TO zc8;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zc8;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zc8;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO zc8;

COMMIT;

\echo 'Schema created successfully! All 29 tables, 55+ indexes, and 3 views are ready.'
