# Transport Routing Implementation Guide

## Overview

This guide explains how to use the new routing tables to handle messages from different devices and transport types.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│  Message Sources                                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Device Type: gRPC         │  Device Type: LoRaWAN              │
│  ├─ Zc2x                   │  ├─ Milesight                      │
│  └─ Agent                  │  ├─ Kron                           │
│                            │  └─ Khomp                          │
│                                                                  │
│  ┌──────────────────────┐  │  ┌──────────────────────┐          │
│  │  Direct Routing      │  │  │  LNS Indirect Route  │          │
│  ├──────────────────────┤  │  ├──────────────────────┤          │
│  │                      │  │  │                      │          │
│  │  Device ──────►      │  │  │  Device ──► LNS ──► │          │
│  │    gRPC-Server       │  │  │   ChirpStack         │          │
│  │                      │  │  │   Everynet           │          │
│  └──────────────────────┘  │  └──────────────────────┘          │
│                                                                  │
│                            │                                     │
│                            ▼                                     │
│                     ┌──────────────────┐                        │
│                     │ Transport Layer  │                        │
│                     ├──────────────────┤                        │
│                     │ gRPC-Server      │                        │
│                     │ MQTT-Subscriber  │                        │
│                     │ HTTP-Server      │                        │
│                     └──────────────────┘                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Table Relationships

```
device_types
    ├─ device_type_routing_rules (defines: direct vs LNS)
    │   └─ supported_lns_vendors pointer
    │
device_registry (individual devices)
    ├─ device_lns_assignments (if LoRaWAN: which LNS? which DevEUI?)
    │   └─ org_lns_providers
    │       ├─ lns_vendor_id (ChirpStack, Everynet)
    │       └─ transport_endpoint_id (where ChirpStack publishes to)
    │
    └─ device_message_routes (runtime: where do messages arrive?)
        └─ source_transport_endpoint_id (grpc:50051, mqtt:1883, etc)

transport_endpoints (per org, per transport type)
    ├─ org_id
    ├─ transport_type (grpc-server, mqtt-subscriber, http-server)
    └─ address, port, config

lns_provider_transport_bindings (static: ChirpStack ↔ MQTT)
    └─ Maps LNS vendor to its transport type (global config)
```

## Step-by-Step Implementation

### Step 1: Define Transport Endpoints (Per Organization)

Create the actual endpoints where messages will arrive.

```sql
-- Create gRPC-Server endpoint for IMT org
INSERT INTO transport_endpoints (
    org_id,
    transport_type,
    connection_name,
    address,
    port,
    grpc_service_name
) VALUES (
    2,  -- IMT org
    'grpc-server',
    'Primary Device Ingress',
    'grpc.imt.prod.svc.cluster.local',
    50051,
    'zc8.transport.DeviceIngress'
);

-- Create MQTT-Subscriber endpoint for ChirpStack
INSERT INTO transport_endpoints (
    org_id,
    transport_type,
    connection_name,
    address,
    port,
    mqtt_topic_pattern,
    mqtt_qos
) VALUES (
    2,  -- IMT org
    'mqtt-subscriber',
    'ChirpStack MQTT Bridge',
    'mosquitto.imt.svc.cluster.local',
    1883,
    'chirpstack/+/device/+/rx',
    1
);

-- Create HTTP-Server endpoint for Everynet
INSERT INTO transport_endpoints (
    org_id,
    transport_type,
    connection_name,
    address,
    port,
    http_path,
    http_auth_type,
    http_timeout_sec
) VALUES (
    2,  -- IMT org
    'http-server',
    'Everynet Webhook Receiver',
    'webhook.imt.prod.svc.cluster.local',
    8080,
    '/api/webhooks/lns-uplink',
    'api-key',
    30
);
```

### Step 2: Register LNS Providers (Per Organization)

Configure which LNS servers the organization uses and bind them to transport endpoints.

