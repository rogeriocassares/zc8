/**
 * Device Management API Routes
 *
 * Endpoints for managing:
 * - Device registry (LoRaWAN, MQTT, etc.)
 * - Device identifiers (EUI, MAC address)
 * - Device activation and status
 * - Team-level provider bindings
 */

import * as crypto from "crypto";
import { Elysia, t } from "elysia";
import type { Database } from "../lib/adapter-types";

interface DeviceCreateRequest {
  device_model_id: number;
  eui?: string; // For LoRaWAN devices
  mac_address?: string; // For non-LoRaWAN devices
  organization_id: number;
  team_id: number;
  lns_provider_id?: number;
  is_public?: boolean;
  is_active?: boolean;
  is_global?: boolean;
  metadata?: Record<string, any>;
}

interface DeviceUpdateRequest {
  eui?: string;
  mac_address?: string;
  lns_provider_id?: number;
  is_public?: boolean;
  is_active?: boolean;
  is_global?: boolean;
  connection_status?: string;
  metadata?: Record<string, any>;
}

/**
 * Generate a cryptographically secure device key
 * Format: DV-{timestamp}-{random}
 */
function generateDeviceKey(): string {
  const timestamp = Date.now().toString(36); // base36 timestamp
  const random = crypto.randomBytes(8).toString("hex").slice(0, 12); // 12 char random
  return `DV-${timestamp}-${random}`;
}

/**
 * Validate device identifier based on device protocol type
 */
async function validateDeviceIdentifier(
  db: Database,
  deviceModelId: number,
  eui?: string,
  macAddress?: string,
): Promise<{ valid: boolean; error?: string }> {
  // Get device type
  const model = await db.queryOne(
    `SELECT dm.id, dm.device_type_id, dt.name as type_name, dt.protocol
     FROM device_models dm
     JOIN device_types dt ON dm.device_type_id = dt.id
     WHERE dm.id = $1`,
    [deviceModelId],
  );

  if (!model) {
    return { valid: false, error: "Device model not found" };
  }

  if (model.type_name === "LoRaWAN") {
    if (!eui) {
      return { valid: false, error: "LoRaWAN devices require EUI" };
    }
    if (!/^[0-9A-Fa-f]{16}$/.test(eui)) {
      return {
        valid: false,
        error: "EUI must be 16 hexadecimal characters (8 bytes)",
      };
    }
  } else {
    if (!macAddress) {
      return { valid: false, error: "Non-LoRaWAN devices require MAC address" };
    }
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(macAddress)) {
      return {
        valid: false,
        error: "MAC address format must be XX:XX:XX:XX:XX:XX",
      };
    }
  }

  return { valid: true };
}

