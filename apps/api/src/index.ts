import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

import { cors } from "@elysiajs/cors";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import {
  connect,
  DeliverPolicy,
  DiscardPolicy,
  type NatsConnection,
  StorageType,
} from "nats";
import { createDrizzleDB } from "./db";
import { authPlugin, validateToken } from "./db/auth";
import { deviceRegistry } from "./db/schema";
import { AdapterConfigStore } from "./lib/adapter-config-store";
import { AdapterManagerService } from "./lib/adapter-manager-service";
import { AuthMiddleware, createTestTokens } from "./lib/auth-middleware";
import { DeviceJWTHandler } from "./lib/device-jwt";
import { createAdapterRoutes } from "./routes/adapters";
import {
  createApplicationRoutes,
  createGlobalApplicationRoutes,
} from "./routes/applications";
// Route factories
import { createAuthRoutes, createLegacyAuthRoutes } from "./routes/auth";
import { createCommandRoutes } from "./routes/commands";
import {
  createDeviceReferenceRoutes,
  createDeviceRoutes,
} from "./routes/devices";
import { createIntegrationProfileRoutes } from "./routes/integration-profiles";
import {
  createEventsRoutes,
  createLegacyDeviceRoutes,
} from "./routes/legacy-devices";
import { createNatsCredentialRoutes } from "./routes/nats-credentials";
import { startNatsAuthCallout } from "./routes/nats-ws-auth";
import { createOrganizationRoutes } from "./routes/organizations";
import { createPlanConfigRoutes } from "./routes/plan-config";
import { createRealtimeRoutes, decodeIngestPayload } from "./routes/realtime";
import { createRoleRoutes } from "./routes/roles";
import { createServiceRoutes } from "./routes/services";
import { createGlobalTeamRoutes, createTeamRoutes } from "./routes/teams";
import { createTransportRegistryRoutes } from "./routes/transport-registry";
import { createUserRoutes } from "./routes/users";

// ============================================================
// Connections
// ============================================================
const pgConfig = {
  user: String(process.env.POSTGRES_USER || "zc8"),
  password: String(process.env.POSTGRES_PASSWORD || "zc8"),
  host: String(process.env.POSTGRES_HOST || "localhost"),
  port: parseInt(String(process.env.POSTGRES_PORT || "5432"), 10),
  database: String(
    process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || "zc8",
  ),
};
console.log("PostgreSQL Config:", { ...pgConfig, password: "***" });

const { db, pool: pgPool } = createDrizzleDB(pgConfig);

let nc: NatsConnection | null = null;
try {
  nc = await connect({
    servers: process.env.NATS_URL ?? "nats://localhost:4222",
    // Use internal bypass user when auth_callout is active.
    // Falls back to anonymous connection if password is not set (dev without callout).
    ...(process.env.NATS_INTERNAL_PASSWORD
      ? { user: "_api_", pass: process.env.NATS_INTERNAL_PASSWORD }
      : {}),
  });
  console.log(
    "NATS: connected to",
    process.env.NATS_URL ?? "nats://localhost:4222",
  );
} catch (err) {
  console.warn(
    "NATS: connection failed (telemetry SSE disabled):",
    (err as Error).message,
  );
}

