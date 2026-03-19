# Transport Registry + Parser Architecture - Operations & Troubleshooting

**Quick Reference**  
**For:** DevOps, SREs, Support Engineers  
**Updated:** March 12, 2026

---

## Quick Concepts

### Three Key Questions

**Q1: Where does the data come from?**  
A: `transport_registry` tells you — MQTT broker, HTTP webhook, gRPC server, etc.

**Q2: How do we handle the data format?**  
A: `transport_parser` tells you — ChirpStack format, Everynet format, or generic/fallback.

**Q3: Can a specific device use a different parser?**  
A: Yes — `device_registry.parser_type_id` can override the transport default.

---

## Database Tables (Simple Version)

```
transport_registry (WHERE to connect FROM)
├─ Host/port/credentials/topics
├─ transport_type_id → mqtt-subscriber, http-server, etc.
└─ transport_parser_id → chirpstack, everynet, default

device_registry (Device configuration)
├─ Bound to a transport (optional)
├─ Can override parser (optional)
└─ Rest of device fields
```

---

## Common Operational Tasks

### 1. Check Active Transports

```sql
SELECT
  id,
  name,
  transport_type_code,
  default_parser_code,
  is_active
FROM team_available_transports
ORDER BY id;
```

**Expected Output:**

```
id | name | transport_type_code | default_parser_code | is_active
1  | Default MQTT Broker (ChirpStack) | mqtt-subscriber | chirpstack | t
2  | Default HTTP Webhook Server | http-server | chirpstack | t
```

### 2. Check Device Parser Configuration

```sql
SELECT
  device_key,
  transport_registry_id,
  parser_type_id,
  COALESCE(dtp.code, ttp.code) as effective_parser
FROM device_registry dr
LEFT JOIN transport_parser dtp ON dr.parser_type_id = dtp.id
LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id
LEFT JOIN transport_parser ttp ON tr.transport_parser_id = ttp.id
WHERE device_key = 'DEVICE-001';
```

**Interpretation:**

- If `parser_type_id` is NOT NULL → Device override active
- If `parser_type_id` is NULL → Uses transport default
- If both are NULL → Uses global "default" parser

### 3. List All Available Parsers

```sql
SELECT id, code, display_name FROM transport_parser ORDER BY code;
```

**Output:**

```
id | code      | display_name
1  | chirpstack| ChirpStack format
2  | everynet  | Everynet API format
3  | default   | Generic/fallback parser
```

### 4. Set Device Parser Override

```sql
-- Give device SENSOR-001 a parser override
UPDATE device_registry
SET parser_type_id = (SELECT id FROM transport_parser WHERE code = 'everynet')
WHERE device_key = 'SENSOR-001';

-- Remove override (revert to transport default)
UPDATE device_registry
SET parser_type_id = NULL
WHERE device_key = 'SENSOR-001';
```

### 5. Change Transport Default Parser

```sql
-- Change MQTT transport to use Everynet parser
UPDATE transport_registry
SET transport_parser_id = (SELECT id FROM transport_parser WHERE code = 'everynet')
WHERE id = 1;

-- This takes effect for new messages AFTER worker restarts
-- Existing device overrides are NOT affected
```

---

## Troubleshooting Guide

### Issue: "Data not being parsed"

**Check 1: Is transport active?**

```sql
SELECT id, name, is_active FROM transport_registry WHERE id = ?;
```

- If `is_active = false`, activate it:
  ```sql
  UPDATE transport_registry SET is_active = true WHERE id = ?;
  ```

**Check 2: Is device bound to transport?**

```sql
SELECT device_key, transport_registry_id FROM device_registry WHERE device_key = ?;
```

- If `transport_registry_id = NULL`, bind it:
  ```sql
  UPDATE device_registry
  SET transport_registry_id = ?
  WHERE device_key = ?;
  ```

**Check 3: Which parser is being used?**

```sql
SELECT
  COALESCE(dr.parser_type_id, tr.transport_parser_id) as effective_parser_id,
  tp.code as parser_code
FROM device_registry dr
LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id
LEFT JOIN transport_parser tp ON COALESCE(dr.parser_type_id, tr.transport_parser_id) = tp.id
WHERE dr.device_key = ?;
```

- Check logs for parser errors with that parser

### Issue: "Wrong parser is being used"

