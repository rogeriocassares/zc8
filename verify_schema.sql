-- Verification Tests
-- Test 1: Count all major entities
SELECT 'Organizations' as entity, COUNT(*) as count FROM organizations
UNION ALL
SELECT 'Device Vendors', COUNT(*) FROM device_vendors
UNION ALL
SELECT 'Device Providers', COUNT(*) FROM device_providers
UNION ALL
SELECT 'Device Models', COUNT(*) FROM device_models
UNION ALL
SELECT 'Device Type Routing Rules', COUNT(*) FROM device_model_routing_rules
UNION ALL
SELECT 'Transport Endpoints', COUNT(*) FROM transport_endpoints
UNION ALL
SELECT 'Org Device Providers', COUNT(*) FROM org_device_providers
UNION ALL
SELECT 'Provider Transport Bindings', COUNT(*) FROM provider_transport_bindings;

-- Test 2: Device Models with their details
SELECT 
    dm.model_code,
    dm.model_name,
    dv.name as vendor,
    dt.name as device_type,
    dm.connection_type,
    dm.network_interface,
    dm.direct_transport_type,
    dm.has_eui,
    dm.has_mac_address,
    dm.has_device_key
FROM device_models dm
JOIN device_vendors dv ON dm.device_vendor_id = dv.id
JOIN device_types dt ON dm.device_type_id = dt.id
ORDER BY dv.name, dm.model_code;

-- Test 3: IMT Organization Configuration
SELECT
    'IMT Organization Setup Complete' as status,
    (SELECT COUNT(*) FROM organizations WHERE slug = 'imt') as imt_org_exists,
    (SELECT COUNT(*) FROM transport_endpoints WHERE org_id = (SELECT id FROM organizations WHERE slug = 'imt')) as endpoint_count,
    (SELECT COUNT(*) FROM org_device_providers WHERE org_id = (SELECT id FROM organizations WHERE slug = 'imt')) as provider_count;

-- Test 4: Routing Configuration Summary
SELECT
    dm.model_name,
    dmr.routing_pattern,
    COUNT(DISTINCT dp.id) as provider_count
FROM device_model_routing_rules dmr
JOIN device_models dm ON dmr.device_model_id = dm.id
LEFT JOIN device_providers dp ON (dmr.routing_pattern = 'lns' AND dp.id = ANY(dmr.supported_lns_providers))
    OR (dmr.routing_pattern = 'cloud' AND dp.id = dmr.required_cloud_provider_id)
GROUP BY dm.model_name, dmr.routing_pattern
ORDER BY dm.model_name;

-- Test 5: Check table count
SELECT 
    'Total Tables' as metric,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') as count;
