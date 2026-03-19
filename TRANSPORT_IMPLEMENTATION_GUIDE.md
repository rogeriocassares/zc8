# Transport Layer Implementation Guide

This guide provides the database schema, queries, and code structure needed to implement the simplified hybrid transport architecture.

---

## Part 1: Database Schema Setup

### Step 1: Extend device_providers Table

```sql
-- Add protocol_type column if not exists
ALTER TABLE device_providers ADD COLUMN IF NOT EXISTS protocol_type VARCHAR(50);
ALTER TABLE device_providers ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Update existing providers
UPDATE device_providers SET protocol_type = 'mqtt' WHERE code IN ('chirpstack', 'mqtt');
UPDATE device_providers SET protocol_type = 'grpc' WHERE code IN ('storio-cli', 'v2n');
UPDATE device_providers SET protocol_type = 'http_server' WHERE code = 'everynet';
UPDATE device_providers SET protocol_type = 'http_client' WHERE code = 'schneider';

-- Verify
SELECT id, name, code, protocol_type FROM device_providers;
```

### Step 2: Extend transport_endpoints Table

```sql
-- Add metadata for runtime configuration
ALTER TABLE transport_endpoints ADD COLUMN IF NOT EXISTS protocol_type VARCHAR(50);
ALTER TABLE transport_endpoints ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Example: ChirpStack endpoint
INSERT INTO transport_endpoints
  (name, host, port, protocol_type, config)
VALUES
  ('ChirpStack Network Server 2', 'networkserver2.maua.br', 1883, 'mqtt',
   jsonb_build_object('topics', '["applications/+/devices/+/up"]'));

-- Example: Direct MQTT broker
INSERT INTO transport_endpoints
  (name, host, port, protocol_type, config)
VALUES
  ('Maua Direct MQTT', 'mqtt.maua.br', 1883, 'mqtt',
   jsonb_build_object('topics', '["devices/+/telemetry"]'));

-- Example: HTTP Everynet endpoint
INSERT INTO transport_endpoints
  (name, host, port, protocol_type, config)
VALUES
  ('Everynet HTTP API', 'api.everynet.io', 443, 'http_server',
   jsonb_build_object('routes', '["POST /devices", "POST /events"]'));

-- Example: Schneider Cloud HTTP Client
INSERT INTO transport_endpoints
  (name, host, port, protocol_type, config)
VALUES
  ('Schneider Cloud', 'cloud.schneider.com', 443, 'http_client',
   jsonb_build_object('polling_interval', 60));
```

### Step 3: Update team_device_providers View

```sql
-- Create comprehensive view for worker discovery
CREATE OR REPLACE VIEW team_device_providers_view AS
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
  te.host || ':' || te.port as broker_addr,
  te.host,
  te.port,
  te.protocol_type as endpoint_protocol_type,
  COALESCE(tdp.config, '{}') as team_config,
  COALESCE(te.config, '{}') as endpoint_config,
  COALESCE(dp.config, '{}') as provider_config,
  tdp.is_active,
  tdp.is_primary,
  tdp.priority,
  COUNT(dr.id) FILTER (WHERE dr.is_active = true) as active_device_count
FROM team_device_providers tdp
JOIN teams t ON tdp.team_id = t.id
JOIN organizations o ON t.organization_id = o.id
JOIN device_providers dp ON tdp.device_provider_id = dp.id
JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
LEFT JOIN device_registry dr ON dr.team_id = t.id
  AND dr.lns_provider_id = dp.id AND dr.is_active = true
WHERE tdp.is_active = true
GROUP BY
  tdp.id, t.id, t.name, o.id, o.name, tdp.device_provider_id,
  dp.name, dp.code, dp.protocol_type, te.id, te.host, te.port,
  te.protocol_type, tdp.config, te.config, dp.config,
  tdp.is_active, tdp.is_primary, tdp.priority
ORDER BY dp.protocol_type, t.name, tdp.priority DESC;

-- Query it:
SELECT * FROM team_device_providers_view WHERE protocol_type = 'mqtt';
```

