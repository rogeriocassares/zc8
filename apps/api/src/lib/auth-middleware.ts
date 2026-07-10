import * as crypto from "crypto";
import type { Context } from "elysia";
import type { Pool } from "pg";

type ExtendedContext = Context & { auth?: UserAuthPayload };

/**
 * User JWT payload with RBAC context
 */
export interface UserAuthPayload {
  userId: string;
  email: string;
  organizationId: bigint;
  organizationName: string;
  teamId?: bigint;
  teamName?: string;
  memberRole:
  | "owner"
  | "admin"
  | "member"
  | "teamowner"
  | "teamadmin"
  | "teammember";
  scopes: string[];
  iat: number;
  exp: number;
}

/**
 * JWT Authentication Middleware for user requests
 * Validates tokens and extracts user context from JWT payload
 */
export class AuthMiddleware {
  private readonly signingKey: string;

  constructor(_pgPool: Pool, signingKey?: string) {
    this.signingKey =
      signingKey ||
      process.env.JWT_SECRET ||
      crypto.randomBytes(32).toString("hex");
  }

  /**
   * Generate JWT token for user
   */
  generateUserToken(
    userId: string,
    email: string,
    organizationId: bigint,
    organizationName: string,
    memberRole:
      | "owner"
      | "admin"
      | "member"
      | "teamowner"
      | "teamadmin"
      | "teammember",
    expiresInHours: number = 24,
    teamId?: bigint,
    teamName?: string,
  ): string {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresInHours * 3600;

    const payload: Record<string, unknown> = {
      userId,
      email,
      organizationId: organizationId.toString(),
      organizationName,
      memberRole,
      scopes: this.getScopesForRole(memberRole),
      iat: now,
      exp,
    };

    if (teamId) {
      payload.teamId = teamId.toString();
      payload.teamName = teamName;
    }

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

  /**
   * Validate JWT token and return payload
   */
  validateToken(token: string): UserAuthPayload | null {
    try {
      const [headerB64, payloadB64, signatureB64] = token.split(".");
      if (!headerB64 || !payloadB64 || !signatureB64) {
        return null;
      }

      // Verify signature
      const signature = crypto
        .createHmac("sha256", this.signingKey)
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");

      if (signature !== signatureB64) {
        return null;
      }

      // Decode and parse payload
      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString(),
      );

      // Check expiration
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      // Parse BigInt fields
      const result: UserAuthPayload = {
        userId: payload.userId,
        email: payload.email,
        organizationId: BigInt(payload.organizationId),
        organizationName: payload.organizationName,
        memberRole: payload.memberRole,
        scopes: payload.scopes || [],
        iat: payload.iat,
        exp: payload.exp,
      };

      if (payload.teamId) {
        result.teamId = BigInt(payload.teamId);
        result.teamName = payload.teamName;
      }

      return result;
    } catch (error) {
      console.error("Token validation error:", error);
      return null;
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return null;
    }

    return parts[1];
  }

  /**
   * Get scopes for a role
   */
  private getScopesForRole(
    role:
      | "owner"
      | "admin"
      | "member"
      | "teamowner"
      | "teamadmin"
      | "teammember",
  ): string[] {
    const scopeMap: Record<string, string[]> = {
      owner: [
        "org:read",
        "org:write",
        "org:admin",
        "teams:manage",
        "members:manage",
      ],
      admin: ["org:read", "org:write", "org:admin", "members:manage"],
      member: ["org:read", "teams:read"],
      teamowner: [
        "team:read",
        "team:write",
        "team:admin",
        "devices:manage",
        "members:manage",
        "subteams:create",
      ],
      teamadmin: [
        "team:read",
        "team:write",
        "team:admin",
        "devices:manage",
        "members:manage",
      ],
      teammember: ["team:read", "devices:read", "devices:create"],
    };

    return scopeMap[role] || ["read"];
  }

  /**
   * Middleware to check authentication
   */
  createAuthGuard() {
    return async (ctx: Context) => {
      const authHeader = ctx.request.headers.get("Authorization");
      const token = this.extractTokenFromHeader(authHeader ?? undefined);

      if (!token) {
        (ctx as ExtendedContext).set.status = 401;
        return {
          success: false,
          error: "Missing authorization token",
          code: "UNAUTHORIZED",
        };
      }

      const payload = this.validateToken(token);
      if (!payload) {
        (ctx as ExtendedContext).set.status = 401;
        return {
          success: false,
          error: "Invalid or expired token",
          code: "INVALID_TOKEN",
        };
      }

      // Store auth context in request for use in route handlers
      (ctx as ExtendedContext).auth = payload;
    };
  }

