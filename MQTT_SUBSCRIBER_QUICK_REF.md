# MQTT Subscriber - Quick Reference

## Key Concepts

### What

MQTT Subscriber is one of four transport adapters in ZC8's unified transport layer. It connects to MQTT brokers and receives device telemetry messages, then routes them through a unified pipeline for storage and processing.

### Where It Runs

- Package: `/packages/go-transport-worker/`
- Main files:
  - `mqtt_adapter.go` (350 lines) - MQTT connection logic
  - `worker_pool.go` (450 lines) - Worker discovery & lifecycle
  - `service.go` (350 lines) - Service integration

### How It Works (3-Step)

```
1. DATABASE DISCOVERY (every 30s)
   WorkerPool queries: SELECT FROM team_device_providers_view
   WHERE protocol_type = 'mqtt'
   ↓
2. WORKER PER TEAM-PROVIDER
   Create MQTTAdapter for each team+broker combination
   ↓
3. MESSAGE ROUTING
   MQTT message → extract device key → unified format → ingest processor
```

---

## Configuration Models

### Teams to Providers Mapping

```go
type TeamDeviceProvider struct {
  ID               int64
  TeamID           int64
  ProviderID       int64
  TransportEndpointID int64
  Config           map[string]interface{} // {username, password}
  IsActive         bool
  IsPrimary        bool
}
```

### Database Query

```sql
SELECT
  team_id, team_name,           -- Which team
  provider_id, provider_name,   -- Which provider (ChirpStack, Direct, etc)
  broker_addr                   -- mqtt://host:port
FROM team_device_providers_view
WHERE protocol_type = 'mqtt' AND is_active = true
```

---

## Topic Patterns by Provider

| Provider        | Topic Pattern                        | Device Extracted From |
| --------------- | ------------------------------------ | --------------------- |
| **ChirpStack**  | `applications/+/devices/+/up`        | parts[3] (EUI hex)    |
| **Direct MQTT** | `devices/+/up` `devices/+/telemetry` | parts[1] (device key) |
| **Maua Racing** | `maua/devices/+/data`                | parts[2] (device key) |

### Examples

```
ChirpStack:
  Topic: applications/1001/devices/1616161616161616/up
  Extracted: 1616161616161616 (8-byte LoRaWAN EUI)

Direct MQTT:
  Topic: devices/mqtt-teams-03/telemetry
  Extracted: mqtt-teams-03 (device key)

Maua Racing:
  Topic: maua/devices/device-123/data
  Extracted: device-123 (device key)
```

---

## Worker State Per Team

```
Team: GMS (ID: 1)
├─ Worker ID: worker_1_1
├─ Provider: ChirpStack
├─ Broker: networkserver2.maua.br:1883
├─ Topics: applications/+/devices/+/up
├─ Credentials: {username: "gms-ns", password: "secret"}
├─ Status: RUNNING
└─ Messages: 1,250/day

Team: Teams (ID: 3)
├─ Worker ID: worker_3_2
├─ Provider: Direct MQTT
├─ Broker: mqtt.maua.br:1883
├─ Topics: devices/+/up, devices/+/telemetry
├─ Credentials: {username: "teams-user", password: "secret"}
├─ Status: RUNNING
└─ Messages: 890/day
```

---

## Device Discovery Query

### Lookup by EUI (ChirpStack)

```sql
SELECT device_key, team_id FROM device_registry
WHERE eui = '1616161616161616'
  AND is_active = true
  AND lns_provider_id = 1  -- ChirpStack
LIMIT 1
```

### Lookup by MAC (Direct MQTT)

```sql
SELECT device_key, team_id FROM device_registry
WHERE mac_address = 'AA:BB:CC:DD:EE:FF'
  AND is_active = true
  AND lns_provider_id = 2  -- Direct MQTT
LIMIT 1
```

---

## Message Flow - Step by Step

### At MQTT Adapter

