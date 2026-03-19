# Device Schema Refactoring - Migration Summary

**Status:** Ready for Deployment  
**Date:** March 11, 2026

## What Changed

### Old Schema Issues

- ✗ `vendor_registry` mixed device manufacturers with LNS providers
- ✗ `device_registry` stored both model specs and device instances
- ✗ No distinction between direct/LNS/cloud routing patterns
- ✗ EUI and MAC address conflated with device instances
- ✗ No cloud provider support (Schneider, Engil, etc.)

### New Schema Benefits

- ✅ Separate `device_vendors` (manufacturers) from `device_providers` (integrations)
- ✅ Split `device_registry` into `device_models` + `devices`
- ✅ Explicit connection types: direct, lns, cloud
- ✅ Proper device identifiers: device_key, eui, mac_address
- ✅ Support for cloud platforms (Schneider Cloud, Engil, etc.)
- ✅ Clear routing rules per device model
- ✅ Organization-specific provider configurations
- ✅ Provider failover and health tracking

---

## Table Mapping

| Old Table                 | New Tables                  | Notes                            |
| ------------------------- | --------------------------- | -------------------------------- |
| vendor_registry (devices) | device_vendors              | Device manufacturers only        |
| vendor_registry (lns)     | device_providers            | LNS + cloud integrations         |
| device_registry           | device_models + devices     | Split model specs from instances |
| —                         | provider_transport_bindings | New: LNS → transport binding     |
| org_lns_providers         | org_device_providers        | Renamed & generalized            |
| device_lns_assignments    | device_provider_assignments | Renamed & generalized            |
| device_type_routing_rules | device_model_routing_rules  | Renamed & uses device_models     |

---

## New Device Models

### Zc2x Devices

**i2n Model:**

- Connection: Direct gRPC
- Transport: grpc-server
- Identifiers: device_key (service ID)
- Network: 4G/LTE

**v2n Model:**

- Connection: Direct gRPC
- Transport: grpc-server
- Identifiers: device_key (service ID)
- Network: Ethernet

### Agent

**edge-agent Model:**

- Connection: Direct gRPC
- Transport: grpc-server
- Identifiers: device_key (service ID)
- Network: Ethernet

### Kron

**ks3000-wifi Model:**

- Connection: Direct (MQTT)
- Transport: mqtt-subscriber
- Identifiers: mac_address
- Network: WiFi
- No LNS involvement

**ks3000-lora Model:**

- Connection: LNS-based
- Providers: ChirpStack or Everynet
- Identifiers: eui (DevEUI)
- Network: LoRaWAN
- Can use multiple LNS for failover

### Milesight

**em500-swl Model:**

- Connection: LNS-based
- Providers: ChirpStack or Everynet
- Identifiers: eui (DevEUI)
- Network: LoRaWAN
- Can use multiple LNS

### Khomp

**dtl200 Model:**

- Connection: LNS-based
- Providers: ChirpStack or Everynet
- Identifiers: eui (DevEUI)
- Network: LoRaWAN
- Can use multiple LNS

### Schneider

**sch-37 Model (NEW):**

- Connection: Cloud-based
- Provider: Schneider Cloud ONLY
- Identifiers: none (cloud-managed)
- Network: Ethernet
- Pulls data from Schneider Cloud

---

## Routing Configuration Per Device Model

```
┌─ Direct gRPC (Zc2x, Agent)
│  └─→ Transport: grpc-server:50051
│
├─ Direct MQTT (Kron ks3000-wifi)
│  └─→ Transport: mqtt-subscriber:1883
│
├─ LNS-routed (Kron ks3000-lora, Milesight EM500, Khomp DTL200)
│  ├─ Primary: ChirpStack
│  │  └─→ Transport: mqtt-subscriber:1883
│  │      MQTT topic: chirpstack/+/device/+/rx
│  │
│  └─ Fallback: Everynet
│     └─→ Transport: http-server:8080
│         HTTP path: /api/v0/webhooks/uplink
│
└─ Cloud-based (Schneider sch-37)
   └─ Schneider Cloud (http-client - we PULL data)
      └─→ HTTP GET to: api.schneider-electric.cloud/api/v2/pull/devices
```