---

## Part 2: Worker Discovery Queries

### Query 1: Get MQTT Workers to Start

```sql
-- For MQTT worker pool discovery
SELECT
  team_provider_id,
  team_id,
  team_name,
  provider_name,
  broker_addr,
  team_config ->> 'username' as username,
  team_config ->> 'password' as password,
  endpoint_config -> 'topics' as topics,
  active_device_count
FROM team_device_providers_view
WHERE protocol_type = 'mqtt'
  AND is_active = true
ORDER BY team_id;

-- Result:
/*
team_provider_id │ team_id │ team_name  │ provider_name │ broker_addr              │ username    │ active_device_count
─────────────────┼─────────┼────────────┼───────────────┼─────────────────────────┼─────────────┼────────────────────
1                │ 1       │ GMS        │ ChirpStack    │ networkserver2.maua.br  │ gms-user    │ 3
2                │ 2       │ MauaRacing │ ChirpStack    │ networkserver2.maua.br  │ mr-user     │ 2
3                │ 3       │ Teams      │ MQTT Direct   │ mqtt.maua.br:1883       │ teams-user  │ 3
4                │ 4       │ RaceTracks │ MQTT Direct   │ mqtt.maua.br:1883       │ rt-user     │ 2
5                │ 5       │ Committee  │ MQTT Direct   │ mqtt.maua.br:1883       │ comm-user   │ 1
*/
```

### Query 2: Get HTTP Server Workers to Start

```sql
SELECT
  team_provider_id,
  team_id,
  team_name,
  provider_name,
  broker_addr,
  endpoint_config -> 'routes' as routes,
  team_config ->> 'api_key' as api_key
FROM team_device_providers_view
WHERE protocol_type = 'http_server'
  AND is_active = true
ORDER BY team_id;
```

### Query 3: Get HTTP Client Workers to Start

```sql
SELECT
  team_provider_id,
  team_id,
  team_name,
  provider_name,
  broker_addr,
  endpoint_config ->> 'polling_interval' as polling_interval,
  team_config ->> 'token' as token,
  active_device_count
FROM team_device_providers_view
WHERE protocol_type = 'http_client'
  AND is_active = true
ORDER BY team_id;
```

### Query 4: Get gRPC Workers to Start

```sql
SELECT
  team_provider_id,
  team_id,
  team_name,
  provider_name,
  broker_addr,
  team_config ->> 'client_filter' as client_filter,
  team_config ->> 'max_workers' as max_workers
FROM team_device_providers_view
WHERE protocol_type = 'grpc'
  AND is_active = true
ORDER BY priority DESC, team_id;
```

---

## Part 3: Sample Database Inserts

### Setup: Teams with Their Providers

