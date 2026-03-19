import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables from .env file in the root directory
config({ path: resolve(process.cwd(), ".env") });

import { cors } from "@elysiajs/cors";
import * as crypto from "crypto";
import { Elysia, t } from "elysia";
import { Pool } from "pg";
import { createClient } from "redis";

// Adapter Manager imports
import { AdapterConfigStore } from "./lib/adapter-config-store.ts";
import { AdapterManagerService } from "./lib/adapter-manager-service.ts";
import type { AdapterType, AdapterVendor } from "./lib/adapter-types.ts";
import { AuthMiddleware, createTestTokens } from "./lib/auth-middleware.ts";
import { RBACMiddleware } from "./lib/rbac-middleware.ts";
import { createDeviceRoutes } from "./routes/devices.ts";
import { createIngestProfileRoutes } from "./routes/ingest-profiles.ts";
// RBAC Route imports
import { createOrganizationRoutes } from "./routes/organizations.ts";
import { createRealtimeRoutes } from "./routes/realtime.ts";
import { createRoleRoutes } from "./routes/roles.ts";
import { createTeamRoutes } from "./routes/teams.ts";

// ============================================
// Utility Functions
// ============================================

/**
 * ParseUUIDv7ToDeviceKey converts a canonical UUID string to a uint64 DeviceKey
 * using the lower 64 bits of the UUID.
 *
 * UUID layout: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * Lower 64 bits = indices [19:23] + [24:36]
 *
 * Zero allocations, fast for hot path.
 */
function parseUUIDv7ToDeviceKey(s: string): bigint {
  // Fast length check
  if (s.length !== 36) {
    throw new Error("Invalid UUID format: expected 36 characters");
  }

  let result = 0n;

  // Helper to convert hex character to value
  const fromHex = (c: string): number => {
    const charCode = c.charCodeAt(0);
    if (charCode >= 48 && charCode <= 57) return charCode - 48; // '0'-'9'
    if (charCode >= 97 && charCode <= 102) return charCode - 97 + 10; // 'a'-'f'
    if (charCode >= 65 && charCode <= 70) return charCode - 65 + 10; // 'A'-'F'
    throw new Error(`Invalid hex character: ${c}`);
  };

  // Parse lower 64 bits: indices 19-22 (4 chars) + 24-35 (12 chars)
  for (let i = 19; i < 23; i++) {
    result = (result << 4n) | BigInt(fromHex(s[i]));
  }
  for (let i = 24; i < 36; i++) {
    result = (result << 4n) | BigInt(fromHex(s[i]));
  }

  return result;
}

// ============================================
// Types
// ============================================

type DeviceAuthContext = {
  tenant_id: bigint;
  device_id: string;
  device_key: string;
  scopes: string[];
};

// ============================================
// PostgreSQL & Redis Setup
// ============================================

// PostgreSQL connection pool with proper defaults
const pgConfig = {
  user: String(process.env.POSTGRES_USER || "zc8"),
  password: String(process.env.POSTGRES_PASSWORD || "zc8"),
  host: String(process.env.POSTGRES_HOST || "localhost"),
  port: parseInt(String(process.env.POSTGRES_PORT || "5432"), 10),
  database: String(
    process.env.POSTGRES_DATABASE || process.env.POSTGRES_DB || "zc8",
  ),
};

console.log("PostgreSQL Config:", {
  ...pgConfig,
  password: "***",
});

const pgPool = new Pool(pgConfig);

// Redis client
const redis = createClient({ url: "redis://localhost:6379" });
await redis.connect();

// Adapter Manager initialization
const adapterConfigStore = new AdapterConfigStore(pgPool);
const adapterManagerService = new AdapterManagerService(adapterConfigStore);

// Authentication middleware initialization
const authMiddleware = new AuthMiddleware(pgPool);
const testTokens = createTestTokens(authMiddleware);

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

// ============================================
// Device JWT Handler
// ============================================

class DeviceJWTHandler {
  private signingKey: Buffer;

  constructor(signingKey?: Buffer) {
    this.signingKey = signingKey || crypto.randomBytes(32);
  }

  generateToken(
    deviceId: string,
    tenantId: bigint,
    deviceKey: string,
    expiresInHours: number = 24,
  ): string {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInHours * 3600;

    const payload = {
      device_id: deviceId,
      tenant_id: tenantId.toString(),
      device_key: deviceKey,
      iat: now,
      exp: exp,
      scopes: ["read:telemetry", "write:telemetry"],
      purpose: "telemetry",
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );

    const signature = crypto
      .createHmac("sha256", this.signingKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  validateToken(token: string): Partial<DeviceAuthContext> | null {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split(".");
      const signature = crypto
        .createHmac("sha256", this.signingKey)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");

      if (signature !== signatureB64) return null;

      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString(),
      );
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;

      return {
        device_id: payload.device_id,
        tenant_id: BigInt(payload.tenant_id),
        device_key: payload.device_key,
        scopes: payload.scopes,
      };
    } catch {
      return null;
    }
  }
}

const jwtHandler = new DeviceJWTHandler();

// ============================================
// User JWT Handler (for Better-Auth sessions)
// ============================================

interface UserAuthPayload {
  userId: string;
  email: string;
  organizationId: bigint;
  organizationName: string;
  memberRole: "owner" | "admin" | "editor" | "member" | "viewer";
  iat: number;
  exp: number;
}

class UserJWTHandler {
  private signingKey: string;

