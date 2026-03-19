# MQTT Subscriber - Devices & Teams Integration

**Date**: March 12, 2026  
**Status**: Complete Implementation  
**Focus**: Practical MQTT integration with device registry and teams

---

## Overview

The MQTT subscriber is the bridge between IoT devices and the ZC8 platform. It:

1. **Connects** to MQTT brokers (ChirpStack or Direct)
2. **Receives** device telemetry via specific topics
3. **Identifies** devices using EUI (LoRaWAN) or MAC (other)
4. **Maps** messages to teams and organizations
5. **Routes** to unified ingest for processing

---

## Data Model & Relationships

```
Organization (zc8, maua-racing, etc)
    ↓
[Teams] (GMS, MauaRacing, Teams, RaceTracks, Committee)
    ├→ team_device_providers
    │   ├─ MQTT Provider (ChirpStack or Direct)
    │   └─ Transport Endpoint (broker address)
    └→ [Devices] (all devices owned by team)
        ├─ device_key (unique identifier)
        ├─ EUI or MAC address
        ├─ device_model (model info)
        └─ lns_provider_id (which MQTT to listen on)
```

### Key Tables

#### **teams** - Team Information

```sql
id          | name        | organization_id | slug
------------|-------------|-----------------|----------------
1           | GMS         | 1               | gms
2           | MauaRacing  | 1               | mauaracing
3           | Teams       | 2               | teams
4           | RaceTracks  | 2               | racetracks
5           | Committee   | 3               | committee
```

#### **device_providers** - MQTT Broker Types

```sql
id  | name      | code           | protocol_type | config
----|-----------|----------------|---------------|-------
1   | ChirpStack| chirpstack     | mqtt          | {...}
2   | Direct    | mqtt_direct    | mqtt          | {...}
```

#### **transport_endpoints** - Broker Addresses

```sql
id  | name                    | host                       | port | protocol_type
----|-------------------------|----------------------------|------|---------------
1   | ChirpStack Network Srv2 | networkserver2.maua.br    | 1883 | mqtt
2   | Maua Direct MQTT        | mqtt.maua.br              | 1883 | mqtt
```

#### **team_device_providers** - Team → Provider Mapping

```sql
id  | team_id | device_provider_id | transport_endpoint_id | config (JSONB)           | is_active | is_primary
----|---------|--------------------|-----------------------|--------------------------|-----------|----------
1   | 1 (GMS) | 1 (ChirpStack)     | 1                     | {username, password}     | true      | true
2   | 2 (MR)  | 1 (ChirpStack)     | 1                     | {username, password}     | true      | true
3   | 3 (T)   | 2 (Direct MQTT)    | 2                     | {username, password}     | true      | true
4   | 4 (RT)  | 2 (Direct MQTT)    | 2                     | {username, password}     | true      | true
5   | 5 (C)   | 2 (Direct MQTT)    | 2                     | {username, password}     | true      | true
```

#### **device_registry** - Actual Devices

```sql
device_key          | eui              | mac_address        | team_id | lns_provider_id | organization_id | is_active
-------------------|------------------|-------------------|---------|-----------------|-----------------|----------
lora-gms-01        | 1616161616161616 | NULL               | 1 (GMS) | 1 (ChirpStack)  | 1               | true
mqtt-maua-02       | NULL             | AA:BB:CC:DD:EE:FF  | 2 (MR)  | 2 (Direct MQTT) | 1               | true
mqtt-teams-03      | NULL             | BB:CC:DD:EE:FF:00  | 3 (T)   | 2 (Direct MQTT) | 2               | true
```

---

## MQTT Adapter Components

### 1. Worker Creation & Association

When worker pool starts:

```
Database Discovery Query:
├─ SELECT FROM team_device_providers_view
│  WHERE protocol_type = 'mqtt' AND is_active = true
├─ Per team+provider combination:
│  ├─ team_id, team_name
│  ├─ provider_name, provider_code
│  ├─ broker_addr (host:port)
│  ├─ team_config (credentials)
│  └─ active_device_count
└─ Create Worker for each combination
```

