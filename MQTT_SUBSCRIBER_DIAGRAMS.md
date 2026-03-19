# MQTT Subscriber Integration - Visual Diagrams

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ZC8 Transport Layer                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              TransportService (Main Orchestrator)               │   │
│  │  Manages: MQTT, gRPC, HTTP Server, HTTP Client workers          │   │
│  └─────────────────┬────────────────────────────────────────────────┘   │
│                    │                                                     │
│                    ├─► ┌────────────────────────────────────────────┐   │
│                    │   │     WorkerPool (MQTT)                      │   │
│                    │   │  Discovers team→provider→broker mappings   │   │
│                    │   │  30-second auto-refresh from DB            │   │
│                    │   └─────────────┬────────────────────────────┘   │
│                    │                 │                                 │
│                    │                 ├─► Worker 1 (GMS)               │
│                    │                 │   ├─ Team: GMS (ID: 1)         │
│                    │                 │   ├─ Provider: ChirpStack      │
│                    │                 │   ├─ Broker: ns2.maua.br      │
│                    │                 │   └─ MQTTAdapter               │
│                    │                 │                                 │
│                    │                 ├─► Worker 2 (MauaRacing)       │
│                    │                 │   ├─ Team: MauaRacing (ID: 2) │
│                    │                 │   ├─ Provider: ChirpStack      │
│                    │                 │   ├─ Broker: ns2.maua.br      │
│                    │                 │   └─ MQTTAdapter               │
│                    │                 │                                 │
│                    │                 └─► Worker 3 (Teams)             │
│                    │                     ├─ Team: Teams (ID: 3)       │
│                    │                     ├─ Provider: Direct MQTT      │
│                    │                     ├─ Broker: mqtt.maua.br      │
│                    │                     └─ MQTTAdapter               │
│                    │                                                     │
│                    ├─► WorkerPool (gRPC)                               │
│                    ├─► WorkerPool (HTTP Server)                        │
│                    └─► WorkerPool (HTTP Client)                        │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Message Router (Unified Channel)                    │   │
│  │  All transports (MQTT, gRPC, HTTP) send here                    │   │
│  └─────────────────┬────────────────────────────────────────────────┘   │
│                    │                                                     │
│  ┌─────────────────▼────────────────────────────────────────────────┐   │
│  │           IngestProcessor (Message Processing)                   │   │
│  │  - Store to ingest_messages table                               │   │
│  │  - Run InfluxDBProcessor → time-series database                │   │
│  │  - Run WebhookProcessor → team webhooks                        │   │
│  │  - Extensible with additional processors                        │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘

                             ↓ Storage & Notifications

                  ┌─────────────────────────────────┐
                  │   PostgreSQL Database           │
                  │ • ingest_messages              │
                  │ • device_registry               │
                  │ • team_device_providers        │
                  └─────────────────────────────────┘

                  ┌─────────────────────────────────┐
                  │   InfluxDB Time-Series          │
                  │ measurement="device_data"       │
                  │ tags {team, device}             │
                  │ fields {temp, humidity, ...}    │
                  └─────────────────────────────────┘

                  ┌─────────────────────────────────┐
                  │   Team Webhooks                 │
                  │ POST /webhooks/{team_id}        │
                  │ body: {device, data, timestamp} │
                  └─────────────────────────────────┘
```

---

## 2. Message Flow: ChirpStack → Device Registration → Team

```
                    ⏱️ TIME: 15:30:45 UTC