```sql
-- GMS Team: ChirpStack Provider
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config, is_active)
SELECT
  (SELECT id FROM teams WHERE slug = 'gms'),
  (SELECT id FROM device_providers WHERE code = 'chirpstack'),
  (SELECT id FROM transport_endpoints WHERE host = 'networkserver2.maua.br'),
  jsonb_build_object(
    'username', 'gms-network-server',
    'password', 'gms-ns-password'
  ),
  true
ON CONFLICT (team_id, device_provider_id) DO UPDATE SET config = EXCLUDED.config;

-- MauaRacing Team: ChirpStack Provider
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config, is_active)
SELECT
  (SELECT id FROM teams WHERE slug = 'mauaracing'),
  (SELECT id FROM device_providers WHERE code = 'chirpstack'),
  (SELECT id FROM transport_endpoints WHERE host = 'networkserver2.maua.br'),
  jsonb_build_object(
    'username', 'mauaracing-network-server',
    'password', 'mr-ns-password'
  ),
  true
ON CONFLICT (team_id, device_provider_id) DO UPDATE SET config = EXCLUDED.config;

-- Teams Team: Direct MQTT Provider
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config, is_active)
SELECT
  (SELECT id FROM teams WHERE slug = 'teams'),
  (SELECT id FROM device_providers WHERE code = 'mqtt_direct'),
  (SELECT id FROM transport_endpoints WHERE host = 'mqtt.maua.br'),
  jsonb_build_object(
    'username', 'teams-mqtt-user',
    'password', 'teams-mqtt-password'
  ),
  true
ON CONFLICT (team_id, device_provider_id) DO UPDATE SET config = EXCLUDED.config;

-- Committee Team: Direct MQTT Provider
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config, is_active)
SELECT
  (SELECT id FROM teams WHERE slug = 'committee'),
  (SELECT id FROM device_providers WHERE code = 'mqtt_direct'),
  (SELECT id FROM transport_endpoints WHERE host = 'mqtt.maua.br'),
  jsonb_build_object(
    'username', 'committee-mqtt-user',
    'password', 'committee-mqtt-password'
  ),
  true
ON CONFLICT (team_id, device_provider_id) DO UPDATE SET config = EXCLUDED.config;
```

---

## Part 4: Go Implementation Code

### Worker Pool Discovery

```go
package transport

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
)

// DiscoverWorkerConfiguration fetches configuration for specific transport type
func DiscoverWorkerConfiguration(db *sql.DB, transportType string) ([]TransportConfig, error) {
	query := `
	SELECT
	  team_provider_id,
	  team_id,
	  team_name,
	  provider_name,
	  broker_addr,
	  team_config,
	  endpoint_config,
	  provider_config,
	  active_device_count
	FROM team_device_providers_view
	WHERE protocol_type = $1
	  AND is_active = true
	ORDER BY team_id
	`

	rows, err := db.QueryContext(ctx, query, transportType)
	if err != nil {
		return nil, fmt.Errorf("discovery query failed: %w", err)
	}
	defer rows.Close()

	var configs []TransportConfig

	for rows.Next() {
		var config TransportConfig
		var teamConfig, endpointConfig, providerConfig string

		err := rows.Scan(
			&config.ID,
			&config.TeamID,
			&config.TeamName,
			&config.ProviderName,
			&config.BrokerAddr,
			&teamConfig,
			&endpointConfig,
			&providerConfig,
			&config.DeviceCount,
		)
		if err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}

		// Parse JSON configs
		config.TeamConfig = parseJSON(teamConfig)
		config.EndpointConfig = parseJSON(endpointConfig)
		config.ProviderConfig = parseJSON(providerConfig)

		configs = append(configs, config)
	}

	log.Printf("[%s] Discovered %d configurations", transportType, len(configs))
	return configs, nil
}

// SyncWorkerPool creates/updates workers based on discovered configs
func SyncWorkerPool(
	db *sql.DB,
	transportType string,
	ingestChan chan<- interface{},
) error {
	// Discover what should exist
	configs, err := DiscoverWorkerConfiguration(db, transportType)
	if err != nil {
		return err
	}

	// Create workers for each config
	for _, config := range configs {
		workerID := fmt.Sprintf("team%d-%s", config.TeamID, config.ProviderName)

		log.Printf("[%s] Starting worker %s (team=%s, provider=%s)",
			transportType, workerID, config.TeamName, config.ProviderName)

		worker := NewWorker(
			workerID,
			config,
			ingestChan,
		)

		err := worker.Start()
		if err != nil {
			log.Printf("Failed to start worker %s: %v", workerID, err)
			continue
		}

		// Track worker (store in registry)
		RegisterWorker(transportType, workerID, worker)
	}

	return nil
}

// Confi type definitions
type TransportConfig struct {
	ID               string
	TeamID           int64
	TeamName         string
	ProviderName     string
	BrokerAddr       string
	TransportType    string
	TeamConfig       map[string]interface{}
	EndpointConfig   map[string]interface{}
	ProviderConfig   map[string]interface{}
	DeviceCount      int
}
```