**Example Result:**

```
Worker 1: worker_1_1
├─ Team: "GMS" (ID: 1)
├─ Provider: "ChirpStack" (ID: 1)
├─ Broker: networkserver2.maua.br:1883
├─ Credentials: {username: "gms-network-server", password: "secret"}
└─ Active Devices: 3

Worker 2: worker_2_1
├─ Team: "MauaRacing" (ID: 2)
├─ Provider: "ChirpStack" (ID: 1)
├─ Broker: networkserver2.maua.br:1883
├─ Credentials: {username: "mauaracing-network-server", password: "secret"}
└─ Active Devices: 2

Worker 3: worker_3_2
├─ Team: "Teams" (ID: 3)
├─ Provider: "Direct MQTT" (ID: 2)
├─ Broker: mqtt.maua.br:1883
├─ Credentials: {username: "teams-mqtt-user", password: "secret"}
└─ Active Devices: 3
```

### 2. Adapter Lifecycle

```go
MQTTAdapter
├─ Start()
│  ├─ Determine topic patterns based on provider
│  ├─ Connect to broker (with credentials)
│  ├─ Subscribe to topics
│  └─ Start monitoring connection
├─ messageHandler() [callback]
│  ├─ Receive MQTT message
│  ├─ Extract device key from topic
│  ├─ Parse payload
│  ├─ Route to unified ingest
│  └─ Update metrics
└─ Stop()
   ├─ Unsubscribe from topics
   ├─ Graceful disconnect
   └─ Cleanup
```

### 3. Topic Patterns by Provider

#### ChirpStack Topics

```
Topic Pattern: applications/+/devices/+/up
Example: applications/1001/devices/1616161616161616/up

Structure:
├─ applications/     - Fixed prefix
├─ 1001/             - Application ID (team/org specific)
├─ devices/          - Fixed
├─ 1616161616161616/ - Device EUI (what we use!)
└─ up                - Message direction

Extraction:
topic.split('/')[3] → device_eui = "1616161616161616"
```

#### Direct MQTT Topics

```
Topic Patterns:
a) devices/+/telemetry
b) devices/+/up
c) maua/devices/+/data

Examples:
├─ devices/mqtt-maua-02/telemetry
│  └─ device_key = "mqtt-maua-02"
├─ devices/mqtt-teams-03/up
│  └─ device_key = "mqtt-teams-03"
└─ maua/devices/device-123/data
   └─ device_key = "device-123"

Extraction:
topic.split('/')[1] or [2] depending on pattern
```

---

## Integration Flow

### Step 1: Worker Initialization

```
[Database]
   ↓ team_device_providers_view query
┌─────────────────────────────────┐
│ Query Result (for MQTT)         │
├─────────────────────────────────┤
│ team_id=1, team_name="GMS"      │
│ provider_name="ChirpStack"      │
│ broker_addr="ns2.maua.br:1883"  │
│ credentials={u:gms-ns, p:secret}│
└─────────────────────────────────┘
   ↓ Create MQTTAdapter for this combination
   ↓ adapter.Start()
   ├─ Connect to networkserver2.maua.br:1883
   ├─ Authenticate with "gms-ns" / "secret"
   ├─ Subscribe to "applications/+/devices/+/up"
   └─ Wait for messages
```

### Step 2: Device Message Arrives

```
Device (EUI: 1616161616161616) sends data
   ↓ ChirpStack processes
   ↓ Publishes to: applications/1001/devices/1616161616161616/up
   ↓
┌────────────────────────────────────────────────────┐
│ MQTT Message Received                              │
├────────────────────────────────────────────────────┤
│ Topic: applications/1001/devices/1616161616161616/up
│ Payload: {                                         │
│   "applicationID": "1001",                         │
│   "deviceName": "GMS-Sensor-01",                  │
│   "deviceEUI": "1616161616161616",                │
│   "data": "base64_encoded_payload",               │
│   "rxInfo": [{...}],                              │
│   "txInfo": {...},                                │
│   "adr": true,                                    │
│   "dr": 5                                         │
│ }                                                  │
└────────────────────────────────────────────────────┘
```

