# Transport Routing Schema Design

## Problem Statement

The platform needs to handle multiple message routing patterns:

1. **Direct Routing** (Device → Transport)
   - Zc2x devices → gRPC-Server
   - Agent devices → gRPC-Server

2. **Indirect Routing** (Device → LNS Provider → Transport)
   - LoRaWAN devices → ChirpStack → MQTT-Subscriber
   - LoRaWAN devices → Everynet → HTTP-Server

3. **Per-Organization Configuration**
   - Each org can have multiple transport endpoints
   - Each org can use multiple LNS providers
   - Each org can configure which LNS providers serve which devices

## Current Schema Issues

The existing schema has:

- `device_types` (LoRaWAN, MQTT, gRPC)
- `vendor_registry` (device vendors + LNS vendors mixed)
- `vendor_models_mapping` (vendor → device type)
- `organization_transports` (org's transport configs)

**Problems:**

1. No distinction between **device vendors** vs **LNS providers**
2. No mapping of **LNS providers to transport endpoints** (ChirpStack → MQTT binding)
3. No concept of **message source routing** (where does a message physically arrive?)
4. No **device-to-LNS assignment** (which device uses which LNS provider?)

---

## Proposed Schema Design

### 1. Core Entity Tables (Unchanged)

```sql
-- device_types: Physical protocols
-- LoRaWAN, gRPC, HTTP, MQTT

-- device_vendors: Who manufactures devices
-- Milesight, Kron, Khomp, Zc2x, Agent

-- lns_vendors: Network Server providers
-- ChirpStack, Everynet (SEPARATE from device vendors)
```

### 2. New/Restructured Tables

#### A. Transport Endpoints (Where messages arrive)

```sql
CREATE TABLE transport_endpoints (
    id SERIAL PRIMARY KEY,
    org_id BIGINT REFERENCES organizations(id),
    transport_type VARCHAR(20), -- grpc-server, grpc-client, http-server, http-client, mqtt-subscriber
    connection_name VARCHAR(255), -- "Primary gRPC Server", "ChirpStack MQTT Bridge"
    is_active BOOLEAN DEFAULT true,

    -- Endpoint specifics
    address VARCHAR(255),  -- localhost, 192.168.1.1, etc.
    port INT,

    -- Protocol-specific config
    mqtt_topic_pattern VARCHAR(255),   -- For mqtt-subscriber: "chirpstack/+/device/+/rx"
    http_path VARCHAR(255),            -- For http-server: "/webhook/uplink"
    http_auth_type VARCHAR(50),        -- bearer, api-key, basic, none
    grpc_service_name VARCHAR(255),    -- For grpc endpoints

    created_at TIMESTAMP,
    UNIQUE(org_id, transport_type, connection_name)
);
```

#### B. LNS Provider Configuration (Per Organization)

```sql
CREATE TABLE org_lns_providers (
    id SERIAL PRIMARY KEY,
    org_id BIGINT REFERENCES organizations(id),
    lns_vendor_id BIGINT REFERENCES vendor_registry(id),  -- ChirpStack, Everynet
    provider_name VARCHAR(255),  -- "ChirpStack Production", "Everynet EU"

    -- Integration config
    api_endpoint VARCHAR(255),
    api_key VARCHAR(255),
    region VARCHAR(100),

    -- Transport binding: which endpoint receives this LNS provider's messages?
    transport_endpoint_id INT REFERENCES transport_endpoints(id),
    -- E.g., ChirpStack's MQTT messages arrive on transport_endpoint_id = 5 (MQTT-Subscriber)

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP
);
```

#### C. LNS Provider → Transport Type Mapping (Global/Static)

```sql
CREATE TABLE lns_provider_transport_bindings (
    id SERIAL PRIMARY KEY,
    lns_vendor_id BIGINT REFERENCES vendor_registry(id),
    transport_type VARCHAR(20),  -- What transport type does this LNS provider use?
    description TEXT,

    -- E.g., ChirpStack → mqtt-subscriber
    -- E.g., Everynet → http-server
    -- E.g., Sematech → grpc-client

    UNIQUE(lns_vendor_id, transport_type)
);
```

#### D. Device → LNS Provider Assignment (Per Organization)

```sql
CREATE TABLE device_lns_assignments (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES device_registry(device_id),
    org_lns_provider_id INT REFERENCES org_lns_providers(id),

    -- For multi-LNS scenarios (active/backup)
    priority INT DEFAULT 1,  -- 1=primary, 2=secondary, etc.
    is_active BOOLEAN DEFAULT true,

    -- LNS-specific device ID
    lns_device_id VARCHAR(255),  -- DevEUI, JoinEUI, etc.

    assigned_at TIMESTAMP,
    UNIQUE(device_id, org_lns_provider_id)
);
```

#### E. Device Routing Rules (Static: which device types use which routing pattern)

```sql
CREATE TABLE device_type_routing_rules (
    id SERIAL PRIMARY KEY,
    device_type_id BIGINT REFERENCES device_types(id),
    vendor_id BIGINT REFERENCES vendor_registry(id),  -- Vendor that makes this device type

    routing_pattern VARCHAR(50),  -- 'direct' or 'lns'

    -- For 'direct' routing: which transport type should receive this device's messages?
    default_transport_type VARCHAR(20),  -- e.g., 'grpc-server' for Zc2x

    -- For 'lns' routing: which LNS vendors can serve this device?
    supported_lns_vendors INT[],  -- Array of lns_vendor_ids that can process this device type

    can_use_multiple_lns BOOLEAN DEFAULT false,  -- Can this device use multiple LNS simultaneously?

    UNIQUE(device_type_id, vendor_id)
);
```

#### F. Runtime Routing Table (Actual Message Route Decisions)

```sql
CREATE TABLE device_message_routes (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES device_registry(device_id),
    org_id BIGINT REFERENCES organizations(id),

    -- Resolved route: where does this device's message arrive?
    source_transport_endpoint_id INT REFERENCES transport_endpoints(id),

    -- For LNS-routed devices: which LNS receives it?
    lns_assignment_id BIGINT REFERENCES device_lns_assignments(id),

    -- Metadata
    route_type VARCHAR(50),  -- 'direct' or 'indirect_lns'
    is_active BOOLEAN DEFAULT true,
    last_message_at TIMESTAMP,

    UNIQUE(device_id, org_id)
);
```

---

## Example Routing Scenarios

### Scenario 1: Zc2x Device (Direct gRPC)

```
Device: Zc2x i2n (device_id = abc123)
Vendor: Zc2x
Device Type: gRPC

Flow:
1. device_type_routing_rules[Zc2x] → routing_pattern = 'direct', default_transport_type = 'grpc-server'
2. transport_endpoints[org_id=1, type='grpc-server'] → address=gke.io, port=50051
3. device_message_routes[device_id=abc123] → source_transport_endpoint_id = 5
4. Message arrives: gRPC → transport_endpoint_id=5 → device_id=abc123 ✓
```

### Scenario 2: LoRaWAN Device via ChirpStack (Indirect MQTT)

```
Device: Milesight EM500 (device_id = xyz789)
Vendor: Milesight
Device Type: LoRaWAN

Flow:
1. device_type_routing_rules[Milesight LoRaWAN] → routing_pattern = 'lns', supported_lns_vendors = [ChirpStack, Everynet]
2. org_lns_providers[org_id=1, lns_vendor=ChirpStack] → api_endpoint=chirpstack.io, transport_endpoint_id = 10
3. lns_provider_transport_bindings[ChirpStack] → transport_type = 'mqtt-subscriber'
4. transport_endpoints[id=10, type='mqtt-subscriber'] → mosquitto:1883, topic_pattern="chirpstack/+/device/+/rx"
5. device_lns_assignments[device=xyz789, org_lns_provider=2] → priority=1
6. device_message_routes[device=xyz789] → route_type='indirect_lns', lns_assignment_id=2, source_transport_endpoint_id=10
7. Message flow: LoRaWAN device → ChirpStack → MQTT publish → mosquitto → transport_endpoint_id=10 → device_id=xyz789 ✓
```

### Scenario 3: LoRaWAN Device via Everynet (Indirect HTTP)

```
Same as above but:
- org_lns_providers[org_id=1, lns_vendor=Everynet] → transport_endpoint_id = 11
- lns_provider_transport_bindings[Everynet] → transport_type = 'http-server'
- transport_endpoints[id=11, type='http-server'] → api.everynet.io, path="/webhook/uplink"
- device_message_routes[device=xyz789] → route_type='indirect_lns', lns_assignment_id=3, source_transport_endpoint_id=11
```

---

## SQL Example: Setup for Organization

```sql
-- Org 1: IMT Racing Team
-- Devices: Zc2x units (direct gRPC) + LoRaWAN devices (ChirpStack MQTT + Everynet HTTP)

-- Step 1: Create transport endpoints
INSERT INTO transport_endpoints (org_id, transport_type, connection_name, address, port, mqtt_topic_pattern)
VALUES
    (2, 'grpc-server', 'Primary gRPC Server', 'grpc.imt.local', 50051, NULL),
    (2, 'mqtt-subscriber', 'ChirpStack MQTT', 'mqtt.imt.local', 1883, 'chirpstack/+/device/+/rx'),
    (2, 'http-server', 'Everynet Webhook', 'api.imt.local', 8080, NULL);

-- Step 2: Create LNS provider configs
INSERT INTO org_lns_providers (org_id, lns_vendor_id, provider_name, api_endpoint, api_key, transport_endpoint_id)
VALUES
    (2, 6, 'ChirpStack IMT Instance', 'chirpstack.imt.local:8080', 'key_xyz', 2),  -- endpoint_id=2 = MQTT
   (2, 7, 'Everynet EU Region', 'api.eu.everynet.com', 'key_abc', 3);  -- endpoint_id=3 = HTTP

-- Step 3: Assign devices to LNS
INSERT INTO device_lns_assignments (device_id, org_lns_provider_id, lns_device_id, priority)
VALUES
    ('milesight-001', 1, '702081031230C000', 1),  -- Primary: ChirpStack
    ('milesight-001', 2, '702081031230C000', 2);  -- Secondary: Everynet (backup)

-- Step 4: Compute device routes
INSERT INTO device_message_routes (device_id, org_id, source_transport_endpoint_id, lns_assignment_id, route_type)
SELECT
    dr.device_id,
    dr.org_id,
    dep.id,
    dla.id,
    'indirect_lns'
FROM device_lns_assignments dla
JOIN org_lns_providers olp ON dla.org_lns_provider_id = olp.id
JOIN transport_endpoints dep ON olp.transport_endpoint_id = dep.id
JOIN device_registry dr ON dla.device_id = dr.device_id
WHERE olp.is_active = true AND dla.priority = 1;
```

---

## Migration Path

1. **Phase 1**: Keep existing tables, add new ones (non-breaking)
2. **Phase 2**: Populate `device_type_routing_rules` with static mappings
3. **Phase 3**: Populate `transport_endpoints` from `organization_transports` data
4. **Phase 4**: Create `org_lns_providers` from configuration
5. **Phase 5**: Materialize `device_message_routes` for query optimization

---

## Query Examples

### Get all active routes for an organization

```sql
SELECT
    dr.device_id,
    dev.device_name,
    dev.vendor_name,
    te.transport_type,
    te.address,
    te.port,
   COALESCE(olp.provider_name, 'Direct') as route_via
FROM device_message_routes dr
JOIN device_registry dev ON dr.device_id = dev.device_id
JOIN transport_endpoints te ON dr.source_transport_endpoint_id = te.id
LEFT JOIN device_lns_assignments dla ON dr.lns_assignment_id = dla.id
LEFT JOIN org_lns_providers olp ON dla.org_lns_provider_id = olp.id
WHERE dr.org_id = 2 AND dr.is_active = true;
```

### Get available LNS providers for a device

```sql
SELECT
    olp.provider_name,
    vr.name as lns_vendor,
    te.transport_type,
    te.address
FROM org_lns_providers olp
JOIN vendor_registry vr ON olp.lns_vendor_id = vr.id
JOIN transport_endpoints te ON olp.transport_endpoint_id = te.id
JOIN lns_provider_transport_bindings lptb ON vr.id = lptb.lns_vendor_id
WHERE olp.org_id = 2
  AND olp.is_active = true
  AND lptb.transport_type = te.transport_type;
```

### Find unused transport endpoints

```sql
SELECT te.*
FROM transport_endpoints te
LEFT JOIN device_message_routes dmr ON te.id = dmr.source_transport_endpoint_id
LEFT JOIN org_lns_providers olp ON te.id = olp.transport_endpoint_id
WHERE te.org_id = 2
  AND dmr.id IS NULL
  AND olp.id IS NULL;
```