┌─────────────────────────────────────────────────────────────────────────┐
│ Step 1: Device Sends LoRaWAN Data                    [15:30:45.000]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Device: lora-gms-01 (EUI: 1616161616161616)                           │
│  Data:   {temperature: 22.5, humidity: 45}                             │
│  Network: LoRaWAN                                                       │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 2: ChirpStack Processes                         [15:30:45.100]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. Receive LoRaWAN frame                                              │
│  2. MAC layer validation                                               │
│  3. Decryption & authentication                                        │
│  4. Key derivation                                                      │
│  5. Publish to MQTT broker                                             │
│                                                                           │
│     Topic: applications/1001/devices/1616161616161616/up              │
│     Payload: {                                                          │
│       "applicationID": "1001",                                         │
│       "deviceName": "GMS-Sensor-01",                                  │
│       "deviceEUI": "1616161616161616",                                │
│       "data": "AQIEBgA=",  ← base64 encoded payload                   │
│       "rxInfo": [{...}],   ← signal strength, SNR, etc.               │
│       "txInfo": {...},     ← transmission info                        │
│       "adr": true,         ← adaptive data rate                       │
│       "dr": 5              ← data rate                                │
│     }                                                                   │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 3: MQTT Broker Receives                         [15:30:45.150]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  MQTT Broker (networkserver2.maua.br:1883)                            │
│  │                                                                       │
│  ├─► ZC8 Worker 1 (ChirpStack) ◄── SUBSCRIBED                          │
│  │   Topic: applications/+/devices/+/up                                │
│  │   Filter: applications/1001/devices/1616161616161616/up ✓           │
│  │                                                                       │
│  ├─► Other ChirpStack subscribers                                       │
│  ├─► Monitoring systems                                                 │
│  └─► Stream processors                                                  │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 4: MQTTAdapter.messageHandler() Called           [15:30:45.160]    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  4a. Extract DeviceKey from Topic                                      │
│      Topic: "applications/1001/devices/1616161616161616/up"            │
│      Split by "/": ["applications", "1001", "devices", "1616...", "up"]│
│      deviceKey = parts[3] = "1616161616161616"                         │
│                                                                           │
│  4b. Parse Payload                                                     │
│      JSON decode: {appID: 1001, deviceEUI: "1616...", data: "..."}    │
│                                                                           │
│  4c. Create Unified Message                                            │
│      → WorkerID: "worker_1_1"                                          │
│      → TransportType: "mqtt"                                           │
│      → TeamID: 1                                                        │
│      → TeamName: "GMS"                                                  │
│      → ProviderID: 1                                                    │
│      → ProviderName: "ChirpStack"                                      │
│      → DeviceKey: "1616161616161616"                                   │
│      → Payload: {appID: 1001, ...}                                     │
│      → ReceivedAt: 2026-03-12T15:30:45.160Z                           │
│                                                                           │
│  4d. Route to Unified Ingest                                           │
│      wp.RouteMessage(ingestMsg)  ← sent to ingestChan                 │
│                                                                           │
│  4e. Update Worker Metrics                                             │
│      worker.MessageCount++                                              │
│      worker.LastMessageAt = now                                        │
│                                                                           │
│  LOG: "[MQTT:worker_1_1] Message routed from ChirpStack               │
│        topic applications/1001/devices/1616161616161616/up             │
│        (device: 1616161616161616)"                                     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 5: IngestProcessor Receives                     [15:30:45.180]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  5a. Store to Audit Table                                              │
│      INSERT INTO ingest_messages (                                      │
│        worker_id, transport_type, team_id, device_key,                │
│        payload, metadata, latency_ms, received_at, processed_at       │
│      ) VALUES (                                                         │
│        'worker_1_1',                                                    │
│        'mqtt',                                                          │
│        1,                                                               │
│        '1616161616161616',                                             │
│        '{...}',                                                         │
│        '{"topic":"applications/1001/devices/1616..."}',               │
│        20,  ← milliseconds latency                                     │
│        '2026-03-12T15:30:45.160Z',                                    │
│        '2026-03-12T15:30:45.180Z'                                     │
│      )                                                                   │
│                                                                           │
│  5b. Run Registered Processors                                         │
│                                                                           │
│      ┌─ InfluxDBProcessor                                              │
│      │  ├─ Extract numeric fields                                      │
│      │  │  • temperature = 22.5                                        │
│      │  │  • humidity = 45.0                                           │
│      │  │                                                               │
│      │  ├─ Create point                                                │
│      │  │  • Measurement: "device_data"                                │
│      │  │  • Tags: {team="GMS", device="1616...", provider="CS"}      │
│      │  │  • Fields: {temp=22.5, humidity=45, rssi=-95, snr=8}       │
│      │  │  • Timestamp: 2026-03-12T15:30:45Z                         │
│      │  │                                                               │
│      │  └─ Write to InfluxDB ✓                                         │
│      │                                                                   │
│      └─ WebhookProcessor                                               │
│         ├─ Query webhooks for team 1                                   │
│         │  SELECT url FROM team_webhooks                              │
│         │  WHERE team_id = 1 AND is_active = true                     │
│         │                                                               │
│         ├─ Prepare payload                                             │
│         │  {                                                            │
│         │    "event": "device_message",                                │
│         │    "team_id": 1,                                             │
│         │    "team_name": "GMS",                                       │
│         │    "device_key": "1616...",                                  │
│         │    "provider": "ChirpStack",                                │
│         │    "data": {...},                                            │
│         │    "timestamp": "2026-03-12T15:30:45Z"                     │
│         │  }                                                            │
│         │                                                               │
│         └─ POST to https://gms-api.example.com/webhooks ✓            │
│                                                                           │
│  LOG: "[IngestProcessor] Message 12345 processed                       │
│        GMS/1616... → InfluxDB + Webhook"                               │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 6: Completion                                   [15:30:45.250]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ✓ Message received from device                      [+0ms]           │
│  ✓ Processed by ChirpStack                           [+100ms]         │
│  ✓ Received by MQTT worker                           [+150ms]         │
│  ✓ Parsed and routed                                 [+160ms]         │
│  ✓ Stored in audit table                             [+180ms]         │
│  ✓ Written to InfluxDB                               [+200ms]         │
│  ✓ Posted to webhook                                 [+250ms]         │
│                                                                           │
│  TOTAL E2E LATENCY: 250ms                                              │
│  GMS application notified immediately                                  │
│  Time-series data available for analytics                              │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Discovery Cycle