export function createDeviceRoutes(db: Database) {
  return (
    new Elysia({ prefix: "/api/v1/devices" })
      // ============================================================
      // Device CRUD Endpoints
      // ============================================================

      /**
       * List all devices in an organization or team
       * Query params: org_id (required), team_id (optional)
       */
      .get("/", async (ctx) => {
        const { org_id, team_id } = ctx.query as any;

        if (!org_id) {
          return { success: false, error: "org_id query parameter required" };
        }

        let query = `
        SELECT 
          id, device_key, device_model_id, 
          device_type, device_protocol,
          eui, mac_address, 
          device_identifier, identifier_field,
          organization_id, team_id,
          lns_provider_id, is_public, is_active, is_global,
          connection_status, last_heartbeat,
          created_at, updated_at
        FROM device_registry_with_type
        WHERE organization_id = $1
      `;

        const params: any[] = [org_id];

        if (team_id) {
          query += " AND team_id = $2";
          params.push(team_id);
        }

        query += " ORDER BY created_at DESC";

        const devices = await db.query(query, params);

        return {
          success: true,
          data: devices,
          total: devices.length,
        };
      })

      /**
       * Get a single device by ID
       */
      .get("/:device_id", async (ctx) => {
        const { device_id } = ctx.params;

        const device = await db.queryOne(
          `SELECT 
          id, device_key, device_model_id, 
          device_type, device_protocol,
          eui, mac_address, 
          device_identifier, identifier_field,
          organization_id, team_id,
          lns_provider_id, is_public, is_active, is_global,
          connection_status, last_heartbeat,
          metadata, created_at, updated_at
        FROM device_registry_with_type
        WHERE id = $1`,
          [device_id],
        );

        if (!device) {
          return { success: false, error: "Device not found" };
        }

        return { success: true, data: device };
      })

      /**
       * Get device by identifier (EUI or MAC)
       */
      .get("/identifier/:identifier", async (ctx) => {
        const { identifier, org_id } = ctx.params as any;

        if (!identifier) {
          return { success: false, error: "Identifier required" };
        }

        // Try to find by EUI or MAC
        let query = `
        SELECT 
          id, device_key, device_model_id, 
          device_type, device_protocol,
          eui, mac_address, 
          device_identifier, identifier_field,
          organization_id, team_id,
          lns_provider_id, is_public, is_active, is_global,
          connection_status, last_heartbeat,
          metadata, created_at, updated_at
        FROM device_registry_with_type
        WHERE (eui = $1 OR mac_address = $1)
      `;

        const params: any[] = [identifier];

        if (org_id) {
          query += " AND organization_id = $2";
          params.push(org_id);
        }

        const device = await db.queryOne(query, params);

        if (!device) {
          return { success: false, error: "Device not found" };
        }

        return { success: true, data: device };
      })

      /**
       * Create a new device
       */
      .post(
        "/",
        async (ctx) => {
          const {
            device_model_id,
            eui,
            mac_address,
            organization_id,
            team_id,
            lns_provider_id,
            is_public,
            is_active,
            is_global,
            metadata,
          } = ctx.body as DeviceCreateRequest;

          // Validate device model
          const model = await db.queryOne(
            "SELECT id FROM device_models WHERE id = $1",
            [device_model_id],
          );

          if (!model) {
            return { success: false, error: "Device model not found" };
          }

          // Validate team belongs to organization
          const team = await db.queryOne(
            "SELECT id FROM teams WHERE id = $1 AND organization_id = $2",
            [team_id, organization_id],
          );

          if (!team) {
            return {
              success: false,
              error: "Team does not belong to organization",
            };
          }

          // Validate device identifier
          const identifierValidation = await validateDeviceIdentifier(
            db,
            device_model_id,
            eui,
            mac_address,
          );

          if (!identifierValidation.valid) {
            return {
              success: false,
              error: identifierValidation.error,
            };
          }

          // Generate unique device key
          const deviceKey = generateDeviceKey();

          try {
            const result = await db.query(
              `INSERT INTO device_registry 
             (device_key, device_model_id, eui, mac_address, created_by, 
              organization_id, team_id, lns_provider_id, is_public, is_active, 
              is_global, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id, device_key, created_at`,
              [
                deviceKey,
                device_model_id,
                eui || null,
                mac_address || null,
                ctx.headers["user-id"] ||
                "00000000-0000-0000-0000-000000000000",
                organization_id,
                team_id,
                lns_provider_id || null,
                is_public || false,
                is_active !== false,
                is_global || false,
                JSON.stringify(metadata || {}),
              ],
            );

            return {
              success: true,
              data: result[0],
              message: "Device created successfully",
            };
          } catch (error: any) {
            // Handle constraint violations
            if (error.message.includes("unique")) {
              return {
                success: false,
                error: "Device identifier or key already exists",
              };
            }
            if (error.message.includes("Team")) {
              return {
                success: false,
                error: "Team does not belong to organization",
              };
            }
            throw error;
          }
        },
        {
          body: t.Object({
            device_model_id: t.Number(),
            eui: t.Optional(t.String()),
            mac_address: t.Optional(t.String()),
            organization_id: t.Number(),
            team_id: t.Number(),
            lns_provider_id: t.Optional(t.Number()),
            is_public: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
            is_global: t.Optional(t.Boolean()),
            metadata: t.Optional(t.Any()),
          }),
        },
      )

      /**
       * Update device
       */
      .put(
        "/:device_id",
        async (ctx) => {
          const { device_id } = ctx.params;
          const updates = ctx.body as DeviceUpdateRequest;

          // Get current device
          const device = await db.queryOne(
            `SELECT device_model_id, organization_id, team_id 
           FROM device_registry
           WHERE id = $1`,
            [device_id],
          );

          if (!device) {
            return { success: false, error: "Device not found" };
          }

          // Validate identifier if being updated
          if (updates.eui !== undefined || updates.mac_address !== undefined) {
            const identifierValidation = await validateDeviceIdentifier(
              db,
              device.device_model_id,
              updates.eui,
              updates.mac_address,
            );

            if (!identifierValidation.valid) {
              return {
                success: false,
                error: identifierValidation.error,
              };
            }
          }

          // Build dynamic update query
          const updateFields: string[] = [];
          const updateValues: any[] = [];
          let paramCount = 1;

          if (updates.eui !== undefined) {
            updateFields.push(`eui = $${paramCount++}`);
            updateValues.push(updates.eui || null);
          }

          if (updates.mac_address !== undefined) {
            updateFields.push(`mac_address = $${paramCount++}`);
            updateValues.push(updates.mac_address || null);
          }

          if (updates.lns_provider_id !== undefined) {
            updateFields.push(`lns_provider_id = $${paramCount++}`);
            updateValues.push(updates.lns_provider_id || null);
          }

          if (updates.is_public !== undefined) {
            updateFields.push(`is_public = $${paramCount++}`);
            updateValues.push(updates.is_public);
          }

          if (updates.is_active !== undefined) {
            updateFields.push(`is_active = $${paramCount++}`);
            updateValues.push(updates.is_active);
          }

          if (updates.is_global !== undefined) {
            updateFields.push(`is_global = $${paramCount++}`);
            updateValues.push(updates.is_global);
          }

          if (updates.connection_status !== undefined) {
            updateFields.push(`connection_status = $${paramCount++}`);
            updateValues.push(updates.connection_status);
          }

          if (updates.metadata !== undefined) {
            updateFields.push(`metadata = $${paramCount++}`);
            updateValues.push(JSON.stringify(updates.metadata));
          }

          // Always update last_heartbeat on any update
          updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

          if (updateFields.length === 0) {
            return { success: false, error: "No fields to update" };
          }

          if (updateFields.length === 1) {
            // Only updated_at field, nothing to update
            return { success: false, error: "No fields to update" };
          }

          updateValues.push(device_id);

          try {
            const result = await db.query(
              `UPDATE device_registry 
             SET ${updateFields.join(", ")}
             WHERE id = $${paramCount}
             RETURNING id, device_key, updated_at`,
              updateValues,
            );

            return {
              success: true,
              data: result[0],
              message: "Device updated successfully",
            };
          } catch (error: any) {
            if (error.message.includes("unique")) {
              return {
                success: false,
                error: "Device identifier already exists",
              };
            }
            throw error;
          }
        },
        {
          body: t.Object({
            eui: t.Optional(t.String()),
            mac_address: t.Optional(t.String()),
            lns_provider_id: t.Optional(t.Number()),
            is_public: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
            is_global: t.Optional(t.Boolean()),
            connection_status: t.Optional(t.String()),
            metadata: t.Optional(t.Any()),
          }),
        },
      )

      /**
       * Delete device (soft delete via is_active flag or hard delete via RBAC)
       */
      .delete("/:device_id", async (ctx) => {
        const { device_id } = ctx.params;

        const result = await db.query(
          `UPDATE device_registry 
         SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING id`,
          [device_id],
        );

        if (result.length === 0) {
          return { success: false, error: "Device not found" };
        }

        return {
          success: true,
          message: "Device deleted successfully (soft delete)",
        };
      })

      // ============================================================
      // Team Provider Endpoints
      // ============================================================

      /**
       * Get provider for a device (team level first, org level fallback)
       */
      .get("/:device_id/provider", async (ctx) => {
        const { device_id } = ctx.params;

        const device = await db.queryOne(
          `SELECT team_id, organization_id FROM device_registry WHERE id = $1`,
          [device_id],
        );

        if (!device) {
          return { success: false, error: "Device not found" };
        }

        const provider = await db.queryOne(
          `SELECT * FROM get_device_provider($1, $2)`,
          [device.team_id, device.organization_id],
        );

        if (!provider) {
          return {
            success: false,
            error: "No provider configured for this device",
          };
        }

        return { success: true, data: provider };
      })

      /**
       * Get all team providers for an organization
       */
      .get("/org/:org_id/team-providers", async (ctx) => {
        const { org_id } = ctx.params;

        const providers = await db.query(
          `SELECT 
          tdp.id,
          t.id as team_id,
          t.name as team_name,
          dp.id as provider_id,
          dp.name as provider_name,
          te.id as endpoint_id,
          te.endpoint_url,
          tdp.is_primary,
          tdp.priority,
          tdp.created_at
        FROM team_device_providers tdp
        JOIN teams t ON tdp.team_id = t.id
        JOIN device_providers dp ON tdp.device_provider_id = dp.id
        JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
        WHERE t.organization_id = $1
        ORDER BY t.id, tdp.priority ASC`,
          [org_id],
        );

        return { success: true, data: providers, total: providers.length };
      })

      // ============================================================
      // Device Status & Heartbeat Endpoints
      // ============================================================

      /**
       * Update device heartbeat and connection status
       */
      .post(
        "/:device_id/heartbeat",
        async (ctx) => {
          const { device_id } = ctx.params;
          const { connection_status } = ctx.body as any;

          const result = await db.query(
            `UPDATE device_registry 
           SET last_heartbeat = CURRENT_TIMESTAMP,
               connection_status = COALESCE($2, connection_status),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING id, connection_status, last_heartbeat`,
            [device_id, connection_status || "connected"],
          );

          if (result.length === 0) {
            return { success: false, error: "Device not found" };
          }

          return {
            success: true,
            data: result[0],
            message: "Heartbeat recorded",
          };
        },
        {
          body: t.Optional(
            t.Object({
              connection_status: t.Optional(t.String()),
            }),
          ),
        },
      )

      /**
       * Get device statistics (total count, active count, by team, etc.)
       */
      .get("/stats/summary", async (ctx) => {
        const { org_id } = ctx.query as any;

        if (!org_id) {
          return { success: false, error: "org_id query parameter required" };
        }

        const stats = await db.queryOne(
          `SELECT 
          COUNT(*) as total_devices,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_devices,
          COUNT(CASE WHEN connection_status = 'connected' THEN 1 END) as connected_devices,
          COUNT(CASE WHEN device_type = 'LoRaWAN' THEN 1 END) as lorawan_devices,
          COUNT(CASE WHEN device_type = 'MQTT' THEN 1 END) as mqtt_devices
        FROM device_registry_with_type
        WHERE organization_id = $1`,
          [org_id]
        );

        return {
          success: true,
          data: stats,
        };
      })
  );
}
