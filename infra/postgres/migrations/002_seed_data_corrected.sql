-- ============================================================================
-- PostgreSQL Migration 002: SEED RBAC DATA WITH DEVICE CONFIGURATION
-- ============================================================================
-- Version: 3.0 - Complete RBAC seed data
-- Scope: 6 roles, 8 users, 4 organizations (with hierarchy), 7 teams, full RBAC mappings
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: SEED SYSTEM ROLES (6 total: 3 org scopes + 3 team scopes)
-- ============================================================================

INSERT INTO roles (name, scope, permissions, is_system_role) VALUES
    -- Organization Level Roles
    ('Owner', 'organization', '{"read": true, "write": true, "delete": true, "admin": true, "manage_members": true, "manage_teams": true}'::jsonb, true),
    ('Admin', 'organization', '{"read": true, "write": true, "delete": true, "admin": true, "manage_members": true, "manage_teams": false}'::jsonb, true),
    ('Member', 'organization', '{"read": true, "write": false, "delete": false, "admin": false, "manage_members": false, "manage_teams": false}'::jsonb, true),
    -- Team Level Roles
    ('TeamOwner', 'team', '{"read": true, "write": true, "delete": true, "admin": true, "manage_members": true, "create_subteams": true, "create_devices": true, "monitor_devices": true}'::jsonb, true),
    ('TeamAdmin', 'team', '{"read": true, "write": true, "delete": true, "admin": true, "manage_members": true, "create_subteams": false, "create_devices": true, "monitor_devices": true}'::jsonb, true),
    ('TeamMember', 'team', '{"read": true, "write": true, "delete": false, "admin": false, "manage_members": false, "create_subteams": false, "create_devices": true, "monitor_devices": true}'::jsonb, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 2: SEED USERS (8 total)
-- ============================================================================

INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, email_verified) VALUES
    -- Platform Admin
    ('f47ac10b-58cc-4372-a567-0e02b2c3d479'::uuid, 'admin@platform.com', 'hashed_password_admin', 'Admin', 'Platform', true, true),
    -- IMT Organization Users
    ('f47ac10b-58cc-4372-a567-0e02b2c3d480'::uuid, 'imt@imt.com', 'hashed_password_owner', 'IMT', 'Owner', true, true),
    ('f47ac10b-58cc-4372-a567-0e02b2c3d481'::uuid, 'gms@imt.com', 'hashed_password_gms', 'General', 'Maintenance', true, true),
    ('f47ac10b-58cc-4372-a567-0e02b2c3d482'::uuid, 'maua@imt.com', 'hashed_password_maua', 'Mauá', 'Racing', true, true),
    -- FSAELive Organization Users
    ('f47ac10b-58cc-4372-a567-0e02b2c3d483'::uuid, 'fsaelive@fsaelive.com', 'hashed_password_fsae', 'FSAE', 'Live', true, true),
    ('f47ac10b-58cc-4372-a567-0e02b2c3d484'::uuid, 'committees@fsaelive.com', 'hashed_password_comm', 'Committee', 'Lead', true, true),
    -- StorioCloud Organization Users
    ('f47ac10b-58cc-4372-a567-0e02b2c3d485'::uuid, 'storiocloud@storiocloud.com', 'hashed_password_storio', 'StorioCloud', 'Owner', true, true),
    ('f47ac10b-58cc-4372-a567-0e02b2c3d486'::uuid, 'cinemark@storiocloud.com', 'hashed_password_cinemark', 'Cinemark', 'Manager', true, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 3: SEED ORGANIZATIONS (4 with hierarchical structure)
-- ============================================================================

-- Admin org (parent)
INSERT INTO organizations (id, name, slug, description, org_type, is_public) VALUES
    (1, 'Admin', 'admin', 'Platform admin organization with access to all orgs', 'parent', false)
ON CONFLICT DO NOTHING;

-- Child organizations
INSERT INTO organizations (id, name, slug, description, parent_id, org_type, is_public) VALUES
    (2, 'IMT', 'imt', 'Instituto Mauá de Tecnologia', 1, 'child', false),
    (3, 'FSAELive', 'fsaelive', 'Formula SAE Live event management', 1, 'child', false),
    (4, 'StorioCloud', 'storiocloud', 'StorioCloud platform', 1, 'child', false)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 4: SEED ORGANIZATION MEMBERS (with RBAC)
-- ============================================================================

-- Admin org
INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 1, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email = 'admin@platform.com' AND r.name = 'Owner' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

-- IMT org
INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 2, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email = 'imt@imt.com' AND r.name = 'Owner' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 2, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email IN ('gms@imt.com', 'maua@imt.com') AND r.name = 'Member' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

-- FSAELive org
INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 3, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email = 'fsaelive@fsaelive.com' AND r.name = 'Owner' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 3, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email = 'committees@fsaelive.com' AND r.name = 'Member' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

-- StorioCloud org
INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 4, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email = 'storiocloud@storiocloud.com' AND r.name = 'Owner' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

INSERT INTO organization_members (user_id, organization_id, role_id, invitation_status, joined_at)
SELECT u.id, 4, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, roles r
WHERE u.email = 'cinemark@storiocloud.com' AND r.name = 'Admin' AND r.scope = 'organization'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 5: SEED TEAMS (7 total)
-- ============================================================================

INSERT INTO teams (organization_id, name, slug, description, team_type, is_public) VALUES
    (2, 'GMS', 'gms', 'General Maintenance & Support', 'department', false),
    (2, 'MauaRacing', 'maua-racing', 'Mauá Racing Team', 'project', false),
    (3, 'Teams', 'teams', 'Team Management', 'department', false),
    (3, 'RaceTracks', 'race-tracks', 'Race Track Operations', 'project', false),
    (3, 'Committee', 'committee', 'Event Committee', 'committee', false),
    (4, 'Cinemark', 'cinemark', 'Cinemark Integration', 'project', false),
    (4, 'UCI', 'uci', 'UCI Platform', 'integration', false)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 6: SEED TEAM MEMBERS (with RBAC)
-- ============================================================================

INSERT INTO team_members (user_id, team_id, role_id, invitation_status, joined_at)
SELECT u.id, t.id, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, teams t, roles r
WHERE u.email = 'gms@imt.com' AND t.slug = 'gms' AND r.name = 'TeamOwner' AND r.scope = 'team'
ON CONFLICT DO NOTHING;

INSERT INTO team_members (user_id, team_id, role_id, invitation_status, joined_at)
SELECT u.id, t.id, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, teams t, roles r
WHERE u.email = 'maua@imt.com' AND t.slug = 'maua-racing' AND r.name = 'TeamOwner' AND r.scope = 'team'
ON CONFLICT DO NOTHING;

INSERT INTO team_members (user_id, team_id, role_id, invitation_status, joined_at)
SELECT u.id, t.id, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, teams t, roles r
WHERE u.email = 'committees@fsaelive.com' AND t.slug = 'committee' AND r.name = 'TeamOwner' AND r.scope = 'team'
ON CONFLICT DO NOTHING;

INSERT INTO team_members (user_id, team_id, role_id, invitation_status, joined_at)
SELECT u.id, t.id, r.id, 'accepted', CURRENT_TIMESTAMP
FROM users u, teams t, roles r
WHERE u.email = 'cinemark@storiocloud.com' AND t.slug = 'cinemark' AND r.name = 'TeamAdmin' AND r.scope = 'team'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 7: DEVICE TYPES
-- ============================================================================

INSERT INTO device_types (id, name, protocol) VALUES
    (1001, 'LoRaWAN', 'lora'),
    (3001, 'MQTT', 'mqtt'),
    (5001, 'gRPC', 'grpc')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 8: DEVICE VENDORS
-- ============================================================================

INSERT INTO device_vendors (name, code, description, vendor_type) VALUES
    ('Milesight', 'milesight', 'Milesight IoT sensor and gateway solutions', 'device_vendor'),
    ('Kron', 'kron', 'Kron energy monitoring and control devices', 'device_vendor'),
    ('Khomp', 'khomp', 'Khomp industrial gateway and meter solutions', 'device_vendor'),
    ('Zc2x', 'zc2x', 'Zc2x ESP32-based IoT embedded systems', 'device_vendor'),
    ('Agent', 'agent', 'Agent distributed telemetry agent service', 'device_vendor'),
    ('Schneider', 'schneider', 'Schneider Electric industrial automation and control', 'device_vendor')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 9: DEVICE PROVIDERS
-- ============================================================================

INSERT INTO device_providers (name, code, provider_type, description) VALUES
    ('ChirpStack', 'chirpstack', 'lns', 'ChirpStack LoRaWAN Network Server'),
    ('Everynet', 'everynet', 'lns', 'Everynet LPWAN Management Platform'),
    ('Schneider Cloud', 'schneider-cloud', 'cloud', 'Schneider Electric cloud platform'),
    ('Engil', 'engil', 'integration', 'Engil data integration platform')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 10: DEVICE MODELS
-- ============================================================================

INSERT INTO device_models (vendor_id, device_type_id, name, code, description) VALUES
    ((SELECT id FROM device_vendors WHERE code = 'milesight'), 1001, 'Milesight EM500', 'em500-swl', 'Milesight EM500 LoRaWAN sensor'),
    ((SELECT id FROM device_vendors WHERE code = 'kron'), 3001, 'Kron KS300', 'ks300', 'Kron KS300 MQTT energy meter'),
    ((SELECT id FROM device_vendors WHERE code = 'khomp'), 1001, 'Khomp DTL200', 'dtl200', 'Khomp DTL200 LoRaWAN gateway'),
    ((SELECT id FROM device_vendors WHERE code = 'schneider'), 5001, 'Schneider M241', 'm241', 'Schneider M241 PLC')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 11: DEVICE MODEL ROUTING RULES
-- ============================================================================

INSERT INTO device_model_routing_rules (device_model_id, provider_id, priority) VALUES
    ((SELECT id FROM device_models WHERE code = 'em500-swl'), (SELECT id FROM device_providers WHERE code = 'chirpstack'), 10),
    ((SELECT id FROM device_models WHERE code = 'em500-swl'), (SELECT id FROM device_providers WHERE code = 'everynet'), 20),
    ((SELECT id FROM device_models WHERE code = 'ks300'), (SELECT id FROM device_providers WHERE code = 'schneider-cloud'), 10),
    ((SELECT id FROM device_models WHERE code = 'dtl200'), (SELECT id FROM device_providers WHERE code = 'chirpstack'), 10)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 12: TRANSPORT ENDPOINTS
-- ============================================================================

INSERT INTO transport_endpoints (name, endpoint_url, endpoint_type, organization_id) VALUES
    ('ChirpStack IMT', 'https://chirpstack.imt.local:8080/api', 'chirpstack', 2),
    ('Everynet IMT', 'https://api.everynet.imt.local', 'everynet', 2),
    ('Internal Broker', 'mqtt://broker.imt.local:1883', 'mqtt', 2)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 13: ORGANIZATION DEVICE PROVIDERS
-- ============================================================================

INSERT INTO organization_device_providers (organization_id, device_provider_id) VALUES
    (2, (SELECT id FROM device_providers WHERE code = 'chirpstack')),
    (2, (SELECT id FROM device_providers WHERE code = 'everynet')),
    (3, (SELECT id FROM device_providers WHERE code = 'schneider-cloud')),
    (4, (SELECT id FROM device_providers WHERE code = 'engil'))
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SECTION 14: ORGANIZATION TRANSPORTS
-- ============================================================================

INSERT INTO organization_transports (organization_id, transport_endpoint_id) VALUES
    (2, (SELECT id FROM transport_endpoints WHERE name = 'ChirpStack IMT')),
    (2, (SELECT id FROM transport_endpoints WHERE name = 'Everynet IMT')),
    (2, (SELECT id FROM transport_endpoints WHERE name = 'Internal Broker'))
ON CONFLICT DO NOTHING;

COMMIT;

-- ✅ RBAC seed data deployed successfully!