### Step 3: Message Processing

```
messageHandler() called
   ↓
1. Extract device from topic
   topic_parts = "applications/1001/devices/1616161616161616/up".split('/')
   device_eui = topic_parts[3] = "1616161616161616"

2. Parse payload (decode ChirpStack JSON)
   payload = {appID: 1001, deviceEUI: ...}

3. Lookup device in registry
   SELECT device_key, team_id, organization_id
   FROM device_registry
   WHERE eui = "1616161616161616" AND is_active = true

   Result: ✅ Found
   ├─ device_key: "lora-gms-01"
   ├─ team_id: 1
   ├─ organization_id: 1
   └─ lns_provider_id: 1 (matches ChirpStack)

4. Create unified ingest message
   Message {
     WorkerID: "worker_1_1",
     TransportType: "mqtt",
     TeamID: 1,
     TeamName: "GMS",
     ProviderID: 1,
     ProviderName: "ChirpStack",
     DeviceKey: "lora-gms-01",
     Payload: {
       applicationID: 1001,
       deviceName: "GMS-Sensor-01",
       data: "base64_encoded",
       rxInfo: {...},
       txInfo: {...}
     },
     Metadata: {
       topic: "applications/1001/devices/1616161616161616/up",
       received_at: "2026-03-12T15:30:45Z"
     },
     ReceivedAt: time.Now()
   }

5. Route to unified ingest
   wp.RouteMessage(message)

6. Update worker metrics
   worker.MessageCount++
   worker.LastMessageAt = time.Now()

7. Log completion
   [MQTT:worker_1_1] Message routed from ChirpStack
   topic applications/.../up (device: lora-gms-01)
```

### Step 4: Ingest Processing

```
Message → ingestChan (buffered)
   ↓
IngestProcessor receives
   ├─ Store to database:
   │  INSERT INTO ingest_messages {
   │    worker_id, transport_type, team_id, device_key,
   │    payload, metadata, received_at, processed_at
   │  }
   │
   ├─ Run registered processors:
   │  ├─ InfluxDBProcessor
   │  │  └─ Extract numeric fields → time-series
   │  │     Example: temperature=22.5, humidity=45.2
   │  │     Point: measurement="device_data"
   │  │            tags {team="GMS", device="lora-gms-01"}
   │  │            fields {temperature=22.5, humidity=45.2}
   │  │
   │  └─ WebhookProcessor
   │     └─ Send to team webhook if registered
   │        POST /webhooks/team-1/messages
   │        body: {teamID: 1, device: ..., data: ...}
   │
   └─ Complete
```

---

## Database Queries for MQTT Integration

### Query 1: Get All MQTT Workers to Start

```sql
SELECT
  team_provider_id,
  team_id,
  team_name,
  provider_name,
  provider_code,
  broker_addr,
  host,
  port,
  team_config,          -- {username, password}
  endpoint_config,      -- {topics: [...]}
  active_device_count
FROM team_device_providers_view
WHERE protocol_type = 'mqtt'
  AND is_active = true
ORDER BY team_name;
```

**Result:**

```
team_provider_id | team_id | team_name   | provider_name | broker_addr              | active_device_count
-----------------|---------|-------------|---------------|--------------------------|--------------------
1                | 1       | GMS         | ChirpStack    | networkserver2.maua.br  | 3
2                | 2       | MauaRacing  | ChirpStack    | networkserver2.maua.br  | 2
3                | 3       | Teams       | Direct MQTT   | mqtt.maua.br:1883       | 3
4                | 4       | RaceTracks  | Direct MQTT   | mqtt.maua.br:1883       | 2
5                | 5       | Committee   | Direct MQTT   | mqtt.maua.br:1883       | 1
```

### Query 2: Find Device by EUI (ChirpStack Lookup)