```
                    WORKER POOL (30-second cycle)

┌────────────────────────────────────────────────────────────────┐
│ DiscoverConfigurations() - Runs every 30 seconds              │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Query: SELECT * FROM team_device_providers_view               │
│        WHERE protocol_type = 'mqtt' AND is_active = true      │
│                                                                 │
│ Result Set:                                                    │
│ ┌────────────────────────────────────────────────────────┐    │
│ │ team_provider_id │ team_id │ team_name  │ provider_id  │    │
│ ├────────────────────────────────────────────────────────┤    │
│ │ 1                │ 1       │ GMS        │ 1            │    │
│ │ 2                │ 2       │ MauaRacing │ 1            │    │
│ │ 3                │ 3       │ Teams      │ 2            │    │
│ │ 4                │ 4       │ RaceTracks │ 2            │    │
│ │ 5                │ 5       │ Committee  │ 2            │    │
│ └────────────────────────────────────────────────────────┘    │
│                                                                 │
│ For each row:                                                  │
│ ├─→ Check if already running (currentWorkers)                 │
│ │   ├─ If running: skip                                       │
│ │   ├─ If stopped: remove from map                            │
│ │   └─ If new: add to newWorkers                              │
│ │                                                              │
│ ├─→ On Mismatch:                                              │
│ │   ├─ Stop removed workers ✓                                 │
│ │   ├─ Start new workers ✓                                    │
│ │   └─ Log changes                                            │
│ │                                                              │
│ └─→ Metrics Update                                            │
│     ├─ Workers running: 5                                     │
│     ├─ MQTT adapters active: 5                                │
│     └─ Last sync: 2026-03-12T15:30:45Z                       │
│                                                                 │
└────────────────────────────────────────────────────────────────┘

                    Worker State Management

┌─────────────────────────────────────────────────────────────────┐
│ Current Workers (Before)                                        │
├─────────────────────────────────────────────────────────────────┤
│ worker_1_1 (GMS, ChirpStack): RUNNING ✓                        │
│ worker_2_1 (MauaRacing, ChirpStack): RUNNING ✓                │
│ worker_3_2 (Teams, Direct MQTT): RUNNING ✓                    │
└─────────────────────────────────────────────────────────────────┘

                          Database Change:
                    Team 4 enabled, new endpoint

┌─────────────────────────────────────────────────────────────────┐
│ Current Workers (After Sync)                                    │
├─────────────────────────────────────────────────────────────────┤
│ worker_1_1 (GMS, ChirpStack): RUNNING ✓                        │
│ worker_2_1 (MauaRacing, ChirpStack): RUNNING ✓                │
│ worker_3_2 (Teams, Direct MQTT): RUNNING ✓                    │
│ worker_4_2 (RaceTracks, Direct MQTT): NEW ✓                   │
│ worker_5_2 (Committee, Direct MQTT): RUNNING ✓                │
└─────────────────────────────────────────────────────────────────┘

                    Message Broadcast

     Every worker receives from its configured topics

worker_1_1                worker_2_1                worker_3_2
(Broker ns2)              (Broker ns2)              (Broker mqtt.br)
│                         │                         │
├─ applications/+         ├─ applications/+         ├─ devices/+
│  /devices/+/up          │  /devices/+/up          │  /up
│                         │                         ├─ devices/+
├─ 1616161616161616 ✓     ├─ 2727272727272727 ✓     │  /telemetry
│  (GMS Sensor)           │  (Maua GPS)             │
│                         │                         ├─ mqtt-teams-01 ✓
└─ message routed         └─ message routed         └─ message routed
   to ingest               to ingest                  to ingest
```

