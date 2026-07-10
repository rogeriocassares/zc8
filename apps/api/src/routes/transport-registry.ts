/**
 * Transport Registry API Routes — Compatibility Shim
 *
 * These endpoints maintain backward-compatibility with the old transport_registry
 * schema. They now read/write to the new integration_registry + config tables.
 *
 * The web UI uses these endpoints; new code should use /api/v1/integrations instead.
 */

import { and, asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import {
  type ServiceType,
  serviceInputMqttConfig,
  serviceRegistry,
} from "../db/schema";

// Stable synthetic IDs for integration types (backwards compat with web UI)
const TRANSPORT_TYPES = [
  {
    id: 1,
    code: "mqtt",
    display_name: "MQTT",
    description: "Subscribe/publish to MQTT broker topics",
    direction: "input" as const,
  },
  {
    id: 2,
    code: "http-server",
    display_name: "HTTP Server",
    description: "Accept HTTP/HTTPS POST requests",
    direction: "input" as const,
  },
  {
    id: 3,
    code: "grpc-server",
    display_name: "gRPC Server",
    description: "Accept gRPC stream connections",
    direction: "input" as const,
  },
  {
    id: 4,
    code: "grpc-client",
    display_name: "gRPC Client",
    description: "Forward data to a gRPC server",
    direction: "input" as const,
  },
  {
    id: 5,
    code: "http-client",
    display_name: "HTTP Client",
    description: "Forward data via HTTP POST/PUT",
    direction: "output" as const,
  },
  {
    id: 6,
    code: "mqtt",
    display_name: "MQTT",
    description: "Publish data to an MQTT broker",
    direction: "output" as const,
  },
  {
    id: 7,
    code: "influxdb3",
    display_name: "InfluxDB 3",
    description: "Write data to InfluxDB 3",
    direction: "output" as const,
  },
  {
    id: 8,
    code: "clickhouse",
    display_name: "ClickHouse",
    description: "Write data to ClickHouse",
    direction: "output" as const,
  },
];

const TYPE_ID_TO_CODE: Record<number, string> = {};
const TYPE_CODE_TO_ID: Record<string, number> = {};
for (const tt of TRANSPORT_TYPES) {
  TYPE_ID_TO_CODE[tt.id] = tt.code;
  TYPE_CODE_TO_ID[tt.code] = tt.id;
}

function integrationToTransportShape(e: {
  id: number;
  name: string;
  description: string | null;
  organizationId: number;
  teamId: number | null;
  serviceType: string;
  isGlobal: boolean | null;
  isActive: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  [key: string]: unknown;
}) {
  // serviceType is "direction.typeCode" e.g. "input.mqtt"
  const dotIdx = e.serviceType.indexOf(".");
  const typeCode = dotIdx >= 0 ? e.serviceType.slice(dotIdx + 1) : e.serviceType;
  const typeId = TYPE_CODE_TO_ID[typeCode] ?? null;
  const typeRow = TRANSPORT_TYPES.find((tt) => tt.code === typeCode);
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    organization_id: e.organizationId,
    team_id: e.teamId,
    transport_type_id: typeId,
    transport_type_code: typeCode,
    transport_type_name: typeRow?.display_name ?? typeCode,
    is_global: e.isGlobal ?? false,
    is_active: e.isActive ?? true,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

export function createTransportRegistryRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1" })
      // ────────────────────────────────────────────────────────────────
      // Transport Types (reference data — no auth required)
      // ────────────────────────────────────────────────────────────────
      .get("/transport-types", () => {
        return {
          success: true,
          data: TRANSPORT_TYPES.map((tt) => ({
            id: tt.id,
            code: tt.code,
            display_name: tt.display_name,
            description: tt.description,
          })),
        };
      })

      // ────────────────────────────────────────────────────────────────
      // Transport Registry CRUD (auth required)
      // ────────────────────────────────────────────────────────────────
      .use(requireAuth())

      .get("/transport-registry", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const { org_id, team_id } = ctx.query as {
          org_id?: string;
          team_id?: string;
        };

        const conditions = [];
        if (auth.role !== "superAdmin") {
          if (auth.orgId != null)
            conditions.push(eq(serviceRegistry.organizationId, auth.orgId));
        } else if (org_id) {
          conditions.push(
            eq(serviceRegistry.organizationId, Number(org_id)),
          );
        }
        if (team_id)
          conditions.push(eq(serviceRegistry.teamId, Number(team_id)));

        const entries = await db
          .select()
          .from(serviceRegistry)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(asc(serviceRegistry.id));

        return {
          success: true,
          data: entries.map(integrationToTransportShape),
          total: entries.length,
        };
      })

      .get("/transport-registry/:id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [entry] = await db
          .select()
          .from(serviceRegistry)
          .where(eq(serviceRegistry.id, id))
          .limit(1);

        if (!entry)
          return {
            success: false,
            error: "Transport registry entry not found",
          };
        if (
          auth.role !== "superAdmin" &&
          entry.organizationId !== auth.orgId &&
          !entry.isGlobal
        ) {
          ctx.set.status = 403;
          return { success: false, error: "Access denied" };
        }

        return { success: true, data: integrationToTransportShape(entry) };
      })

      .post(
        "/transport-registry",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const body = ctx.body as {
            name: string;
            description?: string;
            organization_id: number;
            team_id?: number;
            transport_type_id: number;
            is_global?: boolean;
            mqtt_host?: string;
            mqtt_port?: number;
            mqtt_username?: string;
            mqtt_password?: string;
            mqtt_topics?: string[];
            mqtt_qos?: number;
            mqtt_use_tls?: boolean;
          };

          const typeCode = TYPE_ID_TO_CODE[body.transport_type_id];
          if (!typeCode) {
            ctx.set.status = 422;
            return { success: false, error: "Invalid transport_type_id" };
          }
          const typeRow = TRANSPORT_TYPES.find((tt) => tt.code === typeCode);
          if (!typeRow) {
            ctx.set.status = 422;
            return { success: false, error: "Invalid transport type configuration" };
          }

          const [entry] = await db
            .insert(serviceRegistry)
            .values({
              name: body.name,
              description: body.description ?? null,
              serviceType: `${typeRow.direction}.${typeCode}` as ServiceType,
              organizationId: body.organization_id,
              teamId: body.team_id ?? null,
              isGlobal: body.is_global ?? false,
              isActive: true,
              createdBy: auth.userId ?? null,
              updatedBy: auth.userId ?? null,
            })
            .returning();

          // For MQTT subscriber, also create the config row
          if (typeCode === "mqtt" && body.mqtt_host) {
            await db.insert(serviceInputMqttConfig).values({
              serviceId: entry.id,
              host: body.mqtt_host,
              port: body.mqtt_port ?? 1883,
              username: body.mqtt_username ?? null,
              password: body.mqtt_password ?? null,
              qos: body.mqtt_qos ?? 1,
              subscribeTopics: body.mqtt_topics ?? [],
              useTls: body.mqtt_use_tls ?? false,
            });
          }

          return {
            success: true,
            data: integrationToTransportShape(entry),
            message: "Transport registry entry created successfully",
          };
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1, maxLength: 255 }),
            description: t.Optional(t.String()),
            organization_id: t.Number(),
            team_id: t.Optional(t.Number()),
            transport_type_id: t.Number(),
            is_global: t.Optional(t.Boolean()),
            mqtt_host: t.Optional(t.String()),
            mqtt_port: t.Optional(t.Number()),
            mqtt_username: t.Optional(t.String()),
            mqtt_password: t.Optional(t.String()),
            mqtt_topics: t.Optional(t.Array(t.String())),
            mqtt_qos: t.Optional(t.Number()),
            mqtt_use_tls: t.Optional(t.Boolean()),
          }),
        },
      )

      .put(
        "/transport-registry/:id",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const id = Number(ctx.params.id);
          const body = ctx.body as {
            name?: string;
            description?: string;
            is_global?: boolean;
            is_active?: boolean;
          };

          const [existing] = await db
            .select()
            .from(serviceRegistry)
            .where(eq(serviceRegistry.id, id))
            .limit(1);
          if (!existing)
            return {
              success: false,
              error: "Transport registry entry not found",
            };
          if (
            auth.role !== "superAdmin" &&
            existing.organizationId !== auth.orgId
          ) {
            ctx.set.status = 403;
            return { success: false, error: "Access denied" };
          }

          const updates: Partial<typeof serviceRegistry.$inferInsert> = {
            updatedAt: new Date(),
            updatedBy: auth.userId ?? undefined,
          };
          if (body.name !== undefined) updates.name = body.name;
          if (body.description !== undefined)
            updates.description = body.description;
          if (body.is_global !== undefined) updates.isGlobal = body.is_global;
          if (body.is_active !== undefined) updates.isActive = body.is_active;

          const [updated] = await db
            .update(serviceRegistry)
            .set(updates)
            .where(eq(serviceRegistry.id, id))
            .returning();

          return { success: true, data: integrationToTransportShape(updated) };
        },
        {
          body: t.Object({
            name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
            description: t.Optional(t.String()),
            is_global: t.Optional(t.Boolean()),
            is_active: t.Optional(t.Boolean()),
          }),
        },
      )

      .delete("/transport-registry/:id", async (ctx) => {
        const auth = (ctx as unknown as { auth: AuthContext }).auth;
        const id = Number(ctx.params.id);

        const [existing] = await db
          .select()
          .from(serviceRegistry)
          .where(eq(serviceRegistry.id, id))
          .limit(1);
        if (!existing)
          return {
            success: false,
            error: "Transport registry entry not found",
          };
        if (
          auth.role !== "superAdmin" &&
          existing.organizationId !== auth.orgId
        ) {
          ctx.set.status = 403;
          return { success: false, error: "Access denied" };
        }

        await db
          .delete(serviceRegistry)
          .where(eq(serviceRegistry.id, id));
        return { success: true, message: "Transport registry entry deleted" };
      })
  );
}