```sql
SELECT
  device_key,
  team_id,
  team_name,
  organization_id,
  lns_provider_id,
  is_active
FROM device_registry dr
JOIN teams t ON dr.team_id = t.id
WHERE dr.eui = '1616161616161616'
  AND dr.is_active = true
  AND dr.lns_provider_id = 1  -- ChirpStack
LIMIT 1;
```

**Result:**

```
device_key   | team_id | team_name | organization_id | lns_provider_id | is_active
-------------|---------|-----------|-----------------|-----------------|----------
lora-gms-01  | 1       | GMS       | 1               | 1               | true
```

### Query 3: Find Device by MAC (Direct MQTT Lookup)

```sql
SELECT
  device_key,
  team_id,
  team_name,
  organization_id,
  lns_provider_id,
  is_active
FROM device_registry dr
JOIN teams t ON dr.team_id = t.id
WHERE dr.mac_address = 'AA:BB:CC:DD:EE:FF'
  AND dr.is_active = true
  AND dr.lns_provider_id = 2  -- Direct MQTT
LIMIT 1;
```

### Query 4: Get All Devices for a Team

```sql
SELECT
  device_key,
  eui,
  mac_address,
  device_model_id,
  lns_provider_id,
  is_active,
  connection_status,
  last_heartbeat
FROM device_registry
WHERE team_id = 1  -- GMS
  AND is_active = true
ORDER BY device_key;
```

**Result:**

```
device_key      | eui              | mac_address   | lns_provider_id | is_active
----------------|------------------|---------------|-----------------|----------
lora-gms-01     | 1616161616161616 | NULL          | 1 (ChirpStack)  | true
mqtt-gms-sensor | NULL             | AA:BB:CC:00   | 2 (Direct MQTT) | true
gps-tracker-01  | 2727272727272727 | NULL          | 1 (ChirpStack)  | true
```

---

## Configuration Examples

### Setup 1: GMS Team with ChirpStack

```sql
-- 1. Insert team (if not exists)
INSERT INTO teams (organization_id, name, slug) VALUES (1, 'GMS', 'gms');

-- 2. Ensure provider exists
INSERT INTO device_providers (name, code, protocol_type)
VALUES ('ChirpStack', 'chirpstack', 'mqtt')
ON CONFLICT (code) DO NOTHING;

-- 3. Ensure endpoint exists
INSERT INTO transport_endpoints (name, host, port, protocol_type)
VALUES ('ChirpStack Network Server 2', 'networkserver2.maua.br', 1883, 'mqtt')
ON CONFLICT (host, port) DO NOTHING;

-- 4. Link team to provider
INSERT INTO team_device_providers (
  team_id, device_provider_id, transport_endpoint_id, config, is_active, is_primary
)
SELECT
  (SELECT id FROM teams WHERE slug = 'gms'),
  (SELECT id FROM device_providers WHERE code = 'chirpstack'),
  (SELECT id FROM transport_endpoints WHERE host = 'networkserver2.maua.br'),
  jsonb_build_object(
    'username', 'gms-network-server',
    'password', 'gms-ns-secure-password'
  ),
  true,
  true;

-- 5. Create device
INSERT INTO device_registry (
  device_key, eui, device_model_id, team_id, organization_id,
  lns_provider_id, created_by, is_active
)
VALUES (
  'lora-gms-01',
  '1616161616161616',
  (SELECT id FROM device_models LIMIT 1),
  (SELECT id FROM teams WHERE slug = 'gms'),
  (SELECT organization_id FROM teams WHERE slug = 'gms'),
  (SELECT id FROM device_providers WHERE code = 'chirpstack'),
  (SELECT id FROM users LIMIT 1),
  true
);
```

### Setup 2: Teams Team with Direct MQTT

