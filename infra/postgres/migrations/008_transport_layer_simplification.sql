-- Migration 008: Transport Layer Simplification
-- Extends device_providers and transport_endpoints for database-driven configuration
-- Implements worker pool pattern for unified transport management

-- ============================================================
-- STEP 1: Extend device_providers table
-- ============================================================

ALTER TABLE device_providers ADD COLUMN IF NOT EXISTS protocol_type VARCHAR(50);
ALTER TABLE device_providers ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Map existing providers to protocol types
UPDATE device_providers SET protocol_type = 'mqtt' WHERE code IN ('chirpstack', 'mqtt_direct');
UPDATE device_providers SET protocol_type = 'grpc' WHERE code IN ('storio-cli', 'v2n', 'reserve');
UPDATE device_providers SET protocol_type = 'http_server' WHERE code = 'everynet';
UPDATE device_providers SET protocol_type = 'http_client' WHERE code = 'schneider';

-- ============================================================
-- STEP 2: Extend transport_endpoints table
-- ============================================================

ALTER TABLE transport_endpoints ADD COLUMN IF NOT EXISTS protocol_type VARCHAR(50);
ALTER TABLE transport_endpoints ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Verify columns exist
-- SELECT adrelname, attname FROM pg_attribute WHERE attname IN ('protocol_type', 'config');

-- ============================================================
-- STEP 3: Ensure team_device_providers has needed columns
-- ============================================================

ALTER TABLE team_device_providers ADD COLUMN IF NOT EXISTS priority INT DEFAULT 0;
ALTER TABLE team_device_providers ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;
ALTER TABLE team_device_providers ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';
ALTER TABLE team_device_providers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ============================================================
-- STEP 4: Create comprehensive worker discovery view
-- ============================================================

DROP VIEW IF EXISTS team_device_providers_view CASCADE;

CREATE VIEW team_device_providers_view AS
SELECT
  tdp.id as team_provider_id,
  t.id as team_id,
  t.name as team_name,
  o.id as organization_id,
  o.name as organization_name,
  tdp.device_provider_id,
  dp.name as provider_name,
  dp.code as provider_code,
  dp.protocol_type,
  te.id as transport_endpoint_id,
  te.host || ':' || COALESCE(te.port::text, '1883') as broker_addr,
  te.host,
  COALESCE(te.port, 1883) as port,
  te.protocol_type as endpoint_protocol_type,
  COALESCE(tdp.config, '{}') as team_config,
  COALESCE(te.config, '{}') as endpoint_config,
  COALESCE(dp.config, '{}') as provider_config,
  tdp.is_active,
  COALESCE(tdp.is_primary, false) as is_primary,
  COALESCE(tdp.priority, 0) as priority,
  COUNT(dr.id) FILTER (WHERE dr.is_active = true) as active_device_count,
  tdp.created_at
FROM team_device_providers tdp
JOIN teams t ON tdp.team_id = t.id
JOIN organizations o ON t.organization_id = o.id
JOIN device_providers dp ON tdp.device_provider_id = dp.id
LEFT JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
LEFT JOIN device_registry dr ON dr.team_id = t.id
  AND dr.lns_provider_id = dp.id 
  AND dr.is_active = true
WHERE tdp.is_active = true
GROUP BY
  tdp.id, t.id, t.name, o.id, o.name, tdp.device_provider_id,
  dp.name, dp.code, dp.protocol_type, te.id, te.host, te.port,
  te.protocol_type, tdp.config, te.config, dp.config,
  tdp.is_active, tdp.is_primary, tdp.priority, tdp.created_at
ORDER BY dp.protocol_type, t.name, tdp.priority DESC;

-- ============================================================
-- STEP 5: Create transport worker configuration table
-- ============================================================

CREATE TABLE IF NOT EXISTS transport_worker_config (
  id BIGSERIAL PRIMARY KEY,
  worker_id VARCHAR(255) UNIQUE NOT NULL,
  transport_type VARCHAR(50) NOT NULL,
  team_id BIGINT NOT NULL,
  provider_id BIGINT NOT NULL,
  broker_addr VARCHAR(500) NOT NULL,
  credentials JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  config JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending', -- pending, connecting, active, failed, stopped
  last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  message_count BIGINT DEFAULT 0,
  error_count BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (provider_id) REFERENCES device_providers(id),
  INDEX (transport_type, status),
  INDEX (team_id, provider_id)
);

