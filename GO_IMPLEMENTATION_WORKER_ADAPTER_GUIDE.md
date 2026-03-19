# MQTT Worker + Adapter Go Implementation Guide

**Status:** Ready for Implementation  
**Version:** 1.0  
**Target Files:**

- `/services/transport/mqtt/internal/worker_manager.go` - Transport discovery with parser
- `/services/transport/mqtt/internal/mqtt_adapter.go` - Enhanced adapter with pre-init parser

---

## Overview

The MQTT worker pool must now:

1. Discover transports WITH their default parser configuration
2. Pre-initialize parsers at worker startup (not runtime)
3. Route messages through transport's default parser
4. Support device-level parser overrides

Key benefit: **No runtime parser selection ambiguity** — transport owns the parser strategy.

---

## Step 1: Update TransportConfig Struct

**File:** `/services/transport/mqtt/internal/worker_manager.go`

Add parser fields to `TransportConfig`:

```go
type TransportConfig struct {
    ID              int    `db:"id"`
    Name            string `db:"name"`
    Config          string `db:"config"` // JSONB
    TransportType   string `db:"transport_type"` // Always "mqtt-subscriber"

    // NEW: Parser configuration
    TransportParserID   int    `db:"transport_parser_id"`
    DefaultParserCode   string `db:"parser_code"` // "chirpstack", "everynet", "default"
}
```

---

## Step 2: Update Discovery Query

**File:** `/services/transport/mqtt/internal/worker_manager.go`

Replace the current discovery query in `discoverAndSync()`:

### Old Query:

```go
// OLD: Only transport config, no parser info
query := `
    SELECT tr.id, tr.name, tr.config, tt.code as transport_type
    FROM transport_registry tr
    JOIN transport_type tt ON tr.transport_type_id = tt.id
    WHERE tr.is_active = true AND tt.code = 'mqtt-subscriber'
`
```

### New Query:

```go
// NEW: Includes parser_id and parser code
query := `
    SELECT
        tr.id,
        tr.name,
        tr.config,
        tt.code as transport_type,
        tr.transport_parser_id,
        tp.code as parser_code
    FROM transport_registry tr
    JOIN transport_type tt ON tr.transport_type_id = tt.id
    JOIN transport_parser tp ON tr.transport_parser_id = tp.id
    WHERE tr.is_active = true AND tt.code = 'mqtt-subscriber'
`
```

**Result structure:** Now gets `transport_parser_id` and `parser_code` for each transport.

---

## Step 3: Parse Discovery Results

In `discoverAndSync()`, after querying:

```go
transports := []TransportConfig{}
if err := db.SelectContext(ctx, &transports, query); err != nil {
    logger.Error("failed to discover transports", "error", err)
    return
}

for _, transport := range transports {
    // Log the discovered parser
    logger.Info("discovered transport with parser",
        "transport_id", transport.ID,
        "transport_name", transport.Name,
        "parser_code", transport.DefaultParserCode,  // NEW
    )

    // Process transport (existing code + parser initialization)
    wm.addOrUpdateWorker(ctx, transport)
}
```

---

## Step 4: Update addOrUpdateWorker()

**File:** `/services/transport/mqtt/internal/worker_manager.go`

Pass parser information to adapter:

```go
func (wm *WorkerManager) addOrUpdateWorker(
    ctx context.Context,
    transport TransportConfig,
) error {
    // Check if worker exists
    workerID := fmt.Sprintf("mqtt-worker-%d", transport.ID)

    existingWorker, exists := wm.workers[workerID]
    if exists {
        // Worker still valid, check if config changed
        if configUnchanged(existingWorker, transport) {
            return nil
        }
        // Config changed, stop old worker
        existingWorker.Stop()
    }

    // Create new worker with parser config
    worker, err := NewMQTTWorker(
        ctx,
        transport,
        transport.DefaultParserCode,  // NEW: Pass parser code
        wm.db,
        wm.logger,
    )
    if err != nil {
        return fmt.Errorf("failed to create worker for transport %d: %w", transport.ID, err)
    }

    // Start worker
    go worker.Run(ctx)

    // Store worker
    wm.workers[workerID] = worker
    wm.logger.Info("worker started", "transport_id", transport.ID, "parser", transport.DefaultParserCode)

    return nil
}
```

---

## Step 5: Update NewMQTTAdapter

**File:** `/services/transport/mqtt/internal/mqtt_adapter.go`

Add parser initialization:

