# Transport Layer Microservices Architecture

## 1. Current Transport Layer Instantiation Flow

### Database-Driven Configuration (Already Implemented)

The transport layer uses a **registry table pattern** exactly as you suggested:

```sql
-- From: infra/postgres/migrations/010_create_organization_transports.sql
CREATE TABLE organization_transports (
    id BIGSERIAL PRIMARY KEY,
    org_id BIGINT NOT NULL,
    transport_protocol VARCHAR(20),      -- 'mqtt', 'http', 'grpc'
    gateway_vendor VARCHAR(50),          -- 'chirpstack', 'everynet', 'agent', 'zc2x'
    device_vendors TEXT[],               -- ['milesight', 'kron']
    mqtt_broker_url VARCHAR(255),
    mqtt_topic_pattern VARCHAR(255),
    http_webhook_url VARCHAR(255),
    grpc_server_url VARCHAR(255),
    enabled BOOLEAN,
    created_at TIMESTAMP
);
```

### Initialization Flow (Current Architecture)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Transport Service Starts (main.go)                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Create Worker Manager                                         │
│    - MQTTWorkerManager                                           │
│    - HTTPWorkerManager                                           │
│    - gRPCWorkerManager                                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Register Parsers                                              │
│    manager.RegisterGatewayParser("chirpstack", parser)          │
│    manager.RegisterDeviceParser("milesight", parser)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Call Manager.Start()                                          │
│    - Queries: SELECT * FROM organization_transports WHERE       │
│               transport_protocol='mqtt' AND enabled=true        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
    Org 1 (Chirp)          Org 2 (Everynet)      Org 3 (LNS)
    MQTT + Milesight       HTTP + Kron           gRPC + Agent
        │                      │                      │
        ▼                      ▼                      ▼
   MQTT Broker         HTTP Server:Port        gRPC Server:Port
```

### Code Example (Current Implementation)

```go
// services/transport/mqtt/internal/worker_manager.go
func (m *MQTTWorkerManager) Start(ctx context.Context) error {
    // 1. Query database for enabled organizations
    orgs, err := m.getEnabledOrganizations(ctx)
    if err != nil {
        return err
    }

    log.Printf("Found %d organizations with MQTT transport", len(orgs))

    // 2. For each organization, create workers
    for i, org := range orgs {
        if err := m.configureOrganization(org, i); err != nil {
            log.Printf("Error configuring org %d: %v", org.OrgID, err)
        }
    }

    // 3. Start polling for configuration changes
    m.wg.Add(1)
    go func() {
        defer m.wg.Done()
        m.watchConfigs()  // Checks every 30 seconds for new orgs
    }()

    return nil
}

// configureOrganization creates a worker for org + gateway combo
func (m *MQTTWorkerManager) configureOrganization(org *transport.WorkerConfig, index int) error {
    workerKey := fmt.Sprintf("%d/%s", org.OrgID, org.GatewayVendor)

    // Create MQTT connection to broker
    client, err := paho.New(m.ctx, cfg)
    if err != nil {
        return err
    }

    // Create transport worker (processes messages)
    worker := NewMQTTTransportWorker(
        org.OrgID,
        org.GatewayVendor,
        org.DeviceVendors,
        m.gatewayParsers[org.GatewayVendor],
        m.deviceParsers,
        m.deviceResolver,      // Device ID → Device Key lookup
        ingestClient,          // gRPC stream to ingest service
    )

    // Store worker
    m.workers[workerKey] = worker

    // Start worker (begins processing)
    return worker.Start(m.ctx)
}
```

---

## 2. Control Plane & Worker Initialization (Your Suggestion)

**You're exactly right** - the control plane should orchestrate worker initialization.

### Current Gap

The transport managers load config from database on startup and poll every 30 seconds. This is **passive and reactive**.

### Proposed: Active Control Plane on ElysiaJS

```typescript
// apps/api/src/routes/transport-control.ts (NEW)

