-- Seed data for migration 025
-- Adds device_influxdb3_config entries and updates device_registry

-- ============================================================================
-- device_influxdb3_config: Per-org/team InfluxDB3 instances
-- ============================================================================

-- IMT org-wide default
INSERT INTO device_influxdb3_config (
  organization_id, team_id, host, port, token, influxdb_org, bucket, measurement
) VALUES (
  2, NULL, 'influxdb3.maua.br', 8086, 'imt-influxdb-token-secret', 'imt', 'telemetry-imt', 'telemetry'
);

-- IMT/GMS team-specific
INSERT INTO device_influxdb3_config (
  organization_id, team_id, host, port, token, influxdb_org, bucket, measurement
) VALUES (
  2, 1, 'influxdb3.maua.br', 8086, 'imt-influxdb-token-secret', 'imt', 'telemetry-gms', 'telemetry'
);

-- IMT/MauaRacing team-specific
INSERT INTO device_influxdb3_config (
  organization_id, team_id, host, port, token, influxdb_org, bucket, measurement
) VALUES (
  2, 2, 'influxdb3.maua.br', 8086, 'imt-influxdb-token-secret', 'imt', 'telemetry-maua-racing', 'telemetry'
);

-- FSAELive org-wide default
INSERT INTO device_influxdb3_config (
  organization_id, team_id, host, port, token, influxdb_org, bucket, measurement
) VALUES (
  3, NULL, 'influxdb3.fsaelive.com', 8086, 'fsae-influxdb-token-secret', 'fsaelive', 'telemetry-fsae', 'telemetry'
);

-- StorioCloud org-wide default
INSERT INTO device_influxdb3_config (
  organization_id, team_id, host, port, token, influxdb_org, bucket, measurement
) VALUES (
  4, NULL, 'influxdb3.storiocloud.com', 8086, 'storio-influxdb-token-secret', 'storiocloud', 'telemetry-storio', 'telemetry'
);

-- ============================================================================
-- Update existing device_registry entry with new columns
-- ============================================================================

-- Set device_type for existing LoRaWAN device (milesight-ws101-001 has dev_eui)
UPDATE device_registry
  SET device_type = 'lorawan', is_persistent = true
  WHERE device_key = 'milesight-ws101-001';