  /**
   * Verify user has specific scope
   */
  requireScope(requiredScope: string) {
    return async (ctx: Context) => {
      const auth = (ctx as ExtendedContext).auth;

      if (!auth) {
        (ctx as ExtendedContext).set.status = 401;
        return {
          success: false,
          error: "Not authenticated",
          code: "UNAUTHORIZED",
        };
      }

      if (!auth.scopes.includes(requiredScope)) {
        (ctx as ExtendedContext).set.status = 403;
        return {
          success: false,
          error: `Missing required scope: ${requiredScope}`,
          code: "INSUFFICIENT_PERMISSIONS",
        };
      }
    };
  }

  /**
   * Verify user is organization owner/admin
   */
  requireOrgAdmin() {
    return async (ctx: Context) => {
      const auth = (ctx as ExtendedContext).auth;

      if (!auth) {
        (ctx as ExtendedContext).set.status = 401;
        return {
          success: false,
          error: "Not authenticated",
          code: "UNAUTHORIZED",
        };
      }

      if (!['owner', 'admin'].includes(auth.memberRole)) {
        (ctx as ExtendedContext).set.status = 403;
        return {
          success: false,
          error: "Organization admin access required",
          code: "INSUFFICIENT_PERMISSIONS",
        };
      }
    };
  }

  /**
   * Verify user is team owner/admin
   */
  requireTeamAdmin() {
    return async (ctx: Context) => {
      const auth = (ctx as ExtendedContext).auth;

      if (!auth) {
        (ctx as ExtendedContext).set.status = 401;
        return {
          success: false,
          error: "Not authenticated",
          code: "UNAUTHORIZED",
        };
      }

      if (!['teamowner', 'teamadmin'].includes(auth.memberRole)) {
        (ctx as ExtendedContext).set.status = 403;
        return {
          success: false,
          error: "Team admin access required",
          code: "INSUFFICIENT_PERMISSIONS",
        };
      }
    };
  }

  /**
   * Optional auth guard (doesn't fail if missing, but extracts if present)
   */
  createOptionalAuthGuard() {
    return async (ctx: Context) => {
      const authHeader = ctx.request.headers.get("Authorization");
      const token = this.extractTokenFromHeader(authHeader ?? undefined);

      if (token) {
        const payload = this.validateToken(token);
        if (payload) {
          (ctx as ExtendedContext).auth = payload;
        }
      }
    };
  }
}

/**
 * Create test JWT tokens for API testing
 */
export function createTestTokens(authMiddleware: AuthMiddleware) {
  return {
    // Admin token (platform admin)
    adminToken: authMiddleware.generateUserToken(
      "f47ac10b-58cc-4372-a567-0e02b2c3d47a",
      "admin@platform.com",
      1n,
      "Admin",
      "owner",
      24,
    ),

    // IMT Owner token
    imtOwnerToken: authMiddleware.generateUserToken(
      "f47ac10b-58cc-4372-a567-0e02b2c3d480",
      "imt@imt.com",
      2n,
      "IMT",
      "owner",
      24,
    ),

    // IMT Member token
    imtMemberToken: authMiddleware.generateUserToken(
      "f47ac10b-58cc-4372-a567-0e02b2c3d481",
      "gms@imt.com",
      2n,
      "IMT",
      "member",
      24,
    ),

    // FSAELive Owner token
    fsaeOwnerToken: authMiddleware.generateUserToken(
      "f47ac10b-58cc-4372-a567-0e02b2c3d483",
      "fsaelive@fsaelive.com",
      3n,
      "FSAELive",
      "owner",
      24,
    ),

    // StorioCloud Admin token
    storiocloudAdminToken: authMiddleware.generateUserToken(
      "f47ac10b-58cc-4372-a567-0e02b2c3d484",
      "cinemark@storiocloud.com",
      4n,
      "StorioCloud",
      "admin",
      24,
    ),

    // Team Owner token (GMS team in IMT)
    gmsTeamOwnerToken: authMiddleware.generateUserToken(
      "f47ac10b-58cc-4372-a567-0e02b2c3d480",
      "imt@imt.com",
      2n,
      "IMT",
      "teamowner",
      24,
      1n,
      "GMS",
    ),
  };
}
