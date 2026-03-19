# Device Registry Integration - Tables & Control Plane Data Flow

## Schema Diagram

```sql
┌─────────────────────────────────────────────────────────────┐
│                  device_registry (MASTER)                   │
├─────────────────────────────────────────────────────────────┤
│ id (PK)              │ tenant_id (FK)      │ device_type_id  │
│ device_key           │ status              │ vendor_id       │
│ deveui               │ model               │ parser_id       │
│ uuidv7               │ origin              │ created_at      │
│ api_key_hash         │ jwt_secret_hash     │ updated_at      │
│ metadata (JSONB)     │ device_version      │                 │
└─────────────────────────────────────────────────────────────┘
              ↓ FK (device_id)
              │ (Multi-type device)
              ├──────────────────┬────────────────┬───────────────┐
              │                  │                │               │
      ┌───────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │ device_lns    │  │ device_zc2x  │  │ device_mqtt  │  │ device_http  │
      │ (LoRaWAN)     │  │ (ESP32 gRPC) │  │ (MQTT)       │  │ (Webhook)    │
      ├───────────────┤  ├──────────────┤  ├──────────────┤  ├──────────────┤
      │ deveui        │  │ mac_address  │  │ broker_url   │  │ endpoint_url │
      │ activation    │  │ grpc_server  │  │ topic_sub    │  │ http_method  │
      │ appkey        │  │ heartbeat    │  │ topic_pub    │  │ auth_type    │
      │ nwkskey       │  │ signal       │  │ qos          │  │ rate_limit   │
      │ appskey       │  │ metrics      │  │ is_primary   │  │ ip_whitelist │
      │ network_srv   │  │ (JSONB)      │  │ failover_id  │  │ (JSONB)      │
      │ app_id        │  │              │  │ (FK self)    │  │              │
      │ class         │  │              │  │              │  │              │
      │ adr_enabled   │  │              │  │              │  │              │
      │ sync_status   │  │              │  │              │  │              │
      └───────────────┘  └──────────────┘  └──────────────┘  └──────────────┘

              ↓ (Multi-to-Multi bridge)
      ┌──────────────────────────────────┐
      │    device_integrations (BRIDGE)  │
      ├──────────────────────────────────┤
      │ device_id (FK)    │ integration_id│
      │ integration_type  │ is_primary    │
      │ priority          │ status        │
      └──────────────────────────────────┘
               ↓ (data updated)
      ┌──────────────────────────────────┐
      │    Redis Cache (real-time)       │
      ├──────────────────────────────────┤
      │ device:{id}:config               │
      │ device:{id}:last_update          │
      │ device:{id}:credentials          │
      └──────────────────────────────────┘
```

---

## Control Plane → Data Plane: Data Flow

### Flow 1: Device Registration (Control Plane Creates)

