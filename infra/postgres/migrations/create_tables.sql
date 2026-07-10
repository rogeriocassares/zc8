-- ============================================================================
-- create_tables.sql — Final Schema State
-- ============================================================================
-- Synthesized from:
--   A) infra/postgres/migrations/001–034
--   B) apps/api/drizzle/0000–0016
--
-- Drizzle migrations (0000–0016) override infra migrations for the same tables.
-- Migration 0011 drops all transport_* tables; migration 0015 renames tables.
--
-- Table naming in final state:
--   device_registry       → devices
--   integration_registry  → integrations → services
--   integration_provider  → integration_providers → service_providers
--   plan_configurations   → user_plans_config
--   roles                 → user_roles
--
-- When mounted as docker-entrypoint-initdb.d/01_create_tables.sql, this file
-- runs as the postgres superuser on first container startup.
-- It creates the application user (zc8) and database (zc8), then creates all
-- tables inside it.
-- ============================================================================

-- ============================================================================
-- APPLICATION USER & DATABASE SETUP
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zc8') THEN
    CREATE USER zc8 WITH PASSWORD 'zc8';
  END IF;
END
$$;

SELECT 'CREATE DATABASE zc8 OWNER zc8'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'zc8')\gexec

-- Connect to the application database for all subsequent DDL
\c zc8

GRANT ALL ON SCHEMA public TO zc8;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO zc8;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO zc8;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO zc8;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO zc8;
-- zc8 is the application user; RLS is enforced at the application layer via JWT.
-- BYPASSRLS lets the API perform server-side ops (onUserCreated, etc.) freely.
ALTER ROLE zc8 BYPASSRLS;

-- ============================================================================
-- ROLES & EXTENSIONS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api LOGIN PASSWORD 'app_api_password';
  END IF;
END
$$;

-- ============================================================================
-- USERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  email           VARCHAR(255)  NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  first_name      VARCHAR(255),
  last_name       VARCHAR(255),
  phone           VARCHAR(50),
  avatar_url      TEXT,
  role            VARCHAR(20)   NOT NULL DEFAULT 'user',
  plan            VARCHAR(50)   NOT NULL DEFAULT 'user',
  email_verified  BOOLEAN       DEFAULT false,
  is_active       BOOLEAN       DEFAULT true,
  created_at      TIMESTAMP     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_users_email     ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users (is_active);

-- ============================================================================
-- ORGANIZATIONS
-- ============================================================================
-- Notes:
--   • plan column removed (Drizzle 0004)
--   • parent_id, org_type removed (infra 033)
--   • domain, logo_url added (Drizzle 0001)