import Elysia from 'elysia';

export const transportControl = new Elysia({ prefix: '/admin/transport' })

  // List all configured transports
  .get('/config', async ({ db }) => {
    return db.query(
      `SELECT * FROM organization_transports WHERE enabled = true`
    );
  })

  // Create or update transport configuration
  .post('/config', async ({ body, db }) => {
    const { org_id, transport_protocol, gateway_vendor, config } = body;

    // Upsert into database
    await db.query(`
      INSERT INTO organization_transports
        (org_id, transport_protocol, gateway_vendor, mqtt_broker_url, ...)
      VALUES ($1, $2, $3, ...)
      ON CONFLICT (org_id, transport_protocol, gateway_vendor)
      DO UPDATE SET ...
    `, [org_id, transport_protocol, gateway_vendor, ...]);

    // Trigger worker initialization on transport service
    await transportService.initializeWorker({
      orgId: org_id,
      protocol: transport_protocol,
      gatewayVendor: gateway_vendor,
      config
    });

    return { status: 'initialized', worker_id: `${org_id}/${gateway_vendor}` };
  })

  // Enable/disable a transport worker
  .patch('/config/:org_id/:protocol/:vendor/status', async ({ params, body, db }) => {
    await db.query(`
      UPDATE organization_transports
      SET enabled = $1, updated_at = NOW()
      WHERE org_id = $2 AND transport_protocol = $3 AND gateway_vendor = $4
    `, [body.enabled, params.org_id, params.protocol, params.vendor]);

    // Notify transport service
    if (body.enabled) {
      await transportService.initializeWorker(...);
    } else {
      await transportService.stopWorker(...);
    }

    return { status: 'updated' };
  })

  // Get worker health/metrics
  .get('/metrics/:org_id/:protocol', async ({ params }) => {
    return transportService.getMetrics(params.org_id, params.protocol);
  });
```

### Integration with Transport Service

The transport service could expose a **gRPC or HTTP endpoint** for control plane commands:

```go
// services/transport/control/server.go (NEW)
package control

import "context"

type TransportControl struct {
    mqttManager *mqtt.MQTTWorkerManager
    httpManager *http.HTTPWorkerManager
    grpcManager *grpc.gRPCWorkerManager
}

// InitializeWorker dynamically creates a new transport worker
func (tc *TransportControl) InitializeWorker(
    ctx context.Context,
    orgID int32,
    protocol string,
    gatewayVendor string,
    config *WorkerConfig,
) error {
    manager := tc.getManager(protocol)
    if manager == nil {
        return fmt.Errorf("unknown protocol: %s", protocol)
    }
    return manager.ConfigureOrganization(config)
}

// StopWorker gracefully stops a transport worker
func (tc *TransportControl) StopWorker(
    ctx context.Context,
    orgID int32,
    protocol string,
    gatewayVendor string,
) error {
    manager := tc.getManager(protocol)
    if manager == nil {
        return fmt.Errorf("unknown protocol: %s", protocol)
    }
    workerId := fmt.Sprintf("%d/%s", orgID, gatewayVendor)
    return manager.StopWorker(ctx, workerId)
}

// GetMetrics returns worker health and performance
func (tc *TransportControl) GetMetrics(
    ctx context.Context,
    orgID int32,
    protocol string,
) ([]WorkerMetrics, error) {
    manager := tc.getManager(protocol)
    if manager == nil {
        return nil, fmt.Errorf("unknown protocol: %s", protocol)
    }
    return manager.GetMetrics(), nil
}
```

---

## 3. Microservices Deployment Options

### Option A: Single Transport Service (Current Architecture)

```
┌──────────────────────────────────────────┐
│ Transport Service (Single Container)     │
├──────────────────────────────────────────┤
│                                          │
│  MQTT Manager  ┬  HTTP Manager  ┬  gRPC │
│  - Workers     │  - Workers     │  Manager
│  - Clients     │  - Servers     │  - Workers
│  - Subscriptions                        │
│                                          │
└──────────────────────────────────────────┘
              │
              ▼ (gRPC stream)