// ── Background: update device connection_status from telemetry events ─────────
if (nc) {
  const activeNc = nc; // captured so the async closure doesn't need nc!
  const HEARTBEAT_INTERVAL_MS = 30_000; // max one DB write per device per 30 s
  const lastHeartbeatAt = new Map<string, number>();

  // ── Auth callout: handles browser NATS WebSocket authentication ────────────
  startNatsAuthCallout(activeNc).catch((e: Error) => {
    console.warn("[nats-auth-callout] Failed to start:", e.message);
  });

  // ── Telemetry pipeline: heartbeat + realtime fanout ────────────────────────
  // Single subscription to telemetry.raw.> handles two jobs:
  //   1. Update device connection_status in Postgres (heartbeat, throttled).
  //   2. Decode proto payload and re-publish JSON to telemetry.realtime.*.*.*
  //      so browsers can subscribe directly via NATS.ws without a WS proxy.
  (async () => {
    const sub = activeNc.subscribe("telemetry.raw.>");
    console.log(
      "[heartbeat] Subscribed to telemetry.raw.> for device status updates",
    );
    for await (const msg of sub) {
      // Subject: telemetry.raw.{orgId}.{teamId}.{deviceKey}
      const parts = msg.subject.split(".");
      if (parts.length < 5) continue;
      const orgId = Number(parts[2]);
      const teamId = Number(parts[3]);
      const deviceKey = parts[4];
      if (!orgId || !deviceKey) continue;

      // ── 1. Heartbeat: throttled Postgres status update ─────────────────
      const mapKey = `${orgId}:${deviceKey}`;
      const now = Date.now();
      if ((lastHeartbeatAt.get(mapKey) ?? 0) + HEARTBEAT_INTERVAL_MS <= now) {
        lastHeartbeatAt.set(mapKey, now);
        db.update(deviceRegistry)
          .set({ connectionStatus: "connected", lastHeartbeat: new Date() })
          .where(
            and(
              eq(deviceRegistry.organizationId, orgId),
              eq(deviceRegistry.deviceKey, deviceKey),
            ),
          )
          .catch((e: Error) => {
            console.error("[heartbeat] DB update failed:", e.message);
          });
      }

      // ── 2. Fanout: decode proto → publish JSON to telemetry.realtime.* ──
      try {
        const { ts, fields } = decodeIngestPayload(msg.data);
        const realtimeSubject = `telemetry.realtime.${orgId}.${teamId}.${deviceKey}`;
        activeNc.publish(
          realtimeSubject,
          JSON.stringify({
            device_key: Number(deviceKey),
            organization_id: orgId,
            team_id: teamId,
            fields,
            ts,
          }),
        );
      } catch {
        /* skip malformed proto messages */
      }
    }
  })();
  // ── TELEMETRY_REALTIME JetStream stream ────────────────────────────────────
  // Captures all Core NATS publishes to telemetry.realtime.> (the fanout
  // above + service heartbeats from Go workers) in JetStream so the browser
  // dashboard can replay the last N messages on panel mount instead of
  // waiting for the next live message.
  (async () => {
    try {
      const jsm = await activeNc.jetstreamManager();
      const streamCfg = {
        name: "TELEMETRY_REALTIME",
        subjects: ["telemetry.realtime.>"],
        /* eslint-disable @typescript-eslint/naming-convention */
        max_msgs_per_subject: 100,
        discard: DiscardPolicy.Old,
        storage: StorageType.File,
        /* eslint-enable @typescript-eslint/naming-convention */
      };
      try {
        await jsm.streams.add(streamCfg);
        console.log("[realtime-stream] TELEMETRY_REALTIME stream created");
      } catch {
        // Stream already exists — update to refresh config
        await jsm.streams
          .update("TELEMETRY_REALTIME", streamCfg)
          .catch(() => { });
        console.log("[realtime-stream] TELEMETRY_REALTIME stream ready");
      }
    } catch (e) {
      console.warn(
        "[realtime-stream] Failed to init TELEMETRY_REALTIME:",
        (e as Error).message,
      );
    }
  })();
}
// Services
// ============================================================
const adapterConfigStore = new AdapterConfigStore(pgPool);
const adapterManagerService = new AdapterManagerService(adapterConfigStore);
const authMiddleware = new AuthMiddleware(pgPool);
const testTokens = createTestTokens(authMiddleware);
const jwtHandler = new DeviceJWTHandler();

console.log("\n========================================");
console.log("=== TEST TOKENS FOR API TESTING ===");
console.log("=========================================");
console.log("Admin Token:", testTokens.adminToken.substring(0, 50) + "...");
console.log(
  "IMT Owner Token:",
  testTokens.imtOwnerToken.substring(0, 50) + "...",
);
console.log(
  "IMT Member Token:",
  testTokens.imtMemberToken.substring(0, 50) + "...",
);
console.log(
  "FSAELive Owner Token:",
  testTokens.fsaeOwnerToken.substring(0, 50) + "...",
);
console.log(
  "StorioCloud Admin Token:",
  testTokens.storiocloudAdminToken.substring(0, 50) + "...",
);
console.log(
  "GMS Team Owner Token:",
  testTokens.gmsTeamOwnerToken.substring(0, 50) + "...",
);
console.log("========================================\n");

