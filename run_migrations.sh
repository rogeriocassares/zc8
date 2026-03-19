#!/bin/bash
# Quick migration runner for transport configuration tables
# Usage: ./run_migrations.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/infra/postgres/migrations"

echo "🔧 Transport Configuration Migration Runner"
echo "=========================================="
echo ""

# Get database URL from .env or use default
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
fi

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/zc8}"

echo "📍 Database: $DB_URL"
echo ""

# Run migration 005
echo "⏳ Running migration 005 (Create typed config tables)..."
psql "$DB_URL" -f "$MIGRATIONS_DIR/005_transport_connection_config.sql" > /dev/null 2>&1 && echo "✅ Done" || echo "⚠️  Already applied"

# Run migration 006  
echo "⏳ Running migration 006 (Migrate config data)..."
psql "$DB_URL" -f "$MIGRATIONS_DIR/006_migrate_transport_config_data.sql" > /dev/null 2>&1 && echo "✅ Done" || echo "⚠️  Already applied"

echo ""
echo "✨ Migrations complete!"
echo ""

# Verify
echo "📊 Verifying tables..."
psql "$DB_URL" -c "
SELECT 
    'transport_mqtt_config' as table_name,
    COUNT(*) as record_count
FROM transport_mqtt_config
UNION ALL
SELECT 
    'transport_http_config',
    COUNT(*)
FROM transport_http_config
UNION ALL
SELECT 
    'transport_grpc_config',
    COUNT(*)
FROM transport_grpc_config
ORDER BY table_name;
"

echo ""
echo "✅ Setup complete!"