```
CONTROL PLANE
┌─────────────────────────────────────────────┐
│ Admin/Dashboard                             │
│ POST /api/tenants/1/devices/lns             │
│ {                                           │
│   "device_id": "sensor-001",                │
│   "device_key": "sk_prod_...",              │
│   "deveui": "0011223344556677",             │
│   "activation_mode": "OTAA",                │
│   "appkey": "...32 hex chars...",           │
│   "network_server_id": 1,                   │
│   "application_id": 42                      │
│ }                                           │
└─────────────────────────────────────────────┘
           ↓ (Request reaches Elysia backend)
┌────────────────────────────────────────────────────────────┐
│ STEP 1: Insert Master Record (device_registry)            │
│                                                             │
│ INSERT INTO device_registry (                              │
│   tenant_id, device_key, deveui, device_type_id,          │
│   vendor_id, model, parser_id, origin, status             │
│ ) VALUES (                                                 │
│   1, 'sk_prod_...', '0011223344556677', 1001,            │
│   1, 'LoRaWAN Device', 101, 'lorawan_chirpstack',        │
│   'active'                                                 │
│ ) RETURNING id = 1001;                                    │
│                                                             │
│ ✓ Master device record created                           │
│ ✓ tenant_id ensures multi-tenant isolation               │
│ ✓ device_type_id = 1001 (LORAWAN_CHIRPSTACK)            │
│ ✓ status = 'active' (can send telemetry)                 │
└────────────────────────────────────────────────────────────┘
           ↓ (With device_registry_id = 1001)
┌────────────────────────────────────────────────────────────┐
│ STEP 2: Insert Type-Specific Record (device_lns)          │
│                                                             │
│ INSERT INTO device_lns (                                  │
│   device_id,           -- FK to device_registry           │
│   tenant_id,                                              │
│   deveui,                                                 │
│   activation_mode,                                        │
│   appkey,                                                 │
│   network_server_id,                                      │
│   application_id,                                         │
│   sync_status                                             │
│ ) VALUES (                                                │
│   1001,                                                   │
│   1,                                                      │
│   '0011223344556677',                                     │
│   'OTAA',                                                 │
│   '112233445566778899aabbccddeeff00',                     │
│   1,                                                      │
│   42,                                                     │
│   'pending'                                               │
│ );                                                        │
│                                                             │
│ ✓ LoRaWAN-specific config stored                          │
│ ✓ sync_status = 'pending' (not yet synced to NS)         │
│ ✓ FK device_id = 1001 links to master                     │
└────────────────────────────────────────────────────────────┘
           ↓ (Config is now in Database)
┌────────────────────────────────────────────────────────────┐
│ STEP 3: Update Redis Cache (for fast access)              │
│                                                             │
│ redis.SET(                                                │
│   "device:sensor-001:config",                             │
│   {                                                       │
│     "device_id": "sensor-001",                            │
│     "deveui": "0011223344556677",                         │
│     "activation_mode": "OTAA",                            │
│     "network_server_id": 1,                               │
│     "application_id": 42,                                 │
│     "class": "A"                                          │
│   },                                                      │
│   { EX: 86400 }  -- Expire in 1 day                      │
│ );                                                        │
│                                                             │
│ ✓ Fast lookups for ingest service                        │
│ ✓ Device config available immediately                    │
└────────────────────────────────────────────────────────────┘
           ↓ (Control Plane completes)
┌────────────────────────────────────────────────────────────┐
│ STEP 4: Return JWT Token + Config                         │
│                                                             │
│ Response: {                                               │
│   "success": true,                                        │
│   "device": {                                             │
│     "id": 1001,                                          │
│     "deveui": "0011223344556677",                         │
│     "activation_mode": "OTAA",                            │
│     "status": "active"                                    │
│   },                                                      │
│   "jwt": {                                               │
│     "token": "eyJhbGc...",  ← Device uses to auth        │
│     "expires_in_hours": 24                               │
│   }                                                       │
│ }                                                         │
│                                                             │
│ Admin/Dashboard:                                          │
│ ✓ Display JWT to user                                    │
│ ✓ User provisions device with JWT                        │
│ ✓ Device now authenticated                               │
└────────────────────────────────────────────────────────────┘
```

---

### Flow 2: Device Updates (Control Plane Modifies)

