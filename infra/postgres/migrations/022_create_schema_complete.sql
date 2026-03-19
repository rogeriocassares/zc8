-- Fresh complete schema export - PostgreSQL 18.1
-- This includes all tables, indexes, sequences, and constraints
-- Generated: 2026-03-17
-- Includes new transport_config intermediate table for polymorphic FK resolution

-- ============================================================================
-- SEQUENCES
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS device_models_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS device_vendors_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS organizations_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS organization_members_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS roles_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS teams_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS team_members_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_grpc_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_http_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_mqtt_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_parser_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_registry_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transport_type_id_seq START 1;

-- ============================================================================
-- TABLES
-- ============================================================================

-- Device Management
CREATE TABLE IF NOT EXISTS device_vendors (
  id bigint NOT NULL DEFAULT nextval('device_vendors_id_seq'::regclass) PRIMARY KEY,
  name character varying NOT NULL,
  code character varying NOT NULL UNIQUE,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_models (
  id bigint NOT NULL DEFAULT nextval('device_models_id_seq'::regclass) PRIMARY KEY,
  vendor_id bigint NOT NULL REFERENCES device_vendors(id) ON DELETE RESTRICT,
  name character varying NOT NULL,
  code character varying NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vendor_id, code)
);

-- RBAC
CREATE TABLE IF NOT EXISTS roles (
  id bigint NOT NULL DEFAULT nextval('roles_id_seq'::regclass) PRIMARY KEY,
  name character varying NOT NULL UNIQUE,
  scope character varying NOT NULL,
  permissions jsonb NOT NULL,
  is_system_role boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  first_name character varying,
  last_name character varying,
  phone character varying,
  avatar_url text,
  email_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id bigint NOT NULL DEFAULT nextval('organizations_id_seq'::regclass) PRIMARY KEY,
  name character varying NOT NULL,
  slug character varying NOT NULL UNIQUE,
  description text,
  status character varying DEFAULT 'active'::character varying,
  timezone character varying DEFAULT 'UTC'::character varying,
  is_public boolean DEFAULT false,
  parent_id bigint REFERENCES organizations(id) ON DELETE SET NULL,
  org_type character varying DEFAULT 'standard'::character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organization_members (
  id bigint NOT NULL DEFAULT nextval('organization_members_id_seq'::regclass) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  invitation_status character varying DEFAULT 'accepted'::character varying,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  joined_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, organization_id)
);

-- Teams
CREATE TABLE IF NOT EXISTS teams (
  id bigint NOT NULL DEFAULT nextval('teams_id_seq'::regclass) PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name character varying NOT NULL,
  slug character varying NOT NULL,
  description text,
  status character varying DEFAULT 'active'::character varying,
  team_type character varying DEFAULT 'department'::character varying,
  parent_team_id bigint REFERENCES teams(id) ON DELETE SET NULL,
  is_public boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, slug)
);

CREATE TABLE IF NOT EXISTS team_members (
  id bigint NOT NULL DEFAULT nextval('team_members_id_seq'::regclass) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  invitation_status character varying DEFAULT 'accepted'::character varying,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  joined_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, team_id)
);