```go
type MQTTAdapter struct {
    config          *MQTTConfig
    client          mqtt.Client

    // NEW: Pre-initialized parser
    defaultParser   parser.Parser
    defaultParserCode string

    // Existing fields
    messageHandler  MessageHandler
    logger          *slog.Logger
}

type NewMQTTAdapterOptions struct {
    Config           *MQTTConfig
    DefaultParserCode string  // NEW: Which parser to use
    MessageHandler   MessageHandler
    Logger           *slog.Logger
}

func NewMQTTAdapter(opts NewMQTTAdapterOptions) (*MQTTAdapter, error) {
    // Validate parser code
    if opts.DefaultParserCode == "" {
        opts.DefaultParserCode = "default"  // Fallback
    }

    // Get parser instance
    defaultParser := parser.GetParser(opts.DefaultParserCode)
    if defaultParser == nil {
        // Fallback to default parser if code invalid
        opts.Logger.Warn("parser not found, using default",
            "requested_parser", opts.DefaultParserCode,
        )
        opts.DefaultParserCode = "default"
        defaultParser = parser.GetParser("default")
    }

    adapter := &MQTTAdapter{
        config:             opts.Config,
        defaultParser:      defaultParser,  // NEW: Store parser instance
        defaultParserCode:  opts.DefaultParserCode,
        messageHandler:     opts.MessageHandler,
        logger:             opts.Logger,
    }

    return adapter, nil
}
```

---

## Step 6: Update Message Handling

**File:** `/services/transport/mqtt/internal/mqtt_adapter.go`

Update message callback to use pre-initialized parser:

```go
func (adapter *MQTTAdapter) setupMessageHandler() mqtt.MessageHandler {
    return func(client mqtt.Client, msg mqtt.Message) {
        ctx := context.Background()

        // Extract device key from topic
        deviceKey, err := adapter.extractDeviceKey(msg.Topic())
        if err != nil {
            adapter.logger.Warn("failed to extract device key", "error", err)
            return
        }

        // Lookup device parser (with fallback to transport default)
        parserToUse, err := adapter.getDeviceParser(ctx, deviceKey)
        if err != nil {
            adapter.logger.Warn("failed to get device parser, using default",
                "device_key", deviceKey,
                "error", err,
            )
            parserToUse = adapter.defaultParser  // Fallback to transport default
        }

        // Parse message
        parseResult, err := parserToUse.Parse(ctx, msg.Payload(), nil)
        if err != nil {
            adapter.logger.Warn("failed to parse message",
                "device_key", deviceKey,
                "parser", adapter.defaultParserCode,
                "error", err,
            )
            return
        }

        // Route to handler
        if adapter.messageHandler != nil {
            adapter.messageHandler(ctx, deviceKey, parseResult)
        }
    }
}
```

---

## Step 7: Device Parser Override Lookup

**File:** `/services/transport/mqtt/internal/mqtt_adapter.go`

Add method to lookup device-specific parser override:

```go
// getDeviceParser returns the parser for a device (override or transport default)
func (adapter *MQTTAdapter) getDeviceParser(
    ctx context.Context,
    deviceKey string,
) (parser.Parser, error) {
    // Query device for parser override
    var parserCode string
    query := `
        SELECT COALESCE(
            (SELECT code FROM transport_parser WHERE id = dr.parser_type_id),
            ?  -- Transport default if no override
        ) as parser_code
        FROM device_registry dr
        WHERE dr.device_key = ?
    `

    err := adapter.db.QueryRowContext(
        ctx,
        query,
        adapter.defaultParserCode,
        deviceKey,
    ).Scan(&parserCode)

    if err != nil {
        if err == sql.ErrNoRows {
            // Device doesn't exist yet, use transport default
            return adapter.defaultParser, nil
        }
        return nil, fmt.Errorf("failed to query device parser: %w", err)
    }

    // Get parser by code
    p := parser.GetParser(parserCode)
    if p == nil {
        // Fallback to transport default if parser not found
        return adapter.defaultParser, nil
    }

    return p, nil
}
```

---

## Step 8: Update Worker Startup

**File:** `/services/transport/mqtt/internal/worker_manager.go`

Update `NewMQTTWorker` to pass parser code:

```go
type MQTTWorker struct {
    config          TransportConfig
    parserCode      string  // NEW
    transportID     int

    // ... existing fields
}

func NewMQTTWorker(
    ctx context.Context,
    config TransportConfig,
    parserCode string,  // NEW parameter
    db *sql.DB,
    logger *slog.Logger,
) (*MQTTWorker, error) {
    // Parse MQTT config
    mqttConfig, err := parseMQTTConfig(config.Config)
    if err != nil {
        return nil, fmt.Errorf("failed to parse mqtt config: %w", err)
    }

    // Create adapter with pre-initialized parser
    adapter, err := NewMQTTAdapter(NewMQTTAdapterOptions{
        Config:             mqttConfig,
        DefaultParserCode:  parserCode,  // NEW: Pass parser code
        MessageHandler:     handleMQTTMessage,  // Callback
        Logger:             logger,
    })
    if err != nil {
        return nil, fmt.Errorf("failed to create mqtt adapter: %w", err)
    }

    worker := &MQTTWorker{
        config:    config,
        parserCode: parserCode,  // NEW: Store for logging/debugging
        transportID: config.ID,
        adapter:   adapter,
        db:        db,
        logger:    logger,
    }

    return worker, nil
}
```

