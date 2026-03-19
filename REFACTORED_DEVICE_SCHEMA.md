# Device Vendors & Models Schema Refactoring

**Date:** March 11, 2026  
**Status:** Schema Design Complete - Ready for Migration

## Overview

The schema has been refactored to clearly separate concerns:

```
Device Vendors (Manufacturers)
    ↓
Device Models (Model Specifications)
    ↓
Device Instances (Actual Devices)
    ↓
Device Providers (External Integrations)
    ↓
Transport Routes (Where messages arrive)
```

---

## Table Structure

### 1. **device_vendors** - Device Manufacturers

| Column      | Type      | Purpose                                   |
| ----------- | --------- | ----------------------------------------- |
| id          | BIGSERIAL | Vendor ID                                 |
| name        | VARCHAR   | Vendor name (Milesight, Kron, Zc2x, etc.) |
| code        | VARCHAR   | Unique code (milesight, kron, zc2x)       |
| description | TEXT      | Vendor description                        |

**Examples:**

- Milesight: Sensor manufacturer
- Kron: Energy monitoring devices
- Khomp: Industrial gateway solutions
- Zc2x: Embedded systems
- Agent: Distributed telemetry service
- Schneider: Industrial automation

### 2. **device_models** - Device Model Specifications

Defines what each model can do and how it connects.

| Column                | Type      | Purpose                                        |
| --------------------- | --------- | ---------------------------------------------- |
| id                    | BIGSERIAL | Model ID                                       |
| device_vendor_id      | BIGINT FK | Which vendor makes this model                  |
| model_name            | VARCHAR   | Model name (e.g., "ks3000-wifi")               |
| device_type_id        | BIGINT FK | Type (LoRaWAN, gRPC, MQTT)                     |
| network_interface     | VARCHAR   | Connection type (lorawan, ethernet, wifi, 4g)  |
| connection_type       | VARCHAR   | Routing pattern (direct, lns, cloud)           |
| direct_transport_type | VARCHAR   | For direct: grpc-server, mqtt-subscriber, etc. |
| supported_lns_vendors | BIGINT[]  | For LNS: which providers support?              |
| cloud_provider_id     | BIGINT FK | For cloud: which provider?                     |
| has_eui               | BOOLEAN   | Does this model have LoRaWAN EUI?              |
| has_mac_address       | BOOLEAN   | Does this model have MAC address?              |
| has_device_key        | BOOLEAN   | Does this model have device key?               |

**Device Model Examples:**

```sql
-- Direct gRPC: Zc2x i2n
device_vendor_id = Zc2x
model_name = 'i2n'
connection_type = 'direct'
direct_transport_type = 'grpc-server'
has_device_key = true
network_interface = '4g'

-- Direct MQTT: Kron ks3000-wifi
device_vendor_id = Kron
model_name = 'ks3000-wifi'
connection_type = 'direct'
direct_transport_type = 'mqtt-subscriber'
has_mac_address = true
network_interface = 'wifi'

-- LNS-routed: Kron ks3000-lora
device_vendor_id = Kron
model_name = 'ks3000-lora'
connection_type = 'lns'
supported_lns_vendors = [ChirpStack, Everynet]
has_eui = true
network_interface = 'lorawan'

-- Cloud-routed: Schneider sch-37
device_vendor_id = Schneider
model_name = 'sch-37'
connection_type = 'cloud'
cloud_provider_id = Schneider Cloud
network_interface = 'ethernet'
```

### 3. **devices** - Actual Device Instances

Individual devices with their identifiers.

| Column              | Type      | Purpose                               |
| ------------------- | --------- | ------------------------------------- |
| id                  | UUID      | Device instance ID                    |
| organization_id     | BIGINT FK | Which org owns this device            |
| device_model_id     | BIGINT FK | What model is this?                   |
| device_name         | VARCHAR   | Device name                           |
| device_key          | BIGINT    | For gRPC devices (service ID)         |
| eui                 | VARCHAR   | For LoRaWAN devices (DevEUI)          |
| mac_address         | VARCHAR   | For Ethernet/WiFi devices             |
| provisioning_status | VARCHAR   | pending, provisioned, activated, etc. |

**Device Instance Examples:**

```sql
-- Zc2x gRPC device
device_id = 'uuid-1'
device_model_id = 5  (Zc2x i2n)
organization_id = 2  (IMT)
device_key = 12345
device_name = 'zc2x-unit-01'

-- Kron WiFi device
device_id = 'uuid-2'
device_model_id = 7  (Kron ks3000-wifi)
organization_id = 2
mac_address = '00:1A:2B:3C:4D:5E'
device_name = 'kron-energy-01'

-- LoRaWAN device via ChirpStack
device_id = 'uuid-3'
device_model_id = 8  (Kron ks3000-lora)
organization_id = 2
eui = '702081031230C000'
device_name = 'kron-lora-01'
```

### 4. **device_providers** - External Integration Platforms

