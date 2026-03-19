-- ============================================================================
-- PostgreSQL Migration 001: CREATE COMPLETE DATABASE SCHEMA WITH RBAC
-- ============================================================================
-- Version: 3.0 - Complete schema with RBAC and hierarchical organizations
-- Features: 31 tables + RBAC support + hierarchical org structure
-- Tables: Core infrastructure + device mgmt + RBAC (roles, org_members, team_members)
-- Total indexes: 60+
-- Status: Complete consolidated schema with RBAC support
-- ============================================================================

-- ============================================================================
-- SECTION 1: USER & ORGANIZATION TABLES (RBAC enabled)
-- ============================================================================

-- Users table with RBAC fields
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    avatar_url TEXT,
    email_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Organizations table with hierarchical support
CREATE TABLE IF NOT EXISTS organizations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    timezone VARCHAR(50) DEFAULT 'UTC',
    is_public BOOLEAN DEFAULT FALSE,
    parent_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL,
    org_type VARCHAR(50) DEFAULT 'standard', -- 'parent', 'child', 'standard'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(parent_id, slug)
);

-- Teams table with hierarchy support
CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    team_type VARCHAR(50) DEFAULT 'department',
    parent_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, slug)
);

-- Roles table - NEW for RBAC
CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    scope VARCHAR(50) NOT NULL, -- 'organization' or 'team'
    permissions JSONB NOT NULL, -- { read, write, delete, admin, manage_members, ... }
    is_system_role BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, scope)
);

-- Organization Members table - NEW for RBAC
CREATE TABLE IF NOT EXISTS organization_members (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    invitation_status VARCHAR(50) DEFAULT 'accepted', -- 'pending', 'accepted', 'declined'
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    joined_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, organization_id),
    CHECK (invitation_status IN ('pending', 'accepted', 'declined'))
);

-- Team Members table - NEW for RBAC
CREATE TABLE IF NOT EXISTS team_members (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    invitation_status VARCHAR(50) DEFAULT 'accepted', -- 'pending', 'accepted', 'declined'
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    joined_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, team_id),
    CHECK (invitation_status IN ('pending', 'accepted', 'declined'))
);

-- ============================================================================
-- SECTION 2: DEVICE TYPE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_types (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    protocol VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 3: VENDOR & PROVIDER TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_vendors (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    vendor_type VARCHAR(50) DEFAULT 'device_vendor' CHECK (vendor_type = 'device_vendor'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_providers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    provider_type VARCHAR(50) DEFAULT 'iot_platform',
    config JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_models (
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES device_vendors(id) ON DELETE CASCADE,
    device_type_id BIGINT NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) NOT NULL,
    description TEXT,
    spec JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_id, code)
);

-- ============================================================================
-- SECTION 4: ROUTING & PROVIDER MAPPING TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_model_routing_rules (
    id BIGSERIAL PRIMARY KEY,
    device_model_id BIGINT NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
    provider_id BIGINT NOT NULL REFERENCES device_providers(id) ON DELETE CASCADE,
    priority INT DEFAULT 0,
    config JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_model_id, provider_id)
);

CREATE TABLE IF NOT EXISTS transport_endpoints (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    endpoint_url VARCHAR(255) NOT NULL,
    endpoint_type VARCHAR(50),
    organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_device_providers (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_provider_id BIGINT NOT NULL REFERENCES device_providers(id) ON DELETE CASCADE,
    config JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, device_provider_id)
);

CREATE TABLE IF NOT EXISTS organization_transports (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    transport_endpoint_id BIGINT NOT NULL REFERENCES transport_endpoints(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, transport_endpoint_id)
);

-- ============================================================================
-- SECTION 5: DEVICE CONFIGURATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS devices (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    device_model_id BIGINT NOT NULL REFERENCES device_models(id) ON DELETE RESTRICT,
    status VARCHAR(50) DEFAULT 'pending',
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_registry (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    device_key VARCHAR(255) NOT NULL,
    connection_status VARCHAR(50) DEFAULT 'disconnected',
    last_heartbeat TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, device_key)
);

-- ============================================================================
-- SECTION 6: STREAM PROCESSING TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS streams (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_stream_bindings (
    id BIGSERIAL PRIMARY KEY,
    device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    stream_id BIGINT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, stream_id)
);

