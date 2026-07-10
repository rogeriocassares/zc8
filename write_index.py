content = '''import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { connect, type NatsConnection } from "nats";
import { createDrizzleDB } from "./db/index.ts";
import { authPlugin } from "./db/auth.ts";
import { AdapterConfigStore } from "./lib/adapter-config-store.ts";
import { AdapterManagerService } from "./lib/adapter-manager-service.ts";
import { AuthMiddleware, createTestTokens } from "./lib/auth-middleware.ts";
import { DeviceJWTHandler } from "./lib/device-jwt.ts";
// Route factories
import { createAuthRoutes, createLegacyAuthRoutes } from "./routes/auth.ts";
import { createAdapterRoutes } from "./routes/adapters.ts";
import { createLegacyDeviceRoutes, createEventsRoutes } from "./routes/legacy-devices.ts";
import { createApplicationRoutes, createGlobalApplicationRoutes } from "./routes/applications.ts";
import { createCommandRoutes } from "./routes/commands.ts";
import { createDeviceReferenceRoutes, createDeviceRoutes } from "./routes/devices.ts";
import { createInfluxdbConfigRoutes } from "./routes/influxdb-config.ts";
import { createNatsCredentialRoutes } from "./routes/nats-credentials.ts";
import { createOrganizationRoutes } from "./routes/organizations.ts";
import { createPlanConfigRoutes } from "./routes/plan-config.ts";
import { createRoleRoutes } from "./routes/roles.ts";
import { createServiceRoutes } from "./routes/services.ts";
import { createGlobalTeamRoutes, createTeamRoutes } from "./routes/teams.ts";
import { createTransportRegistryRoutes } from "./routes/transport-registry.ts";
import { createUserRoutes } from "./routes/users.ts";

// ============================================================
// Connections
// ============================================================
const pgConfig = {
  user: String(process.env.POSTGRES_USER || "zc8"),
  password: String(process.env.POSTGRES_PASSWORD || "zc8"),
  host: String(process.env.POSTGRES_HOST || "localhost"),
  port: parseInt(String(process.env.POSTGRES_PORT || "5432"), 10),
  database: String(process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || "zc8"),
};
console.log("PostgreSQL Config:", { ...pgConfig, password: "***" });

const { db, pool: pgPool } = createDrizzleDB(pgConfig);

let nc: NatsConnection | null = null;
try {
  nc = await connect({ servers: process.env.NATS_URL ?? "nats://localhost:4222" });
  console.log("NATS: connected to", process.env.NATS_URL ?? "nats://localhost:4222");
} catch (err) {
  console.warn("NATS: connection failed (telemetry SSE disabled):", (err as Error).message);
}

// ============================================================
// Services
// ============================================================
const adapterConfigStore = new AdapterConfigStore(pgPool);
const adapterManagerService = new AdapterManagerService(adapterConfigStore);
const authMiddleware = new AuthMiddleware(pgPool);
const testTokens = createTestTokens(authMiddleware);
const jwtHandler = new DeviceJWTHandler();

console.log("\\n========================================");
console.log("=== TEST TOKENS FOR API TESTING ===");
console.log("=========================================");
console.log("Admin Token:", testTokens.adminToken.substring(0, 50) + "...");
console.log("IMT Owner Token:", testTokens.imtOwnerToken.substring(0, 50) + "...");
console.log("IMT Member Token:", testTokens.imtMemberToken.substring(0, 50) + "...");
console.log("FSAELive Owner Token:", testTokens.fsaeOwnerToken.substring(0, 50) + "...");
console.log("StorioCloud Admin Token:", testTokens.storiocloudAdminToken.substring(0, 50) + "...");
console.log("GMS Team Owner Token:", testTokens.gmsTeamOwnerToken.substring(0, 50) + "...");
console.log("========================================\\n");

// ============================================================
// App
// ============================================================
const app = new Elysia()
  .use(cors({ origin: ["http://localhost:3000", "http://localhost:3333"], credentials: true }))
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
  .use(createServiceRoutes(db))
  .use(createInfluxdbConfigRoutes(db))
  .use(createCommandRoutes(db))
  .use(createNatsCredentialRoutes(db))

  .listen({ port: 3333, hostname: "0.0.0.0" });

console.log(`Elysia API v2 is running at http://${app.server?.hostname}:${app.server?.port}`);
'''

with open('/Users/rogeriocassares/Git/rogeriocassares/zc8/apps/api/src/index.ts', 'w') as f:
    f.write(content)
print('Written', len(content.splitlines()), 'lines')