```
CONTROL PLANE → UPDATE
┌─────────────────────────────────────────────┐
│ Dashboard: Switch from OTAA to ABP          │
│ PUT /api/tenants/1/devices/lns/1001         │
│ {                                           │
│   "activation_mode": "ABP",                 │
│   "nwkskey": "abc...",                      │
│   "appskey": "def...",                      │
│   "appkey": null,   ← Remove OTAA key      │
│   "sync_status": "pending"                  │
│ }                                           │
└─────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 1: Update Type-Specific Table (device_lns)           │
│                                                             │
│ UPDATE device_lns                                          │
│ SET activation_mode = 'ABP',                              │
│     nwkskey = 'abc...',                                   │
│     appskey = 'def...',                                   │
│     appkey = NULL,       -- Clear OTAA key               │
│     sync_status = 'pending',                              │
│     updated_at = NOW()                                    │
│ WHERE device_id = 1001 AND tenant_id = 1;                │
│                                                             │
│ ✓ New keys stored                                         │
│ ✓ sync_status = 'pending' (needs sync)                   │
│ ✓ Master record untouched                                │
└────────────────────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 2: Invalidate Redis Cache                            │
│                                                             │
│ redis.DEL("device:sensor-001:config");                    │
│                                                             │
│ ✓ Next access will re-fetch from DB                      │
│ ✓ Fresh config with ABP keys                             │
└────────────────────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 3: Notify Dashboard                                   │
│                                                             │
│ Broadcast via WebSocket:                                  │
│ {                                                         │
│   "type": "device_updated",                               │
│   "device_id": 1001,                                      │
│   "changes": {                                            │
│     "activation_mode": "OTAA→ABP",                        │
│     "sync_status": "pending"                              │
│   },                                                      │
│   "timestamp": "2026-02-23T15:00:00Z"                    │
│ }                                                         │
│                                                             │
│ ✓ Admin notified of change                               │
│ ✓ Dashboard updates in real-time                         │
└────────────────────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 4: Device sees sync_status = 'pending'               │
│                                                             │
│ Device polls /api/device/:id/config (on heartbeat):       │
│                                                             │
│ GET /api/devices/1001/config                              │
│ Authorization: Bearer $JWT                                │
│                                                             │
│ Response: {                                               │
│   "activation_mode": "ABP",                               │
│   "nwkskey": "abc...",                                   │
│   "appskey": "def...",                                   │
│   "sync_status": "pending"  ← Signal to sync             │
│ }                                                         │
│                                                             │
│ ✓ Device receives new config                             │
│ ✓ Device re-initializes with ABP keys                    │
│ ✓ Device reconnects to network server                    │
│ ✓ Device ACKs with sync_status: 'synced'                 │
└────────────────────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 5: Control Plane marks as Synced                     │
│                                                             │
│ Device sends: PUT /api/devices/1001/sync-status           │
│ { "sync_status": "synced" }                               │
│                                                             │
│ Backend updates:                                          │
│ UPDATE device_lns                                         │
│ SET sync_status = 'synced'                                │
│ WHERE device_id = 1001;                                   │
│                                                             │
│ Control Plane now shows:                                  │
│ ✓ Device: ABP mode, synced ✓                             │
│ ✓ Ready for telemetry with new keys                      │
└────────────────────────────────────────────────────────────┘
```

---

### Flow 3: Device Deactivation (Control Plane Disables)

```
CONTROL PLANE → DELETE/DEACTIVATE
┌─────────────────────────────────────────────┐
│ Dashboard: Deactivate device                │
│ DELETE /api/tenants/1/devices/1001          │
│ OR                                          │
│ PUT /api/tenants/1/devices/1001             │
│ { "status": "inactive" }                    │
└─────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 1: Update Master Record (device_registry)            │
│                                                             │
│ UPDATE device_registry                                    │
│ SET status = 'inactive', updated_at = NOW()               │
│ WHERE id = 1001;                                          │
│                                                             │
│ ✓ Device marked inactive                                  │
│ ✓ device_lns config NOT deleted (audit trail)            │
│ ✓ Master record changed                                  │
└────────────────────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 2: Ingest Service Reaction                           │
│                                                             │
│ When device sends telemetry with JWT:                     │
│                                                             │
│ POST /api/ingest/data                                     │
│ Authorization: Bearer $JWT                                │
│                                                             │
│ ✓ Ingest validates JWT                                   │
│ ✓ Queries device_registry: status='inactive'             │
│ ✓ REJECTS request: 403 Device Inactive                   │
│ ✓ Updates Redis: device:sensor-001:error                 │
│                                                             │
│ Response: {                                               │
│   "success": false,                                       │
│   "error": "Device inactive",                             │
│   "retry_after_seconds": 86400  -- 1 day                 │
│ }                                                         │
│                                                             │
│ ✓ Device backs off from sending                          │
│ ✓ Logs error for admin review                            │
└────────────────────────────────────────────────────────────┘
           ↓
┌────────────────────────────────────────────────────────────┐
│ STEP 3: Cache Invalidation                                │
│                                                             │
│ redis.DEL("device:sensor-001:*");                         │
│                                                             │
│ Clears:                                                   │
│ • device:sensor-001:config                               │
│ • device:sensor-001:credentials                          │
│ • device:sensor-001:last_update                          │
│                                                             │
│ ✓ No stale data in Redis                                 │
└────────────────────────────────────────────────────────────┘
```

