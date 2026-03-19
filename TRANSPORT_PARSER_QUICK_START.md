# Transport Registry & Parser Type - Developer Quick Reference

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────┐
│  transport_registry (Infrastructure Config)          │
│  ├─ id, name, is_global, team_id, org_id           │
│  ├─ transport_type_id: mqtt-subscriber/grpc/http   │
│  ├─ config: {host, port, username, password, ...}  │
│  └─ is_active: true/false                          │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  parser_type (Parsing Strategy)                     │
│  ├─ id, code: chirpstack/everynet/direct_mqtt      │
│  ├─ display_name, description                      │
│  └─ is_builtin: true (uses ParserRegistry)         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  device_registry (Device Configuration)             │
│  ├─ device_key, eui/mac_address                    │
│  ├─ transport_registry_id ← (which infrastructure) │
│  ├─ parser_type_id ← (how to parse)                │
│  └─ team_id, organization_id                       │
└─────────────────────────────────────────────────────┘

                        ↓ (Data Flow)

┌─────────────────────────────────────────────────────┐
│  MQTTAdapter                                        │
│  ├─ Connects to transport_registry broker          │
│  ├─ Receives messages from topics                  │
│  ├─ Extracts device_key from topic                 │
│  ├─ Looks up device parser_type                    │
│  ├─ Uses ParserRegistry[parser_code]               │
│  └─ Routes ParseResult to ingest                   │
└─────────────────────────────────────────────────────┘
```

---

## Database Queries

### List all MQTT transports

```sql
SELECT tr.id, tr.name, tr.team_id, tr.is_global, tr.config
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
WHERE tt.code = 'mqtt-subscriber' AND tr.is_active = true;
```

### Get device with parser

```sql
SELECT dr.device_key, dr.eui, dr.mac_address,
       pt.code as parser_code,
       tr.name as transport_name,
       tr.config as transport_config
FROM device_registry dr
LEFT JOIN parser_type pt ON dr.parser_type_id = pt.id
LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id
WHERE dr.device_key = 'device-123' AND dr.team_id = 1;
```

### Get all parsers

```sql
SELECT * FROM parser_type WHERE is_builtin = true;
```

### Get transports for a team

```sql
SELECT tr.* FROM transport_registry tr
WHERE tr.organization_id = 1 AND (tr.is_global OR tr.team_id = 3);
```

---

## Code: Using Parser Registry

### Parse a message

```go
import "zc8/packages/go-stream/parser"

// Somewhere in MQTT adapter
parserCode := "chirpstack"  // From device_registry lookup
payload := []byte(msg.Payload())
config := make(map[string]interface{})  // From device_registry.parser_config

// Parse - automatically falls back to "default" if code not found
result := parser.ParseMessage(parserCode, payload, config)

// Use parsed result
if len(result.Errors) > 0 {
    log.Printf("Parse errors: %v", result.Errors)
}
fmt.Println(result.Fields)  // {rssi: -95, temp: 22.5, ...}
```

### Get available parsers

```go
parsers := parser.ListAvailableParsers()
for _, p := range parsers {
    fmt.Printf("%s: %s\n", p.Code, p.DisplayName)
    // Output:
    // chirpstack: ChirpStack LoRaWAN
    // everynet: Everynet API
    // direct_mqtt: Direct MQTT
    // default: Default (Passthrough)
}
```

### Get parser schema

```go
schema := parser.GetParserSchema("chirpstack")
fmt.Println(schema.OutputFields)
// Output: [device_eui payload_data rssi snr data_rate gateway_id]
```

---

## Code: Creating New Parser

### Step 1: Implement interface

```go
// In /packages/go-stream/parser/registry.go

type MyCustomParser struct{}