**Step 1: Verify transport default**

```sql
SELECT tr.name, tp.code as parser_code
FROM transport_registry tr
JOIN transport_parser tp ON tr.transport_parser_id = tp.id
WHERE tr.id = ?;
```

**Step 2: Check device override**

```sql
SELECT parser_type_id, device_key
FROM device_registry
WHERE device_key = ?;
```

- If override is set and wrong, update it:
  ```sql
  UPDATE device_registry
  SET parser_type_id = (SELECT id FROM transport_parser WHERE code = 'correct_code')
  WHERE device_key = ?;
  ```

**Step 3: Restart worker**

- Worker reads transport_parser_id at startup
- After changing transport parser, restart MQTT worker:
  ```bash
  # Platform-specific (example: systemctl, docker, kubernetes)
  systemctl restart mqtt-worker
  # or
  kubectl delete pod mqtt-worker-0
  ```

### Issue: "Parser code not recognized"

**Cause:** Parser not in registry or typo in code

```sql
-- Check available parser codes
SELECT code FROM transport_parser;
```

**Valid codes:**

- `chirpstack` — ChirpStack MQTT format
- `everynet` — Everynet API format
- `default` — Generic/passthrough (always exists, fallback)

**Fix:** Use one of the above codes, or add new parser to registry if needed.

### Issue: "Device metrics show 'unknown' parser"

**Check:** If parser_type_id doesn't exist in transport_parser table

```sql
SELECT dr.device_key, dr.parser_type_id
FROM device_registry dr
WHERE dr.parser_type_id NOT IN (SELECT id FROM transport_parser)
AND dr.parser_type_id IS NOT NULL;
```

**Fix:** Set parser_type_id to valid value or NULL:

```sql
UPDATE device_registry
SET parser_type_id = NULL  -- Use transport default
WHERE parser_type_id NOT IN (SELECT id FROM transport_parser)
AND parser_type_id IS NOT NULL;
```

---

## Useful Views

### View 1: team_available_transports

Lists all active transports with their default parser.

```sql
SELECT * FROM team_available_transports;
```

### View 2: available_parsers

Lists all 3 available parsers.

```sql
SELECT * FROM available_parsers;
```

### View 3: device_registry_detailed

Shows device + transport + parser info.

```sql
SELECT device_key, transport_name, parser_code
FROM device_registry_detailed
WHERE team_id = ?;
```

### View 4: team_transport_permissions

Shows which teams can use which transports (when permissions implemented).

```sql
SELECT * FROM team_transport_permissions WHERE team_id = ?;
```

---

## Monitoring & Alerts

### Key Metrics to Track

**1. Parser Errors**

```sql
-- Check logs for patterns like:
-- "failed to parse message parser=everynet error=json.unmarshal"
```

→ Alert if error rate > 1%

**2. Parser Fallbacks**

```sql
-- Check logs for:
-- "using device parser override" (means override is active)
-- "parser error, using fallback" (means parser failed)
```

→ Monitor if any parser has high error rate

**3. Transport Restarts**

```sql
-- Check logs for:
-- "discovered transport with parser"
```

→ Should only happen when transport config changes or worker restarts

**4. Device Parser Distribution**

```sql
SELECT
  COALESCE(tp.code, 'default') as parser_code,
  COUNT(*) as device_count
FROM device_registry dr
LEFT JOIN transport_parser tp ON dr.parser_type_id = tp.id
GROUP BY parser_code
ORDER BY device_count DESC;
```

→ Understand which parsers are in use

---

## Configuration Examples

### Add a New ChirpStack Transport

```sql
INSERT INTO transport_registry (
  name, description, organization_id, team_id,
  transport_type_id, transport_parser_id,
  is_global, is_active, config, created_at, updated_at
) VALUES (
  'ChirpStack AWS',
  'MQTT broker in AWS region',
  1,  -- organization_id
  NULL,  -- global (all teams)
  (SELECT id FROM transport_type WHERE code = 'mqtt-subscriber'),
  (SELECT id FROM transport_parser WHERE code = 'chirpstack'),
  true,  -- is_global
  true,  -- is_active
  jsonb_build_object(
    'host', 'mqtt.aws.chirpstack.io',
    'port', 1883,
    'username', 'aws_user',
    'password', 'secure_password',
    'tls_enabled', true,
    'topics', '["applications/+/devices/+/up"]'
  ),
  now(),
  now()
);
```

