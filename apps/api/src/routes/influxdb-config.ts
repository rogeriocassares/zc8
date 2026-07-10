// This file has been deprecated and emptied.
// ingest_influxdb_config was a legacy standalone config table.
// InfluxDB3 connections are now managed through the service registry:
//   POST /api/v1/services  { service_type: "input.influxdb3"  }  — InfluxDB3 source
//   POST /api/v1/services  { service_type: "output.influxdb3" }  — InfluxDB3 sink
// This route file is no longer imported. Delete it when convenient.

import { Elysia } from "elysia";
import type { DrizzleDB } from "../db";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createInfluxdbConfigRoutes(_db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/influxdb-configs" });
}