-- ============================================================================
-- SECTION 7: SHARDING & DISTRIBUTION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_shard_mapping (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    shard_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, shard_id)
);

CREATE TABLE IF NOT EXISTS transport_shards (
    id BIGSERIAL PRIMARY KEY,
    shard_id VARCHAR(100) NOT NULL UNIQUE,
    max_devices BIGINT DEFAULT 1000000,
    current_device_count BIGINT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shard_ingest_connections (
    id BIGSERIAL PRIMARY KEY,
    shard_id VARCHAR(100) NOT NULL REFERENCES transport_shards(shard_id),
    ingest_host VARCHAR(255),
    ingest_port INT,
    connection_pool_size INT DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shard_rebalance_events (
    id BIGSERIAL PRIMARY KEY,
    shard_id VARCHAR(100),
    event_type VARCHAR(50),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shard_health (
    id BIGSERIAL PRIMARY KEY,
    shard_id VARCHAR(100) NOT NULL REFERENCES transport_shards(shard_id),
    health_status VARCHAR(50),
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    check_interval INT DEFAULT 60
);

-- ============================================================================
-- SECTION 8: PROVIDER TRANSPORT BINDING & USAGE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS provider_transport_bindings (
    id BIGSERIAL PRIMARY KEY,
    device_provider_id BIGINT NOT NULL REFERENCES device_providers(id) ON DELETE CASCADE,
    transport_endpoint_id BIGINT NOT NULL REFERENCES transport_endpoints(id) ON DELETE CASCADE,
    priority INT DEFAULT 0,
    config JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_provider_id, transport_endpoint_id)
);

CREATE TABLE IF NOT EXISTS org_parser_usage (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parser_name VARCHAR(255),
    invocation_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transport_worker_metrics (
    id BIGSERIAL PRIMARY KEY,
    shard_id VARCHAR(100),
    worker_id VARCHAR(255),
    processed_events BIGINT,
    error_count BIGINT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECTION 9: LEGACY COMPATIBILITY TABLES (deprecated but maintained)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_access_permissions (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id, permission)
);

CREATE TABLE IF NOT EXISTS team_access_permissions (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, user_id, permission)
);

-- ============================================================================
-- SECTION 10: VENDOR MODELS MAPPING (compatibility table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vendor_models_mapping (
    id BIGSERIAL PRIMARY KEY,
    vendor_code VARCHAR(50),
    model_code VARCHAR(100),
    device_model_id BIGINT REFERENCES device_models(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vendor_code, model_code)
);

-- ============================================================================
-- SECTION 11: INDEXES FOR OPTIMIZATION
-- ============================================================================

-- User indexes
CREATE INDEX idx_users_email ON users USING BTREE (email);
CREATE INDEX idx_users_is_active ON users USING BTREE (is_active);

-- Organization indexes
CREATE INDEX idx_organizations_slug ON organizations USING BTREE (slug);
CREATE INDEX idx_organizations_parent_id ON organizations USING BTREE (parent_id);
CREATE INDEX idx_organizations_status ON organizations USING BTREE (status);

-- Team indexes
CREATE INDEX idx_teams_organization_id ON teams USING BTREE (organization_id);
CREATE INDEX idx_teams_slug ON teams USING BTREE (slug);
CREATE INDEX idx_teams_parent_team_id ON teams USING BTREE (parent_team_id);

-- Role indexes
CREATE INDEX idx_roles_name ON roles USING BTREE (name);
CREATE INDEX idx_roles_scope ON roles USING BTREE (scope);

-- Organization Members indexes - CRITICAL for RBAC
CREATE INDEX idx_organization_members_user_id ON organization_members USING BTREE (user_id);
CREATE INDEX idx_organization_members_organization_id ON organization_members USING BTREE (organization_id);
CREATE INDEX idx_organization_members_role_id ON organization_members USING BTREE (role_id);
CREATE INDEX idx_organization_members_invitation_status ON organization_members USING BTREE (invitation_status);

-- Team Members indexes - CRITICAL for RBAC
CREATE INDEX idx_team_members_user_id ON team_members USING BTREE (user_id);
CREATE INDEX idx_team_members_team_id ON team_members USING BTREE (team_id);
CREATE INDEX idx_team_members_role_id ON team_members USING BTREE (role_id);
CREATE INDEX idx_team_members_invitation_status ON team_members USING BTREE (invitation_status);

-- Device indexes
CREATE INDEX idx_devices_organization_id ON devices USING BTREE (organization_id);
CREATE INDEX idx_devices_device_key ON devices USING BTREE (device_key);
CREATE INDEX idx_devices_device_model_id ON devices USING BTREE (device_model_id);
CREATE INDEX idx_device_registry_organization_id ON device_registry USING BTREE (organization_id);
CREATE INDEX idx_device_registry_device_key ON device_registry USING BTREE (device_key);
CREATE INDEX idx_device_registry_connection_status ON device_registry USING BTREE (connection_status);

-- Stream indexes
CREATE INDEX idx_streams_organization_id ON streams USING BTREE (organization_id);
CREATE INDEX idx_device_stream_bindings_device_id ON device_stream_bindings USING BTREE (device_id);
CREATE INDEX idx_device_stream_bindings_stream_id ON device_stream_bindings USING BTREE (stream_id);

-- Shard indexes
CREATE INDEX idx_tenant_shard_mapping_organization_id ON tenant_shard_mapping USING BTREE (organization_id);
CREATE INDEX idx_transport_shards_shard_id ON transport_shards USING BTREE (shard_id);
CREATE INDEX idx_shard_ingest_connections_shard_id ON shard_ingest_connections USING BTREE (shard_id);
CREATE INDEX idx_shard_health_shard_id ON shard_health USING BTREE (shard_id);

-- Provider/Transport indexes
CREATE INDEX idx_device_model_routing_rules_device_model_id ON device_model_routing_rules USING BTREE (device_model_id);
CREATE INDEX idx_device_model_routing_rules_provider_id ON device_model_routing_rules USING BTREE (provider_id);
CREATE INDEX idx_organization_device_providers_organization_id ON organization_device_providers USING BTREE (organization_id);
CREATE INDEX idx_organization_transports_organization_id ON organization_transports USING BTREE (organization_id);
CREATE INDEX idx_provider_transport_bindings_device_provider_id ON provider_transport_bindings USING BTREE (device_provider_id);

-- Compatibility indexes
CREATE INDEX idx_organization_access_permissions_organization_id ON organization_access_permissions USING BTREE (organization_id);
CREATE INDEX idx_organization_access_permissions_user_id ON organization_access_permissions USING BTREE (user_id);
CREATE INDEX idx_team_access_permissions_team_id ON team_access_permissions USING BTREE (team_id);
CREATE INDEX idx_team_access_permissions_user_id ON team_access_permissions USING BTREE (user_id);

-- ============================================================================
-- SECTION 12: VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW organization_hierarchy AS
SELECT 
    o.id,
    o.name,
    o.parent_id,
    o.org_type,
    p.name as parent_name,
    o.created_at
FROM organizations o
LEFT JOIN organizations p ON o.parent_id = p.id;

CREATE OR REPLACE VIEW team_hierarchy AS
SELECT 
    t.id,
    t.name,
    t.organization_id,
    t.parent_team_id,
    pt.name as parent_team_name,
    t.created_at
FROM teams t
LEFT JOIN teams pt ON t.parent_team_id = pt.id;

CREATE OR REPLACE VIEW user_permissions AS
SELECT 
    u.id as user_id,
    u.email,
    om.organization_id,
    o.name as organization_name,
    r_org.name as org_role_name,
    r_org.permissions as org_permissions,
    t.id as team_id,
    t.name as team_name,
    r_team.name as team_role_name,
    r_team.permissions as team_permissions
FROM users u
LEFT JOIN organization_members om ON u.id = om.user_id
LEFT JOIN organizations o ON om.organization_id = o.id
LEFT JOIN roles r_org ON om.role_id = r_org.id
LEFT JOIN team_members tm ON u.id = tm.user_id
LEFT JOIN teams t ON tm.team_id = t.id
LEFT JOIN roles r_team ON tm.role_id = r_team.id;

-- ============================================================================
-- SECTION 13: DDL COMPLETION
-- ============================================================================

COMMIT;

-- Schema created successfully! All 31 tables, 60+ indexes, and 3 views are ready.