┌──────────────────────────────────────────┐
│ Ingest Service (Single Container)        │
├──────────────────────────────────────────┤
│ - Batches events                         │
│ - Writes to InfluxDB3                    │
│ - Fans out to Redis + NATS               │
└──────────────────────────────────────────┘
```

**Pros:**

- ✅ Simpler deployment
- ✅ Shared parser registry
- ✅ Single control plane to manage

**Cons:**

- ❌ MQTT spike affects HTTP/gRPC processing
- ❌ Memory: 3 protocols × N orgs = high memory footprint
- ❌ Can't scale protocols independently

**Best for:** Small deployments (< 50 orgs, < 10k events/sec)

---

### Option B: Separate Transport Microservices (Recommended for Scale)

```
                ┌──────────────────────────────────┐
                │ Control Plane (ElysiaJS)         │
                │ - API Server                     │
                │ - gRPC endpoints                 │
                └──────────┬───────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │ MQTT Service │  │ HTTP Service │  │ gRPC Service │
    │ (2 replicas) │  │ (4 replicas) │  │ (2 replicas) │
    │              │  │              │  │              │
    │ - MQTT Mgr   │  │ - HTTP Mgr   │  │ - gRPC Mgr   │
    │ - 1000 orgs  │  │ - 500 orgs   │  │ - 200 orgs   │
    │ - Parsers    │  │ - Parsers    │  │ - Parsers    │
    └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
           │                 │                 │
           └─────────────────┼─────────────────┘
                             │
                             ▼ (gRPC streams)
                    ┌──────────────────────────────────┐
                    │ Ingest Service (3 replicas)      │
                    │ - Batches events                 │
                    │ - Writes to InfluxDB3            │
                    │ - Fans out to Redis + NATS       │
                    └──────────────────────────────────┘
```

**Pros:**

- ✅ Independent scaling: MQTT burst doesn't affect HTTP
- ✅ Per-protocol optimization (MQTT for IoT, HTTP for webhooks, gRPC for streaming)
- ✅ Failure isolation: MQTT down ≠ HTTP down
- ✅ Fine-grained resource allocation

**Cons:**

- ❌ More complex deployment (Docker Compose, K8s)
- ❌ Cross-service communication overhead
- ❌ Shared database (organization_transports)

**Best for:** Production deployments (> 500 orgs, > 100k events/sec)

---

### Option C: Protocol-Per-Container + Tenant Sharding (Maximum Scale)

For **10M devices** across multiple organizations:

```
┌─────────────────────────────────────────────────────────┐
│ Control Plane (Elysia)                                  │
│ - Tenant-to-shard mapping                               │
│ - Load balancing decisions                              │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │                     │
    MQTT Workers            HTTP Workers
    ┌──────────┐            ┌──────────┐
    │ Shard 1  │ x5         │ Shard 1  │ x3
    │ Org 1-20 │            │ Org 1-50 │
    └────┬─────┘            └────┬─────┘
    ┌──────────┐            ┌──────────┐
    │ Shard 2  │ x5         │ Shard 2  │ x3
    │ Org 21-40            │ Org 51-100
    └────┬─────┘            └────┬─────┘
    ┌──────────┐            ┌──────────┐
    │ Shard 3  │ x5         │ Shard 3  │ x3
    │ Org 41-60            │ Org 101-150
    └────┬─────┘            └────┬─────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────────┐
         │ Ingest Service (10 reps) │
         │ - gRPC + HTTP load bal  │
         │ - Shard by device_key   │
         └──────────┬──────────────┘
                    ▼
         ┌─────────────────────────┐
         │ InfluxDB3 (Distributed) │
         └─────────────────────────┘