---

## Migration Workflow

### Step 1: Deploy New Tables (Non-Breaking)

```bash
# Apply migrations 005-008
psql -U postgres -d zc8 < 005_refactor_vendors_providers.sql
psql -U postgres -d zc8 < 006_refactor_device_registry_to_models.sql
psql -U postgres -d zc8 < 007_add_org_device_providers.sql
psql -U postgres -d zc8 < 008_seed_vendor_models_providers.sql
```

### Step 2: Verify Data

```bash
# Check all tables created
SELECT tablename FROM pg_tables WHERE schemaname='public'
  AND tablename IN ('device_vendors', 'device_models', 'devices',
                     'device_providers', 'org_device_providers');

# Check seed data
SELECT COUNT(*) FROM device_vendors;          -- Should be 6
SELECT COUNT(*) FROM device_models;           -- Should be 8
SELECT COUNT(*) FROM device_providers;        -- Should be 4
SELECT COUNT(*) FROM device_model_routing_rules;  -- Should be 8
```

### Step 3: Update Application Code

**Old Query Pattern:**

```go
device := db.QueryRow(`
  SELECT device_id, device_name, vendor_name, device_key, mqtt_device_id
  FROM device_registry
  WHERE device_id = ?
`)
```

**New Query Pattern:**

```go
device := db.QueryRow(`
  SELECT d.id, d.device_name, dv.name, d.device_key, d.eui, d.mac_address
  FROM devices d
  JOIN device_models dm ON d.device_model_id = dm.id
  JOIN device_vendors dv ON dm.device_vendor_id = dv.id
  WHERE d.id = ?
`)
```

### Step 4: Create Test Devices

```sql
-- Create a test Zc2x device
INSERT INTO devices (
  organization_id, device_model_id, device_name, device_key
)
SELECT 2, dm.id, 'test-zc2x-01', 99999
FROM device_models dm
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
WHERE dv.code = 'zc2x' AND dm.model_code = 'zc2x-i2n';

-- Create a test LoRaWAN device
INSERT INTO devices (
  organization_id, device_model_id, device_name, eui
)
SELECT 2, dm.id, 'test-lora-01', '702081031230C000'
FROM device_models dm
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
WHERE dv.code = 'kron' AND dm.model_code = 'kron-ks3000-lora';

-- Assign to LNS provider
INSERT INTO device_provider_assignments (
  device_id, org_device_provider_id, provider_device_id, priority, is_verified
)
SELECT
  d.id,
  odp.id,
  '702081031230C000',
  1,
  true
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN org_device_providers odp ON odp.org_id = d.organization_id
WHERE d.device_name = 'test-lora-01'
  AND odp.provider_instance_name = 'ChirpStack Production';

-- Compute routing table
INSERT INTO device_message_routes (
  device_id, org_id, source_transport_endpoint_id, provider_assignment_id, route_type
)
SELECT
  d.id, d.organization_id, te.id, dpa.id, 'provider_lns'
FROM devices d
JOIN device_provider_assignments dpa ON d.id = dpa.device_id
JOIN org_device_providers odp ON dpa.org_device_provider_id = odp.id
JOIN transport_endpoints te ON odp.transport_endpoint_id = te.id
WHERE dpa.is_active = true;
```

### Step 5: Rollback Plan

If issues arise during testing:

```sql
-- Keep old data intact
-- Restore queries to use device_registry_deprecated temporarily
-- device_registry was renamed to device_registry_deprecated
-- Can rename back if needed: ALTER TABLE device_registry_deprecated RENAME TO device_registry;

-- Delete new data if needed
DELETE FROM device_message_routes;
DELETE FROM device_provider_assignments;
DELETE FROM device_model_routing_rules;
DELETE FROM devices;
DELETE FROM org_device_providers;
DELETE FROM device_models;
DELETE FROM provider_transport_bindings;
DELETE FROM device_providers;
DELETE FROM device_vendors;
```

