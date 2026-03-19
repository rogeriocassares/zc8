# Ingest Service - Data Plane

The Ingest Service handles **real-time telemetry processing from IoT devices** and is part of the **Data Plane** architecture.

## Overview

This service:

- ✅ Receives telemetry from **5 device protocols** (LoRaWAN, gRPC, MQTT, HTTP, OS Agent)
- ✅ Validates devices against PostgreSQL registry
- ✅ Parses payloads using device-specific decoders
- ✅ Caches configurations in Redis for fast access
- ✅ Stores telemetry in time-series databases
- ✅ Provides gRPC server on port `:50054`

## Structure

```
ingest/
├── cmd/
│   └── ingest/
│       └── main.go              # Data plane entry point
├── internal/
│   ├── dataplane/               # Core ingest logic
│   │   ├── config/              # Configuration management
│   │   ├── engine/              # Processing engine
│   │   ├── parser/              # Device payload parsers
│   │   ├── transport/           # Protocol handlers (gRPC, MQTT, HTTP)
│   │   ├── repository/          # Database queries
│   │   └── cache/               # Redis caching
│   ├── domain/                  # Domain models
│   ├── infra/                   # Infrastructure (DB, Redis, InfluxDB)
│   ├── pipeline/                # Data processing pipeline
│   ├── parser/                  # Vendor-specific parsers
│   └── shared/                  # Shared utilities
├── migrations/                  # Database schemas (used by control plane)
├── Dockerfile                   # Container build
├── go.mod                       # Dependencies
└── README.md                    # This file
```

## Quick Start

### 1. Compile Service

```bash
cd /Users/rogeriocassares/Git/rogeriocassares/zc8/services/ingest
go build -o ingest ./cmd/ingest
```

### 2. Set Environment

```bash
export DATABASE_URL="postgresql://postgres@localhost:5432/zc8"
export REDIS_URL="redis://localhost:6379"
export GRPC_PORT="50054"
export LOG_LEVEL="info"
```

### 3. Run Service

```bash
./ingest
```

Expected output:

```
Starting gRPC server on :50054
Connected to PostgreSQL (zc8)
Connected to Redis
Ready for device connections
```

### 4. Verify Connectivity

```bash
# Test gRPC endpoint
grpcurl -plaintext localhost:50054 list

# Monitor logs
tail -f /tmp/ingest.log
```

## Device Protocols

| Protocol    | Port  | Use Case                    |
| ----------- | ----- | --------------------------- |
| **gRPC**    | 50054 | ESP32 direct, OS Agents     |
| **MQTT**    | 1883  | MQTT brokers (pub-only)     |
| **HTTP**    | 8080  | Webhook devices             |
| **LoRaWAN** | N/A   | Via ChirpStack/TTN adapters |

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/zc8
DB_POOL_SIZE=20
DB_TIMEOUT=30s

# Redis (caching & pub-sub)
REDIS_URL=redis://localhost:6379
REDIS_DB=0
REDIS_PASSWORD=""

# InfluxDB (telemetry storage)
INFLUX_URL=https://influxdb.local:8086
INFLUX_TOKEN=your-api-token
INFLUX_BUCKET=telemetry
INFLUX_ORG=zc8

# Ingest Service
GRPC_PORT=50054
HTTP_PORT=8080
MQTT_PORT=1883
GRPC_TLS=false

# Logging
LOG_LEVEL=info
LOG_FORMAT=json
```

## Architecture

```
┌─────────────────────────────────────┐
│ Real Devices                        │
├─────────────────────────────────────┤
│ • LoRaWAN (ChirpStack, TTN)         │
│ • ESP32 + ZC2X (gRPC :50054)        │
│ • MQTT Sensors (:1883)              │
│ • HTTP Webhooks (:8080)             │
│ • OS Agents (local gRPC)            │
└─────────────┬───────────────────────┘
              │ Telemetry
              ↓
┌─────────────────────────────────────┐
│ Ingest Service (Data Plane)         │
├─────────────────────────────────────┤
│ • Protocol Handlers                 │
│ • Device Authentication             │
│ • Payload Parsing                   │
│ • Data Normalization                │
└─────────────┬───────────────────────┘
              │
              ├─→ PostgreSQL (device registry)
              ├─→ Redis (config cache)
              ├─→ InfluxDB (telemetry)
              └─→ Kafka/Queue (streaming)

              ↓
    Real-time Dashboard (Control Plane)
```

## Database Migrations

Database schema is defined in `migrations/`:

```bash
# Phase 1: Create schema
psql -U postgres -f migrations/001_create_database_and_schema.sql

# Phase 2: Seed data
psql -U postgres -d zc8 -f migrations/002_seed_data.sql
```

**Note:** Control plane (`/apps/api`, `/apps/web`) manages database schema.  
Data plane just **queries** it.

## Docker Build

```bash
# Build image
docker build -t zc8/ingest .

# Run container
docker run -e DATABASE_URL=postgresql://postgres@postgres:5432/zc8 \
           -e REDIS_URL=redis://redis:6379 \
           -p 50054:50054 \
           zc8/ingest
```

## Integration with Control Plane

| Component                                    | Purpose                                            |
| -------------------------------------------- | -------------------------------------------------- |
| **Control Plane** (`/apps/api`, `/apps/web`) | Creates devices, manages configs, updates settings |
| **Data Plane** (this service)                | Receives & processes telemetry using those configs |

Flow:

```
Admin creates device (Control Plane)
  ↓
INSERT into device_registry, device_lns
  ↓
Ingest service loads config on startup
  ↓
Device sends telemetry
  ↓
Ingest validates → parses → stores
```

## Key Dependencies

- **PostgreSQL**: Device registry, configuration
- **Redis**: Config caching, pub-sub messaging
- **InfluxDB**: Time-series telemetry storage
- **gRPC**: Protocol support (protobuf definitions in `/packages/proto`)
- **Kafka/NATS**: Optional message queue for streaming

## Development

### Running Locally

```bash
# Terminal 1: Database
psql -U postgres -d zc8

# Terminal 2: Redis
redis-server

# Terminal 3: Ingest Service
go run ./cmd/ingest
```

### Testing

```bash
# Run tests
go test ./...

# Test specific package
go test ./internal/dataplane/parser

# With verbose output
go test -v ./...
```

## Status

✅ **Data Plane Ready** - Fully functional  
⚠️ **Multi-tenant isolation** - Requires control plane to set up devices  
⚠️ **Authentication** - Validates JWT against device_registry

## See Also

- **Control Plane**: `/apps/api`, `/apps/web`
- **Architecture**: `/ARCHITECTURE.md`
- **Database**: `/SETUP_COMPLETE.md`
