# Practical Curl Examples - Creating LNS Devices

## Quick Reference

### 1. Create LoRaWAN Device (OTAA Mode)

```bash
#!/bin/bash

TENANT_ID=1
API_URL="http://localhost:3001"

# Create LNS device with OTAA activation
curl -X POST "$API_URL/api/tenants/$TENANT_ID/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "temp-sensor-001",
    "device_key": "sk_test_abcdef123456",
    "deveui": "0011223344556677",
    "activation_mode": "OTAA",
    "appkey": "112233445566778899aabbccddeeff00",
    "network_server_id": 1,
    "application_id": 42,
    "class": "A",
    "adr_enabled": true,
    "tx_power_idx": 0,
    "dr_min": 0,
    "dr_max": 5
  }' | jq .
```

**Response:**

```json
{
  "success": true,
  "device": {
    "id": 1001,
    "device_id": "temp-sensor-001",
    "deveui": "0011223344556677",
    "activation_mode": "OTAA",
    "network_server_id": 1,
    "application_id": 42,
    "status": "active"
  },
  "jwt": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkZXZpY2VfaWQiOiJ0ZW1wLXNlbnNvci0wMDEiLCJ0ZW5hbnRfaWQiOiIxIiwid...",
    "expires_in_hours": 24
  },
  "message": "LoRaWAN device created successfully"
}
```

---

### 2. Create LNS Device (ABP Mode)

```bash
TENANT_ID=1
API_URL="http://localhost:3001"

# ABP requires devaddr, nwkskey, and appskey instead of appkey
curl -X POST "$API_URL/api/tenants/$TENANT_ID/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "industrial-sensor-abp",
    "device_key": "sk_prod_industrial_abp_001",
    "deveui": "aabbccddeeff0011",
    "activation_mode": "ABP",
    "nwkskey": "112233445566778899aabbccddeeff00",
    "appskey": "00112233445566778899aabbccddeeff",
    "network_server_id": 1,
    "application_id": 99,
    "device_profile_id": "df-sensor-v2",
    "class": "B",
    "adr_enabled": false,
    "tx_power_idx": 1,
    "dr_min": 1,
    "dr_max": 5
  }' | jq .
```

---

### 3. Fetch Device Configuration by DevEUI

```bash
TENANT_ID=1
DEVEUI="0011223344556677"
API_URL="http://localhost:3001"

# Get device using DevEUI (LoRaWAN primary key)
curl -X GET "$API_URL/api/tenants/$TENANT_ID/devices/lns/$DEVEUI" | jq .
```

**Response:**

```json
{
  "success": true,
  "device": {
    "id": 1001,
    "device_key": "sk_test_abcdef123456",
    "status": "active",
    "created_at": "2026-02-23T14:32:10.000Z",
    "deveui": "0011223344556677",
    "activation_mode": "OTAA",
    "network_server_id": 1,
    "application_id": 42,
    "lorawan_class": "A",
    "adr_enabled": true,
    "sync_status": "pending"
  }
}
```

---

### 4. Update LNS Device Configuration

```bash
TENANT_ID=1
DEVICE_ID=1001
API_URL="http://localhost:3001"

# Update device to use different application
curl -X PUT "$API_URL/api/tenants/$TENANT_ID/devices/lns/$DEVICE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "activation_mode": "OTAA",
    "appkey": "00112233445566778899aabbccddeeff",
    "sync_status": "pending"
  }' | jq .
```

**Response:**

```json
{
  "success": true,
  "device": {
    "id": 1001,
    "device_id": 1001,
    "tenant_id": 1,
    "deveui": "0011223344556677",
    "activation_mode": "OTAA",
    "appkey": "00112233445566778899aabbccddeeff",
    "sync_status": "pending",
    "updated_at": "2026-02-23T14:35:20.000Z"
  },
  "message": "LNS device updated successfully"
}
```

---

### 5. Create Multiple Devices (Batch)