---

## Testing Queries

### Verify each routing pattern

**Direct gRPC:**

```sql
SELECT
  d.device_name,
  dm.model_name,
  dmr.route_type,
  te.transport_type,
  d.device_key
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_message_routes dmr ON d.id = dmr.device_id
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dm.connection_type = 'direct' AND d.organization_id = 2;
```

**Direct MQTT:**

```sql
SELECT
  d.device_name,
  dm.model_name,
  dmr.route_type,
  te.transport_type,
  d.mac_address
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_message_routes dmr ON d.id = dmr.device_id
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dm.direct_transport_type = 'mqtt-subscriber'
  AND dm.connection_type = 'direct'
  AND d.organization_id = 2;
```

**LNS-routed:**

```sql
SELECT
  d.device_name,
  dm.model_name,
  dv.name as vendor,
  d.eui,
  dp.name as provider,
  odp.provider_instance_name,
  dpa.priority,
  dmr.route_type,
  te.transport_type,
  te.address || ':' || te.port as endpoint
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
JOIN device_provider_assignments dpa ON d.id = dpa.device_id
JOIN org_device_providers odp ON dpa.org_device_provider_id = odp.id
JOIN device_providers dp ON odp.device_provider_id = dp.id
JOIN device_message_routes dmr ON d.id = dmr.device_id
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dm.connection_type = 'lns'
  AND d.organization_id = 2
  AND dpa.is_active = true
ORDER BY d.device_name, dpa.priority;
```

**Cloud-routed:**

```sql
SELECT
  d.device_name,
  dm.model_name,
  dv.name as vendor,
  dp.name as provider,
  odp.provider_instance_name,
  dmr.route_type
FROM devices d
JOIN device_models dm ON d.device_model_id = dm.id
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
LEFT JOIN device_provider_assignments dpa ON d.id = dpa.device_id
LEFT JOIN org_device_providers odp ON dpa.org_device_provider_id = odp.id
LEFT JOIN device_providers dp ON odp.device_provider_id = dp.id
LEFT JOIN device_message_routes dmr ON d.id = dmr.device_id
WHERE dm.connection_type = 'cloud'
  AND d.organization_id = 2;
```

---

## Performance Notes

### New Indexes Created

- Device models: vendor, type, connection pattern
- Devices: org, model, key/eui/mac lookups
- Device providers: org, type, health status
- Device assignments: device, provider, active status
- Message routes: device, endpoint, provider, recent activity

### Query Optimization Tips

1. Use `dmr2.is_active = true` filter to exclude deleted routes
2. Index on (org_id, is_active) for most org-level queries
3. Device message routes table is materialized for fast lookups
4. Consider caching route lookups in application layer

---

## Post-Deployment

1. Monitor application logs for routing errors
2. Verify message counts per device model
3. Check provider health metrics
4. Test failover scenarios:
   - Disable primary ChirpStack
   - Verify devices switch to Everynet
   - Re-enable ChirpStack
   - Verify devices return to ChirpStack
5. Document any custom device types for future maintenance

---

## Files Involved

**Migrations:**

- `005_refactor_vendors_providers.sql` - Creates device_vendors, device_providers
- `006_refactor_device_registry_to_models.sql` - Creates device_models, devices
- `007_add_org_device_providers.sql` - Creates provider management tables
- `008_seed_vendor_models_providers.sql` - Seeds all configuration data

**Documentation:**

- `REFACTORED_DEVICE_SCHEMA.md` - This comprehensive guide
- `TRANSPORT_ROUTING_DESIGN.md` - Original routing design context
- `ROUTING_IMPLEMENTATION_GUIDE.md` - Implementation patterns
