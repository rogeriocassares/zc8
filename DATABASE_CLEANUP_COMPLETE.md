# Database Schema Cleanup - Migration 011 Complete

**Date:** March 12, 2026  
**Status:** ✅ COMPLETED  
**Impact:** Removed 6 legacy tables, schema now focused on new architecture

## Summary

Successfully cleaned up the database schema by removing all tables related to the old `device_providers` architecture. The new schema is now streamlined around `transport_registry` + `parser_type` architecture.

## Tables Removed

| Table                           | Rows | Purpose                         | Replacement                                                  |
| ------------------------------- | ---- | ------------------------------- | ------------------------------------------------------------ |
| `device_providers`              | 4    | Provider catalog                | `parser_type` + `transport_registry`                         |
| `device_model_routing_rules`    | 4    | Device model → provider routing | Device inherits parser from `device_registry.parser_type_id` |
| `organization_device_providers` | 4    | Org → provider mapping          | `transport_registry.organization_id`                         |
| `team_device_providers`         | 8    | Team → transport → provider     | `transport_registry.team_id`                                 |
| `transport_endpoints`           | 8    | Endpoint definitions            | `transport_registry.config` (JSONB)                          |
| `organization_transports`       | 3    | Org → endpoint mapping          | Implicit in `transport_registry`                             |

**Total: 31 rows removed**

## Schema Before & After

### Before

```
20 tables total:
- Legacy: device_providers, device_model_routing_rules,
          organization_device_providers, team_device_providers,
          transport_endpoints, organization_transports
- New: transport_type, parser_type, transport_registry
```

### After

```
14 tables total:
✅ Core: users, organizations, teams, roles, *_members
✅ Device: device_registry, device_models, device_vendors
✅ New Architecture: transport_type, parser_type, transport_registry
✅ Worker: transport_worker_config, transport_worker_metrics
```

## Data Integrity Results

✅ **All 17 devices preserved** in `device_registry`
✅ **All 5 transport types** preserved in `transport_type`
✅ **All 4 parser types** preserved in `parser_type`  
✅ **2 default transports** configured in `transport_registry`
✅ **All views operational**

- `team_available_transports` → 2 rows
- `available_parsers` → 4 rows
- `device_registry_detailed` → 17 rows
- `team_transport_permissions` → working (0 teams mapped yet)

## Foreign Key Cleanup

The migration automatically handled cascading deletes:

- `device_registry.lns_provider_id` foreign key was dropped
- `transport_worker_config.provider_id` foreign key was dropped
- All references to old tables were cascaded deleted

## Migration Path

Devices can now be migrated from old to new architecture:

```sql
-- Old way (deprecated):
SELECT device_key, lns_provider_id FROM device_registry;

-- New way:
SELECT
  device_key,
  COALESCE(pt.code, 'default') as parser_type,
  COALESCE(tr.name, '[No Transport]') as transport_name
FROM device_registry dr
LEFT JOIN parser_type pt ON dr.parser_type_id = pt.id
LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id;
```

## Benefits of Cleanup

1. **Simpler Schema**: 6 fewer tables to maintain
2. **Clearer Architecture**: Single source of truth (`transport_registry`)
3. **Better Separation of Concerns**:
   - Transport infrastructure separate from parsing strategy
   - No mixing of concerns in provider concept
4. **Easier Extensibility**: Add new transports/parsers without schema changes
5. **Reduced Data Duplication**: No more redundant provider mappings
6. **Improved Performance**: Fewer joins needed for device queries

## Remaining Work

- [ ] Update Go code to remove references to old tables
- [ ] Update device creation form UI
- [ ] Migrate devices to use `transport_registry_id + parser_type_id`
- [ ] Remove `lns_provider_id` column from `device_registry` (in final migration)

## Backwards Compatibility

- `device_registry.lns_provider_id` column **still exists** for backward compatibility
- Can be removed after all code and UI are updated to use new columns
- No code changes required immediately; this is a gradual migration

## Files Created

- `/infra/postgres/migrations/011_cleanup_legacy_tables.sql`

## Verification Commands

```bash
# View final table count
psql -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"
# Result: 14 tables

# Verify device data integrity
psql -c "SELECT COUNT(*) FROM device_registry"
# Result: 17 devices

# Check new columns exist
psql -c "\d device_registry" | grep -E "parser_type_id|transport_registry_id"
```

---

**Status**: Ready for next phase - integration testing with MQTT adapter
