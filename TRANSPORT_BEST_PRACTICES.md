# Transport Layer Simplification & Architecture Guide

**Date**: March 12, 2026  
**Status**: Design Documentation  
**Problem**: Simplified hybrid transport management with database-driven configuration

---

## Your Questions Answered

### 1. gRPC Server: Multiple Instances vs Single Instance with Many Workers?

**Answer: ✅ MULTIPLE INSTANCES (Best Practice)**

#### Why Multiple Instances is Better:

| Aspect                  | Single Instance + Workers                   | Multiple Instances                                  |
| ----------------------- | ------------------------------------------- | --------------------------------------------------- |
| **Failure Isolation**   | ❌ All clients lose connection              | ✅ storio-cli unaffected if v2n fails               |
| **Resource Contention** | ❌ High-throughput v2n blocks other clients | ✅ Each workload isolated                           |
| **Scaling**             | ❌ One scaling knob for all                 | ✅ Scale storio (1-3 replicas), v2n (3-10 replicas) |
| **Memory Usage**        | ❌ Single large process                     | ✅ Right-sized per workload                         |
| **Monitoring**          | ❌ Aggregate metrics only                   | ✅ Per-client metrics                               |
| **Rollout**             | ❌ One rollout affects all                  | ✅ Update v2n independently                         |
| **Code Complexity**     | ❌ Complex routing/filtering                | ✅ Simple client filtering                          |

#### Recommended Multi-Instance Architecture:

```yaml
# Kubernetes Deployment

apiVersion: apps/v1
kind: Deployment
metadata:
  name: grpc-storio
spec:
  replicas: 2-3 # Low-throughput, reliable
  template:
    spec:
      containers:
        - name: grpc-server
          image: zc8/grpc-server:latest
          ports:
            - containerPort: 50051
          env:
            - name: GRPC_PORT
              value: "50051"
            - name: GRPC_CLIENT_FILTER
              value: "storio-*"
            - name: GRPC_MAX_WORKERS
              value: "10"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grpc-v2n
spec:
  replicas: 3-5 # Higher-throughput, auto-scale
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    spec:
      containers:
        - name: grpc-server
          image: zc8/grpc-server:latest
          ports:
            - containerPort: 50052
          env:
            - name: GRPC_PORT
              value: "50052"
            - name: GRPC_CLIENT_FILTER
              value: "v2n-*"
            - name: GRPC_MAX_WORKERS
              value: "100"
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"

---
apiVersion: v1
kind: Service
metadata:
  name: grpc-pool
spec:
  ports:
    - name: storio
      port: 50051
      targetPort: 50051
    - name: v2n
      port: 50052
      targetPort: 50052
    - name: reserve
      port: 50053
      targetPort: 50053
```

#### Client Connection Strategy:

```
DNS: grpc.maua.br
  → Resolves to: grpc-storio.svc.cluster.local (50051)
  →              grpc-v2n.svc.cluster.local (50052)
  →              (50053 reserve)

Client Logic:
if clientID.startsWith("storio-") → connect to :50051
if clientID.startsWith("v2n-") → connect to :50052
else → connect to :50053 (fallback)
```

---

### 2. MQTT Subscriber: Complex Multi-Provider Setup

**Answer: ✅ SINGLE MQTT WORKER POOL with Provider-Based Routing**

#### Simplified MQTT Architecture:

```
Single Worker Pool:
├── Worker 1: Team GMS + ChirpStack
│   ├── Broker: networkserver2.maua.br:1883
│   ├── Topic: applications/+/devices/+/up
│   └── Credentials: gms-user / gms-pass
│
├── Worker 2: Team MauaRacing + ChirpStack
│   ├── Broker: networkserver2.maua.br:1883
│   ├── Topic: applications/+/devices/+/up
│   └── Credentials: mauaracing-user / pass
│
├── Worker 3: Team Teams + MQTT Direct
│   ├── Broker: mqtt.maua.br:1883
│   ├── Topic: devices/+/telemetry
│   └── Credentials: teams-user / pass
│
├── Worker 4: Team RaceTracks + MQTT Direct
│   ├── Broker: mqtt.maua.br:1883
│   ├── Topic: devices/+/telemetry
│   └── Credentials: racetracks-user / pass
│
└── Worker 5: Team Committee + MQTT Direct
    ├── Broker: mqtt.maua.br:1883
    ├── Topic: devices/+/telemetry
    └── Credentials: committee-user / pass
```