```go
func messageHandler(topic string, payload []byte) {
  // 1. Extract device key from topic
  deviceKey := extractDeviceKeyFromTopic(topic)

  // 2. Parse payload
  data := parsePayload(payload)

  // 3. Create unified message
  msg := Message{
    WorkerID:      "worker_1_1",
    TransportType: "mqtt",
    TeamID:        1,
    TeamName:      "GMS",
    ProviderID:    1,
    ProviderName:  "ChirpStack",
    DeviceKey:     deviceKey,
    Payload:       data,
    ReceivedAt:    time.Now(),
  }

  // 4. Route to ingest
  wp.RouteMessage(msg)

  // 5. Update metrics
  worker.MessageCount++
}
```

### At Ingest Processor

```go
func Process(msg Message) {
  // 1. Store to audit table
  saveToIngestMessages(msg)

  // 2. Run InfluxDBProcessor
  influxProc.Process(msg)  // Time-series storage

  // 3. Run WebhookProcessor
  webhookProc.Process(msg)  // Team notifications
}
```

---

## Performance Metrics

### Expected Latencies

- Device → MQTT broker: 100-500ms
- MQTT broker → Worker: <50ms
- Worker processing: 5-10ms
- Ingest queue: <5ms
- Processor execution: 20-50ms
- **Total E2E: 200-700ms (typical 300-400ms)**

### Throughput

- Single worker: 100-500 msg/s
- Multiple workers: Linear scaling
- Target maximum: 1000+ msg/s

---

## Security

### Credential Management

```go
// ✅ Correct: From database
username := config.TeamConfig["username"].(string)

// ❌ Wrong: Hard-coded
const username = "gms-ns"
```

### Team Isolation

Enforced at **3 layers**:

1. **Topic Level**: ChirpStack publishes per application
2. **Worker Level**: Worker tied to specific team_id
3. **Device Level**: SELECT WHERE device_id = ? AND team_id = ?

---

## Troubleshooting Checklist

| Issue                 | Diagnosis                   | Fix                                  |
| --------------------- | --------------------------- | ------------------------------------ |
| Worker not connecting | `telnet broker 1883`        | Check credentials, firewall          |
| No messages received  | Check topic subscription    | Verify device exists in registry     |
| Device not found      | Query device_registry       | Register device with correct EUI/MAC |
| Connection dropping   | Check logs for errors       | Update broker config                 |
| High latency          | Monitor `/metrics` endpoint | Check CPU/memory on worker           |

---

## Commands & Queries

### View Workers

```bash
curl http://localhost:9090/status | jq '.pools.mqtt.workers'
```

### View Metrics

```bash
curl http://localhost:9090/metrics
# Look for: mqtt_worker_message_count, mqtt_worker_error_count
```

### Check Device Registration

```sql
-- All devices for team
SELECT device_key, eui, mac_address, is_active
FROM device_registry
WHERE team_id = 1 ORDER BY device_key;

-- Find by EUI
SELECT * FROM device_registry
WHERE eui = '1616161616161616';

-- Find by MAC
SELECT * FROM device_registry
WHERE mac_address = 'AA:BB:CC:DD:EE:FF';
```

### Monitor Messages

```sql
-- Last 10 messages
SELECT worker_id, team_id, device_key, received_at
FROM ingest_messages
ORDER BY received_at DESC LIMIT 10;

-- Messages per team (last hour)
SELECT team_id, COUNT(*) as count
FROM ingest_messages
WHERE received_at > NOW() - INTERVAL '1 hour'
GROUP BY team_id;
```

---

## Common Patterns

### Adding New Team with ChirpStack

```sql
-- 1. Create provider mapping
INSERT INTO team_device_providers (
  team_id, device_provider_id, transport_endpoint_id,
  config, is_active, is_primary
) VALUES (
  (SELECT id FROM teams WHERE name = 'NewTeam'),
  (SELECT id FROM device_providers WHERE code = 'chirpstack'),
  (SELECT id FROM transport_endpoints WHERE host = 'networkserver2.maua.br'),
  jsonb_build_object('username', 'newteam-ns', 'password', 'secret'),
  true, true
);

-- 2. On next sync (30s), worker will be created automatically
-- 3. Messages will start flowing for NewTeam devices

-- Verify:
SELECT * FROM team_device_providers_view
WHERE team_name = 'NewTeam';
```

