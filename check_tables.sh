#!/bin/bash
# Suppress all output from background processes
exec &>/tmp/db_check.log

psql postgres://postgres:postgres@localhost/zc8 << EOF
-- Check if transport config tables exist
SELECT 'transport_mqtt_config' as table_name, 
       COUNT(*) as row_count 
FROM information_schema.tables 
WHERE table_name = 'transport_mqtt_config'
UNION ALL
SELECT 'transport_http_config' as table_name,
       COUNT(*) as row_count
FROM information_schema.tables 
WHERE table_name = 'transport_http_config'
UNION ALL
SELECT 'transport_grpc_config' as table_name,
       COUNT(*) as row_count
FROM information_schema.tables 
WHERE table_name = 'transport_grpc_config';

-- Show actual row counts if tables exist
\t
SELECT 'MQTT configs:', COUNT(*) FROM transport_mqtt_config;
SELECT 'HTTP configs:', COUNT(*) FROM transport_http_config;
SELECT 'gRPC configs:', COUNT(*) FROM transport_grpc_config;

-- Show transport_registry structure
\dt transport_registry
EOF

cat /tmp/db_check.log