---

## Part 5: Migration File

```sql
-- Migration: 008_transport_layer_simplification.sql

BEGIN;

-- Add protocol_type to device_providers
ALTER TABLE device_providers
ADD COLUMN IF NOT EXISTS protocol_type VARCHAR(50) DEFAULT 'mqtt';

-- Add config to device_providers
ALTER TABLE device_providers
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Add protocol_type to transport_endpoints
ALTER TABLE transport_endpoints
ADD COLUMN IF NOT EXISTS protocol_type VARCHAR(50) DEFAULT 'mqtt';

-- Add config to transport_endpoints
ALTER TABLE transport_endpoints
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

-- Update protocol types for existing providers
UPDATE device_providers SET protocol_type = 'mqtt'
WHERE code IN ('chirpstack', 'mqtt_direct', 'mqtt');

UPDATE device_providers SET protocol_type = 'grpc'
WHERE code IN ('storio-cli', 'v2n', 'grpc');

UPDATE device_providers SET protocol_type = 'http_server'
WHERE code IN ('everynet', 'http_server');

UPDATE device_providers SET protocol_type = 'http_client'
WHERE code IN ('schneider', 'http_client');

-- Create view for worker discovery
CREATE OR REPLACE VIEW team_device_providers_view AS
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
  te.host || ':' || te.port as broker_addr,
  te.host,
  te.port,
  COALESCE(tdp.config, '{}') as team_config,
  COALESCE(te.config, '{}') as endpoint_config,
  COALESCE(dp.config, '{}') as provider_config,
  tdp.is_active,
  tdp.is_primary,
  tdp.priority,
  COUNT(dr.id) FILTER (WHERE dr.is_active = true) as active_device_count
FROM team_device_providers tdp
JOIN teams t ON tdp.team_id = t.id
JOIN organizations o ON t.organization_id = o.id
JOIN device_providers dp ON tdp.device_provider_id = dp.id
JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
LEFT JOIN device_registry dr ON dr.team_id = t.id
  AND dr.lns_provider_id = dp.id AND dr.is_active = true
WHERE tdp.is_active = true
GROUP BY tdp.id, t.id, t.name, o.id, o.name, tdp.device_provider_id,
  dp.name, dp.code, dp.protocol_type, te.id, te.host, te.port,
  tdp.config, te.config, dp.config, tdp.is_active, tdp.is_primary, tdp.priority
ORDER BY dp.protocol_type, t.name, tdp.priority DESC;

-- Verify setup
SELECT protocol_type, COUNT(*) as provider_count FROM device_providers GROUP BY protocol_type;
SELECT * FROM team_device_providers_view;

COMMIT;
```

---

## Part 6: Deployment Checklist

- [ ] Update device_providers table with protocol_type
- [ ] Update transport_endpoints table with protocol_type and config
- [ ] Create team_device_providers_view
- [ ] Add entries: GMS + ChirpStack
- [ ] Add entries: MauaRacing + ChirpStack
- [ ] Add entries: Teams + Direct MQTT
- [ ] Add entries: RaceTracks + Direct MQTT
- [ ] Add entries: Committee + Direct MQTT
- [ ] Test worker discovery query for each transport
- [ ] Implement WorkerPool for MQTT
- [ ] Implement WorkerPool for gRPC (3 instances)
- [ ] Implement WorkerPool for HTTP Server
- [ ] Implement WorkerPool for HTTP Client
- [ ] Test unified ingest channel
- [ ] Test graceful reload
- [ ] Test monitoring/metrics

---

**Status**: Ready for Implementation  
**Complexity**: Simplified (database-driven)  
**Maintainability**: High (no transport logic in code)  
**Scalability**: High (workers scale independently)
