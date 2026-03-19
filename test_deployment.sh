#!/bin/bash
# Verification test script for consolidated migrations
# Tests all major components

cd /Users/rogeriocassares/Git/rogeriocassares/zc8

echo "=========================================="
echo "SCHEMA VALIDATION TEST"
echo "=========================================="

# Test 1: Count tables
echo -e "\n✓ Table Count:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"

# Test 2: Organizations
echo -e "\n✓ Organizations:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT name FROM organizations ORDER BY name;" | sed 's/^/  - /'

# Test 3: Device Vendors  
echo -e "\n✓ Device Vendors:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT name FROM device_vendors ORDER BY name;" | sed 's/^/  - /'

# Test 4: Device Models with routing
echo -e "\n✓ Device Models & Routing:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT dm.model_name || ' [' || dm.connection_type || ']' as model FROM device_models dm ORDER BY model;" | sed 's/^/  - /'

# Test 5: IMT Organization Config
echo -e "\n✓ IMT Organization Configuration:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT transport_type || ': ' || connection_name FROM transport_endpoints WHERE org_id = 2 ORDER BY transport_type;" | sed 's/^/  - /'

# Test 6: Provider Configuration
echo -e "\n✓ IMT Provider Instances:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT provider_instance_name FROM org_device_providers WHERE org_id = 2 ORDER BY is_primary DESC;" | sed 's/^/  - /'

# Test 7: Routing Rules
echo -e "\n✓ Device Model Routing Rules:"
docker compose -f docker/docker-compose.yaml exec -T postgres psql -U zc8 -d zc8 -t -c \
  "SELECT dm.model_name || ' → ' || dmr.routing_pattern FROM device_models dm JOIN device_model_routing_rules dmr ON dm.id = dmr.device_model_id ORDER BY dm.model_name;" | sed 's/^/  - /'

echo -e "\n=========================================="
echo "✅ SCHEMA VALIDATION COMPLETE"
echo "=========================================="
