# Transport Worker Architecture - Unified Processing Pipeline

## Overview

This document defines the new unified architecture for all transport workers (MQTT, HTTP, gRPC) in the zc8 platform. Each worker follows a standardized pipeline for:

- Message ingestion (transport-specific)
- Device/parser resolution via 3-tier caching
- Data parsing and normalization
- Distributed output (InfluxDB, Redis, NATS)

## Core Pattern: Receive → Cache → Parse → Distribute

```
MQTT/HTTP/gRPC Message
    ↓
[MESSAGE EXTRACTION]
- Extract device_key from topic/endpoint/header
- Extract transport_registry_id
- Extract raw payload
    ↓
[3-TIER CACHE LOOKUP]  - O(1) average
┌─────────────────────────────────────────┐
│ Tier 1: LRU Cache (in-memory)          │ ← ~100k devices, 10ms latency
│ Tier 2: Redis Cache (shared)            │ ← ~1M devices, 50ms latency
│ Tier 3: PostgreSQL (cold cache)         │ ← unlimited, 100-200ms latency
└─────────────────────────────────────────┘
Returns: {device_model_id, is_public, is_active, is_global, parser_id}
    ↓
[PARSER SELECTION]
- Primary: device.parser_id override
- Secondary: transport.transport_parser_id default
- Tertiary: global default parser for transport_type
    ↓
[MESSAGE PARSING]
- Invoke selected parser with raw payload
- Extract fields: {key, value, unit, timestamp}
- Validate field types and ranges
    ↓
[DATA VALIDATION]
- Check device is_active and is_public status
- Verify data format completeness
- Apply device-specific transformation rules
    ↓
[DISTRIBUTED WRITE]  - Parallel output to 3 systems
┌──────────────────────────────────────────────────────────────┐
│ 1. InfluxDB (sensor_data table)                             │
│    - Measurements: device_model_code, parser_code           │
│    - Tags: device_key, org_id, team_id                      │
│    - Fields: sensor values (float64)                        │
│    - Timestamp: message received_at                         │
│                                                              │
│ 2. Redis (last hash per device)                             │
│    - Key: device:{device_key}:last                          │
│    - Value: {timestamp, field_values, parser_code}          │
│    - TTL: 72 hours                                          │
│                                                              │
│ 3. NATS (pub/sub per device)                                │
│    - Topic: device.{device_key}.telemetry                   │
│    - Subject: {org_id}.{team_id}.{device_key}               │
│    - Message: {sensor_values, parser_code, timestamp}       │
│    - Subscribers: WebSocket handlers (Elysia), dashboards   │
└──────────────────────────────────────────────────────────────┘
    ↓
[METRICS & COMPLETION]
- Record success/failure
- Update device last_heartbeat in PostgreSQL
- Log processing duration
```

## Component Interfaces

### 1. DeviceMetadataCache (3-tier)

```go
type DeviceMetadataCache interface {
    // Get retrieves device metadata from cache (tries LRU → Redis → DB)
    Get(ctx context.Context, deviceKey uint64) (*DeviceMetadata, error)

    // GetMulti retrieves multiple devices efficiently
    GetMulti(ctx context.Context, deviceKeys []uint64) (map[uint64]*DeviceMetadata, error)

    // Invalidate removes from all caches
    Invalidate(deviceKey uint64) error
}

type DeviceMetadata struct {
    DeviceKey       uint64
    DeviceModelID   int64
    DeviceModelCode string
    OrgID           int32
    TeamID          int32
    IsPublic        bool
    IsActive        bool      // reject if false
    IsGlobal        bool      // multi-org accessible
    ParserID        int64     // FK to transport_parser for device override
    ParserCode      string    // e.g., "chirpstack", "everynet", "ms-universal"
}
```

### 2. ParserStrategy

```go
type ParserStrategy interface {
    // SelectParser returns parser for device based on hierarchy
    SelectParser(
        ctx context.Context,
        deviceMeta *DeviceMetadata,
        transportParserID int64,  // from transport_registry
        globalParserID int64,     // fallback default
    ) (Parser, error)
}

// Hierarchy: device override → transport default → global default
```

### 3. SensorDataWriter

```go
type SensorDataWriter interface {
    // WriteInfluxDB writes parsed sensor data to time-series DB
    WriteInfluxDB(ctx context.Context, data *SensorData) error

    // UpdateRedis stores last known state
    UpdateRedis(ctx context.Context, deviceKey uint64, data *SensorData) error

    // PublishNATS broadcasts to WebSocket subscribers
    PublishNATS(ctx context.Context, deviceKey uint64, data *SensorData) error
}

type SensorData struct {
    DeviceKey       uint64
    DeviceModelCode string
    OrgID           int32
    TeamID          int32
    ParserCode      string
    Fields          map[string]float64  // parsed sensor values
    ReceivedAt      time.Time
    Metadata        map[string]string
}
```

### 4. TransportWorker Interface (common across all transports)