#### Database Configuration (Single Source of Truth):

```sql
-- Teams using ChirpStack
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config)
SELECT
  t.id,
  dp.id,
  te.id,
  jsonb_build_object(
    'username', 'gms-user',
    'password', 'gms-pass',
    'topics', '["applications/+/devices/+/up"]'
  )
FROM teams t
JOIN device_providers dp ON dp.code = 'chirpstack'
JOIN transport_endpoints te ON te.broker_url = 'networkserver2.maua.br'
WHERE t.slug IN ('gms', 'mauaracing');

-- Teams using direct MQTT
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config)
SELECT
  t.id,
  dp.id,
  te.id,
  jsonb_build_object(
    'username', t.slug || '-user',
    'password', 'team-pass',
    'topics', '["devices/+/telemetry"]'
  )
FROM teams t
JOIN device_providers dp ON dp.code = 'mqtt'
JOIN transport_endpoints te ON te.broker_url = 'mqtt.maua.br'
WHERE t.slug IN ('teams', 'racetracks', 'committee');
```

#### Dynamic Worker Discovery:

```go
// Pseudo-code showing automatic worker creation
func (wp *MQTTWorkerPool) DiscoverTeamProviders() error {
  // Query: Get all teams with MQTT provider
  query := `
    SELECT team_id, provider_name, broker, topics, credentials
    FROM team_device_providers_view
    WHERE transport_type = 'mqtt'
    ORDER BY team_id
  `

  // For each team+provider combination, create one worker
  // Workers automatically connect based on discovered config
  // No hardcoded team logic!
}
```

#### Message Routing:

```go
// All MQTT messages flow through same unified handler
func (w *MQTTWorker) OnMessage(topic string, payload []byte) error {
  message := map[string]interface{}{
    "transport_type": "mqtt",
    "team_id":        w.TeamID,              // From worker config
    "provider":       w.ProviderName,        // "chirpstack" or "mqtt"
    "topic":          topic,
    "timestamp":      time.Now().Unix(),
    "payload":        payload,
  }

  // Send to unified ingest (same as gRPC, HTTP, etc)
  w.ingestChan <- message

  return nil
}
```

---

### 3. HTTP Server: Everynet Provider

**Answer: ✅ SINGLE HTTP SERVER WORKER with Dynamic Route Registration**

#### Simplified HTTP Server Architecture:

```
HTTP Worker Pool:
├── Worker 1: Everynet (Port 8081)
│   ├── Listener: 0.0.0.0:8081
│   ├── Routes:
│   │   POST /devices (provider: everynet)
│   │   POST /messages (provider: everynet)
│   └── Auth: API Key

└── Worker 2: Custom Webhook (Port 8082)
    ├── Listener: 0.0.0.0:8082
    ├── Routes:
    │   POST /telemetry
    │   POST /events
    └── Auth: JWT
```

#### Database Configuration:

```sql
-- Team with HTTP server provider
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config)
SELECT
  t.id,
  dp.id,
  te.id,
  jsonb_build_object(
    'listen', '0.0.0.0:8081',
    'routes', jsonb_build_object(
      'POST /devices', 'everynet_handler',
      'POST /messages', 'everynet_handler'
    ),
    'authentication', 'api_key',
    'api_key', 'secret-key-12345'
  )
FROM teams t
JOIN device_providers dp ON dp.code = 'everynet'
JOIN transport_endpoints te ON te.protocol = 'http'
WHERE t.slug = 'some-http-team';
```