```sql
-- Configuration
-- Team: Teams
-- Provider: Direct MQTT (custom broker)
-- Devices: MQTT devices with MAC addresses

INSERT INTO team_device_providers (
  team_id, device_provider_id, transport_endpoint_id, config, is_active
)
SELECT
  (SELECT id FROM teams WHERE slug = 'teams'),
  (SELECT id FROM device_providers WHERE code = 'mqtt_direct'),
  (SELECT id FROM transport_endpoints WHERE host = 'mqtt.maua.br'),
  jsonb_build_object(
    'username', 'teams-mqtt-user',
    'password', 'teams-mqtt-password'
  ),
  true;

-- Add MQTT device with MAC
INSERT INTO device_registry (
  device_key, mac_address, device_model_id, team_id, organization_id,
  lns_provider_id, created_by, is_active
)
VALUES (
  'mqtt-teams-03',
  'BB:CC:DD:EE:FF:00',
  (SELECT id FROM device_models WHERE code = 'mqtt_generic'),
  (SELECT id FROM teams WHERE slug = 'teams'),
  2,  -- Organization
  (SELECT id FROM device_providers WHERE code = 'mqtt_direct'),
  (SELECT id FROM users LIMIT 1),
  true
);
```

---

## Message Flow Example: Complete End-to-End

```
TIME: 2026-03-12 15:30:45 UTC

1. [15:30:45.000] Device sends LoRaWAN message
   Device: lora-gms-01 (EUI: 1616161616161616)
   Payload: {temp: 22.5, humidity: 45}

2. [15:30:45.100] ChirpStack receives & processes
   LoRaWAN MAC layer processing
   Decryption & MAC validation

3. [15:30:45.150] ChirpStack publishes to MQTT
   Topic: applications/1001/devices/1616161616161616/up
   Payload: {
     "applicationID": "1001",
     "deviceName": "GMS-Sensor-01",
     "deviceEUI": "1616161616161616",
     "data": "AQIEBgA=",  // base64 encoded
     "txInfo": {...},
     "rxInfo": [{...}]
   }

4. [15:30:45.160] MQTT broker routes to subscribers
   ZC8 MQTT Worker 1 (worker_1_1) receives

5. [15:30:45.170] MQTTAdapter.messageHandler() executes
   a) Extract EUI from topic: 1616161616161616
   b) Query device_registry:
      SELECT device_key FROM device_registry
      WHERE eui = '1616161616161616'
      → Returns: device_key = "lora-gms-01"

   c) Verify team match:
      device.team_id = 1 (GMS) ✓
      device.lns_provider_id = 1 (ChirpStack) ✓

   d) Create Message struct with:
      DeviceKey: "lora-gms-01"
      TeamID: 1
      TeamName: "GMS"
      ProviderName: "ChirpStack"

6. [15:30:45.180] Route to unified ingest
   wp.RouteMessage(message)
   Message → ingestChan

7. [15:30:45.190] IngestProcessor processes
   a) Store to ingest_messages table
      INSERT INTO ingest_messages (
        worker_id, transport_type, team_id, device_key,
        payload, metadata, latency_ms
      ) VALUES (
        'worker_1_1', 'mqtt', 1, 'lora-gms-01',
        '{"applicationID":"1001",...}',
        '{"topic":"applications/..."}',
        45  -- milliseconds latency
      )

   b) Run InfluxDBProcessor
      Extract: temp=22.5, humidity=45
      Point: measurement="device_data"
             tags {team="GMS", device="lora-gms-01"}
             fields {temp=22.5, humidity=45}
      → Stored in InfluxDB

   c) Run WebhookProcessor
      Register webhook: https://gms-api.example.com/devices
      POST with message
      → GMS application notified

8. [15:30:45.250] Complete
   Total latency: 250ms (device → processing)
   Message persisted, metrics updated, team notified
```

---

## Troubleshooting Guide

### Issue 1: Worker Not Starting

**Symptom**: MQTT worker not connecting to broker

```bash
# Check 1: Verify team_device_providers mapping
SELECT * FROM team_device_providers_view
WHERE protocol_type = 'mqtt'
AND is_active = true;

# Check 2: Verify broker connectivity
telnet networkserver2.maua.br 1883

# Check 3: Verify credentials in config
SELECT config FROM team_device_providers
WHERE team_id = 1 AND device_provider_id = 1;

# Check 4: View worker logs
docker logs transport-worker | grep "worker_1_1"
```

