-- Migration 024: Ingest Registry Pattern
--
-- Mirrors the transport_registry pattern for ingest destinations.
-- Each organization/team can register multiple ingest targets:
-- - InfluxDB3 instances (primary storage, with optional write ACK)
-- - Redis instances (last-N readings hash, fire-and-forget)
-- - NATS instances (real-time streaming, fire-and-forget)
--
-- The DeviceContext (resolved at transport layer via 3-tier cache)
-- carries ingest_routing info so the ingest engine has ZERO DB lookups
-- on the hot path.

-- ============================================================================
-- SEQUENCES
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS ingest_type_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ingest_influxdb_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ingest_redis_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ingest_nats_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ingest_config_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ingest_registry_id_seq START 1;

-- ============================================================================
-- INGEST TYPE (enum-like reference table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_type (
  id integer NOT NULL DEFAULT nextval('ingest_type_id_seq'::regclass) PRIMARY KEY,
  code varchar NOT NULL UNIQUE,          -- 'influxdb3', 'redis', 'nats'
  display_name varchar NOT NULL,
  description text,
  created_at timestamp DEFAULT now()
);

-- Seed ingest types
INSERT INTO ingest_type (code, display_name, description) VALUES
  ('influxdb3', 'InfluxDB 3', 'InfluxDB 3.x time-series storage'),
  ('redis', 'Redis', 'Redis hash for last-N readings and real-time state'),
  ('nats', 'NATS', 'NATS pub/sub for real-time event streaming')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- TYPED INGEST CONFIGURATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_influxdb_config (
  id bigint NOT NULL DEFAULT nextval('ingest_influxdb_config_id_seq'::regclass) PRIMARY KEY,
  host varchar(255) NOT NULL,
  port int NOT NULL DEFAULT 8086 CHECK (port > 0 AND port < 65536),
  token varchar(1024) NOT NULL,
  influxdb_org varchar(255) NOT NULL,         -- InfluxDB organization (not our org)
  bucket varchar(255) NOT NULL,
  measurement varchar(255) NOT NULL DEFAULT 'telemetry',
  use_tls boolean NOT NULL DEFAULT false,
  write_precision varchar(10) NOT NULL DEFAULT 'ns' 
    CHECK (write_precision IN ('ns', 'us', 'ms', 's')),
  batch_size int NOT NULL DEFAULT 5000 CHECK (batch_size > 0),
  flush_interval_ms int NOT NULL DEFAULT 1000 CHECK (flush_interval_ms > 0),
  max_retries int NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  retry_delay_ms int NOT NULL DEFAULT 500 CHECK (retry_delay_ms > 0),
  workers int NOT NULL DEFAULT 4 CHECK (workers > 0 AND workers <= 64),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingest_redis_config (
  id bigint NOT NULL DEFAULT nextval('ingest_redis_config_id_seq'::regclass) PRIMARY KEY,
  host varchar(255) NOT NULL,
  port int NOT NULL DEFAULT 6379 CHECK (port > 0 AND port < 65536),
  password varchar(255),
  db int NOT NULL DEFAULT 0 CHECK (db >= 0 AND db <= 15),
  max_hash_entries int NOT NULL DEFAULT 100 CHECK (max_hash_entries > 0),
  key_prefix varchar(100) NOT NULL DEFAULT 'telemetry',
  key_ttl_seconds int NOT NULL DEFAULT 86400 CHECK (key_ttl_seconds > 0),
  pool_size int NOT NULL DEFAULT 10 CHECK (pool_size > 0),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ingest_nats_config (
  id bigint NOT NULL DEFAULT nextval('ingest_nats_config_id_seq'::regclass) PRIMARY KEY,
  url varchar(1024) NOT NULL,
  subject_prefix varchar(255) NOT NULL DEFAULT 'telemetry',
  max_payload_bytes int NOT NULL DEFAULT 1048576 CHECK (max_payload_bytes > 0),
  username varchar(255),
  password varchar(255),
  use_tls boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- POLYMORPHIC FK TABLE (same pattern as transport_config)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_config (
  id bigint NOT NULL DEFAULT nextval('ingest_config_id_seq'::regclass) PRIMARY KEY,
  ingest_type_id int NOT NULL REFERENCES ingest_type(id) ON DELETE RESTRICT,
  config_type varchar(20) NOT NULL CHECK (config_type IN ('influxdb', 'redis', 'nats')),
  influxdb_config_id bigint REFERENCES ingest_influxdb_config(id) ON DELETE RESTRICT,
  redis_config_id bigint REFERENCES ingest_redis_config(id) ON DELETE RESTRICT,
  nats_config_id bigint REFERENCES ingest_nats_config(id) ON DELETE RESTRICT,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Exactly one config must be set and match config_type
  CONSTRAINT ingest_config_type_check CHECK (
    (config_type = 'influxdb' AND influxdb_config_id IS NOT NULL 
      AND redis_config_id IS NULL AND nats_config_id IS NULL)
    OR (config_type = 'redis' AND redis_config_id IS NOT NULL 
      AND influxdb_config_id IS NULL AND nats_config_id IS NULL)
    OR (config_type = 'nats' AND nats_config_id IS NOT NULL 
      AND influxdb_config_id IS NULL AND redis_config_id IS NULL)
  )
);

-- ============================================================================
-- INGEST REGISTRY (mirrors transport_registry)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingest_registry (
  id bigint NOT NULL DEFAULT nextval('ingest_registry_id_seq'::regclass) PRIMARY KEY,
  name varchar NOT NULL,
  description text,
  organization_id bigint NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id bigint REFERENCES teams(id) ON DELETE CASCADE,
  ingest_type_id int NOT NULL REFERENCES ingest_type(id) ON DELETE RESTRICT,
  ingest_config_id bigint NOT NULL REFERENCES ingest_config(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  is_global boolean NOT NULL DEFAULT false,
  write_confirmation boolean NOT NULL DEFAULT false,
  priority int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, name)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ingest_config_type ON ingest_config(config_type);
CREATE INDEX IF NOT EXISTS idx_ingest_config_influxdb ON ingest_config(influxdb_config_id) 
  WHERE config_type = 'influxdb';
CREATE INDEX IF NOT EXISTS idx_ingest_config_redis ON ingest_config(redis_config_id) 
  WHERE config_type = 'redis';
CREATE INDEX IF NOT EXISTS idx_ingest_config_nats ON ingest_config(nats_config_id) 
  WHERE config_type = 'nats';

CREATE INDEX IF NOT EXISTS idx_ingest_registry_org ON ingest_registry(organization_id);
CREATE INDEX IF NOT EXISTS idx_ingest_registry_team ON ingest_registry(team_id);
CREATE INDEX IF NOT EXISTS idx_ingest_registry_type ON ingest_registry(ingest_type_id);
CREATE INDEX IF NOT EXISTS idx_ingest_registry_active ON ingest_registry(is_active) 
  WHERE is_active = true;

-- ============================================================================
-- VIEW: Denormalized ingest config for fast lookups (used by 3-tier cache warm)
-- ============================================================================

CREATE OR REPLACE VIEW v_ingest_routing AS
SELECT
  ir.id AS ingest_registry_id,
  ir.name,
  ir.organization_id,
  ir.team_id,
  ir.is_active,
  ir.is_global,
  ir.write_confirmation,
  ir.priority,
  it.code AS ingest_type_code,
  ic.config_type,
  -- InfluxDB fields (NULL if not influxdb)
  iic.host AS influxdb_host,
  iic.port AS influxdb_port,
  iic.token AS influxdb_token,
  iic.influxdb_org,
  iic.bucket AS influxdb_bucket,
  iic.measurement AS influxdb_measurement,
  iic.use_tls AS influxdb_use_tls,
  iic.batch_size AS influxdb_batch_size,
  iic.flush_interval_ms AS influxdb_flush_interval_ms,
  iic.workers AS influxdb_workers,
  -- Redis fields (NULL if not redis)
  irc.host AS redis_host,
  irc.port AS redis_port,
  irc.password AS redis_password,
  irc.db AS redis_db,
  irc.max_hash_entries AS redis_max_hash_entries,
  irc.key_prefix AS redis_key_prefix,
  irc.key_ttl_seconds AS redis_key_ttl_seconds,
  -- NATS fields (NULL if not nats)
  inc.url AS nats_url,
  inc.subject_prefix AS nats_subject_prefix,
  inc.username AS nats_username,
  inc.password AS nats_password
FROM ingest_registry ir
JOIN ingest_type it ON ir.ingest_type_id = it.id
JOIN ingest_config ic ON ir.ingest_config_id = ic.id
LEFT JOIN ingest_influxdb_config iic ON ic.influxdb_config_id = iic.id
LEFT JOIN ingest_redis_config irc ON ic.redis_config_id = irc.id
LEFT JOIN ingest_nats_config inc ON ic.nats_config_id = inc.id
WHERE ir.is_active = true
ORDER BY ir.organization_id, ir.priority DESC;
