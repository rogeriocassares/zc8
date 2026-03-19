-- ============================================================
-- PostgreSQL Migration 006: Device Registry Seed Data
-- ============================================================
-- Purpose: Seed device_registry with test devices
-- Includes: LoRaWAN and MQTT devices across different teams
-- ============================================================

BEGIN;

-- ============================================================
-- Insert test devices into device_registry
-- ============================================================

INSERT INTO device_registry 
(device_key, device_model_id, eui, mac_address, created_by, organization_id, team_id, lns_provider_id, is_public, is_active, is_global, metadata, created_at, updated_at)
VALUES

-- ============================================================
-- GMS Team (IMT Organization) - LoRaWAN Devices
-- ============================================================

-- Device 1: GMS LoRaWAN Gateway #1
(
  'DV-001-GMS-Gateway-01',
  1,  -- device_model_id for LoRaWAN (assuming model 1 is LoRaWAN)
  '0101010101010101',  -- EUI
  NULL,  -- MAC
  'f47ac10b-58cc-4372-a567-0e02b2c3d481',  -- created_by: General (IMT member)
  2,  -- organization_id: IMT
  1,  -- team_id: GMS
  1,  -- lns_provider_id: ChirpStack
  false,
  true,
  false,
  '{"name": "GMS LoRaWAN Gateway 01", "location": "Building A", "floor": 1, "region": "North"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 2: GMS LoRaWAN Sensor #1
(
  'DV-002-GMS-Sensor-01',
  1,  -- LoRaWAN
  '0202020202020202',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d481',
  2,  -- IMT
  1,  -- GMS
  1,  -- ChirpStack
  true,  -- Public device
  true,
  false,
  '{"name": "GMS Temperature Sensor 01", "location": "Lab 101", "sensor_type": "temperature", "accuracy_celsius": 0.5}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 3: GMS LoRaWAN Sensor #2
(
  'DV-003-GMS-Sensor-02',
  1,  -- LoRaWAN
  '0303030303030303',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d481',
  2,  -- IMT
  1,  -- GMS
  1,  -- ChirpStack
  false,
  true,
  false,
  '{"name": "GMS Humidity Sensor 02", "location": "Lab 102", "sensor_type": "humidity", "accuracy_percent": 2.0}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- ============================================================
-- MauaRacing Team (IMT Organization) - LoRaWAN Devices
-- ============================================================

-- Device 4: MauaRacing LoRaWAN Gateway #1
(
  'DV-004-MR-Gateway-01',
  1,  -- LoRaWAN
  '0404040404040404',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d482',  -- created_by: Mauá (IMT member)
  2,  -- IMT
  2,  -- MauaRacing
  1,  -- ChirpStack
  false,
  true,
  false,
  '{"name": "MauaRacing LoRaWAN Gateway 01", "location": "Garage", "region": "South"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 5: MauaRacing GPS Tracker #1
(
  'DV-005-MR-GPS-01',
  1,  -- LoRaWAN
  '0505050505050505',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d482',
  2,  -- IMT
  2,  -- MauaRacing
  1,  -- ChirpStack
  true,  -- Public
  true,
  false,
  '{"name": "Vehicle GPS Tracker 01", "device_type": "vehicle_tracker", "vehicle_id": "MR-2024-01"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- ============================================================
-- Teams Team (FSAELive Organization) - MQTT Devices
-- ============================================================

-- Device 6: Teams MQTT Broker #1
(
  'DV-006-Teams-MQTT-01',
  2,  -- device_model_id for MQTT (assuming model 2 is MQTT)
  NULL,  -- EUI
  'AA:BB:CC:DD:EE:01',  -- MAC
  'f47ac10b-58cc-4372-a567-0e02b2c3d483',  -- created_by: FSAE (FSAELive member)
  3,  -- organization_id: FSAELive
  3,  -- team_id: Teams
  4,  -- lns_provider_id: Engil
  false,
  true,
  false,
  '{"name": "Teams MQTT Broker 01", "broker_host": "mqtt.teams.local", "port": 1883}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 7: Teams MQTT Sensor #1
(
  'DV-007-Teams-Sensor-01',
  2,  -- MQTT
  NULL,
  'AA:BB:CC:DD:EE:02',
  'f47ac10b-58cc-4372-a567-0e02b2c3d483',
  3,  -- FSAELive
  3,  -- Teams
  4,  -- Engil
  false,
  true,
  false,
  '{"name": "Teams Pressure Sensor 01", "location": "Engine Bay", "sensor_type": "pressure"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 8: Teams MQTT Sensor #2
(
  'DV-008-Teams-Sensor-02',
  2,  -- MQTT
  NULL,
  'AA:BB:CC:DD:EE:03',
  'f47ac10b-58cc-4372-a567-0e02b2c3d483',
  3,  -- FSAELive
  3,  -- Teams
  4,  -- Engil
  true,  -- Public
  true,
  false,
  '{"name": "Teams Speed Sensor 02", "location": "Wheel Hub", "sensor_type": "speed"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- ============================================================
-- RaceTracks Team (FSAELive Organization) - LoRaWAN Devices
-- ============================================================

-- Device 9: RaceTracks LoRaWAN Gateway #1
(
  'DV-009-RT-Gateway-01',
  1,  -- LoRaWAN
  '0909090909090909',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d483',
  3,  -- FSAELive
  4,  -- RaceTracks
  1,  -- ChirpStack
  false,
  true,
  false,
  '{"name": "RaceTracks LoRaWAN Gateway 01", "location": "Main Gate", "region": "East"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 10: RaceTracks LoRaWAN Sensor #1
(
  'DV-010-RT-Sensor-01',
  1,  -- LoRaWAN
  '1010101010101010',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d483',
  3,  -- FSAELive
  4,  -- RaceTracks
  1,  -- ChirpStack
  false,
  true,
  false,
  '{"name": "RaceTracks Ambient Sensor 01", "location": "Track Center", "sensor_type": "ambient"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- ============================================================
-- Committee Team (FSAELive Organization) - MQTT Devices
-- ============================================================

-- Device 11: Committee MQTT Device #1
(
  'DV-011-Committee-MQTT-01',
  2,  -- MQTT
  NULL,
  'AA:BB:CC:DD:EE:04',
  'f47ac10b-58cc-4372-a567-0e02b2c3d483',
  3,  -- FSAELive
  5,  -- Committee
  4,  -- Engil
  true,  -- Public
  true,
  false,
  '{"name": "Committee Status Monitor 01", "device_type": "status_board"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- ============================================================
-- Cinemark Team (StorioCloud Organization) - MQTT Devices
-- ============================================================

-- Device 12: Cinemark MQTT Camera #1
(
  'DV-012-CM-Camera-01',
  2,  -- MQTT
  NULL,
  'AA:BB:CC:DD:EE:05',
  'f47ac10b-58cc-4372-a567-0e02b2c3d484',  -- created_by: StorioCloud member
  4,  -- organization_id: StorioCloud
  6,  -- team_id: Cinemark
  4,  -- lns_provider_id: Engil
  false,
  true,
  false,
  '{"name": "Cinemark IP Camera 01", "location": "Lobby", "resolution": "1080p", "fps": 30}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 13: Cinemark MQTT Sensor #1
(
  'DV-013-CM-Sensor-01',
  2,  -- MQTT
  NULL,
  'AA:BB:CC:DD:EE:06',
  'f47ac10b-58cc-4372-a567-0e02b2c3d484',
  4,  -- StorioCloud
  6,  -- Cinemark
  4,  -- Engil
  false,
  true,
  false,
  '{"name": "Cinemark Temperature Sensor 01", "location": "Screen Room", "accuracy_celsius": 1.0}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- ============================================================
-- UCI Team (StorioCloud Organization) - LoRaWAN Devices
-- ============================================================

-- Device 14: UCI LoRaWAN Gateway #1
(
  'DV-014-UCI-Gateway-01',
  1,  -- LoRaWAN
  '1414141414141414',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d484',
  4,  -- StorioCloud
  7,  -- UCI
  4,  -- Engil
  false,
  true,
  false,
  '{"name": "UCI LoRaWAN Gateway 01", "location": "West Tower", "region": "West"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),

-- Device 15: UCI LoRaWAN Sensor #1
(
  'DV-015-UCI-Sensor-01',
  1,  -- LoRaWAN
  '1515151515151515',
  NULL,
  'f47ac10b-58cc-4372-a567-0e02b2c3d484',
  4,  -- StorioCloud
  7,  -- UCI
  4,  -- Engil
  true,  -- Public
  true,
  false,
  '{"name": "UCI Air Quality Sensor 01", "location": "Rooftop", "sensor_type": "air_quality"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)

ON CONFLICT DO NOTHING;

-- ============================================================
-- VERIFICATION & STATISTICS
-- ============================================================

\echo ''
\echo '✅ Device Registry Seed Data Inserted!'
\echo ''
\echo 'Device Summary by Organization:'
SELECT 
  o.name as organization,
  COUNT(*) as total_devices,
  COUNT(CASE WHEN drwt.device_protocol = 'lora' THEN 1 END) as lorawan_devices,
  COUNT(CASE WHEN drwt.device_protocol != 'lora' THEN 1 END) as mqtt_devices,
  COUNT(CASE WHEN drwt.is_public = true THEN 1 END) as public_devices
FROM device_registry_with_type drwt
JOIN organizations o ON drwt.organization_id = o.id
GROUP BY o.id, o.name
ORDER BY o.name;

\echo ''
\echo 'Device Summary by Team:'
SELECT 
  t.name as team,
  o.name as organization,
  COUNT(*) as devices,
  STRING_AGG(DISTINCT drwt.device_protocol, ', ') as protocols
FROM device_registry_with_type drwt
JOIN teams t ON drwt.team_id = t.id
JOIN organizations o ON drwt.organization_id = o.id
GROUP BY t.id, t.name, o.id, o.name
ORDER BY o.name, t.name;

\echo ''
\echo 'Device Status Overview:'
SELECT 
  COUNT(*) as total_devices,
  COUNT(CASE WHEN is_active = true THEN 1 END) as active_devices,
  COUNT(CASE WHEN is_public = true THEN 1 END) as public_devices,
  COUNT(CASE WHEN is_global = true THEN 1 END) as global_devices,
  COUNT(DISTINCT organization_id) as organizations,
  COUNT(DISTINCT team_id) as teams
FROM device_registry;

COMMIT;
