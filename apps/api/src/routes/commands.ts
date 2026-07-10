/**
 * Command Dispatch API Routes
 *
 * Send commands to devices and track their execution status.
 * Commands are published to NATS JetStream COMMANDS stream for async dispatch
 * by transport-specific commander workers (mqtt/http/grpc).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { type NatsConnection, connect as natsConnect, StringCodec } from "nats";
import type { DrizzleDB } from "../db";
import { type AuthContext, requireAuth } from "../db/auth";
import { type CommandStatus, commandLog } from "../db/schema";

const NATS_URL = process.env.NATS_URL || "nats://localhost:4222";

let natsConn: NatsConnection | null = null;

async function getNatsConnection(): Promise<NatsConnection> {
  if (natsConn && !natsConn.isClosed()) {
    return natsConn;
  }
  natsConn = await natsConnect({ servers: NATS_URL });
  console.log("[commands] Connected to NATS:", NATS_URL);
  return natsConn;
}

export function createCommandRoutes(db: DrizzleDB) {
  return (
    new Elysia({ prefix: "/api/v1" })
      .use(requireAuth())

      // ============================================================
      // POST /devices/:device_id/commands — Send command to device
      // ============================================================
      .post(
        "/devices/:device_id/commands",
        async (ctx) => {
          const auth = (ctx as unknown as { auth: AuthContext }).auth;
          const { device_id } = ctx.params;
          const { command_type, payload } = ctx.body as {
            command_type: string;
            payload: Record<string, unknown>;
          };

          // Resolve command routing from the materialized view
          const routing = await db.execute(
            sql`SELECT * FROM v_device_command_routing WHERE device_id = ${device_id}`,
          );

          if (routing.rows.length === 0) {
            return {
              success: false,
              error: "Device not found or no command routing configured",
            };
          }

          const route = routing.rows[0] as Record<string, unknown>;

          // Determine transport type category for NATS subject routing
          let transportCategory = "mqtt"; // default
          const tc = String(route.transport_type_code || "");
          if (tc.includes("http")) transportCategory = "http";
          else if (tc.includes("grpc")) transportCategory = "grpc";

          // Insert command_log entry
          const commandId = crypto.randomUUID();
          const payloadJson = JSON.stringify(payload);

          await db
            .insert(commandLog)
            .values({
              id: commandId,
              deviceId: device_id,
              deviceKey: String(route.device_key),
              commandType: command_type,
              payload,
              status: "pending",
              transportType: String(route.transport_type_code),
              lnsProviderCode: route.lns_provider_code
                ? String(route.lns_provider_code)
                : null,
              maxAttempts: 3,
              createdBy: auth.userId,
            })
            .returning();

          // Build CommandEnvelope as JSON for NATS publish
          const envelope = {
            command_id: commandId,
            device_id,
            device_key: String(route.device_key),
            dev_eui: route.eui || "",
            command_type,
            payload: Buffer.from(payloadJson).toString("base64"),
            transport_type: transportCategory,
            lns_provider_code: route.lns_provider_code || "",
            formatter_code: route.formatter_code || "",
            mqtt_host: route.mqtt_host || "",
            mqtt_port: route.mqtt_port || 0,
            mqtt_username: route.mqtt_username || "",
            mqtt_password: route.mqtt_password || "",
            mqtt_qos: route.mqtt_qos || 0,
            mqtt_use_tls: route.mqtt_use_tls || false,
            http_base_url: route.http_base_url || "",
            http_method: route.http_method || "",
            http_auth_type: route.http_auth_type || "",
            http_auth_credentials: route.http_auth_credentials || "",
            http_timeout_sec: route.http_timeout_sec || 10,
            http_content_type: route.http_content_type || "",
            grpc_host: route.grpc_host || "",
            grpc_port: route.grpc_port || 0,
            grpc_service_name: route.grpc_service_name || "",
            organization_id: route.organization_id,
            team_id: route.team_id,
            device_model_code: route.device_model_code || "",
            vendor_code: route.vendor_code || "",
            device_metadata: route.metadata
              ? Buffer.from(JSON.stringify(route.metadata)).toString("base64")
              : "",
            max_attempts: 3,
            attempt: 1,
          };

          // Publish to JetStream via NATS.
          // For MQTT: route commands to the specific input.mqtt service (identified by
          // service_id) that is already connected to the device's broker, so it can
          // forward the command over its existing MQTT connection.
          // For HTTP/gRPC: use device_key — the output services filter by their own config.
          const nc = await getNatsConnection();
          let dispatchToken: string | number = String(route.device_key);
          if (transportCategory === "mqtt" && route.mqtt_input_service_id) {
            dispatchToken = Number(route.mqtt_input_service_id);
          }
          const subject = `commands.dispatch.${transportCategory}.${dispatchToken}`;
          nc.publish(subject, StringCodec().encode(JSON.stringify(envelope)));

          // Update status to dispatched
          await db
            .update(commandLog)
            .set({ status: "dispatched", dispatchedAt: new Date() })
            .where(eq(commandLog.id, commandId));

          return {
            success: true,
            data: {
              command_id: commandId,
              status: "dispatched",
              transport_type: transportCategory,
              formatter_code: route.formatter_code,
              device_key: route.device_key,
            },
          };
        },
        {
          body: t.Object({
            command_type: t.String(),
            payload: t.Record(t.String(), t.Any()),
          }),
        },
      )

      // ============================================================
      // GET /commands/:command_id — Get command status
      // ============================================================
      .get("/commands/:command_id", async (ctx) => {
        const { command_id } = ctx.params;

        const [cmd] = await db
          .select()
          .from(commandLog)
          .where(eq(commandLog.id, command_id))
          .limit(1);

        if (!cmd) return { success: false, error: "Command not found" };

        return {
          success: true,
          data: {
            id: cmd.id,
            device_id: cmd.deviceId,
            device_key: cmd.deviceKey,
            command_type: cmd.commandType,
            payload: cmd.payload,
            status: cmd.status,
            transport_type: cmd.transportType,
            lns_provider_code: cmd.lnsProviderCode,
            error_message: cmd.errorMessage,
            attempts: cmd.attempts,
            max_attempts: cmd.maxAttempts,
            created_at: cmd.createdAt,
            dispatched_at: cmd.dispatchedAt,
            delivered_at: cmd.deliveredAt,
            acked_at: cmd.ackedAt,
            expires_at: cmd.expiresAt,
            metadata: cmd.metadata,
          },
        };
      })

      // ============================================================
      // GET /commands?device_id=...&status=...&limit=... — List commands
      // ============================================================
      .get("/commands", async (ctx) => {
        const query = ctx.query as {
          device_id?: string;
          status?: string;
          limit?: string;
        };
        const limit = Math.min(Number(query.limit) || 50, 200);

        const conditions = [];
        if (query.device_id)
          conditions.push(eq(commandLog.deviceId, query.device_id));
        if (query.status)
          conditions.push(eq(commandLog.status, query.status as CommandStatus));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const cmds = await db
          .select({
            id: commandLog.id,
            deviceId: commandLog.deviceId,
            deviceKey: commandLog.deviceKey,
            commandType: commandLog.commandType,
            status: commandLog.status,
            transportType: commandLog.transportType,
            lnsProviderCode: commandLog.lnsProviderCode,
            errorMessage: commandLog.errorMessage,
            attempts: commandLog.attempts,
            maxAttempts: commandLog.maxAttempts,
            createdAt: commandLog.createdAt,
            dispatchedAt: commandLog.dispatchedAt,
            deliveredAt: commandLog.deliveredAt,
            ackedAt: commandLog.ackedAt,
          })
          .from(commandLog)
          .where(where)
          .orderBy(desc(commandLog.createdAt))
          .limit(limit);

        const data = cmds.map((c) => ({
          id: c.id,
          device_id: c.deviceId,
          device_key: c.deviceKey,
          command_type: c.commandType,
          status: c.status,
          transport_type: c.transportType,
          lns_provider_code: c.lnsProviderCode,
          error_message: c.errorMessage,
          attempts: c.attempts,
          max_attempts: c.maxAttempts,
          created_at: c.createdAt,
          dispatched_at: c.dispatchedAt,
          delivered_at: c.deliveredAt,
          acked_at: c.ackedAt,
        }));
        return { success: true, data, count: data.length };
      })
  );
}
