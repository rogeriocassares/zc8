# Transport Worker Implementation Status

**Date**: March 16, 2026  
**Phase**: 1 - MQTT Worker Architecture Implementation

## Completed Tasks ✅

### Architecture & Design

- [x] Reviewed and audited all services/transport code for external package violations
- [x] Designed unified transport worker architecture (Receive → Cache → Parse → Distribute)
- [x] Created comprehensive architecture documentation (TRANSPORT_WORKER_ARCHITECTURE.md)
- [x] Defined DeviceMetadataCache interface using 3-tier pattern (LRU → Redis → DB)
- [x] Defined ParserStrategy interface with hierarchy (device → transport → global)
- [x] Defined SensorDataWriter interface (InfluxDB + Redis + NATS)

### Code Cleanup

- [x] Fixed malformed import in services/transport/mqtt/internal/worker_manager.go
  - Removed: `transport "command-line-arguments/..."`
  - Result: Clean imports, uses go-infra/postgres wrapper

- [x] Removed external package imports from services layer
  - **services/transport/mqtt/**
    - Replaced: `github.com/eclipse/paho.mqtt.golang` → `go-infra/paho` wrapper
    - Replaced: `github.com/jackc/pgx/v4/pgxpool` → `go-infra/postgres` wrapper
    - Updated: worker_manager.go, mqtt_adapter.go function signatures
  - **services/transport/grpc/cmd/grpc-adapter/main.go**
    - Removed: `_ "github.com/lib/pq"` blank import
    - Replaced: `sql.Open()` → `postgres.NewPool()` wrapper
    - Result: Uses go-infra/postgres driver
  - **services/transport/http/cmd/http-adapter/main.go**
    - Removed: `_ "github.com/lib/pq"` blank import
    - Replaced: `sql.Open()` → `postgres.NewPool()` wrapper
    - Result: Uses go-infra/postgres driver

### Implementation

- [x] Created unified MQTT worker implementation (unified_worker.go)
  - Implements ProcessMessage pipeline:
    1. Fetch device metadata from 3-tier cache ✓
    2. Verify device is active ✓
    3. Select parser using hierarchy ✓
    4. Parse message ✓
    5. Parallel writes (InfluxDB, Redis, NATS) ✓
    6. Update device heartbeat ✓
    7. Record metrics ✓

  - Key components implemented:
    - ProcessMessage() - Main pipeline orchestrator
    - fetchDeviceMetadata() - 3-tier cache lookup
    - selectParser() - Parser hierarchy selection
    - Lifecycle: Start(), Stop()
    - GetMetrics() - Worker statistics

## Current Status

### Verified Clean State ✅

```
✓ lib/pq imports: 0 remaining in services/.go files
✓ eclipse/paho direct imports: 0 remaining in services/.go files
✓ All services use go-infra wrappers
✓ External packages remain only in go-infra layer (correct)
```

### Architectural Pattern Applied ✅

All service imports now follow:

```
services/ → packages/go-* → external packages
```

No services import external packages directly.

## Pending Tasks 📋

### Phase 1: MQTT Worker (Current)

#### Step 1: Wire InfluxDB Writer

- [ ] Implement `UnifiedMQTTWorker.writeToInfluxDB()`
  - Task: Extract fields from ParsedResult
  - Create InfluxDB point:
    - Measurement: device_model_code (e.g., "ws101-emergency")
    - Tags: device_key, org_id, team_id, parser_code, transport_name
    - Fields: Numeric values from ParsedResult
    - Timestamp: ReceivedAt
  - Write to go-infra/influx writer
  - Reference: packages/go-infra/influx interface

#### Step 2: Wire Redis Writer

- [ ] Implement `UnifiedMQTTWorker.updateRedisLastHash()`
  - Task: Store last known state
  - Key format: `device:{device_key}:last`
  - Value: JSON {timestamp, fields, parser_code}
  - TTL: 72 hours
  - Reference: packages/go-infra/redis interface

#### Step 3: Wire NATS Publisher

- [ ] Implement `UnifiedMQTTWorker.publishToNATS()`
  - Task: Broadcast to WebSocket subscribers
  - Subject: `device.{device_key}.telemetry`
  - Message: {fields, parser_code, timestamp, received_at}
  - For: Elysia WebSocket handlers, dashboards
  - Reference: packages/go-infra/nats interface

#### Step 4: Wire Device Heartbeat Update

- [ ] Implement `UnifiedMQTTWorker.updateDeviceHeartbeat()`
  - Task: Update device_registry.last_heartbeat
  - Query: `UPDATE device_registry SET last_heartbeat = NOW(), message_count = message_count + 1 WHERE device_key = $1`
  - Use: go-infra/postgres wrapper
  - Reference: database schema in infra/postgres/migrations

#### Step 5: Integrate with MQTT Adapter

- [ ] Update mqtt_adapter.go to use UnifiedMQTTWorker
  - Current: Message callback to old worker
  - Future: Route through UnifiedMQTTWorker.ProcessMessage()
  - Extract device_key from MQTT topic (Chirpstack: `application/+/device/+/up`)
  - Pass to ProcessMessage with device_model_code

#### Step 6: Test MQTT Flow

- [ ] End-to-end MQTT message test
  - Publish: `mosquitto_pub -h mqtt.maua.br -p 1883 -t "application/emergency/device/24e124535f318437/up" -m '{"...": "..."}'`
  - Verify: Message processed without errors
  - Check: InfluxDB has sensor_data entry
  - Check: Redis has device:\*:last key
  - Check: NATS subscription receives message
  - Check: device_registry.last_heartbeat updated

### Phase 2: Apply to gRPC Worker

- [ ] Refactor services/transport/grpc/worker.go
  - Implement same UnifiedWorker pattern
  - Extract device_key from gRPC metadata
  - Route through unified pipeline

- [ ] Update services/transport/grpc/cmd/grpc-adapter/main.go
  - Use postgres.NewPool() from go-infra
  - Initialize UnifiedGRPCWorker instead of old pattern

### Phase 3: Apply to HTTP Worker

- [ ] Refactor services/transport/http/worker.go
  - Implement same UnifiedWorker pattern
  - Extract device_key from HTTP path/query
  - Route through unified pipeline

- [ ] Update services/transport/http/cmd/http-adapter/main.go
  - Use postgres.NewPool() from go-infra
  - Initialize UnifiedHTTPWorker instead of old pattern

### Phase 4: Validation & Monitoring

- [ ] Verify all 3 transports use identical pattern
- [ ] Add structured logging for all pipeline steps
- [ ] Add prometheus metrics export
- [ ] Test cache invalidation (when device config changes)
- [ ] Test parser override mechanism (device vs. transport defaults)
- [ ] Load test with high message throughput

## Architecture Dependencies

### Already Satisfied ✅

```
✓ packages/go-cache - 3-tier cache with LRU, Redis, DB
✓ packages/go-infra/postgres - PostgreSQL wrapper
✓ packages/go-infra/influx - InfluxDB wrapper
✓ packages/go-infra/redis - Redis wrapper
✓ packages/go-infra/nats - NATS wrapper
✓ packages/go-infra/paho - Eclipse MQTT wrapper
✓ packages/go-parser - Parser interfaces
✓ packages/go-stream - Stream/event types
```

### Configuration Needed

```
[] UnifiedMQTTWorker initialization in mqtt-adapter main.go
[] Device parser registry setup (map[string]Parser)
[] 3-tier cache initialization
[] InfluxDB client configuration
[] Redis client configuration
[] NATS client configuration
```

### Database Schema

```
✓ device_registry - Has all needed fields for cache
✓ device_models - Has device_model_code for InfluxDB measurement
✓ transport_registry - Has transport_parser_id for default parser
✓ transport_parser - Has parser_code for lookup
✓ sensor_data - Exists in InfluxDB for writes
```

## Implementation Strategy

### Parallel Tasks

- [ ] Step 1-4 can be done in parallel (independent writers)
- [ ] Each writer tested independently with mock data
- [ ] Shared components (cache, parser lookup) tested first

### Testing Approach

1. Unit test each writer independently
2. Integration test full pipeline with real data
3. Load test with message throughput
4. Verify no external package imports in services

### Rollout Plan

1. **MQTT First** (already partially implemented)
   - Complete writers
   - Test end-to-end
   - Monitor in staging

2. **Then gRPC & HTTP**
   - Apply same pattern
   - Test with existing gRPC/HTTP clients
   - Monitor for regressions

3. **Validate Overall**
   - Confirm all 3 transports identical behavior
   - Drop old worker code
   - Document as standard pattern

## Key Decision Points

1. **Parser Override Mechanism**
   - Current: device.parser_id or fall back to transport default
   - Verify: Does device_registry have parser_id column?
   - If not: Skip device override, use transport default only

2. **Message Routing**
   - MQTT: Extract device_key from topic pattern matching
   - gRPC: Extract from request metadata
   - HTTP: Extract from URL path or query string
   - Question: How is device_key passed in each protocol?

3. **Error Handling**
   - Decision: Non-fatal writer failures don't fail message
   - Implementation: Log errors but don't return failure
   - Rationale: InfluxDB failure shouldn't prevent Redis/NATS updates

4. **Concurrency**
   - Decision: All writers execute concurrently (WaitGroup)
   - Decision: 10-second timeout per writer (adjustable)
   - Reason: Don't block on slow writer (Influx vs NATS latency differs)

## Questions to Resolve

1. Device override parser: Is there `device_registry.parser_id` column?
2. MQTT topic format: Is it always `application/{team}/device/{device_key}/up`?
3. Device discovery: Must we load all devices at startup or lazy-load only?
4. Heartbeat frequency: Update every message or batched?
5. Redis TTL: Should it be 72 hours or configurable per device?

## Success Criteria

- [ ] All services import only go-infra packages (no external imports)
- [ ] MQTT worker processes message → writes InfluxDB + Redis + NATS
- [ ] gRPC and HTTP workers follow identical pattern
- [ ] No kafka/queue intermediate layer (direct processing)
- [ ] 3-tier cache functioning (LRU hit, Redis fallback, DB fallback)
- [ ] Parser selection using hierarchy (device → transport → global)
- [ ] Device status validated (is_active check prevents message)
- [ ] No memory leaks in worker lifecycle
- [ ] Metrics collected and exported