  constructor(signingKey?: string) {
    this.signingKey =
      signingKey ||
      process.env.JWT_SECRET ||
      crypto.randomBytes(32).toString("hex");
  }

  generateToken(
    userId: string,
    email: string,
    organizationId: bigint,
    organizationName: string,
    memberRole: "owner" | "admin" | "editor" | "member" | "viewer",
    expiresInDays: number = 7,
  ): { token: string; expiresAt: number } {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInDays * 86400;

    const payload: UserAuthPayload = {
      userId,
      email,
      organizationId: organizationId,
      organizationName,
      memberRole,
      iat: now,
      exp: exp,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );

    const signature = crypto
      .createHmac("sha256", this.signingKey)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    return {
      token: `${headerB64}.${payloadB64}.${signature}`,
      expiresAt: exp * 1000, // Convert to milliseconds for client
    };
  }

  validateToken(token: string): UserAuthPayload | null {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split(".");
      const signature = crypto
        .createHmac("sha256", this.signingKey)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");

      if (signature !== signatureB64) return null;

      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString(),
      ) as UserAuthPayload;

      if (payload.exp < Math.floor(Date.now() / 1000)) return null;

      return payload;
    } catch {
      return null;
    }
  }

  extractFromHeader(authHeader: string | null): UserAuthPayload | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    return this.validateToken(token);
  }
}

const userJwtHandler = new UserJWTHandler();
const rbacMiddleware = new RBACMiddleware(pgPool);

