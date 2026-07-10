/**
 * Device Management API Routes
 */

import * as crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import {
  deviceModels,
  deviceRegistry,
  deviceSensors,
  deviceVendors,
  teams,
} from "../db/schema";

/** Reference-data routes: device models, vendors, types */
export function createDeviceReferenceRoutes(db: DrizzleDB) {
  return new Elysia({ prefix: "/api/v1" })
    .get("/device-models", async () => {
      const models = await db
        .select({
          id: deviceModels.id,
          name: deviceModels.name,
          code: deviceModels.code,
          description: deviceModels.description,
          vendorName: deviceVendors.name,
          vendorId: deviceVendors.id,
        })
        .from(deviceModels)
        .innerJoin(deviceVendors, eq(deviceModels.vendorId, deviceVendors.id))
        .orderBy(deviceVendors.name, deviceModels.name);

      const data = models.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        description: m.description,
        vendor_name: m.vendorName,
        vendor_id: m.vendorId,
      }));
      return { success: true, data, total: data.length };
    })
    .get("/device-vendors", async () => {
      const vendors = await db
        .select({
          id: deviceVendors.id,
          name: deviceVendors.name,
          code: deviceVendors.code,
          description: deviceVendors.description,
          created_at: deviceVendors.createdAt,
          updated_at: deviceVendors.updatedAt,
        })
        .from(deviceVendors)
        .orderBy(deviceVendors.name);
      return { success: true, data: vendors };
    })

    // Create a device vendor (superAdmin only)
    .post(
      "/device-vendors",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
        if (!auth || auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Super admin access required" };
        }
        const { name, code, description } = ctx.body as { name: string; code: string; description?: string };
        try {
          const [row] = await db
            .insert(deviceVendors)
            .values({ name: name.trim(), code: code.trim().toLowerCase(), description: description ?? null })
            .returning();
          return { success: true, data: row };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("unique")) return { success: false, error: "Vendor code already exists" };
          throw e;
        }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 255 }),
          code: t.String({ minLength: 1, maxLength: 100 }),
          description: t.Optional(t.String()),
        }),
      },
    )

    // Update a device vendor (superAdmin only)
    .put(
      "/device-vendors/:vendor_id",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
        if (!auth || auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Super admin access required" };
        }
        const vendorId = Number(ctx.params.vendor_id);
        const { name, code, description } = ctx.body as { name?: string; code?: string; description?: string };
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (name) updates.name = name.trim();
        if (code) updates.code = code.trim().toLowerCase();
        if (description !== undefined) updates.description = description || null;
        try {
          const result = await db
            .update(deviceVendors)
            .set(updates)
            .where(eq(deviceVendors.id, vendorId))
            .returning();
          if (!result.length) return { success: false, error: "Vendor not found" };
          return { success: true, data: result[0] };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("unique")) return { success: false, error: "Vendor code already exists" };
          throw e;
        }
      },
      {
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
          code: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          description: t.Optional(t.String()),
        }),
      },
    )

    // Delete a device vendor (superAdmin only)
    .delete("/device-vendors/:vendor_id", async (ctx) => {
      const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
      if (!auth || auth.role !== "superAdmin") {
        ctx.set.status = 403;
        return { success: false, error: "Super admin access required" };
      }
      const vendorId = Number(ctx.params.vendor_id);
      const result = await db
        .delete(deviceVendors)
        .where(eq(deviceVendors.id, vendorId))
        .returning({ id: deviceVendors.id });
      if (!result.length) return { success: false, error: "Vendor not found" };
      return { success: true, message: "Vendor deleted" };
    })

    // Create a device model (superAdmin only)
    .post(
      "/device-models",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
        if (!auth || auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Super admin access required" };
        }
        const { vendor_id, name, code, description, device_type } = ctx.body as { vendor_id: number; name: string; code: string; description?: string; device_type?: string };
        try {
          const [row] = await db
            .insert(deviceModels)
            .values({ vendorId: vendor_id, name: name.trim(), code: code.trim().toLowerCase(), description: description ?? null, deviceType: device_type?.trim() ?? "other" })
            .returning();
          return { success: true, data: row };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("unique")) return { success: false, error: "Model code already exists for this vendor" };
          throw e;
        }
      },
      {
        body: t.Object({
          vendor_id: t.Number(),
          name: t.String({ minLength: 1, maxLength: 255 }),
          code: t.String({ minLength: 1, maxLength: 100 }),
          description: t.Optional(t.String()),
          device_type: t.Optional(t.String({ maxLength: 50 })),
        }),
      },
    )

    // Update a device model (superAdmin only)
    .put(
      "/device-models/:model_id",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
        if (!auth || auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Super admin access required" };
        }
        const modelId = Number(ctx.params.model_id);
        const { vendor_id, name, code, description, device_type } = ctx.body as { vendor_id?: number; name?: string; code?: string; description?: string; device_type?: string };
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (vendor_id !== undefined) updates.vendorId = vendor_id;
        if (name) updates.name = name.trim();
        if (code) updates.code = code.trim().toLowerCase();
        if (description !== undefined) updates.description = description || null;
        if (device_type !== undefined) updates.deviceType = device_type.trim();
        try {
          const result = await db
            .update(deviceModels)
            .set(updates)
            .where(eq(deviceModels.id, modelId))
            .returning();
          if (!result.length) return { success: false, error: "Model not found" };
          return { success: true, data: result[0] };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("unique")) return { success: false, error: "Model code already exists for this vendor" };
          throw e;
        }
      },
      {
        body: t.Object({
          vendor_id: t.Optional(t.Number()),
          name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
          code: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          description: t.Optional(t.String()),
          device_type: t.Optional(t.String({ maxLength: 50 })),
        }),
      },
    )

    // Delete a device model (superAdmin only)
    .delete("/device-models/:model_id", async (ctx) => {
      const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
      if (!auth || auth.role !== "superAdmin") {
        ctx.set.status = 403;
        return { success: false, error: "Super admin access required" };
      }
      const modelId = Number(ctx.params.model_id);
      const result = await db
        .delete(deviceModels)
        .where(eq(deviceModels.id, modelId))
        .returning({ id: deviceModels.id });
      if (!result.length) return { success: false, error: "Model not found" };
      return { success: true, message: "Model deleted" };
    })
    .get("/device-types-list", async () => ({
      success: true,
      data: [
        { id: 1, name: "LoRaWAN", protocol: "lorawan" },
        { id: 2, name: "IP / MQTT", protocol: "ip" },
        { id: 3, name: "Other", protocol: "other" },
      ],
    }))

    // ── device sensors (per model) ──────────────────────────────────────────

    // List sensor types for a model
    .get("/device-models/:model_id/sensors", async (ctx) => {
      const modelId = Number(ctx.params.model_id);
      const rows = await db
        .select()
        .from(deviceSensors)
        .where(eq(deviceSensors.deviceModelId, modelId))
        .orderBy(deviceSensors.sensorType);
      return { success: true, data: rows.map((r) => ({ ...r, value_type: r.valueType })) };
    })

    // Add a sensor type to a model
    .post(
      "/device-models/:model_id/sensors",
      async (ctx) => {
        const modelId = Number(ctx.params.model_id);
        const { sensor_type, unit, description, value_type } = ctx.body as {
          sensor_type: string;
          unit?: string;
          description?: string;
          value_type?: string;
        };
        try {
          const [row] = await db
            .insert(deviceSensors)
            .values({
              deviceModelId: modelId,
              sensorType: sensor_type.trim().toLowerCase(),
              unit: unit ?? null,
              description: description ?? null,
              valueType: (value_type ?? "float") as "int" | "float" | "bool" | "string",
            })
            .returning();
          return { success: true, data: row };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("unique"))
            return { success: false, error: "Sensor type already exists for this model" };
          throw e;
        }
      },
      {
        body: t.Object({
          sensor_type: t.String({ minLength: 1, maxLength: 100 }),
          unit: t.Optional(t.String({ maxLength: 50 })),
          description: t.Optional(t.String()),
          value_type: t.Optional(t.Union([t.Literal("int"), t.Literal("float"), t.Literal("bool"), t.Literal("string")])),
        }),
      },
    )

    // Update a sensor entry (e.g. value_type)
    .put(
      "/device-models/:model_id/sensors/:sensor_id",
      async (ctx) => {
        const auth = (ctx as unknown as { auth: { role?: string } | null }).auth;
        if (!auth || auth.role !== "superAdmin") {
          ctx.set.status = 403;
          return { success: false, error: "Super admin access required" };
        }
        const sensorId = Number(ctx.params.sensor_id);
        const modelId = Number(ctx.params.model_id);
        const { value_type } = ctx.body as { value_type?: string };
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (value_type) updates.valueType = value_type;
        const result = await db
          .update(deviceSensors)
          .set(updates)
          .where(and(eq(deviceSensors.id, sensorId), eq(deviceSensors.deviceModelId, modelId)))
          .returning();
        if (!result.length) return { success: false, error: "Sensor not found" };
        return { success: true, data: result[0] };
      },
      {
        body: t.Object({
          value_type: t.Optional(t.Union([t.Literal("int"), t.Literal("float"), t.Literal("bool"), t.Literal("string")])),
        }),
      },
    )

    // Delete a sensor entry
    .delete("/device-models/:model_id/sensors/:sensor_id", async (ctx) => {
      const sensorId = Number(ctx.params.sensor_id);
      const modelId = Number(ctx.params.model_id);
      const result = await db
        .delete(deviceSensors)
        .where(
          and(
            eq(deviceSensors.id, sensorId),
            eq(deviceSensors.deviceModelId, modelId),
          ),
        )
        .returning({ id: deviceSensors.id });
      if (!result.length) return { success: false, error: "Sensor not found" };
      return { success: true, message: "Sensor deleted" };
    })

    // List all distinct sensor types across all models (for app subscription picker)
    .get("/sensor-types", async () => {
      const rows = await db
        .selectDistinct({ sensorType: deviceSensors.sensorType })
        .from(deviceSensors)
        .orderBy(deviceSensors.sensorType);
      return { success: true, data: rows.map((r) => r.sensorType) };
    })

    // List all device models with their sensor types (for device-models tab)
    .get("/device-models-with-sensors", async () => {
      const models = await db
        .select({
          id: deviceModels.id,
          name: deviceModels.name,
          code: deviceModels.code,
          description: deviceModels.description,
          deviceType: deviceModels.deviceType,
          vendorName: deviceVendors.name,
          vendorId: deviceVendors.id,
        })
        .from(deviceModels)
        .innerJoin(deviceVendors, eq(deviceModels.vendorId, deviceVendors.id))
        .orderBy(deviceVendors.name, deviceModels.name);

      const sensors = await db
        .select({
          id: deviceSensors.id,
          deviceModelId: deviceSensors.deviceModelId,
          sensorType: deviceSensors.sensorType,
          unit: deviceSensors.unit,
          description: deviceSensors.description,
          valueType: deviceSensors.valueType,
        })
        .from(deviceSensors)
        .orderBy(deviceSensors.deviceModelId, deviceSensors.sensorType);

      // Build model->sensors map
      const sensorMap = new Map<number, { id: number; sensor_type: string; unit: string | null; description: string | null; value_type: string }[]>();
      for (const s of sensors) {
        if (!sensorMap.has(s.deviceModelId)) sensorMap.set(s.deviceModelId, []);
        const sensorArr = sensorMap.get(s.deviceModelId);
        if (sensorArr) sensorArr.push({
          id: s.id,
          sensor_type: s.sensorType,
          unit: s.unit,
          description: s.description,
          value_type: s.valueType,
        });
      }

      const data = models.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        description: m.description,
        device_type: m.deviceType,
        vendor_name: m.vendorName,
        vendor_id: m.vendorId,
        sensor_types: sensorMap.get(m.id) ?? [],
      }));
      return { success: true, data, total: data.length };
    });
}