| Column                  | Type      | Purpose                                                    |
| ----------------------- | --------- | ---------------------------------------------------------- |
| id                      | BIGSERIAL | Provider ID                                                |
| name                    | VARCHAR   | Provider name                                              |
| code                    | VARCHAR   | Unique code (chirpstack, everynet, schneider-cloud, engil) |
| provider_type           | VARCHAR   | Type (lns, cloud, integration)                             |
| api_endpoint_template   | VARCHAR   | API template URL                                           |
| requires_authentication | BOOLEAN   | Does this provider need auth?                              |

**Provider Examples:**

```
ChirpStack (LNS) → integrates via MQTT-Subscriber
Everynet (LNS) → integrates via HTTP-Server
Schneider Cloud (Cloud) → integrates via HTTP-Client
Engil (Integration) → custom integration
```

### 5. **provider_transport_bindings** - How Providers Integrate

Maps each provider to its transport type.

| Column                | Type      | Purpose                                     |
| --------------------- | --------- | ------------------------------------------- |
| device_provider_id    | BIGINT FK | Which provider?                             |
| transport_type        | VARCHAR   | How does it send data?                      |
| default_topic_pattern | VARCHAR   | For MQTT (e.g., "chirpstack/+/device/+/rx") |
| default_http_path     | VARCHAR   | For HTTP (e.g., "/api/v0/webhooks/uplink")  |

**Bindings:**

- ChirpStack → MQTT-Subscriber (topic: "chirpstack/+/device/+/rx")
- Everynet → HTTP-Server (path: "/api/v0/webhooks/uplink")
- Schneider Cloud → HTTP-Client (path: "/api/v2/pull/devices")

### 6. **org_device_providers** - Organization-Specific Provider Config

Each org can configure its own instances of providers.

| Column                 | Type      | Purpose                      |
| ---------------------- | --------- | ---------------------------- |
| org_id                 | BIGINT FK | Which org?                   |
| device_provider_id     | BIGINT FK | Which provider?              |
| provider_instance_name | VARCHAR   | Name for this org's instance |
| api_endpoint           | VARCHAR   | Actual endpoint for this org |
| api_key                | VARCHAR   | Credentials                  |
| transport_endpoint_id  | INT FK    | Routes to which transport?   |
| is_primary             | BOOLEAN   | Primary or fallback?         |
| region                 | VARCHAR   | Geographic region            |

**Example:**

```
IMT Org → ChirpStack Production
  api_endpoint: chirpstack.imt.prod.svc.cluster.local
  api_key: ****
  transport_endpoint_id: 2 (MQTT-Subscriber @ mosquitto:1883)
  is_primary: true

IMT Org → Everynet EU
  api_endpoint: api.eu.everynet.com
  api_key: ****
  transport_endpoint_id: 3 (HTTP-Server @ webhook:8080)
  is_primary: false (failover)
```

### 7. **device_provider_assignments** - Device ↔ Provider Binding

Maps specific device instances to their provider instances.

| Column                 | Type    | Purpose                                            |
| ---------------------- | ------- | -------------------------------------------------- |
| device_id              | UUID FK | Which device?                                      |
| org_device_provider_id | INT FK  | Via which provider instance?                       |
| provider_device_id     | VARCHAR | Device ID in provider (DevEUI, profile name, etc.) |
| priority               | INT     | Primary (1), Secondary (2), etc.                   |
| is_verified            | BOOLEAN | Confirmed working in provider?                     |

**Example:**

```
Device: kron-lora-01 (eui=702081031230C000)
→ Provider: ChirpStack Production (priority=1)
    provider_device_id: 702081031230C000
    is_verified: true

→ Provider: Everynet EU (priority=2)
    provider_device_id: 702081031230C000
    is_verified: true (backup)
```

### 8. **device_model_routing_rules** - Static Routing Logic

Defines how each model should be routed.

| Column                     | Type      | Purpose                      |
| -------------------------- | --------- | ---------------------------- |
| device_model_id            | BIGINT FK | Which model?                 |
| routing_pattern            | VARCHAR   | direct, lns, or cloud        |
| direct_transport_type      | VARCHAR   | For direct: which transport? |
| supported_lns_providers    | BIGINT[]  | For LNS: which providers?    |
| required_cloud_provider_id | BIGINT FK | For cloud: required provider |

**Routing Rules:**

```
Zc2x i2n → direct gRPC-Server
Kron ks3000-wifi → direct MQTT-Subscriber
Kron ks3000-lora → LNS (ChirpStack or Everynet)
Milesight EM500 → LNS (ChirpStack or Everynet)
Schneider sch-37 → Cloud (Schneider Cloud only)
```

### 9. **device_message_routes** - Runtime Resolution

Materialized table: "where does this device's messages arrive?"

