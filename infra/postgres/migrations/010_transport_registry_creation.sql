-- Migration 010: Transport Registry Table Creation
-- Date: March 12, 2026
-- Purpose: Create transport_registry table (transport_type and parser_type already exist)

---------- TRANSPORT REGISTRY ----------

-- Stores INFRASTRUCTURE configuration (where/how to connect)
-- One transport can serve multiple devices with different parsers
CREATE TABLE IF NOT EXISTS transport_registry (
  id BIGSERIAL PRIMARY KEY,
  
  -- Identity
  name VARCHAR(255) NOT NULL,
  description TEXT,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id BIGINT,  -- NULL if is_global=true
  
  -- Transport type (mqtt, grpc, http, etc.)
  transport_type_id INTEGER NOT NULL REFERENCES transport_type(id),
  
  -- Scope
  is_global BOOLEAN DEFAULT false,  -- true = available to all teams in organization
  is_active BOOLEAN DEFAULT true,
  
  -- Configuration (JSON: host, port, username, password, topics, etc.)
  config JSONB NOT NULL DEFAULT '{}',
  
  -- Metadata
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Constraints
  UNIQUE(organization_id, team_id, name),
  CONSTRAINT valid_scope CHECK (
    (is_global = true AND team_id IS NULL) OR 
    (is_global = false AND team_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_transport_registry_org ON transport_registry(organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_registry_team ON transport_registry(team_id);
CREATE INDEX IF NOT EXISTS idx_transport_registry_type ON transport_registry(transport_type_id);
CREATE INDEX IF NOT EXISTS idx_transport_registry_active ON transport_registry(is_active) WHERE is_active = true;

---------- DEVICE REGISTRY MODIFICATIONS ----------

-- Add new columns to link devices to transport + parser
ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS transport_registry_id INTEGER REFERENCES transport_registry(id) ON DELETE SET NULL;
ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS parser_type_id INTEGER REFERENCES parser_type(id) ON DELETE SET NULL;

-- Create index for device lookup by transport
CREATE INDEX IF NOT EXISTS idx_device_registry_transport ON device_registry(transport_registry_id);
CREATE INDEX IF NOT EXISTS idx_device_registry_parser ON device_registry(parser_type_id);

---------- VIEWS ----------

-- View to get all available transports for a team (including global ones)
CREATE OR REPLACE VIEW team_available_transports AS
SELECT 
  tr.id,
  tr.name,
  tr.description,
  tr.organization_id,
  tr.team_id,
  tt.code as transport_type_code,
  tt.display_name as transport_type_name,
  tr.config,
  tr.is_global,
  tr.is_active,
  (CASE WHEN tr.is_global THEN 'Global' ELSE 'Team-Specific' END) as scope
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tr.is_active = true
ORDER BY tr.is_global DESC, tr.name;

-- View to get parser type options
CREATE OR REPLACE VIEW available_parsers AS
SELECT 
  id,
  code,
  display_name,
  description,
  is_builtin
FROM parser_type
WHERE is_builtin = true
ORDER BY display_name;

-- View to get device configuration with all relationships
CREATE OR REPLACE VIEW device_registry_detailed AS
SELECT 
  dr.id,
  dr.device_key,
  dr.eui,
  dr.mac_address,
  dr.team_id,
  dr.organization_id,
  t.name as team_name,
  o.name as organization_name,
  COALESCE(tr.name, '[No Transport]') as transport_name,
  COALESCE(tt.code, '[Unknown]') as transport_type,
  COALESCE(pt.code, 'default') as parser_type,
  COALESCE(pt.display_name, 'Default (Passthrough)') as parser_display_name,
  dr.is_active,
  dr.device_model_id,
  dr.created_at,
  dr.updated_at
FROM device_registry dr
LEFT JOIN teams t ON dr.team_id = t.id
LEFT JOIN organizations o ON dr.organization_id = o.id
LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id
LEFT JOIN transport_type tt ON tr.transport_type_id = tt.id
LEFT JOIN parser_type pt ON dr.parser_type_id = pt.id
ORDER BY dr.device_key;

-- Permission view: what transports can a team use?
CREATE OR REPLACE VIEW team_transport_permissions AS
SELECT DISTINCT
  t.id as team_id,
  t.name as team_name,
  t.organization_id,
  o.name as organization_name,
  tr.id as transport_registry_id,
  tr.name as transport_name,
  tr.description,
  tr.is_global,
  tt.code as transport_type_code,
  CASE 
    WHEN tr.is_global THEN 'Can use (org-wide)'
    WHEN tr.team_id = t.id THEN 'Can use (team-specific)'
    ELSE 'Cannot use'
  END as permission_level
FROM teams t
JOIN organizations o ON t.organization_id = o.id
JOIN transport_registry tr ON tr.organization_id = o.id
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tr.is_active = true
  AND (tr.is_global = true OR tr.team_id = t.id)
ORDER BY t.name, tr.name;

---------- SEED DATA ----------

-- Create default transports for testing (pick first admin user and first organization)
INSERT INTO transport_registry (
  name, description, organization_id, team_id, transport_type_id,
  is_global, is_active, config, created_by
)
SELECT 
  'Default MQTT Broker (ChirpStack)',
  'Primary MQTT broker for ChirpStack integration',
  o.id,
  NULL,
  (SELECT id FROM transport_type WHERE code = 'mqtt-subscriber' LIMIT 1),
  true,
  true,
  jsonb_build_object(
    'host', 'networkserver2.maua.br',
    'port', 1883,
    'username', 'default-user',
    'password', 'change-me',
    'topics', '["applications/+/devices/+/up"]'
  ),
  (SELECT id FROM users LIMIT 1)
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO transport_registry (
  name, description, organization_id, team_id, transport_type_id,
  is_global, is_active, config, created_by
)
SELECT 
  'Default HTTP Webhook Server',
  'HTTP server for receiving webhook callbacks',
  o.id,
  NULL,
  (SELECT id FROM transport_type WHERE code = 'http-server' LIMIT 1),
  true,
  true,
  jsonb_build_object(
    'listen_addr', '0.0.0.0',
    'listen_port', 8080,
    'path_prefix', '/webhooks'
  ),
  (SELECT id FROM users LIMIT 1)
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

---------- COMMENTS ----------

COMMENT ON TABLE transport_registry IS 'Infrastructure registry - WHERE/HOW to connect. Independent from parser strategy.';
COMMENT ON COLUMN transport_registry.is_global IS 'true = available to all teams in org; false = team-specific only';
COMMENT ON COLUMN device_registry.transport_registry_id IS 'FK to infrastructure (where device connects from)';
COMMENT ON COLUMN device_registry.parser_type_id IS 'FK to parser strategy (how to parse the message)';
