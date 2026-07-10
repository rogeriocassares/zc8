import * as crypto from "crypto";
import { Elysia, t } from "elysia";
import type { NatsConnection } from "nats";
import type { Pool } from "pg";
import type { DeviceJWTHandler } from "../lib/device-jwt";

// ============================================================
// Legacy device & dropdown routes — /api/tenants/*, /api/vendors/*, etc.
// These use the raw pgPool for backwards compatibility.
// ============================================================
export function createLegacyDeviceRoutes(
  pgPool: Pool,
  jwtHandler: DeviceJWTHandler,
) {
  return (
    new Elysia({ name: "legacy-device-routes" })

      // ---- Dropdown / reference endpoints ----

      .get("/api/device-types", async () => {
        try {
          const result = await pgPool.query(
            `SELECT id, name, description FROM device_types ORDER BY name ASC`,
          );
          return { success: true, device_types: result.rows };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/vendors", async () => {
        try {
          const result = await pgPool.query(
            `SELECT id, name, description, vendor_type FROM vendor_registry ORDER BY name ASC`,
          );
          return { success: true, vendors: result.rows };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/vendors/device", async () => {
        try {
          const result = await pgPool.query(
            `SELECT id, name, description, vendor_type FROM vendor_registry WHERE vendor_type = 'device_vendor' ORDER BY name ASC`,
          );
          return { success: true, vendors: result.rows };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/vendors/lns", async () => {
        try {
          const result = await pgPool.query(
            `SELECT id, name, description, vendor_type FROM vendor_registry WHERE vendor_type = 'lns_vendor' ORDER BY name ASC`,
          );
          return { success: true, vendors: result.rows };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/vendors/:vendor_id/models", async ({ params }) => {
        try {
          const vendorId = parseInt(params.vendor_id, 10);
          if (Number.isNaN(vendorId))
            return { success: false, error: "Invalid vendor_id" };

          const result = await pgPool.query(
            `SELECT vmm.model_name, dt.id, dt.name, dt.protocol, dt.requires_deveui
           FROM vendor_models_mapping vmm
           JOIN device_types dt ON vmm.device_type_id = dt.id
           WHERE vmm.vendor_id = $1
           ORDER BY vmm.model_name ASC, dt.id ASC`,
            [vendorId],
          );

          const modelMap = new Map<
            string,
            Array<{
              id: number;
              name: string;
              protocol: string;
              requires_deveui: boolean;
            }>
          >();
          result.rows.forEach(
            (row: {
              model_name: string;
              id: number;
              name: string;
              protocol: string;
              requires_deveui: boolean;
            }) => {
              if (!modelMap.has(row.model_name))
                modelMap.set(row.model_name, []);
              const existingEntry = modelMap.get(row.model_name);
              if (existingEntry) {
                existingEntry.push({
                  id: row.id,
                  name: row.name,
                  protocol: row.protocol,
                  requires_deveui: row.requires_deveui,
                });
              }
            },
          );

          const models = Array.from(modelMap.entries()).map(
            ([name, device_types]) => ({ name, device_types }),
          );

          return {
            success: true,
            models:
              models.length > 0
                ? models
                : (
                  await pgPool.query(
                    `SELECT DISTINCT model FROM device_registry WHERE vendor_id = $1 AND model IS NOT NULL ORDER BY model ASC`,
                    [vendorId],
                  )
                ).rows.map((row: { model: string }) => ({
                  name: row.model,
                  device_types: [],
                })),
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get(
        "/api/vendors/:vendor_id/models/:model/device-types",
        async ({ params }) => {
          try {
            const vendorId = parseInt(params.vendor_id, 10);
            if (Number.isNaN(vendorId))
              return { success: false, error: "Invalid vendor_id" };

            const result = await pgPool.query(
              `SELECT DISTINCT dt.id, dt.name, dt.protocol, dt.requires_deveui
           FROM vendor_models_mapping vmm
           JOIN device_types dt ON vmm.device_type_id = dt.id
           WHERE vmm.vendor_id = $1 AND vmm.model_name = $2
           ORDER BY dt.name ASC`,
              [vendorId, params.model],
            );
            return { success: true, device_types: result.rows };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
      )

      .get("/api/organizations/:org_id/teams", async ({ params }) => {
        try {
          const orgId = BigInt(params.org_id);
          const result = await pgPool.query(
            `SELECT id, name, description FROM teams WHERE organization_id = $1 ORDER BY name ASC`,
            [orgId],
          );
          return { success: true, teams: result.rows };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/lns-adapters", async () => {
        try {
          const result = await pgPool.query(`
          SELECT DISTINCT device_type_id,
            CASE
              WHEN device_type_id = 1001 THEN 'ChirpStack'
              WHEN device_type_id = 1002 THEN 'TTN'
              WHEN device_type_id = 1003 THEN 'Helium'
              ELSE 'Unknown'
            END as name
          FROM device_registry
          WHERE device_type_id IN (1001, 1002, 1003)
          ORDER BY name ASC`);
          return {
            success: true,
            lns_adapters: result.rows.map(
              (row: { device_type_id: number; name: string }) => ({
                id: row.device_type_id,
                name: row.name,
              }),
            ),
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/parsers", async () => {
        try {
          const result = await pgPool.query(
            `SELECT id, name, description FROM parser_registry ORDER BY name ASC`,
          );
          return { success: true, parsers: result.rows };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      // ---- Tenant device CRUD ----

      .get("/api/tenants/:tenant_id/devices", async ({ params, query }) => {
        try {
          const tenantId = parseInt(params.tenant_id, 10);
          if (Number.isNaN(tenantId)) {
            return {
              success: false,
              error: `Invalid tenant ID: ${params.tenant_id}`,
            };
          }

          const deviceType = query.device_type as string | undefined;
          const status = query.status as string | undefined;

          let sql = `SELECT id, uuid, tenant_id, device_type_id, device_id, deveui,
                          jwt_secret_hash, vendor_id, model, parser_id, origin, status,
                          device_version, created_at, updated_at, metadata
                   FROM device_registry
                   WHERE tenant_id = $1`;
          const params_arr: (number | string)[] = [tenantId];

          if (deviceType) {
            sql += ` AND device_type_id = $${params_arr.length + 1}`;
            params_arr.push(deviceType);
          }
          if (status) {
            sql += ` AND status = $${params_arr.length + 1}`;
            params_arr.push(status);
          }
          sql += ` ORDER BY created_at DESC`;

          const result = await pgPool.query(sql, params_arr);
          return result.rows;
        } catch (err) {
          console.error("Get devices error:", err);
          return { success: false, error: (err as Error).message };
        }
      })

      .get("/api/tenants/:tenant_id/devices/:device_id", async ({ params }) => {
        try {
          const tenantId = BigInt(params.tenant_id);
          const deviceId = params.device_id;

          const result = await pgPool.query(
            `SELECT id, tenant_id, device_key, deveui, uuidv7, device_type,
                  vendor_id, model, parser_id, origin, status, device_version,
                  created_at, updated_at, metadata
           FROM device_registry_with_tenant
           WHERE tenant_id = $1 AND id = $2`,
            [tenantId, BigInt(deviceId)],
          );

          if (result.rows.length === 0)
            return { success: false, error: "Device not found" };
          return { success: true, device: result.rows[0] };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      })

      .post(
        "/api/tenants/:tenant_id/devices",
        async ({ params, body }) => {
          try {
            let tenantId: bigint;
            try {
              tenantId = BigInt(params.tenant_id);
            } catch {
              return {
                success: false,
                error: "Invalid tenant_id: must be a number",
              };
            }

            const {
              device_type_id = 1001,
              deveui,
              vendor_id,
              model,
              parser_id,
              team_id,
              tags = [],
              origin,
              metadata = {},
            } = body;

            const orgCheck = await pgPool.query(
              "SELECT id FROM organizations WHERE id = $1",
              [tenantId],
            );
            if (orgCheck.rows.length === 0)
              return { success: false, error: "Tenant/Organization not found" };

            if (team_id) {
              let parsedTeamId: bigint;
              try {
                parsedTeamId = BigInt(team_id);
              } catch {
                return { success: false, error: "Invalid team_id" };
              }
              const teamCheck = await pgPool.query(
                "SELECT id FROM teams WHERE id = $1 AND organization_id = $2",
                [parsedTeamId, tenantId],
              );
              if (teamCheck.rows.length === 0) {
                return {
                  success: false,
                  error:
                    "Team not found or doesn't belong to this organization",
                };
              }
            }

            if (vendor_id) {
              const vendorCheck = await pgPool.query(
                "SELECT id FROM vendor_registry WHERE id = $1",
                [vendor_id],
              );
              if (vendorCheck.rows.length === 0)
                return { success: false, error: "Vendor not found" };
            }

            if (parser_id) {
              const parserCheck = await pgPool.query(
                "SELECT id FROM parser_registry WHERE id = $1",
                [parser_id],
              );
              if (parserCheck.rows.length === 0)
                return { success: false, error: "Parser not found" };
            }

            const deviceUuid = crypto.randomUUID();

            // Compute device_key using lower 46 bits from UUID (stays within signed 64-bit)
            let computedDeviceKey = 0n;
            for (let i = 19; i < 23; i++) {
              const c = deviceUuid[i];
              const charCode = c.charCodeAt(0);
              const v: number =
                charCode >= 48 && charCode <= 57
                  ? charCode - 48
                  : charCode >= 97 && charCode <= 102
                    ? charCode - 97 + 10
                    : charCode >= 65 && charCode <= 70
                      ? charCode - 65 + 10
                      : 0;
              computedDeviceKey = (computedDeviceKey << 4n) | BigInt(v);
            }
            computedDeviceKey = computedDeviceKey & 0x3fffffffffffn;

            const jwtSecret = crypto.randomBytes(32);
            const jwtSecretHash = crypto
              .createHash("sha256")
              .update(jwtSecret)
              .digest("hex");

            const result = await pgPool.query(
              `INSERT INTO device_registry (
              device_id, device_key, tenant_id, deveui, device_type_id,
              vendor_id, model, parser_id, origin, jwt_secret_hash,
              team_id, tags, is_active, metadata, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active')
            RETURNING id, device_id, device_key, deveui, device_type_id,
                      vendor_id, model, parser_id, origin, team_id,
                      tags, is_active, status, created_at, updated_at`,
              [
                deviceUuid,
                computedDeviceKey,
                tenantId,
                deveui || null,
                device_type_id,
                vendor_id || null,
                model || null,
                parser_id || null,
                origin || null,
                jwtSecretHash,
                team_id ? BigInt(team_id) : null,
                JSON.stringify(tags),
                true,
                JSON.stringify(metadata),
              ],
            );

            const device = result.rows[0];
            const token = jwtHandler.generateToken(
              deviceUuid,
              tenantId,
              String(computedDeviceKey),
              24,
            );

            return {
              success: true,
              device: { ...device, device_key: device.device_key.toString() },
              jwt: { token, expires_in_hours: 24 },
              message: "Device created successfully with auto-generated IDs",
            };
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to create device";
            console.error("Device creation error:", error);
            return { success: false, error: message };
          }
        },
        {
          body: t.Object({
            device_type_id: t.Optional(t.Number()),
            deveui: t.Optional(t.String()),
            vendor_id: t.Optional(t.Union([t.Number(), t.String()])),
            model: t.Optional(t.String()),
            parser_id: t.Optional(t.Union([t.Number(), t.String()])),
            organization_id: t.Optional(t.Union([t.Number(), t.String()])),
            team_id: t.Optional(t.Union([t.Number(), t.String()])),
            tags: t.Optional(t.Array(t.String())),
            origin: t.Optional(t.String()),
            metadata: t.Optional(t.Object({})),
          }),
        },
      )

      .put(
        "/api/tenants/:tenant_id/devices/:device_id",
        async ({ params, body }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const deviceId = BigInt(params.device_id);
            const {
              model,
              vendor_id,
              parser_id,
              origin,
              status,
              metadata,
              deveui,
            } = body;

            const updateFields: string[] = [];
            const updateValues: unknown[] = [];
            let paramIndex = 1;

            if (model !== undefined) {
              updateFields.push(`model = $${paramIndex++}`);
              updateValues.push(model);
            }
            if (vendor_id !== undefined) {
              updateFields.push(`vendor_id = $${paramIndex++}`);
              updateValues.push(vendor_id);
            }
            if (parser_id !== undefined) {
              updateFields.push(`parser_id = $${paramIndex++}`);
              updateValues.push(parser_id);
            }
            if (origin !== undefined) {
              updateFields.push(`origin = $${paramIndex++}`);
              updateValues.push(origin);
            }
            if (status !== undefined) {
              updateFields.push(`status = $${paramIndex++}`);
              updateValues.push(status);
            }
            if (deveui !== undefined) {
              updateFields.push(`deveui = $${paramIndex++}`);
              updateValues.push(deveui);
            }
            if (metadata !== undefined) {
              updateFields.push(`metadata = $${paramIndex++}`);
              updateValues.push(JSON.stringify(metadata));
            }

            if (updateFields.length === 0)
              return { success: false, error: "No fields to update" };

            updateValues.push(tenantId, deviceId);

            await pgPool.query(
              "ALTER TABLE device_registry DISABLE TRIGGER trigger_device_registry_audit",
            );
            const sql = `UPDATE device_registry
                       SET ${updateFields.join(", ")}, device_version = device_version + 1, updated_at = NOW()
                       WHERE tenant_id = $${paramIndex} AND id = $${paramIndex + 1}
                       RETURNING id, uuid, tenant_id, device_type_id, device_id, deveui,
                                 jwt_secret_hash, vendor_id, model, parser_id, origin, status,
                                 device_version, created_at, updated_at, metadata`;
            const result = await pgPool.query(sql, updateValues);
            await pgPool.query(
              "ALTER TABLE device_registry ENABLE TRIGGER trigger_device_registry_audit",
            );

            if (result.rows.length === 0)
              return { success: false, error: "Device not found" };
            return {
              success: true,
              device: result.rows[0],
              message: "Device updated successfully",
            };
          } catch (err) {
            try {
              await pgPool.query(
                "ALTER TABLE device_registry ENABLE TRIGGER trigger_device_registry_audit",
              );
            } catch { }
            return { success: false, error: (err as Error).message };
          }
        },
        {
          body: t.Partial(
            t.Object({
              model: t.String(),
              vendor_id: t.Number(),
              parser_id: t.Number(),
              origin: t.String(),
              status: t.String(),
              deveui: t.String(),
              metadata: t.Object({}, { additionalProperties: true }),
            }),
          ),
        },
      )

      .delete(
        "/api/tenants/:tenant_id/devices/:device_id",
        async ({ params }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const deviceId = BigInt(params.device_id);
            const result = await pgPool.query(
              `UPDATE device_registry SET status = 'inactive', updated_at = NOW()
           WHERE tenant_id = $1 AND id = $2 RETURNING id, device_key, status`,
              [tenantId, deviceId],
            );
            if (result.rows.length === 0)
              return { success: false, error: "Device not found" };
            return {
              success: true,
              message: "Device deactivated successfully",
            };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
      )

      // ---- Device JWT endpoints ----

      .post(
        "/api/tenants/:tenant_id/devices/:device_id/jwt",
        async ({ params, body }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const deviceId = BigInt(params.device_id);
            const { expires_in_hours = 24 } = body;

            const result = await pgPool.query(
              `SELECT device_key FROM device_registry WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
              [tenantId, deviceId],
            );
            if (result.rows.length === 0)
              return { success: false, error: "Device not found or inactive" };

            const deviceKey = result.rows[0].device_key;
            const token = jwtHandler.generateToken(
              deviceId.toString(),
              tenantId,
              deviceKey,
              expires_in_hours,
            );
            return {
              success: true,
              jwt: {
                token,
                expires_in_hours,
                expires_at:
                  Math.floor(Date.now() / 1000) + expires_in_hours * 3600,
              },
            };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
        {
          body: t.Partial(
            t.Object({
              expires_in_hours: t.Number({ minimum: 1, maximum: 8760 }),
            }),
          ),
        },
      )

      .post(
        "/api/devices/jwt/validate",
        async ({ body }) => {
          try {
            const { token } = body;
            const claims = jwtHandler.validateToken(token);
            if (!claims)
              return { success: false, error: "Invalid or expired token" };
            return { success: true, claims };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
        { body: t.Object({ token: t.String() }) },
      )

      // ---- LoRaWAN LNS endpoints ----

      .post(
        "/api/tenants/:tenant_id/devices/lns",
        async ({ params, body }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const {
              device_id,
              device_key,
              deveui,
              activation_mode = "OTAA",
              appkey,
              nwkskey,
              appskey,
              network_server_id,
              application_id,
              device_profile_id,
              class: lora_class = "A",
              adr_enabled = true,
              tx_power_idx = 0,
              dr_min = 0,
              dr_max = 5,
            } = body;

            const tenantCheck = await pgPool.query(
              "SELECT id FROM organizations WHERE id = $1",
              [tenantId],
            );
            if (tenantCheck.rows.length === 0)
              return { success: false, error: "Tenant not found" };

            const uuidv7 = crypto.randomUUID();
            const jwtSecret = crypto.randomBytes(32);
            const jwtSecretHash = crypto
              .createHash("sha256")
              .update(jwtSecret)
              .digest("hex");
            const apiKeyHash = crypto.randomBytes(16).toString("hex");

            const deviceResult = await pgPool.query(
              `INSERT INTO device_registry (
              tenant_id, device_key, deveui, uuidv7, device_type_id,
              vendor_id, model, parser_id, origin, api_key_hash, jwt_secret_hash, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
            RETURNING id`,
              [
                tenantId,
                device_key,
                deveui,
                uuidv7,
                1001,
                1,
                "LoRaWAN Device",
                101,
                "lorawan_chirpstack",
                apiKeyHash,
                jwtSecretHash,
              ],
            );
            const deviceRegistryId = deviceResult.rows[0].id;

            await pgPool.query(
              `INSERT INTO device_lns (
              device_id, tenant_id, deveui, activation_mode, appkey, nwkskey, appskey,
              network_server_id, application_id, device_profile_id, lorawan_class,
              adr_enabled, tx_power_idx, dr_min, dr_max, sync_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')`,
              [
                deviceRegistryId,
                tenantId,
                deveui,
                activation_mode,
                appkey || null,
                nwkskey || null,
                appskey || null,
                network_server_id,
                application_id,
                device_profile_id || null,
                lora_class,
                adr_enabled,
                tx_power_idx,
                dr_min,
                dr_max,
              ],
            );

            const token = jwtHandler.generateToken(
              device_id,
              tenantId,
              device_key,
              24,
            );
            return {
              success: true,
              device: {
                id: deviceRegistryId,
                device_id,
                deveui,
                activation_mode,
                network_server_id,
                application_id,
                status: "active",
              },
              jwt: { token, expires_in_hours: 24 },
              message: "LoRaWAN device created successfully",
            };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
        {
          body: t.Object({
            device_id: t.String(),
            device_key: t.String(),
            deveui: t.String(),
            activation_mode: t.Optional(t.Enum({ OTAA: "OTAA", ABP: "ABP" })),
            appkey: t.Optional(t.String()),
            nwkskey: t.Optional(t.String()),
            appskey: t.Optional(t.String()),
            network_server_id: t.Number(),
            application_id: t.Number(),
            device_profile_id: t.Optional(t.String()),
            class: t.Optional(t.Enum({ A: "A", B: "B", C: "C" })),
            adr_enabled: t.Optional(t.Boolean()),
            tx_power_idx: t.Optional(t.Number()),
            dr_min: t.Optional(t.Number()),
            dr_max: t.Optional(t.Number()),
          }),
        },
      )

      .get(
        "/api/tenants/:tenant_id/devices/lns/:deveui",
        async ({ params }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const result = await pgPool.query(
              `SELECT dr.id, dr.device_key, dr.status, dr.created_at,
                  dl.deveui, dl.activation_mode, dl.network_server_id,
                  dl.application_id, dl.lorawan_class, dl.adr_enabled, dl.sync_status
           FROM device_registry dr
           JOIN device_lns dl ON dr.id = dl.device_id
           WHERE dr.tenant_id = $1 AND dl.deveui = $2`,
              [tenantId, params.deveui],
            );
            if (result.rows.length === 0)
              return { success: false, error: "Device not found" };
            return { success: true, device: result.rows[0] };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
      )

      .put(
        "/api/tenants/:tenant_id/devices/lns/:device_id",
        async ({ params, body }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const deviceId = BigInt(params.device_id);
            const { activation_mode, appkey, nwkskey, appskey, sync_status } =
              body;

            const updateFields: string[] = [];
            const updateValues: unknown[] = [];
            let paramIndex = 1;

            if (activation_mode !== undefined) {
              updateFields.push(`activation_mode = $${paramIndex++}`);
              updateValues.push(activation_mode);
            }
            if (appkey !== undefined) {
              updateFields.push(`appkey = $${paramIndex++}`);
              updateValues.push(appkey);
            }
            if (nwkskey !== undefined) {
              updateFields.push(`nwkskey = $${paramIndex++}`);
              updateValues.push(nwkskey);
            }
            if (appskey !== undefined) {
              updateFields.push(`appskey = $${paramIndex++}`);
              updateValues.push(appskey);
            }
            if (sync_status !== undefined) {
              updateFields.push(`sync_status = $${paramIndex++}`);
              updateValues.push(sync_status);
            }

            if (updateFields.length === 0)
              return { success: false, error: "No fields to update" };
            updateValues.push(tenantId, deviceId);

            const result = await pgPool.query(
              `UPDATE device_lns SET ${updateFields.join(", ")}, updated_at = NOW()
             WHERE tenant_id = $${paramIndex} AND device_id = $${paramIndex + 1}
             RETURNING *`,
              updateValues,
            );
            if (result.rows.length === 0)
              return { success: false, error: "Device not found" };
            return {
              success: true,
              device: result.rows[0],
              message: "LNS device updated successfully",
            };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
        {
          body: t.Partial(
            t.Object({
              activation_mode: t.Enum({ OTAA: "OTAA", ABP: "ABP" }),
              appkey: t.String(),
              nwkskey: t.String(),
              appskey: t.String(),
              sync_status: t.Enum({
                pending: "pending",
                synced: "synced",
                error: "error",
              }),
            }),
          ),
        },
      )

      // ---- Stats & monitoring ----

      .get(
        "/api/tenants/:tenant_id/devices/stats/summary",
        async ({ params }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const result = await pgPool.query(
              `SELECT
             COUNT(*) as total_devices,
             COUNT(CASE WHEN status = 'active' THEN 1 END) as active_devices,
             COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_devices,
             COUNT(DISTINCT device_type_id) as device_types,
             COUNT(DISTINCT vendor_id) as vendors,
             MAX(device_version) as latest_version
           FROM device_registry WHERE tenant_id = $1`,
              [tenantId],
            );
            return { success: true, stats: result.rows[0] };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
      )

      // ---- Change history ----

      .get(
        "/api/tenants/:tenant_id/devices/:device_id/changelog",
        async ({ params, query }) => {
          try {
            const tenantId = BigInt(params.tenant_id);
            const deviceId = BigInt(params.device_id);
            const limit = parseInt(query.limit as string) || 50;
            const result = await pgPool.query(
              `SELECT id, device_id, change_type, old_data, new_data,
                    changed_by, changed_at, version
             FROM device_registry_changelog
             WHERE tenant_id = $1 AND device_id = $2
             ORDER BY changed_at DESC LIMIT $3`,
              [tenantId, deviceId, limit],
            );
            return {
              success: true,
              changes: result.rows,
              count: result.rows.length,
            };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        },
      )

      // ---- Device change stream (SSE via PostgreSQL LISTEN) ----

      .get(
        "/api/tenants/:tenant_id/devices/changes/stream",
        async ({ params, set }) => {
          set.headers["Content-Type"] = "text/event-stream";
          set.headers["Cache-Control"] = "no-cache";
          set.headers["Connection"] = "keep-alive";

          const tenantId = params.tenant_id;
          const channelName = `device_registry_${tenantId}`;

          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(`data: {"status":"connected"}\n\n`);
              try {
                const listenQuery = `LISTEN "${channelName}"`;
                await pgPool.query(listenQuery);

                const pollInterval = setInterval(async () => {
                  try {
                    const result = await pgPool.query(
                      `SELECT pg_get_notifications() as notification`,
                    );
                    if (result.rows.length > 0) {
                      controller.enqueue(
                        `data: ${JSON.stringify(result.rows[0])}\n\n`,
                      );
                    }
                  } catch (err) {
                    controller.enqueue(
                      `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`,
                    );
                  }
                }, 1000);

                const signal = (
                  controller as unknown as { signal?: AbortSignal }
                ).signal;
                if (signal) {
                  signal.addEventListener("abort", () => {
                    clearInterval(pollInterval);
                    controller.close();
                  });
                }
              } catch (err) {
                controller.enqueue(
                  `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`,
                );
                controller.close();
              }
            },
          });
          return stream;
        },
        { response: t.Unknown() },
      )
  );
}

// ============================================================
// NATS telemetry SSE — GET /events
// ============================================================
export function createEventsRoutes(nc: NatsConnection | null) {
  return new Elysia({ name: "events-routes" }).get(
    "/events",
    async ({ set }) => {
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["Connection"] = "keep-alive";

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(`data: {"status":"connected"}\n\n`);

          let isAborted = false;
          const signal = (controller as unknown as { signal?: AbortSignal })
            .signal;
          if (signal?.aborted) {
            isAborted = true;
          } else if (signal) {
            signal.addEventListener("abort", () => {
              isAborted = true;
            });
          }

          const read = async () => {
            if (!nc) {
              controller.enqueue(
                `data: ${JSON.stringify({ error: "NATS not available" })}\n\n`,
              );
              controller.close();
              return;
            }
            const sub = nc.subscribe("telemetry.raw.>");
            if (signal) {
              signal.addEventListener("abort", () => {
                sub.drain().catch(() => { });
              });
            }
            for await (const msg of sub) {
              if (isAborted) break;
              try {
                controller.enqueue(
                  `data: ${new TextDecoder().decode(msg.data)}\n\n`,
                );
              } catch (err) {
                controller.enqueue(
                  `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`,
                );
              }
            }
            controller.close();
          };
          read();
        },
      });
      return stream;
    },
    { response: t.Unknown() },
  );
}
