#!/bin/bash
# Setup script to create transport configuration tables
# This script runs the database migrations to replace JSONB config with typed tables

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Transport Configuration Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ ERROR: DATABASE_URL environment variable not set${NC}"
    echo "Set it with: export DATABASE_URL=\"postgres://user:password@host:port/dbname\""
    exit 1
fi

echo -e "${YELLOW}📝 Database URL:${NC} ${DATABASE_URL:0:50}..."
echo ""

# Check PostgreSQL connection
echo -e "${YELLOW}🔍 Checking database connection...${NC}"
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}❌ Failed to connect to database${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Database connection successful${NC}"
echo ""

# Run migration 005: Create tables
echo -e "${YELLOW}📊 Running migration 005: Create transport configuration tables...${NC}"
if psql "$DATABASE_URL" < infra/postgres/migrations/005_transport_connection_config.sql > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Migration 005 completed${NC}"
else
    echo -e "${RED}❌ Migration 005 failed${NC}"
    exit 1
fi
echo ""

# Run migration 006: Migrate data
echo -e "${YELLOW}📊 Running migration 006: Migrate existing config data...${NC}"
if psql "$DATABASE_URL" < infra/postgres/migrations/006_migrate_transport_config_data.sql > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Migration 006 completed${NC}"
else
    echo -e "${RED}❌ Migration 006 failed${NC}"
    exit 1
fi
echo ""

# Verify tables were created
echo -e "${YELLOW}🔍 Verifying tables...${NC}"
TABLES=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('transport_mqtt_config', 'transport_http_config', 'transport_grpc_config')")

if [ "$TABLES" -eq 3 ]; then
    echo -e "${GREEN}✅ All 3 configuration tables created successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Found $TABLES tables (expected 3)${NC}"
fi
echo ""

# Show table details
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Created Tables${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}📋 transport_mqtt_config:${NC}"
psql "$DATABASE_URL" -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='transport_mqtt_config' ORDER BY ordinal_position LIMIT 10"
echo ""

echo -e "${YELLOW}📋 transport_http_config:${NC}"
psql "$DATABASE_URL" -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='transport_http_config' ORDER BY ordinal_position LIMIT 10"
echo ""

echo -e "${YELLOW}📋 transport_grpc_config:${NC}"
psql "$DATABASE_URL" -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='transport_grpc_config' ORDER BY ordinal_position LIMIT 10"
echo ""

# Check if data was migrated
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Migration Status${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

MQTT_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM transport_mqtt_config" 2>/dev/null || echo "0")
HTTP_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM transport_http_config" 2>/dev/null || echo "0")
GRPC_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM transport_grpc_config" 2>/dev/null || echo "0")

echo -e "${YELLOW}📊 Configuration Records Migrated:${NC}"
echo "  MQTT configs:  ${MQTT_COUNT}"
echo "  HTTP configs:  ${HTTP_COUNT}"
echo "  gRPC configs:  ${GRPC_COUNT}"
echo ""

# Check transport_registry links
MQTT_LINKED=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM transport_registry WHERE transport_mqtt_config_id IS NOT NULL" 2>/dev/null || echo "0")
HTTP_LINKED=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM transport_registry WHERE transport_http_config_id IS NOT NULL" 2>/dev/null || echo "0")
GRPC_LINKED=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM transport_registry WHERE transport_grpc_config_id IS NOT NULL" 2>/dev/null || echo "0")

echo -e "${YELLOW}🔗 transport_registry Links:${NC}"
echo "  Linked to MQTT: ${MQTT_LINKED}"
echo "  Linked to HTTP: ${HTTP_LINKED}"
echo "  Linked to gRPC: ${GRPC_LINKED}"
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Verify the Go code compiles:"
echo "   ${BLUE}go build ./services/transport/mqtt/...${NC}"
echo ""
echo "2. The worker manager will now query typed tables instead of JSONB"
echo "3. Configure repositories to use ConfigRepository:"
echo "   ${BLUE}repo := tcfg.NewConfigRepository(db)${NC}"
echo ""