### Issue 2: Messages Not Being Received

**Symptom**: Messages arrive at broker but not processed

```bash
# Check 1: Verify subscription
mosquitto_sub -h networkserver2.maua.br -u gms-ns \
  -P password -t "applications/+/devices/+/up"

# Check 2: Verify device exists
SELECT * FROM device_registry
WHERE eui = '1616161616161616' AND is_active = true;

# Check 3: Check topic extraction
-- Example: Topic should parse to EUI hex
-- "applications/1001/devices/1616161616161616/up"
-- Split[3] = "1616161616161616"

# Check 4: View worker message count
curl http://localhost:9090/status | jq '.pools.mqtt.workers'
```

### Issue 3: Devices Not Found

**Symptom**: "Device not found in registry" errors

```bash
# Verify device registration
SELECT
  device_key, eui, mac_address, team_id,
  lns_provider_id, is_active
FROM device_registry
WHERE device_key LIKE 'lora-gms%';

# Check provider match
-- Device lns_provider_id must match worker provider_id
-- If device.lns_provider_id = 1, worker must handle provider 1

# Monitor metrics
curl http://localhost:9090/metrics | grep device_key
```

---

## Performance Metrics

### Expected Latencies

| Stage                | Latency       | Notes                          |
| -------------------- | ------------- | ------------------------------ |
| Device → MQTT broker | 100-500ms     | Device + ChirpStack processing |
| MQTT broker → Worker | <50ms         | Network + subscription         |
| Worker processing    | 5-10ms        | Parsing + DB lookup            |
| Ingest queue         | <5ms          | In-memory channel              |
| Processor execution  | 20-50ms       | DB insert + external calls     |
| **Total E2E**        | **200-700ms** | Typical: 300-400ms             |

### Throughput

- **Single worker**: 100-500 msg/s
- **Multiple workers**: Linear scaling per transport type
- **Maximum**: 1000+ msg/s sustainable

### Database Performance

```sql
-- Check ingest_messages insertion rate
SELECT
  COUNT(*) as message_count,
  MAX(processed_at) - MIN(processed_at) as duration
FROM ingest_messages
WHERE processed_at > NOW() - INTERVAL '1 minute';

-- Expected: >100 rows per second for heavy load
```

---

## Security Considerations

### Credentials Management

```go
// ✅ CORRECT: From database config
username := workerConfig.TeamConfig["username"].(string)
password := workerConfig.TeamConfig["password"].(string)

// ❌ WRONG: Hard-coded
const username = "gms-ns"
const password = "hardcoded-secret"
```

### Topic Validation

```go
// Always validate topic before extracting device key
if !strings.HasPrefix(topic, "applications/") {
  // Not a ChirpStack message
  return
}

// Extract with bounds checking
parts := strings.Split(topic, "/")
if len(parts) < 4 {
  // Invalid topic structure
  return
}
```

### Device Authorization

```go
// Always verify device belongs to worker's team
device, _ := getDevice(deviceKey)
if device.TeamID != worker.TeamID {
  // Configuration mismatch - log and ignore
  log.Printf("Device %s not in team %d", deviceKey, worker.TeamID)
  return
}
```

---

## Summary

The MQTT subscriber integrates with devices and teams through:

1. **Database-driven discovery** of team → provider → broker mappings
2. **Provider-specific topic parsing** to extract device identifiers
3. **Device registry lookup** to confirm device ownership and team
4. **Unified message format** for all team-specific routing
5. **Ingest processing** for metrics, storage, and notifications

Each message journey:

```
MQTT Message → Worker identification → Device lookup →
Team association → Unified format → Ingest processors →
Database storage + metrics + webhooks
```

The architecture allows multiple teams to receive data from different MQTT brokers simultaneously without interference, with credentials and routing configured entirely in the database.
