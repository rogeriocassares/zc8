# Your Questions Answered: Transport Layer Simplification

**Date**: March 12, 2026  
**Questions**: 4 specific architectural decisions  
**Answer**: Database-driven worker pool pattern

---

## Question 1: gRPC Server - Multiple Instances or 1 Instance with Many Workers?

### ✅ Answer: MULTIPLE INSTANCES (3 separate instances, 50051/50052/50053)

#### Why NOT 1 Instance with Many Workers:

1. **Failure Isolation** - If v2n has memory leak → storio-cli loses all connections
2. **Resource Contention** - High-throughput v2n starves low-throughput storio-cli
3. **Scaling Independently** - Can't scale v2n 5x without scaling storio-cli 5x
4. **Monitoring** - Can't tell which client is causing problems
5. **Deployment** - Bug in v2n handler blocks storio-cli deployment

#### Why Multiple Instances is Better:

```
Instance 1 (50051): storio-cli clients
- 10 max workers
- Low throughput
- 2-3 replicas
- 256MB memory/instance

Instance 2 (50052): v2n clients
- 100 max workers
- High throughput
- 3-5 replicas (auto-scale)
- 1GB memory/instance

Instance 3 (50053): Reserve/Backup
- Generic handler
- 50 max workers
- 1 replica
- 512MB memory/instance
```

#### Deployment Configuration:

```yaml
# Kubernetes
kind: Deployment
metadata:
  name: grpc-storio
spec:
  replicas: 2
  template:
    env:
      - name: GRPC_PORT
        value: "50051"
      - name: CLIENT_FILTER # NEW: Just filter by client ID
        value: "storio-*"
      - name: MAX_WORKERS
        value: "10"

---
kind: Deployment
metadata:
  name: grpc-v2n
spec:
  replicas: 3-5 # Auto-scale
  template:
    env:
      - name: GRPC_PORT
        value: "50052"
      - name: CLIENT_FILTER
        value: "v2n-*"
      - name: MAX_WORKERS
        value: "100"
```

#### Client Connection:

```
Client identifies itself: "storio-customer-123"
         ↓
Client library determines port based on prefix
         ↓
Connects to :50051 (storio instance)
         ↓
Instance filters by "storio-*" pattern
         ↓
Routes to v2n-specific handler
```

---

## Question 2: MQTT Subscriber - How to Handle Multiple Provider Configurations?

### ✅ Answer: SINGLE Worker Pool with Provider-Based Internal Routing

Instead of:

```
❌ Multiple MQTT instances (one per provider) - overkill
❌ Complex if/else logic in code - hard to maintain
❌ Per-team configuration - doesn't scale
```

Do This:

```
✅ One MQTT Worker Pool
✅ Database-driven discovery (team_device_providers)
✅ One worker per (team, provider) pair
✅ Internal routing based on topic/provider
```

#### Automatic Configuration Discovery:

```sql
-- Query runs periodically (or on config change)
SELECT * FROM team_device_providers_view
WHERE protocol_type = 'mqtt'
  AND is_active = true;

-- Returns:
team_id | team_name    | provider_name | broker_addr                | topics
--------|--------------|---------------|--------------------------|----------------------------------
1       | GMS          | chirpstack    | networkserver2.maua.br:1  | ["applications/+/devices/+/up"]
        |              |               | 883                       |
2       | MauaRacing   | chirpstack    | networkserver2.maua.br:1  | ["applications/+/devices/+/up"]
        |              |               | 883                       |
3       | Teams        | mqtt_direct   | mqtt.maua.br:1883         | ["devices/+/telemetry"]
4       | RaceTracks   | mqtt_direct   | mqtt.maua.br:1883         | ["devices/+/telemetry"]
5       | Committee    | mqtt_direct   | mqtt.maua.br:1883         | ["devices/+/telemetry"]
```

#### Worker Pool Creates 5 Workers Automatically:

```go
// Pseudo-code
func (pool *MQTTWorkerPool) Discover() {
  configs := queryTeamProviders("mqtt")

  for _, config := range configs {
    worker := NewWorker(config)
    worker.Connect(config.BrokerAddr, config.Credentials)
    worker.Subscribe(config.Topics)
    pool.Add(worker)
  }

  // Total: 5 workers, but only 2 MQTT broker connections
  // (pooling by broker address)
}
```

#### Message Flow:

```
Message arrives at any topic from any broker
         ↓
Matched to (team_id, provider_id) by topic pattern
         ↓
Wrapped into unified format:
{
  "transport_type": "mqtt",
  "team_id": 1,
  "provider": "chirpstack",
  "timestamp": 1234567890,
  "payload": {...}
}
         ↓
Sent to unified ingest channel
         ↓
All subsystems see same format (independent of transport)
```

#### 2 Possible Providers × 5 Teams = Database-Driven Configuration:

```sql
-- Add new team? Just insert one row:
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config)
SELECT 7, id, id, jsonb_build_object('username', '...')
FROM device_providers WHERE code = 'mqtt_direct';

-- Change provider? Just update:
UPDATE team_device_providers SET device_provider_id = 2 WHERE team_id = 1;

-- Add new broker? Just insert:
INSERT INTO transport_endpoints (host, port, config)
VALUES ('new-broker.local', 1883, '{}');

-- No code changes! No deploy! Just database changes!
```

---

## Question 3: HTTP Server - How to Handle Routing?

### ✅ Answer: SINGLE HTTP Server Worker with Dynamic Route Registration

```
❌ Multiple HTTP instances (one per team) - unnecessary
❌ Hard-coded routes in code - can't add without deploy
✅ Single worker, routes registered from database
```

#### Dynamic Route Registration:

```go
func (w *HTTPServerWorker) Start() error {
  // Get this worker's routes from database
  routes := getRoutesForTeam(w.TeamID, w.ProviderID)

  router := http.NewServeMux()

  for _, route := range routes {
    // "POST /devices" → "everynet_handler"
    router.HandleFunc(route.Path, w.HandleRequest)
  }

  server := &http.Server{
    Addr:    ":8081",
    Handler: router,
  }

  return server.ListenAndServe()
}

func (w *HTTPServerWorker) HandleRequest(rw http.ResponseWriter, req *http.Request) {
  // Extract data
  payload := parseRequest(req)

  // Route to unified ingest
  message := map[string]interface{}{
    "transport_type": "http_server",
    "team_id":        w.TeamID,
    "provider":       w.ProviderName,  // "everynet"
    "path":           req.URL.Path,
    "payload":        payload,
  }

  w.ingestChan <- message
  rw.WriteHeader(http.StatusOK)
}
```

#### Database Configuration:

```sql
-- Everynet provider routes
INSERT INTO team_device_providers_config
(team_id, provider_id, config)
VALUES
(
  (SELECT id FROM teams WHERE slug = 'some-team'),
  (SELECT id FROM device_providers WHERE code = 'everynet'),
  jsonb_build_object(
    'routes', jsonb_build_array(
      'POST /devices',
      'POST /messages',
      'GET /status'
    ),
    'authentication', 'api_key',
    'api_key', 'secret-key-here'
  )
);
```

---

## Question 4: HTTP Client - Schneider Cloud & Others

### ✅ Answer: SINGLE HTTP Client Worker Pool with Polling/Streaming

```
❌ Hard-coded client connections - not flexible
✅ Database-driven endpoint polling
```

#### Database Configuration:

```sql
INSERT INTO team_device_providers (team_id, device_provider_id, config)
SELECT
  (SELECT id FROM teams WHERE slug = 'some-team'),
  (SELECT id FROM device_providers WHERE code = 'schneider'),
  jsonb_build_object(
    'endpoint', 'https://cloud.schneider.com/devices',
    'method', 'POST',
    'authentication', jsonb_build_object(
      'type', 'bearer',
      'token', 'secret-token'
    ),
    'polling_interval', 60,
    'retry_max', 3
  );
```

#### Automatic Worker Creation:

```go
func (w *HTTPClientWorker) Start() error {
  interval := w.Config.PollingInterval

  ticker := time.NewTicker(time.Duration(interval) * time.Second)

  for range ticker.C {
    payload, err := w.FetchFromRemote()
    if err != nil {
      // Retry logic, exponential backoff
      continue
    }

    w.ingestChan <- map[string]interface{}{
      "transport_type": "http_client",
      "team_id":        w.TeamID,
      "provider":       "schneider",
      "payload":        payload,
    }
  }
}
```

---

## Summary: Simplest Architecture

### Problem You Had:

- Different throughput (storio-cli vs v2n)
- Different providers (ChirpStack vs direct MQTT)
- Different protocols (MQTT vs gRPC vs HTTP)
- Complex routing logic needed

### Solution (Database-Driven Worker Pools):

```
┌─────────────────────────────────────────────┐
│           Database (Source of Truth)        │
├─────────────────────────────────────────────┤
│ team_device_providers                       │
│   ├── team_id                               │
│   ├── device_provider_id                    │
│   ├── transport_endpoint_id                 │
│   └── config (JSONB)                        │
└─────────────────────────────────────────────┘
              ↑
              │ polls every 5 minutes
              │
┌─────────────────────────────────────────────┐
│      Worker Pool Manager                    │
├─────────────────────────────────────────────┤
│ For each (transport_type, provider):        │
│   1. Create worker                          │
│   2. Connect using database config          │
│   3. Subscribe using database config        │
│   4. Route all data to unified ingest       │
└─────────────────────────────────────────────┘
          ↓ new devices
        Ingest
          ↓
    Backend Systems
```

### Key Benefits:

✅ **No transport logic in code** - Database configures everything  
✅ **gRPC: 3 separate instances** - Proper isolation by workload  
✅ **MQTT: 1 worker pool** - Discovers providers automatically  
✅ **HTTP: 1 worker pool** - Routes registered from database  
✅ **Add new team** - Just insert database row  
✅ **Change provider** - Just update database row  
✅ **Monitor each transport** - Per-type metrics  
✅ **Scale independently** - Scale gRPC-v2n without scaling storio-cli

### Deployment:

```bash
# Current approach (complex)
docker run grpc-storio-hardcoded
docker run mqtt-chirpstack-hardcoded
docker run mqtt-direct-hardcoded
docker run http-everynet-hardcoded
# ... many images, hard to maintain

# Simplified approach (this design)
docker run transport-worker mqtt  # auto-discovers from DB
docker run transport-worker grpc  # auto-discovers from DB
docker run transport-worker http  # auto-discovers from DB
# ... generic images, config from database!
```

---

## Implementation Roadmap

1. **Week 1**: Database schema setup (team_device_providers, views)
2. **Week 2**: Implement WorkerPool base class
3. **Week 3**: Implement MQTT adapter
4. **Week 4**: Implement gRPC 3-instance setup
5. **Week 5**: Implement HTTP Server adapter
6. **Week 6**: Implement HTTP Client adapter
7. **Week 7**: Unified ingest testing
8. **Week 8**: Monitoring & metrics

---

**Recommendation**: Start with MQTT worker pool - it covers 50% of edge cases and demonstrates the pattern.

Then replicate pattern for gRPC, HTTP, etc.

All configuration changes after that are just database updates (no code deploys!).
