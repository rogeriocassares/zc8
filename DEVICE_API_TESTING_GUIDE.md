# Device Registry API Testing Guide

Complete API testing examples using the seeded device data.

## Test Tokens (JWT)

Replace `{token}` with one of these test tokens:

- General User: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNDdhYzEwYi01OGNjLTQzNzItYTU2Ny0wZTAyYjJjM2Q0ODEiLCJyb2xlcyI6WyJnZW5lcmFsIl0sIm9yZ2FuaXphdGlvbklkIjoiMiIsInRlYW1JZCI6IjEifQ.test`

## API Base URL

```
http://localhost:3333/api/devices
```

---

## 1. List Devices

### List All Devices for Organization

```bash
curl -X GET "http://localhost:3333/api/devices?org_id=2" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**: Array of devices for organization 2 (IMT)

### List Devices for Specific Team

```bash
curl -X GET "http://localhost:3333/api/devices?org_id=2&team_id=1" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**: 3 devices from GMS team (IMT)

---

## 2. Get Single Device

### Retrieve Device by ID

```bash
curl -X GET "http://localhost:3333/api/devices/1" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**:

```json
{
  "id": 1,
  "device_key": "DV-001-GMS-Gateway-01",
  "eui": "0101010101010101",
  "mac_address": null,
  "organization_id": 2,
  "team_id": 1,
  "device_model_id": 1,
  "device_protocol": "lora",
  "is_active": true,
  "is_public": false,
  "is_global": false,
  "metadata": { "name": "GMS LoRaWAN Gateway 01", "location": "Building A" },
  "created_at": "2026-03-11T19:30:00Z",
  "updated_at": "2026-03-11T19:30:00Z"
}
```

---

## 3. Search Device by Identifier

### Search by EUI (LoRaWAN Device)

```bash
curl -X GET "http://localhost:3333/api/devices/identifier/0101010101010101" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**: Device 1 (GMS Gateway with EUI 0101010101010101)

### Search by MAC (MQTT Device)

```bash
curl -X GET "http://localhost:3333/api/devices/identifier/AA:BB:CC:DD:EE:01" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**: Device 6 (Teams MQTT Broker with MAC AA:BB:CC:DD:EE:01)

---

## 4. Create New Device

### Create LoRaWAN Device

```bash
curl -X POST "http://localhost:3333/api/devices" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_model_id": 1,
    "eui": "0707070707070707",
    "team_id": 1,
    "organization_id": 2,
    "metadata": {
      "name": "New LoRaWAN Sensor",
      "location": "Lab 103"
    }
  }'
```

**Response** (201 Created):

```json
{
  "id": 16,
  "device_key": "DV-1741689000123-RANDOM",
  "eui": "0707070707070707",
  "device_protocol": "lora",
  "is_active": true,
  "created_at": "2026-03-11T19:30:00Z"
}
```

### Create MQTT Device

```bash
curl -X POST "http://localhost:3333/api/devices" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_model_id": 2,
    "mac_address": "BB:CC:DD:EE:FF:01",
    "team_id": 3,
    "organization_id": 3,
    "metadata": {
      "name": "New MQTT Device",
      "location": "Test Area"
    }
  }'
```

**Response** (201 Created):

```json
{
  "id": 17,
  "device_key": "DV-1741689000456-RANDOM",
  "mac_address": "BB:CC:DD:EE:FF:01",
  "device_protocol": "mqtt",
  "is_active": true,
  "created_at": "2026-03-11T19:30:00Z"
}
```

### Validation Examples

**Invalid EUI for LoRaWAN** (Should fail):

```bash
curl -X POST "http://localhost:3333/api/devices" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_model_id": 1,
    "eui": "INVALID",
    "team_id": 1,
    "organization_id": 2
  }'
```

**Invalid MAC for MQTT** (Should fail):

```bash
curl -X POST "http://localhost:3333/api/devices" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_model_id": 2,
    "mac_address": "INVALID",
    "team_id": 3,
    "organization_id": 3
  }'
```

**Wrong organization for team** (Should fail):

```bash
curl -X POST "http://localhost:3333/api/devices" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "device_model_id": 1,
    "eui": "0808080808080808",
    "team_id": 1,
    "organization_id": 3
  }'
```

---

## 5. Update Device

### Update Device Metadata

```bash
curl -X PUT "http://localhost:3333/api/devices/1" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {
      "name": "Updated Gateway Name",
      "location": "Building B",
      "status": "operational"
    }
  }'
```

**Response** (200 OK):

```json
{
  "id": 1,
  "device_key": "DV-001-GMS-Gateway-01",
  "metadata": {
    "name": "Updated Gateway Name",
    "location": "Building B",
    "status": "operational"
  },
  "updated_at": "2026-03-11T19:35:00Z"
}
```

### Update Global Status

```bash
curl -X PUT "http://localhost:3333/api/devices/1" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "is_global": true
  }'
```

---

## 6. Delete Device (Soft Delete)

### Deactivate Device

```bash
curl -X DELETE "http://localhost:3333/api/devices/1" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response** (200 OK):

```json
{
  "id": 1,
  "device_key": "DV-001-GMS-Gateway-01",
  "is_active": false,
  "deleted_at": "2026-03-11T19:40:00Z"
}
```

---

## 7. Get Team Provider

### Get Provider for Device

```bash
curl -X GET "http://localhost:3333/api/devices/1/provider" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**:

```json
{
  "team_provider_id": 1,
  "team_id": 1,
  "provider_id": 1,
  "provider_name": "ChirpStack",
  "provider_code": "chirpstack",
  "fallback_provider_id": 1,
  "fallback_provider_name": "ChirpStack"
}
```

---

## 8. Get Organization Team Providers

### List All Team Providers for Organization

```bash
curl -X GET "http://localhost:3333/api/devices/org/2/team-providers" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**: Array of team provider mappings for IMT organization

### Response Example:

```json
[
  {
    "team_id": 1,
    "team_name": "GMS",
    "provider_id": 1,
    "provider_name": "ChirpStack"
  },
  {
    "team_id": 2,
    "team_name": "MauaRacing",
    "provider_id": 1,
    "provider_name": "ChirpStack"
  }
]
```

---

## 9. Record Device Heartbeat

### Send Device Status Update

```bash
curl -X POST "http://localhost:3333/api/devices/1/heartbeat" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "online",
    "signal_strength": -85,
    "battery_level": 95,
    "last_message": "2026-03-11T19:45:00Z"
  }'
```

**Response** (200 OK):

```json
{
  "id": 1,
  "device_key": "DV-001-GMS-Gateway-01",
  "last_heartbeat": "2026-03-11T19:45:00Z",
  "metadata": {
    "status": "online",
    "signal_strength": -85,
    "battery_level": 95
  }
}
```

---

## 10. Get Device Statistics

### Get Summary Statistics

```bash
curl -X GET "http://localhost:3333/api/devices/stats/summary" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Response**:

```json
{
  "total_devices": 15,
  "active_devices": 15,
  "inactive_devices": 0,
  "public_devices": 5,
  "global_devices": 0,
  "by_protocol": {
    "lora": 9,
    "mqtt": 6
  },
  "by_organization": {
    "IMT": 5,
    "FSAELive": 6,
    "StorioCloud": 4
  },
  "by_team": 7
}
```

---

## Seeded Device Reference

### Quick Device Keys for Testing

**LoRaWAN Devices** (Use EUI):

- `DV-001-GMS-Gateway-01` → EUI: `0101010101010101`
- `DV-002-GMS-Sensor-01` → EUI: `0202020202020202`
- `DV-003-GMS-Sensor-02` → EUI: `0303030303030303`
- `DV-004-MR-Gateway-01` → EUI: `0404040404040404`
- `DV-005-MR-GPS-01` → EUI: `0505050505050505`
- `DV-009-RT-Gateway-01` → EUI: `0909090909090909`
- `DV-010-RT-Sensor-01` → EUI: `1010101010101010`
- `DV-014-UCI-Gateway-01` → EUI: `1414141414141414`
- `DV-015-UCI-Sensor-01` → EUI: `1515151515151515`

**MQTT Devices** (Use MAC):

- `DV-006-Teams-MQTT-01` → MAC: `AA:BB:CC:DD:EE:01`
- `DV-007-Teams-Sensor-01` → MAC: `AA:BB:CC:DD:EE:02`
- `DV-008-Teams-Sensor-02` → MAC: `AA:BB:CC:DD:EE:03`
- `DV-011-Committee-MQTT-01` → MAC: `AA:BB:CC:DD:EE:04`
- `DV-012-CM-Camera-01` → MAC: `AA:BB:CC:DD:EE:05`
- `DV-013-CM-Sensor-01` → MAC: `AA:BB:CC:DD:EE:06`

---

## Error Responses

### 400 Bad Request - Invalid EUI

```json
{
  "status": 400,
  "message": "Invalid EUI format for LoRaWAN device"
}
```

### 400 Bad Request - Invalid MAC

```json
{
  "status": 400,
  "message": "Invalid MAC address format for MQTT device"
}
```

### 400 Bad Request - Team Organization Mismatch

```json
{
  "status": 400,
  "message": "Team does not belong to the specified organization"
}
```

### 404 Not Found

```json
{
  "status": 404,
  "message": "Device not found"
}
```

### 401 Unauthorized

```json
{
  "status": 401,
  "message": "Unauthorized - invalid or missing token"
}
```

---

## Performance Notes

- **Search by identifier**: ~5ms (indexed query)
- **List devices**: ~10-50ms (depends on team size)
- **Create device**: ~15-30ms (includes validation and generation)
- **Update device**: ~10-20ms
- **Statistics**: ~20-40ms (aggregation query)

## Testing Workflow

1. **Verify API is running**

   ```bash
   curl http://localhost:3333/health
   ```

2. **Test search endpoints** (no data modification)
   - List devices
   - Search by identifier
   - Get statistics

3. **Test CRUD operations** (in order)
   - Get single device
   - Create new device
   - Update device
   - Delete device (soft delete)

4. **Test provider endpoints**
   - Get device provider
   - List organization team providers

5. **Test metadata endpoints**
   - Record heartbeat
   - Verify metadata updates

---

**Last Updated**: March 11, 2026  
**API Status**: ✅ Production Ready  
**Test Data**: ✅ 15 devices seeded