```bash
#!/bin/bash

TENANT_ID=1
API_URL="http://localhost:3001"

# Function to create device
create_device() {
  local device_id=$1
  local deveui=$2
  local app_id=$3

  curl -X POST "$API_URL/api/tenants/$TENANT_ID/devices/lns" \
    -H "Content-Type: application/json" \
    -d "{
      \"device_id\": \"$device_id\",
      \"device_key\": \"sk_test_${device_id}_key\",
      \"deveui\": \"$deveui\",
      \"activation_mode\": \"OTAA\",
      \"appkey\": \"112233445566778899aabbccddeeff00\",
      \"network_server_id\": 1,
      \"application_id\": $app_id,
      \"class\": \"A\",
      \"adr_enabled\": true
    }"
  echo "Created: $device_id"
}

# Create 3 devices
create_device "sensor-temp-01" "0011223344556601" 42
create_device "sensor-temp-02" "0011223344556602" 42
create_device "sensor-humidity-01" "0011223344556701" 43

echo "Batch creation complete!"
```

---

### 6. Integration with Device JWT Token

```bash
#!/bin/bash

TENANT_ID=1
DEVICE_ID=1001
API_URL="http://localhost:3001"

# 1. Create device and get JWT
response=$(curl -s -X POST "$API_URL/api/tenants/$TENANT_ID/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "temp-sensor-001",
    "device_key": "sk_test_abcdef123456",
    "deveui": "0011223344556677",
    "activation_mode": "OTAA",
    "appkey": "112233445566778899aabbccddeeff00",
    "network_server_id": 1,
    "application_id": 42
  }')

# Extract JWT token
JWT_TOKEN=$(echo $response | jq -r '.jwt.token')
DEVICE_REGISTRY_ID=$(echo $response | jq -r '.device.id')

echo "Device created with ID: $DEVICE_REGISTRY_ID"
echo "JWT Token: $JWT_TOKEN"

# 2. Use JWT to send telemetry
curl -X POST "http://localhost:3001/api/ingest/telemetry" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deveui": "0011223344556677",
    "data": "AQIDAw==",
    "rssi": -95,
    "snr": 8.5,
    "timestamp": "'$(date +%s)'000"
  }' | jq .
```

---

### 7. Check Device Sync Status

```bash
#!/bin/bash

TENANT_ID=1
DEVEUI="0011223344556677"
API_URL="http://localhost:3001"

# Fetch device and check sync_status
device=$(curl -s -X GET "$API_URL/api/tenants/$TENANT_ID/devices/lns/$DEVEUI")

status=$(echo $device | jq -r '.device.sync_status')
echo "Device Sync Status: $status"

if [ "$status" == "pending" ]; then
  echo "Device configuration is pending sync to network server"
elif [ "$status" == "synced" ]; then
  echo "Device is synced and ready for telemetry"
else
  echo "Device sync error"
fi
```

---

### 8. Multi-Network Server Setup

```bash
#!/bin/bash

TENANT_ID=1
API_URL="http://localhost:3001"

# Create same device on 2 network servers via device_integrations
# First: Create on ChirpStack (network_server_id=1)
device1=$(curl -s -X POST "$API_URL/api/tenants/$TENANT_ID/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "multi-network-device",
    "device_key": "sk_multi_network_001",
    "deveui": "0011223344556677",
    "activation_mode": "OTAA",
    "appkey": "112233445566778899aabbccddeeff00",
    "network_server_id": 1,
    "application_id": 42
  }')

device1_id=$(echo $device1 | jq -r '.device.id')

echo "Created on ChirpStack (network_server_id=1): $device1_id"

# Second: Create bridge entry for TTN (network_server_id=2)
# This would require a device_integrations endpoint (to be implemented)
# For now, direct SQL:
# INSERT INTO device_integrations (device_id, tenant_id, integration_id, integration_type, is_primary, priority)
# VALUES ($device1_id, $TENANT_ID, <ttn-integration-id>, 'lorawan_ttn', false, 2);

echo "Device can now sync to multiple network servers via device_integrations"
```

---

### 9. Monitor Device Updates via Redis

```bash
#!/bin/bash

# Real-time monitoring of device last updates
DEVICE_ID="temp-sensor-001"

# In one terminal, watch Redis
watch -n 1 "redis-cli GET device:${DEVICE_ID}:last_update | jq ."

# In another, simulate device telemetry
for i in {1..10}; do
  temp=$((20 + RANDOM % 15))

  curl -X POST "http://localhost:3333/api/ingest/data" \
    -H "Content-Type: application/json" \
    -d "{\"device_id\": \"$DEVICE_ID\", \"temperature\": $temp}"

  sleep 2
done
```

**Redis Output:**

```json
{
  "hash": "abc123def456",
  "value": {
    "temperature": 24.5,
    "humidity": 65
  },
  "timestamp": 1708000000000
}
```