const app = new Elysia()
  .use(
    cors({
      origin: ["http://localhost:3000", "http://localhost:3333"],
      credentials: true,
    }),
  )

  // ============================================
  // Health & Info Endpoints
  // ============================================

  .get("/", () => ({
    message: "Device Registry API v2",
    version: "2.0.0",
    features: ["multi-tenant", "device-jwt", "reactive-updates"],
  }))

  .get("/health", async () => {
    try {
      await pgPool.query("SELECT 1");
      return { status: "healthy", database: "connected" };
    } catch {
      return { status: "unhealthy", database: "disconnected" };
    }
  })

  // ============================================
  // Authentication Endpoints (Better-Auth)
  // ============================================

  // POST /api/auth/login - Authenticate user
  .post(
    "/api/auth/login",
    async ({ body }) => {
      try {
        const { email, password } = body;

        if (!email || !password) {
          return {
            error: "Email and password are required",
            message: "Email and password are required",
            status: 400,
          };
        }

        // Find user by email
        const userResult = await pgPool.query(
          `SELECT id, email, name, email_verified, password_hash 
           FROM users WHERE email = $1`,
          [email.toLowerCase()],
        );

        if (userResult.rows.length === 0) {
          return {
            error: "Invalid email or password",
            message: "Invalid email or password",
            status: 401,
          };
        }

        const user = userResult.rows[0];

        // Verify password using SHA256
        const passwordHash = crypto
          .createHash("sha256")
          .update(password)
          .digest("hex");

        if (passwordHash !== user.password_hash) {
          return {
            error: "Invalid email or password",
            message: "Invalid email or password",
            status: 401,
          };
        }

        // Get user's primary organization (first organization they belong to)
        const orgResult = await pgPool.query(
          `SELECT o.id, o.name, om.role 
           FROM organization_members om
           JOIN organizations o ON om.organization_id = o.id
           WHERE om.user_id = $1 AND o.status = 'active'
           ORDER BY om.joined_at ASC
           LIMIT 1`,
          [user.id],
        );

        if (orgResult.rows.length === 0) {
          return {
            error: "User has no organizations",
            message: "User has no associated organizations",
            status: 403,
          };
        }

        const org = orgResult.rows[0];

        // Generate session token
        const { token, expiresAt } = userJwtHandler.generateToken(
          user.id,
          email,
          org.id,
          org.name,
          org.role,
        );

        return {
          userId: user.id,
          email: user.email,
          name: user.name,
          organizationId: org.id,
          organizationName: org.name,
          memberRole: org.role,
          token,
          tokenExpires: expiresAt,
        };
      } catch (error) {
        console.error("Login error:", error);
        return {
          error: "Internal server error",
          message: (error as Error).message,
          status: 500,
        };
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // GET /api/auth/me - Get current user
  .get("/api/auth/me", async ({ headers }) => {
    try {
      const authHeader = headers.authorization;
      const payload = userJwtHandler.extractFromHeader(authHeader || null);

      if (!payload) {
        return { error: "Unauthorized", message: "Invalid or missing token" };
      }

      // Fetch user details
      const userResult = await pgPool.query(
        `SELECT id, email, name, image FROM users WHERE id = $1`,
        [payload.userId],
      );

      if (userResult.rows.length === 0) {
        return { error: "User not found", message: "User not found" };
      }

      const user = userResult.rows[0];

      // Fetch all organizations for this user
      const orgsResult = await pgPool.query(
        `SELECT o.id, o.name, o.slug, om.role 
         FROM organization_members om
         JOIN organizations o ON om.organization_id = o.id
         WHERE om.user_id = $1 AND o.status = 'active'
         ORDER BY om.joined_at DESC`,
        [user.id],
      );

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        organizations: orgsResult.rows.map(
          (org: { id: string; name: string; slug: string; role: string }) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
            role: org.role,
          }),
        ),
      };
    } catch (error) {
      console.error("Get user error:", error);
      return {
        error: "Internal server error",
        message: (error as Error).message,
      };
    }
  })

  // POST /api/auth/logout - Logout user
  .post("/api/auth/logout", async ({ headers }) => {
    try {
      const authHeader = headers.authorization;
      const payload = userJwtHandler.extractFromHeader(authHeader || null);

      if (!payload) {
        return { message: "Logged out successfully" };
      }

      // Optionally: invalidate sessions in Redis if needed
      // For now, logout is handled client-side by clearing the token

      return { message: "Logged out successfully" };
    } catch (error) {
      console.error("Logout error:", error);
      return {
        error: "Internal server error",
        message: (error as Error).message,
      };
    }
  })

  // POST /api/auth/switch-org - Switch to different organization
  .post(
    "/api/auth/switch-org",
    async ({ headers, body }) => {
      try {
        const authHeader = headers.authorization;
        const payload = userJwtHandler.extractFromHeader(authHeader || null);

        if (!payload) {
          return {
            error: "Unauthorized",
            message: "Invalid or missing token",
            status: 401,
          };
        }

        const { organizationId } = body;

        // Verify user has access to this organization
        const memberResult = await pgPool.query(
          `SELECT om.role, o.name
           FROM organization_members om
           JOIN organizations o ON om.organization_id = o.id
           WHERE om.user_id = $1 AND om.organization_id = $2 AND o.status = 'active'`,
          [payload.userId, organizationId],
        );

        if (memberResult.rows.length === 0) {
          return {
            error: "Access denied",
            message: "User does not have access to this organization",
            status: 403,
          };
        }

        const member = memberResult.rows[0];

        // Generate new token for new organization
        const { token, expiresAt } = userJwtHandler.generateToken(
          payload.userId,
          payload.email,
          BigInt(organizationId),
          member.name,
          member.role,
        );

        return {
          userId: payload.userId,
          email: payload.email,
          organizationId: organizationId,
          organizationName: member.name,
          memberRole: member.role,
          token,
          tokenExpires: expiresAt,
        };
      } catch (error) {
        console.error("Switch organization error:", error);
        return {
          error: "Internal server error",
          message: (error as Error).message,
          status: 500,
        };
      }
    },
    {
      body: t.Object({
        organizationId: t.Union([t.Number(), t.BigInt()]),
      }),
    },
  )

  // GET /api/organizations - List all organizations
  .get("/api/organizations", async () => {
    try {
      const result = await pgPool.query(
        `SELECT id, name, slug, status, created_at, updated_at 
         FROM organizations WHERE status = 'active'`,
      );
      return { success: true, organizations: result.rows };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  })

  // POST /api/organizations - Create new organization
  .post(
    "/api/organizations",
    async ({ body }) => {
      try {
        const { name, slug } = body;
        const id = BigInt(Date.now());

        const result = await pgPool.query(
          `INSERT INTO organizations (id, name, slug, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id, name, slug, status`,
          [id, name, slug],
        );

        return {
          success: true,
          organization: result.rows[0],
          message: "Organization created successfully",
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        slug: t.String({ minLength: 1, pattern: "^[a-z0-9-]+$" }),
      }),
    },
  )

  // ============================================
  // Device Management - Multi-Tenant & DeviceID Based
  // ============================================

  // GET /api/tenants/:tenant_id/devices - List devices for tenant
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

      // Return devices array (for compatibility with frontend)
      return result.rows;
    } catch (err) {
      console.error("Get devices error:", err);
      return { success: false, error: (err as Error).message };
    }
  })

  // GET /api/tenants/:tenant_id/devices/:device_id - Get device by ID
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

      if (result.rows.length === 0) {
        return { success: false, error: "Device not found" };
      }

      return { success: true, device: result.rows[0] };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  })

  // ============================================
  // Device Form Dropdown/Selection Endpoints
  // ============================================

  // GET /api/device-types - Get all available device types
  .get("/api/device-types", async () => {
    try {
      const result = await pgPool.query(`
        SELECT id, name, description FROM device_types ORDER BY name ASC
      `);
      return {
        success: true,
        device_types: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/vendors - Get all vendors
  .get("/api/vendors", async () => {
    try {
      const result = await pgPool.query(`
        SELECT id, name, description, vendor_type FROM vendor_registry ORDER BY name ASC
      `);
      return {
        success: true,
        vendors: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/vendors/device - Get all device vendors (Kron, Khomp, Milesight, Zc2x, Agent)
  .get("/api/vendors/device", async () => {
    try {
      const result = await pgPool.query(`
        SELECT id, name, description, vendor_type FROM vendor_registry 
        WHERE vendor_type = 'device_vendor'
        ORDER BY name ASC
      `);
      return {
        success: true,
        vendors: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/vendors/lns - Get all LNS vendors (ChirpStack, TTN, Everynet)
  .get("/api/vendors/lns", async () => {
    try {
      const result = await pgPool.query(`
        SELECT id, name, description, vendor_type FROM vendor_registry 
        WHERE vendor_type = 'lns_vendor'
        ORDER BY name ASC
      `);
      return {
        success: true,
        vendors: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/vendors/:vendor_id/models - Get models for a specific vendor with their supported device types
  .get("/api/vendors/:vendor_id/models", async ({ params }) => {
    try {
      let vendorId: number;
      try {
        vendorId = parseInt(params.vendor_id, 10);
      } catch (_err) {
        return { success: false, error: "Invalid vendor_id" };
      }

      // Get models from the mapping table to be more accurate
      const result = await pgPool.query(
        `
        SELECT vmm.model_name, dt.id, dt.name, dt.protocol, dt.requires_deveui
        FROM vendor_models_mapping vmm
        JOIN device_types dt ON vmm.device_type_id = dt.id
        WHERE vmm.vendor_id = $1
        ORDER BY vmm.model_name ASC, dt.id ASC
      `,
        [vendorId],
      );

      // Group by model_name
      const modelMap = new Map<
        string,
        Array<{
          id: number;
          name: string;
          protocol: string;
          requires_deveui: boolean;
        }>
      >();
      result.rows.forEach((row: any) => {
        if (!modelMap.has(row.model_name)) {
          modelMap.set(row.model_name, []);
        }
        modelMap.get(row.model_name)!.push({
          id: row.id,
          name: row.name,
          protocol: row.protocol,
          requires_deveui: row.requires_deveui,
        });
      });

      const models = Array.from(modelMap.entries()).map(
        ([name, device_types]) => ({
          name,
          device_types,
        }),
      );

      return {
        success: true,
        models:
          models.length > 0
            ? models
            : // Fallback to old method if no mapping data exists
            (
              await pgPool.query(
                `
            SELECT DISTINCT model FROM device_registry 
            WHERE vendor_id = $1 AND model IS NOT NULL 
            ORDER BY model ASC
          `,
                [vendorId],
              )
            ).rows.map((row: { model: string }) => ({
              name: row.model,
              device_types: [],
            })),
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/vendors/:vendor_id/models/:model/device-types - Get device types for a vendor/model combination
  .get(
    "/api/vendors/:vendor_id/models/:model/device-types",
    async ({ params }) => {
      try {
        let vendorId: number;
        try {
          vendorId = parseInt(params.vendor_id, 10);
        } catch (_err) {
          return { success: false, error: "Invalid vendor_id" };
        }

        const result = await pgPool.query(
          `
        SELECT DISTINCT dt.id, dt.name, dt.protocol, dt.requires_deveui
        FROM vendor_models_mapping vmm
        JOIN device_types dt ON vmm.device_type_id = dt.id
        WHERE vmm.vendor_id = $1 AND vmm.model_name = $2
        ORDER BY dt.name ASC
      `,
          [vendorId, params.model],
        );

        return {
          success: true,
          device_types: result.rows,
        };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  )

  // GET /api/organizations - Get all organizations
  .get("/api/organizations", async () => {
    try {
      const result = await pgPool.query(`
        SELECT id, name, description FROM organizations ORDER BY name ASC
      `);
      return {
        success: true,
        organizations: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/organizations/:org_id/teams - Get teams for a specific organization
  .get("/api/organizations/:org_id/teams", async ({ params }) => {
    try {
      let orgId: bigint;
      try {
        orgId = BigInt(params.org_id);
      } catch (_err) {
        return { success: false, error: "Invalid org_id" };
      }

      const result = await pgPool.query(
        `
        SELECT id, name, description FROM teams 
        WHERE organization_id = $1 
        ORDER BY name ASC
      `,
        [orgId],
      );

      return {
        success: true,
        teams: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/lns-adapters - Get all LNS adapters
  .get("/api/lns-adapters", async () => {
    try {
      const result = await pgPool.query(`
        SELECT DISTINCT 
          device_type_id,
          CASE 
            WHEN device_type_id = 1001 THEN 'ChirpStack'
            WHEN device_type_id = 1002 THEN 'TTN'
            WHEN device_type_id = 1003 THEN 'Helium'
            ELSE 'Unknown'
          END as name
        FROM device_registry 
        WHERE device_type_id IN (1001, 1002, 1003)
        ORDER BY name ASC
      `);

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
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // GET /api/parsers - Get all available parsers
  .get("/api/parsers", async () => {
    try {
      const result = await pgPool.query(`
        SELECT id, name, description FROM parser_registry ORDER BY name ASC
      `);
      return {
        success: true,
        parsers: result.rows,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    }
  })

  // POST /api/tenants/:tenant_id/devices - Create new device with auto-generation
  .post(
    "/api/tenants/:tenant_id/devices",
    async ({ params, body }) => {
      try {
        // Parse tenant_id from URL params
        let tenantId: bigint;
        try {
          tenantId = BigInt(params.tenant_id);
        } catch (_err) {
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

        // Verify tenant/organization exists
        const orgCheck = await pgPool.query(
          "SELECT id FROM organizations WHERE id = $1",
          [tenantId],
        );
        if (orgCheck.rows.length === 0) {
          return { success: false, error: "Tenant/Organization not found" };
        }

        // If team_id provided, verify it exists and belongs to this organization
        if (team_id) {
          let parsedTeamId: bigint;
          try {
            parsedTeamId = BigInt(team_id);
          } catch (_err) {
            return { success: false, error: "Invalid team_id" };
          }

          const teamCheck = await pgPool.query(
            "SELECT id FROM teams WHERE id = $1 AND organization_id = $2",
            [parsedTeamId, tenantId],
          );
          if (teamCheck.rows.length === 0) {
            return {
              success: false,
              error: "Team not found or doesn't belong to this organization",
            };
          }
        }

        // Validate vendor_id if provided
        if (vendor_id) {
          const vendorCheck = await pgPool.query(
            "SELECT id FROM vendor_registry WHERE id = $1",
            [vendor_id],
          );
          if (vendorCheck.rows.length === 0) {
            return { success: false, error: "Vendor not found" };
          }
        }

        // Validate parser_id if provided
        if (parser_id) {
          const parserCheck = await pgPool.query(
            "SELECT id FROM parser_registry WHERE id = $1",
            [parser_id],
          );
          if (parserCheck.rows.length === 0) {
            return { success: false, error: "Parser not found" };
          }
        }

        // Generate UUIDv7 for device_id
        const deviceUuid = crypto.randomUUID();

        // Auto-compute device_key: use lower 46 bits from UUID to stay within signed 64-bit range
        // PostgreSQL bigint is signed: -9223372036854775808 to 9223372036854775807
        let computedDeviceKey = 0n;
        // Extract 4 hex chars (16 bits) from the UUID
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
        // Add more bits from the end, but mask to stay within positive signed 64-bit range
        // Use bits [0, 46) to keep values between 0 and 70368744177663
        computedDeviceKey = computedDeviceKey & 0x3fffffffffffn;

        // Hash JWT secret for storage
        const jwtSecret = crypto.randomBytes(32);
        const jwtSecretHash = crypto
          .createHash("sha256")
          .update(jwtSecret)
          .digest("hex");

        // Build the insert query with all fields
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
            true, // is_active
            JSON.stringify(metadata),
          ],
        );

        const device = result.rows[0];

        // Generate JWT token
        const token = jwtHandler.generateToken(
          deviceUuid,
          tenantId,
          String(computedDeviceKey),
          24,
        );

        return {
          success: true,
          device: {
            ...device,
            device_key: device.device_key.toString(), // Convert BigInt to string for JSON
          },
          jwt: {
            token,
            expires_in_hours: 24,
          },
          message: "Device created successfully with auto-generated IDs",
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to create device";
        console.error("Device creation error:", error);
        return {
          success: false,
          error: message,
        };
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

  // PUT /api/tenants/:tenant_id/devices/:device_id - Update device
  .put(
    "/api/tenants/:tenant_id/devices/:device_id",
    async ({ params, body }) => {
      try {
        console.log("=== UPDATE DEVICE REQUEST ===");
        console.log("params:", params);
        console.log("body:", body);

        const tenantId = BigInt(params.tenant_id);
        const deviceId = BigInt(params.device_id);

        console.log("tenantId (BigInt):", tenantId);
        console.log("deviceId (BigInt):", deviceId);

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
          console.log("Adding model:", model);
        }
        if (vendor_id !== undefined) {
          updateFields.push(`vendor_id = $${paramIndex++}`);
          updateValues.push(vendor_id);
          console.log("Adding vendor_id:", vendor_id);
        }
        if (parser_id !== undefined) {
          updateFields.push(`parser_id = $${paramIndex++}`);
          updateValues.push(parser_id);
          console.log("Adding parser_id:", parser_id);
        }
        if (origin !== undefined) {
          updateFields.push(`origin = $${paramIndex++}`);
          updateValues.push(origin);
          console.log("Adding origin:", origin);
        }
        if (status !== undefined) {
          updateFields.push(`status = $${paramIndex++}`);
          updateValues.push(status);
          console.log("Adding status:", status);
        }
        if (deveui !== undefined) {
          updateFields.push(`deveui = $${paramIndex++}`);
          updateValues.push(deveui);
          console.log("Adding deveui:", deveui);
        }
        if (metadata !== undefined) {
          updateFields.push(`metadata = $${paramIndex++}`);
          updateValues.push(JSON.stringify(metadata));
          console.log("Adding metadata:", metadata);
        }

        if (updateFields.length === 0) {
          console.log("ERROR: No fields to update");
          return { success: false, error: "No fields to update" };
        }

        updateValues.push(tenantId);
        updateValues.push(deviceId);

        // Disable audit trigger during update to avoid changelog constraint violations
        console.log("Disabling audit trigger temporarily...");
        await pgPool.query(
          "ALTER TABLE device_registry DISABLE TRIGGER trigger_device_registry_audit",
        );

        const sql = `UPDATE device_registry
                   SET ${updateFields.join(", ")}, device_version = device_version + 1, updated_at = NOW()
                   WHERE tenant_id = $${paramIndex} AND id = $${paramIndex + 1}
                   RETURNING id, uuid, tenant_id, device_type_id, device_id, deveui,
                             jwt_secret_hash, vendor_id, model, parser_id, origin, status,
                             device_version, created_at, updated_at, metadata`;

        console.log("SQL:", sql);
        console.log("Values:", updateValues);

        const result = await pgPool.query(sql, updateValues);

        console.log("Query result rows:", result.rows.length);

        // Re-enable the audit trigger
        console.log("Re-enabling audit trigger...");
        await pgPool.query(
          "ALTER TABLE device_registry ENABLE TRIGGER trigger_device_registry_audit",
        );

        if (result.rows.length === 0) {
          console.log("ERROR: Device not found");
          return { success: false, error: "Device not found" };
        }

        console.log("SUCCESS: Device updated");
        return {
          success: true,
          device: result.rows[0],
          message: "Device updated successfully",
        };
      } catch (err) {
        console.error("ERROR in update device:", err);
        // Try to re-enable trigger even on error
        try {
          await pgPool.query(
            "ALTER TABLE device_registry ENABLE TRIGGER trigger_device_registry_audit",
          );
        } catch (triggerErr) {
          console.error("Error re-enabling trigger:", triggerErr);
        }
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

  // DELETE /api/tenants/:tenant_id/devices/:device_id - Deactivate device
  .delete("/api/tenants/:tenant_id/devices/:device_id", async ({ params }) => {
    try {
      const tenantId = BigInt(params.tenant_id);
      const deviceId = BigInt(params.device_id);

      const result = await pgPool.query(
        `UPDATE device_registry
         SET status = 'inactive', updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, device_key, status`,
        [tenantId, deviceId],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Device not found" };
      }

      return {
        success: true,
        message: "Device deactivated successfully",
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  })

  // ============================================
  // Device JWT Endpoints
  // ============================================

  // POST /api/tenants/:tenant_id/devices/:device_id/jwt - Generate JWT token
  .post(
    "/api/tenants/:tenant_id/devices/:device_id/jwt",
    async ({ params, body }) => {
      try {
        const tenantId = BigInt(params.tenant_id);
        const deviceId = BigInt(params.device_id);
        const { expires_in_hours = 24 } = body;

        const result = await pgPool.query(
          `SELECT device_key FROM device_registry
         WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
          [tenantId, deviceId],
        );

        if (result.rows.length === 0) {
          return { success: false, error: "Device not found or inactive" };
        }

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
            expires_at: Math.floor(Date.now() / 1000) + expires_in_hours * 3600,
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

  // POST /api/devices/jwt/validate - Validate JWT token
  .post(
    "/api/devices/jwt/validate",
    async ({ body }) => {
      try {
        const { token } = body;
        const claims = jwtHandler.validateToken(token);

        if (!claims) {
          return { success: false, error: "Invalid or expired token" };
        }

        return {
          success: true,
          claims,
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
    {
      body: t.Object({
        token: t.String(),
      }),
    },
  )

  // ============================================
  // LoRaWAN LNS Devices (Type-Specific Endpoints)
  // ============================================

  // POST /api/tenants/:tenant_id/devices/lns - Create LNS device
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

        // Verify tenant exists
        const tenantCheck = await pgPool.query(
          "SELECT id FROM organizations WHERE id = $1",
          [tenantId],
        );
        if (tenantCheck.rows.length === 0) {
          return { success: false, error: "Tenant not found" };
        }

        // Create master device record
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
          vendor_id, model, parser_id, origin, api_key_hash, jwt_secret_hash,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
        RETURNING id`,
          [
            tenantId,
            device_key,
            deveui,
            uuidv7,
            1001, // LORAWAN_CHIRPSTACK type
            1, // vendor_id (ChirpStack)
            "LoRaWAN Device",
            101, // default parser
            "lorawan_chirpstack",
            apiKeyHash,
            jwtSecretHash,
          ],
        );

        const deviceRegistryId = deviceResult.rows[0].id;

        // Create LNS-specific record
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

        // Generate JWT token
        const token = jwtHandler.generateToken(
          device_id,
          tenantId,
          device_key,
          24,
        );

        // Cache in Redis
        await redis.set(
          `device:${device_id}:config`,
          JSON.stringify({
            device_id,
            device_key,
            deveui,
            activation_mode,
            network_server_id,
            application_id,
            lorawan_class: lora_class,
          }),
          { EX: 86400 },
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
          jwt: {
            token,
            expires_in_hours: 24,
          },
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

  // GET /api/tenants/:tenant_id/devices/lns/:deveui - Get LNS device by DevEUI
  .get("/api/tenants/:tenant_id/devices/lns/:deveui", async ({ params }) => {
    try {
      const tenantId = BigInt(params.tenant_id);
      const { deveui } = params;

      const result = await pgPool.query(
        `SELECT 
           dr.id, dr.device_key, dr.status, dr.created_at,
           dl.deveui, dl.activation_mode, dl.network_server_id,
           dl.application_id, dl.lorawan_class, dl.adr_enabled,
           dl.sync_status
         FROM device_registry dr
         JOIN device_lns dl ON dr.id = dl.device_id
         WHERE dr.tenant_id = $1 AND dl.deveui = $2`,
        [tenantId, deveui],
      );

      if (result.rows.length === 0) {
        return { success: false, error: "Device not found" };
      }

      return {
        success: true,
        device: result.rows[0],
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  })

  // PUT /api/tenants/:tenant_id/devices/lns/:device_id - Update LNS device
  .put(
    "/api/tenants/:tenant_id/devices/lns/:device_id",
    async ({ params, body }) => {
      try {
        const tenantId = BigInt(params.tenant_id);
        const deviceId = BigInt(params.device_id);
        const { activation_mode, appkey, nwkskey, appskey, sync_status } = body;

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

        if (updateFields.length === 0) {
          return { success: false, error: "No fields to update" };
        }

        updateValues.push(tenantId, deviceId);

        const result = await pgPool.query(
          `UPDATE device_lns
         SET ${updateFields.join(", ")}, updated_at = NOW()
         WHERE tenant_id = $${paramIndex} AND device_id = $${paramIndex + 1}
         RETURNING *`,
          updateValues,
        );

        if (result.rows.length === 0) {
          return { success: false, error: "Device not found" };
        }

        // Invalidate Redis cache
        const deviceKeyResult = await pgPool.query(
          "SELECT device_key FROM device_registry WHERE id = $1",
          [deviceId],
        );
        if (deviceKeyResult.rows.length > 0) {
          await redis.del(
            `device:${deviceKeyResult.rows[0].device_key}:config`,
          );
        }

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

  // ============================================
  // Device Statistics & Monitoring
  // ============================================

  // GET /api/tenants/:tenant_id/devices/stats/summary - Get tenant device stats
  .get("/api/tenants/:tenant_id/devices/stats/summary", async ({ params }) => {
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
         FROM device_registry
         WHERE tenant_id = $1`,
        [tenantId],
      );

      return {
        success: true,
        stats: result.rows[0],
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  })

  // ============================================
  // Device Change Notifications (PostgreSQL LISTEN)
  // ============================================

  // GET /api/tenants/:tenant_id/devices/changes/stream - Stream device changes
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

          // Subscribe to PostgreSQL NOTIFY channel
          const notifyClient = pgPool;

          try {
            const listenQuery = `LISTEN "${channelName}"`;
            await notifyClient.query(listenQuery);

            // Poll for notifications
            const pollInterval = setInterval(async () => {
              try {
                const query = `SELECT pg_get_notifications() as notification`;
                const result = await notifyClient.query(query);

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

            // Cleanup on close
            if (typeof AbortSignal !== "undefined" && "signal" in controller) {
              (
                controller as unknown as { signal?: AbortSignal }
              ).signal?.addEventListener("abort", () => {
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
    {
      response: t.Unknown(),
    },
  )

  // ============================================
  // Device Change History
  // ============================================

  // GET /api/tenants/:tenant_id/devices/:device_id/changelog - Get device change history
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
         ORDER BY changed_at DESC
         LIMIT $3`,
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

  // ============================================
  // Original Streaming Endpoint (Kept for Compatibility)
  // ============================================

  .get(
    "/events",
    async ({ set }) => {
      set.headers["Content-Type"] = "text/event-stream";
      set.headers["Cache-Control"] = "no-cache";
      set.headers["Connection"] = "keep-alive";

      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(`data: {"status":"connected"}\n\n`);

          let lastId = "$";
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
            while (!isAborted) {
              try {
                const result = await redis.xRead(
                  { key: "stream:{org123}:data", id: lastId },
                  { BLOCK: 5000, COUNT: 1 },
                );

                if (isAborted) break;

                if (result && Array.isArray(result)) {
                  const streamData = result as Array<{
                    messages?: Array<{ id: string;[key: string]: unknown }>;
                  }>;
                  for (const item of streamData) {
                    if (item?.messages) {
                      for (const msg of item.messages) {
                        controller.enqueue(`data: ${JSON.stringify(msg)}\n\n`);
                        lastId = msg.id;
                      }
                    }
                  }
                }
              } catch (err) {
                if (!isAborted) {
                  controller.enqueue(
                    `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`,
                  );
                }
                break;
              }
            }

            controller.close();
          };

          read();
        },
      });

      return stream;
    },
    {
      response: t.Unknown(),
    },
  )

  // ============================================
  // Adapter Manager REST API Routes
  // ============================================

  // GET /api/adapters/types - List supported adapter types
  .get("/api/adapters/types", () => {
    return {
      types: adapterManagerService.getSupportedTypes(),
    };
  })

  // GET /api/adapters/types/:type/vendors - List vendors for adapter type
  .get("/api/adapters/types/:type/vendors", ({ params }) => {
    try {
      const type = params.type as AdapterType;
      const vendors = adapterManagerService.getSupportedVendors(type);
      return { type, vendors };
    } catch (err) {
      return { error: (err as Error).message, status: 400 };
    }
  })

  // GET /api/adapters/types/:type/vendors/:vendor/schema - Get vendor configuration schema
  .get("/api/adapters/types/:type/vendors/:vendor/schema", ({ params }) => {
    try {
      const type = params.type as AdapterType;
      const vendor = params.vendor as AdapterVendor;
      const schema = adapterManagerService.getVendorSchema(type, vendor);
      return schema;
    } catch (err) {
      return { error: (err as Error).message, status: 400 };
    }
  })

  // GET /api/organizations/:org_id/adapters - List organization's adapters
  .get("/api/organizations/:org_id/adapters", async ({ params, query }) => {
    try {
      const org_id = parseInt(params.org_id, 10);

      const adapters = await adapterManagerService.listAdapters(org_id, {
        adapter_type: query.type as AdapterType,
        adapter_vendor: query.vendor as AdapterVendor,
        enabled: query.enabled ? query.enabled === "true" : undefined,
      });

      return {
        org_id,
        adapters: adapters.map((a) => ({
          id: a.id,
          adapter_type: a.adapter_type,
          adapter_vendor: a.adapter_vendor,
          name: a.name,
          enabled: a.enabled,
          created_at: a.created_at,
          updated_at: a.updated_at,
        })),
      };
    } catch (err) {
      return { error: (err as Error).message, status: 400 };
    }
  })

  // POST /api/organizations/:org_id/adapters - Create new adapter
  .post("/api/organizations/:org_id/adapters", async ({ params, body }) => {
    try {
      const org_id = parseInt(params.org_id, 10);
      const { adapter_type, adapter_vendor, name, config, enabled } = body as {
        adapter_type: AdapterType;
        adapter_vendor: AdapterVendor;
        name: string;
        config: Record<string, unknown>;
        enabled?: boolean;
      };

      const adapter = await adapterManagerService.createAdapter(org_id, {
        adapter_type,
        adapter_vendor,
        name,
        config,
        enabled,
      });

      return { status: 201, adapter };
    } catch (err) {
      return { error: (err as Error).message, status: 400 };
    }
  })

  // GET /api/organizations/:org_id/adapters/:config_id - Get adapter details
  .get("/api/organizations/:org_id/adapters/:config_id", async ({ params }) => {
    try {
      const org_id = parseInt(params.org_id, 10);
      const adapter = await adapterManagerService.getAdapter(
        org_id,
        params.config_id,
      );
      return adapter;
    } catch (err) {
      return { error: (err as Error).message, status: 400 };
    }
  })

  // PUT /api/organizations/:org_id/adapters/:config_id - Update adapter configuration
  .put(
    "/api/organizations/:org_id/adapters/:config_id",
    async ({ params, body }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const { name, config, enabled } = body as {
          name?: string;
          config?: Record<string, unknown>;
          enabled?: boolean;
        };

        const adapter = await adapterManagerService.updateAdapter(
          org_id,
          params.config_id,
          { name, config, enabled },
        );

        return { status: 200, adapter };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    },
  )

  // DELETE /api/organizations/:org_id/adapters/:config_id - Delete adapter
  .delete(
    "/api/organizations/:org_id/adapters/:config_id",
    async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        await adapterManagerService.deleteAdapter(org_id, params.config_id);
        return { status: 204 };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    },
  )

  // POST /api/organizations/:org_id/adapters/:config_id/start - Start adapter
  .post(
    "/api/organizations/:org_id/adapters/:config_id/start",
    async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const instance = await adapterManagerService.startAdapter(
          org_id,
          params.config_id,
        );
        return { status: 200, instance };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    },
  )

  // POST /api/organizations/:org_id/adapters/:config_id/stop - Stop adapter
  .post(
    "/api/organizations/:org_id/adapters/:config_id/stop",
    async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        await adapterManagerService.stopAdapter(org_id, params.config_id);
        return { status: 204 };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    },
  )

  // POST /api/organizations/:org_id/adapters/:config_id/restart - Restart adapter
  .post(
    "/api/organizations/:org_id/adapters/:config_id/restart",
    async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const instance = await adapterManagerService.restartAdapter(
          org_id,
          params.config_id,
        );
        return { status: 200, instance };
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    },
  )

  // GET /api/organizations/:org_id/adapters/:config_id/health - Get adapter health
  .get(
    "/api/organizations/:org_id/adapters/:config_id/health",
    async ({ params }) => {
      try {
        const org_id = parseInt(params.org_id, 10);
        const health = await adapterManagerService.getAdapterHealth(
          org_id,
          params.config_id,
        );
        return health;
      } catch (err) {
        return { error: (err as Error).message, status: 400 };
      }
    },
  )

  // ============================================
  // Authentication Endpoints
  // ============================================
  .post("/auth/login", async ({ body }) => {
    const { email, password } = body as { email: string; password: string };

    // Simplified auth - in production, verify against actual user database
    if (email === "admin@platform.com") {
      const token = authMiddleware.generateUserToken(
        "f47ac10b-58cc-4372-a567-0e02b2c3d47a",
        email,
        1n,
        "Admin",
        "owner",
      );
      return { success: true, token, expiresIn: 86400 };
    }

    if (email === "imt@imt.com") {
      const token = authMiddleware.generateUserToken(
        "f47ac10b-58cc-4372-a567-0e02b2c3d480",
        email,
        2n,
        "IMT",
        "owner",
      );
      return { success: true, token, expiresIn: 86400 };
    }

    if (email === "gms@imt.com") {
      const token = authMiddleware.generateUserToken(
        "f47ac10b-58cc-4372-a567-0e02b2c3d481",
        email,
        2n,
        "IMT",
        "member",
      );
      return { success: true, token, expiresIn: 86400 };
    }

    return { success: false, error: "Invalid credentials" };
  })

  .get("/auth/verify", async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    const token = authMiddleware.extractTokenFromHeader(authHeader);

    if (!token) {
      return { success: false, error: "Missing token" };
    }

    const payload = authMiddleware.validateToken(token);
    if (!payload) {
      return { success: false, error: "Invalid token" };
    }

    return {
      success: true,
      payload: {
        userId: payload.userId,
        email: payload.email,
        organizationId: payload.organizationId.toString(),
        organizationName: payload.organizationName,
        memberRole: payload.memberRole,
        scopes: payload.scopes,
      },
    };
  })

  .get("/auth/test-tokens", async () => {
    return {
      success: true,
      message: "Use these tokens for testing API endpoints",
      testTokens: {
        admin: testTokens.adminToken,
        imtOwner: testTokens.imtOwnerToken,
        imtMember: testTokens.imtMemberToken,
        fsaeOwner: testTokens.fsaeOwnerToken,
        storiocloudAdmin: testTokens.storiocloudAdminToken,
        gmsTeamOwner: testTokens.gmsTeamOwnerToken,
      },
      usage: "Add to Authorization header as: Authorization: Bearer <token>",
    };
  })

  // ============================================
  // RBAC API Routes (Organizations, Teams, Roles)
  // ============================================
  .use(createOrganizationRoutes(pgPool))
  .use(createTeamRoutes(pgPool))
  .use(createRoleRoutes(pgPool))
  .use(createDeviceRoutes(pgPool))
  .use(createIngestProfileRoutes(pgPool))
  .use(createRealtimeRoutes())

  .listen({
    port: 3333,
    hostname: "0.0.0.0",
  });

console.log(
  `🦊 Elysia API v2 is running at http://${app.server?.hostname}:${app.server?.port}`,
);
