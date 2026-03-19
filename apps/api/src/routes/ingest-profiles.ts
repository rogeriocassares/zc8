/**
 * Ingest Profile CRUD API Routes
 *
 * Manage per-device/team/org write destination profiles.
 * Each profile controls where telemetry is routed:
 *   - InfluxDB3 (time-series storage)
 *   - Redis (latest-value cache)
 *   - NATS (real-time streaming)
 */

import { Elysia, t } from "elysia";
import type { Pool } from "pg";

export function createIngestProfileRoutes(db: Pool) {
  return new Elysia({ prefix: "/api/v1/ingest-profiles" })

    // ============================================================
    // List profiles for an organization
    // ============================================================
    .get("/", async ({ query }) => {
      const orgId = Number(query.org_id);
      if (!orgId) {
        return { success: false, error: "org_id query parameter required" };
      }

      const params: (number | null)[] = [orgId];
      let sql = `
        SELECT
          ip.id, ip.name, ip.description,
          ip.organization_id, ip.team_id,
          ip.influxdb_config_id, ip.influxdb_write_enabled,
          ip.influxdb_require_ack, ip.influxdb_bucket, ip.influxdb_measurement,
          ip.redis_config_id, ip.redis_write_enabled,
          ip.redis_max_hash_entries, ip.redis_key_prefix,
          ip.nats_config_id, ip.nats_write_enabled, ip.nats_subject_prefix,
          ip.is_active, ip.is_default,
          ip.created_at, ip.updated_at
        FROM ingest_profile ip
        WHERE ip.organization_id = $1
      `;

      const teamId = query.team_id ? Number(query.team_id) : null;
      if (teamId) {
        sql += " AND (ip.team_id = $2 OR ip.team_id IS NULL)";
        params.push(teamId);
      }

      sql += " ORDER BY ip.is_default DESC, ip.team_id NULLS FIRST, ip.name";

      const result = await db.query(sql, params);
      return {
        success: true,
        data: result.rows,
        total: result.rowCount,
      };
    })

    // ============================================================
    // Get a single profile by ID
    // ============================================================
    .get("/:id", async ({ params }) => {
      const id = Number(params.id);

      const result = await db.query(
        `SELECT
          ip.id, ip.name, ip.description,
          ip.organization_id, ip.team_id,
          ip.influxdb_config_id, ip.influxdb_write_enabled,
          ip.influxdb_require_ack, ip.influxdb_bucket, ip.influxdb_measurement,
          ip.redis_config_id, ip.redis_write_enabled,
          ip.redis_max_hash_entries, ip.redis_key_prefix,
          ip.nats_config_id, ip.nats_write_enabled, ip.nats_subject_prefix,
          ip.is_active, ip.is_default,
          ip.created_at, ip.updated_at
        FROM ingest_profile ip
        WHERE ip.id = $1`,
        [id],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Profile not found" };
      }

      return { success: true, data: result.rows[0] };
    })

    // ============================================================
    // Create a new ingest profile
    // ============================================================
    .post("/", async ({ body }) => {
      const b = body as any;
      const orgId = Number(b.organization_id);
      if (!orgId) {
        return { success: false, error: "organization_id is required" };
      }

      // If marking as default, clear existing default for same org+team scope
      if (b.is_default) {
        if (b.team_id) {
          await db.query(
            `UPDATE ingest_profile SET is_default = false
             WHERE organization_id = $1 AND team_id = $2 AND is_default = true`,
            [orgId, b.team_id],
          );
        } else {
          await db.query(
            `UPDATE ingest_profile SET is_default = false
             WHERE organization_id = $1 AND team_id IS NULL AND is_default = true`,
            [orgId],
          );
        }
      }

      const result = await db.query(
        `INSERT INTO ingest_profile (
          name, description, organization_id, team_id,
          influxdb_config_id, influxdb_write_enabled,
          influxdb_require_ack, influxdb_bucket, influxdb_measurement,
          redis_config_id, redis_write_enabled,
          redis_max_hash_entries, redis_key_prefix,
          nats_config_id, nats_write_enabled, nats_subject_prefix,
          is_active, is_default
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18
        ) RETURNING *`,
        [
          b.name,
          b.description || null,
          orgId,
          b.team_id || null,
          b.influxdb_config_id || null,
          b.influxdb_write_enabled ?? true,
          b.influxdb_require_ack ?? true,
          b.influxdb_bucket || null,
          b.influxdb_measurement || null,
          b.redis_config_id || null,
          b.redis_write_enabled ?? true,
          b.redis_max_hash_entries ?? 10,
          b.redis_key_prefix || null,
          b.nats_config_id || null,
          b.nats_write_enabled ?? true,
          b.nats_subject_prefix || null,
          b.is_active ?? true,
          b.is_default ?? false,
        ],
      );

      return {
        success: true,
        data: result.rows[0],
        message: "Ingest profile created",
      };
    })

    // ============================================================
    // Update an ingest profile
    // ============================================================
    .put("/:id", async ({ params, body }) => {
      const id = Number(params.id);
      const b = body as any;

      // If marking as default, clear existing default for same scope
      if (b.is_default) {
        // Get the current profile to know its org+team scope
        const current = await db.query(
          "SELECT organization_id, team_id FROM ingest_profile WHERE id = $1",
          [id],
        );
        if (current.rows.length > 0) {
          const { organization_id, team_id } = current.rows[0];
          if (team_id) {
            await db.query(
              `UPDATE ingest_profile SET is_default = false
               WHERE organization_id = $1 AND team_id = $2 AND is_default = true AND id != $3`,
              [organization_id, team_id, id],
            );
          } else {
            await db.query(
              `UPDATE ingest_profile SET is_default = false
               WHERE organization_id = $1 AND team_id IS NULL AND is_default = true AND id != $2`,
              [organization_id, id],
            );
          }
        }
      }

      const result = await db.query(
        `UPDATE ingest_profile SET
          name = COALESCE($2, name),
          description = COALESCE($3, description),
          influxdb_config_id = COALESCE($4, influxdb_config_id),
          influxdb_write_enabled = COALESCE($5, influxdb_write_enabled),
          influxdb_require_ack = COALESCE($6, influxdb_require_ack),
          influxdb_bucket = COALESCE($7, influxdb_bucket),
          influxdb_measurement = COALESCE($8, influxdb_measurement),
          redis_config_id = COALESCE($9, redis_config_id),
          redis_write_enabled = COALESCE($10, redis_write_enabled),
          redis_max_hash_entries = COALESCE($11, redis_max_hash_entries),
          redis_key_prefix = COALESCE($12, redis_key_prefix),
          nats_config_id = COALESCE($13, nats_config_id),
          nats_write_enabled = COALESCE($14, nats_write_enabled),
          nats_subject_prefix = COALESCE($15, nats_subject_prefix),
          is_active = COALESCE($16, is_active),
          is_default = COALESCE($17, is_default),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
        [
          id,
          b.name ?? null,
          b.description ?? null,
          b.influxdb_config_id ?? null,
          b.influxdb_write_enabled ?? null,
          b.influxdb_require_ack ?? null,
          b.influxdb_bucket ?? null,
          b.influxdb_measurement ?? null,
          b.redis_config_id ?? null,
          b.redis_write_enabled ?? null,
          b.redis_max_hash_entries ?? null,
          b.redis_key_prefix ?? null,
          b.nats_config_id ?? null,
          b.nats_write_enabled ?? null,
          b.nats_subject_prefix ?? null,
          b.is_active ?? null,
          b.is_default ?? null,
        ],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Profile not found" };
      }

      return {
        success: true,
        data: result.rows[0],
        message: "Ingest profile updated",
      };
    })

    // ============================================================
    // Delete an ingest profile
    // ============================================================
    .delete("/:id", async ({ params }) => {
      const id = Number(params.id);

      const result = await db.query(
        "DELETE FROM ingest_profile WHERE id = $1 RETURNING id",
        [id],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Profile not found" };
      }

      return { success: true, message: "Ingest profile deleted" };
    })

    // ============================================================
    // Assign a profile to a device
    // ============================================================
    .post("/:id/assign", async ({ params, body }) => {
      const profileId = Number(params.id);
      const b = body as any;
      const deviceId = Number(b.device_id);

      if (!deviceId) {
        return { success: false, error: "device_id is required" };
      }

      const result = await db.query(
        `UPDATE device_registry SET ingest_profile_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, device_key, ingest_profile_id`,
        [profileId, deviceId],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Device not found" };
      }

      return {
        success: true,
        data: result.rows[0],
        message: "Profile assigned to device",
      };
    })

    // ============================================================
    // Preview routing for a device (what v_device_ingest_routing resolves)
    // ============================================================
    .get("/preview/:deviceId", async ({ params }) => {
      const deviceId = Number(params.deviceId);

      const result = await db.query(
        `SELECT
          device_id, device_key,
          organization_id, team_id,
          ingest_profile_id, ingest_profile_name,
          influxdb_config_id, influxdb_write_enabled, influxdb_require_ack,
          influxdb_host, influxdb_port, influxdb_bucket, influxdb_measurement,
          redis_config_id, redis_write_enabled, redis_max_hash_entries,
          redis_host, redis_port, redis_key_prefix,
          nats_config_id, nats_write_enabled, nats_url, nats_subject_prefix
        FROM v_device_ingest_routing
        WHERE device_id = $1`,
        [deviceId],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Device not found in routing view" };
      }

      return { success: true, data: result.rows[0] };
    });
}
