-- Database Seed Data
-- Current state with polymorphic foreign key transport configuration
-- Generated from live database
-- All migrations 001-022 should be applied before running this seed


-- transport_type
INSERT INTO transport_type (id, code, display_name, description, created_at) VALUES (1, 'mqtt-subscriber', 'MQTT Subscriber', 'Subscribes to MQTT broker and receives device messages', '2026-03-12T20:41:47.825249');
INSERT INTO transport_type (id, code, display_name, description, created_at) VALUES (2, 'grpc-server', 'gRPC Server', 'gRPC server that receives device data via RPC calls', '2026-03-12T20:41:47.825249');
INSERT INTO transport_type (id, code, display_name, description, created_at) VALUES (3, 'grpc-client', 'gRPC Client', 'gRPC client that calls external services to pull device data', '2026-03-12T20:41:47.825249');
INSERT INTO transport_type (id, code, display_name, description, created_at) VALUES (4, 'http-server', 'HTTP Server', 'HTTP server that receives webhook callbacks from providers', '2026-03-12T20:41:47.825249');
INSERT INTO transport_type (id, code, display_name, description, created_at) VALUES (5, 'http-client', 'HTTP Client', 'HTTP client that polls external endpoints for device data', '2026-03-12T20:41:47.825249');

-- transport_parser
INSERT INTO transport_parser (id, code, display_name, description, is_builtin, created_at) VALUES (1, 'chirpstack', 'ChirpStack LoRaWAN', 'Parses ChirpStack MQTT application messages', true, '2026-03-12T20:41:47.827634');
INSERT INTO transport_parser (id, code, display_name, description, is_builtin, created_at) VALUES (2, 'everynet', 'Everynet API', 'Parses Everynet API webhook format', true, '2026-03-12T20:41:47.827634');
INSERT INTO transport_parser (id, code, display_name, description, is_builtin, created_at) VALUES (4, 'default', 'Default Passthrough', 'Stores raw payload without parsing or transformation', true, '2026-03-12T20:41:47.827634');