```sql
-- Configure ChirpStack for IMT org
INSERT INTO org_lns_providers (
    org_id,
    lns_vendor_id,
    provider_name,
    api_endpoint,
    api_port,
    api_key,
    transport_endpoint_id,  -- Points to MQTT-Subscriber endpoint
    is_active,
    is_primary
) SELECT
    o.id,
    v.id,
    'ChirpStack Production',
    'chirpstack.imt.prod.svc.cluster.local',
    8080,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',  -- API token
    te.id,  -- MQTT endpoint
    true,
    true
FROM organizations o
JOIN vendor_registry v ON v.code = 'chirpstack'
JOIN (
    SELECT id FROM transport_endpoints
    WHERE org_id = 2 AND transport_type = 'mqtt-subscriber'
) te ON true
WHERE o.slug = 'imt';

-- Configure Everynet as fallback/secondary LNS for IMT org
INSERT INTO org_lns_providers (
    org_id,
    lns_vendor_id,
    provider_name,
    api_endpoint,
    api_port,
    api_key,
    transport_endpoint_id,  -- Points to HTTP-Server endpoint
    is_active,
    is_primary
) SELECT
    o.id,
    v.id,
    'Everynet EU',
    'api.eu.everynet.com',
    443,
    'ev_secretkey_XXXXXXX',
    te.id,  -- HTTP endpoint
    true,
    false
FROM organizations o
JOIN vendor_registry v ON v.code = 'everynet'
JOIN (
    SELECT id FROM transport_endpoints
    WHERE org_id = 2 AND transport_type = 'http-server'
) te ON true
WHERE o.slug = 'imt';
```

### Step 3: Assign LoRaWAN Devices to LNS Providers

For each LoRaWAN device, register it with LNS providers.

```sql
-- Assign Milesight EM500 device to ChirpStack (primary)
INSERT INTO device_lns_assignments (
    device_id,
    org_lns_provider_id,
    lns_device_id,      -- The DevEUI or registration ID in ChirpStack
    lns_device_secret,  -- AppKey or other credentials
    priority,
    is_active,
    is_verified
) SELECT
    dr.device_id,
    olp.id,
    '702081031230C000',          -- Milesight DevEUI (from device label)
    'APPKEY0000000000000000000001', -- Application key
    1,  -- Primary
    true,
    true
FROM device_registry dr
JOIN org_lns_providers olp ON olp.org_id = dr.organization_id
WHERE dr.device_id = 'milesight-em500-001'
  AND dr.organization_id = 2
  AND olp.is_primary = true
  AND olp.lns_vendor_id = (SELECT id FROM vendor_registry WHERE code = 'chirpstack');

-- Assign same device to Everynet (secondary/failover)
INSERT INTO device_lns_assignments (
    device_id,
    org_lns_provider_id,
    lns_device_id,
    lns_device_secret,
    priority,
    is_active,
    is_verified
) SELECT
    dr.device_id,
    olp.id,
    '702081031230C000',
    'APPKEY0000000000000000000001',
    2,  -- Secondary (backup)
    true,
    false
FROM device_registry dr
JOIN org_lns_providers olp ON olp.org_id = dr.organization_id
WHERE dr.device_id = 'milesight-em500-001'
  AND dr.organization_id = 2
  AND olp.is_primary = false
  AND olp.lns_vendor_id = (SELECT id FROM vendor_registry WHERE code = 'everynet');
```

### Step 4: Compute Device Message Routes

For each device, determine where its messages will physically arrive.

