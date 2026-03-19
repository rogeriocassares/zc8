-- Recreate views with parser_type included

-- team_available_transports view
CREATE OR REPLACE VIEW team_available_transports AS
SELECT 
  tr.id,
  tr.name,
  tr.description,
  tr.organization_id,
  tr.team_id,
  tt.code as transport_type_code,
  tt.display_name as transport_type_name,
  tp.code as default_parser_code,
  tp.display_name as default_parser_name,
  tr.config,
  tr.is_global,
  tr.is_active,
  (CASE WHEN tr.is_global THEN 'Global' ELSE 'Team-Specific' END) as scope
FROM transport_registry tr
JOIN transport_type tt ON tr.transport_type_id = tt.id
JOIN transport_parser tp ON tr.transport_parser_id = tp.id
WHERE tr.is_active = true
ORDER BY tr.is_global DESC, tr.name;

-- device_registry_detailed view
CREATE OR REPLACE VIEW device_registry_detailed AS
SELECT 
  dr.id,
  dr.device_key,
  dr.eui,
  dr.mac_address,
  dr.team_id,
  dr.organization_id,
  t.name as team_name,
  o.name as organization_name,
  COALESCE(tr.name, '[No Transport]') as transport_name,
  COALESCE(tt.code, '[Unknown]') as transport_type,
  COALESCE(tp.code, 'default') as parser_type,
  COALESCE(tp.display_name, 'Default (Passthrough)') as parser_display_name,
  dr.is_active,
  dr.device_model_id,
  dr.created_at,
  dr.updated_at
FROM device_registry dr
LEFT JOIN teams t ON dr.team_id = t.id
LEFT JOIN organizations o ON dr.organization_id = o.id
LEFT JOIN transport_registry tr ON dr.transport_registry_id = tr.id
LEFT JOIN transport_type tt ON tr.transport_type_id = tt.id
LEFT JOIN transport_parser tp ON dr.parser_type_id = tp.id
ORDER BY dr.device_key;

-- team_transport_permissions view
CREATE OR REPLACE VIEW team_transport_permissions AS
SELECT DISTINCT
  t.id as team_id,
  t.name as team_name,
  t.organization_id,
  o.name as organization_name,
  tr.id as transport_registry_id,
  tr.name as transport_name,
  tr.description,
  tr.is_global,
  tt.code as transport_type_code,
  tp.code as default_parser_code,
  CASE 
    WHEN tr.is_global THEN 'Can use (org-wide)'
    WHEN tr.team_id = t.id THEN 'Can use (team-specific)'
    ELSE 'Cannot use'
  END as permission_level
FROM teams t
JOIN organizations o ON t.organization_id = o.id
JOIN transport_registry tr ON tr.organization_id = o.id
JOIN transport_type tt ON tr.transport_type_id = tt.id
JOIN transport_parser tp ON tr.transport_parser_id = tp.id
WHERE tr.is_active = true
  AND (tr.is_global = true OR tr.team_id = t.id)
ORDER BY t.name, tr.name;