| Column                       | Type      | Purpose                              |
| ---------------------------- | --------- | ------------------------------------ |
| device_id                    | UUID FK   | Which device?                        |
| source_transport_endpoint_id | INT FK    | Which transport receives it?         |
| provider_assignment_id       | BIGINT FK | Via which provider (if LNS/Cloud)?   |
| route_type                   | VARCHAR   | direct, provider_lns, provider_cloud |

**Example Resolutions:**

```
Device: zc2x-unit-01 → Transport: gRPC-Server (device-ingress.imt.local:50051)
Device: kron-lora-01 → Transport: MQTT-Subscriber (mosquitto.imt.local:1883) via ChirpStack
Device: sch-37-power-01 → Transport: HTTP-Client to Schneider Cloud
```

---

## Message Flow Examples

### Direct gRPC (Zc2x)

```
Device (Zc2x i2n)
  ↓ (has device_key)
  Connection Type: direct
  ↓ (routing rule: direct → grpc-server)
  Device Model: Zc2x i2n
  ↓ (supported transport)
  Transport Endpoint: gRPC-Server (device-ingress.imt.local:50051)
  ↓
  Application (grpc.IngestRequest)
```

### Direct MQTT (Kron ks3000-wifi)

```
Device (Kron ks3000-wifi)
  ↓ (has mac_address)
  Connection Type: direct
  ↓ (routing rule: direct → mqtt-subscriber)
  Device Model: Kron ks3000-wifi
  ↓ (supported transport)
  Transport Endpoint: MQTT-Subscriber (mosquitto.imt.local:1883)
  ↓
  Application (MQTT message)
```

### Indirect LNS (Kron ks3000-lora)

```
Device (Kron ks3000-lora)
  ↓ (has eui=702081031230C000)
  Connection Type: lns
  ↓ (routing rule: supported_lns = [ChirpStack, Everynet])
  Provider Assignment: ChirpStack Production (priority=1)
  ↓ (org_lns_provider config)
  ChirpStack (provider_type=lns, api_endpoint=chirpstack.imt.prod.svc)
  ↓ (provider_transport_binding: mqtt-subscriber)
  Transport Endpoint: MQTT-Subscriber (mosquitto.imt.local:1883)
  ↓ (MQTT message with topic: chirpstack/prod/device/702081031230C000/rx)
  Application (parsed LoRaWAN uplink)
```

### Cloud-based (Schneider sch-37)

```
Device (Schneider sch-37)
  ↓ (cloud-routed)
  Provider (Schneider Cloud)
  ↓ (org_device_providers config)
  API: api.schneider-electric.cloud
  ↓ (provider_transport_binding: http-client)
  We PULL from Schneider Cloud (HTTP GET to /api/v2/pull/devices)
  ↓
  Application (data from Schneider)
```

---

## Query Patterns

### Find all routes for a device

```sql
SELECT
    d.device_name,
    dm.model_name,
    dv.name as vendor,
    dmr.route_type,
    te.transport_type,
    te.address,
    COALESCE(dp.name, 'Direct') as provider
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
JOIN device_model_routing_rules dmr ON dm.id = dmr.device_model_id
JOIN device_message_routes dmr2 ON d.id = dmr2.device_id
JOIN transport_endpoints te ON dmr2.source_transport_endpoint_id = te.id
LEFT JOIN device_provider_assignments dpa ON dmr2.provider_assignment_id = dpa.id
LEFT JOIN org_device_providers odp ON dpa.org_device_provider_id = odp.id
LEFT JOIN device_providers dp ON odp.device_provider_id = dp.id
WHERE d.organization_id = 2;
```

### Find LoRaWAN devices without provider assignment (error state)

```sql
SELECT
    d.device_id,
    d.device_name,
    dm.model_name,
    dv.name as vendor,
    d.eui
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
WHERE d.organization_id = 2
  AND dm.connection_type = 'lns'
  AND d.eui IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM device_provider_assignments
    WHERE device_id = d.id AND is_active = true
  );
```

### Get provider health per organization

```sql
SELECT
    odp.provider_instance_name,
    dp.name as provider,
    odp.healthcheck_status,
    COUNT(DISTINCT dpa.device_id) as active_devices,
    MAX(dmr.last_message_at) as last_message
FROM org_device_providers odp
JOIN device_providers dp ON odp.device_provider_id = dp.id
LEFT JOIN device_provider_assignments dpa ON odp.id = dpa.org_device_provider_id
LEFT JOIN device_message_routes dmr ON dpa.id = dmr.provider_assignment_id
WHERE odp.org_id = 2
GROUP BY odp.id, odp.provider_instance_name, dp.name, odp.healthcheck_status;
```

---

## Migration Checklist

- [ ] Migration 005: Create device_vendors and device_providers tables
- [ ] Migration 006: Create device_models and devices tables
- [ ] Migration 007: Create org_device_providers and update routing tables
- [ ] Migration 008: Seed vendor, model, provider, and routing data
- [ ] Verify all tables created
- [ ] Verify seed data populated
- [ ] Run routing queries to confirm correct setup
- [ ] Deploy to production