-- ============================================================
-- STEP 6: Create transport worker metrics table
-- ============================================================

CREATE TABLE IF NOT EXISTS transport_worker_metrics (
  id BIGSERIAL PRIMARY KEY,
  worker_id VARCHAR(255) NOT NULL,
  transport_type VARCHAR(50) NOT NULL,
  team_id BIGINT NOT NULL,
  messages_processed BIGINT DEFAULT 0,
  messages_failed BIGINT DEFAULT 0,
  last_message_at TIMESTAMP,
  cpu_percent FLOAT DEFAULT 0.0,
  memory_mb INT DEFAULT 0,
  uptime_seconds INT DEFAULT 0,
  metric_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  INDEX (worker_id, metric_timestamp),
  INDEX (transport_type, metric_timestamp)
);

-- ============================================================
-- STEP 7: Create ingest message format table for tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS ingest_messages (
  id BIGSERIAL PRIMARY KEY,
  worker_id VARCHAR(255) NOT NULL,
  transport_type VARCHAR(50) NOT NULL,
  team_id BIGINT NOT NULL,
  device_key VARCHAR(255),
  payload JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMP,
  latency_ms INT,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  INDEX (worker_id, processed_at),
  INDEX (device_key, processed_at),
  INDEX (transport_type, processed_at)
) PARTITION BY RANGE (EXTRACT(YEAR FROM processed_at), EXTRACT(MONTH FROM processed_at));

-- ============================================================
-- STEP 8: Grant permissions on new objects
-- ============================================================

GRANT SELECT ON team_device_providers_view TO zc8;
GRANT SELECT, INSERT, UPDATE ON transport_worker_config TO zc8;
GRANT SELECT, INSERT, UPDATE ON transport_worker_metrics TO zc8;
GRANT INSERT ON ingest_messages TO zc8;

-- ============================================================
-- STEP 9: Insert demo data for initial testing
-- ============================================================

-- Ensure device_providers exist with protocol_type
INSERT INTO device_providers (name, code, protocol_type, is_active)
VALUES
  ('ChirpStack', 'chirpstack', 'mqtt', true),
  ('Direct MQTT', 'mqtt_direct', 'mqtt', true),
  ('Storio CLI', 'storio-cli', 'grpc', true),
  ('V2N', 'v2n', 'grpc', true),
  ('Everynet', 'everynet', 'http_server', true),
  ('Schneider Cloud', 'schneider', 'http_client', true)
ON CONFLICT (code) DO UPDATE SET protocol_type = EXCLUDED.protocol_type;

-- Ensure transport endpoints exist
INSERT INTO transport_endpoints (name, host, port, protocol_type)
VALUES
  ('ChirpStack Network Server 2', 'networkserver2.maua.br', 1883, 'mqtt'),
  ('Maua Direct MQTT', 'mqtt.maua.br', 1883, 'mqtt'),
  ('Storio CLI Server', 'localhost', 50051, 'grpc'),
  ('V2N Server', 'localhost', 50052, 'grpc'),
  ('Everynet HTTP', 'api.everynet.io', 443, 'http_server'),
  ('Schneider Cloud HTTP', 'cloud.schneider.com', 443, 'http_client')
ON CONFLICT (host, port) DO UPDATE SET protocol_type = EXCLUDED.protocol_type;

-- ============================================================
-- STEP 10: Log migration completion
-- ============================================================

-- Migration successfully applied
-- Key changes:
-- 1. device_providers extended with protocol_type and config
-- 2. transport_endpoints extended with protocol_type and config
-- 3. team_device_providers extended with priority, is_primary, config, is_active
-- 4. team_device_providers_view created for worker discovery
-- 5. transport_worker_config table created for state tracking
-- 6. transport_worker_metrics table created for observability
-- 7. ingest_messages table created for message tracking
--
-- Next steps:
-- 1. Populate team_device_providers with team → provider → endpoint mappings
-- 2. Deploy WorkerPool implementation
-- 3. Configure MQTT adapters
-- 4. Configure gRPC adapters
-- 5. Configure HTTP adapters
-- 6. Start unified ingest processor