#### Implementation:

```go
func (w *HTTPServerWorker) Start() error {
  router := http.NewServeMux()

  // Dynamic route registration based on provider
  if w.ProviderName == "everynet" {
    router.HandleFunc("POST /devices", w.handleEverynetDevices)
    router.HandleFunc("POST /messages", w.handleEverynetMessages)
  }

  server := &http.Server{
    Addr:    w.Config.BrokerAddr,  // "0.0.0.0:8081"
    Handler: router,
  }

  w.Connection = server
  w.Active = true

  go server.ListenAndServe()
  return nil
}

func (w *HTTPServerWorker) handleEverynetDevices(rw http.ResponseWriter, req *http.Request) {
  // Verify API key
  if req.Header.Get("Authorization") != w.Config.Credentials["api_key"] {
    http.Error(rw, "Unauthorized", http.StatusUnauthorized)
    return
  }

  // Parse request
  var payload map[string]interface{}
  json.NewDecoder(req.Body).Decode(&payload)

  // Route to unified ingest
  message := map[string]interface{}{
    "transport_type": "http_server",
    "team_id":        w.TeamID,
    "provider":       "everynet",
    "timestamp":      time.Now().Unix(),
    "payload":        payload,
  }
  w.ingestChan <- message

  rw.WriteHeader(http.StatusOK)
}
```

---

### 4. HTTP Client: Schneider Cloud Provider

**Answer: ✅ SINGLE HTTP CLIENT WORKER with Connection Pooling**

#### Simplified HTTP Client Architecture:

```
HTTP Client Worker Pool:
├── Worker 1: Schneider Cloud
│   ├── Endpoint: https://cloud.schneider.com/devices
│   ├── Method: POST (polling interval: 60s)
│   └── Auth: Bearer Token

└── Worker 2: Custom Remote API
    ├── Endpoint: https://api.example.com/telemetry
    ├── Method: GET (streaming/webhook)
    └── Auth: OAuth2
```

#### Database Configuration:

```sql
-- Team with HTTP client provider
INSERT INTO team_device_providers (team_id, device_provider_id, transport_endpoint_id, config)
SELECT
  t.id,
  dp.id,
  te.id,
  jsonb_build_object(
    'endpoint', 'https://cloud.schneider.com/devices',
    'method', 'POST',
    'authentication', jsonb_build_object(
      'type', 'bearer',
      'token', 'secret-token-xyz'
    ),
    'polling_interval', 60,
    'retry_policy', jsonb_build_object(
      'max_retries', 3,
      'backoff_ms', 1000
    )
  )
FROM teams t
JOIN device_providers dp ON dp.code = 'schneider'
JOIN transport_endpoints te
WHERE t.slug = 'some-http-client-team';
```

#### Implementation:

```go
func (w *HTTPClientWorker) Start() error {
  w.Active = true

  // Polling-based connection
  ticker := time.NewTicker(time.Duration(w.Config.PollingInterval) * time.Second)

  go func() {
    for range ticker.C {
      payload, err := w.fetchRemoteData()
      if err != nil {
        w.mu.Lock()
        w.ErrorCount++
        w.mu.Unlock()
        continue
      }

      // Route to unified ingest
      message := map[string]interface{}{
        "transport_type": "http_client",
        "team_id":        w.TeamID,
        "provider":       w.ProviderName,
        "timestamp":      time.Now().Unix(),
        "payload":        payload,
      }
      w.ingestChan <- message
    }
  }()

  return nil
}

func (w *HTTPClientWorker) fetchRemoteData() ([]byte, error) {
  client := &http.Client{Timeout: 10 * time.Second}

  req, _ := http.NewRequest("POST", w.Config.Endpoint, nil)
  req.Header.Set("Authorization", "Bearer " + w.Config.Credentials["token"])

  resp, err := client.Do(req)
  if err != nil {
    return nil, err
  }
  defer resp.Body.Close()

  if resp.StatusCode != http.StatusOK {
    return nil, fmt.Errorf("non-200 response: %d", resp.StatusCode)
  }

  return io.ReadAll(resp.Body)
}
```