---

### 10. Full Workflow: Register → Store → Query

```bash
#!/bin/bash

set -e

TENANT_ID=1
API_URL="http://localhost:3001"
DEVICE_ID="workflow-test-001"
DEVEUI="ff00112233445566"

echo "=== Step 1: Create LNS Device ==="
response=$(curl -s -X POST "$API_URL/api/tenants/$TENANT_ID/devices/lns" \
  -H "Content-Type: application/json" \
  -d "{
    \"device_id\": \"$DEVICE_ID\",
    \"device_key\": \"sk_workflow_001\",
    \"deveui\": \"$DEVEUI\",
    \"activation_mode\": \"OTAA\",
    \"appkey\": \"112233445566778899aabbccddeeff00\",
    \"network_server_id\": 1,
    \"application_id\": 99
  }")

DB_ID=$(echo $response | jq -r '.device.id')
JWT=$(echo $response | jq -r '.jwt.token')

echo "Created device ID: $DB_ID"
echo "JWT: ${JWT:0:50}..."

echo ""
echo "=== Step 2: Verify Device Exists ==="
curl -s -X GET "$API_URL/api/tenants/$TENANT_ID/devices/lns/$DEVEUI" | jq '.device | {id, deveui, activation_mode, sync_status}'

echo ""
echo "=== Step 3: Update Configuration ==="
curl -s -X PUT "$API_URL/api/tenants/$TENANT_ID/devices/lns/$DB_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "sync_status": "synced"
  }' | jq '.device | {id, deveui, sync_status}'

echo ""
echo "=== Workflow Complete ==="
echo "Device is ready for telemetry ingestion"
```

---

## Error Handling Examples

### Handle Tenant Not Found

```bash
curl -s -X POST "http://localhost:3001/api/tenants/999/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{"device_id": "test", ...}' | jq .

# Response:
# {
#   "success": false,
#   "error": "Tenant not found"
# }
```

### Handle Duplicate DevEUI

```bash
# First device succeeds
curl -s -X POST "http://localhost:3001/api/tenants/1/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{"device_id": "sensor-1", "deveui": "0011223344556677", ...}'

# Second device with same DevEUI fails (UNIQUE constraint)
curl -s -X POST "http://localhost:3001/api/tenants/1/devices/lns" \
  -H "Content-Type: application/json" \
  -d '{"device_id": "sensor-2", "deveui": "0011223344556677", ...}'

# Response:
# {
#   "success": false,
#   "error": "duplicate key value violates unique constraint..."
# }
```

---

## Integration with Postman

### Environment Variables

```json
{
  "base_url": "http://localhost:3001",
  "tenant_id": "1",
  "device_id": "temp-sensor-001",
  "deveui": "0011223344556677",
  "jwt_token": ""
}
```

### Pre-request Script

```javascript
// Automatically generate DevEUI in xx:xx:xx:xx:xx:xx format
var deveui = Array.from({ length: 8 }, () =>
  Math.floor(Math.random() * 256)
    .toString(16)
    .padStart(2, "0"),
).join("");

pm.environment.set("deveui", deveui);
```

### POST Tests

```javascript
// Save JWT for subsequent requests
if (pm.response.code === 200) {
  var json = pm.response.json();
  pm.environment.set("jwt_token", json.jwt.token);
  pm.environment.set("device_db_id", json.device.id);

  pm.test("Device created successfully", function () {
    pm.expect(json.success).to.equal(true);
  });
}
```

---

## Summary

| Operation        | Endpoint                               | Method | Example                               |
| ---------------- | -------------------------------------- | ------ | ------------------------------------- |
| Create LNS       | `/api/tenants/:id/devices/lns`         | POST   | `curl -X POST ... OTAA config`        |
| Get by DevEUI    | `/api/tenants/:id/devices/lns/:deveui` | GET    | `curl -X GET ... deveui`              |
| Update Config    | `/api/tenants/:id/devices/lns/:id`     | PUT    | `curl -X PUT ... new keys`            |
| Device Telemetry | `/api/ingest/data`                     | POST   | `curl -X POST ... + Bearer JWT`       |
| Check Status     | `device Redis`                         | GET    | `redis-cli GET device:id:last_update` |

**Next:** Use the JWT token from device creation to send telemetry directly from the device! 🚀