-- Transport Infrastructure Layer
CREATE TABLE IF NOT EXISTS transport_type (
  id integer NOT NULL DEFAULT nextval('transport_type_id_seq'::regclass) PRIMARY KEY,
  code character varying NOT NULL UNIQUE,
  display_name character varying NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transport_parser (
  id integer NOT NULL DEFAULT nextval('transport_parser_id_seq'::regclass) PRIMARY KEY,
  code character varying NOT NULL UNIQUE,
  display_name character varying NOT NULL,
  description text,
  is_builtin boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now()
);

-- Transport Configuration Tables (typed, schema-validated)
CREATE TABLE IF NOT EXISTS transport_mqtt_config (
  id bigint NOT NULL DEFAULT nextval('transport_mqtt_config_id_seq'::regclass) PRIMARY KEY,
  transport_type_id bigint NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
  host varchar(255) NOT NULL,
  port int NOT NULL CHECK (port > 0 AND port < 65536),
  username varchar(255),
  password varchar(255),
  qos smallint NOT NULL DEFAULT 1 CHECK (qos IN (0, 1, 2)),
  clean_session boolean NOT NULL DEFAULT false,
  keep_alive_sec int NOT NULL DEFAULT 60 CHECK (keep_alive_sec > 0),
  connection_timeout_sec int NOT NULL DEFAULT 10 CHECK (connection_timeout_sec > 0),
  use_tls boolean NOT NULL DEFAULT false,
  tls_ca_cert text,
  tls_client_cert text,
  tls_client_key text,
  tls_skip_verify boolean NOT NULL DEFAULT false,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_reconnect_interval_sec int NOT NULL DEFAULT 10 CHECK (max_reconnect_interval_sec > 0),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transport_http_config (
  id bigint NOT NULL DEFAULT nextval('transport_http_config_id_seq'::regclass) PRIMARY KEY,
  transport_type_id bigint NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
  base_url varchar(2048) NOT NULL,
  method varchar(10) NOT NULL DEFAULT 'POST' CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_type varchar(50) NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'basic', 'bearer', 'api-key', 'custom')),
  auth_credentials varchar(1024),
  use_tls boolean NOT NULL DEFAULT true,
  tls_ca_cert text,
  tls_client_cert text,
  tls_client_key text,
  tls_skip_verify boolean NOT NULL DEFAULT false,
  timeout_sec int NOT NULL DEFAULT 30 CHECK (timeout_sec > 0),
  content_type varchar(100) NOT NULL DEFAULT 'application/json',
  retry_count int NOT NULL DEFAULT 3 CHECK (retry_count >= 0),
  retry_delay_sec int NOT NULL DEFAULT 5 CHECK (retry_delay_sec > 0),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transport_grpc_config (
  id bigint NOT NULL DEFAULT nextval('transport_grpc_config_id_seq'::regclass) PRIMARY KEY,
  transport_type_id bigint NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
  host varchar(255) NOT NULL,
  port int NOT NULL CHECK (port > 0 AND port < 65536),
  service_name varchar(255) NOT NULL,
  use_tls boolean NOT NULL DEFAULT true,
  tls_ca_cert text,
  tls_client_cert text,
  tls_client_key text,
  connection_timeout_sec int NOT NULL DEFAULT 10 CHECK (connection_timeout_sec > 0),
  keep_alive_sec int NOT NULL DEFAULT 30 CHECK (keep_alive_sec > 0),
  keep_alive_timeout_sec int NOT NULL DEFAULT 10 CHECK (keep_alive_timeout_sec > 0),
  max_idle_conns int NOT NULL DEFAULT 10 CHECK (max_idle_conns > 0),
  max_connections int NOT NULL DEFAULT 100 CHECK (max_connections > 0),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Intermediate polymorphic foreign key table
-- Acts as registry to resolve which specific config table to use
CREATE TABLE IF NOT EXISTS transport_config (
  id bigint NOT NULL DEFAULT nextval('transport_config_id_seq'::regclass) PRIMARY KEY,
  transport_type_id bigint NOT NULL UNIQUE REFERENCES transport_type(id) ON DELETE RESTRICT,
  config_type varchar(20) NOT NULL CHECK (config_type IN ('mqtt', 'http', 'grpc')),
  mqtt_config_id bigint REFERENCES transport_mqtt_config(id) ON DELETE RESTRICT,
  http_config_id bigint REFERENCES transport_http_config(id) ON DELETE RESTRICT,
  grpc_config_id bigint REFERENCES transport_grpc_config(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Constraint: exactly one config must be set and match config_type
  CONSTRAINT config_type_matches_config_id CHECK (
    (config_type = 'mqtt' AND mqtt_config_id IS NOT NULL AND http_config_id IS NULL AND grpc_config_id IS NULL)
    OR (config_type = 'http' AND http_config_id IS NOT NULL AND mqtt_config_id IS NULL AND grpc_config_id IS NULL)
    OR (config_type = 'grpc' AND grpc_config_id IS NOT NULL AND mqtt_config_id IS NULL AND http_config_id IS NULL)
  )
);

-- Transport Registry (infrastructure layer)
CREATE TABLE IF NOT EXISTS transport_registry (
  id bigint NOT NULL DEFAULT nextval('transport_registry_id_seq'::regclass) PRIMARY KEY,
  name character varying NOT NULL,
  description text,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  transport_type_id integer NOT NULL REFERENCES transport_type(id) ON DELETE RESTRICT,
  is_global boolean DEFAULT false,
  is_active boolean DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  transport_parser_id integer NOT NULL REFERENCES transport_parser(id) ON DELETE RESTRICT,
  transport_config_id bigint NOT NULL UNIQUE REFERENCES transport_config(id) ON DELETE RESTRICT,
  UNIQUE(organization_id, name)
);

-- Device Registry
CREATE TABLE IF NOT EXISTS device_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_key character varying NOT NULL,
  device_model_id bigint NOT NULL REFERENCES device_models(id) ON DELETE RESTRICT,
  eui character varying,
  mac_address character varying,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lns_provider_id bigint,
  is_public boolean DEFAULT false,
  is_active boolean DEFAULT true,
  is_global boolean DEFAULT false,
  connection_status character varying DEFAULT 'disconnected'::character varying,
  last_heartbeat timestamp without time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  transport_registry_id integer REFERENCES transport_registry(id) ON DELETE SET NULL,
  UNIQUE(organization_id, device_key)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_device_models_vendor ON device_models(vendor_id);
CREATE INDEX idx_device_registry_active ON device_registry(is_active) WHERE (is_active = true);
CREATE INDEX idx_device_registry_created_by ON device_registry(created_by);
CREATE INDEX idx_device_registry_eui ON device_registry(eui) WHERE (eui IS NOT NULL);
CREATE INDEX idx_device_registry_key ON device_registry(device_key);
CREATE INDEX idx_device_registry_mac ON device_registry(mac_address) WHERE (mac_address IS NOT NULL);
CREATE INDEX idx_device_registry_model ON device_registry(device_model_id);
CREATE INDEX idx_device_registry_org ON device_registry(organization_id);
CREATE INDEX idx_device_registry_public ON device_registry(is_public) WHERE (is_public = true);
CREATE INDEX idx_device_registry_status ON device_registry(connection_status);
CREATE INDEX idx_device_registry_team ON device_registry(team_id);
CREATE INDEX idx_device_registry_transport ON device_registry(transport_registry_id);
CREATE INDEX idx_organization_members_org ON organization_members(organization_id);
CREATE INDEX idx_organization_members_role ON organization_members(role_id);
CREATE INDEX idx_organization_members_status ON organization_members(invitation_status);
CREATE INDEX idx_organization_members_user ON organization_members(user_id);
CREATE INDEX idx_organizations_parent ON organizations(parent_id);
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_status ON organizations(status);
CREATE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_roles_scope ON roles(scope);
CREATE INDEX idx_team_members_role ON team_members(role_id);
CREATE INDEX idx_team_members_status ON team_members(invitation_status);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_teams_org ON teams(organization_id);
CREATE INDEX idx_teams_parent ON teams(parent_team_id);
CREATE INDEX idx_teams_slug ON teams(slug);
CREATE INDEX idx_transport_config_mqtt ON transport_config(mqtt_config_id) WHERE (config_type = 'mqtt');
CREATE INDEX idx_transport_config_http ON transport_config(http_config_id) WHERE (config_type = 'http');
CREATE INDEX idx_transport_config_grpc ON transport_config(grpc_config_id) WHERE (config_type = 'grpc');
CREATE INDEX idx_transport_config_type_id ON transport_config(transport_type_id);
CREATE INDEX idx_transport_grpc_config_type_id ON transport_grpc_config(transport_type_id);
CREATE INDEX idx_transport_http_config_type_id ON transport_http_config(transport_type_id);
CREATE INDEX idx_transport_mqtt_config_type_id ON transport_mqtt_config(transport_type_id);
CREATE INDEX idx_transport_registry_active ON transport_registry(is_active) WHERE (is_active = true);
CREATE INDEX idx_transport_registry_org ON transport_registry(organization_id);
CREATE INDEX idx_transport_registry_parser ON transport_registry(transport_parser_id);
CREATE INDEX idx_transport_registry_team ON transport_registry(team_id);
CREATE INDEX idx_transport_registry_type ON transport_registry(transport_type_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active);