```sql
-- For direct-routing devices (gRPC):
-- Device message → gRPC-Server transport endpoint
INSERT INTO device_message_routes (
    device_id,
    org_id,
    source_transport_endpoint_id,
    lns_assignment_id,
    route_type,
    is_active,
    is_verified
)
SELECT
    dr.device_id,
    dr.organization_id,
    te.id,  -- The gRPC-Server endpoint
    NULL,   -- No LNS intermediary
    'direct',
    true,
    true
FROM device_registry dr
JOIN transport_endpoints te ON te.org_id = dr.organization_id AND te.transport_type = 'grpc-server'
JOIN device_types dt ON dt.id = (
    SELECT device_type_id FROM vendor_models_mapping
    WHERE model_name = dr.device_model LIMIT 1
)
WHERE dr.device_name LIKE 'zc2x-%'  -- Zc2x devices
  AND dr.is_active = true;

-- For LNS-routing devices (LoRaWAN):
-- Device message → LNS Provider → Transport endpoint
INSERT INTO device_message_routes (
    device_id,
    org_id,
    source_transport_endpoint_id,
    lns_assignment_id,
    route_type,
    is_active,
    is_verified
)
SELECT
    dr.device_id,
    dr.organization_id,
    olp.transport_endpoint_id,  -- The MQTT or HTTP endpoint where LNS publishes
    dla.id,  -- Reference to which LNS provider
    'indirect_lns',
    true,
    true
FROM device_registry dr
JOIN device_lns_assignments dla ON dla.device_id = dr.device_id
JOIN org_lns_providers olp ON olp.id = dla.org_lns_provider_id
WHERE dla.priority = 1  -- Only primary route
  AND dla.is_active = true
  AND dr.is_active = true;
```

## Querying Routing Information

### Query 1: Get all active routes for an organization

```sql
SELECT
    dr.device_id,
    dev.device_name,
    dev.vendor_name,
    dtr.routing_pattern,
    te.transport_type,
    te.address || ':' || te.port as endpoint,
    COALESCE(olp.provider_name, 'Direct') as route_via,
    dr.is_verified
FROM device_message_routes dr
JOIN device_registry dev ON dr.device_id = dev.device_id
JOIN transport_endpoints te ON dr.source_transport_endpoint_id = te.id
JOIN device_type_routing_rules dtr ON dtr.device_type_id = (
    SELECT device_type_id FROM vendor_models_mapping
    WHERE model_name = dev.device_model LIMIT 1
)
LEFT JOIN device_lns_assignments dla ON dr.lns_assignment_id = dla.id
LEFT JOIN org_lns_providers olp ON dla.org_lns_provider_id = olp.id
WHERE dr.org_id = 2
  AND dr.is_active = true
ORDER BY dev.device_name;
```

### Query 2: Get LNS provider connection info

```sql
SELECT
    olp.provider_name,
    vr.name as lns_vendor,
    te.transport_type,
    te.address || ':' || te.port as transport_endpoint,
    te.mqtt_topic_pattern,
    te.http_path,
    olp.is_primary,
    olp.healthcheck_status
FROM org_lns_providers olp
JOIN vendor_registry vr ON olp.lns_vendor_id = vr.id
JOIN transport_endpoints te ON olp.transport_endpoint_id = te.id
WHERE olp.org_id = 2
  AND olp.is_active = true
ORDER BY olp.is_primary DESC, olp.provider_name;
```

### Query 3: Find devices without routes (unroutable devices)

```sql
SELECT
    dr.device_id,
    dr.device_name,
    dr.vendor_name,
    dtr.routing_pattern,
    COUNT(dla.id) as assigned_lns_count
FROM device_registry dr
LEFT JOIN device_message_routes dmr ON dr.device_id = dmr.device_id
LEFT JOIN device_type_routing_rules dtr ON dtr.vendor_id = (
    SELECT id FROM vendor_registry WHERE name = dr.vendor_name
)
LEFT JOIN device_lns_assignments dla ON dr.device_id = dla.device_id
WHERE dr.organization_id = 2
  AND dr.is_active = true
  AND dmr.id IS NULL
GROUP BY dr.device_id, dr.device_name, dr.vendor_name, dtr.routing_pattern;
```

### Query 4: Get device statistics per transport

```sql
SELECT
    te.transport_type,
    te.connection_name,
    COUNT(DISTINCT dmr.device_id) as device_count,
    SUM(dmr.messages_received) as total_messages,
    AVG(dmr.avg_latency_ms) as avg_latency_ms,
    MAX(dmr.last_message_at) as last_activity
FROM transport_endpoints te
LEFT JOIN device_message_routes dmr ON te.id = dmr.source_transport_endpoint_id
  AND dmr.is_active = true
WHERE te.org_id = 2
GROUP BY te.id, te.transport_type, te.connection_name
ORDER BY device_count DESC;
```