CREATE TABLE IF NOT EXISTS organizations (
  id          BIGSERIAL    PRIMARY KEY NOT NULL,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id    UUID         REFERENCES users(id) ON DELETE RESTRICT,
  status      VARCHAR(20)  DEFAULT 'active',
  timezone    VARCHAR(100) DEFAULT 'UTC',
  is_public   BOOLEAN      DEFAULT false,
  domain      VARCHAR(255),
  logo_url    TEXT,
  created_at  TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT organizations_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug   ON organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations (status);

-- ============================================================================
-- USER_ROLES  (was: roles)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_roles (
  id             BIGSERIAL    PRIMARY KEY NOT NULL,
  name           VARCHAR(100) NOT NULL,
  scope          VARCHAR(50)  NOT NULL,
  description    TEXT,
  permissions    JSONB        NOT NULL,
  is_system_role BOOLEAN      DEFAULT false,
  created_at     TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_name_unique UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_name  ON user_roles (name);
CREATE INDEX IF NOT EXISTS idx_user_roles_scope ON user_roles (scope);

-- ============================================================================
-- TEAMS
-- ============================================================================
-- Notes:
--   • parent_team_id removed (infra 034)

CREATE TABLE IF NOT EXISTS teams (
  id              BIGSERIAL    PRIMARY KEY NOT NULL,
  organization_id BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(20)  DEFAULT 'active',
  team_type       VARCHAR(50)  DEFAULT 'department',
  is_public       BOOLEAN      DEFAULT false,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_org_team_slug UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_teams_org  ON teams (organization_id);
CREATE INDEX IF NOT EXISTS idx_teams_slug ON teams (slug);

-- ============================================================================
-- ORGANIZATION_MEMBERS  (memberships)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_members (
  id                BIGSERIAL   PRIMARY KEY NOT NULL,
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id   BIGINT      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id           BIGINT      NOT NULL REFERENCES user_roles(id) ON DELETE RESTRICT,
  is_approved       BOOLEAN     DEFAULT false,
  invitation_status VARCHAR(20) DEFAULT 'pending',
  invited_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  invited_at        TIMESTAMP   DEFAULT now(),
  joined_at         TIMESTAMP,
  created_at        TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP   NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_org UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user   ON organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org    ON organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_role   ON organization_members (role_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_status ON organization_members (invitation_status);

-- ============================================================================
-- TEAM_MEMBERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS team_members (
  id                BIGSERIAL   PRIMARY KEY NOT NULL,
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id           BIGINT      NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_id           BIGINT      NOT NULL REFERENCES user_roles(id) ON DELETE RESTRICT,
  invitation_status VARCHAR(20) DEFAULT 'accepted',
  invited_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  invited_at        TIMESTAMP   DEFAULT now(),
  joined_at         TIMESTAMP,
  created_at        TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP   NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_team UNIQUE (user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user   ON team_members (user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team   ON team_members (team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_role   ON team_members (role_id);
CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members (invitation_status);

-- ============================================================================
-- USER_PLANS_CONFIG  (was: plan_configurations)
-- ============================================================================
-- Notes:
--   • max_subteams_per_team, allow_sub_teams removed (Drizzle 0003)
--   • max_apps_per_team, max_devices_per_team added (Drizzle 0003)
--   • max_members_per_org added (Drizzle 0009)

CREATE TABLE IF NOT EXISTS user_plans_config (
  plan                 VARCHAR(50)  PRIMARY KEY,
  max_orgs             INTEGER      NOT NULL DEFAULT -1,
  max_teams_per_org    INTEGER      NOT NULL DEFAULT -1,
  max_apps_per_team    INTEGER      NOT NULL DEFAULT -1,
  max_devices_per_team INTEGER      NOT NULL DEFAULT -1,
  max_members_per_org  INTEGER      NOT NULL DEFAULT -1,
  updated_at           TIMESTAMP    NOT NULL DEFAULT now(),
  updated_by           UUID         REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================================
-- DEVICE_VENDORS
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_vendors (
  id          BIGSERIAL    PRIMARY KEY NOT NULL,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(100) NOT NULL,
  description TEXT,
  created_at  TIMESTAMP    DEFAULT now(),
  updated_at  TIMESTAMP    DEFAULT now(),
  CONSTRAINT device_vendors_code_unique UNIQUE (code)
);

-- ============================================================================
-- DEVICE_MODELS
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_models (
  id          BIGSERIAL    PRIMARY KEY NOT NULL,
  vendor_id   BIGINT       NOT NULL REFERENCES device_vendors(id) ON DELETE RESTRICT,
  name        VARCHAR(255) NOT NULL,
  code        VARCHAR(100) NOT NULL,
  description TEXT,
  device_type VARCHAR(50)  NOT NULL DEFAULT 'other',
  created_at  TIMESTAMP    DEFAULT now(),
  updated_at  TIMESTAMP    DEFAULT now(),
  CONSTRAINT uq_vendor_model_code UNIQUE (vendor_id, code)
);
ALTER TABLE device_models ADD COLUMN IF NOT EXISTS device_type VARCHAR(50) NOT NULL DEFAULT 'other';

CREATE INDEX IF NOT EXISTS idx_device_models_vendor ON device_models (vendor_id);

-- ============================================================================
-- DEVICE_SENSORS
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_sensors (
  id              BIGSERIAL    PRIMARY KEY NOT NULL,
  device_model_id BIGINT       NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
  sensor_type     VARCHAR(100) NOT NULL,
  unit            VARCHAR(50),
  value_type      VARCHAR(10)  NOT NULL DEFAULT 'float',
  description     TEXT,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_device_model_sensor UNIQUE (device_model_id, sensor_type)
);

CREATE INDEX IF NOT EXISTS idx_device_sensors_model ON device_sensors (device_model_id);
CREATE INDEX IF NOT EXISTS idx_device_sensors_type  ON device_sensors (sensor_type);

-- ============================================================================
-- SERVICE_PROVIDERS  (was: integration_provider → integration_providers → service_providers)
-- ============================================================================
-- Merges the old lns_provider table (is_lns flag marks LoRaWAN network servers).

CREATE TABLE IF NOT EXISTS service_providers (
  id                       SERIAL        PRIMARY KEY NOT NULL,
  code                     VARCHAR(100)  NOT NULL,
  display_name             VARCHAR(255)  NOT NULL,
  description              TEXT,
  is_builtin               BOOLEAN       DEFAULT true,
  is_lns                   BOOLEAN       NOT NULL DEFAULT false,
  default_subscribe_topics JSONB         NOT NULL DEFAULT '[]',
  created_at               TIMESTAMP     DEFAULT now(),
  CONSTRAINT service_providers_code_unique UNIQUE (code)
);

-- ============================================================================
-- SERVICES  (was: integration_registry → integrations → services)
-- ============================================================================
-- service_type values:
--   input.mqtt, input.http-server, input.grpc-server,
--   input.grpc-pull, input.http-pull, input.influxdb3,
--   output.mqtt, output.grpc-push, output.http-push,
--   output.influxdb3, output.clickhouse

CREATE TABLE IF NOT EXISTS services (
  id              BIGSERIAL    PRIMARY KEY NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  service_type    VARCHAR(50)  NOT NULL,
  organization_id BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id         BIGINT       REFERENCES teams(id) ON DELETE CASCADE,
  provider_id     INTEGER      REFERENCES service_providers(id) ON DELETE SET NULL,
  is_lorawan      BOOLEAN      NOT NULL DEFAULT false,
  is_global       BOOLEAN      DEFAULT false,
  is_active       BOOLEAN      DEFAULT true,
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP    DEFAULT now(),
  updated_at      TIMESTAMP    DEFAULT now(),
  CONSTRAINT uq_services_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_services_org          ON services (organization_id);
CREATE INDEX IF NOT EXISTS idx_services_team         ON services (team_id);
CREATE INDEX IF NOT EXISTS idx_services_service_type ON services (service_type);
CREATE INDEX IF NOT EXISTS idx_services_active       ON services (is_active);

-- ============================================================================
-- SERVICE CONFIG TABLES — INPUT
-- ============================================================================

-- INPUT: MQTT subscriber
CREATE TABLE IF NOT EXISTS service_input_mqtt_config (
  id                         BIGSERIAL     PRIMARY KEY NOT NULL,
  service_id                 BIGINT        NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host                       VARCHAR(255)  NOT NULL,
  port                       INTEGER       NOT NULL DEFAULT 1883,
  username                   VARCHAR(255),
  password                   VARCHAR(255),
  qos                        SMALLINT      NOT NULL DEFAULT 1,
  clean_session              BOOLEAN       NOT NULL DEFAULT false,
  keep_alive_sec             INTEGER       NOT NULL DEFAULT 60,
  connection_timeout_sec     INTEGER       NOT NULL DEFAULT 10,
  use_tls                    BOOLEAN       NOT NULL DEFAULT false,
  tls_ca_cert                TEXT,
  tls_client_cert            TEXT,
  tls_client_key             TEXT,
  tls_skip_verify            BOOLEAN       NOT NULL DEFAULT false,
  max_reconnect_interval_sec INTEGER       NOT NULL DEFAULT 10,
  subscribe_topics           JSONB         NOT NULL DEFAULT '[]',
  publish_topic_template     VARCHAR(1024) NOT NULL DEFAULT 'devices/{device_key}/command',
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- INPUT: HTTP server (webhook listener)
CREATE TABLE IF NOT EXISTS service_input_httpserver_config (
  id               BIGSERIAL    PRIMARY KEY NOT NULL,
  service_id       BIGINT       NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  listen_path      VARCHAR(255) NOT NULL DEFAULT '/ingest',
  headers          JSONB        NOT NULL DEFAULT '{}',
  auth_type        VARCHAR(50)  NOT NULL DEFAULT 'none',
  auth_credentials VARCHAR(1024),
  use_tls          BOOLEAN      NOT NULL DEFAULT false,
  tls_ca_cert      TEXT,
  tls_cert         TEXT,
  tls_key          TEXT,
  tls_skip_verify  BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- INPUT: HTTP pull (polling client)
CREATE TABLE IF NOT EXISTS service_input_httppull_config (
  id               BIGSERIAL     PRIMARY KEY NOT NULL,
  service_id       BIGINT        NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  base_url         VARCHAR(2048) NOT NULL,
  method           VARCHAR(10)   NOT NULL DEFAULT 'GET',
  headers          JSONB         NOT NULL DEFAULT '{}',
  timeout_sec      INTEGER       NOT NULL DEFAULT 30,
  content_type     VARCHAR(100)  DEFAULT 'application/json',
  retry_count      INTEGER       NOT NULL DEFAULT 3,
  retry_delay_sec  INTEGER       NOT NULL DEFAULT 5,
  auth_type        VARCHAR(50)   NOT NULL DEFAULT 'none',
  auth_credentials VARCHAR(1024),
  use_tls          BOOLEAN       NOT NULL DEFAULT false,
  tls_ca_cert      TEXT,
  tls_cert         TEXT,
  tls_key          TEXT,
  tls_skip_verify  BOOLEAN       NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- INPUT: gRPC server (listens for incoming connections)
CREATE TABLE IF NOT EXISTS service_input_grpcserver_config (
  id                     BIGSERIAL    PRIMARY KEY NOT NULL,
  service_id             BIGINT       NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host                   VARCHAR(255) NOT NULL DEFAULT '0.0.0.0',
  port                   INTEGER      NOT NULL DEFAULT 50051,
  service_name           VARCHAR(255) NOT NULL DEFAULT '',
  use_tls                BOOLEAN      NOT NULL DEFAULT false,
  tls_ca_cert            TEXT,
  tls_cert               TEXT,
  tls_key                TEXT,
  max_connection_age_sec INTEGER      DEFAULT 0,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- INPUT: gRPC pull (client that connects to remote gRPC server)
CREATE TABLE IF NOT EXISTS service_input_grpcpull_config (
  id                     BIGSERIAL    PRIMARY KEY NOT NULL,
  service_id             BIGINT       NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host                   VARCHAR(255) NOT NULL,
  port                   INTEGER      NOT NULL DEFAULT 50051,
  service_name           VARCHAR(255) NOT NULL DEFAULT '',
  use_tls                BOOLEAN      NOT NULL DEFAULT false,
  tls_ca_cert            TEXT,
  tls_cert               TEXT,
  tls_key                TEXT,
  connection_timeout_sec INTEGER      NOT NULL DEFAULT 10,
  keep_alive_sec         INTEGER      NOT NULL DEFAULT 60,
  keep_alive_timeout_sec INTEGER      NOT NULL DEFAULT 20,
  max_idle_conns         INTEGER      NOT NULL DEFAULT 10,
  max_connections        INTEGER      NOT NULL DEFAULT 100,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ============================================================================
-- SERVICE CONFIG TABLES — OUTPUT
-- ============================================================================

-- OUTPUT: MQTT publisher
CREATE TABLE IF NOT EXISTS service_output_mqtt_config (
  id                         BIGSERIAL     PRIMARY KEY NOT NULL,
  service_id                 BIGINT        NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host                       VARCHAR(255)  NOT NULL,
  port                       INTEGER       NOT NULL DEFAULT 1883,
  username                   VARCHAR(255),
  password                   VARCHAR(255),
  qos                        SMALLINT      NOT NULL DEFAULT 1,
  clean_session              BOOLEAN       NOT NULL DEFAULT false,
  keep_alive_sec             INTEGER       NOT NULL DEFAULT 60,
  connection_timeout_sec     INTEGER       NOT NULL DEFAULT 10,
  use_tls                    BOOLEAN       NOT NULL DEFAULT false,
  tls_ca_cert                TEXT,
  tls_client_cert            TEXT,
  tls_client_key             TEXT,
  tls_skip_verify            BOOLEAN       NOT NULL DEFAULT false,
  max_reconnect_interval_sec INTEGER       NOT NULL DEFAULT 10,
  publish_topic_template     VARCHAR(1024) NOT NULL DEFAULT 'devices/{device_key}/data',
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- OUTPUT: gRPC push (client that forwards data to remote gRPC server)
CREATE TABLE IF NOT EXISTS service_output_grpcpush_config (
  id                     BIGSERIAL    PRIMARY KEY NOT NULL,
  service_id             BIGINT       NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host                   VARCHAR(255) NOT NULL,
  port                   INTEGER      NOT NULL DEFAULT 50051,
  service_name           VARCHAR(255) NOT NULL DEFAULT '',
  use_tls                BOOLEAN      NOT NULL DEFAULT false,
  tls_ca_cert            TEXT,
  tls_cert               TEXT,
  tls_key                TEXT,
  connection_timeout_sec INTEGER      NOT NULL DEFAULT 10,
  keep_alive_sec         INTEGER      NOT NULL DEFAULT 60,
  keep_alive_timeout_sec INTEGER      NOT NULL DEFAULT 20,
  max_idle_conns         INTEGER      NOT NULL DEFAULT 10,
  max_connections        INTEGER      NOT NULL DEFAULT 100,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- OUTPUT: HTTP push (POST to remote endpoint)
CREATE TABLE IF NOT EXISTS service_output_httppush_config (
  id               BIGSERIAL     PRIMARY KEY NOT NULL,
  service_id       BIGINT        NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  base_url         VARCHAR(2048) NOT NULL,
  method           VARCHAR(10)   NOT NULL DEFAULT 'POST',
  headers          JSONB         NOT NULL DEFAULT '{}',
  timeout_sec      INTEGER       NOT NULL DEFAULT 30,
  content_type     VARCHAR(100)  DEFAULT 'application/json',
  retry_count      INTEGER       NOT NULL DEFAULT 3,
  retry_delay_sec  INTEGER       NOT NULL DEFAULT 5,
  auth_type        VARCHAR(50)   NOT NULL DEFAULT 'none',
  auth_credentials VARCHAR(1024),
  use_tls          BOOLEAN       NOT NULL DEFAULT false,
  tls_ca_cert      TEXT,
  tls_cert         TEXT,
  tls_key          TEXT,
  tls_skip_verify  BOOLEAN       NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- OUTPUT: InfluxDB 3 writer
CREATE TABLE IF NOT EXISTS service_output_influxdb3_config (
  id                BIGSERIAL     PRIMARY KEY NOT NULL,
  service_id        BIGINT        NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host              VARCHAR(255)  NOT NULL,
  port              INTEGER       NOT NULL DEFAULT 8086,
  token             VARCHAR(1024) NOT NULL DEFAULT '',
  influxdb_org      VARCHAR(255)  NOT NULL DEFAULT '',
  bucket            VARCHAR(255)  NOT NULL,
  measurement       VARCHAR(255)  NOT NULL DEFAULT 'telemetry',
  use_tls           BOOLEAN       NOT NULL DEFAULT false,
  write_precision   VARCHAR(10)   NOT NULL DEFAULT 'ns',
  batch_size        INTEGER       NOT NULL DEFAULT 5000,
  flush_interval_ms INTEGER       NOT NULL DEFAULT 1000,
  max_retries       INTEGER       NOT NULL DEFAULT 3,
  retry_delay_ms    INTEGER       NOT NULL DEFAULT 500,
  workers           INTEGER       NOT NULL DEFAULT 4,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- OUTPUT: ClickHouse writer
CREATE TABLE IF NOT EXISTS service_output_clickhouse_config (
  id                BIGSERIAL    PRIMARY KEY NOT NULL,
  service_id        BIGINT       NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host              VARCHAR(255) NOT NULL,
  port              INTEGER      NOT NULL DEFAULT 9000,
  database          VARCHAR(255) NOT NULL DEFAULT 'default',
  username          VARCHAR(255) NOT NULL DEFAULT 'default',
  password          VARCHAR(255) NOT NULL DEFAULT '',
  table_name        VARCHAR(255) NOT NULL DEFAULT 'telemetry',
  use_tls           BOOLEAN      NOT NULL DEFAULT false,
  batch_size        INTEGER      NOT NULL DEFAULT 1000,
  flush_interval_ms INTEGER      NOT NULL DEFAULT 1000,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- INPUT: InfluxDB3 query source (reads telemetry FROM InfluxDB3 into the platform)
CREATE TABLE IF NOT EXISTS service_input_influxdb3_config (
  id                BIGSERIAL     PRIMARY KEY NOT NULL,
  service_id        BIGINT        NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  host              VARCHAR(255)  NOT NULL,
  port              INTEGER       NOT NULL DEFAULT 8086,
  token             VARCHAR(1024) NOT NULL DEFAULT '',
  influxdb_org      VARCHAR(255)  NOT NULL DEFAULT '',
  bucket            VARCHAR(255)  NOT NULL,
  measurement       VARCHAR(255)  NOT NULL DEFAULT 'telemetry',
  use_tls           BOOLEAN       NOT NULL DEFAULT false,
  write_precision   VARCHAR(10)   NOT NULL DEFAULT 'ns',
  batch_size        INTEGER       NOT NULL DEFAULT 5000,
  flush_interval_ms INTEGER       NOT NULL DEFAULT 1000,
  max_retries       INTEGER       NOT NULL DEFAULT 3,
  retry_delay_ms    INTEGER       NOT NULL DEFAULT 500,
  workers           INTEGER       NOT NULL DEFAULT 4,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ============================================================================
-- DEVICES  (was: device_registry)
-- ============================================================================
-- Notes:
--   • eui renamed to dev_eui (infra 025)
--   • device_type added (Drizzle 0000, infra 025 adds NOT NULL constraint)
--   • is_persistent added (Drizzle 0000 / infra 025)
--   • transport_registry_id removed (Drizzle 0011)
--   • ingest_profile_id removed (Drizzle 0006)
--   • integration_id added in 0011, renamed to service_id in 0015
--   • influxdb_config_id added in 0010, removed in 0015
--   • lns_provider_id FK now references service_providers (Drizzle 0012)
--   • visibility added (Drizzle 0007)
--   • device_type check constraint (infra 025)

CREATE TABLE IF NOT EXISTS devices (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  device_key        VARCHAR(255) NOT NULL,
  device_model_id   BIGINT       NOT NULL REFERENCES device_models(id) ON DELETE RESTRICT,
  device_type       VARCHAR(50)  NOT NULL DEFAULT 'lorawan',
  dev_eui           VARCHAR(16),
  mac_address       VARCHAR(17),
  created_by        UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  organization_id   BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id           BIGINT       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  service_id        BIGINT       REFERENCES services(id) ON DELETE SET NULL,
  lns_provider_id   BIGINT       REFERENCES service_providers(id) ON DELETE SET NULL,
  is_persistent     BOOLEAN      DEFAULT false,
  is_public         BOOLEAN      DEFAULT false,
  is_active         BOOLEAN      DEFAULT true,
  is_global         BOOLEAN      DEFAULT false,
  connection_status VARCHAR(50)  DEFAULT 'disconnected',
  last_heartbeat    TIMESTAMP,
  metadata          JSONB        DEFAULT '{}'::jsonb,
  visibility        VARCHAR(20)  NOT NULL DEFAULT 'team',
  created_at        TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_devices_org_key UNIQUE (organization_id, device_key),
  CONSTRAINT chk_device_type_identifier CHECK (
    (device_type = 'lorawan' AND dev_eui IS NOT NULL)
    OR (device_type = 'ip'   AND mac_address IS NOT NULL)
    OR (device_type = 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_devices_key         ON devices (device_key);
CREATE INDEX IF NOT EXISTS idx_devices_org         ON devices (organization_id);
CREATE INDEX IF NOT EXISTS idx_devices_team        ON devices (team_id);
CREATE INDEX IF NOT EXISTS idx_devices_model       ON devices (device_model_id);
CREATE INDEX IF NOT EXISTS idx_devices_dev_eui     ON devices (dev_eui)          WHERE dev_eui IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_mac         ON devices (mac_address)      WHERE mac_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_active      ON devices (is_active)        WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_devices_public      ON devices (is_public)        WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_devices_status      ON devices (connection_status);
CREATE INDEX IF NOT EXISTS idx_devices_created_by  ON devices (created_by);
CREATE INDEX IF NOT EXISTS idx_devices_service     ON devices (service_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_type ON devices (device_type);
CREATE INDEX IF NOT EXISTS idx_devices_persistent  ON devices (is_persistent)    WHERE is_persistent = true;

-- ============================================================================
-- COMMAND_FORMATTER
-- ============================================================================

CREATE TABLE IF NOT EXISTS command_formatter (
  id                   SERIAL       PRIMARY KEY NOT NULL,
  transport_type_code  VARCHAR(30)  NOT NULL,
  lns_provider_code    VARCHAR(50),
  formatter_code       VARCHAR(100) NOT NULL,
  description          TEXT,
  is_active            BOOLEAN      NOT NULL DEFAULT true,
  created_at           TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_transport_lns_formatter UNIQUE (transport_type_code, lns_provider_code)
);

-- ============================================================================
-- COMMAND_LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS command_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  device_id        UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  device_key       VARCHAR(255) NOT NULL,
  command_type     VARCHAR(100) NOT NULL,
  payload          JSONB        NOT NULL DEFAULT '{}',
  status           VARCHAR(30)  NOT NULL DEFAULT 'pending',
  transport_type   VARCHAR(30)  NOT NULL,
  lns_provider_code VARCHAR(50),
  error_message    TEXT,
  attempts         INTEGER      NOT NULL DEFAULT 0,
  max_attempts     INTEGER      NOT NULL DEFAULT 3,
  created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT now(),
  dispatched_at    TIMESTAMP,
  delivered_at     TIMESTAMP,
  acked_at         TIMESTAMP,
  expires_at       TIMESTAMP,
  metadata         JSONB        DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_command_log_device     ON command_log (device_id);
CREATE INDEX IF NOT EXISTS idx_command_log_status     ON command_log (status) WHERE status IN ('pending', 'dispatched');
CREATE INDEX IF NOT EXISTS idx_command_log_created    ON command_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_log_device_key ON command_log (device_key);

-- ============================================================================
-- APPLICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS applications (
  id          BIGSERIAL    PRIMARY KEY NOT NULL,
  team_id     BIGINT       NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(20)  NOT NULL DEFAULT 'active',
  visibility  VARCHAR(20)  NOT NULL DEFAULT 'team',
  redis_cache_size INTEGER NOT NULL DEFAULT 1,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_team_app_slug UNIQUE (team_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_applications_team   ON applications (team_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);

-- ============================================================================
-- APPLICATION_DEVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS application_devices (
  id             BIGSERIAL  PRIMARY KEY NOT NULL,
  application_id BIGINT     NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  device_id      UUID       NOT NULL REFERENCES devices(id)      ON DELETE CASCADE,
  assigned_at    TIMESTAMP  NOT NULL DEFAULT now(),
  assigned_by    UUID       REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_app_device UNIQUE (application_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_app_devices_app    ON application_devices (application_id);
CREATE INDEX IF NOT EXISTS idx_app_devices_device ON application_devices (device_id);

-- ============================================================================
-- APPLICATION_SENSOR_TYPES
-- ============================================================================

CREATE TABLE IF NOT EXISTS application_sensor_types (
  id             BIGSERIAL    PRIMARY KEY NOT NULL,
  application_id BIGINT       NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sensor_type    VARCHAR(100) NOT NULL,
  -- Visibility controls who can read this sensor type:
  --   'team'   = only the owning team (default)
  --   'org'    = all teams in the same organisation
  --   'public' = all authenticated users across all orgs
  visibility     VARCHAR(20)  NOT NULL DEFAULT 'team',
  is_public      BOOLEAN      NOT NULL DEFAULT false,
  created_at     TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_app_sensor_type    UNIQUE (application_id, sensor_type),
  CONSTRAINT chk_ast_visibility    CHECK  (visibility IN ('team','org','public'))
);

CREATE INDEX IF NOT EXISTS idx_app_sensor_types_app        ON application_sensor_types (application_id);
CREATE INDEX IF NOT EXISTS idx_app_sensor_types_sensor     ON application_sensor_types (sensor_type);
CREATE INDEX IF NOT EXISTS idx_app_sensor_types_visibility ON application_sensor_types (visibility);
CREATE INDEX IF NOT EXISTS idx_app_sensor_types_public     ON application_sensor_types (is_public) WHERE is_public = true;

-- Back-fill helper: if the table already exists (re-run scenario), add columns if missing.
ALTER TABLE application_sensor_types
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS is_public  BOOLEAN     NOT NULL DEFAULT false;

-- Add check constraint if not already present (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_ast_visibility'
      AND conrelid = 'application_sensor_types'::regclass
  ) THEN
    ALTER TABLE application_sensor_types
      ADD CONSTRAINT chk_ast_visibility CHECK (visibility IN ('team','org','public'));
  END IF;
END $$;

-- ============================================================================
-- APPLICATION_SENSOR_VALUES
-- ============================================================================

CREATE TABLE IF NOT EXISTS application_sensor_values (
  id             BIGSERIAL               PRIMARY KEY NOT NULL,
  application_id BIGINT                  NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sensor_type    VARCHAR(100)            NOT NULL,
  sensor_value   JSONB,
  recorded_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asv_app_sensor   ON application_sensor_values (application_id, sensor_type);
CREATE INDEX IF NOT EXISTS idx_asv_recorded_at  ON application_sensor_values (application_id, sensor_type, recorded_at DESC);

-- ============================================================================
-- DEVICE_PROFILES  (templates: default service assignments + parser config)
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_profiles (
  id              BIGSERIAL    PRIMARY KEY NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  team_id         BIGINT       REFERENCES teams(id)         ON DELETE CASCADE,
  organization_id BIGINT       REFERENCES organizations(id) ON DELETE CASCADE,
  is_global       BOOLEAN      NOT NULL DEFAULT false,
  metadata        JSONB        NOT NULL DEFAULT '{}',
  created_by      UUID         REFERENCES users(id)         ON DELETE SET NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_profiles_team ON device_profiles (team_id);
CREATE INDEX IF NOT EXISTS idx_device_profiles_org  ON device_profiles (organization_id);

-- ============================================================================
-- DEVICE_SERVICES  (many-to-many: devices ↔ services with role + priority)
-- ============================================================================
-- A device can have multiple input services (one per integration / LNS)
-- and multiple output services (InfluxDB, MQTT publisher, etc.).
-- The role column distinguishes them:
--   'input'  – the service that receives raw data from this device
--   'output' – the service that forwards processed data from this device
--
-- This replaces/extends the single devices.service_id FK which remains
-- for backward-compatibility but should be treated as the primary input.

CREATE TABLE IF NOT EXISTS device_services (
  id         BIGSERIAL    PRIMARY KEY NOT NULL,
  device_id  UUID         NOT NULL REFERENCES devices(id)   ON DELETE CASCADE,
  service_id BIGINT       NOT NULL REFERENCES services(id)  ON DELETE CASCADE,
  role       VARCHAR(20)  NOT NULL DEFAULT 'input'
               CHECK (role IN ('input', 'output')),
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  priority   INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_device_service UNIQUE (device_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_device_services_device  ON device_services (device_id);
CREATE INDEX IF NOT EXISTS idx_device_services_service ON device_services (service_id);
CREATE INDEX IF NOT EXISTS idx_device_services_role    ON device_services (role);

CREATE TABLE IF NOT EXISTS application_nats_credentials (
  id              BIGSERIAL    PRIMARY KEY NOT NULL,
  application_id  BIGINT       NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  nkey_public     VARCHAR(65)  NOT NULL,
  nkey_seed       TEXT         NOT NULL,
  nats_jwt        TEXT         NOT NULL,
  creds           TEXT         NOT NULL,
  sub_permissions JSONB        NOT NULL DEFAULT '[]',
  pub_permissions JSONB        NOT NULL DEFAULT '[]',
  expires_at      TIMESTAMP,
  created_at      TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_application_nats_credentials UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_app_nats_creds_app ON application_nats_credentials (application_id);

-- ============================================================================
-- INTEGRATION_PROFILES  (reusable input+output routing bundles per org)
-- ============================================================================
-- An integration profile bundles the set of input services (where data comes
-- from) and output services (where data goes) that apply to every device in an
-- application.  Assigning a profile to an application is the ONLY way to route
-- telemetry to output adapters — no per-device overrides, no service defaults.

CREATE TABLE IF NOT EXISTS integration_profiles (
  id          BIGSERIAL    PRIMARY KEY NOT NULL,
  org_id      BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_global   BOOLEAN      NOT NULL DEFAULT false,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_integration_profile_org_name UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_integration_profiles_org ON integration_profiles (org_id);

-- ============================================================================
-- INTEGRATION_PROFILE_SERVICES  (profile ↔ services M2M)
-- ============================================================================
-- Links a profile to one or more services with a role ('input' or 'output') and
-- an optional MQTT/HTTP topic template.  The template supports {device_key} as a
-- placeholder; if NULL the service-configured default topic is used.

CREATE TABLE IF NOT EXISTS integration_profile_services (
  id             BIGSERIAL     PRIMARY KEY NOT NULL,
  profile_id     BIGINT        NOT NULL REFERENCES integration_profiles(id) ON DELETE CASCADE,
  service_id     BIGINT        NOT NULL REFERENCES services(id)             ON DELETE CASCADE,
  role           VARCHAR(10)   NOT NULL CHECK (role IN ('input', 'output')),
  priority       INTEGER       NOT NULL DEFAULT 0,
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  topic_template VARCHAR(1024),
  CONSTRAINT uq_profile_service_role UNIQUE (profile_id, service_id, role)
);

CREATE INDEX IF NOT EXISTS idx_ips_profile  ON integration_profile_services (profile_id);
CREATE INDEX IF NOT EXISTS idx_ips_service  ON integration_profile_services (service_id);
CREATE INDEX IF NOT EXISTS idx_ips_role     ON integration_profile_services (role);

-- ============================================================================
-- DEVICE_MODEL_ALLOWED_INPUTS  (model → valid input protocols + providers)
-- ============================================================================
-- Constrains which input service types and LNS providers a device model may use.
-- provider_code='' means "any provider of this service_type is allowed".

CREATE TABLE IF NOT EXISTS device_model_allowed_inputs (
  device_model_id BIGINT       NOT NULL REFERENCES device_models(id) ON DELETE CASCADE,
  service_type    VARCHAR(50)  NOT NULL,
  provider_code   VARCHAR(100) NOT NULL DEFAULT '',
  PRIMARY KEY (device_model_id, service_type, provider_code)
);

CREATE INDEX IF NOT EXISTS idx_dmai_model ON device_model_allowed_inputs (device_model_id);

-- ============================================================================
-- ALTER APPLICATIONS: add integration_profile_id FK
-- (DEPRECATED: column no longer used — routing is done via NATS subject scope)
-- ============================================================================

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS integration_profile_id BIGINT
    REFERENCES integration_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_applications_profile ON applications (integration_profile_id);

-- Drop integration_profile_id from applications (routing via NATS subject scope)
ALTER TABLE applications DROP COLUMN IF EXISTS integration_profile_id;

-- ============================================================================
-- ALTER APPLICATION_DEVICES: allow a device to belong to many applications
-- ============================================================================

ALTER TABLE application_devices DROP CONSTRAINT IF EXISTS uq_app_device;

-- ============================================================================
-- DEPRECATE devices.service_id  (orphaned FK — use device_services instead)
-- ============================================================================

COMMENT ON COLUMN devices.service_id IS
  'DEPRECATED: single-service FK replaced by device_services M2M table. '
  'This column is kept for backward-compatibility and will be dropped in a future release.';

-- ============================================================================
-- VIEWS
-- ============================================================================

-- v_device_ingest_routing: Device identity + service info for the ingest pipeline.
-- go-integration/device_lookup.go queries this view. Legacy routing columns
-- (influxdb/redis/nats config IDs) are provided as NULL stubs since output routing
-- is now handled by the services layer via the TELEMETRY JetStream stream.

CREATE OR REPLACE VIEW v_device_ingest_routing AS
SELECT
  d.id::text                    AS device_id,
  d.device_key,
  d.dev_eui,
  dm.code                       AS device_model_code,
  dv.id                         AS vendor_id,
  d.team_id,
  t.organization_id,
  d.is_active,
  -- Legacy ingest routing fields (deprecated; output routing via JetStream services)
  NULL::bigint                  AS influxdb_config_id,
  false                         AS influxdb_write_enabled,
  false                         AS influxdb_require_ack,
  NULL::text                    AS influxdb_host,
  0::int                        AS influxdb_port,
  NULL::text                    AS influxdb_token,
  NULL::text                    AS influxdb_bucket,
  'telemetry'                   AS influxdb_measurement,
  NULL::bigint                  AS redis_config_id,
  false                         AS redis_write_enabled,
  10::int                       AS redis_max_hash_entries,
  NULL::text                    AS redis_host,
  0::int                        AS redis_port,
  NULL::text                    AS redis_key_prefix,
  NULL::bigint                  AS nats_config_id,
  false                         AS nats_write_enabled,
  NULL::text                    AS nats_url,
  NULL::text                    AS nats_subject_prefix
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_vendors dv ON dm.vendor_id = dv.id
JOIN teams t ON d.team_id = t.id;

-- v_device_command_routing: Resolves device → input service → command formatter
-- Used by the command dispatch pipeline to route downlink commands to devices.
-- Corrected from Drizzle 0016 (which referenced stale transport_* tables dropped in 0011).

CREATE OR REPLACE VIEW v_device_command_routing AS
SELECT
  -- Device identity
  d.id               AS device_id,
  d.device_key,
  d.dev_eui          AS eui,
  d.mac_address,
  d.organization_id,
  d.team_id,
  dm.code            AS device_model_code,
  dv.code            AS vendor_code,

  -- Input service
  svc.id             AS service_id,
  svc.name           AS service_name,
  svc.service_type,

  -- LNS provider (for LoRaWAN devices; determines formatter)
  sp.code            AS lns_provider_code,
  sp.display_name    AS lns_provider_name,

  -- MQTT input config (populated when service_type = 'input.mqtt')
  simc.host                   AS mqtt_host,
  simc.port                   AS mqtt_port,
  simc.username               AS mqtt_username,
  simc.password               AS mqtt_password,
  simc.qos                    AS mqtt_qos,
  simc.use_tls                AS mqtt_use_tls,
  simc.subscribe_topics       AS mqtt_topics,
  simc.publish_topic_template AS mqtt_publish_topic,

  -- HTTP server config (populated when service_type = 'input.http-server')
  sihsc.listen_path  AS http_listen_path,
  sihsc.auth_type    AS http_auth_type,

  -- gRPC server config (populated when service_type = 'input.grpc-server')
  sigsc.host         AS grpc_host,
  sigsc.port         AS grpc_port,
  sigsc.service_name AS grpc_service_name,

  -- Command formatter (resolved by transport type + LNS provider)
  cf.formatter_code,

  -- Device metadata (may contain app_id, command_topic, etc.)
  d.metadata         AS device_metadata,

  -- Input service ID for NATS subject routing:
  -- NATS subject: commands.dispatch.{transport_type}.{service_id}
  svc.id             AS mqtt_input_service_id

FROM devices d
JOIN device_models dm              ON d.device_model_id = dm.id
JOIN device_vendors dv             ON dm.vendor_id = dv.id
LEFT JOIN service_providers sp     ON d.lns_provider_id = sp.id
LEFT JOIN services svc             ON d.service_id = svc.id AND svc.is_active = true
LEFT JOIN service_input_mqtt_config      simc  ON simc.service_id  = svc.id
LEFT JOIN service_input_httpserver_config sihsc ON sihsc.service_id = svc.id
LEFT JOIN service_input_grpcserver_config sigsc ON sigsc.service_id = svc.id
-- Formatter: match transport type string + optional LNS provider
LEFT JOIN command_formatter cf ON (
  cf.transport_type_code = CASE
    WHEN svc.service_type = 'input.mqtt'        THEN 'mqtt'
    WHEN svc.service_type = 'input.grpc-server' THEN 'grpc'
    WHEN svc.service_type = 'input.grpc-pull'   THEN 'grpc'
    WHEN svc.service_type = 'input.http-server' THEN 'http'
    WHEN svc.service_type = 'input.http-pull'   THEN 'http'
    ELSE NULL
  END
  AND (
    cf.lns_provider_code = sp.code
    OR (cf.lns_provider_code IS NULL AND sp.code IS NULL)
  )
  AND cf.is_active = true
)
WHERE d.is_active = true;

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================================
-- API connects as app_api role and sets:
--   SET LOCAL app.org_id       = '<org_id>';
--   SET LOCAL app.is_super_admin = 'true';   -- for superAdmin users

GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES   TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_api;

-- Transport Registry
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_services ON services
  USING (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- Devices
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_devices ON devices
  USING (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- Teams
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_teams ON teams
  USING (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- Organization Members
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_org_members ON organization_members
  USING (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    organization_id = current_setting('app.org_id', true)::bigint
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- Team Members (scoped through team → org)
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_team_members ON team_members
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_members.team_id
        AND (
          t.organization_id = current_setting('app.org_id', true)::bigint
          OR current_setting('app.is_super_admin', true) = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = team_members.team_id
        AND (
          t.organization_id = current_setting('app.org_id', true)::bigint
          OR current_setting('app.is_super_admin', true) = 'true'
        )
    )
  );

-- ============================================================================
-- TEAM → INTEGRATION PROFILE FK
-- ============================================================================
-- A team is assigned exactly one integration profile.  Every device in that
-- team inherits the profile's input and output services automatically.
-- Setting integration_profile_id = NULL means the team is not yet wired to
-- any services (all adapter messages for that team are dropped).

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS integration_profile_id BIGINT
    REFERENCES integration_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_teams_profile ON teams (integration_profile_id);

-- ============================================================================
-- LEGACY CLEANUP
-- ============================================================================
-- Drop device_model_allowed_inputs — never queried at runtime.
DROP TABLE IF EXISTS device_model_allowed_inputs;

-- Drop device_profiles — superseded by integration_profiles.
DROP TABLE IF EXISTS device_profiles;

-- NOTE: device_services is KEPT — it is the per-device M2M routing table.
-- Each row routes a specific device to a specific service.
-- Profiles are templates that populate device_services rows; they do not replace it.

-- Drop legacy single-service FK from devices (replaced by device_services M2M).
ALTER TABLE devices DROP COLUMN IF EXISTS service_id;
ALTER TABLE devices DROP COLUMN IF EXISTS lns_provider_id;

-- ============================================================================
-- ============================================================================
-- DEVICE LOCATION + ASSET TAGS
-- ============================================================================
-- Physical placement and asset classification for a device.
-- These values are resolved at the transport layer (LRU cache) and attached to
-- every decoded payload as InfluxDB tags so queries can filter by location or
-- asset without joining back to Postgres.

CREATE TABLE IF NOT EXISTS device_tags (
  device_id      UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  -- Physical location
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  altitude_m     DOUBLE PRECISION,
  location_name  VARCHAR(255),
  -- Asset classification (used as InfluxDB tags)
  asset_id       VARCHAR(255),               -- arbitrary asset identifier
  category       VARCHAR(50),               -- e.g. 'energy', 'water', 'hvac', 'environment'
  -- Generic extra tags (key-value pairs serialised as JSONB)
  extra_tags     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMP    NOT NULL DEFAULT now(),
  updated_at     TIMESTAMP    NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_tags_asset    ON device_tags (asset_id)   WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_tags_category ON device_tags (category)   WHERE category IS NOT NULL;

-- ============================================================================
-- SENSOR CALIBRATION  (per device-sensor, latest value = current calibration)
-- ============================================================================
-- Each row defines the linear transform: calibrated = raw * scale + offset.
-- The transport layer caches these alongside device context so every decoded
-- message carries a calibration snapshot without hitting Postgres on the hot path.

CREATE TABLE IF NOT EXISTS sensor_calibrations (
  id             BIGSERIAL    PRIMARY KEY NOT NULL,
  device_id      UUID         NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  sensor_type    VARCHAR(100) NOT NULL,
  scale          DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  offset         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  unit           VARCHAR(50),
  valid_from     TIMESTAMP    NOT NULL DEFAULT now(),
  valid_until    TIMESTAMP,                -- NULL = currently active
  created_at     TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT uq_sensor_calibration_active UNIQUE (device_id, sensor_type, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_sensor_calib_device ON sensor_calibrations (device_id);
CREATE INDEX IF NOT EXISTS idx_sensor_calib_sensor ON sensor_calibrations (device_id, sensor_type);
CREATE INDEX IF NOT EXISTS idx_sensor_calib_active ON sensor_calibrations (device_id, sensor_type, valid_until)
  WHERE valid_until IS NULL;

-- ============================================================================
-- NATS STREAM CONFIGURATION
-- ============================================================================
-- Three durable JetStream streams replace the old TELEMETRY + TELEMETRY_REALTIME
-- Core-subject hybrid.  All data is now auditable with per-stream retention.
--
-- Stream subjects (created/updated by each Go service and the API on startup):
--   DATA:  data.{orgId}.{teamId}.{deviceKey}.raw
--          data.{orgId}.{teamId}.{deviceKey}.decoded
--   SVC:   svc.{orgId}.{svcId}
--   CMD:   cmd.{orgId}.{teamId}.{deviceKey}
--
-- This comment is informational — stream creation is done in Go/TypeScript code.

-- Command Log (scoped through device → org)
ALTER TABLE command_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE command_log FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_command_log ON command_log
  USING (
    EXISTS (
      SELECT 1 FROM devices d
      WHERE d.id = command_log.device_id
        AND (
          d.organization_id = current_setting('app.org_id', true)::bigint
          OR current_setting('app.is_super_admin', true) = 'true'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM devices d
      WHERE d.id = command_log.device_id
        AND (
          d.organization_id = current_setting('app.org_id', true)::bigint
          OR current_setting('app.is_super_admin', true) = 'true'
        )
    )
  );