```

**Configuration:**

```sql
-- Tenant-to-shard mapping
CREATE TABLE transport_shards (
    id SERIAL PRIMARY KEY,
    protocol VARCHAR(20),           -- 'mqtt', 'http'
    shard_id INT,                   -- 1, 2, 3...
    org_id_range_start INT,
    org_id_range_end INT,
    replicas INT DEFAULT 2,
    container_port_base INT,        -- 9000 + shard_id
    created_at TIMESTAMP
);

-- Example:
INSERT INTO transport_shards VALUES
(1, 'mqtt', 1, 1, 20, 5, 9001),
(2, 'mqtt', 2, 21, 40, 5, 9002),
(3, 'mqtt', 3, 41, 60, 5, 9003),
(4, 'http', 1, 1, 50, 3, 9101),
(5, 'http', 2, 51, 100, 3, 9102);
```

**Pros:**

- ✅ Scales to **10M+ devices**
- ✅ Per-organization QoS (SLA could vary)
- ✅ Cross-DC deployment ready
- ✅ Hot-rebalancing possible

**Cons:**

- ❌ Complex orchestration
- ❌ Distributed coordinator needed (consensus on shard assignment)
- ❌ Requires K8s or similar

**Best for:** Enterprise deployments (> 1M devices)

---

## 4. Recommended Approach for ZC8

### Phase 1 (Now): Option A → Option B

1. Start with **single transport service** (current)
2. Database-driven configuration via `organization_transports` table
3. Control plane adds/updates configs via API
4. Transport service polls database for changes (or gRPC push from API)

### Phase 2 (When scaling): Option B

1. Split into **3 separate services**: mqtt, http, grpc
2. Each runs in K8s with auto-scaling based on events/sec
3. Shared database for configuration
4. Control plane orchestrates lifecycle

### Phase 3 (10M devices): Option C

1. Implement **tenant sharding** across multiple transport replicas
2. Device hashing: `shard_id = hash(device_id) % num_shards`
3. Control plane calculates optimal shard count per org/protocol
4. Ingest service already shards by device_key (consistent hashing)

---

## 5. Control Plane Integration (ElysiaJS API)

```typescript
// Ensure transport config in DB is the source of truth
POST /api/admin/transport/config
{
  "org_id": 1,
  "transport_protocol": "mqtt",
  "gateway_vendor": "chirpstack",
  "device_vendors": ["milesight", "kron"],
  "mqtt_broker_url": "mqtt://broker.example.com:1883",
  "mqtt_topic_pattern": "application/+/device/+/up",
  "mqtt_username": "zc8",
  "mqtt_password": "...",
  "enabled": true
}

// Control plane immediately notifies transport service
// either via:
//   1. Long-polling (transport checks every 30s)
//   2. gRPC push (transport listens for config change events)
//   3. Message queue (control plane pushes to Redis/NATS)

// Transport service applies changes:
// - New org with MQTT? → Create worker
// - Disabled org? → Stop worker
// - Config changed? → Restart worker with new config
```

---

## Summary Table

| Aspect                       | Option A         | Option B                  | Option C                   |
| ---------------------------- | ---------------- | ------------------------- | -------------------------- |
| **Max Events/sec**           | 100k             | 1M                        | 10M+                       |
| **Max Orgs**                 | 100-500          | 500-5000                  | 5000+                      |
| **Deployment**               | Single container | Multiple K8s deployments  | Distributed K8s + sharding |
| **Scaling**                  | Vertical         | Horizontal (per protocol) | Horizontal + sharding      |
| **Control Plane Complexity** | Low              | Medium                    | High                       |
| **Cost**                     | Low              | Medium                    | High (but scales linearly) |
| **Time to Implement**        | Done             | 2-4 weeks                 | 4-8 weeks                  |

**Recommendation:** Use **Option B** as target. Start with **Option A** now, migrate to **Option B** when hitting 100k events/sec or 500+ orgs.
