# Transport Routing Schema - Implementation Summary

**Date:** March 11, 2026  
**Status:** ✅ COMPLETE

## What Was Built

A comprehensive PostgreSQL schema to handle complex message routing for your IoT platform with two routing patterns:

### 1. **Direct Routing** (Device → Transport)

- Zc2x devices send directly to gRPC-Server
- Agent devices send directly to gRPC-Server
- No intermediary processing

### 2. **Indirect Routing** (Device → LNS Provider → Transport)

- LoRaWAN devices (Milesight, Kron, Khomp) route through LNS providers
- ChirpStack integrates via MQTT-Subscriber
- Everynet integrates via HTTP-Server
- Supports multiple LNS providers per organization (primary + fallback)

---

## Database Components Deployed

### ✅ New Tables Added (6 tables)

| Table                             | Purpose                                                         | Records        |
| --------------------------------- | --------------------------------------------------------------- | -------------- |
| `transport_endpoints`             | Define where messages arrive (gRPC:50051, MQTT:1883, HTTP:8080) | 3              |
| `org_lns_providers`               | Configure LNS servers per org + bind to transports              | 2              |
| `lns_provider_transport_bindings` | Static: ChirpStack→MQTT, Everynet→HTTP                          | 2              |
| `device_type_routing_rules`       | Define: LoRaWAN→LNS, gRPC→direct                                | 5              |
| `device_lns_assignments`          | Map devices to LNS providers (primary/fallback)                 | Ready for data |
| `device_message_routes`           | Runtime: where each device's messages arrive                    | Ready for data |

### ✅ Existing Tables (20 tables unchanged)

- organizations, users, teams, device_registry, device_types, vendor_registry, etc.
- All original data preserved

### 📊 Total Database: 26 tables + 3 views + 60+ indexes

---

## Routing Configuration for IMT Organization

### Endpoints Created

```
gRPC-Server:        device-ingress.imt-dev.svc.cluster.local:50051
MQTT-Subscriber:    mosquitto.imt-dev.svc.cluster.local:1883
HTTP-Server:        webhook-receiver.imt-dev.svc.cluster.local:8080
```

### LNS Providers Configured

```
ChirpStack (Primary)  →  MQTT  →  mosquitto:1883
Everynet (Secondary)  →  HTTP  →  webhook-receiver:8080
```

### Routing Rules Defined

```
Device Type    Vendor        Routing Pattern    Route To
─────────────  ────────────  ────────────────   ──────────────────────
gRPC           Zc2x          direct             gRPC-Server
gRPC           Agent         direct             gRPC-Server
LoRaWAN        Milesight     indirect (LNS)     ChirpStack/Everynet
LoRaWAN        Kron          indirect (LNS)     ChirpStack/Everynet
LoRaWAN        Khomp         indirect (LNS)     ChirpStack/Everynet
```

---

## Migration Files

### [001_create_schema.sql](001_create_schema.sql)

- Creates all 20 core tables
- Creates 29 indexes
- Creates 3 views
- Grants zc8 user permissions

### [002_seed_data.sql](002_seed_data.sql)

- Seeds: 3 organizations, 7 vendors, 3 device types, 3 teams, 13 device models

### [003_add_routing_tables.sql](003_add_routing_tables.sql)

- Creates 6 new routing tables
- Creates 18 routing-specific indexes
- Adds vendor_category column

### [004_seed_routing_config.sql](004_seed_routing_config.sql)

- Seeds: LNS bindings, routing rules, transport endpoints, LNS providers
- Marks vendors with correct categories (device_vendor vs lns_provider)

---

## How to Use This Schema

### For Onboarding New Organizations

```sql
-- 1. Transport endpoints for new org
INSERT INTO transport_endpoints (org_id, transport_type, address, port, ...)
VALUES (org_id, 'grpc-server', 'address', 50051, ...);

-- 2. Register their LNS providers
INSERT INTO org_lns_providers (org_id, lns_vendor_id, provider_name, ...)
VALUES (org_id, 6, 'ChirpStack Prod', ...);

-- 3. Assign devices to LNS
INSERT INTO device_lns_assignments (device_id, org_lns_provider_id, lns_device_id, ...)
VALUES ('device-uuid', 1, '702081031230C000', ...);

-- 4. Compute runtime routes
INSERT INTO device_message_routes (device_id, org_id, source_transport_endpoint_id, ...)
VALUES ('device-uuid', org_id, endpoint_id, ...);
```

