-- Fresh schema export from current database state
-- Generated from PostgreSQL 18.1 (pg_dump alternative method)
-- Includes all tables, indexes, constraints, and sequences


-- Table: device_models
CREATE TABLE IF NOT EXISTS device_models (
  id bigint NOT NULL DEFAULT nextval('device_models_id_seq'::regclass),
  vendor_id bigint NOT NULL,
  name character varying NOT NULL,
  code character varying NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: device_registry
CREATE TABLE IF NOT EXISTS device_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_key character varying NOT NULL,
  device_model_id bigint NOT NULL,
  eui character varying,
  mac_address character varying,
  created_by uuid NOT NULL,
  organization_id bigint NOT NULL,
  team_id bigint NOT NULL,
  lns_provider_id bigint,
  is_public boolean DEFAULT false,
  is_active boolean DEFAULT true,
  is_global boolean DEFAULT false,
  connection_status character varying DEFAULT 'disconnected'::character varying,
  last_heartbeat timestamp without time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  transport_registry_id integer
);

-- Table: device_registry_with_type
CREATE TABLE IF NOT EXISTS device_registry_with_type (
  id uuid,
  device_key character varying,
  device_model_id bigint,
  eui character varying,
  mac_address character varying,
  created_by uuid,
  organization_id bigint,
  team_id bigint,
  lns_provider_id bigint,
  is_public boolean,
  is_active boolean,
  is_global boolean,
  metadata jsonb,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  vendor_id bigint,
  device_model_name character varying,
  device_model_code character varying,
  vendor_name character varying,
  vendor_code character varying,
  device_protocol text
);

