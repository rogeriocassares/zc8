# Architecture Consolidation Analysis

## Current State

### Transport Layer Duplication

Each transport (MQTT, gRPC, HTTP) implements the same pattern **3 times**:

```
services/transport/mqtt/internal/
├── worker_manager.go           (326 lines)
├── mqtt_adapter.go             (509 lines)
├── unified_worker_v2.go        (285 lines)
├── parser_registry.go          (328 lines)
└── worker.go                   (deleted - was duplicate)

services/transport/grpc/
├── worker_manager.go           (likely similar)
├── unified_worker.go           (similar structure)
└── worker.go                   (likely exists)

services/transport/http/
├── unified_worker.go           (similar structure)
└── (likely worker_manager.go)
```

**Total duplication**: ~1500+ lines of nearly identical code across 3 transports

---

## Package Inventory

### Active Packages (Used)

- ✅ `go-parser` - Device/gateway parsers (essential)
- ✅ `go-cache` - Multi-tier caching (essential for new arch)
- ✅ `go-infra` - Database, MQTT, gRPC wrappers (essential)
- ✅ `go-data` - Data models (essential)
- ✅ `proto` - Protocol buffers (essential)

### Possibly Active but Unclear

- ⚠️ `go-normalizer` - Required by gRPC (from go.mod), but unclear if used
- ⚠️ `go-stream` - Listed in go.mod but not directly imported in code

### Unused/Legacy Packages (Not imported in services/apps)

- ❌ `go-transport-worker` - Has complete adapters for MQTT/gRPC/HTTP but unused!
- ❌ `go-worker-pool` - Worker pool pattern, not imported
- ❌ `go-adapter-factory` - Old adapter pattern
- ❌ `go-adapter-messages` - Old message types
- ❌ `go-processor` - Old architecture
- ❌ `go-session` (if exists) - Likely session management

---

## Recommended Consolidation Strategy

### Phase 1: Extract Common Worker Patterns → `go-transport-worker`

**Move from services/transport/\* into packages/go-transport-worker:**

```go
// packages/go-transport-worker/

// 1. Generic interfaces (transport-agnostic)
├── transport.go
│   ├── type TransportAdapter interface {
│   │   ├── Start(ctx)
│   │   ├── Stop(ctx)
│   │   └── ProcessMessage(ctx, device, payload)
│   └── type TransportWorkerManager interface {
│       ├── Start(ctx)
│       ├── Stop(ctx)
│       └── Discover(ctx) // Load from transport_registry

// 2. Common implementations
├── parser_registry.go          // 3-tier cache for parsers
├── base_worker_manager.go      // Generic discovery + sync
├── base_adapter.go             // Common adapter logic

// 3. Transport-specific
├── mqtt/
│   ├── adapter.go              // MQTT-specific connection logic
│   └── config.go
├── grpc/
│   ├── adapter.go              // gRPC-specific server logic
│   └── config.go
├── http/
│   ├── adapter.go              // HTTP-specific server logic
│   └── config.go

// 4. Ingest routing
└── ingest_streamer.go          // Forward to ingest service
```

### Phase 2: Simplify Transport Services

**services/transport/mqtt/, grpc/, http/** would become thin wrappers:

```go
// services/transport/mqtt/cmd/mqtt-adapter/main.go
manager := transportworker.NewMQTTWorkerManager(
    db,
    transportworker.DefaultConfig,
)
manager.Start(ctx)
```

**Result**: Each transport service is ~50 lines instead of 1500+

### Phase 3: Clean Up Package Dependencies

**Keep:**

- `go-parser` - Essential business logic
- `go-cache` - 3-tier caching system
- `go-infra` - Database/infrastructure wrappers
- `go-data` - Domain models
- `proto` - Protocol definitions
- `go-transport-worker` - Unified worker patterns (consolidated)

**Remove/Merge:**

- ❌ `go-adapter-factory` → Use `go-transport-worker` factories
- ❌ `go-adapter-messages` → Use protocol buffers (proto package)
- ❌ `go-processor` → Use unified processor in `go-transport-worker`
- ❌ `go-worker-pool` → Merge into `go-transport-worker`
- ⚠️ `go-normalizer` → Evaluate actual usage
- ⚠️ `go-stream` → Remove if not streaming-related

**Result**: From 11 packages → 6 essential packages

---

## Code Reuse Analysis

### Current Duplication

| Component          | MQTT | gRPC | HTTP | Duplication          |
| ------------------ | ---- | ---- | ---- | -------------------- |
| Worker Manager     | ✓    | ✓    | ✓    | 3x identical pattern |
| Discovery Cycle    | ✓    | ✓    | ✓    | 3x identical logic   |
| Parser Registry    | ✓    | ?    | ?    | 1-3x                 |
| Adapter Pattern    | ✓    | ✓    | ✓    | 3x                   |
| Message Routing    | ✓    | ✓    | ✓    | 3x                   |
| Metrics Collection | ✓    | ✓    | ✓    | 3x                   |

**Estimated duplication**: 60-70% of transport layer code

### Post-Consolidation Code Sharing

```
┌─────────────────────────────────┐
│ go-transport-worker (reusable)  │
├─────────────────────────────────┤
│ Base Classes (0 duplication)    │
│ - BaseWorkerManager             │
│ - BaseAdapter                   │
│ - ParserRegistry                │
│ - IngestStreamer                │
└─────────────────────────────────┘
         △  △  △
         ╱  │  ╲
        ╱   │   ╲
    MQTT  gRPC  HTTP
   (50L)  (50L) (50L)
```

**New duplication**: 5-10% (transport-specific config only)

---

## Implementation Plan

### Step 1: Create Unified Interfaces (2 hours)

- Define `TransportAdapter` interface
- Define `TransportWorkerManager` interface
- Move `ParserRegistry` to package

### Step 2: Consolidate Worker Manager (3 hours)

- Extract common discovery/sync logic
- Implement `BaseWorkerManager`
- All transports inherit from it

### Step 3: Create Transport-Specific Adapters (4 hours)

- MQTT adapter (MQTT connection logic only)
- gRPC adapter (gRPC server logic only)
- HTTP adapter (HTTP server logic only)

### Step 4: Update Services to Use Package (1 hour)

- services/transport/mqtt → import `go-transport-worker`
- services/transport/grpc → import `go-transport-worker`
- services/transport/http → import `go-transport-worker`

### Step 5: Cleanup Unused Packages (1 hour)

- Verify nothing else uses old packages
- Delete/archive: go-processor, go-adapter-factory, etc.

**Total Effort**: 11 hours → Saves 1000+ lines of code

---

## Dependencies After Consolidation

```
services/transport/mqtt
├── go-transport-worker
│   ├── go-parser
│   ├── go-cache
│   ├── go-infra
│   └── proto
└── other direct deps...

services/ingest
├── go-data
├── go-cache
├── go-infra
└── proto
```

**Result**: Clear dependency hierarchy, minimal duplication

---

## Questions to Validate

1. **Is `go-transport-worker` the right location**, or should we create a new `go-unified-transport` package?
2. **Should each transport have its own folder** in go-transport-worker, or be subpackages?
3. **Do we keep the separate services/transport/mqtt|grpc|http**, or consolidate into single service?
4. **Timeline**: Should this happen alongside the parser registry work, or after stabilization?

---

## Benefits

✅ **70% less code duplication**
✅ **Single source of truth for worker patterns**
✅ **Easier to add new transport types**
✅ **Unified testing/metrics/monitoring**
✅ **Clearer package dependencies**
✅ **Easier onboarding** (less code to understand)