function generateDeviceKey(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString("hex").slice(0, 12);
  return `DV-${timestamp}-${random}`;
}

function validateDeviceIdentifier(
  deviceType: string,
  eui?: string,
  macAddress?: string,
): { valid: boolean; error?: string } {
  if (deviceType === "lorawan") {
    if (!eui)
      return { valid: false, error: "LoRaWAN devices require a dev_eui" };
    if (!/^[0-9A-Fa-f]{16}$/.test(eui))
      return {
        valid: false,
        error: "EUI must be 16 hexadecimal characters (8 bytes)",
      };
  } else if (deviceType === "ip") {
    if (!macAddress)
      return { valid: false, error: "IP devices require a MAC address" };
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(macAddress))
      return {
        valid: false,
        error: "MAC address format must be XX:XX:XX:XX:XX:XX",
      };
  }
  return { valid: true };
}

export function createDeviceRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1/devices" })
      .use(requireAuth())

      // List devices with model/vendor info
      .get("/", async (ctx) => {
        const { org_id, team_id } = ctx.query as {
          org_id?: string;
          team_id?: string;
        };

        const conditions = [];
        if (org_id)
          conditions.push(eq(deviceRegistry.organizationId, Number(org_id)));
        if (team_id)
          conditions.push(eq(deviceRegistry.teamId, Number(team_id)));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const devices = await db
          .select({
            id: deviceRegistry.id,
            deviceKey: deviceRegistry.deviceKey,
            deviceModelId: deviceRegistry.deviceModelId,
            deviceType: deviceRegistry.deviceType,
            devEui: deviceRegistry.devEui,
            macAddress: deviceRegistry.macAddress,
            organizationId: deviceRegistry.organizationId,
            teamId: deviceRegistry.teamId,
            isPublic: deviceRegistry.isPublic,
            isActive: deviceRegistry.isActive,
            isGlobal: deviceRegistry.isGlobal,
            isPersistent: deviceRegistry.isPersistent,
            connectionStatus: deviceRegistry.connectionStatus,
            lastHeartbeat: deviceRegistry.lastHeartbeat,
            visibility: deviceRegistry.visibility,
            createdAt: deviceRegistry.createdAt,
            updatedAt: deviceRegistry.updatedAt,
            vendorName: deviceVendors.name,
            deviceModelName: deviceModels.name,
            deviceModelCode: deviceModels.code,
          })
          .from(deviceRegistry)
          .innerJoin(
            deviceModels,
            eq(deviceRegistry.deviceModelId, deviceModels.id),
          )
          .innerJoin(deviceVendors, eq(deviceModels.vendorId, deviceVendors.id))
          .where(where)
          .orderBy(deviceRegistry.createdAt);

        const data = devices.map((d) => ({
          id: d.id,
          device_key: d.deviceKey,
          device_model_id: d.deviceModelId,
          device_type: d.deviceType,
          eui: d.devEui,
          mac_address: d.macAddress,
          vendor_name: d.vendorName,
          device_model_name: d.deviceModelName,
          device_model_code: d.deviceModelCode,
          organization_id: d.organizationId,
          team_id: d.teamId,
          is_public: d.isPublic,
          is_active: d.isActive,
          is_global: d.isGlobal,
          is_persistent: d.isPersistent,
          connection_status: d.connectionStatus,
          last_heartbeat: d.lastHeartbeat,
          visibility: d.visibility,
          created_at: d.createdAt,
          updated_at: d.updatedAt,
        }));
        return { success: true, data, total: data.length };
      })

      // Get single device
      .get("/:device_id", async (ctx) => {
        const { device_id } = ctx.params;
        const [device] = await db
          .select()
          .from(deviceRegistry)
          .where(eq(deviceRegistry.id, device_id))
          .limit(1);
        if (!device) return { success: false, error: "Device not found" };
        return { success: true, data: device };
      })

      // Get device by identifier (EUI or MAC)
      .get("/identifier/:identifier", async (ctx) => {
        const { identifier } = ctx.params;
        if (!identifier)
          return { success: false, error: "Identifier required" };

        const result = await db.execute(
          sql`SELECT * FROM devices WHERE dev_eui = ${identifier} OR mac_address = ${identifier} LIMIT 1`,
        );
        if (!result.rows.length)
          return { success: false, error: "Device not found" };
        return { success: true, data: result.rows[0] };
      })

      // Create device
      .post(
        "/",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const body = ctx.body as {
            device_model_id: number;
            device_type?: string;
            eui?: string;
            mac_address?: string;
            organization_id: number;
            team_id: number;
            is_public?: boolean;
            is_active?: boolean;
            is_global?: boolean;
            metadata?: Record<string, unknown>;
            visibility?: "team" | "org" | "public";
          };

          // Validate device model exists
          const model = await db.query.deviceModels.findFirst({
            where: eq(deviceModels.id, body.device_model_id),
          });
          if (!model)
            return { success: false, error: "Device model not found" };

          // Validate team belongs to org
          const [team] = await db
            .select({ id: teams.id })
            .from(teams)
            .where(
              and(
                eq(teams.id, body.team_id),
                eq(teams.organizationId, body.organization_id),
              ),
            )
            .limit(1);
          if (!team)
            return {
              success: false,
              error: "Team does not belong to organization",
            };

          const deviceType = body.device_type ?? "lorawan";
          const validation = validateDeviceIdentifier(
            deviceType,
            body.eui,
            body.mac_address,
          );
          if (!validation.valid)
            return { success: false, error: validation.error };

          const deviceKey = generateDeviceKey();

          try {
            const [created] = await db
              .insert(deviceRegistry)
              .values({
                deviceKey,
                deviceModelId: body.device_model_id,
                deviceType,
                devEui: body.eui || null,
                macAddress: body.mac_address || null,
                createdBy: auth.userId,
                organizationId: body.organization_id,
                teamId: body.team_id,
                isPublic: body.is_public || false,
                isActive: body.is_active !== false,
                isGlobal: body.is_global || false,
                metadata: body.metadata || {},
                visibility: body.visibility ?? "team",
              })
              .returning({
                id: deviceRegistry.id,
                deviceKey: deviceRegistry.deviceKey,
                createdAt: deviceRegistry.createdAt,
              });

            return {
              success: true,
              data: {
                id: created.id,
                device_key: created.deviceKey,
                created_at: created.createdAt,
              },
              message: "Device created successfully",
            };
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "";
            if (msg.includes("unique"))
              return {
                success: false,
                error: "Device identifier or key already exists",
              };
            if (msg.includes("Team"))
              return {
                success: false,
                error: "Team does not belong to organization",
              };
            throw error;
          }
        },
        {
          body: t.Object({
            device_model_id: t.Number(),
            device_type: t.Optional(
              t.Union([
                t.Literal("lorawan"),
                t.Literal("ip"),
                t.Literal("other"),
              ]),
            ),
            eui: t.Optional(t.String()),
            mac_address: t.Optional(t.String()),
            organization_id: t.Number(),
            team_id: t.Number(),
            is_public: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
            is_global: t.Optional(t.Boolean()),
            metadata: t.Optional(t.Any()),
            visibility: t.Optional(t.Union([t.Literal("team"), t.Literal("org"), t.Literal("public")])),
          }),
        },
      )

      // Update device
      .put(
        "/:device_id",
        async (ctx) => {
          const { device_id } = ctx.params;
          const body = ctx.body as Record<string, unknown>;

          const [device] = await db
            .select({
              deviceType: deviceRegistry.deviceType,
            })
            .from(deviceRegistry)
            .where(eq(deviceRegistry.id, device_id))
            .limit(1);
          if (!device) return { success: false, error: "Device not found" };

          if (body.eui !== undefined || body.mac_address !== undefined) {
            const validation = validateDeviceIdentifier(
              (device.deviceType ?? "lorawan") as string,
              body.eui as string | undefined,
              body.mac_address as string | undefined,
            );
            if (!validation.valid)
              return { success: false, error: validation.error };
          }

          const updates: Record<string, unknown> = { updatedAt: new Date() };
          if (body.eui !== undefined) updates.devEui = body.eui || null;
          if (body.mac_address !== undefined)
            updates.macAddress = body.mac_address || null;
          if (body.is_public !== undefined) updates.isPublic = body.is_public;
          if (body.is_active !== undefined) updates.isActive = body.is_active;
          if (body.is_global !== undefined) updates.isGlobal = body.is_global;
          if (body.is_persistent !== undefined) updates.isPersistent = body.is_persistent;
          if (body.connection_status !== undefined)
            updates.connectionStatus = body.connection_status;
          if (body.metadata !== undefined) updates.metadata = body.metadata;
          if (body.visibility !== undefined) updates.visibility = body.visibility;

          if (Object.keys(updates).length <= 1)
            return { success: false, error: "No fields to update" };

          try {
            const result = await db
              .update(deviceRegistry)
              .set(updates)
              .where(eq(deviceRegistry.id, device_id))
              .returning({
                id: deviceRegistry.id,
                deviceKey: deviceRegistry.deviceKey,
                updatedAt: deviceRegistry.updatedAt,
              });
            return {
              success: true,
              data: result[0],
              message: "Device updated successfully",
            };
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "";
            if (msg.includes("unique"))
              return {
                success: false,
                error: "Device identifier already exists",
              };
            throw error;
          }
        },
        {
          body: t.Object({
            eui: t.Optional(t.String()),
            mac_address: t.Optional(t.String()),
            is_public: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
            is_global: t.Optional(t.Boolean()),
            is_persistent: t.Optional(t.Boolean()),
            connection_status: t.Optional(t.String()),
            metadata: t.Optional(t.Any()),
            visibility: t.Optional(t.Union([t.Literal("team"), t.Literal("org"), t.Literal("public")])),
          }),
        },
      )

      // Soft-delete device
      .delete("/:device_id", async (ctx) => {
        const { device_id } = ctx.params;
        const result = await db
          .update(deviceRegistry)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(deviceRegistry.id, device_id))
          .returning({ id: deviceRegistry.id });
        if (!result.length)
          return { success: false, error: "Device not found" };
        return {
          success: true,
          message: "Device deleted successfully (soft delete)",
        };
      })

      // Hard delete — permanently removes the device and all FK-cascaded records
      .delete("/:device_id/hard", async (ctx) => {
        const { device_id } = ctx.params;
        const result = await db
          .delete(deviceRegistry)
          .where(eq(deviceRegistry.id, device_id))
          .returning({ id: deviceRegistry.id });
        if (!result.length)
          return { success: false, error: "Device not found" };
        return { success: true, message: "Device permanently deleted" };
      })

      // Provider resolution
      .get("/:device_id/provider", async (ctx) => {
        const { device_id } = ctx.params;
        const [device] = await db
          .select({
            teamId: deviceRegistry.teamId,
            organizationId: deviceRegistry.organizationId,
          })
          .from(deviceRegistry)
          .where(eq(deviceRegistry.id, device_id))
          .limit(1);
        if (!device) return { success: false, error: "Device not found" };

        const result = await db.execute(
          sql`SELECT * FROM get_device_provider(${device.teamId}, ${device.organizationId})`,
        );
        if (!result.rows.length)
          return {
            success: false,
            error: "No provider configured for this device",
          };
        return { success: true, data: result.rows[0] };
      })

      // Team providers for an org
      .get("/org/:org_id/team-providers", async (ctx) => {
        const { org_id } = ctx.params;
        const result = await db.execute(sql`
        SELECT tdp.id, t.id as team_id, t.name as team_name,
               dp.id as provider_id, dp.name as provider_name,
               te.id as endpoint_id, te.endpoint_url,
               tdp.is_primary, tdp.priority, tdp.created_at
        FROM team_device_providers tdp
        JOIN teams t ON tdp.team_id = t.id
        JOIN device_providers dp ON tdp.device_provider_id = dp.id
        JOIN transport_endpoints te ON tdp.transport_endpoint_id = te.id
        WHERE t.organization_id = ${Number(org_id)}
        ORDER BY t.id, tdp.priority ASC
      `);
        return { success: true, data: result.rows, total: result.rows.length };
      })

      // Heartbeat
      .post(
        "/:device_id/heartbeat",
        async (ctx) => {
          const { device_id } = ctx.params;
          const { connection_status } = (ctx.body || {}) as {
            connection_status?: string;
          };
          const result = await db
            .update(deviceRegistry)
            .set({
              lastHeartbeat: new Date(),
              connectionStatus: connection_status || "connected",
              updatedAt: new Date(),
            })
            .where(eq(deviceRegistry.id, device_id))
            .returning({
              id: deviceRegistry.id,
              connectionStatus: deviceRegistry.connectionStatus,
              lastHeartbeat: deviceRegistry.lastHeartbeat,
            });
          if (!result.length)
            return { success: false, error: "Device not found" };
          return {
            success: true,
            data: result[0],
            message: "Heartbeat recorded",
          };
        },
        {
          body: t.Optional(
            t.Object({ connection_status: t.Optional(t.String()) }),
          ),
        },
      )

      // Stats
      .get("/stats/summary", async (ctx) => {
        const { org_id } = ctx.query as { org_id?: string };
        if (!org_id)
          return { success: false, error: "org_id query parameter required" };

        const result = await db.execute(sql`
        SELECT
          COUNT(*) as total_devices,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_devices,
          COUNT(CASE WHEN connection_status = 'connected' THEN 1 END) as connected_devices,
          COUNT(CASE WHEN device_type = 'lorawan' THEN 1 END) as lorawan_devices,
          COUNT(CASE WHEN device_type = 'ip' THEN 1 END) as mqtt_devices
        FROM device_registry
        WHERE organization_id = ${Number(org_id)}
      `);
        return { success: true, data: result.rows[0] };
      })
  );
}