-- Table: device_vendors
CREATE TABLE IF NOT EXISTS device_vendors (
  id bigint NOT NULL DEFAULT nextval('device_vendors_id_seq'::regclass),
  name character varying NOT NULL,
  code character varying NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: organization_hierarchy
CREATE TABLE IF NOT EXISTS organization_hierarchy (
  id bigint,
  name character varying,
  parent_id bigint,
  org_type character varying,
  parent_name character varying,
  created_at timestamp without time zone
);

-- Table: organization_members
CREATE TABLE IF NOT EXISTS organization_members (
  id bigint NOT NULL DEFAULT nextval('organization_members_id_seq'::regclass),
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL,
  role_id bigint NOT NULL,
  invitation_status character varying DEFAULT 'accepted'::character varying,
  invited_by uuid,
  invited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  joined_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: organizations
CREATE TABLE IF NOT EXISTS organizations (
  id bigint NOT NULL DEFAULT nextval('organizations_id_seq'::regclass),
  name character varying NOT NULL,
  slug character varying NOT NULL,
  description text,
  status character varying DEFAULT 'active'::character varying,
  timezone character varying DEFAULT 'UTC'::character varying,
  is_public boolean DEFAULT false,
  parent_id bigint,
  org_type character varying DEFAULT 'standard'::character varying,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: roles
CREATE TABLE IF NOT EXISTS roles (
  id bigint NOT NULL DEFAULT nextval('roles_id_seq'::regclass),
  name character varying NOT NULL,
  scope character varying NOT NULL,
  permissions jsonb NOT NULL,
  is_system_role boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: team_hierarchy
CREATE TABLE IF NOT EXISTS team_hierarchy (
  id bigint,
  name character varying,
  organization_id bigint,
  parent_team_id bigint,
  parent_team_name character varying,
  created_at timestamp without time zone
);

-- Table: team_members
CREATE TABLE IF NOT EXISTS team_members (
  id bigint NOT NULL DEFAULT nextval('team_members_id_seq'::regclass),
  user_id uuid NOT NULL,
  team_id bigint NOT NULL,
  role_id bigint NOT NULL,
  invitation_status character varying DEFAULT 'accepted'::character varying,
  invited_by uuid,
  invited_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  joined_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: teams
CREATE TABLE IF NOT EXISTS teams (
  id bigint NOT NULL DEFAULT nextval('teams_id_seq'::regclass),
  organization_id bigint NOT NULL,
  name character varying NOT NULL,
  slug character varying NOT NULL,
  description text,
  status character varying DEFAULT 'active'::character varying,
  team_type character varying DEFAULT 'department'::character varying,
  parent_team_id bigint,
  is_public boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Table: transport_config
CREATE TABLE IF NOT EXISTS transport_config (
  id bigint NOT NULL DEFAULT nextval('transport_config_id_seq'::regclass),
  transport_type_id bigint NOT NULL,
  config_type character varying NOT NULL,
  mqtt_config_id bigint,
  http_config_id bigint,
  grpc_config_id bigint,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: transport_grpc_config
CREATE TABLE IF NOT EXISTS transport_grpc_config (
  id bigint NOT NULL DEFAULT nextval('transport_grpc_config_id_seq'::regclass),
  transport_type_id bigint NOT NULL,
  host character varying NOT NULL,
  port integer NOT NULL,
  service_name character varying NOT NULL,
  use_tls boolean NOT NULL DEFAULT true,
  tls_ca_cert text,
  tls_client_cert text,
  tls_client_key text,
  connection_timeout_sec integer NOT NULL DEFAULT 10,
  keep_alive_sec integer NOT NULL DEFAULT 30,
  keep_alive_timeout_sec integer NOT NULL DEFAULT 10,
  max_idle_conns integer NOT NULL DEFAULT 10,
  max_connections integer NOT NULL DEFAULT 100,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: transport_http_config
CREATE TABLE IF NOT EXISTS transport_http_config (
  id bigint NOT NULL DEFAULT nextval('transport_http_config_id_seq'::regclass),
  transport_type_id bigint NOT NULL,
  base_url character varying NOT NULL,
  method character varying NOT NULL DEFAULT 'POST'::character varying,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  auth_type character varying NOT NULL DEFAULT 'none'::character varying,
  auth_credentials character varying,
  use_tls boolean NOT NULL DEFAULT true,
  tls_ca_cert text,
  tls_client_cert text,
  tls_client_key text,
  tls_skip_verify boolean NOT NULL DEFAULT false,
  timeout_sec integer NOT NULL DEFAULT 30,
  content_type character varying NOT NULL DEFAULT 'application/json'::character varying,
  retry_count integer NOT NULL DEFAULT 3,
  retry_delay_sec integer NOT NULL DEFAULT 5,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: transport_mqtt_config
CREATE TABLE IF NOT EXISTS transport_mqtt_config (
  id bigint NOT NULL DEFAULT nextval('transport_mqtt_config_id_seq'::regclass),
  transport_type_id bigint NOT NULL,
  host character varying NOT NULL,
  port integer NOT NULL,
  username character varying,
  password character varying,
  qos smallint NOT NULL DEFAULT 1,
  clean_session boolean NOT NULL DEFAULT false,
  keep_alive_sec integer NOT NULL DEFAULT 60,
  connection_timeout_sec integer NOT NULL DEFAULT 10,
  use_tls boolean NOT NULL DEFAULT false,
  tls_ca_cert text,
  tls_client_cert text,
  tls_client_key text,
  tls_skip_verify boolean NOT NULL DEFAULT false,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_reconnect_interval_sec integer NOT NULL DEFAULT 10,
  created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: transport_parser
CREATE TABLE IF NOT EXISTS transport_parser (
  id integer NOT NULL DEFAULT nextval('transport_parser_id_seq'::regclass),
  code character varying NOT NULL,
  display_name character varying NOT NULL,
  description text,
  is_builtin boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now()
);

-- Table: transport_registry
CREATE TABLE IF NOT EXISTS transport_registry (
  id bigint NOT NULL DEFAULT nextval('transport_registry_id_seq'::regclass),
  name character varying NOT NULL,
  description text,
  organization_id bigint NOT NULL,
  team_id bigint,
  transport_type_id integer NOT NULL,
  is_global boolean DEFAULT false,
  is_active boolean DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  updated_by uuid,
  transport_parser_id integer NOT NULL,
  transport_config_id bigint NOT NULL
);

-- Table: transport_type
CREATE TABLE IF NOT EXISTS transport_type (
  id integer NOT NULL DEFAULT nextval('transport_type_id_seq'::regclass),
  code character varying NOT NULL,
  display_name character varying NOT NULL,
  description text,
  created_at timestamp without time zone DEFAULT now()
);

-- Table: user_permissions
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id uuid,
  email character varying,
  organization_id bigint,
  organization_name character varying,
  org_role_name character varying,
  org_permissions jsonb,
  team_id bigint,
  team_name character varying,
  team_role_name character varying,
  team_permissions jsonb
);

-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email character varying NOT NULL,
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

-- Indexes
CREATE INDEX idx_device_registry_active ON public.device_registry USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_device_registry_created_by ON public.device_registry USING btree (created_by);
CREATE INDEX idx_device_registry_eui ON public.device_registry USING btree (eui) WHERE (eui IS NOT NULL);
CREATE INDEX idx_device_registry_key ON public.device_registry USING btree (device_key);
CREATE INDEX idx_device_registry_mac ON public.device_registry USING btree (mac_address) WHERE (mac_address IS NOT NULL);
CREATE INDEX idx_device_registry_model ON public.device_registry USING btree (device_model_id);
CREATE INDEX idx_device_registry_org ON public.device_registry USING btree (organization_id);
CREATE INDEX idx_device_registry_provider ON public.device_registry USING btree (lns_provider_id);
CREATE INDEX idx_device_registry_public ON public.device_registry USING btree (is_public) WHERE (is_public = true);
CREATE INDEX idx_device_registry_status ON public.device_registry USING btree (connection_status);
CREATE INDEX idx_device_registry_team ON public.device_registry USING btree (team_id);
CREATE INDEX idx_device_registry_transport ON public.device_registry USING btree (transport_registry_id);
CREATE INDEX idx_organization_members_invitation_status ON public.organization_members USING btree (invitation_status);
CREATE INDEX idx_organization_members_organization_id ON public.organization_members USING btree (organization_id);
CREATE INDEX idx_organization_members_role_id ON public.organization_members USING btree (role_id);
CREATE INDEX idx_organization_members_user_id ON public.organization_members USING btree (user_id);
CREATE INDEX idx_organizations_parent_id ON public.organizations USING btree (parent_id);
CREATE INDEX idx_organizations_slug ON public.organizations USING btree (slug);
CREATE INDEX idx_organizations_status ON public.organizations USING btree (status);
CREATE INDEX idx_roles_name ON public.roles USING btree (name);
CREATE INDEX idx_roles_scope ON public.roles USING btree (scope);
CREATE INDEX idx_team_members_invitation_status ON public.team_members USING btree (invitation_status);
CREATE INDEX idx_team_members_role_id ON public.team_members USING btree (role_id);
CREATE INDEX idx_team_members_team_id ON public.team_members USING btree (team_id);
CREATE INDEX idx_team_members_user_id ON public.team_members USING btree (user_id);
CREATE INDEX idx_teams_organization_id ON public.teams USING btree (organization_id);
CREATE INDEX idx_teams_parent_team_id ON public.teams USING btree (parent_team_id);
CREATE INDEX idx_teams_slug ON public.teams USING btree (slug);
CREATE INDEX idx_transport_config_grpc ON public.transport_config USING btree (grpc_config_id) WHERE ((config_type)::text = 'grpc'::text);
CREATE INDEX idx_transport_config_http ON public.transport_config USING btree (http_config_id) WHERE ((config_type)::text = 'http'::text);
CREATE INDEX idx_transport_config_mqtt ON public.transport_config USING btree (mqtt_config_id) WHERE ((config_type)::text = 'mqtt'::text);
CREATE INDEX idx_transport_config_type_id ON public.transport_config USING btree (transport_type_id);
CREATE INDEX idx_transport_grpc_config_type_id ON public.transport_grpc_config USING btree (transport_type_id);
CREATE INDEX idx_transport_http_config_type_id ON public.transport_http_config USING btree (transport_type_id);
CREATE INDEX idx_transport_mqtt_config_type_id ON public.transport_mqtt_config USING btree (transport_type_id);
CREATE INDEX idx_transport_registry_active ON public.transport_registry USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_transport_registry_org ON public.transport_registry USING btree (organization_id);
CREATE INDEX idx_transport_registry_parser ON public.transport_registry USING btree (transport_parser_id);
CREATE INDEX idx_transport_registry_team ON public.transport_registry USING btree (team_id);
CREATE INDEX idx_transport_registry_type ON public.transport_registry USING btree (transport_type_id);
CREATE INDEX idx_users_email ON public.users USING btree (email);
CREATE INDEX idx_users_is_active ON public.users USING btree (is_active);