// ============================================================
// App
// ============================================================
const app = new Elysia()
  .use(
    cors({
      origin: ["http://localhost:3000", "http://localhost:3333"],
      credentials: true,
    }),
  )
  .use(authPlugin(db))

  // Health & info
  .get("/", () => ({
    message: "Device Registry API v2",
    version: "2.0.0",
    features: ["multi-tenant", "device-jwt", "reactive-updates", "drizzle-orm"],
  }))
  .get("/health", async () => {
    try {
      await pgPool.query("SELECT 1");
      return { status: "healthy", database: "connected" };
    } catch {
      return { status: "unhealthy", database: "disconnected" };
    }
  })

  // Route plugins
  .use(createAuthRoutes(db))
  .use(createLegacyAuthRoutes(authMiddleware, testTokens))
  .use(createLegacyDeviceRoutes(pgPool, jwtHandler))
  .use(createEventsRoutes(nc))
  .use(createAdapterRoutes(adapterManagerService))
  .use(createOrganizationRoutes(db))
  .use(createGlobalTeamRoutes(db))
  .use(createTeamRoutes(db))
  .use(createGlobalApplicationRoutes(db))
  .use(createApplicationRoutes(db))
  .use(createRoleRoutes(db))
  .use(createUserRoutes(db))
  .use(createPlanConfigRoutes(db))
  .use(createDeviceReferenceRoutes(db))
  .use(createDeviceRoutes(db))
  .use(createTransportRegistryRoutes(db))
  .use(createServiceRoutes(db, nc))
  .use(createCommandRoutes(db))
  .use(createNatsCredentialRoutes(db))
  .use(createIntegrationProfileRoutes(db))
  .use(createRealtimeRoutes(nc))

  // ── Last realtime messages from JetStream replay ───────────────────────────
  // GET /api/v1/telemetry/recent?limit=50
  // Returns the last message per device (org-scoped) from the
  // TELEMETRY_REALTIME JetStream stream so the dashboard can pre-populate
  // the Live Messages panel without waiting for the next live event.
  .get("/api/v1/telemetry/recent", async ({ headers, query }) => {
    const rawAuth = (headers as Record<string, string>).authorization ?? "";
    const token = rawAuth.startsWith("Bearer ") ? rawAuth.slice(7) : rawAuth;
    const auth = validateToken(token);
    if (!auth) return new Response("Unauthorized", { status: 401 });

    const limit = Math.min(
      parseInt(String((query as Record<string, string>).limit ?? "50"), 10) ||
      50,
      200,
    );

    if (!nc || nc.isClosed()) return { messages: [] };

    const filterSubject =
      auth.role === "superAdmin"
        ? "telemetry.realtime.>"
        : auth.orgId != null
          ? `telemetry.realtime.${auth.orgId}.>`
          : null;

    if (!filterSubject) return { messages: [] };

    try {
      const js = nc.jetstream();
      const consumer = await js.consumers.get("TELEMETRY_REALTIME", {
        deliver_policy: DeliverPolicy.LastPerSubject,
        filterSubjects: [filterSubject],
      });

      const msgs = await consumer.fetch({ max_messages: limit, expires: 1000 });
      const results: unknown[] = [];
      for await (const msg of msgs) {
        try {
          results.push(JSON.parse(new TextDecoder().decode(msg.data)));
        } catch {
          /* skip malformed */
        }
      }
      return { messages: results };
    } catch (e) {
      // Stream not ready yet (no messages published) or consumer error
      console.warn("[telemetry-recent]", (e as Error).message);
      return { messages: [] };
    }
  })

  .listen({ port: 3333, hostname: "0.0.0.0" });

console.log(
  `Elysia API v2 is running at http://${app.server?.hostname}:${app.server?.port}`,
);