### Adding New Device

```sql
INSERT INTO device_registry (
  device_key, eui, device_model_id, team_id, organization_id,
  lns_provider_id, created_by, is_active
) VALUES (
  'lora-gms-01',
  '1616161616161616',
  (SELECT id FROM device_models WHERE code = 'lora_generic'),
  (SELECT id FROM teams WHERE name = 'GMS'),
  (SELECT organization_id FROM teams WHERE name = 'GMS'),
  (SELECT id FROM device_providers WHERE code = 'chirpstack'),
  (SELECT id FROM users LIMIT 1),
  true
);

-- Next ChirpStack message for this EUI will be processed
```

### Disabling a Team

```sql
UPDATE team_device_providers SET is_active = false
WHERE team_id = (SELECT id FROM teams WHERE name = 'Teams');

-- On next sync (30s), worker will stop gracefully
-- Messages will no longer be processed for this team
```

---

## Database Views

### team_device_providers_view

```sql
SELECT
  tp.id as team_provider_id,
  t.id as team_id,
  t.name as team_name,
  dp.id as provider_id,
  dp.name as provider_name,
  te.host || ':' || te.port as broker_addr,
  tp.config as team_config,
  tp.is_active,
  (SELECT COUNT(*) FROM device_registry
   WHERE team_id = t.id AND is_active = true) as active_device_count
FROM team_device_providers tp
JOIN teams t ON tp.team_id = t.id
JOIN device_providers dp ON tp.device_provider_id = dp.id
JOIN transport_endpoints te ON tp.transport_endpoint_id = te.id
WHERE tp.is_active = true;
```

---

## File Reference

| File                                   | Lines     | Purpose                                               |
| -------------------------------------- | --------- | ----------------------------------------------------- |
| mqtt_adapter.go                        | 350       | MQTT connection, topic subscription, message handling |
| worker_pool.go                         | 450       | Worker discovery, lifecycle management                |
| ingest_processor.go                    | 400       | Message processing, storage, webhooks                 |
| service.go                             | 350       | Service orchestration, metrics                        |
| 004_device_registry.sql                | Migration | Device registry schema                                |
| 008_transport_layer_simplification.sql | Migration | Transport configuration tables                        |

---

## Glossary

| Term                | Definition                                                   |
| ------------------- | ------------------------------------------------------------ |
| **Worker**          | Instance managing MQTT connection for 1 team-provider pair   |
| **TeamProvider**    | Mapping of team → provider → broker                          |
| **Adapter**         | Component implementing specific transport (MQTT, gRPC, HTTP) |
| **Transport Layer** | Unified system for multiple device transports                |
| **EUI**             | Extended Unique Identifier (LoRaWAN, 8 bytes)                |
| **MAC**             | Media Access Control address (other protocols, 6 bytes)      |
| **device_key**      | Human-readable device identifier                             |
| **Ingest**          | Pipeline for processing received messages                    |

---

## Key Decisions Made

1. **Worker per team-provider**: Allows independent scaling and failure isolation
2. **Database-driven discovery**: Dynamic configuration without redeployment
3. **30-second sync cycle**: Balance between responsiveness and DB load
4. **Provider-specific topics**: Respect each provider's schema
5. **Unified message format**: Allow processors to work with any transport
6. **Multi-tenant isolation**: Team ID attached at every level
7. **Auto-reconnection**: Resilient to broker restarts

---

## What's Next?

- See [MQTT_SUBSCRIBER_INTEGRATION.md](MQTT_SUBSCRIBER_INTEGRATION.md) for detailed explanation
- See [MQTT_SUBSCRIBER_DIAGRAMS.md](MQTT_SUBSCRIBER_DIAGRAMS.md) for visual flows
- See `/packages/go-transport-worker/README.md` for implementation details
