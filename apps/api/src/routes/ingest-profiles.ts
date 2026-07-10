// This file has been deprecated and emptied.
// The ingest_profile, ingest_type, ingest_config, ingest_redis_config,
// ingest_nats_config, and ingest_registry tables were dropped in migration 0006.
// Only ingest_influxdb_config remains (used directly by services/ingest).
// This route file is no longer imported. Delete it when convenient.

import { Elysia } from "elysia";
import type { DrizzleDB } from "../db";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function createIngestProfileRoutes(_db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1/ingest-profiles" });
}