---

## SQL Queries: How Control Plane Affects Data Plane

### Query 1: Get Device Config (Ingest Service uses this)

```sql
-- When device connects with JWT
SELECT
  dr.id,
  dr.device_key,
  dr.status,
  dl.deveui,
  dl.activation_mode,
  dl.appkey,
  dl.nwkskey,
  dl.appskey,
  dl.network_server_id,
  dl.application_id,
  dl.sync_status,
  dl.class,
  dl.adr_enabled
FROM device_registry dr
JOIN device_lns dl ON dr.id = dl.device_id
WHERE dr.id = 1001 AND dr.tenant_id = 1 AND dr.status = 'active';

-- If status = 'inactive', query returns 0 rows
-- → Ingest service rejects telemetry
```

### Query 2: List All Device Configs (Dashboard displays)

```sql
-- Multi-tenant filtered query
SELECT
  dr.id,
  dr.device_key,
  dr.status,
  dr.created_at,
  dl.deveui,
  dl.activation_mode,
  dl.network_server_id,
  dl.application_id,
  dl.sync_status
FROM device_registry dr
LEFT JOIN device_lns dl ON dr.id = dl.device_id
WHERE dr.tenant_id = 1  -- Only org's devices
  AND dr.device_type_id = 1001  -- Only LoRaWAN
ORDER BY dr.created_at DESC
LIMIT 50;
```

### Query 3: Find Synced vs Pending Devices

```sql
-- Which devices need sync to network server?
SELECT
  dr.device_key,
  dl.deveui,
  dl.sync_status,
  dl.updated_at
FROM device_registry dr
JOIN device_lns dl ON dr.id = dl.device_id
WHERE dr.tenant_id = 1
  AND dl.sync_status = 'pending'
ORDER BY dl.updated_at ASC;

-- Response: Devices that need immediate attention
```

### Query 4: Multi-Instance Device Lookup

```sql
-- LoRaWAN device on multiple network servers
SELECT
  dl.id,
  dl.network_server_id,
  dl.application_id,
  dl.sync_status,
  di.is_primary,
  di.priority
FROM device_lns dl
LEFT JOIN device_integrations di ON dl.device_id = di.device_id
WHERE dl.tenant_id = 1 AND dl.deveui = '0011223344556677'
ORDER BY di.priority ASC;

-- Result: Device can failover between network servers
```

---

## Integration Summary

| Component   | Control Plane                             | Data Plane                          |
| ----------- | ----------------------------------------- | ----------------------------------- |
| **Source**  | Admin/Dashboard                           | Devices + Ingest Service            |
| **Write**   | Control Plane creates/updates config → DB | Devices read config from DB/Redis   |
| **Trigger** | User action or API call                   | Device heartbeat or webhook trigger |
| **Storage** | PostgreSQL (persistent)                   | Redis (cache)                       |
| **TTL**     | Permanent until deleted                   | 24 hours (or configurable)          |
| **Status**  | active/inactive/error                     | heartbeat, sync_status              |
| **Auth**    | Member JWT + role RBAC                    | Device JWT + API key                |

---

## Vendor Integration Example

```sql
-- Control Plane defines vendor
INSERT INTO vendor_registry (
  vendor_id, name, endpoint, api_key, parser_id
) VALUES (
  1, 'ChirpStack v4', 'https://chirpstack.example.com',
  'api_key_...', 101
);

-- Device assigns vendor
INSERT INTO device_registry (
  tenant_id, device_key, vendor_id, parser_id, ...
) VALUES (1, 'key123', 1, 101, ...);

-- Ingest Service uses vendor to parse telemetry
SELECT parser_func FROM vendor_registry WHERE id = 1;
-- Load parser 101 → parse raw bytes → structured data
```

This shows how **control plane changes propagate through tables to influence data plane behavior**! 🎯
