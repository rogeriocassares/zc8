-- Migration 014: Remove unused worker configuration and metrics tables
-- Date: March 13, 2026
-- Reason: These tables were part of the old worker tracking architecture
--         With the new transport_registry + parser_type architecture, 
--         worker configuration is sourced directly from transport_registry.
--         Worker metrics should be collected via observability platforms (Prometheus, etc.)
--         not stored in PostgreSQL.
-- Impact: No data loss (tables were empty), no breaking changes
-- Verified: No code references these tables, no dependent tables

-- Drop the worker metrics table first (no foreign keys referencing it)
DROP TABLE IF EXISTS transport_worker_metrics CASCADE;

-- Drop the worker config table
-- Note: This has FK to teams table, but CASCADE on the team DELETE won't affect
-- the DROP operation - the table itself has no dependent tables referencing it
DROP TABLE IF EXISTS transport_worker_config CASCADE;

-- Cleanup: Drop the sequences that were auto-created for the IDs
DROP SEQUENCE IF EXISTS transport_worker_metrics_id_seq;
DROP SEQUENCE IF EXISTS transport_worker_config_id_seq;

-- Verify: Tables removed
-- SELECT COUNT(*) FROM information_schema.tables 
-- WHERE table_name IN ('transport_worker_metrics', 'transport_worker_config');
-- Expected: 0