func (p *MyCustomParser) Parse(payload []byte, config map[string]interface{}) (*ParseResult, error) {
    result := &ParseResult{
        Raw:    make(map[string]interface{}),
        Fields: make(map[string]interface{}),
        Meta:   make(map[string]interface{}),
        Errors: []string{},
    }

    // Parse logic here
    var data map[string]interface{}
    json.Unmarshal(payload, &data)

    result.Fields["temperature"] = data["temp"]
    result.Meta["parser"] = "mycustom"

    return result, nil
}

func (p *MyCustomParser) GetSchema() ParserSchema {
    return ParserSchema{
        Code:         "mycustom",
        DisplayName:  "My Custom Device",
        Description:  "Parses my device format",
        InputFormat:  "JSON with temp/humidity",
        OutputFields: []string{"temperature", "humidity"},
    }
}
```

### Step 2: Register in ParserRegistry

```go
var ParserRegistry = map[string]Parser{
    "chirpstack":  &ChirpStackParser{},
    "everynet":    &EverynetParser{},
    "direct_mqtt": &DirectMQTTParser{},
    "mycustom":    &MyCustomParser{},  // ← ADD HERE
    "default":     &DefaultParser{},
}
```

### Step 3: Add to database

```sql
INSERT INTO parser_type (code, display_name, description, is_builtin)
VALUES ('mycustom', 'My Custom Device', 'Parses my device format', true)
ON CONFLICT DO NOTHING;
```

### Step 4: Use in device

```sql
UPDATE device_registry
SET parser_type_id = (SELECT id FROM parser_type WHERE code = 'mycustom')
WHERE device_key = 'custom-sensor-01';
```

**That's it!** Next message uses MyCustomParser automatically.

---

## Transport Worker Manager Usage

### Create manager

```go
import "github.com/jackc/pgx/v4/pgxpool"

db, _ := pgxpool.Connect(ctx, "postgres://...")

manager := NewTransportWorkerManager(
    db,
    30 * time.Second,  // Discovery interval
    func(msg *transport.Message) {
        fmt.Printf("Message: device=%s, parser=%s\n",
            msg.DeviceKey, msg.ParserCode)
    },
    logger,
)

manager.Start(ctx)
defer manager.Stop()
```

### Get status

```go
status := manager.GetAdapterStatus()
fmt.Printf("Active adapters: %d\n", status["adapters_count"])
fmt.Printf("Last discovery: %v\n", status["last_discovery"])
```

### Query adapters

```go
// Get all adapters for a team
adapters := manager.GetAdaptersByTeam(teamID)
for _, adapter := range adapters {
    status := adapter.Status()
    fmt.Printf("Adapter %s: %d messages\n",
        status["broker"],
        status["message_count"])
}

// Get specific adapter
adapter := manager.GetAdapterByID(transportID)
```

---

## Configuration: JSON Examples

### MQTT Transport Config

```json
{
  "host": "mqtt.example.com",
  "port": 1883,
  "username": "zc8-user",
  "password": "secure-password",
  "topics": ["applications/+/devices/+/up", "devices/+/telemetry"]
}
```

### HTTP Server Config

```json
{
  "listen_addr": "0.0.0.0",
  "listen_port": 8080,
  "path_prefix": "/webhooks",
  "timeout_seconds": 30
}
```

### gRPC Server Config

```json
{
  "listen_addr": "0.0.0.0",
  "listen_port": 50051,
  "max_concurrent_streams": 100,
  "keepalive_time_seconds": 60
}
```

---

## Migration: Old → New

### Query to find mappings

```sql
-- See what needs to migrate
SELECT
  'device_providers' as table_name,
  code,
  COUNT(*) as count
FROM device_providers
GROUP BY code;

-- Old data
-- code        | count
-- chirpstack  |     2  (needs transport_registry)
-- mqtt_direct |     1
-- everynet    |     1
```

### Data migration pattern

```sql
-- 1. Create transport_registry entries from device_providers
INSERT INTO transport_registry (
    name, organization_id, transport_type_id, is_global, config, is_active
)
SELECT
    dp.name || ' (Migrated)',
    o.id,
    (SELECT id FROM transport_type WHERE code = 'mqtt-subscriber'),
    true,
    te.config::jsonb,
    dp.is_active