---

## 4. Team Isolation & Multi-Tenancy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MQTT Broker (shared)                              │
│                  networkserver2.maua.br:1883                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Topic: applications/1001/devices/1616161616161616/up                  │
│          │                    │
│          │                    └─► Device (lora-gms-01)
│          └─► App 1001 (GMS)
│
│  Topic: applications/1002/devices/2727272727272727/up                  │
│          │                    │
│          │                    └─► Device (gps-maua-02)
│          └─► App 1002 (MauaRacing)
│
│  Topic: applications/1003/devices/3838383838383838/up                  │
│          │                    │
│          │                    └─► Device (gps-mobile-01)
│          └─► App 1003 (Teams)  [INACTIVE - subscription stopped]
│
└─────────────────────────────────────────────────────────────────────────┘

                    Topic Subscription Per Worker

┌──────────────────────────────────┐
│ Worker 1 (GMS Team)              │
├──────────────────────────────────┤
│ Subscribe:                       │
│  • applications/+/devices/+/up   │
│                                  │
│ Receive:                         │
│  ✓ applications/1001/devices/... │
│  ✗ applications/1002/devices/... │
│  ✗ applications/1003/devices/... │
│                                  │
│ Filter at message level:         │
│ if device.team_id != 1: DROP     │
│                                  │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ Worker 2 (MauaRacing Team)       │
├──────────────────────────────────┤
│ Subscribe:                       │
│  • applications/+/devices/+/up   │
│                                  │
│ Receive:                         │
│  ✗ applications/1001/devices/... │
│  ✓ applications/1002/devices/... │
│  ✗ applications/1003/devices/... │
│                                  │
│ Filter at message level:         │
│ if device.team_id != 2: DROP     │
│                                  │
└──────────────────────────────────┘

                    Isolation Layers

Layer 1: Topic Level
├─ ChirpStack publishes per application
├─ Each app is team-specific
└─ Natural isolation