```go
type TransportWorker interface {
    // ProcessMessage handles one message from the transport
    ProcessMessage(ctx context.Context, rawData []byte, metadata TransportMetadata) error

    // Start initializes the worker
    Start(ctx context.Context) error

    // Stop gracefully shuts down the worker
    Stop(ctx context.Context) error

    // GetMetrics returns worker statistics
    GetMetrics() WorkerMetrics
}

type TransportMetadata struct {
    TransportType      string // "mqtt", "http", "grpc"
    TransportID        int64   // transport_registry.id
    Topic              string  // MQTT topic or HTTP path
    Headers            map[string]string
    ReceivdAt          time.Time
}

type WorkerMetrics struct {
    MessagesReceived   int64
    MessagesProcessed  int64
    MessagesFailed     int64
    InfluxDBWrites     int64
    RedisWrites        int64
    NATSPublishes      int64
    AvgProcessingTime  time.Duration
}
```

## Service-Level Architecture

### services/transport/mqtt

```
┌─────────────────────────────────────────────────────┐
│ MQTT Broker Connection Pool                         │
│ - One pool per transport_registry entry             │
│ - Auto-reconnect with backoff                       │
└──────────────────┬──────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────┐
│ MQTT Message Router                                 │
│ - Topic: application/+/device/+/up (Chirpstack)    │
│ - Extract device_key, transport_id               │
│ - Route to appropriate worker                      │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┴──────────┬────────────────┐
        │                     │                │
        ↓                     ↓                ↓
    [Worker 1]          [Worker 2]       [Worker N]
   Org1/Modal1      Org2/Modal2       OrgN/Modal_K

Each Worker:
  ↓ Receive message
  ↓ Extract device_key from Chirpstack payload
  ↓ 3-tier cache lookup → DeviceMetadata
  ↓ Select parser (device → transport → global)
  ↓ Parse payload using selected parser
  ↓ Validate data
  ↓ Parallel write:
    - InfluxDB (sensor_data)
    - Redis (last hash)
    - NATS (pub/sub)
  ↓ Update device.last_heartbeat
  ↓ Record metrics
```

### services/transport/grpc and http

Same pattern as MQTT, but:

- HTTP: extract device_key from query param or body
- gRPC: extract device_key from gRPC request metadata

## Implementation Phases

### Phase 1: MQTT Worker (THIS PHASE)

- [ ] Create unified worker struct
- [ ] Implement device metadata cache wrapper
- [ ] Implement parser selection logic
- [ ] Implement sensor data writer (InfluxDB + Redis + NATS)
- [ ] Update mqtt_adapter.go to use new worker
- [ ] Test with real MQTT message

### Phase 2: gRPC & HTTP Workers

- [ ] Refactor grpc/worker.go with same pattern
- [ ] Refactor http/worker.go with same pattern
- [ ] Verify all workers follow identical flow

### Phase 3: Testing & Validation

- [ ] End-to-end MQTT message flow
- [ ] Device discovery and cache invalidation
- [ ] Parser override mechanism
- [ ] Redis last hash verification
- [ ] NATS pub/sub verification

## Database Dependencies

### tables used:

- `device_registry` - Get device_model_id, is_active, is_public, is_global
- `device_models` - Get device_model_code for InfluxDB measurement
- `transport_parser` - Get parser_code for override
- `transport_registry` - Get transport default parser

### Tables written to:

- `sensor_data` (InfluxDB) - Time series data
- `device_registry.last_heartbeat` - Update timestamp

## Key Design Decisions

1. **3-Tier Cache Always Consulted**: Even if we've seen device before, always check for metadata updates
   - Reason: Device config can change (parser override, status, etc.)
   - Cost: O(1) for LRU hit (in-memory)

2. **Parser Hierarchy**: device override > transport default > global default
   - Reason: Flexibility for device-specific parsing needs
   - Example: Chirpstack in Org1 uses "chirpstack" parser, Org2 uses "custom-chirpstack"

3. **Parallel Output**: Write InfluxDB + Redis + NATS concurrently
   - Reason: Independent systems, don't wait for each other
   - Pattern: Use WaitGroup with context timeout per writer

4. **No Internal Message Queue**: Direct in-worker processing
   - Reason: MQTT client handles backpressure via QoS
   - Alternative would add complexity without benefit

5. **Device Status Check in Worker**: Not in transport layer
   - Reason: Device status can change per-message (maintenance window, etc.)
   - Would cache the "is_active" flag but still respectcheck it

## Error Handling Strategy

```
Message Received
    ↓
Try: Cache → Parse → Write
    ↓
[Recovery Paths]

Cache not found:
  → Skip message, log warning
  → Metric: missed_cache_hit

Parse error:
  → Skip message, log error with device_key
  → Metric: parse_error

Write errors:
  → InfluxDB failed: log, retry with backoff queue
  → Redis failed: log, continue without last hash
  → NATS failed: log, continue (subscribers will miss update)
  → Don't fail message for individual writer failures
```

## Monitoring Points

- `mqtt.worker.messages_received` - Counter
- `mqtt.worker.messages_processed` - Counter
- `mqtt.worker.parse_errors` - Counter
- `mqtt.worker.cache_misses` - Counter
- `mqtt.worker.processing_time_ms` - Histogram
- `mqtt.worker.influxdb_write_time_ms` - Histogram
- `mqtt.worker.redis_write_time_ms` - Histogram
- `mqtt.worker.nats_publish_time_ms` - Histogram