-- roles
INSERT INTO roles (id, name, scope, permissions, is_system_role, created_at, updated_at) VALUES (1, 'Owner', 'organization', '{"read": true, "admin": true, "write": true, "delete": true, "manage_teams": true, "manage_members": true}'::jsonb, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO roles (id, name, scope, permissions, is_system_role, created_at, updated_at) VALUES (2, 'Admin', 'organization', '{"read": true, "admin": true, "write": true, "delete": true, "manage_teams": false, "manage_members": true}'::jsonb, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO roles (id, name, scope, permissions, is_system_role, created_at, updated_at) VALUES (3, 'Member', 'organization', '{"read": true, "admin": false, "write": false, "delete": false, "manage_teams": false, "manage_members": false}'::jsonb, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO roles (id, name, scope, permissions, is_system_role, created_at, updated_at) VALUES (4, 'TeamOwner', 'team', '{"read": true, "admin": true, "write": true, "delete": true, "create_devices": true, "manage_members": true, "create_subteams": true, "monitor_devices": true}'::jsonb, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO roles (id, name, scope, permissions, is_system_role, created_at, updated_at) VALUES (5, 'TeamAdmin', 'team', '{"read": true, "admin": true, "write": true, "delete": true, "create_devices": true, "manage_members": true, "create_subteams": false, "monitor_devices": true}'::jsonb, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO roles (id, name, scope, permissions, is_system_role, created_at, updated_at) VALUES (6, 'TeamMember', 'team', '{"read": true, "admin": false, "write": true, "delete": false, "create_devices": true, "manage_members": false, "create_subteams": false, "monitor_devices": true}'::jsonb, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- device_vendors
INSERT INTO device_vendors (id, name, code, description, created_at, updated_at) VALUES (7, 'Milesight', 'milesight', 'Milesight IoT sensor and gateway solutions', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO device_vendors (id, name, code, description, created_at, updated_at) VALUES (8, 'Kron', 'kron', 'Kron energy monitoring and control devices', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO device_vendors (id, name, code, description, created_at, updated_at) VALUES (9, 'Khomp', 'khomp', 'Khomp industrial gateway and meter solutions', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO device_vendors (id, name, code, description, created_at, updated_at) VALUES (10, 'Zc2x', 'zc2x', 'Zc2x ESP32-based IoT embedded systems', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO device_vendors (id, name, code, description, created_at, updated_at) VALUES (11, 'Agent', 'agent', 'Agent distributed telemetry agent service', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO device_vendors (id, name, code, description, created_at, updated_at) VALUES (12, 'Schneider', 'schneider', 'Schneider Electric industrial automation and control', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- device_models
INSERT INTO device_models (id, vendor_id, name, code, description, created_at, updated_at) VALUES (7, 7, 'Milesight-W101-R', 'ws101', 'Milesight-WS101R', '2026-03-16T19:23:52.024437', '2026-03-16T19:23:52.024437');

-- organizations
INSERT INTO organizations (id, name, slug, description, status, timezone, is_public, parent_id, org_type, created_at, updated_at) VALUES (1, 'Admin', 'admin', 'Platform admin organization with access to all orgs', 'active', 'UTC', false, NULL, 'parent', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organizations (id, name, slug, description, status, timezone, is_public, parent_id, org_type, created_at, updated_at) VALUES (2, 'IMT', 'imt', 'Instituto Mauá de Tecnologia', 'active', 'UTC', false, 1, 'child', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organizations (id, name, slug, description, status, timezone, is_public, parent_id, org_type, created_at, updated_at) VALUES (3, 'FSAELive', 'fsaelive', 'Formula SAE Live event management', 'active', 'UTC', false, 1, 'child', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organizations (id, name, slug, description, status, timezone, is_public, parent_id, org_type, created_at, updated_at) VALUES (4, 'StorioCloud', 'storiocloud', 'StorioCloud platform', 'active', 'UTC', false, 1, 'child', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- users
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d479', 'admin@platform.com', 'hashed_password_admin', 'Admin', 'Platform', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d480', 'imt@imt.com', 'hashed_password_owner', 'IMT', 'Owner', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d481', 'gms@imt.com', 'hashed_password_gms', 'General', 'Maintenance', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d482', 'maua@imt.com', 'hashed_password_maua', 'Mauá', 'Racing', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d483', 'fsaelive@fsaelive.com', 'hashed_password_fsae', 'FSAE', 'Live', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d484', 'committees@fsaelive.com', 'hashed_password_comm', 'Committee', 'Lead', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d485', 'storiocloud@storiocloud.com', 'hashed_password_storio', 'StorioCloud', 'Owner', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar_url, email_verified, is_active, created_at, updated_at) VALUES ('f47ac10b-58cc-4372-a567-0e02b2c3d486', 'cinemark@storiocloud.com', 'hashed_password_cinemark', 'Cinemark', 'Manager', NULL, NULL, true, true, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- organization_members
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (1, 'f47ac10b-58cc-4372-a567-0e02b2c3d479', 1, 1, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (2, 'f47ac10b-58cc-4372-a567-0e02b2c3d480', 2, 1, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (3, 'f47ac10b-58cc-4372-a567-0e02b2c3d481', 2, 3, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (4, 'f47ac10b-58cc-4372-a567-0e02b2c3d482', 2, 3, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (5, 'f47ac10b-58cc-4372-a567-0e02b2c3d483', 3, 1, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (6, 'f47ac10b-58cc-4372-a567-0e02b2c3d484', 3, 3, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (7, 'f47ac10b-58cc-4372-a567-0e02b2c3d485', 4, 1, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO organization_members (id, user_id, organization_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (8, 'f47ac10b-58cc-4372-a567-0e02b2c3d486', 4, 2, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- teams
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (1, 2, 'GMS', 'gms', 'General Maintenance & Support', 'active', 'department', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (2, 2, 'MauaRacing', 'maua-racing', 'Mauá Racing Team', 'active', 'project', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (3, 3, 'Teams', 'teams', 'Team Management', 'active', 'department', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (4, 3, 'RaceTracks', 'race-tracks', 'Race Track Operations', 'active', 'project', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (5, 3, 'Committee', 'committee', 'Event Committee', 'active', 'committee', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (6, 4, 'Cinemark', 'cinemark', 'Cinemark Integration', 'active', 'project', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO teams (id, organization_id, name, slug, description, status, team_type, parent_team_id, is_public, created_at, updated_at) VALUES (7, 4, 'UCI', 'uci', 'UCI Platform', 'active', 'integration', NULL, false, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- team_members
INSERT INTO team_members (id, user_id, team_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (1, 'f47ac10b-58cc-4372-a567-0e02b2c3d481', 1, 4, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO team_members (id, user_id, team_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (2, 'f47ac10b-58cc-4372-a567-0e02b2c3d482', 2, 4, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO team_members (id, user_id, team_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (3, 'f47ac10b-58cc-4372-a567-0e02b2c3d484', 5, 4, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');
INSERT INTO team_members (id, user_id, team_id, role_id, invitation_status, invited_by, invited_at, joined_at, created_at, updated_at) VALUES (4, 'f47ac10b-58cc-4372-a567-0e02b2c3d486', 6, 5, 'accepted', NULL, '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408', '2026-03-11T19:21:53.436408');

-- transport_mqtt_config
INSERT INTO transport_mqtt_config (id, transport_type_id, host, port, username, password, qos, clean_session, keep_alive_sec, connection_timeout_sec, use_tls, tls_ca_cert, tls_client_cert, tls_client_key, tls_skip_verify, topics, max_reconnect_interval_sec, created_at, updated_at) VALUES (1, 1, 'networkserver2.maua.br', 1883, NULL, NULL, 1, false, 60, 10, false, NULL, NULL, NULL, false, '["application/+/device/+/event/up"]', 10, '2026-03-17T15:47:00.182236', '2026-03-17T15:47:00.182236');

-- transport_config
INSERT INTO transport_config (id, transport_type_id, config_type, mqtt_config_id, http_config_id, grpc_config_id, created_at, updated_at) VALUES (1, 1, 'mqtt', 1, NULL, NULL, '2026-03-17T17:22:36.96391', '2026-03-17T17:22:36.96391');

-- transport_registry
INSERT INTO transport_registry (id, name, description, organization_id, team_id, transport_type_id, is_global, is_active, config, created_by, created_at, updated_at, updated_by, transport_parser_id, transport_config_id) VALUES (1, 'ChirpStack-IMT', 'ChirpStack-IMT', 2, 1, 1, false, true, '{"host": "networkserver2.maua.br", "port": 1883, "topics": "[\"application/+/device/+/event/up\"]"}'::jsonb, 'f47ac10b-58cc-4372-a567-0e02b2c3d481', '2026-03-12T20:45:29.50811', '2026-03-12T20:45:29.50811', 'f47ac10b-58cc-4372-a567-0e02b2c3d481', 1, 1);

-- device_registry
INSERT INTO device_registry (id, device_key, device_model_id, eui, mac_address, created_by, organization_id, team_id, lns_provider_id, is_public, is_active, is_global, connection_status, last_heartbeat, metadata, created_at, updated_at, transport_registry_id) VALUES ('e191307d-1925-4bb0-94c4-20442e22933a', 'milesight-ws101-001', 7, '24e124535f318437', NULL, 'f47ac10b-58cc-4372-a567-0e02b2c3d481', 2, 1, NULL, true, true, true, 'disconnected', NULL, '{}'::jsonb, '2026-03-16T19:25:37.886954', '2026-03-16T19:25:37.886954', 1);