Layer 2: Worker Level
├─ Worker tied to specific team_id
├─ Credentials per team
└─ Implicit isolation

Layer 3: Device Registry
├─ Lookup by device key + team_id
├─ SELECT ... WHERE device_id = ? AND team_id = ?
└─ Explicit validation

Layer 4: Ingest Processor
├─ Verify device.team_id matches message.team_id
├─ Log violations
└─ Audit trail for security
```

---

## 5. Connection Lifecycle

```
                    MQTT ADAPTER LIFECYCLE

                         ┌──────────────┐
                         │   CREATED    │
                         └──────┬───────┘
                                │
                    adapter.Start() called
                                │
                                ▼
                    ┌──────────────────────┐
                    │  CONNECTING          │
                    │ (30-second timeout)  │
                    └──────┬───────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
    ┌─────────▼────────────┐   ┌────────▼────────────┐
    │ Connection Success   │   │ Connection Failed   │
    │ onConnect() called    │   │ Log error & exit    │
    └─────────┬─────────────┘   └──────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │  CONNECTED          │
    │ Subscribe to topics │
    └────────┬────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │  SUBSCRIBED                │
    │ monitorConnection() loop   │
    │ (every 30 seconds)         │
    │ messageHandler() active    │
    └────────┬───────────────────┘
             │
    ┌────────┴────────┐
    │                 │
Connected OK      Connection Lost
    │                 │
    │          ┌──────▼──────────┐
    │          │ DISCONNECTED    │
    │          │ onConnectionLost│
    │          │ Auto-reconnect  │
    │          │ enabled         │
    │          └──────┬──────────┘
    │                 │
    └─────────────────┘
           │
           ▼
    ┌──────────────────┐
    │ Stop called      │
    │ adapter.Stop()   │
    └────────┬─────────┘
             │
    ┌────────▼─────────────┐
    │ STOPPING             │
    │ • Unsubscribe all    │
    │ • Disconnect broker  │
    │ • Stop monitoring    │
    │ • Mark inactive      │
    └─────────────────────┘
```

---

## 6. Error & Recovery Scenarios

```
┌─────────────────────────────────────────────────────────────────┐
│ Scenario 1: Message Parsing Error                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ messageHandler() receives invalid JSON
│ ↓
│ parsePayload() fails
│ ↓
│ Message still routed with raw_data fallback
│ {
│   "raw_data": "invalid bytes...",
│   "raw_bytes_length": 156,
│   "parsing_error": "JSON decode failed"
│ }
│ ↓
│ Stored in ingest_messages for manual inspection
│ ↓
│ Processor logs warning but continues
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Scenario 2: Device Not Found in Registry                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Message extracted EUI: 1616161616161616
│ ↓
│ Database query: SELECT * FROM device_registry
│                 WHERE eui = '1616161616161616'
│ ↓
│ Result: NOT FOUND (device not registered yet)
│ ↓
│ Action: Log warning, store message anyway
│          Processor will attempt lookup later
│          Message remains in ingest_messages
│ ↓
│ Resolution: Device registered in registry
│             Next message succeeds
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Scenario 3: Connection Lost                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Broker disconnects unexpectedly
│ ↓
│ onConnectionLost() callback triggered
│ ↓
│ worker.Active = false
│ ↓
│ Auto-reconnect enabled:
│   • Paho MQTT client reconnects automatically
│   • ExponentialBackoff: 1s, 2s, 4s, 8s, max 10s
│   • Maximum reconnect interval: 10 seconds
│ ↓
│ monitorConnection() detects: client.IsConnected() = false
│ ↓
│ Log message: "Connection lost, waiting for auto-reconnect..."
│ ↓
│ Connection re-established
│ ↓
│ onConnect() called again
│ ↓
│ Resubscribe to topics
│ ↓
│ worker.Active = true
│ ↓
│ Resume message processing
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Scenario 4: Configuration Change (DB Updated)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Database change: Team 4 (RaceTracks) added to team_device...
│ ↓
│ [30s cycle] DiscoverConfigurations() executes
│ ↓
│ Query returns: worker_4_2 (RaceTracks, Direct MQTT)
│ ↓
│ Not in currentWorkers map → NEW
│ ↓
│ Create new Worker + MQTTAdapter
│ ↓
│ adapter.Start()
│ └─ Connect to mqtt.maua.br:1883
│ └─ Subscribe to devices/+/telemetry, devices/+/up
│ ├─ worker_4_2 status: RUNNING
│
│ Parallel:
│ Event: Team 3 disabled (is_active = false)
│ ↓
│ worker_3_2 NO LONGER in query result
│ ↓
│ worker_3_2 in currentWorkers but not in query
│ ↓
│ Remove from current
│ ↓
│ Stop worker_3_2
│ └─ Unsubscribe from topics
│ └─ Disconnect
│ └─ worker_3_2 status: STOPPED
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Configuration State Machine

