-- Migration 011: Clean Up Legacy Tables
-- Date: March 12, 2026
-- Purpose: Remove old architecture tables no longer used with transport_registry + parser_type
-- Impact: Removes obsolete tables from device_providers era

---------- ANALYSIS OF LEGACY TABLES ----------

-- The following tables were part of the OLD architecture:
-- 1. device_providers - Provider catalog (REPLACED by parser_type + transport_registry)
-- 2. device_model_routing_rules - Device model → provider mapping (REPLACED by device_registry.parser_type_id)
-- 3. organization_device_providers - Org → provider config (REPLACED by transport_registry.organization_id)
-- 4. team_device_providers - Team → transport → provider (REPLACED by transport_registry.team_id)
-- 5. transport_endpoints - Endpoint definitions (REPLACED by transport_registry.config JSONB)
-- 6. organization_transports - Org → endpoint mapping (REPLACED by transport_registry)

-- NEW ARCHITECTURE:
-- - transport_type: Catalog of transport types (mqtt, grpc, http, etc.)
-- - parser_type: Catalog of parser types (chirpstack, everynet, direct_mqtt, default)
-- - transport_registry: Infrastructure + configuration (replaces all 6 tables above)

---------- DELETION ORDER ----------
-- Order matters due to foreign key constraints!
-- Delete in this order to avoid constraint violations:

-- Step 1: Drop tables that depend on device_providers
DROP TABLE IF EXISTS team_device_providers CASCADE;
DROP TABLE IF EXISTS organization_device_providers CASCADE;
DROP TABLE IF EXISTS device_model_routing_rules CASCADE;

-- Step 2: Drop tables that depend on transport_endpoints
DROP TABLE IF EXISTS organization_transports CASCADE;

-- Step 3: Drop legacy catalog tables (no longer referenced)
DROP TABLE IF EXISTS transport_endpoints CASCADE;
DROP TABLE IF EXISTS device_providers CASCADE;

---------- CLEANUP COLUMNS ----------
-- Remove lns_provider_id from device_registry since we now use parser_type_id + transport_registry_id
-- (Keeping for now to support gradual migration, will be removed in next phase)
-- ALTER TABLE device_registry DROP COLUMN lns_provider_id;

---------- VERIFICATION ----------

-- After cleanup, verify remaining tables are correct:
-- SELECT 'transport_type' as table_name, COUNT(*) as rows FROM transport_type
-- UNION ALL SELECT 'parser_type', COUNT(*) FROM parser_type
-- UNION ALL SELECT 'transport_registry', COUNT(*) FROM transport_registry
-- UNION ALL SELECT 'device_registry', COUNT(*) FROM device_registry;

---------- SUMMARY ----------

-- REMOVED TABLES:
-- - device_model_routing_rules (4 rows) - Device model to provider routing
-- - device_providers (4 rows) - Provider catalog
-- - organization_device_providers (4 rows) - Org to provider mapping
-- - team_device_providers (8 rows) - Team to provider mapping
-- - transport_endpoints (8 rows) - Endpoint definitions
-- - organization_transports (3 rows) - Org to endpoint mapping

-- KEPT TABLES:
-- - device_registry (17 rows) - Core device config (migrated to new architecture)
-- - device_models - Device model catalog
-- - device_vendors - Vendor catalog
-- - transport_worker_config - Worker configuration
-- - transport_worker_metrics - Metrics collection
-- - All core tables: users, organizations, teams, roles, members

-- RESULT:
-- - Cleaner schema focusing on new architecture
-- - Fewer moving parts to maintain
-- - No more provider-level abstractions (simplified)
-- - Single source of truth: transport_registry