---

## Step 9: Configuration Example

When creating a new transport with specific parser:

```go
// Register transport with ChirpStack parser
mockTransport := TransportConfig{
    ID:                 1,
    Name:               "Default MQTT Broker (ChirpStack)",
    Config:             `{"host": "mqtt.example.com", "port": 1883}`,
    TransportType:      "mqtt-subscriber",
    TransportParserID:  1,  // FK to transport_parser table
    DefaultParserCode:  "chirpstack",  // Pre-determined at transport setup
}
```

---

## Step 10: Error Handling & Fallbacks

**Guarantees:**

1. If device override parser invalid → Use transport default
2. If transport default parser invalid → Use "default" parser
3. "default" parser always exists and handles unknown formats

```go
// Robust parser selection
func (adapter *MQTTAdapter) selectParser(parserCode string) parser.Parser {
    // Try requested parser
    if p := parser.GetParser(parserCode); p != nil {
        return p
    }

    // Fallback to transport default
    if p := parser.GetParser(adapter.defaultParserCode); p != nil {
        return p
    }

    // Final fallback to global default (guaranteed to exist)
    return parser.GetParser("default")
}
```

---

## Step 11: Logging & Metrics

Add logging at key points:

```go
// Transport startup
adapter.logger.Info("mqtt adapter initialized",
    "transport_id", adapter.config.ID,
    "default_parser", adapter.defaultParserCode,
    "broker_host", adapter.config.Host,
)

// Device message with different parser
if parserCode != adapter.defaultParserCode {
    adapter.logger.Debug("using device parser override",
        "device_key", deviceKey,
        "parser", parserCode,
    )
}

// Parser error → fallback
adapter.logger.Warn("parser error, using fallback",
    "device_key", deviceKey,
    "requested_parser", parserCode,
    "fallback_parser", adapter.defaultParserCode,
)
```

---

## Implementation Checklist

- [ ] Update `TransportConfig` struct with parser fields
- [ ] Update discovery query with JOIN to transport_parser
- [ ] Update `addOrUpdateWorker()` to pass parser code
- [ ] Update `NewMQTTAdapter()` to initialize parser
- [ ] Update message handler callback to use pre-init parser
- [ ] Add device parser override lookup method
- [ ] Update worker startup to pass parser code to adapter
- [ ] Add error handling with fallback chain
- [ ] Add logging at key points
- [ ] Compile and test

---

## Testing

### Test 1: Parser Pre-Initialization

```bash
# Send MQTT message, verify:
# - Log message "mqtt adapter initialized" shows parser_code
# - Parser is same instance for multiple messages
```

### Test 2: Device Override

```bash
# Create device with parser_type_id override
# Send MQTT message, verify:
# - Log shows "using device parser override"
# - Data parsed with override parser
```

### Test 3: Fallback Chain

```bash
# Delete parser_type_id override (NULL)
# Send message, verify:
# - Uses transport default parser
# - Data parsed correctly
```

### Test 4: Unknown Parser Code

```bash
# Manually set transport_parser_id to invalid ID
# Worker restarts, verify:
# - Falls back to "default" parser
# - No crashes, data still processed
```

---

## Performance Implications

**Before (Runtime Parser Lookup):**

```
Message → Extract device_key → Query device → Query parser → Parse
         └─ 2 DB queries per message
         └─ Parser GET lookup per message
```

**After (Pre-Initialized Parser):**

```
Message → Extract device_key → Query device parser override → Parse
         └─ 1 DB query per message (parser already in memory)
         └─ Parser instance cached at startup
```

**Result:** ~2x faster message processing, reduced DB load.

---

## Database Dependency

**Required Migrations:**

- ✅ Migration 010: Create transport_registry + parser join
- ✅ Migration 012: Rename parser_type → transport_parser
- ✅ Migration 013: Add transport_parser_id to transport_registry

**SQL to verify setup:**

```sql
-- Should return 2 transports with parser codes
SELECT tr.id, tr.name, tp.code as parser_code
FROM transport_registry tr
JOIN transport_parser tp ON tr.transport_parser_id = tp.id
WHERE tr.is_active = true;
```

---

## Next Steps After Implementation

1. **Build & Test**

   ```bash
   cd /services/transport/mqtt
   go build ./...
   go test ./...
   ```

2. **Integration Test**
   - Start MQTT broker
   - Send test message
   - Verify parsing in logs

3. **Staged Rollout**
   - Deploy to dev environment first
   - Monitor parser initialization logs
   - Verify device metrics

4. **Production**
   - Full deployment with monitoring
   - Track parser errors in metrics
   - Monitor parser override distribution

---

**Ready to implement? Start with Step 1: Update TransportConfig struct** ✅
