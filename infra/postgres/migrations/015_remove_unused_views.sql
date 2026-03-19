-- Migration 015: Remove unused views while preserving auth/org hierarchy
-- Purpose: Clean up schema by removing views that are not referenced in code
--          while keeping multitenant organization hierarchy, team hierarchy, and user permissions

-- Remove unused device registry views
DROP VIEW IF EXISTS device_registry_detailed CASCADE;
DROP VIEW IF EXISTS device_registry_migration_map CASCADE;

-- Remove unused transport/parser views (not part of auth infrastructure)
DROP VIEW IF EXISTS team_available_transports CASCADE;
DROP VIEW IF EXISTS team_transport_permissions CASCADE;
DROP VIEW IF EXISTS available_parsers CASCADE;

-- Keep: organization_hierarchy, team_hierarchy, user_permissions (auth infrastructure)
-- Keep: device_registry_with_type (actively used in API device routes)

COMMENT ON SCHEMA public IS 'After removing 5 unused views, schema now has: 12 base tables + 4 essential views (organization hierarchy, team hierarchy, user permissions, device registry with type)';