### Bind Existing Device to New Transport

```sql
UPDATE device_registry
SET transport_registry_id = (
  SELECT id FROM transport_registry
  WHERE name = 'ChirpStack AWS'
  AND is_active = true
)
WHERE device_vendor_id = 1  -- All devices from vendor 1
AND transport_registry_id IS NULL;  -- Only unbound devices
```

---

## Performance Tuning

### Index Usage

```sql
-- Check if indexes are being used
EXPLAIN ANALYZE
SELECT dr.device_key, tp.code
FROM device_registry dr
LEFT JOIN transport_parser tp ON dr.parser_type_id = tp.id
WHERE dr.device_key = 'SENSOR-001';
```

**Expected:** Should use index on `device_registry(device_key)`

### Query Optimization

**Slow Query (avoid):**

```sql
-- Joining through unnecessary tables
SELECT *
FROM device_registry dr
JOIN device_models dm ON dr.device_model_id = dm.id
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
WHERE dr.parser_type_id = (SELECT id FROM transport_parser WHERE code = 'chirpstack');
```

**Fast Query (prefer):**

```sql
-- Direct lookup with indexed column
SELECT *
FROM device_registry dr
WHERE dr.parser_type_id = (SELECT id FROM transport_parser WHERE code = 'chirpstack');
```

---

## Backup & Recovery

### Backup transport_registry

```bash
# Export current transport configuration
pg_dump -t transport_registry -F c zc8 > backup_transports_$(date +%s).dump

# View contents
SELECT id, name, config FROM transport_registry;
```

### Restore Transport Configuration

```bash
# If config was modified incorrectly
SELECT config FROM transport_registry
WHERE name = 'Default MQTT Broker (ChirpStack)';

# Restore from JSON edit history or backup
UPDATE transport_registry
SET config = jsonb_build_object(
    'host', 'mqtt.example.com',
    'port', 1883,
    'topics', '["applications/+/devices/+/up"]'
)
WHERE id = 1;
```

---

## Common Errors & Solutions

| Error                            | Cause                            | Solution                                         |
| -------------------------------- | -------------------------------- | ------------------------------------------------ |
| `parser not found: unknown_code` | Invalid parser code              | Use: chirpstack, everynet, or default            |
| `device has no transport`        | Device not bound to transport    | Run UPDATE to set transport_registry_id          |
| `connection refused`             | Transport host/port wrong        | Check config JSON, update if needed              |
| `json.unmarshal error`           | Parser doesn't understand format | Check device format, change parser or check logs |
| `no active transports`           | All transports disabled          | Set is_active=true for at least one transport    |

---

## When to Restart Workers

**Required restarts:**

1. ✅ After changing `transport_registry.transport_parser_id` (default parser)
2. ✅ After changing `transport_registry.config` (host/port/credentials)
3. ✅ After changing `transport_registry.is_active` (activate/deactivate)

**NOT required:**

1. ❌ After changing `device_registry.parser_type_id` (device override)
2. ❌ After changing `device_registry.transport_registry_id` (device binding)
3. ❌ Adding new devices

**Restart command (example):**

```bash
# Systemd
systemctl restart mqtt-worker

# Docker
docker restart mqtt-worker-1

# Kubernetes
kubectl delete pod -l app=mqtt-worker
kubectl rollout restart deployment mqtt-worker
```

---

## Validation Checklist

Before going live:

- [ ] All 3 parsers exist: SELECT count(\*) FROM transport_parser; -- Should be 3
- [ ] At least 1 active transport: SELECT count(\*) FROM transport_registry WHERE is_active=true; -- Should be >= 1
- [ ] All devices have valid parser references: SELECT count(\*) FROM device_registry WHERE parser_type_id NOT IN (SELECT id FROM transport_parser AND parser_type_id IS NOT NULL);
- [ ] Views are working: SELECT count(\*) FROM team_available_transports; -- Should match active transports
- [ ] Worker logs show parser initialization: grep "mqtt adapter initialized" logs/
- [ ] Sample message processed: Check device_models ingest table for message

---

**Document Status:** ✅ READY FOR OPERATIONS  
**Questions?** Check database views or contact Platform Engineering