```
Database State Changes:

INITIAL:
┌─────────────────────────────┐
│ team_device_providers:      │
│ • team_id=1, provider_id=1  │
│   is_active=true, is_primary│
│ • team_id=2, provider_id=1  │
│   is_active=true, is_primary│
│ • team_id=3, provider_id=2  │
│   is_active=true, is_primary│
└─────────────────────────────┘

Workers: [1_1, 2_1, 3_2] running

─────────────────────────────────────────

CHANGE 1: Add new team provider
UPDATE team_device_providers
SET is_active = true
WHERE team_id = 4 AND provider_id = 2

┌─────────────────────────────┐
│ team_device_providers:      │
│ • team_id=1, provider_id=1  │
│   is_active=true            │
│ • team_id=2, provider_id=1  │
│   is_active=true            │
│ • team_id=3, provider_id=2  │
│   is_active=true            │
│ • team_id=4, provider_id=2  │ ← NEW
│   is_active=true            │
└─────────────────────────────┘

[30s cycle] Sync runs:
Workers: [1_1, 2_1, 3_2, 4_2] running

─────────────────────────────────────────

CHANGE 2: Disable a team
UPDATE team_device_providers
SET is_active = false
WHERE team_id = 3 AND provider_id = 2

┌─────────────────────────────┐
│ team_device_providers:      │
│ • team_id=1, provider_id=1  │
│   is_active=true            │
│ • team_id=2, provider_id=1  │
│   is_active=true            │
│ • team_id=3, provider_id=2  │
│   is_active=false           │ ← DISABLED
│ • team_id=4, provider_id=2  │
│   is_active=true            │
└─────────────────────────────┘

[30s cycle] Sync runs:
Workers: [1_1, 2_1, 4_2] running
(3_2 stopped and cleaned up)

─────────────────────────────────────────

CHANGE 3: Switch provider for team
UPDATE team_device_providers
SET is_primary = false
WHERE team_id = 1 AND provider_id = 1;

INSERT INTO team_device_providers
VALUES (team_id=1, provider_id=2, is_primary=true);

┌─────────────────────────────┐
│ team_device_providers:      │
│ • team_id=1, provider_id=1  │
│   is_active=true, primary=F │
│ • team_id=1, provider_id=2  │
│   is_active=true, primary=T │ ← NEW PRIMARY
│ • team_id=2, provider_id=1  │
│   is_active=true            │
│ • team_id=4, provider_id=2  │
│   is_active=true            │
└─────────────────────────────┘

[30s cycle] Sync runs:
- Stop worker_1_1 (old ChirpStack)
- Start worker_1_2 (new Direct MQTT)
Workers: [1_2, 2_1, 4_2] running
```

---

This completes the MQTT subscriber integration documentation with all visual diagrams showing architecture, data flow, database cycles, team isolation, connection lifecycle, error scenarios, and configuration state management.