---

## Complete Simplified Architecture

### Database-Driven Configuration

```sql
-- All transport configuration lives here:
team_device_providers table

Columns:
├── team_id → Which team
├── device_provider_id → Which provider (ChirpStack, Everynet, etc)
├── transport_endpoint_id → Connection details (broker, port, etc)
├── is_active → Enable/disable without code change
└── config → JSONB with provider-specific settings
    ├── credentials (username, password, token)
    ├── topics (MQTT topics)
    ├── routes (HTTP routes)
    ├── endpoints (polling endpoints)
    └── custom settings per provider

Benefits:
✅ No code changes for new teams
✅ No code changes for new providers (mostly)
✅ Graceful configuration reload
✅ Database transactions for consistency
✅ Audit trail of changes
✅ A/B testing: run two providers simultaneously
```

### Single Main Process Architecture

```go
// Pseudo-code for simplified main.go
func main() {
  db := connectDB()
  ingestChan := make(chan interface{})

  // Start all worker pools (not predefined by user)
  pools := map[string]*WorkerPool{
    "mqtt":        NewWorkerPool("mqtt", db, ingestChan),
    "grpc":        NewWorkerPool("grpc", db, ingestChan),
    "http_server": NewWorkerPool("http_server", db, ingestChan),
    "http_client": NewWorkerPool("http_client", db, ingestChan),
  }

  for _, pool := range pools {
    pool.Start() // Discovers config from DB
  }

  // All data flows through unified ingest
  go processIngestMessages(ingestChan)

  // Done! No transport-specific logic!
  // All configuration is in database
}
```

### Comparison: Complex vs Simplified

| Aspect                       | Complex (By Team)               | Simplified (Database-Driven)   |
| ---------------------------- | ------------------------------- | ------------------------------ |
| **Configuration Management** | ❌ Hard-coded per team          | ✅ Database table              |
| **Adding New Team**          | ❌ Code change required         | ✅ Just insert row             |
| **Adding New Provider**      | ❌ Code change + deploy         | ✅ Just insert row (mostly)    |
| **Changing Team Provider**   | ❌ Code + deploy + restart      | ✅ Update row, graceful reload |
| **Monitoring**               | ❌ Complex routing logic        | ✅ Simple, per-transport       |
| **Testing**                  | ❌ Duplicate setup per team     | ✅ Single generic test         |
| **Scalability**              | ❌ One scale knob per transport | ✅ Scale workers independently |
| **Maintenance**              | ❌ Must know all teams          | ✅ Just know transports        |

---

## Recommended Next Steps

### 1. Create transport_endpoint_types Table

Define standardized endpoint configurations for each provider.

### 2. Extend team_device_providers

Add columns for provider-specific settings (credentials, routing rules, etc).

### 3. Implement Worker Pool Pattern

Move current adapter logic to dynamic worker pools.

### 4. Database-Driven Discovery

Workers discover and connect based on table entries.

### 5. Unified Ingest Channel

All transports feed to single ingest processor.

### 6. Graceful Reload

Implement configuration reload without stopping service.

---

## Summary

**Simplest Approach**:

- ✅ Database-driven configuration (team_device_providers)
- ✅ Worker pool per transport type (not per team)
- ✅ Multiple gRPC instances for isolation
- ✅ Single MQTT worker pool with provider-based routing
- ✅ Dynamic worker discovery and creation
- ✅ Unified ingest endpoint for all transports

**Key Benefits**:

- No transport-specific logic in main code
- Add new teams/providers without code changes
- Easy monitoring and scaling
- Graceful configuration reloads
- Fault isolation between transports

This is the **simplest, most maintainable** approach for a production system.