FROM device_providers dp
JOIN organizations o ON o.id = 1  -- Or per org
LEFT JOIN transport_endpoints te ON te.id = dp.transport_endpoint_id
WHERE dp.code IN ('chirpstack', 'mqtt_direct', 'everynet')
  AND NOT EXISTS (
    SELECT 1 FROM transport_registry
    WHERE name LIKE dp.name || '%'
  );

-- 2. Update device_registry with new references
UPDATE device_registry
SET transport_registry_id = (
    SELECT id FROM transport_registry
    WHERE name LIKE (
        SELECT name || '%' FROM device_providers
        WHERE id = device_registry.lns_provider_id LIMIT 1
    ) LIMIT 1
),
parser_type_id = (
    SELECT id FROM parser_type
    WHERE code = CASE
        WHEN device_registry.lns_provider_id = 1 THEN 'chirpstack'
        WHEN device_registry.lns_provider_id = 2 THEN 'direct_mqtt'
        WHEN device_registry.lns_provider_id = 3 THEN 'everynet'
        ELSE 'default'
    END
)
WHERE lns_provider_id IS NOT NULL;

-- 3. Verify migration
SELECT COUNT(*) as devices_migrated
FROM device_registry
WHERE transport_registry_id IS NOT NULL
  AND parser_type_id IS NOT NULL;

-- 4. Run in production
-- - Deploy migration 009
-- - Run data migration SQL
-- - Verify devices still route correctly
-- - Optional: Drop old columns after validation
```

---

## Troubleshooting

### Issue: Parser not found

```
Error: Unknown parser code "custom_parser"
Solution:
- Check parser_type table: SELECT * FROM parser_type;
- Add parser to ParserRegistry if missing
- Verify device_registry.parser_type_id is correct
```

### Issue: Transport not discovered

```
Error: MQTT adapter not connecting
Solution:
- Check transport_registry:
  SELECT * FROM transport_registry WHERE id = X;
- Verify is_active = true
- Check config JSON: host, port, username, password
- Try: telnet host port
```

### Issue: Device returns "default" parser

```
Cause: Device lookup returned NULL or wrong parser_type_id

Solution:
- Check device_registry:
  SELECT device_key, parser_type_id FROM device_registry
  WHERE device_key = 'X';
- If NULL: UPDATE device_registry SET parser_type_id = ... WHERE ...
- If wrong ID: Verify correct parser_type exists
```

### Issue: Messages not routed

```
Check:
1. Transport is active: SELECT is_active FROM transport_registry WHERE id = X;
2. Device exists: SELECT COUNT(*) FROM device_registry WHERE device_key = 'X';
3. Parser is available: SELECT * FROM parser_type WHERE code = 'Y';
4. Check logs: kubectl logs transport-mqtt-worker | grep device_key
```

---

## Performance Notes

- **Parser overhead**: <5ms per message (local parsing)
- **Discovery cycle**: 30s default (configurable)
- **Max adapters**: 1000+ per instance (depends on CPU/memory)
- **Failover**: Auto-reconnect with exponential backoff
- **Graceful shutdown**: Drains in-flight messages

---

## Files Reference

| File                                                  | Purpose                            |
| ----------------------------------------------------- | ---------------------------------- |
| `/infra/postgres/migrations/009_*.sql`                | Schema & views                     |
| `/packages/go-stream/parser/registry.go`              | Parser interface & implementations |
| `/services/transport/mqtt/internal/mqtt_adapter.go`   | MQTT → Parser → Ingest             |
| `/services/transport/mqtt/internal/worker_manager.go` | Discovery & lifecycle              |

---

**Need more?** See `TRANSPORT_REGISTRY_PARSER_IMPLEMENTATION.md` for full docs.