### For Processing Messages

```sql
-- gRPC device connects: find direct route
SELECT dmr.*, te.* FROM device_message_routes dmr
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dmr.device_id = ? AND dmr.route_type = 'direct';

-- LoRaWAN device (ChirpStack → MQTT): find via LNS
SELECT dmr.*, olp.*, te.* FROM device_message_routes dmr
JOIN device_lns_assignments dla ON dmr.lns_assignment_id = dla.id
JOIN org_lns_providers olp ON dla.org_lns_provider_id = olp.id
JOIN transport_endpoints te ON dmr.source_transport_endpoint_id = te.id
WHERE dmr.device_id = ? AND olp.is_primary = true;
```

### For Failover/Multi-LNS

```sql
-- Get backup LNS provider for device
SELECT * FROM device_lns_assignments
WHERE device_id = ? AND priority = 2;  -- Secondary route

-- Switch to backup if primary fails
UPDATE device_message_routes
SET lns_assignment_id = (backup_dla_id)
WHERE device_id = ? AND route_type = 'indirect_lns';
```

---

## Key Design Decisions

| Decision                                 | Rationale                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Separate `_endpoints` from `_providers`  | Endpoints are transport connections, LNS providers are business entities                |
| Static `lns_provider_transport_bindings` | ChirpStack always uses MQTT, Everynet always uses HTTP (rarely changes)                 |
| Materialized `device_message_routes`     | Avoids complex joins on every message; updated via trigger or background job            |
| `device_lns_assignments` with priority   | Supports multi-LNS scenarios (primary + fallback/load-balancing)                        |
| Per-org transport endpoints              | Different orgs may have different infrastructure (on-prem vs cloud, ports, credentials) |

---

## Next Steps for Application Integration

### 1. **Message Ingestion Layer**

- Route incoming gRPC/HTTP/MQTT messages based on `device_message_routes`
- Update `messages_received` and `last_message_at` metrics

### 2. **Failover Logic**

- Monitor LNS provider health (in `org_lns_providers.healthcheck_status`)
- Automatically switch to secondary when primary fails

### 3. **Admin UI**

- Dashboard showing routing configuration per org
- Device routing verification (which transport receives each device)
- LNS provider health status

### 4. **Background Jobs**

- Materialize `device_message_routes` after any device/LNS/endpoint changes
- Health checks: ping each transport endpoint + LNS API
- Prune old `device_lns_assignments` records when devices are inactive

---

## Documentation Files Created

1. **[TRANSPORT_ROUTING_DESIGN.md](TRANSPORT_ROUTING_DESIGN.md)**
   - Complete schema design rationale
   - Problem statement and solutions
   - SQL examples for all scenarios

2. **[ROUTING_IMPLEMENTATION_GUIDE.md](ROUTING_IMPLEMENTATION_GUIDE.md)**
   - Step-by-step implementation instructions
   - Query examples for common operations
   - Application integration points
   - Monitoring & troubleshooting queries

---

## Quick Reference

### Find where a device routes to

```sql
SELECT device_id, source_transport_endpoint_id, route_type
FROM device_message_routes WHERE device_id = 'uuid';
```

### Get all devices using a transport

```sql
SELECT device_id FROM device_message_routes
WHERE source_transport_endpoint_id = ? AND is_active = true;
```

### Identify unrouted devices

```sql
SELECT device_id FROM device_registry
WHERE organization_id = ? AND is_active = true
AND device_id NOT IN (SELECT device_id FROM device_message_routes);
```

### Check LNS provider health

```sql
SELECT provider_name, healthcheck_status, last_healthcheck_at
FROM org_lns_providers WHERE org_id = ? ORDER BY is_primary DESC;
```

---

## Support

For questions or issues:

1. Check `TRANSPORT_ROUTING_DESIGN.md` for schema details
2. Check `ROUTING_IMPLEMENTATION_GUIDE.md` for implementation examples
3. Review migration files for exact SQL structure

**Last Updated:** 2026-03-11  
**Deployed:** ✅ Active in production database