## Application Integration Points

### For gRPC Device Ingestion

When a gRPC device connects:

```sql
-- 1. Find the device
SELECT dr.* FROM device_registry dr WHERE dr.device_key = ? AND dr.is_active = true;

-- 2. Get its message route
SELECT dmr.*, te.grpc_service_name
FROM device_message_routes dmr
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dmr.device_id = ? AND dmr.is_active = true;

-- 3. Update metrics
UPDATE device_message_routes
SET messages_received = messages_received + 1,
    last_message_at = NOW(),
    avg_latency_ms = (avg_latency_ms + ?) / 2
WHERE device_id = ?;
```

### For LNS Message Ingestion (ChirpStack via MQTT)

When ChirpStack publishes to MQTT:

```sql
-- 1. Parse MQTT topic: chirpstack/+/device/+/rx → extract deviceID
-- topic: "chirpstack/prod/device/702081031230C000/rx"

-- 2. Find device by LNS ID
SELECT dr.*, dla.device_id
FROM device_lns_assignments dla
JOIN org_lns_providers olp ON dla.org_lns_provider_id = olp.id
JOIN device_registry dr ON dla.device_id = dr.device_id
WHERE dla.lns_device_id = '702081031230C000'
  AND olp.is_primary = true
  AND dla.is_active = true;

-- 3. Process messages, update route metrics
UPDATE device_message_routes
SET messages_received = messages_received + 1,
    last_message_at = NOW()
WHERE device_id = ?;
```

### For LNS Message Ingestion (Everynet via HTTP)

When Everynet sends webhook:

```sql
-- 1. Extract LNS device ID from HTTP payload
lns_device_id = request.body.meta.device_id;  // "702081031230C000"

-- 2. Find affected devices
SELECT dr.*, dla.device_id
FROM device_lns_assignments dla
JOIN org_lns_providers olp ON dla.org_lns_provider_id = olp.id
JOIN device_registry dr ON dla.device_id = dr.device_id
WHERE dla.lns_device_id = ?
  AND olp.lns_vendor_id = (SELECT id FROM vendor_registry WHERE code = 'everynet');

-- 3. Use primary route, or failover to secondary
```

## Monitoring & Troubleshooting

### Health Check for LNS Providers

```sql
UPDATE org_lns_providers
SET healthcheck_status =
    CASE
        WHEN last_healthcheck_at < NOW() - INTERVAL '5 minutes' THEN 'stale'
        WHEN (SELECT COUNT(*) FROM device_lns_assignments
              WHERE org_lns_provider_id = org_lns_providers.id
              AND is_verified = false) > 10 THEN 'degraded'
        ELSE 'healthy'
    END,
    last_healthcheck_at = NOW()
WHERE org_id = 2
  AND is_active = true;
```

### Find devices not receiving messages

```sql
SELECT
    dr.device_id,
    dr.device_name,
    dmr.last_message_at,
    (NOW() - dmr.last_message_at) as silent_duration,
    te.transport_type,
    te.address
FROM device_message_routes dmr
JOIN device_registry dr ON dmr.device_id = dr.device_id
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dmr.org_id = 2
  AND dmr.is_active = true
  AND dmr.last_message_at < NOW() - INTERVAL '1 hour'
ORDER BY dmr.last_message_at;
```

## Summary

| Concept                   | Table                             | Purpose                                                |
| ------------------------- | --------------------------------- | ------------------------------------------------------ |
| **Where messages arrive** | `transport_endpoints`             | Define physical connection points per org              |
| **LNS configuration**     | `org_lns_providers`               | Register LNS servers, bind to transports               |
| **LNS binding**           | `lns_provider_transport_bindings` | Static: ChirpStack→MQTT, Everynet→HTTP                 |
| **Device type routing**   | `device_type_routing_rules`       | Define: Zc2x→direct gRPC, LoRaWAN→LNS                  |
| **Device→LNS mapping**    | `device_lns_assignments`          | Register which LNS handles which device                |
| **Runtime routes**        | `device_message_routes`           | Materialized view: where each device's messages arrive |
